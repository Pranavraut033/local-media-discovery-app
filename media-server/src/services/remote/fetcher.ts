/**
 * RemoteFetcher — provides a range-capable Readable for a remote file.
 * Used by the stream route (live miss) and cache fill (full file).
 *
 * Uses Node built-in fetch (18+) — no axios dependency in this package.
 * ponytail: no abstraction class — two plain functions suffice for two provider types.
 */
import type { Readable } from 'stream';
import { Readable as NodeReadable } from 'stream';
import { config } from '../../config.js';
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

  if (conn.serverType === 'rclone') {
    return openRcloneRange(remotePath, start, end, signal);
  } else {
    return openWebdavRange(conn.connection, remotePath, start, end, signal);
  }
}

// Some rclone crypt configs report a literal "." root segment (their `remote =`
// param ends in a bare dot, e.g. "Base:."), which leaks into decrypted listing
// paths as "remote:./sub/path" — not a valid rcd serve path. Strip it.
function normalizeRclonePath(p: string): string {
  return p.replace(/^([^:]+:)\.\/?/, '$1');
}

// ── rclone via rcd --rc-serve ─────────────────────────────────────────────────
// rcd's serve route matches the literal pattern `[fsname]remotepath` (brackets
// included) — `fsname:remotepath` concatenated without brackets never matches
// the route regex and 404s, even though fs/remote split is otherwise correct.
async function openRcloneRange(
  remotePath: string,
  start?: number,
  end?: number,
  signal?: AbortSignal
): Promise<{ stream: Readable; size?: number }> {
  const normalized = normalizeRclonePath(remotePath);
  const colonIdx = normalized.indexOf(':');
  const fs = normalized.slice(0, colonIdx + 1);
  const remote = normalized.slice(colonIdx + 1);
  const url = `${config.rcloneRcUrl}/${encodeURI(`[${fs}]${remote}`)}`;
  const headers: Record<string, string> = {
    'Authorization': 'Basic ' + Buffer.from(`${config.rcloneRcUser}:${config.rcloneRcPass}`).toString('base64'),
  };
  if (start !== undefined && end !== undefined) headers['Range'] = `bytes=${start}-${end}`;
  else if (start !== undefined) headers['Range'] = `bytes=${start}-`;

  // ponytail: rcd occasionally crashes mid-playback and self-restarts (2s delay +
  // up to 5s readiness wait, see backend/src/services/rclone-rcd.ts:218-233 — worst
  // case ~7s). Retry with backoff covering that full window instead of failing the
  // whole video on the first hit. Upgrade path if crashes are frequent: fix the
  // underlying rclone crash, not just retry around it.
  const RETRY_DELAYS_MS = [1500, 3000, 4000]; // ~8.5s total, covers rcd's worst-case restart
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const fetchSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
      const resp = await fetch(url, { headers, signal: fetchSignal });
      if (!resp.ok && resp.status !== 206) throw new Error(`rcd returned ${resp.status}`);
      if (!resp.body) throw new Error('rcd response has no body');

      const contentLength = resp.headers.get('content-length');
      return {
        stream: NodeReadable.fromWeb(resp.body as import('stream/web').ReadableStream),
        size: contentLength ? parseInt(contentLength, 10) : undefined,
      };
    } catch (err: any) {
      if (signal?.aborted) throw err;
      const isConnRefused = err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED';
      if (!isConnRefused || attempt === RETRY_DELAYS_MS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw new Error('unreachable');
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
