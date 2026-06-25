/**
 * Source projection helpers for schema v2.
 * A source is derived from the top-level segment of relative_path_from_root.
 */
import path from 'path';
import type Database from 'better-sqlite3';

export interface SourceInfoV2 {
  id: string;
  folderPath: string;
  displayName: string;
  avatarSeed: string;
}

function deriveFolderPath(rootFolder: string | null, sourceId: string): string {
  if (!rootFolder) {
    return sourceId;
  }
  if (sourceId === 'root') {
    return rootFolder;
  }
  return path.join(rootFolder, sourceId);
}

function getRootFolder(db: Database.Database, userId: string): string | null {
  const row = db
    .prepare('SELECT local_root_path FROM user_storage_configs WHERE user_id = ?')
    .get(userId) as { local_root_path: string } | undefined;

  return row?.local_root_path || null;
}

// Remote (rclone/webdav) sources are rooted at a folder whose relative_path_from_root
// has no '/' (same shape as the top-level segment derived below). Look up that folder's
// absolute_path and server display name so remote sources don't surface as a raw,
// subfolder-looking id.
function getRemoteSourceInfo(
  db: Database.Database,
  userId: string,
  sourceId: string
): { folderPath: string; displayName: string } | null {
  const row = db
    .prepare(
      `
        SELECT f.absolute_path AS absolutePath, rs.display_name AS displayName
        FROM folders f
        LEFT JOIN remote_servers rs ON rs.id = f.server_id
        WHERE f.user_id = ?
          AND f.relative_path_from_root = ?
          AND f.storage_mode IN ('rclone', 'webdav')
        LIMIT 1
      `
    )
    .get(userId, sourceId) as { absolutePath: string; displayName: string | null } | undefined;

  if (!row) {
    return null;
  }

  return { folderPath: row.absolutePath, displayName: row.displayName || sourceId };
}

export function getAllSourcesV2(db: Database.Database, userId: string): SourceInfoV2[] {
  const rows = db
    .prepare(
      `
        SELECT DISTINCT
          CASE
            WHEN instr(relative_path_from_root, '/') = 0 THEN 'root'
            ELSE substr(relative_path_from_root, 1, instr(relative_path_from_root, '/') - 1)
          END AS source_id
        FROM file_paths
        WHERE user_id = ?
          AND is_present = 1
        ORDER BY source_id ASC
      `
    )
    .all(userId) as Array<{ source_id: string }>;

  const rootFolder = getRootFolder(db, userId);

  const sourceIds = new Set(rows.map((row) => row.source_id));
  if (rootFolder) {
    sourceIds.add('root');
  }

  const orderedSourceIds = Array.from(sourceIds).sort((a, b) => {
    if (a === 'root') return -1;
    if (b === 'root') return 1;
    return a.localeCompare(b);
  });

  return orderedSourceIds.map((sourceId) => {
    if (sourceId === 'root') {
      return {
        id: sourceId,
        folderPath: deriveFolderPath(rootFolder, sourceId),
        displayName: 'Root',
        avatarSeed: sourceId,
      };
    }

    const remoteInfo = getRemoteSourceInfo(db, userId, sourceId);
    return {
      id: sourceId,
      folderPath: remoteInfo?.folderPath ?? deriveFolderPath(rootFolder, sourceId),
      displayName: remoteInfo?.displayName ?? sourceId,
      avatarSeed: sourceId,
    };
  });
}

export function getSourceByIdV2(db: Database.Database, userId: string, sourceId: string): SourceInfoV2 | null {
  const rootFolder = getRootFolder(db, userId);

  if (sourceId === 'root' && rootFolder) {
    return {
      id: 'root',
      folderPath: rootFolder,
      displayName: 'Root',
      avatarSeed: 'root',
    };
  }

  const row = db
    .prepare(
      `
        SELECT 1 AS exists_flag
        FROM file_paths
        WHERE user_id = ?
          AND is_present = 1
          AND (
            CASE
              WHEN instr(relative_path_from_root, '/') = 0 THEN 'root'
              ELSE substr(relative_path_from_root, 1, instr(relative_path_from_root, '/') - 1)
            END
          ) = ?
        LIMIT 1
      `
    )
    .get(userId, sourceId) as { exists_flag: number } | undefined;

  if (!row) {
    return null;
  }

  const remoteInfo = getRemoteSourceInfo(db, userId, sourceId);

  return {
    id: sourceId,
    folderPath: remoteInfo?.folderPath ?? deriveFolderPath(rootFolder, sourceId),
    displayName: remoteInfo?.displayName ?? sourceId,
    avatarSeed: sourceId,
  };
}
