/**
 * Media Indexing Service
 * Recursively scans and indexes media files from the root folder
 */
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import mime from 'mime-types';
import type Database from 'better-sqlite3';
import { config } from '../config.js';

interface MediaFile {
  id: string;
  path: string;
  sourceId: string;
  depth: number;
  type: 'image' | 'video';
}

interface IndexingResult {
  totalScanned: number;
  newFiles: number;
  removedFiles: number;
  sources: number;
}

/**
 * Generate a stable ID from file path
 */
function generateFileId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').substring(0, 16);
}

/**
 * Determine if a file is a supported media type
 */
function getMediaType(filePath: string): 'image' | 'video' | null {
  const ext = path.extname(filePath).toLowerCase();

  if (config.supportedMedia.images.includes(ext)) {
    return 'image';
  }

  if (config.supportedMedia.videos.includes(ext)) {
    return 'video';
  }

  return null;
}

/**
 * Get the depth of a file relative to the root folder
 */
function getFileDepth(filePath: string, rootFolder: string): number {
  const relative = path.relative(rootFolder, filePath);
  const parts = relative.split(path.sep);
  return parts.length - 1;
}

/**
 * Get the top-level folder (source) for a file path
 */
function getSourceFolder(filePath: string, rootFolder: string): string | null {
  const relative = path.relative(rootFolder, filePath);
  const parts = relative.split(path.sep);

  if (parts.length === 0 || parts[0] === '.') {
    return null;
  }

  return path.join(rootFolder, parts[0]);
}

/**
 * Recursively scan a directory for media files
 */
async function scanDirectory(
  dirPath: string,
  rootFolder: string,
  mediaFiles: MediaFile[]
): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip hidden files and folders
      if (entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        await scanDirectory(fullPath, rootFolder, mediaFiles);
      } else if (entry.isFile()) {
        const mediaType = getMediaType(fullPath);

        if (mediaType) {
          const sourceFolder = getSourceFolder(fullPath, rootFolder);

          if (sourceFolder) {
            mediaFiles.push({
              id: generateFileId(fullPath),
              path: fullPath,
              sourceId: generateFileId(sourceFolder),
              depth: getFileDepth(fullPath, rootFolder),
              type: mediaType,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
}

/**
 * Index media files from a root folder
 */
export async function indexMediaFiles(
  db: Database.Database,
  rootFolder: string
): Promise<IndexingResult> {
  console.log(`Starting indexing of: ${rootFolder}`);

  const startTime = Date.now();
  const mediaFiles: MediaFile[] = [];

  // Scan the root folder recursively
  await scanDirectory(rootFolder, rootFolder, mediaFiles);

  console.log(`Scanned ${mediaFiles.length} media files in ${Date.now() - startTime}ms`);

  // Get existing media paths from database
  const existingMedia = db.prepare('SELECT path FROM media').all() as { path: string }[];
  const existingPaths = new Set(existingMedia.map(m => m.path));

  // Determine new and removed files
  const scannedPaths = new Set(mediaFiles.map(m => m.path));
  const newFiles = mediaFiles.filter(m => !existingPaths.has(m.path));
  const removedPaths = existingMedia.filter(m => !scannedPaths.has(m.path)).map(m => m.path);

  // Remove deleted files from database
  if (removedPaths.length > 0) {
    const deleteStmt = db.prepare('DELETE FROM media WHERE path = ?');
    for (const path of removedPaths) {
      deleteStmt.run(path);
    }
    console.log(`Removed ${removedPaths.length} deleted files from database`);
  }

  // Insert new files into database
  if (newFiles.length > 0) {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO media (id, path, source_id, depth, type)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const file of newFiles) {
      insertStmt.run(file.id, file.path, file.sourceId, file.depth, file.type);
    }

    console.log(`Added ${newFiles.length} new files to database`);
  }

  // Count unique sources
  const sources = db.prepare('SELECT COUNT(DISTINCT source_id) as count FROM media').get() as { count: number };

  console.log(`Indexing complete in ${Date.now() - startTime}ms`);

  return {
    totalScanned: mediaFiles.length,
    newFiles: newFiles.length,
    removedFiles: removedPaths.length,
    sources: sources.count,
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
