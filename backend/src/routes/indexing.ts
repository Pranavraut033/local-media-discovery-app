/**
 * Media Indexing Routes
 * Handles indexing operations and status
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { indexMediaFiles } from '../services/indexer.js';
import { generateSources, getAllSources, getSourceById } from '../services/sources.js';
import { startWatcher, stopWatcher, isWatcherActive } from '../services/watcher.js';

interface IndexRequest {
  rootFolder: string;
  enableWatcher?: boolean;
}

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string };
}

export default async function indexingRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  // Trigger manual indexing
  fastify.post<{ Body: IndexRequest }>(
    '/api/index',
    {
      onRequest: [fastify.authenticate as any],
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const { rootFolder, enableWatcher = true } = request.body;
      const userId = request.user.userId;

      if (!rootFolder || typeof rootFolder !== 'string') {
        return reply.code(400).send({ error: 'Invalid root folder path' });
      }

      try {
        // Generate sources and associate with user
        const sources = await generateSources(db, rootFolder, userId);

        // Then index media files
        const result = await indexMediaFiles(db, rootFolder);

        // Start file watcher if enabled
        if (enableWatcher) {
          startWatcher({ rootFolder, db });
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
      const mediaCount = db.prepare('SELECT COUNT(*) as count FROM media').get() as { count: number };
      const sourceCount = db.prepare('SELECT COUNT(*) as count FROM sources').get() as { count: number };

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
      onRequest: [fastify.authenticate as any],
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      
      try {
        const sources = getAllSources(db, userId);

        return {
          success: true,
          sources: sources.map(s => ({
            id: s.id,
            displayName: s.displayName,
            avatarSeed: s.avatarSeed,
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
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      try {
        const source = getSourceById(db, id);

        if (!source) {
          return reply.code(404).send({ error: 'Source not found' });
        }

        return {
          success: true,
          source: {
            id: source.id,
            displayName: source.displayName,
            avatarSeed: source.avatarSeed,
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
