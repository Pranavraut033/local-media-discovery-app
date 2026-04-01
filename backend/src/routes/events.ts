/**
 * SSE (Server-Sent Events) Route
 * Streams typed indexing progress events to authenticated clients.
 * Authentication: JWT token passed as `?token=` query param (SSE cannot set request headers).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sseEventBus, type SSEEvent } from '../queue/events.js';
import { getDatabase } from '../db/index.js';

interface SseQuery {
  token?: string;
}

export default async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/events/stream?token=<jwt>
  fastify.get<{ Querystring: SseQuery }>(
    '/api/events/stream',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.query as SseQuery;

      if (!token) {
        return reply.code(401).send({ error: 'Missing token' });
      }

      // Verify JWT manually (SSE clients cannot set Authorization header)
      let userId: string;
      try {
        const decoded = fastify.jwt.verify<{ userId: string }>(token);
        userId = decoded.userId;
      } catch {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
      });

      const send = (event: SSEEvent) => {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify({ jobId: event.jobId, ...(event.payload ?? {}) })}\n\n`);
      };

      // Send pending jobs on connect
      sendPendingJobs(userId, send);

      // Keep-alive ping every 25 s
      const pingInterval = setInterval(() => {
        reply.raw.write(': ping\n\n');
      }, 25_000);

      const unsubscribe = sseEventBus.subscribe(userId, send);

      request.raw.on('close', () => {
        clearInterval(pingInterval);
        unsubscribe();
      });

      // Keep connection open
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
        request.raw.on('aborted', resolve);
      });

      return reply;
    }
  );

  // GET /api/events/jobs – list active/recent jobs for the authenticated user
  fastify.get(
    '/api/events/jobs',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest) => {
      const userId = (request as any).user!.userId as string;
      const db = getDatabase();

      const jobs = db
        .prepare(
          `SELECT id, job_type, status, total_files, processed_files, source_path, error, created_at, updated_at
           FROM indexing_jobs
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 20`
        )
        .all(userId);

      return { jobs };
    }
  );
}

function sendPendingJobs(userId: string, send: (e: SSEEvent) => void): void {
  try {
    const db = getDatabase();
    const active = db
      .prepare(
        `SELECT id, status, total_files, processed_files, source_path
         FROM indexing_jobs
         WHERE user_id = ? AND status IN ('queued', 'processing')
         ORDER BY created_at ASC`
      )
      .all(userId) as Array<{ id: string; status: string; total_files: number; processed_files: number; source_path: string }>;

    for (const job of active) {
      send({
        type: 'job_progress',
        jobId: job.id,
        payload: {
          status: job.status,
          total: job.total_files,
          done: job.processed_files,
          sourcePath: job.source_path,
        },
      });
    }
  } catch {
    // Non-fatal
  }
}
