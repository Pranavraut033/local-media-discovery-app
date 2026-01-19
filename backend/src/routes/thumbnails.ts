/**
 * Thumbnail Routes
 * Handles thumbnail generation and serving
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { getThumbnailService } from '../services/thumbnails.js';
import fs from 'fs/promises';
import path from 'path';

interface ThumbnailQuery {
  size?: 'small' | 'medium' | 'large';
}

export default async function thumbnailRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();
  const thumbnailService = getThumbnailService();

  /**
   * Get thumbnail for a media item
   * Generates on-demand if not cached
   */
  fastify.get<{ Params: { id: string }; Querystring: ThumbnailQuery }>(
    '/api/thumbnail/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: ThumbnailQuery }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      try {
        // Get media info from database
        const media = db
          .prepare('SELECT path, type FROM media WHERE id = ?')
          .get(id) as { path: string; type: string } | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        // Determine media type
        const mediaType = media.type.toLowerCase().startsWith('video') ? 'video' : 'image';

        // Generate or retrieve cached thumbnail
        const thumbnailPath = await thumbnailService.getThumbnail(id, media.path, mediaType);

        // Check thumbnail file exists
        await fs.access(thumbnailPath);

        // Send thumbnail file
        const fileContent = await fs.readFile(thumbnailPath);
        return reply
          .type('image/webp')
          .header('Content-Length', fileContent.length.toString())
          .header('Cache-Control', 'public, max-age=86400')
          .send(fileContent);
      } catch (error) {
        console.error(`Thumbnail generation error for ${id}:`, error);
        return reply.code(500).send({
          error: 'Failed to generate thumbnail',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Batch get thumbnails for multiple media items
   * Useful for feed optimization
   */
  fastify.post<{ Body: { ids: string[] } }>(
    '/api/thumbnails/batch',
    async (request: FastifyRequest<{ Body: { ids: string[] } }>, reply: FastifyReply) => {
      const { ids } = request.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'Invalid request: ids array required' });
      }

      if (ids.length > 100) {
        return reply.code(400).send({
          error: 'Too many IDs: maximum 100 at a time',
        });
      }

      try {
        const results = await Promise.allSettled(
          ids.map(async (id) => {
            const media = db
              .prepare('SELECT path, type FROM media WHERE id = ?')
              .get(id) as { path: string; type: string } | undefined;

            if (!media) {
              return { id, success: false, error: 'Not found' };
            }

            try {
              const mediaType = media.type.toLowerCase().startsWith('video')
                ? 'video'
                : 'image';
              const thumbnailPath = await thumbnailService.getThumbnail(
                id,
                media.path,
                mediaType
              );
              return { id, success: true, thumbnailUrl: `/api/thumbnail/${id}` };
            } catch (error) {
              return {
                id,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          })
        );

        return {
          success: true,
          results: results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason)),
          completed: results.filter((r) => r.status === 'fulfilled').length,
          failed: results.filter((r) => r.status === 'rejected').length,
        };
      } catch (error) {
        console.error('Batch thumbnail error:', error);
        return reply.code(500).send({
          error: 'Batch thumbnail generation failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * Clear thumbnail cache (admin endpoint)
   */
  fastify.post('/api/admin/thumbnails/clear', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await thumbnailService.clearCache();
      return {
        success: true,
        message: 'Thumbnail cache cleared',
      };
    } catch (error) {
      console.error('Clear cache error:', error);
      return reply.code(500).send({
        error: 'Failed to clear cache',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * Get thumbnail cache stats
   */
  fastify.get('/api/admin/thumbnails/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = thumbnailService.getCacheStats();
      return {
        success: true,
        stats,
      };
    } catch (error) {
      console.error('Stats error:', error);
      return reply.code(500).send({
        error: 'Failed to get stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
