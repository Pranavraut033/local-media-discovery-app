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
      const now = Math.floor(Date.now() / 1000);

      // Check all currently-present file paths across users.
      const allPaths = db
        .prepare('SELECT id, file_id, absolute_path FROM file_paths WHERE is_present = 1')
        .all() as Array<{ id: string; file_id: string; absolute_path: string }>;

      const result: IntegrityCheckResult = {
        totalMedia: allPaths.length,
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

      // Check each file path on disk.
      const missingPathIds: string[] = [];
      const missingFileIds = new Set<string>();

      for (const media of allPaths) {
        try {
          const stats = await fs.stat(media.absolute_path);

          if (stats.isFile()) {
            result.validFiles++;
          } else {
            result.missingFiles++;
            missingPathIds.push(media.id);
            missingFileIds.add(media.file_id);
          }
        } catch (error) {
          result.missingFiles++;
          missingPathIds.push(media.id);
          missingFileIds.add(media.file_id);
        }
      }

      // Mark missing paths as no longer present.
      if (missingPathIds.length > 0) {
        const markMissingStmt = db.prepare(
          'UPDATE file_paths SET is_present = 0, last_seen_at = ?, updated_at = ? WHERE id = ?'
        );

        const tx = db.transaction(() => {
          for (const id of missingPathIds) {
            markMissingStmt.run(now, now, id);
          }

          // Remove canonical files that are no longer referenced by any path.
          db.prepare('DELETE FROM files WHERE id NOT IN (SELECT DISTINCT file_id FROM file_paths)').run();
        });

        tx();
      }

      result.deletedIds = Array.from(missingFileIds);

      if (result.totalMedia > 0) {
        result.report.success = true;
      } else {
        // Empty DB is still a successful integrity check.
        result.report.success = true;
      }

      result.report.duration = Date.now() - startTime;

      console.log(
        `File integrity check completed: ${result.validFiles}/${result.totalMedia} valid, ${result.missingFiles} marked missing`
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
   * Clean up orphaned thumbnails (thumbnails without corresponding files)
   */
  async cleanupOrphanedThumbnails(thumbnailDir: string): Promise<number> {
    try {
      const db = getDatabase();

      const mediaIds = new Set(
        db
          .prepare('SELECT id FROM files')
          .all()
          .map((row: any) => row.id)
      );

      const files = await fs.readdir(thumbnailDir);
      let deleted = 0;

      for (const file of files) {
        if (file === 'cache.json') continue;

        const mediaId = file.replace('.webp', '');

        if (!mediaIds.has(mediaId)) {
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
   * Detect and remove empty/corrupted records in schema v2.
   */
  async cleanupInvalidRecords(): Promise<number> {
    const db = getDatabase();
    let deleted = 0;

    try {
      const invalidPaths = db
        .prepare('DELETE FROM file_paths WHERE absolute_path IS NULL OR absolute_path = ""')
        .run();
      deleted += invalidPaths.changes;

      const validKinds = ['image', 'video', 'other'];
      const invalidFiles = db
        .prepare(
          `
          DELETE FROM files
          WHERE media_kind NOT IN (${validKinds.map(() => '?').join(',')})
        `
        )
        .run(...validKinds);
      deleted += invalidFiles.changes;

      // Remove any file records left without path references.
      const orphans = db
        .prepare('DELETE FROM files WHERE id NOT IN (SELECT DISTINCT file_id FROM file_paths)')
        .run();
      deleted += orphans.changes;

      if (deleted > 0) {
        console.log(`Cleaned up ${deleted} invalid v2 records`);
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
