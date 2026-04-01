/**
 * File Watcher Service
 * Monitors file system for changes and triggers debounced v2 reindexing
 */
import chokidar, { type FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import path from 'path';
import { config } from '../config.js';
import { indexMediaFiles } from './indexer.js';

interface WatcherOptions {
  rootFolder: string;
  userId: string;
  db: Database.Database;
  onIndexComplete?: (result: { added: number; removed: number }) => void;
}

let watcher: FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let reindexInProgress = false;
let reindexQueued = false;

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

async function runReindex(
  db: Database.Database,
  rootFolder: string,
  userId: string,
  onIndexComplete?: (result: { added: number; removed: number }) => void
): Promise<void> {
  if (reindexInProgress) {
    reindexQueued = true;
    return;
  }

  reindexInProgress = true;
  try {
    const result = await indexMediaFiles(db, rootFolder, userId);
    if (onIndexComplete) {
      onIndexComplete({
        added: result.newFiles,
        removed: result.removedFiles,
      });
    }
  } catch (error) {
    console.error('Watcher reindex error:', error);
  } finally {
    reindexInProgress = false;
    if (reindexQueued) {
      reindexQueued = false;
      await runReindex(db, rootFolder, userId, onIndexComplete);
    }
  }
}

function debounceReindex(
  db: Database.Database,
  rootFolder: string,
  userId: string,
  onIndexComplete?: (result: { added: number; removed: number }) => void
): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    void runReindex(db, rootFolder, userId, onIndexComplete);
  }, 1500);
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

  // Handle file additions
  watcher.on('add', (filePath: string) => {
    const mediaType = getMediaType(filePath);
    if (!mediaType) return;

    console.log(`Detected add: ${filePath}`);
    debounceReindex(db, rootFolder, userId, onIndexComplete);
  });

  // Handle file removals
  watcher.on('unlink', (filePath: string) => {
    const mediaType = getMediaType(filePath);
    if (!mediaType) return;

    console.log(`Detected remove: ${filePath}`);
    debounceReindex(db, rootFolder, userId, onIndexComplete);
  });

  watcher.on('change', (filePath: string) => {
    const mediaType = getMediaType(filePath);
    if (!mediaType) return;

    console.log(`Detected change: ${filePath}`);
    debounceReindex(db, rootFolder, userId, onIndexComplete);
  });

  // Handle directory additions/removals
  watcher.on('addDir', (dirPath: string) => {
    if (dirPath === rootFolder) {
      return;
    }

    console.log(`Detected directory add: ${dirPath}`);
    debounceReindex(db, rootFolder, userId, onIndexComplete);
  });

  watcher.on('unlinkDir', (dirPath: string) => {
    if (dirPath === rootFolder) {
      return;
    }

    console.log(`Detected directory remove: ${dirPath}`);
    debounceReindex(db, rootFolder, userId, onIndexComplete);
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

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  reindexInProgress = false;
  reindexQueued = false;
}

/**
 * Check if watcher is running
 */
export function isWatcherActive(): boolean {
  return watcher !== null;
}
