/**
 * Configuration route - handles folder selection and settings
 * Note: Root folder path is stored in frontend localStorage for privacy
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import path from 'path';
import { getDatabase } from '../db/index.js';
import { startWatcher, stopWatcher } from '../services/watcher.js';
import { clearUserIndexedDataV2 } from '../services/v2-data-maintenance.js';
import { enqueueIndexingJob } from '../queue/index.js';
import fs from 'fs/promises';

interface SetFolderBody {
  path: string;
  autoIndex?: boolean;
}

interface RecentRootFolderRow {
  path: string;
  name: string;
  lastIndexedAt: number;
  serverId: string | null;
  serverType: string | null;
}

export default async function configRoutes(fastify: FastifyInstance): Promise<void> {
  // Note: Root folder path is NOT stored on backend for privacy
  // It's stored in frontend localStorage

  // Set root folder for media indexing – returns immediately with a jobId.
  // Actual indexing is handled asynchronously by the BullMQ worker.
  fastify.post<{ Body: SetFolderBody }>(
    '/api/config/root-folder',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { path: folderPath, autoIndex = true } = request.body;
      const userId = request.user!.userId;

      if (!folderPath || typeof folderPath !== 'string') {
        return reply.code(400).send({ error: 'Invalid folder path' });
      }

      // Verify folder exists before queuing
      try {
        const stats = await fs.stat(folderPath);
        if (!stats.isDirectory()) {
          return reply.code(400).send({ error: 'Path is not a directory' });
        }
      } catch {
        return reply.code(400).send({ error: 'Folder does not exist or is not accessible' });
      }

      if (!autoIndex) {
        return reply.send({ success: true });
      }

      const db = getDatabase();
      const jobId = randomUUID();
      const now = Math.floor(Date.now() / 1000);

      // Persist job record for UX queries
      db.prepare(
        `INSERT INTO indexing_jobs (id, user_id, job_type, status, source_path, created_at, updated_at)
         VALUES (?, ?, 'local', 'queued', ?, ?, ?)`
      ).run(jobId, userId, folderPath, now, now);

      // Start file watcher immediately so new files are caught after indexing
      startWatcher({ rootFolder: folderPath, userId, db });

      await enqueueIndexingJob({ jobId, userId, type: 'local', rootFolder: folderPath });

      return reply.code(202).send({ accepted: true, jobId });
    }
  );

  // Check whether a previously-selected root folder still exists on disk.
  // Used by the frontend to detect folders that were moved/deleted outside the app
  // so it can fall back to folder selection instead of showing an empty feed.
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/config/root-folder/status',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { path: folderPath } = request.query;

      if (!folderPath || typeof folderPath !== 'string') {
        return reply.code(400).send({ error: 'Invalid folder path' });
      }

      try {
        const stats = await fs.stat(folderPath);
        return reply.send({ exists: stats.isDirectory() });
      } catch {
        return reply.send({ exists: false });
      }
    }
  );

  // Get recently indexed root folders for the authenticated user — local AND
  // remote (rclone/webdav). Remote rows carry serverId/serverType so the
  // frontend can re-trigger indexing via /api/servers/:id/add-source instead
  // of the local-only /api/config/root-folder.
  fastify.get(
    '/api/config/recent-folders',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = getDatabase();
        const userId = (request as any).user!.userId as string;

        const recentFolders = db
          .prepare(
            `
              SELECT
                f.absolute_path AS path,
                f.name AS name,
                MAX(f.updated_at) AS lastIndexedAt,
                f.server_id AS serverId,
                rs.server_type AS serverType
              FROM folders f
              LEFT JOIN remote_servers rs ON rs.id = f.server_id
              WHERE f.user_id = ?
                AND (
                  f.relative_path_from_root = ''
                  OR f.relative_path_from_root = '__server_root_' || f.server_id
                )
              GROUP BY f.absolute_path, f.name, f.server_id
              ORDER BY lastIndexedAt DESC
              LIMIT 10
            `
          )
          .all(userId) as RecentRootFolderRow[];

        return reply.send({ folders: recentFolders });
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to fetch recent folders' });
      }
    }
  );

  // Reset/clear database (root folder path is stored in frontend localStorage)
  fastify.delete(
    '/api/config/root-folder',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const db = getDatabase();
        const userId = request.user!.userId;

        // Stop the file watcher if running
        stopWatcher();

        // Clear only authenticated user's indexed data in schema v2 tables.
        clearUserIndexedDataV2(db, userId);

        return { success: true, message: 'Database cleared successfully' };
      } catch (error) {
        console.error('Failed to clear database:', error);
        return reply.code(500).send({
          error: 'Failed to clear database',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
}

