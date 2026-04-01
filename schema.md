# Schema Definition (Overhaul v2)

Status: Active
Database: SQLite
ORM: Drizzle ORM (TypeScript)
Migration system: SQL files executed by backend/src/db/migrate.ts

## Scope

This schema is intentionally breaking and data-destructive.
The first overhaul migration drops legacy tables and creates the new model from scratch.

## Global Rules

1. All core tables include:
- id
- created_at
- updated_at

2. Timestamp format:
- INTEGER Unix epoch seconds

3. Foreign keys:
- Enabled
- ON DELETE CASCADE for user/file scoped data unless noted otherwise

4. File identity:
- Path-independent
- User-independent
- Based on hash fingerprint

## File Identity Contract

Required fields in files:
- file_key: short stable key, unique
- content_hash: full hash, unique

Recommended algorithm:
1. Read first chunk bytes (for example 64 KiB)
2. Read last chunk bytes (for example 64 KiB)
3. Include file size bytes in hash input
4. Compute SHA-256 as content_hash
5. Build file_key from beginning+ending bits of content_hash

Collision policy:
- content_hash is integrity key
- file_key is short identifier and must not be the only integrity check in sensitive operations

## Tables

### users
Purpose: authenticated user identity.

Columns:
- id TEXT PRIMARY KEY
- pin_hash TEXT NOT NULL
- name TEXT NOT NULL
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

### user_storage_configs
Purpose: per-user storage root and encrypted rclone config.

Columns:
- id TEXT PRIMARY KEY
- user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
- local_root_path TEXT NOT NULL
- rclone_config_encrypted TEXT NULL
- rclone_config_nonce TEXT NULL
- rclone_config_kdf_salt TEXT NULL
- rclone_config_version INTEGER NOT NULL DEFAULT 1
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

### folders
Purpose: user-scoped folder tree rooted from user storage root.

Columns:
- id TEXT PRIMARY KEY
- user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
- parent_folder_id TEXT NULL REFERENCES folders(id) ON DELETE SET NULL
- storage_mode TEXT NOT NULL CHECK IN (local, rclone)
- absolute_path TEXT NOT NULL
- relative_path_from_root TEXT NOT NULL
- name TEXT NOT NULL
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

Constraints:
- UNIQUE(user_id, storage_mode, relative_path_from_root)

### files
Purpose: canonical file identity and static media facts.

Columns:
- id TEXT PRIMARY KEY
- file_key TEXT NOT NULL UNIQUE
- content_hash TEXT NOT NULL UNIQUE
- size_bytes INTEGER NOT NULL
- mime_type TEXT NULL
- extension TEXT NULL
- media_kind TEXT NOT NULL DEFAULT other CHECK IN (image, video, other)
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

### file_paths
Purpose: map one file to many user/file-system paths.

Columns:
- id TEXT PRIMARY KEY
- file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE
- user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
- folder_id TEXT NULL REFERENCES folders(id) ON DELETE SET NULL
- storage_mode TEXT NOT NULL CHECK IN (local, rclone)
- file_name TEXT NOT NULL
- absolute_path TEXT NOT NULL
- relative_path_from_root TEXT NOT NULL
- path_hash TEXT NULL
- first_seen_at INTEGER NOT NULL DEFAULT now
- last_seen_at INTEGER NOT NULL DEFAULT now
- is_present INTEGER NOT NULL DEFAULT 1 CHECK IN (0, 1)
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

Constraints:
- UNIQUE(user_id, absolute_path)

### user_saved_files
Purpose: files saved by user.

Columns:
- id TEXT PRIMARY KEY
- user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
- file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

Constraints:
- UNIQUE(user_id, file_id)

### user_liked_files
Purpose: files liked by user.

Columns:
- id TEXT PRIMARY KEY
- user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
- file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

Constraints:
- UNIQUE(user_id, file_id)

### user_hidden_files
Purpose: files hidden by user.

Columns:
- id TEXT PRIMARY KEY
- user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
- file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

Constraints:
- UNIQUE(user_id, file_id)

### user_preferences
Purpose: user playback and UI behavior.

Columns:
- id TEXT PRIMARY KEY
- user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
- theme_mode TEXT NOT NULL DEFAULT system CHECK IN (light, dark, system)
- feed_mode TEXT NOT NULL DEFAULT reel CHECK IN (reel, grid)
- autoplay_enabled INTEGER NOT NULL DEFAULT 1 CHECK IN (0, 1)
- muted_by_default INTEGER NOT NULL DEFAULT 1 CHECK IN (0, 1)
- show_hidden_in_admin_views INTEGER NOT NULL DEFAULT 0 CHECK IN (0, 1)
- preload_next_media INTEGER NOT NULL DEFAULT 1 CHECK IN (0, 1)
- loop_videos INTEGER NOT NULL DEFAULT 0 CHECK IN (0, 1)
- created_at INTEGER NOT NULL DEFAULT now
- updated_at INTEGER NOT NULL DEFAULT now

## Exclusions (Intentional)

1. No manual server entry table for remote endpoints.
2. No legacy source/media/user_interactions/user_hidden_folders model.

## Runtime Migration Behavior

1. Startup path:
- backend/src/db/index.ts opens DB and runs migrations.

2. Migration tracking:
- schema_migrations table stores applied SQL file names.

3. Ordering:
- SQL files are applied in lexical filename order.

## Current Migration Set

1. backend/migrations/0001_schema_overhaul.sql
- Drops legacy tables
- Creates v2 schema
- Adds update triggers for updated_at maintenance
