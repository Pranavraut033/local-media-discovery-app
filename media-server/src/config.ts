import os from 'os';
import path from 'path';

function resolveHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export const config = {
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '3002', 10),
  },
  // Shared HMAC secret used to sign and verify stream tokens issued by the backend.
  // MUST match MEDIA_SERVER_SECRET set in the backend process.
  mediaServerSecret: process.env.MEDIA_SERVER_SECRET || 'media-server-default-secret-change-me',
  // Where encrypted cached copies of media files are stored on the local SSD.
  cacheDir: resolveHome(process.env.CACHE_DIR || '~/media-cache'),
  // Auto-generated AES-256 key persisted in this file (hex-encoded, 64 chars).
  keyfilePath: resolveHome(process.env.KEYFILE_PATH || '~/.media-server-key'),
  // Max total cache size in GB before LRU eviction kicks in.
  cacheMaxGb: parseFloat(process.env.CACHE_MAX_GB || '50'),
  // Max concurrent background cache-fill downloads from the mount.
  downloadConcurrency: parseInt(process.env.DOWNLOAD_CONCURRENCY || '3', 10),
  // Warning if running with the default insecure secret.
  get isDefaultSecret(): boolean {
    return this.mediaServerSecret === 'media-server-default-secret-change-me';
  },
} as const;
