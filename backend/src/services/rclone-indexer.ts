/**
 * Rclone Indexer Service
 * Pending-first pipeline for rclone remote sources.
 * Rclone files are identified by path+size hash (no stream download needed for initial indexing).
 */
import { createHash } from 'crypto';
import path from 'path';
import mime from 'mime-types';
import type Database from 'better-sqlite3';
import { scanRemoteForMedia, scanRemoteForMediaFastList } from './rclone.js';
import { getRemoteRcloneConfig } from './rclone-remote-config.js';
import { RemoteRcloneClient } from './rclone-remote.js';
import { invalidateFeedCache } from './feed.js';

export interface PendingRcloneFile {
  tempFileId: string;
  pathId: string;
  absolutePath: string;
  relativePathFromRoot: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
  extension: string | null;
  mediaKind: 'image' | 'video';
  folderRelativePath: string;
  pathBasedHash: string; // deterministic hash from path+size (no download)
}

// ── helpers shared with rclone.ts route ───────────────────────────────────────

function normalizeSegment(input: string): string {
  return input.trim().replace(/^\/+|\/+$/g, '');
}

function createRcloneSourcePrefix(remoteName: string, basePath: string): string {
  const normalizedBase = normalizeSegment(basePath);
  const fingerprint = createHash('sha1')
    .update(`${remoteName}:${normalizedBase}`)
    .digest('hex')
    .slice(0, 8);
  const safeRemote = remoteName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `rclone_${safeRemote}_${fingerprint}`;
}

function buildRemotePrefix(remoteName: string, basePath: string): string {
  const normalizedBase = normalizeSegment(basePath);
  return normalizedBase ? `${remoteName}:${normalizedBase}` : `${remoteName}:`;
}

function toRcloneAbsolutePath(remotePrefix: string, relativePath: string): string {
  if (!relativePath) return remotePrefix;
  return `${remotePrefix}/${relativePath}`.replace(/\/+/g, '/');
}

function extractRelativePath(remotePath: string, remotePrefix: string): string {
  if (remotePath === remotePrefix) return '';
  if (remotePath.startsWith(`${remotePrefix}/`)) return remotePath.slice(remotePrefix.length + 1);
  const withoutRemote = remotePath.includes(':') ? remotePath.split(':').slice(1).join(':') : remotePath;
  return withoutRemote.replace(/^\/+/, '');
}

function deriveFolderId(userId: string, relativePathFromRoot: string): string {
  return createHash('sha256').update(`folder:${userId}:rclone:${relativePathFromRoot}`).digest('hex').slice(0, 32);
}

function derivePathId(userId: string, absolutePath: string): string {
  return createHash('sha256').update(`path:${userId}:rclone:${absolutePath}`).digest('hex').slice(0, 32);
}

function makeTempFileId(absolutePath: string): string {
  return 'p' + createHash('sha256').update(absolutePath).digest('hex').slice(0, 31);
}

// ── main exports ──────────────────────────────────────────────────────────────

/**
 * List remote files and create pending file_path records immediately.
 */
