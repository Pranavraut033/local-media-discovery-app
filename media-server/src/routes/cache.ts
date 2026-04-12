/**
 * GET  /cache/info   — returns cache size and queue status
 * DELETE /cache      — removes all cached .enc files (maintenance)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { getQueueStatus } from '../services/queue.js';

export default async function cacheRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/cache/info',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      let totalBytes = 0;
      let fileCount = 0;
      try {
        const files = await fsp.readdir(config.cacheDir);
        const enc = files.filter((f) => f.endsWith('.enc'));
        const stats = await Promise.all(
          enc.map((f) => fsp.stat(path.join(config.cacheDir, f)))
        );
        fileCount = enc.length;
        totalBytes = stats.reduce((s, st) => s + st.size, 0);
      } catch {
        // Cache dir may not exist yet — that's fine.
      }

      return reply.send({
        cacheDir: config.cacheDir,
        fileCount,
        totalBytes,
        totalMb: Math.round(totalBytes / 1024 / 1024),
        maxGb: config.cacheMaxGb,
        queue: getQueueStatus(),
      });
    }
  );

  fastify.delete(
    '/cache',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      let removed = 0;
      try {
        const files = await fsp.readdir(config.cacheDir);
        await Promise.all(
          files
            .filter((f) => f.endsWith('.enc') || f.endsWith('.enc.tmp'))
            .map(async (f) => {
              await fsp.unlink(path.join(config.cacheDir, f)).catch(() => undefined);
              removed++;
            })
        );
      } catch {
        // Nothing to delete
      }
      return reply.send({ removed });
    }
  );
}
