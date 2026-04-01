/**
 * Folder management routes (schema v2)
 * Exposes folder tree and folder-level hide toggles backed by file-level hidden state.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';

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

interface FolderRow {
  id: string;
  absolute_path: string;
  relative_path_from_root: string;
  name: string;
}

interface FileRow {
  file_id: string;
  folder_id: string | null;
}

function deriveSourceRootRelativePath(sourceId: string): string {
  return sourceId === 'root' ? '' : sourceId;
}

function isPathInSubtree(relativePath: string, subtreeRoot: string): boolean {
  if (subtreeRoot === '') {
    return true;
  }
  return relativePath === subtreeRoot || relativePath.startsWith(`${subtreeRoot}/`);
}

function buildFolderTreeFromV2(
  sourceRoot: FolderRow,
  folders: FolderRow[],
  subtreeStats: Map<string, { total: number; hidden: number }>
): FolderNode {
  const nodeMap = new Map<string, FolderNode>();

  const sorted = [...folders].sort((a, b) => {
    const aDepth = a.relative_path_from_root === '' ? 0 : a.relative_path_from_root.split('/').length;
    const bDepth = b.relative_path_from_root === '' ? 0 : b.relative_path_from_root.split('/').length;
    if (aDepth !== bDepth) {
      return aDepth - bDepth;
    }
    return a.relative_path_from_root.localeCompare(b.relative_path_from_root);
  });

  for (const folder of sorted) {
    const stats = subtreeStats.get(folder.id) || { total: 0, hidden: 0 };
    nodeMap.set(folder.id, {
      path: folder.absolute_path,
      name: folder.name,
      mediaCount: stats.total,
      hidden: stats.total > 0 && stats.hidden === stats.total,
      children: [],
    });
  }

  for (const folder of sorted) {
    if (folder.id === sourceRoot.id) {
      continue;
    }

    const parentRelative = folder.relative_path_from_root.includes('/')
      ? folder.relative_path_from_root.slice(0, folder.relative_path_from_root.lastIndexOf('/'))
      : sourceRoot.relative_path_from_root;

    const parent = sorted.find((candidate) => candidate.relative_path_from_root === parentRelative);
    if (!parent) {
      continue;
    }

    const parentNode = nodeMap.get(parent.id);
    const node = nodeMap.get(folder.id);
    if (parentNode && node) {
      parentNode.children.push(node);
    }
  }

  return nodeMap.get(sourceRoot.id)!;
}

function collectSubtreeFolderIds(folders: FolderRow[], rootRelativePath: string): Set<string> {
  return new Set(
    folders
      .filter((folder) => isPathInSubtree(folder.relative_path_from_root, rootRelativePath))
      .map((folder) => folder.id)
  );
}

export default async function folderRoutes(fastify: FastifyInstance) {
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
        const sourceRootRelativePath = deriveSourceRootRelativePath(sourceId);

        const allFolders = db
          .prepare(
            `
              SELECT id, absolute_path, relative_path_from_root, name
              FROM folders
              WHERE user_id = ?
                AND storage_mode = 'local'
              ORDER BY relative_path_from_root ASC
            `
          )
          .all(userId) as FolderRow[];

        const sourceFolders = allFolders.filter((folder) =>
          isPathInSubtree(folder.relative_path_from_root, sourceRootRelativePath)
        );

        const sourceRoot = sourceFolders.find(
          (folder) => folder.relative_path_from_root === sourceRootRelativePath
        );

        if (!sourceRoot) {
          return reply.code(404).send({ error: 'Source not found' });
        }

        const presentFiles = db
          .prepare(
            `
              SELECT fp.file_id, fp.folder_id
              FROM file_paths fp
              WHERE fp.user_id = ?
                AND fp.is_present = 1
            `
          )
          .all(userId) as FileRow[];

        const hiddenRows = db
          .prepare('SELECT file_id FROM user_hidden_files WHERE user_id = ?')
          .all(userId) as Array<{ file_id: string }>;
        const hiddenSet = new Set(hiddenRows.map((row) => row.file_id));

        const sourceFolderIds = new Set(sourceFolders.map((folder) => folder.id));
        const sourceFiles = presentFiles.filter((file) => file.folder_id && sourceFolderIds.has(file.folder_id));

        const directCounts = new Map<string, { total: number; hidden: number }>();
        for (const file of sourceFiles) {
          const folderId = file.folder_id!;
          const current = directCounts.get(folderId) || { total: 0, hidden: 0 };
          current.total += 1;
          if (hiddenSet.has(file.file_id)) {
            current.hidden += 1;
          }
          directCounts.set(folderId, current);
        }

        const subtreeStats = new Map<string, { total: number; hidden: number }>();
        const byDepthDesc = [...sourceFolders].sort((a, b) => {
          const aDepth = a.relative_path_from_root === '' ? 0 : a.relative_path_from_root.split('/').length;
          const bDepth = b.relative_path_from_root === '' ? 0 : b.relative_path_from_root.split('/').length;
          if (aDepth !== bDepth) {
            return bDepth - aDepth;
          }
          return b.relative_path_from_root.localeCompare(a.relative_path_from_root);
        });

        for (const folder of byDepthDesc) {
          const own = directCounts.get(folder.id) || { total: 0, hidden: 0 };
          const agg = { total: own.total, hidden: own.hidden };

          if (folder.relative_path_from_root !== sourceRootRelativePath) {
            const parentRelative = folder.relative_path_from_root.includes('/')
              ? folder.relative_path_from_root.slice(0, folder.relative_path_from_root.lastIndexOf('/'))
              : sourceRootRelativePath;
            const parent = sourceFolders.find((candidate) => candidate.relative_path_from_root === parentRelative);
            if (parent) {
              const parentAgg = subtreeStats.get(parent.id) || { total: 0, hidden: 0 };
              parentAgg.total += agg.total;
              parentAgg.hidden += agg.hidden;
              subtreeStats.set(parent.id, parentAgg);
            }
          }

          const existing = subtreeStats.get(folder.id) || { total: 0, hidden: 0 };
          existing.total += agg.total;
          existing.hidden += agg.hidden;
          subtreeStats.set(folder.id, existing);
        }

        const tree = buildFolderTreeFromV2(sourceRoot, sourceFolders, subtreeStats);
        return reply.send(tree);
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to retrieve folder tree' });
      }
    }
  );

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

        const folder = db
          .prepare(
            `
              SELECT id, absolute_path, relative_path_from_root, name
              FROM folders
              WHERE user_id = ?
                AND storage_mode = 'local'
                AND absolute_path = ?
              LIMIT 1
            `
          )
          .get(userId, folderPath) as FolderRow | undefined;

        if (!folder) {
          return reply.code(404).send({ error: 'Folder not found' });
        }

        const sourceRootRelativePath = deriveSourceRootRelativePath(sourceId);
        if (!isPathInSubtree(folder.relative_path_from_root, sourceRootRelativePath)) {
          return reply.code(403).send({ error: 'Access denied to this folder' });
        }

        const allFolders = db
          .prepare(
            `
              SELECT id, absolute_path, relative_path_from_root, name
              FROM folders
              WHERE user_id = ?
                AND storage_mode = 'local'
            `
          )
          .all(userId) as FolderRow[];

        const subtreeFolderIds = collectSubtreeFolderIds(allFolders, folder.relative_path_from_root);
        if (subtreeFolderIds.size === 0) {
          return reply.send({ hidden: false, folderPath });
        }

        const presentFiles = db
          .prepare('SELECT file_id, folder_id FROM file_paths WHERE user_id = ? AND is_present = 1')
          .all(userId) as FileRow[];
        const subtreeFileIds = presentFiles
          .filter((file) => file.folder_id && subtreeFolderIds.has(file.folder_id))
          .map((file) => file.file_id);

        if (subtreeFileIds.length === 0) {
          return reply.send({ hidden: false, folderPath });
        }

        const hiddenRows = db
          .prepare('SELECT file_id FROM user_hidden_files WHERE user_id = ?')
          .all(userId) as Array<{ file_id: string }>;
        const hiddenSet = new Set(hiddenRows.map((row) => row.file_id));

        const currentlyHidden = subtreeFileIds.every((fileId) => hiddenSet.has(fileId));

        const insertHidden = db.prepare(
          'INSERT OR IGNORE INTO user_hidden_files (id, user_id, file_id) VALUES (?, ?, ?)'
        );
        const deleteHidden = db.prepare('DELETE FROM user_hidden_files WHERE user_id = ? AND file_id = ?');

        const tx = db.transaction(() => {
          if (currentlyHidden) {
            for (const fileId of subtreeFileIds) {
              deleteHidden.run(userId, fileId);
            }
          } else {
            for (const fileId of subtreeFileIds) {
              insertHidden.run(randomUUID(), userId, fileId);
            }
          }
        });

        tx();

        return reply.send({ hidden: !currentlyHidden, folderPath });
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to toggle folder visibility' });
      }
    }
  );

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
        const sourceRootRelativePath = deriveSourceRootRelativePath(sourceId);

        const sourceFolders = db
          .prepare(
            `
              SELECT id, absolute_path, relative_path_from_root, name
              FROM folders
              WHERE user_id = ?
                AND storage_mode = 'local'
              ORDER BY relative_path_from_root ASC
            `
          )
          .all(userId) as FolderRow[];

        const filteredFolders = sourceFolders.filter((folder) =>
          isPathInSubtree(folder.relative_path_from_root, sourceRootRelativePath)
        );

        const presentFiles = db
          .prepare('SELECT file_id, folder_id FROM file_paths WHERE user_id = ? AND is_present = 1')
          .all(userId) as FileRow[];

        const hiddenRows = db
          .prepare('SELECT file_id FROM user_hidden_files WHERE user_id = ?')
          .all(userId) as Array<{ file_id: string }>;
        const hiddenSet = new Set(hiddenRows.map((row) => row.file_id));

        const hiddenFolders: Array<{ folder_path: string }> = [];

        for (const folder of filteredFolders) {
          const subtreeFolderIds = collectSubtreeFolderIds(filteredFolders, folder.relative_path_from_root);
          const subtreeFileIds = presentFiles
            .filter((file) => file.folder_id && subtreeFolderIds.has(file.folder_id))
            .map((file) => file.file_id);

          if (subtreeFileIds.length === 0) {
            continue;
          }

          if (subtreeFileIds.every((fileId) => hiddenSet.has(fileId))) {
            hiddenFolders.push({ folder_path: folder.absolute_path });
          }
        }

        return reply.send(hiddenFolders);
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to retrieve hidden folders' });
      }
    }
  );
}