export async function discoverAndCreatePendingRclone(
  db: Database.Database,
  remoteName: string,
  basePath: string,
  _remoteType: string,
  userId: string,
  _jobId: string,
  onProgress: (count: number) => void
): Promise<PendingRcloneFile[]> {
  const now = Math.floor(Date.now() / 1000);
  const remoteConfig = getRemoteRcloneConfig(db);
  const remotePrefix = buildRemotePrefix(remoteName, basePath);
  const sourcePrefix = createRcloneSourcePrefix(remoteName, basePath);

  let mediaFiles: Array<{ path: string; type: 'image' | 'video'; size?: number }> = [];

  if (remoteConfig.enabled) {
    const client = new RemoteRcloneClient(remoteConfig);
    mediaFiles = await client.scanRemoteForMedia(`${remoteName}:${basePath}`);
  } else {
    mediaFiles = await scanRemoteForMedia(`${remoteName}:${basePath}`);
  }

  // Build folder set
  const scannedFolders = new Set<string>();
  const fileDescs: Array<{
    absolutePath: string;
    relativePathFromRoot: string;
    fileName: string;
    sizeBytes: number;
    mimeType: string | null;
    extension: string | null;
    mediaKind: 'image' | 'video';
    folderRelativePath: string;
  }> = [];

  for (const remoteFile of mediaFiles) {
    const relInSource = extractRelativePath(remoteFile.path, remotePrefix);
    if (!relInSource) continue;

    const relativePathFromRoot = `${sourcePrefix}/${relInSource}`;
    const fileName = path.basename(relInSource);
    const extension = path.extname(relInSource).toLowerCase() || null;
    const mimeType = (mime.lookup(fileName) || null) as string | null;
    const folderInSource = path.dirname(relInSource) === '.' ? '' : path.dirname(relInSource).replace(/\\/g, '/');
    const folderRelativePath = folderInSource ? `${sourcePrefix}/${folderInSource}` : sourcePrefix;
    const absolutePath = toRcloneAbsolutePath(remotePrefix, relInSource);

    if (folderInSource) {
      const parts = folderInSource.split('/').filter(Boolean);
      let rolling = '';
      for (const part of parts) {
        rolling = rolling ? `${rolling}/${part}` : part;
        scannedFolders.add(rolling);
      }
    }

    fileDescs.push({ absolutePath, relativePathFromRoot, fileName, sizeBytes: remoteFile.size || 0, mimeType, extension, mediaKind: remoteFile.type, folderRelativePath });
  }

  // Build folder records
  const folderRelPaths = new Set<string>([sourcePrefix]);
  for (const f of scannedFolders) folderRelPaths.add(`${sourcePrefix}/${f}`);

  const sorted = Array.from(folderRelPaths).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  const upsertFolder = db.prepare(`
    INSERT INTO folders (id, user_id, parent_folder_id, storage_mode, absolute_path, relative_path_from_root, name, created_at, updated_at)
    VALUES (?, ?, ?, 'rclone', ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, storage_mode, relative_path_from_root) DO UPDATE SET
      parent_folder_id = excluded.parent_folder_id,
      absolute_path = excluded.absolute_path,
      name = excluded.name,
      updated_at = excluded.updated_at
  `);

  const markMissing = db.prepare(`
    UPDATE file_paths SET is_present = 0, last_seen_at = ?, updated_at = ?
    WHERE user_id = ? AND storage_mode = 'rclone' AND relative_path_from_root LIKE ?
  `);

  const upsertTempFile = db.prepare(`
    INSERT INTO files (id, file_key, content_hash, size_bytes, mime_type, extension, media_kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO NOTHING
  `);

  const upsertPendingPath = db.prepare(`
    INSERT INTO file_paths (id, file_id, user_id, folder_id, storage_mode, file_name, absolute_path, relative_path_from_root, path_hash, first_seen_at, last_seen_at, is_present, status, temp_file_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'rclone', ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?)
    ON CONFLICT(user_id, absolute_path) DO UPDATE SET
      file_id = excluded.file_id,
      folder_id = excluded.folder_id,
      file_name = excluded.file_name,
      relative_path_from_root = excluded.relative_path_from_root,
      path_hash = excluded.path_hash,
      last_seen_at = excluded.last_seen_at,
      is_present = 1,
      status = 'pending',
      temp_file_id = excluded.temp_file_id,
      updated_at = excluded.updated_at
  `);

  const pendingFiles: PendingRcloneFile[] = [];

  const tx = db.transaction(() => {
    markMissing.run(now, now, userId, `${sourcePrefix}%`);

    for (const relPath of sorted) {
      const parentRel = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : null;
      const relfInSource = relPath === sourcePrefix ? '' : relPath.slice(sourcePrefix.length + 1);
      upsertFolder.run(
        deriveFolderId(userId, relPath),
        userId,
        parentRel ? deriveFolderId(userId, parentRel) : null,
        toRcloneAbsolutePath(remotePrefix, relfInSource),
        relPath,
        relfInSource ? path.basename(relfInSource) : `${remotePrefix}`,
        now,
        now
      );
    }

    for (const file of fileDescs) {
      const tempId = makeTempFileId(file.absolutePath);
      const pathBasedHash = createHash('sha256').update(`${file.absolutePath}:${file.sizeBytes}`).digest('hex');
      const folderId = deriveFolderId(userId, file.folderRelativePath);
      const pathId = derivePathId(userId, file.absolutePath);
      const pathHash = createHash('sha256').update(file.absolutePath).digest('hex');

      upsertTempFile.run(tempId, `t${tempId.slice(1, 15)}`, tempId, file.sizeBytes, file.mimeType, file.extension, file.mediaKind, now, now);
      upsertPendingPath.run(pathId, tempId, userId, folderId, file.fileName, file.absolutePath, file.relativePathFromRoot, pathHash, now, now, tempId, now, now);

      pendingFiles.push({ tempFileId: tempId, pathId, pathBasedHash, ...file });
    }
  });

  tx();
  onProgress(pendingFiles.length);
  return pendingFiles;
}

