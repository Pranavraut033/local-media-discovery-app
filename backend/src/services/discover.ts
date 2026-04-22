/**
 * Discover Service
 * Fetches random unseen, non-liked, non-saved media for a user.
 * Tracks shown IDs in a persistent per-user session row.
 */
import { getDatabase } from '../db/index.js';

type DB = ReturnType<typeof getDatabase>;

interface DiscoverRow {
  id: string;
  path: string;
  relative_path_from_root: string;
  type: string;
  source_id: string;
  liked: number;
  saved: number;
  depth: number;
  storage_mode: string;
}

interface SessionRow {
  seen_file_ids: string;
}

function parseSeenIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getSeenIds(db: DB, userId: string): string[] {
  const row = db
    .prepare('SELECT seen_file_ids FROM user_discover_session WHERE user_id = ?')
    .get(userId) as SessionRow | undefined;
  return row ? parseSeenIds(row.seen_file_ids) : [];
}

export function getDiscoverFeed(db: DB, userId: string, limit: number): DiscoverRow[] {
  const seenIds = getSeenIds(db, userId);

  // Build a query that excludes:
  //   - liked files (user_liked_files)
  //   - saved files (user_saved_files)
  //   - hidden files (user_hidden_files)
  //   - already-seen filePath IDs from the session
  // Order randomly so each batch is fresh.
  const placeholders =
    seenIds.length > 0
      ? `AND fp.id NOT IN (${seenIds.map(() => '?').join(',')})`
      : '';

  const sql = `
    SELECT
      fp.id,
      fp.absolute_path AS path,
      fp.relative_path_from_root,
      CASE WHEN f.media_kind = 'video' THEN 'video' ELSE 'image' END AS type,
      CASE
        WHEN instr(fp.relative_path_from_root, '/') = 0 THEN 'root'
        ELSE substr(fp.relative_path_from_root, 1, instr(fp.relative_path_from_root, '/') - 1)
      END AS source_id,
      0 AS liked,
      0 AS saved,
      CASE
        WHEN fp.relative_path_from_root = '' THEN 0
        ELSE LENGTH(fp.relative_path_from_root) - LENGTH(REPLACE(fp.relative_path_from_root, '/', ''))
      END AS depth,
      fp.storage_mode
    FROM file_paths fp
    JOIN files f ON f.id = fp.file_id
    WHERE
      fp.user_id = ?
      AND fp.is_present = 1
      AND f.media_kind IN ('image', 'video')
      AND NOT EXISTS (
        SELECT 1 FROM user_liked_files ulf
        WHERE ulf.user_id = fp.user_id AND ulf.file_id = fp.file_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_saved_files usf
        WHERE usf.user_id = fp.user_id AND usf.file_id = fp.file_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_hidden_files uhf
        WHERE uhf.user_id = fp.user_id AND uhf.file_id = fp.file_id
      )
      ${placeholders}
    ORDER BY RANDOM()
    LIMIT ?
  `;

  const params: (string | number)[] = [userId, ...seenIds, limit];
  return db.prepare(sql).all(...params) as DiscoverRow[];
}

export function appendDiscoverSession(db: DB, userId: string, newIds: string[]): void {
  if (newIds.length === 0) return;

  const existing = getSeenIds(db, userId);
  const merged = Array.from(new Set([...existing, ...newIds]));

  db.prepare(`
    INSERT INTO user_discover_session (user_id, seen_file_ids, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(user_id) DO UPDATE SET
      seen_file_ids = excluded.seen_file_ids,
      updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(merged));
}

export function resetDiscoverSession(db: DB, userId: string): void {
  db.prepare(`
    INSERT INTO user_discover_session (user_id, seen_file_ids, updated_at)
    VALUES (?, '[]', strftime('%s', 'now'))
    ON CONFLICT(user_id) DO UPDATE SET
      seen_file_ids = '[]',
      updated_at = excluded.updated_at
  `).run(userId);
}

export function getDiscoverSessionMeta(db: DB, userId: string): { seenCount: number } {
  const ids = getSeenIds(db, userId);
  return { seenCount: ids.length };
}
