/**
 * File Watcher Service
 * Monitors file system for changes and triggers incremental indexing
 */
import chokidar, { type FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config.js';
import { indexMediaFiles } from './indexer.js';
import { generateSources } from './sources.js';
import { createHash } from 'crypto';

interface WatcherOptions {
  rootFolder: string;
  db: Database.Database;
  onIndexComplete?: (result: { added: number; removed: number }) => void;
}

let watcher: FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

/**
 * Generate a stable ID from file path
 */
function generateFileId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').substring(0, 16);
}

/**
 * Generate a stable source ID from folder path
 */
function generateSourceId(folderPath: string): string {
  return createHash('sha256').update(folderPath).digest('hex').substring(0, 16);
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
 * Start watching a root folder for file changes
 */
export function startWatcher(options: WatcherOptions): void {
  const { rootFolder, db, onIndexComplete } = options;

  // Stop existing watcher if any
  stopWatcher();

  console.log(`Starting file watcher for: ${rootFolder}`);

  // Create watcher with appropriate options
  watcher = chokidar.watch(rootFolder, {
    ignored: /(^|[\/\\])\../, // Ignore hidden files
    persistent: true,
    ignoreInitial: true, // Don't trigger events for initial scan
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  // Handle file additions
  watcher.on('add', (filePath: string) => {
    const mediaType = getMediaType(filePath);
    if (!mediaType) return;

    const sourceFolder = getSourceFolder(filePath, rootFolder);
    if (!sourceFolder) return;

    const fileId = generateFileId(filePath);
    const sourceId = generateSourceId(sourceFolder);
    const depth = getFileDepth(filePath, rootFolder);

    // Insert into database
    db.prepare(`
      INSERT OR IGNORE INTO media (id, path, source_id, depth, type)
      VALUES (?, ?, ?, ?, ?)
    `).run(fileId, filePath, sourceId, depth, mediaType);

    console.log(`Added: ${filePath}`);

    if (onIndexComplete) {
      onIndexComplete({ added: 1, removed: 0 });
    }
  });

  // Handle file removals
  watcher.on('unlink', (filePath: string) => {
    const mediaType = getMediaType(filePath);
    if (!mediaType) return;

    // Remove from database
    db.prepare('DELETE FROM media WHERE path = ?').run(filePath);

    console.log(`Removed: ${filePath}`);

    if (onIndexComplete) {
      onIndexComplete({ added: 0, removed: 1 });
    }
  });

  // Handle directory additions (potential new sources)
  watcher.on('addDir', (dirPath: string) => {
    // Check if this is a top-level directory
    const relative = path.relative(rootFolder, dirPath);
    const parts = relative.split(path.sep);

    if (parts.length === 1 && parts[0] !== '.') {
      console.log(`New top-level folder detected: ${dirPath}`);
      // Trigger source regeneration with debounce
      debounceSourceRegeneration(db, rootFolder);
    }
  });

  // Handle directory removals
  watcher.on('unlinkDir', (dirPath: string) => {
    // Check if this was a top-level directory
    const relative = path.relative(rootFolder, dirPath);
    const parts = relative.split(path.sep);

    if (parts.length === 1 && parts[0] !== '.') {
      console.log(`Top-level folder removed: ${dirPath}`);
      // Remove associated source
      const sourceId = generateSourceId(dirPath);
      db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
      db.prepare('DELETE FROM media WHERE source_id = ?').run(sourceId);
    }
  });

  // Handle errors
  watcher.on('error', (error: unknown) => {
    console.error('File watcher error:', error);
  });

  console.log('File watcher started');
}

/**
 * Debounce source regeneration to avoid excessive updates
 */
function debounceSourceRegeneration(db: Database.Database, rootFolder: string): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    try {
      await generateSources(db, rootFolder);
      console.log('Sources regenerated after directory change');
    } catch (error) {
      console.error('Error regenerating sources:', error);
    }
  }, 3000); // Wait 3 seconds for multiple changes
}

/**
 * Stop the file watcher
 */
export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
    console.log('File watcher stopped');
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/**
 * Check if watcher is running
 */
export function isWatcherActive(): boolean {
  return watcher !== null;
}
