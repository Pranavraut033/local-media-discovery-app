-- Migration: add remote_servers table and widen storage_mode checks
-- Adds support for multiple custom remote servers (rclone, webdav).
-- SQLite cannot ALTER a CHECK constraint, so folders and file_paths are rebuilt.

PRAGMA foreign_keys = OFF;

-- 1. remote_servers table (new)
CREATE TABLE IF NOT EXISTS remote_servers (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_type          TEXT NOT NULL CHECK(server_type IN ('rclone', 'webdav')),
  display_name         TEXT NOT NULL,
  rclone_remote_type   TEXT,
  connection_encrypted TEXT NOT NULL,
  connection_nonce     TEXT,
  connection_kdf_salt  TEXT,
  created_at           INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at           INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_remote_servers_user ON remote_servers(user_id);

-- 2. Rebuild folders: add server_id, widen storage_mode CHECK
CREATE TABLE folders_new (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_folder_id        TEXT REFERENCES folders_new(id) ON DELETE SET NULL,
  server_id               TEXT REFERENCES remote_servers(id) ON DELETE SET NULL,
  storage_mode            TEXT NOT NULL CHECK(storage_mode IN ('local', 'rclone', 'webdav')),
  absolute_path           TEXT NOT NULL,
  relative_path_from_root TEXT NOT NULL,
  name                    TEXT NOT NULL,
  created_at              INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at              INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, storage_mode, relative_path_from_root)
);
INSERT INTO folders_new
  SELECT id, user_id, parent_folder_id, NULL, storage_mode,
         absolute_path, relative_path_from_root, name, created_at, updated_at
  FROM folders;

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;

CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_folder_id);

-- 3. Rebuild file_paths: add server_id, widen storage_mode CHECK
CREATE TABLE file_paths_new (
  id                      TEXT PRIMARY KEY,
  file_id                 TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id               TEXT REFERENCES folders(id) ON DELETE SET NULL,
  server_id               TEXT REFERENCES remote_servers(id) ON DELETE SET NULL,
  storage_mode            TEXT NOT NULL CHECK(storage_mode IN ('local', 'rclone', 'webdav')),
  file_name               TEXT NOT NULL,
  absolute_path           TEXT NOT NULL,
  relative_path_from_root TEXT NOT NULL,
  path_hash               TEXT,
  first_seen_at           INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  last_seen_at            INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  is_present              INTEGER NOT NULL DEFAULT 1 CHECK(is_present IN (0, 1)),
  status                  TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('pending', 'ready')),
  temp_file_id            TEXT,
  created_at              INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at              INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, absolute_path)
);
INSERT INTO file_paths_new
  SELECT id, file_id, user_id, folder_id, NULL, storage_mode,
         file_name, absolute_path, relative_path_from_root, path_hash,
         first_seen_at, last_seen_at, is_present, status, temp_file_id,
         created_at, updated_at
  FROM file_paths;

DROP TABLE file_paths;
ALTER TABLE file_paths_new RENAME TO file_paths;

CREATE INDEX IF NOT EXISTS idx_file_paths_file      ON file_paths(file_id);
CREATE INDEX IF NOT EXISTS idx_file_paths_user_file ON file_paths(user_id, file_id);

PRAGMA foreign_keys = ON;
