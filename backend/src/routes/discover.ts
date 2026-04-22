/**
 * Discover Routes
 * Endpoints for the Discover page — random unseen media, session management
 */
import type { FastifyInstance } from 'fastify';
import path from 'path';
import { getDatabase } from '../db/index.js';
import { signStreamToken } from '../tokens.js';
import {
  getDiscoverFeed,
  appendDiscoverSession,
  resetDiscoverSession,
  getDiscoverSessionMeta,
} from '../services/discover.js';

const MEDIA_SERVER_SECRET =
  process.env.MEDIA_SERVER_SECRET || 'media-server-default-secret-change-me';

interface DiscoverQuery {
  limit?: string;
}

interface AppendSessionBody {
  seenIds: string[];
}

function attachStreamToken(item: {
  id: string;
  path: string;
  type: string;
  storageMode?: string;
  [key: string]: unknown;
}) {
  // Rclone items cannot be served by the media-server (it only reads local paths).
  // Let them fall through to the backend's /api/media/file/:id rclone handler instead.
  if (item.storageMode === 'rclone') return item;
  const ext = path.extname(item.path).toLowerCase();
  if (!ext) return item;
  const kind: 'image' | 'video' =
    item.type === 'video' || (typeof item.type === 'string' && item.type.startsWith('video/'))
      ? 'video'
      : 'image';
  try {
    const streamToken = signStreamToken(
      { mediaId: item.id, path: item.path, ext, type: kind },
      MEDIA_SERVER_SECRET
    );
    return { ...item, streamToken };
  } catch {
    return item;
  }
}

function normalizeRelativePath(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function deriveRootChildFolder(rel: string): string {
  const norm = normalizeRelativePath(rel);
  if (!norm) return 'root';
  const segments = norm.split('/').filter(Boolean);
  return segments.length <= 1 ? 'root' : segments[0];
}

function deriveParentFolderName(rel: string): string | undefined {
  const norm = normalizeRelativePath(rel);
  if (!norm) return undefined;
  const segments = norm.split('/').filter(Boolean);
  if (segments.length <= 1) return undefined;
  return segments[segments.length - 2];
}

function deriveParentFolderPath(rel: string): string | undefined {
  const norm = normalizeRelativePath(rel);
  if (!norm) return undefined;
  const segments = norm.split('/').filter(Boolean);
  if (segments.length <= 1) return undefined;
  return segments.slice(0, -1).join('/');
}

export default async function discoverRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/discover
   * Returns a batch of random unseen (not liked, not saved) media for the user.
   * Query: limit=50|100 (default 50, capped at 100)
   */
  fastify.get<{ Querystring: DiscoverQuery }>(
    '/api/discover',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { userId: string }).userId;
      const rawLimit = parseInt(request.query.limit ?? '50', 10);
      const limit = Math.min(Math.max(rawLimit, 1), 100);

      const db = getDatabase();
      const rows = getDiscoverFeed(db, userId, limit);

      const feed = rows.map((row) => {
        const isRclone = row.storage_mode === 'rclone';
        const effectiveRelPath = isRclone
          ? row.relative_path_from_root.replace(/^[^/]+\/?/, '')
          : row.relative_path_from_root;

        const derivedRoot = deriveRootChildFolder(effectiveRelPath);
        let rootChildFolder: string;
        if (isRclone && (!derivedRoot || derivedRoot === 'root')) {
          const remoteMatch = row.source_id.match(/^rclone_(.+)_[0-9a-f]{8}$/);
          rootChildFolder = remoteMatch
            ? remoteMatch[1].replace(/_/g, ' ')
            : row.source_id;
        } else {
          rootChildFolder =
            derivedRoot && derivedRoot !== 'root'
              ? derivedRoot
              : row.source_id !== 'root'
                ? row.source_id
                : '';
        }

        const parentFolderName = isRclone
          ? deriveParentFolderName(effectiveRelPath)
          : deriveParentFolderName(row.relative_path_from_root);
        const parentFolderPath = deriveParentFolderPath(row.relative_path_from_root);

        const item = {
          id: row.id,
          path: row.path,
          type: row.type,
          sourceId: row.source_id,
          storageMode: row.storage_mode,
          rootChildFolder,
          parentFolderName,
          parentFolderPath,
          displayName: rootChildFolder || (row.source_id === 'root' ? 'Root' : row.source_id),
          avatarSeed: row.source_id,
          liked: false,
          saved: false,
          depth: row.depth,
        };

        return attachStreamToken(item);
      });

      return reply.send({ success: true, feed, count: feed.length });
    }
  );

  /**
   * GET /api/discover/session
   * Returns session metadata for the authenticated user (count of seen IDs).
   */
  fastify.get(
    '/api/discover/session',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { userId: string }).userId;
      const db = getDatabase();
      const meta = getDiscoverSessionMeta(db, userId);
      return reply.send({ success: true, ...meta });
    }
  );

  /**
   * POST /api/discover/session
   * Appends seen IDs to the user's discover session (auto-save on reshuffle).
   * Body: { seenIds: string[] }
   */
  fastify.post<{ Body: AppendSessionBody }>(
    '/api/discover/session',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { userId: string }).userId;
      const { seenIds } = request.body ?? {};

      if (!Array.isArray(seenIds)) {
        return reply.code(400).send({ error: 'seenIds must be an array' });
      }

      const db = getDatabase();
      appendDiscoverSession(db, userId, seenIds);
      const meta = getDiscoverSessionMeta(db, userId);
      return reply.send({ success: true, ...meta });
    }
  );

  /**
   * DELETE /api/discover/session
   * Clears the user's seen-IDs list. Liked/saved filters remain active.
   */
  fastify.delete(
    '/api/discover/session',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { userId: string }).userId;
      const db = getDatabase();
      resetDiscoverSession(db, userId);
      return reply.send({ success: true, seenCount: 0 });
    }
  );
}
