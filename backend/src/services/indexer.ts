/**
 * Media Indexing Service (Schema v2)
 * Recursively scans and indexes media files into files/file_paths/folders.
 */
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import mime from 'mime-types';
import type Database from 'better-sqlite3';
import { config } from '../config.js';

interface ScannedFile {
  absolutePath: string;
  relativePathFromRoot: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
  extension: string | null;
  mediaKind: 'image' | 'video';
  contentHash: string;
  fileKey: string;
  folderRelativePath: string;
}

interface FolderRecord {
  id: string;
  userId: string;
  parentFolderId: string | null;
  storageMode: 'local';
  absolutePath: string;
  relativePathFromRoot: string;
  name: string;
}

interface IndexingResult {
  totalScanned: number;
  newFiles: number;
  removedFiles: number;
  sources: number;
}

function normalizeRelativePath(relativePath: string): string {
  if (!relativePath || relativePath === '.') {
    return '';
  }
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function deriveFolderId(userId: string, relativePathFromRoot: string): string {
  return createHash('sha256')
    .update(`folder:${userId}:local:${relativePathFromRoot}`)
    .digest('hex')
    .slice(0, 32);
}

function derivePathId(userId: string, absolutePath: string): string {
  return createHash('sha256')
    .update(`path:${userId}:local:${absolutePath}`)
    .digest('hex')
    .slice(0, 32);
}

function getMediaKind(filePath: string): 'image' | 'video' | null {
  const ext = path.extname(filePath).toLowerCase();

  if (config.supportedMedia.images.includes(ext)) {
    return 'image';
  }

  if (config.supportedMedia.videos.includes(ext)) {
    return 'video';
  }

  return null;
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fssync.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function scanDirectory(
  rootFolder: string,
  dirPath: string,
  files: ScannedFile[],
  folders: Set<string>
): Promise<void> {
  let entries: fssync.Dirent<string>[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true, encoding: 'utf8' });
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      folders.add(fullPath);
      await scanDirectory(rootFolder, fullPath, files, folders);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const mediaKind = getMediaKind(fullPath);
    if (!mediaKind) {
      continue;
    }

    try {
      const stats = await fs.stat(fullPath);
      const relativePathFromRoot = normalizeRelativePath(path.relative(rootFolder, fullPath));
      const fileName = path.basename(fullPath);
      const extension = path.extname(fullPath).toLowerCase() || null;
      const mimeType = (mime.lookup(fullPath) || null) as string | null;
      const contentHash = await hashFile(fullPath);

      files.push({
        absolutePath: fullPath,
        relativePathFromRoot,
        fileName,
        sizeBytes: stats.size,
        mimeType,
        extension,
        mediaKind,
        contentHash,
        fileKey: contentHash.slice(0, 16),
        folderRelativePath: normalizeRelativePath(path.dirname(relativePathFromRoot)),
      });
    } catch (error) {
      console.error(`Error processing file ${fullPath}:`, error);
    }
  }
}

function buildFolderRecords(userId: string, rootFolder: string, scannedFolders: Set<string>): FolderRecord[] {
  const relativePaths = new Set<string>();
  relativePaths.add('');

  for (const folderAbsPath of scannedFolders) {
    const relative = normalizeRelativePath(path.relative(rootFolder, folderAbsPath));
    if (relative) {
      relativePaths.add(relative);
    }
  }

  const sorted = Array.from(relativePaths).sort((a, b) => {
    const aDepth = a === '' ? 0 : a.split('/').length;
    const bDepth = b === '' ? 0 : b.split('/').length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.localeCompare(b);
  });

  return sorted.map((relativePathFromRoot) => {
    const parentRelative = relativePathFromRoot === ''
      ? null
      : normalizeRelativePath(path.dirname(relativePathFromRoot));
    const parentFolderId = parentRelative === null ? null : deriveFolderId(userId, parentRelative);

    return {
      id: deriveFolderId(userId, relativePathFromRoot),
      userId,
      parentFolderId,
      storageMode: 'local',
      absolutePath: relativePathFromRoot === '' ? rootFolder : path.join(rootFolder, relativePathFromRoot),
      relativePathFromRoot,
      name: relativePathFromRoot === ''
        ? (path.basename(rootFolder) || 'root')
        : path.basename(relativePathFromRoot),
    };
  });
}

function countSources(files: ScannedFile[]): number {
  const sourceIds = new Set<string>();
  for (const file of files) {
    const rel = file.relativePathFromRoot;
    const parts = rel.split('/').filter(Boolean);
    sourceIds.add(parts.length <= 1 ? 'root' : parts[0]);
  }
  return sourceIds.size;
}

