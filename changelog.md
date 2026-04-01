# Changelog

## 2026-03-30 - Schema Overhaul v2

Type: Breaking
Impact: Full database shape change; legacy data dropped by migration 0001

### Added

1. Drizzle ORM schema definitions in TypeScript.
2. SQL migration runner with schema_migrations tracking.
3. New normalized tables:
- users
- user_storage_configs
- folders
- files
- file_paths
- user_saved_files
- user_liked_files
- user_hidden_files
- user_preferences

### Removed

1. Legacy tables dropped in migration:
- sources
- media
- user_folders
- user_interactions
- user_hidden_folders
- remote_rclone_config

### Changed

1. User model now explicitly requires:
- pin_hash
- name

2. File model now separates:
- canonical file identity (files)
- user/path mapping (file_paths)

3. User interactions are split into dedicated tables:
- likes
- saves
- hides

4. Storage config model now stores:
- local root path
- encrypted rclone config payload and crypto metadata

### Tooling

1. Backend package scripts now include:
- db:migrate

2. Backend create-user CLI now requires:
- 6-digit pin
- user name

### Notes

1. This overhaul intentionally accepts data loss and temporary application breakage while services/routes are refactored to the new schema.
2. Existing route SQL still needs incremental migration to v2 table names and relationships.
