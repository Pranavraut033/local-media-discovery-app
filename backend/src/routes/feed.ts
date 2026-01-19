/**
 * Feed and Interaction Routes
 * Handles feed generation, likes, saves, and view tracking
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { generatePaginatedFeed } from '../services/feed.js';
import fs from 'fs/promises';
import path from 'path';

interface FeedQuery {
  page?: string;
  limit?: string;
  lastSourceId?: string;
}

interface InteractionBody {
  mediaId: string;
}

export default async function feedRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  // Get paginated feed
  fastify.get<{ Querystring: FeedQuery }>(
    '/api/feed',
    async (request: FastifyRequest<{ Querystring: FeedQuery }>, reply: FastifyReply) => {
      try {
        const page = parseInt(request.query.page || '0', 10);
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100); // Max 100
        const lastSourceId = request.query.lastSourceId;

        const feedData = generatePaginatedFeed(db, page, limit, lastSourceId);

        return {
          success: true,
          feed: feedData.items,
          page: feedData.page,
          hasMore: feedData.hasMore,
          limit,
        };
      } catch (error) {
        console.error('Feed error:', error);
        return reply.code(500).send({
          error: 'Failed to generate feed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get media from a specific source
  fastify.get<{ Params: { sourceId: string }; Querystring: { limit?: string } }>(
    '/api/source/:sourceId/media',
    async (
      request: FastifyRequest<{ Params: { sourceId: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      const { sourceId } = request.params;
      const limit = Math.min(parseInt(request.query.limit || '50', 10), 200);

      try {
        const mediaItems = db
          .prepare(
            `
          SELECT 
            m.id,
            m.path,
            m.type,
            m.source_id as sourceId,
            m.liked,
            m.saved,
            m.view_count as viewCount,
            m.last_viewed as lastViewed,
            m.depth,
            s.display_name as displayName,
            s.avatar_seed as avatarSeed
          FROM media m
          JOIN sources s ON m.source_id = s.id
          WHERE m.source_id = ?
          ORDER BY RANDOM()
          LIMIT ?
        `
          )
          .all(sourceId, limit) as Array<{
            id: string;
            path: string;
            type: string;
            sourceId: string;
            liked: number;
            saved: number;
            viewCount: number;
            lastViewed: number | null;
            depth: number;
            displayName: string;
            avatarSeed: string;
          }>;

        return {
          success: true,
          media: mediaItems.map((m) => ({
            id: m.id,
            path: m.path,
            type: m.type,
            sourceId: m.sourceId,
            displayName: m.displayName,
            avatarSeed: m.avatarSeed,
            liked: m.liked === 1,
            saved: m.saved === 1,
            viewCount: m.viewCount,
            lastViewed: m.lastViewed,
            depth: m.depth,
          })),
          count: mediaItems.length,
        };
      } catch (error) {
        console.error('Get source media error:', error);
        return reply.code(500).send({
          error: 'Failed to get source media',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Like a media item
  fastify.post<{ Body: InteractionBody }>(
    '/api/like',
    async (request: FastifyRequest<{ Body: InteractionBody }>, reply: FastifyReply) => {
      const { mediaId } = request.body;

      if (!mediaId || typeof mediaId !== 'string') {
        return reply.code(400).send({ error: 'Invalid media ID' });
      }

      try {
        // Toggle like status
        const media = db.prepare('SELECT liked FROM media WHERE id = ?').get(mediaId) as {
          liked: number;
        } | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        const newLikedStatus = media.liked === 1 ? 0 : 1;
        db.prepare('UPDATE media SET liked = ? WHERE id = ?').run(newLikedStatus, mediaId);

        return {
          success: true,
          mediaId,
          liked: newLikedStatus === 1,
        };
      } catch (error) {
        console.error('Like error:', error);
        return reply.code(500).send({
          error: 'Failed to update like status',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Save a media item
  fastify.post<{ Body: InteractionBody }>(
    '/api/save',
    async (request: FastifyRequest<{ Body: InteractionBody }>, reply: FastifyReply) => {
      const { mediaId } = request.body;

      if (!mediaId || typeof mediaId !== 'string') {
        return reply.code(400).send({ error: 'Invalid media ID' });
      }

      try {
        // Toggle save status
        const media = db.prepare('SELECT saved FROM media WHERE id = ?').get(mediaId) as {
          saved: number;
        } | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        const newSavedStatus = media.saved === 1 ? 0 : 1;
        db.prepare('UPDATE media SET saved = ? WHERE id = ?').run(newSavedStatus, mediaId);

        return {
          success: true,
          mediaId,
          saved: newSavedStatus === 1,
        };
      } catch (error) {
        console.error('Save error:', error);
        return reply.code(500).send({
          error: 'Failed to update save status',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Record a view
  fastify.post<{ Body: InteractionBody }>(
    '/api/view',
    async (request: FastifyRequest<{ Body: InteractionBody }>, reply: FastifyReply) => {
      const { mediaId } = request.body;

      if (!mediaId || typeof mediaId !== 'string') {
        return reply.code(400).send({ error: 'Invalid media ID' });
      }

      try {
        const now = Math.floor(Date.now() / 1000);
        db.prepare(
          `UPDATE media SET 
           view_count = view_count + 1,
           last_viewed = ?
           WHERE id = ?`
        ).run(now, mediaId);

        return {
          success: true,
          mediaId,
          viewRecorded: true,
        };
      } catch (error) {
        console.error('View error:', error);
        return reply.code(500).send({
          error: 'Failed to record view',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get a specific media item
  fastify.get<{ Params: { id: string } }>(
    '/api/media/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const media = db
          .prepare(
            `
          SELECT 
            m.id,
            m.path,
            m.type,
            m.source_id as sourceId,
            m.liked,
            m.saved,
            m.view_count as viewCount,
            m.last_viewed as lastViewed,
            s.display_name as displayName,
            s.avatar_seed as avatarSeed
          FROM media m
          JOIN sources s ON m.source_id = s.id
          WHERE m.id = ?
        `
          )
          .get(id) as {
            id: string;
            path: string;
            type: string;
            sourceId: string;
            liked: number;
            saved: number;
            viewCount: number;
            lastViewed: number | null;
            displayName: string;
            avatarSeed: string;
          } | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        return {
          success: true,
          media: {
            id: media.id,
            path: media.path,
            type: media.type,
            sourceId: media.sourceId,
            displayName: media.displayName,
            avatarSeed: media.avatarSeed,
            liked: media.liked === 1,
            saved: media.saved === 1,
            viewCount: media.viewCount,
            lastViewed: media.lastViewed,
          },
        };
      } catch (error) {
        console.error('Get media error:', error);
        return reply.code(500).send({
          error: 'Failed to get media',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get all saved items
  fastify.get('/api/saved', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const savedMedia = db
        .prepare(
          `
        SELECT 
          m.id,
          m.path,
          m.type,
          m.source_id as sourceId,
          m.liked,
          m.saved,
          m.view_count as viewCount,
          m.last_viewed as lastViewed,
          s.display_name as displayName,
          s.avatar_seed as avatarSeed
        FROM media m
        JOIN sources s ON m.source_id = s.id
        WHERE m.saved = 1
        ORDER BY m.last_viewed DESC
      `
        )
        .all() as Array<{
          id: string;
          path: string;
          type: string;
          sourceId: string;
          liked: number;
          saved: number;
          viewCount: number;
          lastViewed: number | null;
          displayName: string;
          avatarSeed: string;
        }>;

      return {
        success: true,
        savedMedia: savedMedia.map((m) => ({
          id: m.id,
          path: m.path,
          type: m.type,
          sourceId: m.sourceId,
          displayName: m.displayName,
          avatarSeed: m.avatarSeed,
          liked: m.liked === 1,
          saved: m.saved === 1,
          viewCount: m.viewCount,
          lastViewed: m.lastViewed,
        })),
      };
    } catch (error) {
      console.error('Get saved error:', error);
      return reply.code(500).send({
        error: 'Failed to get saved media',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Get all liked items
  fastify.get('/api/liked', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const likedMedia = db
        .prepare(
          `
        SELECT 
          m.id,
          m.path,
          m.type,
          m.source_id as sourceId,
          m.liked,
          m.saved,
          m.view_count as viewCount,
          m.last_viewed as lastViewed,
          s.display_name as displayName,
          s.avatar_seed as avatarSeed
        FROM media m
        JOIN sources s ON m.source_id = s.id
        WHERE m.liked = 1
        ORDER BY m.last_viewed DESC
      `
        )
        .all() as Array<{
          id: string;
          path: string;
          type: string;
          sourceId: string;
          liked: number;
          saved: number;
          viewCount: number;
          lastViewed: number | null;
          displayName: string;
          avatarSeed: string;
        }>;

      return {
        success: true,
        likedMedia: likedMedia.map((m) => ({
          id: m.id,
          path: m.path,
          type: m.type,
          sourceId: m.sourceId,
          displayName: m.displayName,
          avatarSeed: m.avatarSeed,
          liked: m.liked === 1,
          saved: m.saved === 1,
          viewCount: m.viewCount,
          lastViewed: m.lastViewed,
        })),
      };
    } catch (error) {
      console.error('Get liked error:', error);
      return reply.code(500).send({
        error: 'Failed to get liked media',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Serve media file with streaming support
  fastify.get<{ Params: { id: string } }>(
    '/api/media/file/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const media = db.prepare('SELECT path, type FROM media WHERE id = ?').get(id) as {
          path: string;
          type: string;
        } | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        // Check file exists
        const fileStats = await fs.stat(media.path);
        if (!fileStats.isFile()) {
          return reply.code(404).send({ error: 'File not found' });
        }

        // Get MIME type
        const ext = path.extname(media.path).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.mov': 'video/quicktime',
          '.mkv': 'video/x-matroska',
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const isVideo = media.type.toLowerCase().startsWith('video') ||
          contentType.startsWith('video/');

        // For videos, support range requests for streaming
        if (isVideo) {
          const range = request.headers.range;

          if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileStats.size - 1;
            const chunksize = end - start + 1;

            const readStream = (await import('fs')).createReadStream(media.path, { start, end });

            return reply
              .code(206)
              .header('Content-Range', `bytes ${start}-${end}/${fileStats.size}`)
              .header('Accept-Ranges', 'bytes')
              .header('Content-Length', chunksize.toString())
              .header('Content-Type', contentType)
              .header('Cache-Control', 'public, max-age=3600')
              .send(readStream);
          } else {
            // No range request, send entire file as stream
            const readStream = (await import('fs')).createReadStream(media.path);

            return reply
              .header('Content-Length', fileStats.size.toString())
              .header('Content-Type', contentType)
              .header('Accept-Ranges', 'bytes')
              .header('Cache-Control', 'public, max-age=3600')
              .send(readStream);
          }
        } else {
          // For images, read entire file (they're usually smaller)
          const fileContent = await fs.readFile(media.path);

          return reply
            .type(contentType)
            .header('Content-Length', fileStats.size.toString())
            .header('Cache-Control', 'public, max-age=3600')
            .send(fileContent);
        }
      } catch (error) {
        console.error('Get media file error:', error);
        return reply.code(500).send({
          error: 'Failed to serve media file',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Hide/unhide a media item
  fastify.post<{ Body: InteractionBody }>(
    '/api/hide',
    async (request: FastifyRequest<{ Body: InteractionBody }>, reply: FastifyReply) => {
      const { mediaId } = request.body;

      if (!mediaId || typeof mediaId !== 'string') {
        return reply.code(400).send({ error: 'Invalid media ID' });
      }

      try {
        // Toggle hide status
        const media = db.prepare('SELECT hidden FROM media WHERE id = ?').get(mediaId) as {
          hidden: number;
        } | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        const newHiddenStatus = media.hidden === 1 ? 0 : 1;
        db.prepare('UPDATE media SET hidden = ? WHERE id = ?').run(newHiddenStatus, mediaId);

        return {
          success: true,
          mediaId,
          hidden: newHiddenStatus === 1,
        };
      } catch (error) {
        console.error('Hide error:', error);
        return reply.code(500).send({
          error: 'Failed to update hide status',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get hidden media items
  fastify.get(
    '/api/hidden',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const hiddenMedia = db
          .prepare(
            `
          SELECT 
            m.id,
            m.path,
            m.type,
            m.source_id as sourceId,
            m.liked,
            m.saved,
            m.view_count as viewCount,
            m.last_viewed as lastViewed,
            m.depth,
            s.display_name as displayName,
            s.avatar_seed as avatarSeed
          FROM media m
          JOIN sources s ON m.source_id = s.id
          WHERE m.hidden = 1
          ORDER BY m.last_viewed DESC NULLS LAST, m.created_at DESC
        `
          )
          .all() as Array<{
            id: string;
            path: string;
            type: string;
            sourceId: string;
            liked: number;
            saved: number;
            viewCount: number;
            lastViewed: number | null;
            depth: number;
            displayName: string;
            avatarSeed: string;
          }>;

        return {
          success: true,
          hiddenMedia: hiddenMedia.map((m) => ({
            id: m.id,
            path: m.path,
            type: m.type,
            sourceId: m.sourceId,
            displayName: m.displayName,
            avatarSeed: m.avatarSeed,
            liked: m.liked === 1,
            saved: m.saved === 1,
            viewCount: m.viewCount,
            lastViewed: m.lastViewed,
            depth: m.depth,
          })),
          count: hiddenMedia.length,
        };
      } catch (error) {
        console.error('Get hidden media error:', error);
        return reply.code(500).send({
          error: 'Failed to get hidden media',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}