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
  // Minimum cache budget in GB. Small because only near-window items are cached (not every stream).
  cacheMinGb: parseFloat(process.env.CACHE_MIN_GB || '2'),
  // Dynamic budget based on currently available free disk bytes (0..1).
  // 5% is plenty when only 3 items are pre-cached at a time; raise via env var if desired.
  cacheFreeSpacePercent: parseFloat(process.env.CACHE_FREE_SPACE_PERCENT || '0.05'),
  // Max concurrent background cache-fill downloads from the mount.
  // ponytail: 1, not 3 — concurrent remote reads are the actual bottleneck
  // (rcd/WebDAV can't serve them in parallel); sequential fills are proven fine.
  downloadConcurrency: parseInt(process.env.DOWNLOAD_CONCURRENCY || '1', 10),
  // rclone rcd sidecar — for ranged GET of remote files without a FUSE mount.
  rcloneRcUrl: process.env.RCLONE_RC_URL || 'http://127.0.0.1:5574',
  rcloneRcUser: process.env.RCLONE_RC_USER || 'local-media',
  rcloneRcPass: process.env.RCLONE_RC_PASS || 'local-media-rcd-pass',
  // Internal backend URL for decrypting server credentials.
  backendInternalUrl: process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:3001',
  // Warning if running with the default insecure secret.
  get isDefaultSecret(): boolean {
    return this.mediaServerSecret === 'media-server-default-secret-change-me';
  },
} as const;
