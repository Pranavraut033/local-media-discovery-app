# Phase 2 Plan: Backend Refactor to Schema v2

Status: In Progress
Owner: Backend
Scope: Replace legacy SQL/table usage with schema v2 tables introduced in migration `0001_schema_overhaul.sql`.

## Implementation Snapshot (2026-03-31)

### Completed (implemented and wired)

- P2-03 Root/config migration: v2 storage config + v2 reset/maintenance helpers are in place.
- P2-04 Indexer v2 core: `indexer.ts` now writes `files`, `file_paths`, and `folders` and tracks `is_present`.
- P2-05 Feed/interactions migration: feed and interaction routes now use `user_saved_files`, `user_liked_files`, and `user_hidden_files`.
- P2-06 Media-adjacent routes (partial): thumbnail resolution and integrity cleanup moved off legacy `media` table.
- P2-07 Folder tree/hide migration: `backend/src/routes/folders.ts` now reads from `folders` + `file_paths` and uses deterministic file-level hide semantics via `user_hidden_files`.
- Watcher flow migrated to v2 behavior: `backend/src/services/watcher.ts` now triggers debounced user-scoped reindexing via `indexer.ts` instead of legacy table writes.
- P2-08 Rclone alignment (partial): `backend/src/routes/rclone.ts` now persists encrypted rclone config under `user_storage_configs` and writes remote scan results into `files`, `file_paths`, and `folders` with `storage_mode='rclone'`.
- Admin/maintenance stats and reset now use v2 data maintenance service.

### Missing / still legacy-dependent

- P2-08 Rclone alignment still needs follow-through validation for multi-remote/source semantics and end-to-end media serving behavior under all playback modes.
- Full P2-06 media serving audit is not complete (filesystem/media route family still needs final legacy SQL removal verification across local+rclone paths).
- Cleanup pass P2-09 is not complete; broad functional regression verification and any remaining legacy assumption audits are still pending.

### Validation status

- Latest migration batches compiled and type-checked successfully (`backend` type-check + db migrate).
- Functional regression sweep is now partially complete for local storage mode (auth, indexing, feed, interactions, folder endpoints, and media serving smoke-tested on 2026-03-31).
- One regression found and fixed during sweep: `GET /api/liked`, `GET /api/saved`, and `GET /api/hidden` had extra SQL bind parameters in `backend/src/routes/feed.ts` causing `Too many parameter values were provided`.
- Full regression coverage is still pending for rclone multi-remote/source semantics and broader playback-mode verification.

## Objective

Complete the functional backend migration from legacy tables (`sources`, `media`, `user_interactions`, etc.) to schema v2:
- `users`
- `user_storage_configs`
- `folders`
- `files`
- `file_paths`
- `user_saved_files`
- `user_liked_files`
- `user_hidden_files`
- `user_preferences`

Phase 2 prioritizes correctness and API continuity over optimization.

## Non-Goals

- No frontend redesign.
- No backward data migration from dropped legacy tables.
- No performance tuning beyond essential indexes/query correctness.

## Principles

1. Keep route contracts stable where possible.
2. Use Drizzle ORM as default data access path.
3. Keep all behavior user-scoped.
4. Enforce deterministic file identity (`content_hash`, `file_key`) and path mapping (`file_paths`).

## Workstreams

### 1. Data Access Layer

1. Create repository/service helpers for v2 entities:
- users
- storage config
- folders
- files
- file paths
- interactions (save/like/hide)
- preferences

2. Centralize common operations:
- upsert user preferences
- upsert storage config
- mark file path present/absent
- set interaction flags via dedicated tables

3. Remove direct SQL strings from routes incrementally.

Deliverables:
- typed query modules in backend service layer
- zero new direct `db.prepare(...legacy...)` in touched files

### 2. Auth and User Setup

1. Keep PIN login behavior unchanged.
2. Ensure first-login/user setup creates missing defaults:
- `user_preferences`
- `user_storage_configs` (once root path is set)

3. Keep JWT payload user_id-compatible with v2 model.

Deliverables:
- auth routes fully v2-compatible
- create-user script remains valid for v2

### 3. Root Folder + Source Model Replacement

1. Replace legacy source generation with v2 folder root semantics.
2. Treat storage mode explicitly (`local` or `rclone`).
3. Enforce one active storage config per user.

Deliverables:
- config routes write/read `user_storage_configs`
- folder tree root built from v2 `folders`

### 4. Indexing Pipeline Rewrite (Core)

1. For each scanned file:
- compute fingerprint (`content_hash`)
- derive `file_key`
- upsert into `files`
- upsert path mapping in `file_paths`

2. For removed files/paths:
- mark `file_paths.is_present = 0`
- update `last_seen_at`

3. Rebuild/maintain folder hierarchy in `folders`.

Deliverables:
- `indexer.ts` no longer references `media`/`sources`
- indexing summary based on v2 counts

### 5. Feed + Views Semantics

1. Rebuild feed queries from:
- `files`
- joined active `file_paths` for user
- interaction tables for flags

2. Rebuild liked/saved/hidden queries from dedicated interaction tables.
3. Keep existing route responses stable where possible.

Deliverables:
- feed routes operate purely on v2 tables
- maintenance stats endpoints reflect v2 metrics

### 6. Filesystem and Media Serving

1. Resolve media path through active `file_paths` record.
2. Keep local/rclone serving support.
3. Ensure access checks are user-scoped.

Deliverables:
- media endpoint path resolution via v2 tables
- no legacy table dependency for access control

