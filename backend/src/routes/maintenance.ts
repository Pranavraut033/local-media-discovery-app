/**
 * Maintenance and Admin Routes
 * Handles integrity checks, cache management, and system diagnostics
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { getFileIntegrityService } from '../services/integrity.js';
import { getThumbnailService } from '../services/thumbnails.js';
import fs from 'fs/promises';

export default async function maintenanceRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();
  const integrityService = getFileIntegrityService();
  const thumbnailService = getThumbnailService();

  /**
   * Health check and system stats
   */
  fastify.get('/api/admin/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Count media and sources
      const mediaCount = (
        db.prepare('SELECT COUNT(*) as count FROM media').get() as { count: number }
      ).count;
      const sourceCount = (
        db.prepare('SELECT COUNT(*) as count FROM sources').get() as { count: number }
      ).count;

      // Get database file size
      const dbStats = await fs.stat('./.db/media.db').catch(() => null);
      const dbSize = dbStats?.size || 0;

      return {
        success: true,
        status: 'healthy',
        timestamp: Date.now(),
        database: {
          mediaCount,
          sourceCount,
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
      // Media stats
      const mediaStats = db
        .prepare(
          `
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN type LIKE 'image%' THEN 1 ELSE 0 END) as images,
            SUM(CASE WHEN type LIKE 'video%' THEN 1 ELSE 0 END) as videos,
            SUM(liked) as likedCount,
            SUM(saved) as savedCount,
            AVG(view_count) as avgViewCount,
            MAX(view_count) as maxViewCount
          FROM media
        `
        )
        .get() as {
          total: number;
          images: number;
          videos: number;
          likedCount: number;
          savedCount: number;
          avgViewCount: number;
          maxViewCount: number;
        };

      // Source stats
      const sourceStats = db
        .prepare('SELECT COUNT(*) as count FROM sources')
        .get() as { count: number };

      // Depth distribution
      const depthDist = db
        .prepare(
          `
          SELECT depth, COUNT(*) as count
          FROM media
          GROUP BY depth
          ORDER BY depth ASC
        `
        )
        .all() as Array<{ depth: number; count: number }>;

      return {
        success: true,
        media: mediaStats,
        sources: { count: sourceStats.count },
        depthDistribution: depthDist,
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
      // Clear media table
      db.prepare('DELETE FROM media').run();

      // Clear sources table
      db.prepare('DELETE FROM sources').run();

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
   * Get system diagnostics report
   */
  fastify.get('/api/admin/diagnostics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get all stats
      const mediaCount = (
        db.prepare('SELECT COUNT(*) as count FROM media').get() as { count: number }
      ).count;
      const sourceCount = (
        db.prepare('SELECT COUNT(*) as count FROM sources').get() as { count: number }
      ).count;
      const savedCount = (
        db.prepare('SELECT COUNT(*) as count FROM media WHERE saved = 1').get() as {
          count: number;
        }
      ).count;
      const likedCount = (
        db.prepare('SELECT COUNT(*) as count FROM media WHERE liked = 1').get() as {
          count: number;
        }
      ).count;

      const thumbnailStats = thumbnailService.getCacheStats();
      const lastIntegrityCheck = integrityService.getLastCheckTime();

      return {
        success: true,
        diagnostics: {
          timestamp: Date.now(),
          database: {
            mediaCount,
            sourceCount,
            savedCount,
            likedCount,
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
