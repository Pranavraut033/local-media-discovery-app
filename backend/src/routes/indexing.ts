/**
 * Media Indexing Routes
 * Handles indexing operations and status
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { indexMediaFiles } from '../services/indexer.js';
import { getAllSourcesV2, getSourceByIdV2 } from '../services/v2-sources.js';
import { startWatcher, stopWatcher, isWatcherActive } from '../services/watcher.js';

interface IndexRequest {
  rootFolder: string;
  enableWatcher?: boolean;
}

export default async function indexingRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  // Trigger manual indexing
  fastify.post<{ Body: IndexRequest }>(
    '/api/index',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { rootFolder, enableWatcher = true } = request.body;
      const userId = request.user!.userId;

      if (!rootFolder || typeof rootFolder !== 'string') {
        return reply.code(400).send({ error: 'Invalid root folder path' });
      }

      try {
        // Index media files into schema v2 tables.
        const result = await indexMediaFiles(db, rootFolder, userId);
        const sources = getAllSourcesV2(db, userId);

        // Start file watcher if enabled
        if (enableWatcher) {
          startWatcher({ rootFolder, userId, db });
        }

        return {
          success: true,
          result: {
            ...result,
            watcherActive: enableWatcher,
          },
          sources: sources.map(s => ({
            id: s.id,
            displayName: s.displayName,
            avatarSeed: s.avatarSeed,
            folderPath: s.folderPath,
          })),
        };
      } catch (error) {
        console.error('Indexing error:', error);
        return reply.code(500).send({
          error: 'Failed to index media files',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get indexing status
  fastify.get('/api/index/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const mediaCount = db
        .prepare('SELECT COUNT(*) as count FROM files')
        .get() as { count: number };
      const sourceCount = db
        .prepare(
          `
            SELECT COUNT(DISTINCT
              CASE
                WHEN instr(relative_path_from_root, '/') = 0 THEN 'root'
                ELSE substr(relative_path_from_root, 1, instr(relative_path_from_root, '/') - 1)
              END
            ) as count
            FROM file_paths
            WHERE is_present = 1
          `
        )
        .get() as { count: number };

      return {
        success: true,
        status: {
          mediaCount: mediaCount.count,
          sourceCount: sourceCount.count,
          watcherActive: isWatcherActive(),
        },
      };
    } catch (error) {
      console.error('Status error:', error);
      return reply.code(500).send({
        error: 'Failed to get indexing status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Get all sources
  fastify.get(
    '/api/sources',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      try {
        const sources = getAllSourcesV2(db, userId);

        return {
          success: true,
          sources: sources.map(s => ({
            id: s.id,
            displayName: s.displayName,
            avatarSeed: s.avatarSeed,
            folderPath: s.folderPath,
          })),
        };
      } catch (error) {
        console.error('Sources error:', error);
        return reply.code(500).send({
          error: 'Failed to get sources',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Get source by ID
  fastify.get<{ Params: { id: string } }>(
    '/api/sources/:id',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const userId = request.user!.userId;

      try {
        const source = getSourceByIdV2(db, userId, id);

        if (!source) {
          return reply.code(404).send({ error: 'Source not found' });
        }

        return {
          success: true,
          source: {
            id: source.id,
            displayName: source.displayName,
            avatarSeed: source.avatarSeed,
            folderPath: source.folderPath,
          },
        };
      } catch (error) {
        console.error('Source error:', error);
        return reply.code(500).send({
          error: 'Failed to get source',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // Stop file watcher
  fastify.post('/api/index/stop-watcher', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await stopWatcher();
      return { success: true, message: 'File watcher stopped' };
    } catch (error) {
      console.error('Stop watcher error:', error);
      return reply.code(500).send({
        error: 'Failed to stop file watcher',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
