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
  sourceId?: string;
}

interface InteractionBody {
  mediaId: string;
  sourceId: string;
}


export default async function feedRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  // Get paginated feed
  fastify.get<{ Querystring: FeedQuery }>(
    '/api/feed',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const page = parseInt(request.query.page || '0', 10);
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100); // Max 100
        const lastSourceId = request.query.lastSourceId;
        const sourceId = request.query.sourceId;
        const userId = request.user!.userId;

        const feedData = generatePaginatedFeed(db, page, limit, lastSourceId, userId, sourceId);

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
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { mediaId, sourceId } = request.body;
      const userId = request.user!.userId;

      if (!mediaId || typeof mediaId !== 'string' || !sourceId) {
        return reply.code(400).send({ error: 'Invalid media ID or source ID' });
      }

      try {
        // Check if interaction exists
        const interaction = db.prepare(
          'SELECT liked FROM user_interactions WHERE user_id = ? AND source_id = ? AND media_id = ?'
        ).get(userId, sourceId, mediaId) as { liked: number } | undefined;

        if (interaction) {
          // Toggle like status
          const newLikedStatus = interaction.liked === 1 ? 0 : 1;
          db.prepare(
            'UPDATE user_interactions SET liked = ? WHERE user_id = ? AND source_id = ? AND media_id = ?'
          ).run(newLikedStatus, userId, sourceId, mediaId);

          return {
            success: true,
            mediaId,
            liked: newLikedStatus === 1,
          };
        } else {
          // Create new interaction with like
          db.prepare(
            'INSERT INTO user_interactions (user_id, source_id, media_id, liked) VALUES (?, ?, ?, 1)'
          ).run(userId, sourceId, mediaId);

          return {
            success: true,
            mediaId,
            liked: true,
          };
        }
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
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { mediaId, sourceId } = request.body;
      const userId = request.user!.userId;

      if (!mediaId || typeof mediaId !== 'string' || !sourceId) {
        return reply.code(400).send({ error: 'Invalid media ID or source ID' });
      }

      try {
        // Check if interaction exists
        const interaction = db.prepare(
          'SELECT saved FROM user_interactions WHERE user_id = ? AND source_id = ? AND media_id = ?'
        ).get(userId, sourceId, mediaId) as { saved: number } | undefined;

        if (interaction) {
          // Toggle save status
          const newSavedStatus = interaction.saved === 1 ? 0 : 1;
          db.prepare(
            'UPDATE user_interactions SET saved = ? WHERE user_id = ? AND source_id = ? AND media_id = ?'
          ).run(newSavedStatus, userId, sourceId, mediaId);

          return {
            success: true,
            mediaId,
            saved: newSavedStatus === 1,
          };
        } else {
          // Create new interaction with save
          db.prepare(
            'INSERT INTO user_interactions (user_id, source_id, media_id, saved) VALUES (?, ?, ?, 1)'
          ).run(userId, sourceId, mediaId);

          return {
            success: true,
            mediaId,
            saved: true,
          };
        }
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
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { mediaId, sourceId } = request.body;
      const userId = request.user!.userId;

      if (!mediaId || typeof mediaId !== 'string' || !sourceId) {
        return reply.code(400).send({ error: 'Invalid media ID or source ID' });
      }

      try {
        const now = Math.floor(Date.now() / 1000);

        // Check if interaction exists
        const interaction = db.prepare(
          'SELECT view_count FROM user_interactions WHERE user_id = ? AND source_id = ? AND media_id = ?'
        ).get(userId, sourceId, mediaId);

        if (interaction) {
          // Update existing interaction
          db.prepare(
            `UPDATE user_interactions SET 
             view_count = view_count + 1,
             last_viewed = ?
             WHERE user_id = ? AND source_id = ? AND media_id = ?`
          ).run(now, userId, sourceId, mediaId);
        } else {
          // Create new interaction with view
          db.prepare(
            'INSERT INTO user_interactions (user_id, source_id, media_id, view_count, last_viewed) VALUES (?, ?, ?, 1, ?)'
          ).run(userId, sourceId, mediaId, now);
        }

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
  fastify.get(
    '/api/saved',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      try {
        const savedMedia = db
          .prepare(
            `
          SELECT 
            m.id,
            m.path,
            m.type,
            m.source_id as sourceId,
            ui.liked,
            ui.saved,
            ui.view_count as viewCount,
            ui.last_viewed as lastViewed,
            s.display_name as displayName,
            s.avatar_seed as avatarSeed
          FROM media m
          JOIN sources s ON m.source_id = s.id
          JOIN user_interactions ui ON m.id = ui.media_id AND m.source_id = ui.source_id
          WHERE ui.user_id = ? AND ui.saved = 1
          ORDER BY ui.last_viewed DESC
        `
          )
          .all(userId) as Array<{
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
    }
  );

  // Get all liked items
  fastify.get(
    '/api/liked',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      try {
        const likedMedia = db
          .prepare(
            `
          SELECT 
            m.id,
            m.path,
            m.type,
            m.source_id as sourceId,
            ui.liked,
            ui.saved,
            ui.view_count as viewCount,
            ui.last_viewed as lastViewed,
            s.display_name as displayName,
            s.avatar_seed as avatarSeed
          FROM media m
          JOIN sources s ON m.source_id = s.id
          JOIN user_interactions ui ON m.id = ui.media_id AND m.source_id = ui.source_id
          WHERE ui.user_id = ? AND ui.liked = 1
          ORDER BY ui.last_viewed DESC
        `
          )
          .all(userId) as Array<{
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
    }
  );

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
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { mediaId, sourceId } = request.body;
      const userId = request.user!.userId;

      if (!mediaId || typeof mediaId !== 'string' || !sourceId) {
        return reply.code(400).send({ error: 'Invalid media ID or source ID' });
      }

      try {
        // Check if interaction exists
        const interaction = db.prepare(
          'SELECT hidden FROM user_interactions WHERE user_id = ? AND source_id = ? AND media_id = ?'
        ).get(userId, sourceId, mediaId) as { hidden: number } | undefined;

        if (interaction) {
          // Toggle hide status
          const newHiddenStatus = interaction.hidden === 1 ? 0 : 1;
          db.prepare(
            'UPDATE user_interactions SET hidden = ? WHERE user_id = ? AND source_id = ? AND media_id = ?'
          ).run(newHiddenStatus, userId, sourceId, mediaId);

          return {
            success: true,
            mediaId,
            hidden: newHiddenStatus === 1,
          };
        } else {
          // Create new interaction with hidden
          db.prepare(
            'INSERT INTO user_interactions (user_id, source_id, media_id, hidden) VALUES (?, ?, ?, 1)'
          ).run(userId, sourceId, mediaId);

          return {
            success: true,
            mediaId,
            hidden: true,
          };
        }
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
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      try {
        const hiddenMedia = db
          .prepare(
            `
          SELECT 
            m.id,
            m.path,
            m.type,
            m.source_id as sourceId,
            ui.liked,
            ui.saved,
            ui.view_count as viewCount,
            ui.last_viewed as lastViewed,
            m.depth,
            s.display_name as displayName,
            s.avatar_seed as avatarSeed
          FROM media m
          JOIN sources s ON m.source_id = s.id
          JOIN user_interactions ui ON m.id = ui.media_id AND m.source_id = ui.source_id
          WHERE ui.user_id = ? AND ui.hidden = 1
          ORDER BY ui.last_viewed DESC NULLS LAST, m.created_at DESC
        `
          )
          .all(userId) as Array<{
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