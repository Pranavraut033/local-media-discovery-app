/**
 * Provider registry — adding a new server type = add one entry here.
 */
import { rcloneProvider } from './rclone.provider.js';
import { webdavProvider } from './webdav.provider.js';
import type { RemoteProvider } from './types.js';

const registry: Record<string, RemoteProvider> = {
  rclone: rcloneProvider,
  webdav: webdavProvider,
};

export function getProvider(serverType: string): RemoteProvider {
  const p = registry[serverType];
  if (!p) throw new Error(`Unknown server type: ${serverType}`);
  return p;
}
