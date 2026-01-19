/**
 * Configuration route - handles folder selection and settings
 * Note: Root folder path is stored in frontend localStorage for privacy
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { indexMediaFiles } from '../services/indexer.js';
import { generateSources } from '../services/sources.js';
import { startWatcher, stopWatcher } from '../services/watcher.js';
import fs from 'fs/promises';

interface SetFolderBody {
  path: string;
  autoIndex?: boolean;
}

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string };
}

export default async function configRoutes(fastify: FastifyInstance): Promise<void> {
  // Note: Root folder path is NOT stored on backend for privacy
  // It's stored in frontend localStorage

  // Set root folder for media indexing
  // Path is received from frontend but not persisted on backend
  fastify.post<{ Body: SetFolderBody }>(
    '/api/config/root-folder',
    {
      onRequest: [fastify.authenticate as any],
    },
    async (request: AuthenticatedRequest & { Body: SetFolderBody }, reply: FastifyReply) => {
      const { path, autoIndex = true } = request.body;
      const userId = request.user.userId;

      if (!path || typeof path !== 'string') {
        return reply.code(400).send({ error: 'Invalid folder path' });
      }

      // Verify folder exists
      try {
        const stats = await fs.stat(path);
        if (!stats.isDirectory()) {
          return reply.code(400).send({ error: 'Path is not a directory' });
        }
      } catch (error) {
        console.error(`Folder ${path} does not exist or is not accessible:`, error);
        return reply.code(400).send({ error: 'Folder does not exist or is not accessible' });
      }

      // Trigger indexing if autoIndex is enabled
      if (autoIndex) {
        const db = getDatabase();

        try {
          // First, check if media already exists for this path
          // If so, associate existing sources with this user
          const existingSources = db
            .prepare('SELECT id FROM sources')
            .all() as Array<{ id: string }>;

          if (existingSources.length > 0) {
            console.log(`Found ${existingSources.length} existing sources, associating with user ${userId}`);
            const insertUserFolderStmt = db.prepare(
              'INSERT OR IGNORE INTO user_folders (user_id, source_id) VALUES (?, ?)'
            );
            
            for (const source of existingSources) {
              insertUserFolderStmt.run(userId, source.id);
            }
          }

          // Generate sources and associate with user
          const sources = await generateSources(db, path, userId);

          // Then index media files
          const result = await indexMediaFiles(db, path);

          // Start file watcher
          startWatcher({ rootFolder: path, db });

          return {
            success: true,
            indexing: {
              totalScanned: result.totalScanned,
              newFiles: result.newFiles,
              removedFiles: result.removedFiles,
              sources: result.sources,
            },
            watcherActive: true,
          };
        } catch (error) {
          console.error('Auto-indexing error:', error);
          return reply.code(500).send({
            error: 'Failed to index media files',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return { success: true };
    }
  );

  // Reset/clear database (root folder path is stored in frontend localStorage)
  fastify.delete(
    '/api/config/root-folder',
    {
      onRequest: [fastify.authenticate as any],
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const db = getDatabase();

      // Stop the file watcher if running
      stopWatcher();

      // Clear all data from the database
      db.prepare('DELETE FROM media').run();
      db.prepare('DELETE FROM sources').run();

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
