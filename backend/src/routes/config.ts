/**
 * Configuration route - handles folder selection and settings
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import { indexMediaFiles } from '../services/indexer.js';
import { generateSources } from '../services/sources.js';
import { startWatcher } from '../services/watcher.js';
import fs from 'fs/promises';

interface SetFolderBody {
  path: string;
  autoIndex?: boolean;
}

export default async function configRoutes(fastify: FastifyInstance): Promise<void> {
  // Store the root folder path
  let rootFolder: string | null = null;

  // Get current root folder
  fastify.get('/api/config/root-folder', async (request: FastifyRequest, reply: FastifyReply) => {
    return { rootFolder };
  });

  // Set root folder for media indexing
  fastify.post<{ Body: SetFolderBody }>(
    '/api/config/root-folder',
    async (request: FastifyRequest<{ Body: SetFolderBody }>, reply: FastifyReply) => {
      const { path, autoIndex = true } = request.body;

      if (!path || typeof path !== 'string') {
        return reply.code(400).send({ error: 'Invalid folder path' });
      }

      console.log('abc');

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

      rootFolder = path;

      // Trigger indexing if autoIndex is enabled
      if (autoIndex) {
        const db = getDatabase();

        try {
          // Generate sources first
          const sources = await generateSources(db, rootFolder);

          // Then index media files
          const result = await indexMediaFiles(db, rootFolder);

          // Start file watcher
          startWatcher({ rootFolder, db });

          return {
            success: true,
            rootFolder,
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

      return { success: true, rootFolder };
    }
  );
}