/**
 * Finalize rclone files: the content hash is path+size based (no download).
 * Reconciles temp records to the deterministic path-based hash.
 */
export async function finalizeRclonePendingFiles(
  db: Database.Database,
  pending: PendingRcloneFile[],
  _userId: string,
  _jobId: string,
  onProgress: (done: number, total: number, tempId: string, finalId: string) => void
): Promise<void> {
  const total = pending.length;

  for (let i = 0; i < pending.length; i++) {
    const file = pending[i];
    const contentHash = file.pathBasedHash;
    const now = Math.floor(Date.now() / 1000);
    const fileKey = contentHash.slice(0, 16);

    const tx = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM files WHERE content_hash = ?').get(contentHash) as { id: string } | undefined;

      if (existing && existing.id !== file.tempFileId) {
        const realId = existing.id;
        db.prepare(`UPDATE user_liked_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
        db.prepare(`UPDATE user_saved_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
        db.prepare(`UPDATE user_hidden_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
        db.prepare(`UPDATE file_paths SET file_id = ?, status = 'ready', temp_file_id = NULL, updated_at = ? WHERE id = ?`).run(realId, now, file.pathId);
        db.prepare(`DELETE FROM files WHERE id = ?`).run(file.tempFileId);
      } else {
        db.prepare(
          `INSERT INTO files (id, file_key, content_hash, size_bytes, mime_type, extension, media_kind, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(content_hash) DO NOTHING`
        ).run(contentHash, fileKey, contentHash, file.sizeBytes, file.mimeType, file.extension, file.mediaKind, now, now);

        db.prepare(`UPDATE user_liked_files SET file_id = ? WHERE file_id = ?`).run(contentHash, file.tempFileId);
        db.prepare(`UPDATE user_saved_files SET file_id = ? WHERE file_id = ?`).run(contentHash, file.tempFileId);
        db.prepare(`UPDATE user_hidden_files SET file_id = ? WHERE file_id = ?`).run(contentHash, file.tempFileId);
        db.prepare(`UPDATE file_paths SET file_id = ?, status = 'ready', temp_file_id = NULL, updated_at = ? WHERE id = ?`).run(contentHash, now, file.pathId);
        db.prepare(`DELETE FROM files WHERE id = ?`).run(file.tempFileId);
      }
    });

    tx();
    onProgress(i + 1, total, file.tempFileId, contentHash);
  }
}

// ── Streaming ready indexer ────────────────────────────────────────────────────

const BATCH_SIZE = 50;

/**
 * Single-phase streaming indexer for rclone sources.
 *
 * Uses `rclone lsjson --fast-list --recursive` to get the full file list in one
 * subprocess call, then writes files directly as `status='ready'` in batches of
 * BATCH_SIZE (50). The feed cache is invalidated after every batch so media becomes
 * viewable almost immediately rather than waiting for the entire job to finish.
 *
 * This replaces the two-phase pending → finalize flow for all new rclone indexing.
 */
export async function indexRcloneFilesStreaming(
  db: Database.Database,
  remoteName: string,
  basePath: string,
  _remoteType: string,
  userId: string,
  _jobId: string,
  onDiscovery: (count: number) => void,
  onBatchReady: (done: number, total: number, fileIds: Array<{ contentHash: string }>) => void
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const remotePrefix = buildRemotePrefix(remoteName, basePath);
  const sourcePrefix = createRcloneSourcePrefix(remoteName, basePath);

  // ── 1. Fast-list: single subprocess call returns all files ──────────────────
  const mediaFiles = await scanRemoteForMediaFastList(`${remotePrefix}`);
  onDiscovery(mediaFiles.length);

  if (mediaFiles.length === 0) return 0;

  // ── 2. Build folder set & file descriptors ───────────────────────────────────
  const scannedFolders = new Set<string>();
  type FileDesc = {
    absolutePath: string;
    relativePathFromRoot: string;
    fileName: string;
    sizeBytes: number;
    mimeType: string | null;
    extension: string | null;
    mediaKind: 'image' | 'video';
    folderRelativePath: string;
    contentHash: string;
    fileKey: string;
    pathId: string;
    pathHash: string;
    folderId: string;
  };

  const fileDescs: FileDesc[] = [];

  for (const remoteFile of mediaFiles) {
    const relInSource = extractRelativePath(remoteFile.path, remotePrefix);
    if (!relInSource) continue;

    const relativePathFromRoot = `${sourcePrefix}/${relInSource}`;
    const fileName = path.basename(relInSource);
    const extension = path.extname(relInSource).toLowerCase() || null;
    const mimeType = (mime.lookup(fileName) || null) as string | null;
    const folderInSource = path.dirname(relInSource) === '.' ? '' : path.dirname(relInSource).replace(/\\/g, '/');
    const folderRelativePath = folderInSource ? `${sourcePrefix}/${folderInSource}` : sourcePrefix;
    const absolutePath = toRcloneAbsolutePath(remotePrefix, relInSource);
    const sizeBytes = remoteFile.size || 0;
    const contentHash = createHash('sha256').update(`${absolutePath}:${sizeBytes}`).digest('hex');
    const fileKey = contentHash.slice(0, 16);
    const pathId = derivePathId(userId, absolutePath);
    const pathHash = createHash('sha256').update(absolutePath).digest('hex');
    const folderId = deriveFolderId(userId, folderRelativePath);

    if (folderInSource) {
      const parts = folderInSource.split('/').filter(Boolean);
      let rolling = '';
      for (const part of parts) {
        rolling = rolling ? `${rolling}/${part}` : part;
        scannedFolders.add(rolling);
      }
    }

    fileDescs.push({ absolutePath, relativePathFromRoot, fileName, sizeBytes, mimeType, extension, mediaKind: remoteFile.type, folderRelativePath, contentHash, fileKey, pathId, pathHash, folderId });
  }

  // ── 3. Write folders in one transaction ─────────────────────────────────────
  const folderRelPaths = new Set<string>([sourcePrefix]);
  for (const f of scannedFolders) folderRelPaths.add(`${sourcePrefix}/${f}`);
  const sortedFolders = Array.from(folderRelPaths).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  const upsertFolder = db.prepare(`
    INSERT INTO folders (id, user_id, parent_folder_id, storage_mode, absolute_path, relative_path_from_root, name, created_at, updated_at)
    VALUES (?, ?, ?, 'rclone', ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, storage_mode, relative_path_from_root) DO UPDATE SET
      parent_folder_id = excluded.parent_folder_id,
      absolute_path = excluded.absolute_path,
      name = excluded.name,
      updated_at = excluded.updated_at
  `);

  const markMissing = db.prepare(`
    UPDATE file_paths SET is_present = 0, last_seen_at = ?, updated_at = ?
    WHERE user_id = ? AND storage_mode = 'rclone' AND relative_path_from_root LIKE ?
  `);

  db.transaction(() => {
    markMissing.run(now, now, userId, `${sourcePrefix}%`);
    for (const relPath of sortedFolders) {
      const parentRel = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : null;
      const relInSource = relPath === sourcePrefix ? '' : relPath.slice(sourcePrefix.length + 1);
      upsertFolder.run(
        deriveFolderId(userId, relPath),
        userId,
        parentRel ? deriveFolderId(userId, parentRel) : null,
        toRcloneAbsolutePath(remotePrefix, relInSource),
        relPath,
        relInSource ? path.basename(relInSource) : `${remotePrefix}`,
        now,
        now
      );
    }
  })();

  // ── 4. Write files in batches as ready ───────────────────────────────────────
  const upsertFile = db.prepare(`
    INSERT INTO files (id, file_key, content_hash, size_bytes, mime_type, extension, media_kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO NOTHING
  `);

  const upsertReadyPath = db.prepare(`
    INSERT INTO file_paths (id, file_id, user_id, folder_id, storage_mode, file_name, absolute_path, relative_path_from_root, path_hash, first_seen_at, last_seen_at, is_present, status, temp_file_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'rclone', ?, ?, ?, ?, ?, ?, 1, 'ready', NULL, ?, ?)
    ON CONFLICT(user_id, absolute_path) DO UPDATE SET
      file_id = excluded.file_id,
      folder_id = excluded.folder_id,
      file_name = excluded.file_name,
      relative_path_from_root = excluded.relative_path_from_root,
      path_hash = excluded.path_hash,
      last_seen_at = excluded.last_seen_at,
      is_present = 1,
      status = 'ready',
      temp_file_id = NULL,
      updated_at = excluded.updated_at
  `);

  // Looks up an existing locally-indexed file that matches by name + size + kind.
  // If found, the rclone path record reuses that file_id so the same content
  // is never surfaced twice in the feed (dedup: local + rclone → single item).
  const findLocalDuplicate = db.prepare<[string, string, number, string], { file_id: string }>(`
    SELECT fp.file_id
    FROM file_paths fp
    JOIN files f ON f.id = fp.file_id
    WHERE fp.user_id = ?
      AND fp.storage_mode = 'local'
      AND fp.file_name = ?
      AND f.size_bytes = ?
      AND f.media_kind = ?
    LIMIT 1
  `);

  const total = fileDescs.length;
  let done = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = fileDescs.slice(i, i + BATCH_SIZE);
    const batchNow = Math.floor(Date.now() / 1000);
    const batchIds: Array<{ contentHash: string }> = [];

    db.transaction(() => {
      for (const file of batch) {
        // Reuse existing local file_id to avoid showing same content twice
        const localMatch = findLocalDuplicate.get(userId, file.fileName, file.sizeBytes, file.mediaKind);
        const fileId = localMatch ? localMatch.file_id : file.contentHash;

        if (!localMatch) {
          upsertFile.run(file.contentHash, file.fileKey, file.contentHash, file.sizeBytes, file.mimeType, file.extension, file.mediaKind, batchNow, batchNow);
        }
        upsertReadyPath.run(file.pathId, fileId, userId, file.folderId, file.fileName, file.absolutePath, file.relativePathFromRoot, file.pathHash, batchNow, batchNow, batchNow, batchNow);
        batchIds.push({ contentHash: fileId });
      }
    })();

    done += batch.length;
    invalidateFeedCache(userId);
    onBatchReady(done, total, batchIds);
  }

  return total;
}
