/**
 * GET /stream?token=<streamToken>
 *
 * Serves media with full HTTP Range support.
 *
 * Flow:
 *  1. Verify the stream token (HMAC-SHA256, signed by the backend).
 *  2. If the file is cached on SSD: decrypt and serve the requested range.
 *  3. If NOT cached: stream directly from the rclone VFS mount path (POSIX
 *     file read, fully range-capable) AND enqueue a background cache-fill so
 *     the next request will be served from fast local storage.
 *
 * Live requests are never queued — users always get data immediately.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { verifyStreamToken } from '../tokens.js';
import { config } from '../config.js';
import { getCachedFileInfo, createDecryptRangeStream } from '../services/cache.js';
import { enqueueDownload, DownloadPriority } from '../services/queue.js';

interface StreamQuery {
  token?: string;
}

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

function parseRange(
  rangeHeader: string,
  fileSize: number
): { start: number; end: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const rawStart = match[1];
  const rawEnd = match[2];

  // Suffix range: bytes=-500
  if (rawStart === '' && rawEnd !== '') {
    const suffix = parseInt(rawEnd, 10);
    return { start: Math.max(0, fileSize - suffix), end: fileSize - 1 };
  }

  const start = rawStart !== '' ? parseInt(rawStart, 10) : 0;
  const end = rawEnd !== '' ? parseInt(rawEnd, 10) : fileSize - 1;

  if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) return null;
  return { start, end };
}

export default async function streamRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: StreamQuery }>(
    '/stream',
    async (
      request: FastifyRequest<{ Querystring: StreamQuery }>,
      reply: FastifyReply
    ) => {
      const rawToken = request.query.token;
      if (!rawToken) {
        return reply.code(401).send({ error: 'Missing token' });
      }

      let payload;
      try {
        payload = verifyStreamToken(rawToken, config.mediaServerSecret);
      } catch (err) {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }

      const { mediaId, path: mountPath, ext, type } = payload;
      const contentType = MIME_MAP[ext] || 'application/octet-stream';

      // ── 1. Try cached path first ──────────────────────────────────────────
      const cached = await getCachedFileInfo(mediaId);

      if (cached) {
        const { plaintextSize } = cached;
        const rangeHeader = request.headers.range;

        if (rangeHeader) {
          const range = parseRange(rangeHeader, plaintextSize);
          if (!range) {
            return reply
              .code(416)
              .header('Content-Range', `bytes */${plaintextSize}`)
              .send({ error: 'Range Not Satisfiable' });
          }

          const { start, end } = range;
          const chunkSize = end - start + 1;
          const stream = createDecryptRangeStream(cached, start, end);

          return reply
            .code(206)
            .header('Content-Range', `bytes ${start}-${end}/${plaintextSize}`)
            .header('Accept-Ranges', 'bytes')
            .header('Content-Length', String(chunkSize))
            .header('Content-Type', contentType)
            .header('Cache-Control', 'public, max-age=3600')
            .send(stream);
        }

        // Full file from cache.
        const stream = createDecryptRangeStream(cached, 0, plaintextSize - 1);
        return reply
          .code(200)
          .header('Content-Length', String(plaintextSize))
          .header('Content-Type', contentType)
          .header('Accept-Ranges', 'bytes')
          .header('Cache-Control', 'public, max-age=3600')
          .send(stream);
      }

      // ── 2. Not cached — serve directly from mount path ───────────────────
      let fileStat: fs.Stats;
      try {
        fileStat = await fsp.stat(mountPath);
        if (!fileStat.isFile()) {
          return reply.code(404).send({ error: 'File not found on mount' });
        }
      } catch {
        return reply.code(503).send({ error: 'Mount path unavailable' });
      }

      const fileSize = fileStat.size;
      const rangeHeader = request.headers.range;

      // Kick off a background cache-fill (non-blocking, won't slow this response).
      enqueueDownload(mediaId, mountPath, DownloadPriority.NEAR);

      if (rangeHeader) {
        const range = parseRange(rangeHeader, fileSize);
        if (!range) {
          return reply
            .code(416)
            .header('Content-Range', `bytes */${fileSize}`)
            .send({ error: 'Range Not Satisfiable' });
        }

        const { start, end } = range;
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(mountPath, { start, end });

        return reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
          .header('Accept-Ranges', 'bytes')
          .header('Content-Length', String(chunkSize))
          .header('Content-Type', contentType)
          .header('Cache-Control', 'public, max-age=3600')
          .send(stream);
      }

      const stream = fs.createReadStream(mountPath);
      return reply
        .code(200)
        .header('Content-Length', String(fileSize))
        .header('Content-Type', contentType)
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'public, max-age=3600')
        .send(stream);
    }
  );
}
