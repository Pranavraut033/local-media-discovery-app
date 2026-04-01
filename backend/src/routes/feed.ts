/**
 * Feed and Interaction Routes
 * Handles feed generation, likes, saves, and view tracking
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getDatabase } from '../db/index.js';
import { generatePaginatedFeed } from '../services/feed.js';
import { readRemoteFile } from '../services/rclone.js';

interface FeedQuery {
  page?: string;
  limit?: string;
  lastSourceId?: string;
  sourceId?: string;
  feedSeed?: string;
}

interface InteractionBody {
  mediaId: string;
  sourceId: string;
}

interface MediaFileQuery {
  token?: string;
}

interface MediaRow {
  id: string;
  path: string;
  type: string;
  sourceId: string;
  liked: number;
  saved: number;
  depth: number;
  viewCount: number;
  lastViewed: number | null;
}

const latestPathsCte = `
  WITH latest_paths AS (
    SELECT fp.*
    FROM file_paths fp
    JOIN (
      SELECT file_id, MAX(last_seen_at) AS max_seen
      FROM file_paths
      WHERE user_id = ? AND is_present = 1
      GROUP BY file_id
    ) latest
      ON latest.file_id = fp.file_id
     AND latest.max_seen = fp.last_seen_at
    WHERE fp.user_id = ? AND fp.is_present = 1
  )
`;

const sourceIdSql = `
  CASE
    WHEN instr(lp.relative_path_from_root, '/') = 0 THEN 'root'
    ELSE substr(lp.relative_path_from_root, 1, instr(lp.relative_path_from_root, '/') - 1)
  END
`;

const depthSql = `
  CASE
    WHEN lp.relative_path_from_root = '' THEN 0
    ELSE LENGTH(lp.relative_path_from_root) - LENGTH(REPLACE(lp.relative_path_from_root, '/', ''))
  END
`;

function buildMediaResponse(row: MediaRow) {
  return {
    id: row.id,
    path: row.path,
    type: row.type,
    sourceId: row.sourceId,
    displayName: row.sourceId === 'root' ? 'Root' : row.sourceId,
    avatarSeed: row.sourceId,
    liked: row.liked === 1,
    saved: row.saved === 1,
    viewCount: row.viewCount,
    lastViewed: row.lastViewed,
    depth: row.depth,
  };
}

function assertUserHasFileAccess(db: ReturnType<typeof getDatabase>, userId: string, fileId: string): boolean {
  const record = db
    .prepare('SELECT 1 FROM file_paths WHERE user_id = ? AND file_id = ? AND is_present = 1 LIMIT 1')
    .get(userId, fileId);
  return Boolean(record);
}

function toggleUserFileFlag(
  db: ReturnType<typeof getDatabase>,
  tableName: 'user_liked_files' | 'user_saved_files' | 'user_hidden_files',
  userId: string,
  fileId: string
): boolean {
  const existing = db
    .prepare(`SELECT id FROM ${tableName} WHERE user_id = ? AND file_id = ?`)
    .get(userId, fileId) as { id: string } | undefined;

  if (existing) {
    db.prepare(`DELETE FROM ${tableName} WHERE user_id = ? AND file_id = ?`).run(userId, fileId);
    return false;
  }

  db.prepare(`INSERT INTO ${tableName} (id, user_id, file_id) VALUES (?, ?, ?)`).run(
    randomUUID(),
    userId,
    fileId
  );
  return true;
}

export default async function feedRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  fastify.get<{ Querystring: FeedQuery }>(
    '/api/feed',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const page = parseInt(request.query.page || '0', 10);
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100);
        const lastSourceId = request.query.lastSourceId;
        const sourceId = request.query.sourceId;
        const feedSeed = request.query.feedSeed;
        const userId = request.user!.userId;

        const feedData = generatePaginatedFeed(db, page, limit, lastSourceId, userId, sourceId, feedSeed);

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

  fastify.get<{ Params: { sourceId: string }; Querystring: { limit?: string } }>(
    '/api/source/:sourceId/media',
    {
      onRequest: [fastify.authenticate],
    },
    async (
      request: FastifyRequest<{ Params: { sourceId: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      const { sourceId } = request.params;
      const limit = Math.min(parseInt(request.query.limit || '50', 10), 200);
      const userId = request.user!.userId;

      try {
        const mediaItems = db
          .prepare(
            `
            ${latestPathsCte}
            SELECT
              f.id,
              lp.absolute_path AS path,
              f.media_kind AS type,
              ${sourceIdSql} AS sourceId,
              CASE WHEN ulf.file_id IS NULL THEN 0 ELSE 1 END AS liked,
              CASE WHEN usf.file_id IS NULL THEN 0 ELSE 1 END AS saved,
              ${depthSql} AS depth,
              0 AS viewCount,
              NULL AS lastViewed
            FROM files f
            JOIN latest_paths lp ON lp.file_id = f.id
            LEFT JOIN user_liked_files ulf ON ulf.user_id = ? AND ulf.file_id = f.id
            LEFT JOIN user_saved_files usf ON usf.user_id = ? AND usf.file_id = f.id
            LEFT JOIN user_hidden_files uhf ON uhf.user_id = ? AND uhf.file_id = f.id
            WHERE uhf.file_id IS NULL
              AND ${sourceIdSql} = ?
            ORDER BY RANDOM()
            LIMIT ?
          `
          )
          .all(userId, userId, userId, userId, userId, sourceId, limit) as MediaRow[];

        return {
          success: true,
          media: mediaItems.map((m) => buildMediaResponse(m)),
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
        if (!assertUserHasFileAccess(db, userId, mediaId)) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        const liked = toggleUserFileFlag(db, 'user_liked_files', userId, mediaId);

        return {
          success: true,
          mediaId,
          liked,
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
        if (!assertUserHasFileAccess(db, userId, mediaId)) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        const saved = toggleUserFileFlag(db, 'user_saved_files', userId, mediaId);

        return {
          success: true,
          mediaId,
          saved,
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
        if (!assertUserHasFileAccess(db, userId, mediaId)) {
          return reply.code(404).send({ error: 'Media not found' });
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

  fastify.get<{ Params: { id: string } }>(
    '/api/media/:id',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const userId = request.user!.userId;

      try {
        const media = db
          .prepare(
            `
            ${latestPathsCte}
            SELECT
              f.id,
              lp.absolute_path AS path,
              f.media_kind AS type,
              ${sourceIdSql} AS sourceId,
              CASE WHEN ulf.file_id IS NULL THEN 0 ELSE 1 END AS liked,
              CASE WHEN usf.file_id IS NULL THEN 0 ELSE 1 END AS saved,
              ${depthSql} AS depth,
              0 AS viewCount,
              NULL AS lastViewed
            FROM files f
            JOIN latest_paths lp ON lp.file_id = f.id
            LEFT JOIN user_liked_files ulf ON ulf.user_id = ? AND ulf.file_id = f.id
            LEFT JOIN user_saved_files usf ON usf.user_id = ? AND usf.file_id = f.id
            LEFT JOIN user_hidden_files uhf ON uhf.user_id = ? AND uhf.file_id = f.id
            WHERE f.id = ?
              AND uhf.file_id IS NULL
            LIMIT 1
          `
          )
          .get(userId, userId, userId, userId, userId, id) as MediaRow | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        return {
          success: true,
          media: buildMediaResponse(media),
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
            ${latestPathsCte}
            SELECT
              f.id,
              lp.absolute_path AS path,
              f.media_kind AS type,
              ${sourceIdSql} AS sourceId,
              CASE WHEN ulf.file_id IS NULL THEN 0 ELSE 1 END AS liked,
              1 AS saved,
              ${depthSql} AS depth,
              0 AS viewCount,
              NULL AS lastViewed
            FROM files f
            JOIN latest_paths lp ON lp.file_id = f.id
            JOIN user_saved_files usf ON usf.user_id = ? AND usf.file_id = f.id
            LEFT JOIN user_liked_files ulf ON ulf.user_id = ? AND ulf.file_id = f.id
            LEFT JOIN user_hidden_files uhf ON uhf.user_id = ? AND uhf.file_id = f.id
            WHERE uhf.file_id IS NULL
            ORDER BY usf.updated_at DESC
          `
          )
          .all(userId, userId, userId, userId, userId) as MediaRow[];

        return {
          success: true,
          savedMedia: savedMedia.map((m) => buildMediaResponse(m)),
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
            ${latestPathsCte}
            SELECT
              f.id,
              lp.absolute_path AS path,
              f.media_kind AS type,
              ${sourceIdSql} AS sourceId,
              1 AS liked,
              CASE WHEN usf.file_id IS NULL THEN 0 ELSE 1 END AS saved,
              ${depthSql} AS depth,
              0 AS viewCount,
              NULL AS lastViewed
            FROM files f
            JOIN latest_paths lp ON lp.file_id = f.id
            JOIN user_liked_files ulf ON ulf.user_id = ? AND ulf.file_id = f.id
            LEFT JOIN user_saved_files usf ON usf.user_id = ? AND usf.file_id = f.id
            LEFT JOIN user_hidden_files uhf ON uhf.user_id = ? AND uhf.file_id = f.id
            WHERE uhf.file_id IS NULL
            ORDER BY ulf.updated_at DESC
          `
          )
          .all(userId, userId, userId, userId, userId) as MediaRow[];

        return {
          success: true,
          likedMedia: likedMedia.map((m) => buildMediaResponse(m)),
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

  fastify.get<{ Params: { id: string }; Querystring: MediaFileQuery }>(
    '/api/media/file/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: MediaFileQuery }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      let userId: string;
      const token = request.query.token;

      if (token) {
        try {
          const decoded = fastify.jwt.verify<{ userId: string }>(token);
          userId = decoded.userId;
        } catch {
          return reply.code(401).send({ error: 'Invalid or expired token' });
        }
      } else {
        try {
          await request.jwtVerify();
          userId = request.user!.userId;
        } catch {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
      }

      try {
        const media = db
          .prepare(
            `
            ${latestPathsCte}
            SELECT lp.absolute_path AS path, f.media_kind AS type
            FROM files f
            JOIN latest_paths lp ON lp.file_id = f.id
            WHERE f.id = ?
            LIMIT 1
          `
          )
          .get(userId, userId, id) as {
          path: string;
          type: string;
        } | undefined;

        if (!media) {
          return reply.code(404).send({ error: 'Media not found' });
        }

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

        if (media.path.startsWith('rclone:')) {
          const remoteBuffer = await readRemoteFile(media.path);
          return reply
            .type(contentType)
            .header('Content-Length', remoteBuffer.length.toString())
            .header('Cache-Control', 'public, max-age=300')
            .send(remoteBuffer);
        }

        const fileStats = await fs.stat(media.path);
        if (!fileStats.isFile()) {
          return reply.code(404).send({ error: 'File not found' });
        }

        const isVideo = media.type.toLowerCase() === 'video' || contentType.startsWith('video/');

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
          }

          const readStream = (await import('fs')).createReadStream(media.path);

          return reply
            .header('Content-Length', fileStats.size.toString())
            .header('Content-Type', contentType)
            .header('Accept-Ranges', 'bytes')
            .header('Cache-Control', 'public, max-age=3600')
            .send(readStream);
        }

        const fileContent = await fs.readFile(media.path);

        return reply
          .type(contentType)
          .header('Content-Length', fileStats.size.toString())
          .header('Cache-Control', 'public, max-age=3600')
          .send(fileContent);
      } catch (error) {
        console.error('Get media file error:', error);
        return reply.code(500).send({
          error: 'Failed to serve media file',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

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
        if (!assertUserHasFileAccess(db, userId, mediaId)) {
          return reply.code(404).send({ error: 'Media not found' });
        }

        const hidden = toggleUserFileFlag(db, 'user_hidden_files', userId, mediaId);

        return {
          success: true,
          mediaId,
          hidden,
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
            ${latestPathsCte}
            SELECT
              f.id,
              lp.absolute_path AS path,
              f.media_kind AS type,
              ${sourceIdSql} AS sourceId,
              CASE WHEN ulf.file_id IS NULL THEN 0 ELSE 1 END AS liked,
              CASE WHEN usf.file_id IS NULL THEN 0 ELSE 1 END AS saved,
              ${depthSql} AS depth,
              0 AS viewCount,
              NULL AS lastViewed
            FROM files f
            JOIN latest_paths lp ON lp.file_id = f.id
            JOIN user_hidden_files uhf ON uhf.user_id = ? AND uhf.file_id = f.id
            LEFT JOIN user_liked_files ulf ON ulf.user_id = ? AND ulf.file_id = f.id
            LEFT JOIN user_saved_files usf ON usf.user_id = ? AND usf.file_id = f.id
            ORDER BY uhf.updated_at DESC
          `
          )
          .all(userId, userId, userId, userId, userId) as MediaRow[];

        return {
          success: true,
          hiddenMedia: hiddenMedia.map((m) => buildMediaResponse(m)),
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