### 7. Folder Hide/Tree Behavior

1. Replace hidden-folder logic that relied on legacy tables.
2. Decide and implement one model:
- file-level hide only (using `user_hidden_files`), or
- add folder-level hidden table in v2 (if needed)

Note: If folder-level hide is required, add migration `0002` with explicit table and indexes.

Deliverables:
- folder tree endpoint fully v2-backed
- deterministic hide behavior documented

### 8. Rclone Integration Alignment

1. Persist encrypted rclone config under `user_storage_configs`.
2. Remove/replace deprecated remote config table usage.
3. Ensure remote indexing emits v2 file/path records.

Deliverables:
- rclone routes/services v2 data model compatible

### 9. Cleanup and Safety

1. Remove unused legacy code paths referencing dropped tables.
2. Add runtime guards and clear error messages for missing user config.
3. Keep migration runner idempotent and startup-safe.

Deliverables:
- no runtime SQL errors from missing legacy tables

## Sequence (Execution Order)

1. Data access helpers (v2 repositories)
2. Auth/setup + config routes
3. Indexer rewrite
4. Feed and interaction routes
5. Filesystem/media serving routes
6. Folder tree/hide behavior
7. Rclone alignment
8. Cleanup pass

## Progress By Tracking ID

- P2-01 data access layer: In Progress
	Notes: v2 helper modules added (`v2-data-maintenance.ts`, `v2-sources.ts`), but not all route data access is consolidated.
- P2-02 auth/setup: Pending Verification
	Notes: no blocking legacy-table errors currently observed in migrated paths, but full auth/setup verification checklist still pending.
- P2-03 config/root storage: Mostly Complete
	Notes: config/maintenance reset migrated to v2 patterns.
- P2-04 indexer v2: Mostly Complete
	Notes: core indexer rewritten to v2 tables; watcher now performs debounced user-scoped reindex against v2.
- P2-05 feed + interactions: Complete (for current route set)
	Notes: feed and interaction semantics now map to v2 interaction tables.
- P2-06 media serving: In Progress
	Notes: thumbnail/integrity done; final filesystem/media route audit and cleanup still required, especially around rclone-linked serving paths.
- P2-07 folders/hide: Mostly Complete
	Notes: folder tree and hide endpoints migrated to v2. Folder hide now uses file-level semantics (`user_hidden_files`) and derives hidden folders deterministically from subtree file state.
- P2-08 rclone alignment: In Progress
	Notes: add-source flow now writes v2 storage config + v2 indexed records for rclone files; remaining work is behavioral verification and cleanup of old helper assumptions.
- P2-09 cleanup + regression: Not Started
	Notes: unused legacy helper `backend/src/services/sources.ts` removed; full endpoint-level regression pass still pending.

## Testing Strategy

### Mandatory checks per batch

1. `cd backend && npm run type-check`
2. `cd backend && npm run db:migrate`

### Functional checks

1. Login with valid/invalid PIN.
2. Set root folder and run indexing.
3. Retrieve feed, liked, saved, hidden lists.
4. Toggle like/save/hide and verify persistence.
5. Serve local media by id.
6. Validate folder tree endpoint and hide behavior.

### Functional regression snapshot (2026-03-31)

Passed (local mode):
1. Health and setup checks (`/api/health`, `/api/auth/check-setup`).
2. Auth validation (`/api/auth/login` invalid PIN returns 400; valid PIN returns token).
3. Root-folder indexing (`POST /api/config/root-folder`) with temp fixture folder.
4. Feed retrieval (`GET /api/feed`) and source media retrieval (`GET /api/source/:sourceId/media`).
5. Interaction toggles (`POST /api/like`, `POST /api/save`, `POST /api/hide`).
6. Interaction views (`GET /api/liked`, `GET /api/saved`, `GET /api/hidden`) after feed SQL bind fix.
7. Media access (`GET /api/media/:id`, `GET /api/media/file/:id`) for indexed local image.
8. Folder semantics (`GET /api/folders/tree`, `POST /api/folders/hide`, `GET /api/folders/hidden`).

Pending:
1. Rclone multi-remote/source behavior and media serving validation across playback modes.
2. Cold-start and restart regression sweep against a clean DB + repeated index cycles.
3. Final endpoint audit for legacy assumptions beyond direct dropped-table SQL usage.

### Regression checks

1. Start server from empty DB.
2. Restart server and verify migration idempotency.
3. Confirm no endpoint references dropped tables at runtime.

## Exit Criteria (Phase 2 Done)

1. Backend endpoints required by current frontend run without legacy table errors.
2. Core user flows work on v2 schema only:
- auth
- set root folder
- index
- browse feed
- save/like/hide
- serve media

3. All backend code paths no longer depend on dropped tables.
4. Documentation updated to reflect final folder-hide decision and any added migrations.

## Risks and Mitigations

1. Risk: route contract drift breaks frontend.
- Mitigation: preserve response shapes during backend refactor.

2. Risk: file identity collisions on short keys.
- Mitigation: enforce uniqueness on full `content_hash`; treat `file_key` as short identifier.

3. Risk: folder hide semantics unclear.
- Mitigation: lock one behavior early; add migration if folder-level hide table is needed.

## Tracking

Recommended implementation tracking by task IDs:
- P2-01 data access layer
- P2-02 auth/setup
- P2-03 config/root storage
- P2-04 indexer v2
- P2-05 feed + interactions
- P2-06 media serving
- P2-07 folders/hide
- P2-08 rclone alignment
- P2-09 cleanup + regression
