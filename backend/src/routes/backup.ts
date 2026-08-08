/**
 * Backup & restore routes — export/import curation (liked/saved/hidden) and
 * display preferences, keyed by portable content_hash rather than the
 * per-index files.id.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';

interface PreferencesRow {
  theme_mode: string;
  feed_mode: string;
  autoplay_enabled: number;
  muted_by_default: number;
  show_hidden_in_admin_views: number;
  preload_next_media: number;
  loop_videos: number;
}

interface ExportResponse {
  preferences: PreferencesRow | null;
  liked: string[];
  saved: string[];
  hidden: string[];
}

interface ImportBody {
  preferences?: PreferencesRow | null;
  liked?: string[];
  saved?: string[];
  hidden?: string[];
}

interface ContentHashRow {
  content_hash: string;
}

interface FileIdRow {
  id: string;
}

const INTERACTION_TABLES: Record<'liked' | 'saved' | 'hidden', string> = {
  liked: 'user_liked_files',
  saved: 'user_saved_files',
  hidden: 'user_hidden_files',
};

const THEME_MODES = new Set(['light', 'dark', 'system']);
const FEED_MODES = new Set(['reel', 'grid']);
const BOOLEAN_FIELDS = [
  'autoplay_enabled',
  'muted_by_default',
  'show_hidden_in_admin_views',
  'preload_next_media',
  'loop_videos',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateImportBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Request body must be an object';
  }

  const { preferences, liked, saved, hidden } = body as ImportBody;

  if (liked !== undefined && !isStringArray(liked)) {
    return '"liked" must be an array of strings';
  }
  if (saved !== undefined && !isStringArray(saved)) {
    return '"saved" must be an array of strings';
  }
  if (hidden !== undefined && !isStringArray(hidden)) {
    return '"hidden" must be an array of strings';
  }

  if (preferences !== undefined && preferences !== null) {
    if (typeof preferences !== 'object' || Array.isArray(preferences)) {
      return '"preferences" must be an object';
    }

    const prefs = preferences as unknown as Record<string, unknown>;

    if (prefs.theme_mode !== undefined && !THEME_MODES.has(prefs.theme_mode as string)) {
      return `"preferences.theme_mode" must be one of ${[...THEME_MODES].join(', ')}`;
    }
    if (prefs.feed_mode !== undefined && !FEED_MODES.has(prefs.feed_mode as string)) {
      return `"preferences.feed_mode" must be one of ${[...FEED_MODES].join(', ')}`;
    }
    for (const field of BOOLEAN_FIELDS) {
      const fieldValue = prefs[field];
      if (fieldValue !== undefined && fieldValue !== 0 && fieldValue !== 1) {
        return `"preferences.${field}" must be 0 or 1`;
      }
    }
  }

  return null;
}

export default async function backupRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/admin/export',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      try {
        const db = getDatabase();

        const preferences = db
          .prepare(
            `
              SELECT theme_mode, feed_mode, autoplay_enabled, muted_by_default,
                     show_hidden_in_admin_views, preload_next_media, loop_videos
              FROM user_preferences
              WHERE user_id = ?
            `
          )
          .get(userId) as PreferencesRow | undefined;

        const likedRows = db
          .prepare(
            `SELECT f.content_hash FROM user_liked_files l JOIN files f ON f.id = l.file_id WHERE l.user_id = ?`
          )
          .all(userId) as ContentHashRow[];

        const savedRows = db
          .prepare(
            `SELECT f.content_hash FROM user_saved_files s JOIN files f ON f.id = s.file_id WHERE s.user_id = ?`
          )
          .all(userId) as ContentHashRow[];

        const hiddenRows = db
          .prepare(
            `SELECT f.content_hash FROM user_hidden_files h JOIN files f ON f.id = h.file_id WHERE h.user_id = ?`
          )
          .all(userId) as ContentHashRow[];

        const response: ExportResponse = {
          preferences: preferences ?? null,
          liked: likedRows.map((row) => row.content_hash),
          saved: savedRows.map((row) => row.content_hash),
          hidden: hiddenRows.map((row) => row.content_hash),
        };

        return reply.send(response);
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to export data' });
      }
    }
  );

  fastify.post<{ Body: ImportBody }>(
    '/api/admin/import',
    {
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      const userId = request.user!.userId;

      const validationError = validateImportBody(request.body);
      if (validationError) {
        return reply.code(400).send({ error: validationError });
      }

      const { preferences, liked = [], saved = [], hidden = [] } = request.body || {};

      try {
        const db = getDatabase();

        const findFileByHash = db.prepare('SELECT id FROM files WHERE content_hash = ?');
        const insertUpsertPreferences = db.prepare(
          `
            INSERT INTO user_preferences (
              id, user_id, theme_mode, feed_mode, autoplay_enabled, muted_by_default,
              show_hidden_in_admin_views, preload_next_media, loop_videos
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              theme_mode = excluded.theme_mode,
              feed_mode = excluded.feed_mode,
              autoplay_enabled = excluded.autoplay_enabled,
              muted_by_default = excluded.muted_by_default,
              show_hidden_in_admin_views = excluded.show_hidden_in_admin_views,
              preload_next_media = excluded.preload_next_media,
              loop_videos = excluded.loop_videos
          `
        );

        const applyInteractions = (hashes: string[], table: string) => {
          const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (id, user_id, file_id) VALUES (?, ?, ?)`);
          let applied = 0;
          let skipped = 0;

          for (const contentHash of hashes) {
            const fileRow = findFileByHash.get(contentHash) as FileIdRow | undefined;
            if (!fileRow) {
              skipped += 1;
              continue;
            }
            insert.run(randomUUID(), userId, fileRow.id);
            applied += 1;
          }

          return { applied, skipped };
        };

        const results = db.transaction(() => {
          const likedResult = applyInteractions(liked, INTERACTION_TABLES.liked);
          const savedResult = applyInteractions(saved, INTERACTION_TABLES.saved);
          const hiddenResult = applyInteractions(hidden, INTERACTION_TABLES.hidden);

          let preferencesApplied = false;
          if (preferences) {
            insertUpsertPreferences.run(
              randomUUID(),
              userId,
              preferences.theme_mode,
              preferences.feed_mode,
              preferences.autoplay_enabled,
              preferences.muted_by_default,
              preferences.show_hidden_in_admin_views,
              preferences.preload_next_media,
              preferences.loop_videos
            );
            preferencesApplied = true;
          }

          return {
            liked: likedResult,
            saved: savedResult,
            hidden: hiddenResult,
            preferencesApplied,
          };
        })();

        return reply.send(results);
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to import data' });
      }
    }
  );
}
