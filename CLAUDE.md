# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Navigation

CodeGraph is set up for this project (MCP server in `.mcp.json`, index in `.codegraph/`). Prefer its tools (`codegraph_search`, `codegraph_explore`, callers/callees/impact queries) over grep/Read for finding symbols, call graphs, and dependency relationships — it's faster and uses fewer tool calls. Run `codegraph sync` after large changes to keep the index current.

## Commands

```bash
# Install all dependencies
npm run install:all

# Development (all three at once)
npm run server                  # spawns backend/media-server/frontend dev, LAN-reachable

# Or run each in its own terminal
cd backend && npm run dev       # Fastify on :3001 with tsx watch
cd frontend && npm run dev      # Next.js on :3000
cd media-server && npm run dev  # Media server on :3002 (optional for local files)

# Production
npm run build   # Compiles all three services (TS → JS)
npm start       # Build + launch the Electron desktop app

# Desktop app dev (spawns backend/media-server/next dev for you)
npm run desktop:dev

# Quality checks — run these for touched areas before finishing
cd backend && npm run type-check
cd frontend && npm run lint

# Database
cd backend && npm run db:migrate  # Run SQL migrations (backend/migrations/*.sql)

# First-time setup
cd backend && npm run dev         # Initializes DB on first run, then Ctrl+C
cd backend && npm run create-user 123456  # Create a 6-digit PIN user
```

## Architecture

Three independent processes, spawned and supervised by the Electron main process (`desktop/main.cjs`) — no PM2:

| Process | Port | Responsibility |
|---------|------|----------------|
| `backend/` | 3001 | Auth, indexing, feed ranking, filesystem, thumbnails, SQLite |
| `frontend/` | 3000 | Next.js static export, UI, TanStack Query, Zustand |
| `media-server/` | 3002 | HMAC-gated streaming, encrypted local cache |

### Auth & Token Flow

1. User logs in with 6-digit PIN → backend bcrypt-verifies → returns JWT (30-day TTL)
2. Frontend stores JWT in Zustand (persisted) and attaches via `Authorization: Bearer` on every request via `frontend/lib/api.ts:authenticatedFetch()`
3. For media streaming: backend signs an HMAC-SHA256 token `{mediaId, path, ext, type, iat, exp}` (2-hour TTL) using `MEDIA_SERVER_SECRET`; frontend builds stream URLs via `getStreamUrl()` which routes to media-server when a token is available, falling back to backend
4. Media server verifies the HMAC without any DB access — fully stateless

### Feed Discovery

`backend/src/services/feed.ts` implements the ranking algorithm:
- 10-minute session cache per user
- Scores files by: unseen priority, source diversity, like/save bias, entropy (deterministic seed for stable pagination)
- Excludes hidden files; applies user preferences

### Indexing Pipeline

Two paths, both processed by an in-process queue worker (`backend/src/workers/indexer.worker.ts`, `backend/src/queue/index.ts`):
- **Local**: chokidar scan → Phase 1 discovery (create `pending` filePaths) → Phase 2 finalization (hash files, dedup via `files` table, mark `ready`)
- **Rclone**: single-phase streaming via rclone RPC fast-list, written in batches as `ready`
- Progress streams to frontend via SSE (`/api/events`)
- File watcher (`backend/src/services/watcher.ts`) debounces adds/removes (1.5s) and triggers incremental reindex; removed files set to `isPresent = 0`

### Database

SQLite via better-sqlite3 (raw SQL) at `backend/media-discovery.db`. Migrations in `backend/migrations/*.sql`, applied by `backend/src/db/migrate.ts`. WAL mode, foreign keys enabled, 64MB cache.

Key table relationships: `users` → `folders` → `filePaths` ↔ `files` (deduped by content hash). Interactions (`userLikedFiles`, `userSavedFiles`, `userHiddenFiles`) and `userPreferences` are all scoped per `userId`.

### Frontend State

Three persisted Zustand stores in `frontend/lib/stores/`:
- `auth.store.ts` — token, userId, isAuthenticated
- `ui.store.ts` — viewMode (`reels`|`feed`), preferences (incl. default landing page), current tab, scroll position (v4 with migrations)
- `folders.store.ts` — recent folder history

One in-memory store:
- `indexing.store.ts` — job tracking, temp→final ID reconciliation map

TanStack Query handles server state in `frontend/lib/hooks.ts`: `useFeed()` (infinite query with preloading), interaction mutations with optimistic updates, `useIndexingStatus()` (SSE-based).

### Media Types

Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif` | Videos: `.mp4`, `.webm`, `.mov`

## Conventions

- **Privacy-first**: no telemetry, cloud sync, or external network calls ever
- **State**: use Zustand stores from `frontend/lib/stores/`; never introduce new raw `localStorage` patterns
- **API calls**: always use helpers in `frontend/lib/api.ts` (they handle auth + host detection for LAN access)
- **PIN auth**: exactly 6 numeric digits — do not change this constraint
- **Data scoping**: all DB queries must filter by `userId`; interactions and folders are per-user
- **Static export**: `frontend/next.config.ts` uses `output: 'export'`; keep all frontend code compatible (no server-side runtime features)
- **Frontend host detection**: `getApiBase()` and `getMediaServerBase()` in `api.ts` dynamically resolve the host for LAN access — don't hardcode `localhost`

## Gotchas

- Frontend (`3000`) and backend (`3001`) are separate processes; in dev, Next.js proxies `/api/*` to backend — check `next.config.ts` for proxy config
- DB must be initialized before running `create-user`; run `npm run dev` once to trigger auto-init
- If auth seems broken in dev, check token state in localStorage/Zustand and follow `AUTH_SETUP.md`
- Media server needs `MEDIA_SERVER_SECRET` env var that matches the backend's — if streaming fails, verify both processes share the same secret
- Rclone FUSE mounts (`backend/src/services/rclone-mount.ts`) are self-managed, not PM2-managed — ownership lock file plus an inactivity timeout (30 min) that auto-unmounts

## Documentation Map

- `PRD.md` — product requirements and design decisions
- `plan.md` — phased implementation roadmap (phases A–F)
- `AUTH_SETUP.md` — authentication setup and troubleshooting
- `MIGRATION_ZUSTAND.md` — Zustand store patterns and usage guide
- `agents.md` — agent workflow constraints and task boundaries
- `REMOTE_SERVERS.md` — canonical YAML schema and worked examples for rclone/WebDAV remote servers

<!-- last-sync-docs: 087467b056a3ce72c0312ea0e7aec7b65e99261c -->
