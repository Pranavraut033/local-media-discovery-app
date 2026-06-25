/**
 * Rclone remote provider.
 * Uses the local rcd sidecar (rclone rcd --rc-serve) for listing and validation.
 * File bytes are fetched directly from the rcd HTTP server (range-capable).
 */
import mime from 'mime-types';
import { getRcdClient } from '../rclone-rcd.js';
import type { RemoteProvider, RemoteServer, RemoteListing, RemoteFileInfo } from './types.js';

const MEDIA_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function mediaKind(ext: string): 'image' | 'video' | null {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
  return null;
}

// Some rclone crypt configs report a literal "." root segment (their `remote =`
// param ends in a bare dot, e.g. "Base:."), which leaks into decrypted listing
// paths as "remote:./sub/path" — not a valid rcd serve path. Strip it so newly
// indexed/discovered paths never store the bad form.
function normalizeRclonePath(p: string): string {
  return p.replace(/^([^:]+:)\.\/?/, '$1');
}

function rcloneFsPath(connection: Record<string, string>, dir: string): string {
  // connection.remoteName is like "mysftp", dir is "mysftp:photos/vacation"
  // The rcd /operations/list call needs fs = "mysftp:" and remote = "photos/vacation"
  // We store absolutePath as "remoteName:relpath" so strip the prefix.
  return dir;
}

export const rcloneProvider: RemoteProvider = {
  async validate(connection) {
    const client = getRcdClient();
    if (!client) throw new Error('rclone daemon not running');
    const remoteName = connection.remoteName;
    if (!remoteName) throw new Error('connection.remoteName is required');
    try {
      await client.listDir(`${remoteName}:`, '');
    } catch (err: any) {
      // Extract rcd's error body (e.g. "didn't find section in config file")
      const rcdMsg = err?.response?.data?.error ?? err?.response?.data ?? err?.message;
      throw new Error(`rclone remote "${remoteName}": ${rcdMsg}`);
    }
  },

  async list(server, dir) {
    const client = getRcdClient();
    if (!client) throw new Error('rclone daemon not running');

    // dir format: "remoteName:some/path" or "remoteName:" for root.
    // Empty dir means list the server root — use cryptRemoteName if present.
    const rootName = server.connection.cryptRemoteName ?? server.connection.remoteName ?? '';
    const effectiveDir = normalizeRclonePath(dir || `${rootName}:`);

    const colonIdx = effectiveDir.indexOf(':');
    const fsStr = colonIdx >= 0 ? effectiveDir.slice(0, colonIdx + 1) : effectiveDir + ':';
    const remote = colonIdx >= 0 ? effectiveDir.slice(colonIdx + 1) : '';

    let items;
    try {
      items = await client.listDir(fsStr, remote);
    } catch (err: any) {
      const rcdMsg = err?.response?.data?.error ?? err?.response?.data ?? err?.message;
      throw new Error(`rclone list "${effectiveDir}": ${rcdMsg}`);
    }
    const dirs = items
      .filter((i) => i.isDir)
      .map((i) => ({
        name: i.name,
        path: remote ? `${fsStr}${remote}/${i.name}` : `${fsStr}${i.name}`,
        accessible: true,
      }));

    const parentPath = remote
      ? remote.includes('/')
        ? `${fsStr}${remote.split('/').slice(0, -1).join('/')}`
        : fsStr.replace(/:$/, ':')
      : null;

    return { currentPath: effectiveDir, parentPath, directories: dirs };
  },

  async scanMedia(server, dir, onBatch) {
    const client = getRcdClient();
    if (!client) throw new Error('rclone daemon not running');

    const colonIdx = dir.indexOf(':');
    const fsStr = colonIdx >= 0 ? dir.slice(0, colonIdx + 1) : dir + ':';
    const baseRemote = colonIdx >= 0 ? dir.slice(colonIdx + 1) : '';

    // Use fast-list (recursive) for efficiency; rcd /operations/list with opt.recurse
    const allItems = await client.listRecursive(fsStr, baseRemote);
    const BATCH = 50;
    let batch: RemoteFileInfo[] = [];

    for (const item of allItems) {
      if (item.isDir) continue;
      const ext = '.' + item.name.split('.').pop()!.toLowerCase();
      const kind = mediaKind(ext);
      if (!kind) continue;

      const relPath = baseRemote
        ? item.path.startsWith(baseRemote + '/')
          ? item.path.slice(baseRemote.length + 1)
          : item.path
        : item.path;

      batch.push({
        absolutePath: normalizeRclonePath(`${fsStr}${item.path}`),
        relativePath: relPath,
        fileName: item.name,
        sizeBytes: item.size ?? 0,
        mediaKind: kind,
        mimeType: mime.lookup(ext) || null,
        extension: ext,
      });

      if (batch.length >= BATCH) {
        await onBatch(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await onBatch(batch);
  },
};
