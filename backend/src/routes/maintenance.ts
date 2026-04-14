/**
 * Maintenance and Admin Routes
 * Handles integrity checks, cache management, and system diagnostics
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { getFileIntegrityService } from '../services/integrity.js';
import { getThumbnailService } from '../services/thumbnails.js';
import { clearAllIndexedDataV2, getV2MediaStats } from '../services/v2-data-maintenance.js';
import { getAllSourcesV2 } from '../services/v2-sources.js';
import fs from 'fs/promises';
import { exec } from 'child_process';

export default async function maintenanceRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();
  const integrityService = getFileIntegrityService();
  const thumbnailService = getThumbnailService();

  /**
   * Health check and system stats
   */
  fastify.get('/api/admin/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const v2Stats = getV2MediaStats(db);

      // Get database file size
      const dbStats = await fs.stat('./.db/media.db').catch(() => null);
      const dbSize = dbStats?.size || 0;

      return {
        success: true,
        status: 'healthy',
        timestamp: Date.now(),
        database: {
          mediaCount: v2Stats.total,
          sourceCount: v2Stats.folderCount,
          sizeBytes: dbSize,
        },
        lastIntegrityCheck: integrityService.getLastCheckTime(),
        integrityCheckRunning: integrityService.isCheckRunning(),
      };
    } catch (error) {
      return reply.code(500).send({
        success: false,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Run file integrity check
   * Detects and removes records for missing/moved files
   */
  fastify.post('/api/admin/integrity/check', async (request: FastifyRequest, reply: FastifyReply) => {
    if (integrityService.isCheckRunning()) {
      return reply.code(409).send({
        error: 'Integrity check already in progress',
      });
    }

    try {
      const result = await integrityService.checkIntegrity();

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      console.error('Integrity check failed:', error);
      return reply.code(500).send({
        error: 'Integrity check failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Clean up invalid database records
   */
  fastify.post('/api/admin/integrity/cleanup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const invalidRecordsRemoved = await integrityService.cleanupInvalidRecords();
      const orphanedThumbnailsRemoved = await integrityService.cleanupOrphanedThumbnails(
        './.thumbnails'
      );

      return {
        success: true,
        invalidRecordsRemoved,
        orphanedThumbnailsRemoved,
        totalRemoved: invalidRecordsRemoved + orphanedThumbnailsRemoved,
      };
    } catch (error) {
      console.error('Cleanup failed:', error);
      return reply.code(500).send({
        error: 'Cleanup failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Get diagnostics for a specific file
   */
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/admin/integrity/file-status',
    async (request: FastifyRequest<{ Querystring: { path?: string } }>, reply: FastifyReply) => {
      const { path } = request.query;

      if (!path) {
        return reply.code(400).send({
          error: 'File path required',
        });
      }

      try {
        const stats = await integrityService.getFileStats(path);
        return {
          success: true,
          path,
          ...stats,
        };
      } catch (error) {
        return reply.code(500).send({
          error: 'Failed to check file status',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Get database statistics and info
   */
  fastify.get('/api/admin/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const mediaStats = getV2MediaStats(db);

      const userId = request.user?.userId;

      if (userId) {
        const rootFolderRow = db
          .prepare(
            `
              SELECT absolute_path AS rootFolder
              FROM folders
              WHERE user_id = ?
                AND storage_mode = 'local'
                AND relative_path_from_root = ''
              ORDER BY updated_at DESC
              LIMIT 1
            `
          )
          .get(userId) as { rootFolder: string } | undefined;

        const userMedia = db
          .prepare(
            `
              SELECT
                COUNT(DISTINCT fp.file_id) as total,
                COUNT(DISTINCT CASE WHEN f.media_kind = 'image' THEN fp.file_id END) as images,
                COUNT(DISTINCT CASE WHEN f.media_kind = 'video' THEN fp.file_id END) as videos,
                COUNT(fp.id) as presentPathCount
              FROM file_paths fp
              JOIN files f ON f.id = fp.file_id
              WHERE fp.user_id = ?
                AND fp.is_present = 1
            `
          )
          .get(userId) as {
          total: number | null;
          images: number | null;
          videos: number | null;
          presentPathCount: number | null;
        };

        const saved = db
          .prepare('SELECT COUNT(*) as count FROM user_saved_files WHERE user_id = ?')
          .get(userId) as { count: number };
        const liked = db
          .prepare('SELECT COUNT(*) as count FROM user_liked_files WHERE user_id = ?')
          .get(userId) as { count: number };
        const hidden = db
          .prepare('SELECT COUNT(*) as count FROM user_hidden_files WHERE user_id = ?')
          .get(userId) as { count: number };

        const sourcesCount = getAllSourcesV2(db, userId).length;

        return {
          success: true,
          media_count: userMedia.total ?? 0,
          sources_count: sourcesCount,
          liked_count: liked.count,
          saved_count: saved.count,
          hidden_count: hidden.count,
          root_folder: rootFolderRow?.rootFolder ?? null,
          media: {
            total: userMedia.total ?? 0,
            images: userMedia.images ?? 0,
            videos: userMedia.videos ?? 0,
            presentPathCount: userMedia.presentPathCount ?? 0,
            likedCount: liked.count,
            savedCount: saved.count,
            hiddenCount: hidden.count,
            folderCount: sourcesCount,
          },
          sources: { count: sourcesCount },
          depthDistribution: [],
        };
      }

      return {
        success: true,
        media_count: mediaStats.total,
        sources_count: mediaStats.folderCount,
        liked_count: mediaStats.likedCount,
        saved_count: mediaStats.savedCount,
        hidden_count: mediaStats.hiddenCount,
        root_folder: null,
        media: mediaStats,
        sources: { count: mediaStats.folderCount },
        depthDistribution: [],
      };
    } catch (error) {
      return reply.code(500).send({
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Reset and reindex everything (destructive operation)
   */
  fastify.post('/api/admin/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      clearAllIndexedDataV2(db);

      // Clear thumbnails
      await thumbnailService.clearCache();

      return {
        success: true,
        message: 'Database reset. Please reindex your media folder.',
      };
    } catch (error) {
      console.error('Reset failed:', error);
      return reply.code(500).send({
        error: 'Reset failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Stop all PM2-managed services
   */
  fastify.post('/api/admin/shutdown', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ success: true, message: 'Stopping all services...' });

    // Defer so the response is flushed before the process is stopped
    setTimeout(() => {
      exec('pm2 stop ecosystem.config.cjs', { cwd: process.cwd().replace(/\/backend$/, '') }, (error) => {
        if (error) {
          console.error('pm2 stop all failed:', error.message);
        }
      });
    }, 200);
  });

  /**
   * Get system diagnostics report
   */
  fastify.get('/api/admin/diagnostics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const mediaStats = getV2MediaStats(db);

      const thumbnailStats = thumbnailService.getCacheStats();
      const lastIntegrityCheck = integrityService.getLastCheckTime();

      return {
        success: true,
        diagnostics: {
          timestamp: Date.now(),
          database: {
            mediaCount: mediaStats.total,
            sourceCount: mediaStats.folderCount,
            savedCount: mediaStats.savedCount,
            likedCount: mediaStats.likedCount,
            hiddenCount: mediaStats.hiddenCount,
            presentPathCount: mediaStats.presentPathCount,
          },
          thumbnails: thumbnailStats,
          system: {
            lastIntegrityCheck,
            integrityCheckRunning: integrityService.isCheckRunning(),
            nodeVersion: process.version,
            platform: process.platform,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
          },
        },
      };
    } catch (error) {
      return reply.code(500).send({
        error: 'Failed to generate diagnostics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
