/**
 * File Watcher Service
 * Monitors file system for changes and triggers debounced v2 reindexing
 */
import chokidar, { type FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config.js';
import { addSingleFileToIndex, removeFileFromIndex } from './indexer.js';
import { invalidateFeedCache } from './feed.js';

interface WatcherOptions {
  rootFolder: string;
  userId: string;
  db: Database.Database;
  onIndexComplete?: (result: { added: number; removed: number }) => void;
}

let watcher: FSWatcher | null = null;

function getMediaType(filePath: string): 'image' | 'video' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (config.supportedMedia.images.includes(ext)) return 'image';
  if (config.supportedMedia.videos.includes(ext)) return 'video';
  return null;
}

/**
 * Start watching a root folder for file changes
 */
export function startWatcher(options: WatcherOptions): void {
  const { rootFolder, userId, db, onIndexComplete } = options;

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

  // ponytail: surgical per-file ops — was a full library rescan on every event
  watcher.on('add', (filePath: string) => {
    if (!getMediaType(filePath)) return;
    void addSingleFileToIndex(db, rootFolder, userId, filePath).then((indexed) => {
      if (indexed) {
        invalidateFeedCache(userId);
        onIndexComplete?.({ added: 1, removed: 0 });
      }
    });
  });

  watcher.on('change', (filePath: string) => {
    if (!getMediaType(filePath)) return;
    void addSingleFileToIndex(db, rootFolder, userId, filePath).then((indexed) => {
      if (indexed) invalidateFeedCache(userId);
    });
  });

  watcher.on('unlink', (filePath: string) => {
    if (!getMediaType(filePath)) return;
    const removed = removeFileFromIndex(db, userId, filePath);
    if (removed) {
      invalidateFeedCache(userId);
      onIndexComplete?.({ added: 0, removed: 1 });
    }
  });

  // Directory events: file add/unlink events fire for contents — nothing extra needed.
  watcher.on('unlinkDir', (dirPath: string) => {
    if (dirPath === rootFolder) return;
    // Mark all paths under this dir absent in one query
    const now = Math.floor(Date.now() / 1000);
    const changes = db.prepare(
      `UPDATE file_paths SET is_present = 0, updated_at = ? WHERE user_id = ? AND absolute_path LIKE ?`
    ).run(now, userId, `${dirPath}${path.sep}%`).changes;
    if (changes > 0) invalidateFeedCache(userId);
  });

  // Handle errors
  watcher.on('error', (error: unknown) => {
    console.error('File watcher error:', error);
  });

  console.log('File watcher started');
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
}

/**
 * Check if watcher is running
 */
export function isWatcherActive(): boolean {
  return watcher !== null;
}
