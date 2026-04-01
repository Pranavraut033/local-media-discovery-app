import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

const nowEpoch = sql`(strftime('%s', 'now'))`;

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  pinHash: text('pin_hash').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull().default(nowEpoch),
  updatedAt: integer('updated_at').notNull().default(nowEpoch),
});

export const userStorageConfigs = sqliteTable(
  'user_storage_configs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localRootPath: text('local_root_path').notNull(),
    rcloneConfigEncrypted: text('rclone_config_encrypted'),
    rcloneConfigNonce: text('rclone_config_nonce'),
    rcloneConfigKdfSalt: text('rclone_config_kdf_salt'),
    rcloneConfigVersion: integer('rclone_config_version').notNull().default(1),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [unique('ux_user_storage_configs_user').on(table.userId)]
);

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentFolderId: text('parent_folder_id').references((): any => folders.id, {
      onDelete: 'set null',
    }),
    storageMode: text('storage_mode').notNull(),
    absolutePath: text('absolute_path').notNull(),
    relativePathFromRoot: text('relative_path_from_root').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [
    unique('ux_folders_user_mode_relpath').on(
      table.userId,
      table.storageMode,
      table.relativePathFromRoot
    ),
    index('idx_folders_user_parent').on(table.userId, table.parentFolderId),
    check('chk_folders_storage_mode', sql`${table.storageMode} IN ('local', 'rclone')`),
  ]
);

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    fileKey: text('file_key').notNull(),
    contentHash: text('content_hash').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    mimeType: text('mime_type'),
    extension: text('extension'),
    mediaKind: text('media_kind').notNull().default('other'),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [
    unique('ux_files_file_key').on(table.fileKey),
    unique('ux_files_content_hash').on(table.contentHash),
    index('idx_files_media_kind').on(table.mediaKind),
    check('chk_files_media_kind', sql`${table.mediaKind} IN ('image', 'video', 'other')`),
  ]
);

export const filePaths = sqliteTable(
  'file_paths',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    storageMode: text('storage_mode').notNull(),
    fileName: text('file_name').notNull(),
    absolutePath: text('absolute_path').notNull(),
    relativePathFromRoot: text('relative_path_from_root').notNull(),
    pathHash: text('path_hash'),
    firstSeenAt: integer('first_seen_at').notNull().default(nowEpoch),
    lastSeenAt: integer('last_seen_at').notNull().default(nowEpoch),
    isPresent: integer('is_present').notNull().default(1),
    status: text('status').notNull().default('ready'),
    tempFileId: text('temp_file_id'),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [
    unique('ux_file_paths_user_absolute_path').on(table.userId, table.absolutePath),
    index('idx_file_paths_file').on(table.fileId),
    index('idx_file_paths_user_file').on(table.userId, table.fileId),
    check('chk_file_paths_storage_mode', sql`${table.storageMode} IN ('local', 'rclone')`),
    check('chk_file_paths_is_present', sql`${table.isPresent} IN (0, 1)`),
    check('chk_file_paths_status', sql`${table.status} IN ('pending', 'ready')`),
  ]
);

export const indexingJobs = sqliteTable(
  'indexing_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull(),
    status: text('status').notNull().default('queued'),
    totalFiles: integer('total_files').notNull().default(0),
    processedFiles: integer('processed_files').notNull().default(0),
    sourcePath: text('source_path').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [
    index('idx_indexing_jobs_user').on(table.userId, table.createdAt),
  ]
);

export const userSavedFiles = sqliteTable(
  'user_saved_files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [unique('ux_user_saved_files_user_file').on(table.userId, table.fileId)]
);

export const userLikedFiles = sqliteTable(
  'user_liked_files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [unique('ux_user_liked_files_user_file').on(table.userId, table.fileId)]
);

export const userHiddenFiles = sqliteTable(
  'user_hidden_files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [unique('ux_user_hidden_files_user_file').on(table.userId, table.fileId)]
);

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    themeMode: text('theme_mode').notNull().default('system'),
    feedMode: text('feed_mode').notNull().default('reel'),
    autoplayEnabled: integer('autoplay_enabled').notNull().default(1),
    mutedByDefault: integer('muted_by_default').notNull().default(1),
    showHiddenInAdminViews: integer('show_hidden_in_admin_views').notNull().default(0),
    preloadNextMedia: integer('preload_next_media').notNull().default(1),
    loopVideos: integer('loop_videos').notNull().default(0),
    createdAt: integer('created_at').notNull().default(nowEpoch),
    updatedAt: integer('updated_at').notNull().default(nowEpoch),
  },
  (table) => [
    unique('ux_user_preferences_user').on(table.userId),
    check('chk_user_preferences_theme_mode', sql`${table.themeMode} IN ('light', 'dark', 'system')`),
    check('chk_user_preferences_feed_mode', sql`${table.feedMode} IN ('reel', 'grid')`),
    check('chk_user_preferences_autoplay', sql`${table.autoplayEnabled} IN (0, 1)`),
    check('chk_user_preferences_muted', sql`${table.mutedByDefault} IN (0, 1)`),
    check('chk_user_preferences_show_hidden', sql`${table.showHiddenInAdminViews} IN (0, 1)`),
    check('chk_user_preferences_preload', sql`${table.preloadNextMedia} IN (0, 1)`),
    check('chk_user_preferences_loop', sql`${table.loopVideos} IN (0, 1)`),
  ]
);

export type StorageMode = 'local' | 'rclone';
export type MediaKind = 'image' | 'video' | 'other';
