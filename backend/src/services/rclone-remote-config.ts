/**
 * Remote Rclone Configuration
 * Manages connection to Android/remote rclone daemon
 */

import type Database from 'better-sqlite3';
import { RemoteRcloneConfig } from './rclone-remote.js';

/**
 * Store and retrieve remote rclone configuration
 */
export function initializeRemoteRcloneConfig(db: Database.Database): void {
  // Create config table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_rclone_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 5572,
      username TEXT,
      password TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);
}

export function setRemoteRcloneConfig(
  db: Database.Database,
  config: Partial<RemoteRcloneConfig> & { enabled?: boolean }
): void {
  const { host, port = 5572, user, password, enabled = true } = config;

  if (!host) {
    throw new Error('Host is required');
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO remote_rclone_config (id, host, port, username, password, enabled, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(host, port, user || null, password || null, enabled ? 1 : 0, Math.floor(Date.now() / 1000));
}

export function getRemoteRcloneConfig(db: Database.Database): RemoteRcloneConfig & { enabled: boolean } {
  const stmt = db.prepare(`
    SELECT host, port, username as user, password, enabled FROM remote_rclone_config WHERE id = 1
  `);

  const result = stmt.get() as any;

  if (!result) {
    return {
      host: '',
      port: 5572,
      user: null,
      password: null,
      enabled: false,
    };
  }

  return {
    host: result.host,
    port: result.port,
    user: result.user,
    password: result.password,
    enabled: result.enabled === 1,
  };
}

export function disableRemoteRclone(db: Database.Database): void {
  const stmt = db.prepare(`
    UPDATE remote_rclone_config SET enabled = 0 WHERE id = 1
  `);

  stmt.run();
}

export function clearRemoteRcloneConfig(db: Database.Database): void {
  const stmt = db.prepare('DELETE FROM remote_rclone_config WHERE id = 1');
  stmt.run();
}
