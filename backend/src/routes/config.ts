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

  // Get recently indexed local root folders for the authenticated user.
  // These come from DB (folders table) and are scoped per-user.
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
                absolute_path AS path,
                name,
                MAX(updated_at) AS lastIndexedAt
              FROM folders
              WHERE user_id = ?
                AND storage_mode = 'local'
                AND relative_path_from_root = ''
              GROUP BY absolute_path, name
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

