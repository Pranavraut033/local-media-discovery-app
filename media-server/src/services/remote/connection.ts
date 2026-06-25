/**
 * Fetches and memoizes remote server connection info from the backend.
 * Credentials never reach the browser — the media-server resolves them here.
 */
import { config } from '../../config.js';

export interface ServerConnection {
  serverType: 'rclone' | 'webdav';
  rcloneRemoteType?: string | null;
  connection: Record<string, string>;
}

// ponytail: in-memory memo per serverId — fine for a single-process media-server
const cache = new Map<string, { value: ServerConnection; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000; // 5 min

export async function getServerConnection(serverId: string): Promise<ServerConnection> {
  const cached = cache.get(serverId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const resp = await fetch(
    `${config.backendInternalUrl}/api/internal/servers/${serverId}/connection`,
    { headers: { 'x-internal-secret': config.mediaServerSecret }, signal: AbortSignal.timeout(5_000) }
  );
  if (!resp.ok) throw new Error(`Backend returned ${resp.status} for server ${serverId}`);
  const value = (await resp.json()) as ServerConnection;
  cache.set(serverId, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}
