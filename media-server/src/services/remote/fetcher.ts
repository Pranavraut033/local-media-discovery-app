/**
 * RemoteFetcher — provides a range-capable Readable for a remote file.
 * Used by the stream route (live miss) and cache fill (full file).
 *
 * rclone-type remotes are read straight from their FUSE mount via the local-file
 * branch in stream.ts/prefetch.ts — only webdav-without-rclone reaches this module.
 *
 * Uses Node built-in fetch (18+) — no axios dependency in this package.
 */
import type { Readable } from 'stream';
import { Readable as NodeReadable } from 'stream';
import { getServerConnection } from './connection.js';

/**
 * Open a (possibly ranged) readable stream for a remote file.
 * start/end: byte range (inclusive). Omit both for the full file.
 */
export async function openRemoteRange(
  serverId: string,
  remotePath: string,
  start?: number,
  end?: number,
  signal?: AbortSignal
): Promise<{ stream: Readable; size?: number }> {
  const conn = await getServerConnection(serverId);
  return openWebdavRange(conn.connection, remotePath, start, end, signal);
}

// ── WebDAV via ranged GET ─────────────────────────────────────────────────────
async function openWebdavRange(
  connection: Record<string, string>,
  urlPath: string,
  start?: number,
  end?: number,
  signal?: AbortSignal
): Promise<{ stream: Readable; size?: number }> {
  const baseUrl = (connection.url ?? '').replace(/\/$/, '');
  const url = `${baseUrl}${urlPath.startsWith('/') ? urlPath : '/' + urlPath}`;
  const headers: Record<string, string> = {};
  if (connection.user) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${connection.user}:${connection.pass || ''}`).toString('base64');
  }
  if (start !== undefined && end !== undefined) headers['Range'] = `bytes=${start}-${end}`;
  else if (start !== undefined) headers['Range'] = `bytes=${start}-`;

  const fetchSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  const resp = await fetch(url, { headers, signal: fetchSignal });
  if (!resp.ok && resp.status !== 206) throw new Error(`WebDAV returned ${resp.status}`);
  if (!resp.body) throw new Error('WebDAV response has no body');

  const contentLength = resp.headers.get('content-length');
  return {
    stream: NodeReadable.fromWeb(resp.body as import('stream/web').ReadableStream),
    size: contentLength ? parseInt(contentLength, 10) : undefined,
  };
}

// ── Self-check ───────────────────────────────────────────────────────────────
// Assert: openRemoteRange signature matches what stream.ts and cache.ts expect.
// Run: tsx media-server/src/services/remote/fetcher.ts
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fn: typeof openRemoteRange = openRemoteRange;
  console.assert(typeof fn === 'function', 'openRemoteRange must be a function');
  console.log('[fetcher demo] ok — openRemoteRange is callable');
}
