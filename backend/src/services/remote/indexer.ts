/**
 * Generic remote indexer — works for any RemoteProvider (rclone, webdav, …).
 * Reuses the batch/dedup/SSE machinery from rclone-indexer.ts.
 *
 * Files are identified by path+size hash (no download).
 * Cross-mode dedup: rclone/webdav files matching a local file by name+size+kind reuse its file_id.
 */
import { createHash } from 'crypto';
import path from 'path';
import type Database from 'better-sqlite3';
import { getProvider } from './registry.js';
import type { RemoteServer, RemoteFileInfo } from './types.js';
import { invalidateFeedCache } from '../feed.js';

const BATCH_SIZE = 50;

function deriveId(parts: string[]): string {
  return createHash('sha256').update(parts.join('::')).digest('hex');
}

function deriveFolderId(userId: string, serverId: string, relPath: string): string {
  return deriveId([userId, serverId, 'folder', relPath]);
}

function derivePathId(userId: string, serverId: string, absolutePath: string): string {
  return deriveId([userId, serverId, 'path', absolutePath]);
}

/**
 * Single-phase streaming indexer for a remote server.
 * Calls onDiscovery once with total count, then onBatchReady after each batch.
 */
export async function indexRemoteFilesStreaming(
  db: Database.Database,
  server: RemoteServer,
  rootDir: string,
  userId: string,
  jobId: string,
  onDiscovery: (count: number) => void,
  onBatchReady: (done: number, total: number) => void
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const storageMode = server.serverType; // 'rclone' | 'webdav'
  const provider = getProvider(server.serverType);

  // ── 1. Collect all media files via provider scanMedia ─────────────────────
  const allFiles: RemoteFileInfo[] = [];
  await provider.scanMedia(server, rootDir, async (batch) => { allFiles.push(...batch); });
  onDiscovery(allFiles.length);
  if (allFiles.length === 0) return 0;

  // ── 2. Build descriptors with stable IDs ──────────────────────────────────
  type Desc = RemoteFileInfo & {
    contentHash: string;
    fileKey: string;
    pathId: string;
    pathHash: string;
    folderId: string;
    folderRelPath: string; // relative to server root
  };

  const scannedFolders = new Set<string>();
  const descs: Desc[] = [];

  for (const f of allFiles) {
    const dir = f.relativePath.includes('/')
      ? f.relativePath.slice(0, f.relativePath.lastIndexOf('/'))
      : '';
    if (dir) {
      const parts = dir.split('/').filter(Boolean);
      let rolling = '';
      for (const part of parts) {
        rolling = rolling ? `${rolling}/${part}` : part;
        scannedFolders.add(rolling);
      }
    }
    const folderRelPath = dir;
    const contentHash = createHash('sha256').update(`${f.absolutePath}:${f.sizeBytes}`).digest('hex');
    descs.push({
      ...f,
      contentHash,
      fileKey: contentHash.slice(0, 16),
      pathId: derivePathId(userId, server.id, f.absolutePath),
      pathHash: createHash('sha256').update(f.absolutePath).digest('hex'),
      folderId: deriveFolderId(userId, server.id, folderRelPath),
      folderRelPath,
    });
  }

  // ── 3. Upsert folders ─────────────────────────────────────────────────────
  const upsertFolder = db.prepare(`
    INSERT INTO folders (id, user_id, server_id, parent_folder_id, storage_mode,
      absolute_path, relative_path_from_root, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, storage_mode, relative_path_from_root) DO UPDATE SET
      server_id = excluded.server_id,
      parent_folder_id = excluded.parent_folder_id,
      absolute_path = excluded.absolute_path,
      name = excluded.name,
      updated_at = excluded.updated_at
  `);

  const markMissing = db.prepare(`
    UPDATE file_paths SET is_present = 0, last_seen_at = ?, updated_at = ?
    WHERE user_id = ? AND server_id = ?
  `);

  // Root folder
  const rootFolderId = deriveFolderId(userId, server.id, '');
  const allFolderPaths = [{ relPath: '', name: server.displayName }, ...Array.from(scannedFolders).sort().map((r) => ({ relPath: r, name: path.basename(r) }))];

  db.transaction(() => {
    markMissing.run(now, now, userId, server.id);
    for (const { relPath, name } of allFolderPaths) {
      const parentRelPath = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : (relPath ? '' : null);
      const folderId = deriveFolderId(userId, server.id, relPath);
      const parentFolderId = parentRelPath !== null ? deriveFolderId(userId, server.id, parentRelPath) : null;
      const absPath = relPath ? `${rootDir}/${relPath}` : rootDir;
      upsertFolder.run(folderId, userId, server.id, parentFolderId, storageMode, absPath, relPath || `__server_root_${server.id}`, name, now, now);
    }
  })();

  // ── 4. Cross-mode dedup: local files by name+size+kind ────────────────────
  // Only dedup against 'ready' local files — 'pending' rows still carry a throwaway
  // temp file_id ('p' + path hash) that local finalization deletes once hashing
  // finishes, which would leave this remote path pointing at a dead files.id.
  const localDedupMap = new Map<string, string>(); // "name:size:kind" → file_id
  const localRows = db.prepare<[string], { file_name: string; size_bytes: number; media_kind: string; file_id: string }>(
    `SELECT fp.file_name, f.size_bytes, f.media_kind, fp.file_id
     FROM file_paths fp JOIN files f ON f.id = fp.file_id
     WHERE fp.user_id = ? AND fp.storage_mode = 'local' AND fp.status = 'ready'`
  ).all(userId);
  for (const r of localRows) {
    localDedupMap.set(`${r.file_name}:${r.size_bytes}:${r.media_kind}`, r.file_id);
  }

  // ── 5. Write files in batches ─────────────────────────────────────────────
  const upsertFile = db.prepare(`
    INSERT INTO files (id, file_key, content_hash, size_bytes, mime_type, extension, media_kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO NOTHING
  `);

  const upsertPath = db.prepare(`
    INSERT INTO file_paths (id, file_id, user_id, folder_id, server_id, storage_mode,
      file_name, absolute_path, relative_path_from_root, path_hash,
      first_seen_at, last_seen_at, is_present, status, temp_file_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ready', NULL, ?, ?)
    ON CONFLICT(user_id, absolute_path) DO UPDATE SET
      file_id = excluded.file_id,
      folder_id = excluded.folder_id,
      server_id = excluded.server_id,
      file_name = excluded.file_name,
      relative_path_from_root = excluded.relative_path_from_root,
      path_hash = excluded.path_hash,
      last_seen_at = excluded.last_seen_at,
      is_present = 1,
      status = 'ready',
      updated_at = excluded.updated_at
  `);

  const total = descs.length;
  let done = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = descs.slice(i, i + BATCH_SIZE);
    const batchNow = Math.floor(Date.now() / 1000);

    db.transaction(() => {
      for (const d of batch) {
        const localMatch = localDedupMap.get(`${d.fileName}:${d.sizeBytes}:${d.mediaKind}`);
        const fileId = localMatch ?? d.contentHash;

        if (!localMatch) {
          upsertFile.run(d.contentHash, d.fileKey, d.contentHash, d.sizeBytes, d.mimeType, d.extension, d.mediaKind, batchNow, batchNow);
        }

        const relPathFromRoot = d.relativePath;
        upsertPath.run(
          d.pathId, fileId, userId,
          d.folderId, server.id, storageMode,
          d.fileName, d.absolutePath, relPathFromRoot, d.pathHash,
          batchNow, batchNow, batchNow, batchNow
        );
      }
    })();

    done += batch.length;
    invalidateFeedCache(userId);
    onBatchReady(done, total);
  }

  return total;
}