export async function indexMediaFiles(
  db: Database.Database,
  rootFolder: string,
  userId?: string
): Promise<IndexingResult> {
  if (!userId) {
    throw new Error('Indexing requires an authenticated user context');
  }

  const now = Math.floor(Date.now() / 1000);
  const scannedFiles: ScannedFile[] = [];
  const scannedFolders = new Set<string>();

  await scanDirectory(rootFolder, rootFolder, scannedFiles, scannedFolders);
  const folderRecords = buildFolderRecords(userId, rootFolder, scannedFolders);

  const previouslyPresent = db
    .prepare('SELECT absolute_path FROM file_paths WHERE user_id = ? AND storage_mode = ? AND is_present = 1')
    .all(userId, 'local') as Array<{ absolute_path: string }>;
  const previousPaths = new Set(previouslyPresent.map((row) => row.absolute_path));
  const currentPaths = new Set(scannedFiles.map((f) => f.absolutePath));

  const newFilesCount = scannedFiles.reduce((count, file) => (
    previousPaths.has(file.absolutePath) ? count : count + 1
  ), 0);
  const removedFilesCount = previouslyPresent.reduce((count, row) => (
    currentPaths.has(row.absolute_path) ? count : count + 1
  ), 0);

  const upsertStorageConfig = db.prepare(`
    INSERT INTO user_storage_configs (id, user_id, local_root_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      local_root_path = excluded.local_root_path,
      updated_at = excluded.updated_at
  `);

  const markAllMissing = db.prepare(`
    UPDATE file_paths
    SET is_present = 0,
        last_seen_at = ?,
        updated_at = ?
    WHERE user_id = ? AND storage_mode = ?
  `);

  const upsertFolder = db.prepare(`
    INSERT INTO folders (
      id,
      user_id,
      parent_folder_id,
      storage_mode,
      absolute_path,
      relative_path_from_root,
      name,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, storage_mode, relative_path_from_root) DO UPDATE SET
      parent_folder_id = excluded.parent_folder_id,
      absolute_path = excluded.absolute_path,
      name = excluded.name,
      updated_at = excluded.updated_at
  `);

  const upsertFile = db.prepare(`
    INSERT INTO files (
      id,
      file_key,
      content_hash,
      size_bytes,
      mime_type,
      extension,
      media_kind,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO UPDATE SET
      file_key = excluded.file_key,
      size_bytes = excluded.size_bytes,
      mime_type = excluded.mime_type,
      extension = excluded.extension,
      media_kind = excluded.media_kind,
      updated_at = excluded.updated_at
  `);

  const upsertFilePath = db.prepare(`
    INSERT INTO file_paths (
      id,
      file_id,
      user_id,
      folder_id,
      storage_mode,
      file_name,
      absolute_path,
      relative_path_from_root,
      path_hash,
      first_seen_at,
      last_seen_at,
      is_present,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(user_id, absolute_path) DO UPDATE SET
      file_id = excluded.file_id,
      folder_id = excluded.folder_id,
      file_name = excluded.file_name,
      relative_path_from_root = excluded.relative_path_from_root,
      path_hash = excluded.path_hash,
      last_seen_at = excluded.last_seen_at,
      is_present = 1,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction(() => {
    const storageConfigId = createHash('sha256')
      .update(`storage:${userId}`)
      .digest('hex')
      .slice(0, 32);

    upsertStorageConfig.run(storageConfigId, userId, rootFolder, now, now);
    markAllMissing.run(now, now, userId, 'local');

    for (const folder of folderRecords) {
      upsertFolder.run(
        folder.id,
        folder.userId,
        folder.parentFolderId,
        folder.storageMode,
        folder.absolutePath,
        folder.relativePathFromRoot,
        folder.name,
        now,
        now
      );
    }

    for (const file of scannedFiles) {
      const fileId = file.contentHash;
      upsertFile.run(
        fileId,
        file.fileKey,
        file.contentHash,
        file.sizeBytes,
        file.mimeType,
        file.extension,
        file.mediaKind,
        now,
        now
      );

      const folderId = deriveFolderId(userId, file.folderRelativePath);
      const pathHash = createHash('sha256').update(file.absolutePath).digest('hex');

      upsertFilePath.run(
        derivePathId(userId, file.absolutePath),
        fileId,
        userId,
        folderId,
        'local',
        file.fileName,
        file.absolutePath,
        file.relativePathFromRoot,
        pathHash,
        now,
        now,
        now,
        now
      );
    }
  });

  tx();

  return {
    totalScanned: scannedFiles.length,
    newFiles: newFilesCount,
    removedFiles: removedFilesCount,
    sources: countSources(scannedFiles),
  };
}

/**
 * Check if a file still exists on disk
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pending-first pipeline (used by BullMQ worker)
// ---------------------------------------------------------------------------

export interface PendingLocalFile {
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
}

function makeTempFileId(absolutePath: string): string {
  return 'p' + createHash('sha256').update(absolutePath).digest('hex').slice(0, 31);
}

/**
 * Fast directory scan that creates pending file_paths immediately (no hashing).
 * Returns the list of pending file descriptors for subsequent finalization.
 */
export async function discoverAndCreatePendingLocal(
  db: Database.Database,
  rootFolder: string,
  userId: string,
  _jobId: string,
  onProgress: (count: number) => void
): Promise<PendingLocalFile[]> {
  const now = Math.floor(Date.now() / 1000);
  const scannedFiles: Array<{
    absolutePath: string;
    relativePathFromRoot: string;
    fileName: string;
    sizeBytes: number;
    mimeType: string | null;
    extension: string | null;
    mediaKind: 'image' | 'video';
    folderRelativePath: string;
  }> = [];
  const scannedFolders = new Set<string>();

  // Re-use internal scan (without hashing)
  await scanDirectoryMeta(rootFolder, rootFolder, scannedFiles, scannedFolders);
  const folderRecords = buildFolderRecords(userId, rootFolder, scannedFolders);

  const upsertStorageConfig = db.prepare(`
    INSERT INTO user_storage_configs (id, user_id, local_root_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      local_root_path = excluded.local_root_path,
      updated_at = excluded.updated_at
  `);

  const markAllMissing = db.prepare(`
    UPDATE file_paths SET is_present = 0, last_seen_at = ?, updated_at = ?
    WHERE user_id = ? AND storage_mode = 'local'
  `);

  const upsertFolder = db.prepare(`
    INSERT INTO folders (id, user_id, parent_folder_id, storage_mode, absolute_path, relative_path_from_root, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, storage_mode, relative_path_from_root) DO UPDATE SET
      parent_folder_id = excluded.parent_folder_id,
      absolute_path = excluded.absolute_path,
      name = excluded.name,
      updated_at = excluded.updated_at
  `);

  const upsertTempFile = db.prepare(`
    INSERT INTO files (id, file_key, content_hash, size_bytes, mime_type, extension, media_kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO NOTHING
  `);

  const upsertPendingPath = db.prepare(`
    INSERT INTO file_paths (id, file_id, user_id, folder_id, storage_mode, file_name, absolute_path, relative_path_from_root, path_hash, first_seen_at, last_seen_at, is_present, status, temp_file_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?)
    ON CONFLICT(user_id, absolute_path) DO UPDATE SET
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

  const pendingFiles: PendingLocalFile[] = [];

  const tx = db.transaction(() => {
    const storageConfigId = createHash('sha256').update(`storage:${userId}`).digest('hex').slice(0, 32);
    upsertStorageConfig.run(storageConfigId, userId, rootFolder, now, now);
    markAllMissing.run(now, now, userId);

    for (const folder of folderRecords) {
      upsertFolder.run(folder.id, folder.userId, folder.parentFolderId, folder.storageMode, folder.absolutePath, folder.relativePathFromRoot, folder.name, now, now);
    }

    for (const file of scannedFiles) {
      const tempId = makeTempFileId(file.absolutePath);
      const tempHash = tempId; // content_hash mirrors id for temp records
      const folderId = deriveFolderId(userId, file.folderRelativePath);
      const pathId = derivePathId(userId, file.absolutePath);
      const pathHash = createHash('sha256').update(file.absolutePath).digest('hex');

      upsertTempFile.run(tempId, `t${tempId.slice(1, 15)}`, tempHash, file.sizeBytes, file.mimeType, file.extension, file.mediaKind, now, now);
      upsertPendingPath.run(pathId, tempId, userId, folderId, file.fileName, file.absolutePath, file.relativePathFromRoot, pathHash, now, now, tempId, now, now);

      pendingFiles.push({ tempFileId: tempId, pathId, ...file });
    }
  });

  tx();
  onProgress(pendingFiles.length);
  return pendingFiles;
}

/**
 * Hash each pending file and reconcile temp IDs to real content hashes.
 */
export async function finalizeLocalPendingFiles(
  db: Database.Database,
  pending: PendingLocalFile[],
  userId: string,
  _jobId: string,
  onProgress: (done: number, total: number, tempId: string, finalId: string) => void
): Promise<void> {
  const total = pending.length;

  for (let i = 0; i < pending.length; i++) {
    const file = pending[i];

    let contentHash: string;
    try {
      contentHash = await hashFile(file.absolutePath);
    } catch {
      // File disappeared between discovery and finalization – mark as missing
      db.prepare(`UPDATE file_paths SET is_present = 0, status = 'ready', updated_at = ? WHERE id = ?`)
        .run(Math.floor(Date.now() / 1000), file.pathId);
      onProgress(i + 1, total, file.tempFileId, '');
      continue;
    }

    reconcilePendingToFinal(db, file, contentHash);
    onProgress(i + 1, total, file.tempFileId, contentHash);
  }
}

function reconcilePendingToFinal(db: Database.Database, file: PendingLocalFile, contentHash: string): void {
  const now = Math.floor(Date.now() / 1000);
  const fileKey = contentHash.slice(0, 16);

  const tx = db.transaction(() => {
    // Check if real file already exists (deduplication)
    const existing = db.prepare('SELECT id FROM files WHERE content_hash = ?').get(contentHash) as { id: string } | undefined;

    if (existing && existing.id !== file.tempFileId) {
      // Real file already exists (deduplicated). Re-home interactions and path pointer.
      const realId = existing.id;
      db.prepare(`UPDATE user_liked_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
      db.prepare(`UPDATE user_saved_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
      db.prepare(`UPDATE user_hidden_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
      db.prepare(`UPDATE file_paths SET file_id = ?, status = 'ready', temp_file_id = NULL, updated_at = ? WHERE id = ?`)
        .run(realId, now, file.pathId);
      db.prepare(`DELETE FROM files WHERE id = ?`).run(file.tempFileId);
    } else if (existing && existing.id === file.tempFileId) {
      // Temp record IS the real record (hash coincided) – just mark ready.
      db.prepare(`UPDATE files SET file_key = ?, content_hash = ?, updated_at = ? WHERE id = ?`)
        .run(fileKey, contentHash, now, file.tempFileId);
      db.prepare(`UPDATE file_paths SET status = 'ready', temp_file_id = NULL, updated_at = ? WHERE id = ?`)
        .run(now, file.pathId);
    } else {
      // Temp file exists, real hash is new – insert real record and migrate.
      db.prepare(
        `INSERT INTO files (id, file_key, content_hash, size_bytes, mime_type, extension, media_kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO NOTHING`
      ).run(contentHash, fileKey, contentHash, file.sizeBytes, file.mimeType, file.extension, file.mediaKind, now, now);

      const realId = contentHash;
      db.prepare(`UPDATE user_liked_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
      db.prepare(`UPDATE user_saved_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
      db.prepare(`UPDATE user_hidden_files SET file_id = ? WHERE file_id = ?`).run(realId, file.tempFileId);
      db.prepare(`UPDATE file_paths SET file_id = ?, status = 'ready', temp_file_id = NULL, updated_at = ? WHERE id = ?`)
        .run(realId, now, file.pathId);
      db.prepare(`DELETE FROM files WHERE id = ?`).run(file.tempFileId);
    }
  });

  tx();
}

/**
 * Scan directory collecting only metadata (no hashing).
 */
async function scanDirectoryMeta(
  rootFolder: string,
  dirPath: string,
  files: Array<{
    absolutePath: string;
    relativePathFromRoot: string;
    fileName: string;
    sizeBytes: number;
    mimeType: string | null;
    extension: string | null;
    mediaKind: 'image' | 'video';
    folderRelativePath: string;
  }>,
  folders: Set<string>
): Promise<void> {
  let entries: fssync.Dirent<string>[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      folders.add(fullPath);
      await scanDirectoryMeta(rootFolder, fullPath, files, folders);
      continue;
    }

    if (!entry.isFile()) continue;

    const mediaKind = getMediaKind(fullPath);
    if (!mediaKind) continue;

    try {
      const stats = await fs.stat(fullPath);
      const relativePathFromRoot = normalizeRelativePath(path.relative(rootFolder, fullPath));
      const fileName = path.basename(fullPath);
      const extension = path.extname(fullPath).toLowerCase() || null;
      const mimeType = (mime.lookup(fullPath) || null) as string | null;

      files.push({
        absolutePath: fullPath,
        relativePathFromRoot,
        fileName,
        sizeBytes: stats.size,
        mimeType,
        extension,
        mediaKind,
        folderRelativePath: normalizeRelativePath(path.dirname(relativePathFromRoot)),
      });
    } catch {
      // Skip unreadable files
    }
  }
}
