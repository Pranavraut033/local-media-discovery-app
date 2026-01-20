/**
 * Folder management routes
 * Handles folder tree retrieval and hiding subfolders
 */
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../db/index.js';
import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

interface FolderNode {
  path: string;
  name: string;
  mediaCount: number;
  hidden: boolean;
  children: FolderNode[];
}

interface FolderTreeQuery {
  sourceId: string;
}

interface HideFolderBody {
  sourceId: string;
  folderPath: string;
}

export default async function folderRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/folders/tree
   * Returns nested folder structure with media counts for a specific source
   */
  fastify.get<{ Querystring: FolderTreeQuery }>(
    '/tree',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { sourceId } = request.query;
      const userId = request.user!.userId;

      if (!sourceId) {
        return reply.code(400).send({ error: 'sourceId is required' });
      }

      try {
        const db = getDatabase();

        // Verify user has access to this source
        const userFolder = db
          .prepare('SELECT * FROM user_folders WHERE user_id = ? AND source_id = ?')
          .get(userId, sourceId) as { user_id: string; source_id: string } | undefined;

        if (!userFolder) {
          return reply.code(403).send({ error: 'Access denied to this folder' });
        }

        // Get source folder path
        const source = db
          .prepare('SELECT folder_path FROM sources WHERE id = ?')
          .get(sourceId) as { folder_path: string } | undefined;

        if (!source) {
          return reply.code(404).send({ error: 'Source not found' });
        }

        // Get all media files for this source
        const mediaFiles = db
          .prepare('SELECT path FROM media WHERE source_id = ?')
          .all(sourceId) as Array<{ path: string }>;

        // Get hidden folders for this user and source
        const hiddenFolders = db
          .prepare(
            'SELECT folder_path FROM user_hidden_folders WHERE user_id = ? AND source_id = ? AND hidden = 1'
          )
          .all(userId, sourceId) as Array<{ folder_path: string }>;

        const hiddenPaths = new Set(hiddenFolders.map((f) => f.folder_path));

        // Build folder tree
        const tree = buildFolderTree(source.folder_path, mediaFiles, hiddenPaths);

        return reply.send(tree);
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to retrieve folder tree' });
      }
    }
  );

  /**
   * POST /api/folders/hide
   * Toggle hide status for a specific subfolder
   */
  fastify.post<{ Body: HideFolderBody }>(
    '/hide',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { sourceId, folderPath } = request.body;
      const userId = request.user!.userId;

      if (!sourceId || !folderPath) {
        return reply.code(400).send({ error: 'sourceId and folderPath are required' });
      }

      try {
        const db = getDatabase();

        // Verify user has access to this source
        const userFolder = db
          .prepare('SELECT * FROM user_folders WHERE user_id = ? AND source_id = ?')
          .get(userId, sourceId) as { user_id: string; source_id: string } | undefined;

        if (!userFolder) {
          return reply.code(403).send({ error: 'Access denied to this folder' });
        }

        // Check if folder is already hidden
        const existing = db
          .prepare(
            'SELECT hidden FROM user_hidden_folders WHERE user_id = ? AND source_id = ? AND folder_path = ?'
          )
          .get(userId, sourceId, folderPath) as { hidden: number } | undefined;

        if (existing) {
          // Toggle existing entry
          const newHiddenState = existing.hidden === 1 ? 0 : 1;
          db.prepare(
            'UPDATE user_hidden_folders SET hidden = ? WHERE user_id = ? AND source_id = ? AND folder_path = ?'
          ).run(newHiddenState, userId, sourceId, folderPath);

          return reply.send({ hidden: newHiddenState === 1 });
        } else {
          // Create new hidden entry
          db.prepare(
            'INSERT INTO user_hidden_folders (user_id, source_id, folder_path, hidden) VALUES (?, ?, ?, 1)'
          ).run(userId, sourceId, folderPath);

          return reply.send({ hidden: true });
        }
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to toggle folder visibility' });
      }
    }
  );

  /**
   * GET /api/folders/hidden
   * Get all hidden folders for the current user and source
   */
  fastify.get<{ Querystring: { sourceId: string } }>(
    '/hidden',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const { sourceId } = request.query;
      const userId = request.user!.userId;

      if (!sourceId) {
        return reply.code(400).send({ error: 'sourceId is required' });
      }

      try {
        const db = getDatabase();

        const hiddenFolders = db
          .prepare(
            'SELECT folder_path FROM user_hidden_folders WHERE user_id = ? AND source_id = ? AND hidden = 1'
          )
          .all(userId, sourceId) as Array<{ folder_path: string }>;

        return reply.send(hiddenFolders);
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to retrieve hidden folders' });
      }
    }
  );
}

/**
 * Build nested folder tree with media counts
 */
function buildFolderTree(
  rootPath: string,
  mediaFiles: Array<{ path: string }>,
  hiddenPaths: Set<string>
): FolderNode {
  // Extract unique folder paths from media files
  const folderMap = new Map<string, number>();

  for (const media of mediaFiles) {
    const mediaDir = dirname(media.path);

    // Count media in this specific folder
    if (!folderMap.has(mediaDir)) {
      folderMap.set(mediaDir, 0);
    }
    folderMap.set(mediaDir, folderMap.get(mediaDir)! + 1);
  }

  // Build tree structure
  const root: FolderNode = {
    path: rootPath,
    name: rootPath.split('/').pop() || rootPath,
    mediaCount: folderMap.get(rootPath) || 0,
    hidden: hiddenPaths.has(rootPath),
    children: [],
  };

  // Get all unique folder paths and sort them
  const allFolders = Array.from(folderMap.keys()).sort();

  // Build nested structure
  const nodeMap = new Map<string, FolderNode>();
  nodeMap.set(rootPath, root);

  for (const folderPath of allFolders) {
    if (folderPath === rootPath) continue;

    // Only include folders that are children of the root
    if (!folderPath.startsWith(rootPath + '/')) continue;

    const node: FolderNode = {
      path: folderPath,
      name: folderPath.split('/').pop() || folderPath,
      mediaCount: folderMap.get(folderPath) || 0,
      hidden: hiddenPaths.has(folderPath),
      children: [],
    };

    nodeMap.set(folderPath, node);

    // Find parent folder
    const parentPath = dirname(folderPath);
    const parentNode = nodeMap.get(parentPath);

    if (parentNode) {
      parentNode.children.push(node);
    }
  }

  return root;
}
