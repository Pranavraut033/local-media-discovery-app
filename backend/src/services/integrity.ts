/**
 * File Integrity Service
 * Handles detection and cleanup of missing/moved files
 */
import fs from 'fs/promises';
import { getDatabase } from '../db/index.js';

interface IntegrityCheckResult {
  totalMedia: number;
  validFiles: number;
  missingFiles: number;
  movedFiles: number;
  deletedIds: string[];
  report: {
    timestamp: number;
    duration: number;
    success: boolean;
  };
}

class FileIntegrityService {
  private isRunning = false;
  private lastCheckTime = 0;

  /**
   * Check integrity of all indexed media files
   * Removes records for files that no longer exist
   */
  async checkIntegrity(): Promise<IntegrityCheckResult> {
    if (this.isRunning) {
      throw new Error('Integrity check already in progress');
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const db = getDatabase();

      // Get all media records
      const allMedia = db
        .prepare('SELECT id, path FROM media')
        .all() as Array<{ id: string; path: string }>;

      const result: IntegrityCheckResult = {
        totalMedia: allMedia.length,
        validFiles: 0,
        missingFiles: 0,
        movedFiles: 0,
        deletedIds: [],
        report: {
          timestamp: Date.now(),
          duration: 0,
          success: false,
        },
      };

      // Check each file
      for (const media of allMedia) {
        try {
          const stats = await fs.stat(media.path);

          if (stats.isFile()) {
            result.validFiles++;
          } else {
            // Not a file (might be directory or symlink)
            result.missingFiles++;
            result.deletedIds.push(media.id);
          }
        } catch (error) {
          // File doesn't exist
          result.missingFiles++;
          result.deletedIds.push(media.id);
        }
      }

      // Delete records for missing files
      if (result.deletedIds.length > 0) {
        const stmt = db.prepare('DELETE FROM media WHERE id = ?');
        for (const id of result.deletedIds) {
          stmt.run(id);
        }
      }

      result.report.success = true;
      result.report.duration = Date.now() - startTime;

      console.log(
        `File integrity check completed: ${result.validFiles}/${result.totalMedia} valid, ${result.missingFiles} removed`
      );

      return result;
    } catch (error) {
      console.error('File integrity check failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
      this.lastCheckTime = Date.now();
    }
  }

  /**
   * Clean up orphaned thumbnails (thumbnails without corresponding media)
   */
  async cleanupOrphanedThumbnails(thumbnailDir: string): Promise<number> {
    try {
      const db = getDatabase();

      // Get all media IDs
      const mediaIds = new Set(
        db
          .prepare('SELECT id FROM media')
          .all()
          .map((row: any) => row.id)
      );

      // List thumbnail files
      const files = await fs.readdir(thumbnailDir);
      let deleted = 0;

      for (const file of files) {
        if (file === 'cache.json') continue;

        // Extract media ID from filename (format: {id}.webp)
        const mediaId = file.replace('.webp', '');

        if (!mediaIds.has(mediaId)) {
          // Orphaned thumbnail
          try {
            await fs.unlink(`${thumbnailDir}/${file}`);
            deleted++;
          } catch (error) {
            console.error(`Failed to delete orphaned thumbnail ${file}:`, error);
          }
        }
      }

      console.log(`Cleaned up ${deleted} orphaned thumbnails`);
      return deleted;
    } catch (error) {
      console.error('Thumbnail cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Detect and remove empty/corrupted media records
   */
  async cleanupInvalidRecords(): Promise<number> {
    const db = getDatabase();
    let deleted = 0;

    try {
      // Remove records with null or empty paths
      const result = db.prepare('DELETE FROM media WHERE path IS NULL OR path = ""').run();
      deleted += result.changes;

      // Remove records with invalid types
      const validTypes = ['image', 'video'];
      const invalidResult = db
        .prepare(
          `
          DELETE FROM media 
          WHERE type NOT IN (${validTypes.map(() => '?').join(',')})
        `
        )
        .run(...validTypes);
      deleted += invalidResult.changes;

      if (deleted > 0) {
        console.log(`Cleaned up ${deleted} invalid media records`);
      }

      return deleted;
    } catch (error) {
      console.error('Invalid records cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Get last integrity check time
   */
  getLastCheckTime(): number {
    return this.lastCheckTime;
  }

  /**
   * Check if integrity check is currently running
   */
  isCheckRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get file accessibility for troubleshooting
   */
  async getFileStats(filePath: string): Promise<{
    exists: boolean;
    isFile: boolean;
    isReadable: boolean;
    size: number | null;
    error: string | null;
  }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        exists: true,
        isFile: stats.isFile(),
        isReadable: true,
        size: stats.size,
        error: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        exists: false,
        isFile: false,
        isReadable: false,
        size: null,
        error: errorMessage,
      };
    }
  }
}

// Singleton instance
let integrityService: FileIntegrityService | null = null;

/**
 * Get or create file integrity service instance
 */
export function getFileIntegrityService(): FileIntegrityService {
  if (!integrityService) {
    integrityService = new FileIntegrityService();
  }
  return integrityService;
}
