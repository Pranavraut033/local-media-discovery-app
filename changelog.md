# Changelog

## [1.0.0] - 2026-08-09

First stable release. Local Media Discovery App is a privacy-first, LAN-only,
swipeable media browser with a Fastify backend, Next.js frontend, a dedicated
streaming media server, and an Electron desktop shell.

### Added

- Core media discovery experience: swipeable feed, media gallery view, image
  viewer, and video player (Plyr-based) with hold-to-fast-forward seeking.
- PIN-based authentication (6-digit) with JWT sessions, scoped per user.
- Local folder indexing pipeline: chokidar-based discovery, content-hash
  dedup, incremental scan progress, and a live file watcher with surgical
  per-file add/remove updates.
- Remote source support via rclone and WebDAV: remote server management UI,
  streaming indexer, PM2-then-Electron-managed mount lifecycle, self-healing
  FUSE mount recovery, and ownership locking for multi-process safety.
- Ranked feed algorithm with source diversity, like/save bias, per-user
  session caching, and cache invalidation on file/indexing mutations.
- Folder management: hide/unhide folders, folder tree view, root-folder
  reset, and detection/re-prompt when a root folder is deleted or moved.
- Discover view with its own session API, hooks, and navigation.
- HMAC-gated standalone media server with adaptive LRU caching, streaming
  token management, and abort-on-disconnect handling.
- Settings panel: folder management, shutdown control for all services,
  keyboard shortcuts guide, and local backup export/import.
- Electron desktop app: bundled dev/prod process supervision (replacing
  PM2), first-run setup with secure auto-login, dock re-open on macOS,
  reveal-in-Finder / open-externally actions, and bundled native modules,
  icons, and migrations.
- Mobile-first PWA polish, including a shared shutdown control.
- Static landing page, deployed to GitHub Pages.

### Changed

- Migrated all client state to Zustand-backed stores (from ad hoc
  localStorage), with a documented migration guide.
- Migrated backend indexing/feed pipeline to a "v2 sources" model unifying
  local and remote sources.
- Replaced Drizzle/BullMQ/ioredis with raw SQL (better-sqlite3) and an
  in-process queue worker.
- Tuned SQLite pragmas and added covering indexes for feed query hot paths;
  switched to sample-hashing and parallel finalization for large files.

### Fixed

- Root folder persistence when selecting from recent folders.
- Feed source-type reset to local on folder selection.
- Stream token generation skipped correctly for rclone paths.
- Stale interaction file references reconciled during indexing.
- Sandboxed ffmpeg/ffprobe spawn errors no longer crash the backend.
- Dangling media-server streams now abort cleanly on client disconnect.
- UI: empty chrome bar padding no longer blocks clicks to underlying content.

### Internal

- Extensive documentation: `AUTH_SETUP.md`, `MIGRATION_ZUSTAND.md`,
  `REMOTE_SERVERS.md`, roadmap/architecture notes, and CLAUDE.md updates
  kept in sync with each major refactor.
- CodeGraph MCP server and Claude Code project settings added for code
  navigation.
- ISC license added.
- Added a tag-triggered release workflow (`.github/workflows/release.yml`).

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
