/**
 * WebDAV remote provider.
 * Direct client via axios PROPFIND — no rclone involved.
 * Range-capable fetching is handled by the media-server RemoteFetcher.
 */
import axios, { type AxiosInstance } from 'axios';
import mime from 'mime-types';
import type { RemoteProvider, RemoteServer, RemoteListing, RemoteFileInfo } from './types.js';

const MEDIA_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function mediaKind(ext: string): 'image' | 'video' | null {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
  return null;
}

export function makeClient(connection: Record<string, string>): AxiosInstance {
  const cfg: any = { baseURL: connection.url, timeout: 30_000 };
  if (connection.user) cfg.auth = { username: connection.user, password: connection.pass || '' };
  return axios.create(cfg);
}

/** Fetch a whole file's bytes. Used by the backend's own thumbnail generator. */
export async function fetchWebdavFile(connection: Record<string, string>, remotePath: string): Promise<Buffer> {
  const client = makeClient(connection);
  const res = await client.get(remotePath, { responseType: 'arraybuffer' });
  return Buffer.from(res.data as ArrayBuffer);
}

interface DavEntry {
  href: string;
  name: string;
  size: number;
  isDir: boolean;
}

/** Minimal PROPFIND XML response parser — extracts href/size/isDir per response element. */
function parsePropfind(xml: string, baseUrl: string): DavEntry[] {
  const responses = xml.match(/<[^:]*:response[^>]*>([\s\S]*?)<\/[^:]*:response>/gi) ?? [];
  const results: DavEntry[] = [];
  for (const resp of responses) {
    const hrefMatch = resp.match(/<[^:]*:href[^>]*>([\s\S]*?)<\/[^:]*:href>/i);
    if (!hrefMatch) continue;
    const rawHref = hrefMatch[1].trim();
    // Decode and normalise
    const href = decodeURIComponent(rawHref).replace(/\/+$/, '');
    const isDir = /<[^:]*:collection\s*\/?>/i.test(resp);
    const sizeMatch = resp.match(/<[^:]*:getcontentlength[^>]*>([\s\S]*?)<\/[^:]*:getcontentlength>/i);
    const size = sizeMatch ? parseInt(sizeMatch[1].trim(), 10) : 0;
    const name = href.split('/').pop() || '';
    results.push({ href, name, size, isDir });
  }
  return results;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;

async function propfind(client: AxiosInstance, urlPath: string, depth: '0' | '1' | 'infinity'): Promise<DavEntry[]> {
  const response = await client.request({
    method: 'PROPFIND',
    url: urlPath || '/',
    headers: { Depth: depth, 'Content-Type': 'application/xml' },
    data: PROPFIND_BODY,
    responseType: 'text',
  });
  return parsePropfind(response.data as string, urlPath);
}

export const webdavProvider: RemoteProvider = {
  async validate(connection) {
    if (!connection.url) throw new Error('connection.url is required');
    const client = makeClient(connection);
    // OPTIONS to check server is up and supports WebDAV
    const resp = await client.options(connection.url);
    if (!resp.headers.dav && !resp.headers.DAV) {
      throw new Error('Server does not expose DAV header — is this a WebDAV server?');
    }
  },

  async list(server, dir) {
    const client = makeClient(server.connection);
    // dir is a URL path like "/photos/vacation"
    const entries = await propfind(client, dir || '/', '1');
    // First entry is the directory itself — skip it
    const children = entries.filter((e) => e.href !== (dir || '/') && e.href !== dir);
    const directories = children
      .filter((e) => e.isDir)
      .map((e) => ({ name: e.name, path: e.href, accessible: true }));

    const parent = dir && dir !== '/'
      ? dir.includes('/') ? dir.split('/').slice(0, -1).join('/') || '/' : '/'
      : null;

    return { currentPath: dir || '/', parentPath: parent, directories };
  },

  async scanMedia(server, dir, onBatch) {
    const client = makeClient(server.connection);
    // Depth:infinity is supported by most WebDAV servers; fall back to recursive if not
    let entries: DavEntry[];
    try {
      entries = await propfind(client, dir || '/', 'infinity');
    } catch {
      // Server rejected Depth:infinity — walk recursively
      entries = await walkRecursive(client, dir || '/');
    }

    const BATCH = 50;
    let batch: RemoteFileInfo[] = [];
    const base = (dir || '/').replace(/\/$/, '');

    for (const entry of entries) {
      if (entry.isDir) continue;
      const ext = '.' + entry.name.split('.').pop()!.toLowerCase();
      const kind = mediaKind(ext);
      if (!kind) continue;
      const relPath = entry.href.startsWith(base + '/')
        ? entry.href.slice(base.length + 1)
        : entry.href;

      batch.push({
        absolutePath: entry.href,
        relativePath: relPath,
        fileName: entry.name,
        sizeBytes: entry.size,
        mediaKind: kind,
        mimeType: mime.lookup(ext) || null,
        extension: ext,
      });
      if (batch.length >= BATCH) { await onBatch(batch); batch = []; }
    }
    if (batch.length > 0) await onBatch(batch);
  },
};

async function walkRecursive(client: AxiosInstance, dir: string): Promise<DavEntry[]> {
  const entries = await propfind(client, dir, '1');
  const result: DavEntry[] = [];
  for (const e of entries) {
    if (e.href === dir) continue;
    result.push(e);
    if (e.isDir) result.push(...await walkRecursive(client, e.href));
  }
  return result;
}
