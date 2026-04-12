/**
 * POST /prefetch
 * Body: { tokens: string[] }  — array of stream tokens in feed order.
 *
 * Accepts only valid stream tokens (no separate user JWT required — the
 * signed token proves the caller obtained it from the backend).
 *
 * Enqueues background cache-fill downloads in order of proximity:
 *   tokens[0..2]  → NEAR priority
 *   tokens[3..]   → FAR  priority
 *
 * Returns a summary of what was queued, already cached, and invalid.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyStreamToken } from '../tokens.js';
import { config } from '../config.js';
import { isCached } from '../services/cache.js';
import { enqueueDownload, DownloadPriority } from '../services/queue.js';

interface PrefetchBody {
  tokens?: unknown;
}

const NEAR_WINDOW = 3; // First N tokens get NEAR priority

export default async function prefetchRoute(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: PrefetchBody }>(
    '/prefetch',
    async (
      request: FastifyRequest<{ Body: PrefetchBody }>,
      reply: FastifyReply
    ) => {
      const body = request.body;
      if (!body || !Array.isArray(body.tokens)) {
        return reply.code(400).send({ error: 'Body must be { tokens: string[] }' });
      }

      const tokens = body.tokens.filter((t): t is string => typeof t === 'string').slice(0, 50);

      const queued: string[] = [];
      const already_cached: string[] = [];
      const invalid: number[] = [];

      for (let i = 0; i < tokens.length; i++) {
        let payload;
        try {
          payload = verifyStreamToken(tokens[i], config.mediaServerSecret);
        } catch {
          invalid.push(i);
          continue;
        }

        const { mediaId, path: mountPath } = payload;

        if (isCached(mediaId)) {
          already_cached.push(mediaId);
          continue;
        }

        const priority = i < NEAR_WINDOW ? DownloadPriority.NEAR : DownloadPriority.FAR;
        enqueueDownload(mediaId, mountPath, priority);
        queued.push(mediaId);
      }

      return reply.code(202).send({ queued, already_cached, invalid });
    }
  );
}
