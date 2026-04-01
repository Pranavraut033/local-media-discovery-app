PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS remote_rclone_config;
DROP TABLE IF EXISTS user_hidden_folders;
DROP TABLE IF EXISTS user_interactions;
DROP TABLE IF EXISTS user_folders;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS user_hidden_files;
DROP TABLE IF EXISTS user_liked_files;
DROP TABLE IF EXISTS user_saved_files;
DROP TABLE IF EXISTS file_paths;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS user_storage_configs;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE user_storage_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  local_root_path TEXT NOT NULL,
  rclone_config_encrypted TEXT,
  rclone_config_nonce TEXT,
  rclone_config_kdf_salt TEXT,
  rclone_config_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  parent_folder_id TEXT,
  storage_mode TEXT NOT NULL CHECK (storage_mode IN ('local', 'rclone')),
  absolute_path TEXT NOT NULL,
  relative_path_from_root TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE (user_id, storage_mode, relative_path_from_root),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE INDEX idx_folders_user_parent ON folders(user_id, parent_folder_id);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  file_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT,
  extension TEXT,
  media_kind TEXT NOT NULL DEFAULT 'other' CHECK (media_kind IN ('image', 'video', 'other')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_files_media_kind ON files(media_kind);

CREATE TABLE file_paths (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  folder_id TEXT,
  storage_mode TEXT NOT NULL CHECK (storage_mode IN ('local', 'rclone')),
  file_name TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  relative_path_from_root TEXT NOT NULL,
  path_hash TEXT,
  first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  is_present INTEGER NOT NULL DEFAULT 1 CHECK (is_present IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE (user_id, absolute_path),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE INDEX idx_file_paths_file ON file_paths(file_id);
CREATE INDEX idx_file_paths_user_file ON file_paths(user_id, file_id);

CREATE TABLE user_saved_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE (user_id, file_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE user_liked_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE (user_id, file_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE user_hidden_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE (user_id, file_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  theme_mode TEXT NOT NULL DEFAULT 'system' CHECK (theme_mode IN ('light', 'dark', 'system')),
  feed_mode TEXT NOT NULL DEFAULT 'reel' CHECK (feed_mode IN ('reel', 'grid')),
  autoplay_enabled INTEGER NOT NULL DEFAULT 1 CHECK (autoplay_enabled IN (0, 1)),
  muted_by_default INTEGER NOT NULL DEFAULT 1 CHECK (muted_by_default IN (0, 1)),
  show_hidden_in_admin_views INTEGER NOT NULL DEFAULT 0 CHECK (show_hidden_in_admin_views IN (0, 1)),
  preload_next_media INTEGER NOT NULL DEFAULT 1 CHECK (preload_next_media IN (0, 1)),
  loop_videos INTEGER NOT NULL DEFAULT 0 CHECK (loop_videos IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_user_storage_configs_updated_at
AFTER UPDATE ON user_storage_configs
FOR EACH ROW
BEGIN
  UPDATE user_storage_configs SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_folders_updated_at
AFTER UPDATE ON folders
FOR EACH ROW
BEGIN
  UPDATE folders SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_files_updated_at
AFTER UPDATE ON files
FOR EACH ROW
BEGIN
  UPDATE files SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_file_paths_updated_at
AFTER UPDATE ON file_paths
FOR EACH ROW
BEGIN
  UPDATE file_paths SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_user_saved_files_updated_at
AFTER UPDATE ON user_saved_files
FOR EACH ROW
BEGIN
  UPDATE user_saved_files SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_user_liked_files_updated_at
AFTER UPDATE ON user_liked_files
FOR EACH ROW
BEGIN
  UPDATE user_liked_files SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_user_hidden_files_updated_at
AFTER UPDATE ON user_hidden_files
FOR EACH ROW
BEGIN
  UPDATE user_hidden_files SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER trg_user_preferences_updated_at
AFTER UPDATE ON user_preferences
FOR EACH ROW
BEGIN
  UPDATE user_preferences SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

PRAGMA foreign_keys = ON;
