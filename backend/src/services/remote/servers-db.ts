/**
 * DB helpers for remote_servers: CRUD + credential encryption.
 * Reuses encryptRcloneConfig / decryptRcloneConfig (AES-256-GCM, key = sha256(userId)).
 */
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { encryptRcloneConfig, decryptRcloneConfig } from '../rclone.js';
import type { RemoteServer } from './types.js';

export interface RemoteServerRow {
  id: string;
  user_id: string;
  server_type: string;
  display_name: string;
  rclone_remote_type: string | null;
  connection_encrypted: string;
  connection_nonce: string | null;
  connection_kdf_salt: string | null;
  created_at: number;
  updated_at: number;
}

export function listServers(db: Database.Database, userId: string): Omit<RemoteServer, 'connection'>[] {
  const rows = db.prepare(
    `SELECT id, user_id, server_type, display_name, rclone_remote_type, created_at
     FROM remote_servers WHERE user_id = ? ORDER BY created_at ASC`
  ).all(userId) as RemoteServerRow[];

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    serverType: r.server_type as 'rclone' | 'webdav',
    displayName: r.display_name,
    rcloneRemoteType: r.rclone_remote_type,
  }));
}

export function getServer(db: Database.Database, id: string, userId: string): RemoteServer | null {
  const row = db.prepare(
    `SELECT * FROM remote_servers WHERE id = ? AND user_id = ?`
  ).get(id, userId) as RemoteServerRow | undefined;
  if (!row) return null;
  return rowToServer(row, userId);
}

/** For internal use (e.g. media-server credential resolution) — no userId check. */
export function getServerById(db: Database.Database, id: string): RemoteServer | null {
  const row = db.prepare(`SELECT * FROM remote_servers WHERE id = ?`).get(id) as RemoteServerRow | undefined;
  if (!row) return null;
  return rowToServer(row, row.user_id);
}

function rowToServer(row: RemoteServerRow, userId: string): RemoteServer | null {
  const connection = decryptRcloneConfig(row.connection_encrypted, userId);
  if (!connection) return null;
  return {
    id: row.id,
    userId: row.user_id,
    serverType: row.server_type as 'rclone' | 'webdav',
    displayName: row.display_name,
    rcloneRemoteType: row.rclone_remote_type,
    connection,
  };
}

export function createServer(
  db: Database.Database,
  userId: string,
  serverType: 'rclone' | 'webdav',
  displayName: string,
  rcloneRemoteType: string | null,
  connection: Record<string, string>
): string {
  const id = randomUUID();
  const encrypted = encryptRcloneConfig(connection, userId);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO remote_servers (id, user_id, server_type, display_name, rclone_remote_type,
       connection_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, serverType, displayName, rcloneRemoteType, encrypted, now, now);
  return id;
}

export function updateServer(
  db: Database.Database,
  id: string,
  userId: string,
  displayName: string,
  rcloneRemoteType: string | null,
  connection: Record<string, string>
): boolean {
  const encrypted = encryptRcloneConfig(connection, userId);
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(
    `UPDATE remote_servers SET display_name=?, rclone_remote_type=?, connection_encrypted=?, updated_at=?
     WHERE id=? AND user_id=?`
  ).run(displayName, rcloneRemoteType, encrypted, now, id, userId);
  return result.changes > 0;
}

export function deleteServer(db: Database.Database, id: string, userId: string): boolean {
  const result = db.prepare(
    `DELETE FROM remote_servers WHERE id = ? AND user_id = ?`
  ).run(id, userId);
  return result.changes > 0;
}
