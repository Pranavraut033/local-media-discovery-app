/**
 * GET /stream?token=<streamToken>
 *
 * Serves media with full HTTP Range support.
 *
 * Flow:
 *  1. Verify the stream token (HMAC-SHA256, signed by the backend).
 *  2. If the file is cached on SSD: decrypt and serve the requested range.
 *  3. If NOT cached:
 *     - Local, and rclone-mode remote (read from its FUSE mount): stream
 *       directly from the filesystem path (POSIX file read).
 *     - Webdav-without-rclone: fetch range from the WebDAV server directly.
 *
 * Live requests are never queued — users always get data immediately.
 * Background prefetch fills the cache so next request is served from SSD.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { verifyStreamToken } from '../tokens.js';
import { config } from '../config.js';
import { getCachedFileInfo, createDecryptRangeStream, markCacheAccessed } from '../services/cache.js';
import { openRemoteRange } from '../services/remote/fetcher.js';
import { acquireLiveLane, releaseLiveLane } from '../services/queue.js';

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

function readStreamOrFail(
  fastify: FastifyInstance,
  mountPath: string,
  options?: { start: number; end: number }
): fs.ReadStream {
  const stream = options ? fs.createReadStream(mountPath, options) : fs.createReadStream(mountPath);

  // rclone's VFS can report a file via stat() but fail to actually open it
  // (stale/incomplete directory listing). Without this handler, the
  // ReadStream's 'error' event is unhandled and crashes the whole process,
  // taking down every other in-flight stream.
  stream.on('error', (err) => {
    fastify.log.error({ err, mountPath }, 'Failed to read file from mount');
    stream.destroy();
  });

  return stream;
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

      const { mediaId, path: mountPath, ext, type, storageMode, serverId, remotePath } = payload;
      const contentType = MIME_MAP[ext] || 'application/octet-stream';
      // rclone-mode files are read from the FUSE mount via the local-file branch below
      // (their `path` is already the resolved mount path) — only webdav (no mount)
      // needs the live remote-fetch path here.
      const isRemote = storageMode === 'webdav';

      // ── 1. Try cached path first ──────────────────────────────────────────
      const cached = await getCachedFileInfo(mediaId);

      if (cached) {
        // Keep LRU metadata fresh for eviction ordering.
        void markCacheAccessed(mediaId);

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

      // ── 2. Not cached ─────────────────────────────────────────────────────

      if (isRemote && serverId && remotePath) {
        // Remote file (webdav-without-rclone only — rclone-mode reaches the
        // local-file branch below instead): ranged fetch over HTTP, which
        // supports Range natively.
        //
        // The remote can't serve many concurrent live ranges, so this request
        // holds a "live lane" (pausing background cache-fills) for as long as
        // it streams, and aborts its upstream fetch the instant the client
        // disconnects (e.g. the frontend's hover-preempt `video.load()`) —
        // otherwise the next hovered video would wait for this one to finish
        // even though nobody is reading it anymore.
        const rangeHeader = request.headers.range;
        const abortController = new AbortController();
        const onClientClose = () => abortController.abort();
        request.raw.on('close', onClientClose);
        acquireLiveLane();

        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          request.raw.off('close', onClientClose);
          releaseLiveLane();
        };

        try {
          if (rangeHeader) {
            // Fetch the requested range directly — no need for total size upfront.
            const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
            const start = match?.[1] ? parseInt(match[1], 10) : undefined;
            const end = match?.[2] ? parseInt(match[2], 10) : undefined;
            const { stream, size } = await openRemoteRange(serverId, remotePath, start, end, abortController.signal);
            stream.once('close', cleanup);
            stream.once('error', cleanup);
            const chunkSize = size ?? ((start !== undefined && end !== undefined) ? end - start + 1 : undefined);
            const replyWithRange = reply
              .code(206)
              .header('Accept-Ranges', 'bytes')
              .header('Content-Type', contentType);
            if (chunkSize) replyWithRange.header('Content-Length', String(chunkSize));
            return replyWithRange.send(stream);
          }

          const { stream, size } = await openRemoteRange(serverId, remotePath, undefined, undefined, abortController.signal);
          stream.once('close', cleanup);
          stream.once('error', cleanup);
          const r = reply.code(200).header('Content-Type', contentType).header('Accept-Ranges', 'bytes');
          if (size) r.header('Content-Length', String(size));
          return r.send(stream);
        } catch (err) {
          cleanup();
          fastify.log.error({ err, remotePath }, '[stream] remote fetch failed');
          return reply.code(502).send({ error: 'Remote fetch failed' });
        }
      }

      // ── 3. Local file — stream directly from filesystem ───────────────────
      // ponytail: no auto-cache on stream — random feed items are one-shot, caching them
      // wastes budget. Only the /prefetch endpoint caches (near items the user is about to see).
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
        const stream = readStreamOrFail(fastify, mountPath, { start, end });

        return reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
          .header('Accept-Ranges', 'bytes')
          .header('Content-Length', String(chunkSize))
          .header('Content-Type', contentType)
          .header('Cache-Control', 'public, max-age=3600')
          .send(stream);
      }

      const stream = readStreamOrFail(fastify, mountPath);
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
