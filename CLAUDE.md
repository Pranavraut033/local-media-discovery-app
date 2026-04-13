# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies
npm run install:all

# Development (run each in its own terminal)
cd backend && npm run dev       # Fastify on :3001 with tsx watch
cd frontend && npm run dev      # Next.js on :3000
cd media-server && npm run dev  # Media server on :3002 (optional for local files)

# Production
npm run build   # Compiles all three services (TS → JS)
npm start       # Build + launch via PM2 ecosystem

# Quality checks — run these for touched areas before finishing
cd backend && npm run type-check
cd frontend && npm run lint

# Database
cd backend && npm run db:migrate  # Run Drizzle migrations

# First-time setup
cd backend && npm run dev         # Initializes DB on first run, then Ctrl+C
cd backend && npm run create-user 123456  # Create a 6-digit PIN user

# PM2 process management
npm run status / logs / restart / stop
```

## Architecture

Three independent processes managed by PM2 (`ecosystem.config.cjs`):

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

Two paths, both via BullMQ worker (`backend/src/workers/indexer.worker.ts`):
- **Local**: chokidar scan → Phase 1 discovery (create `pending` filePaths) → Phase 2 finalization (hash files, dedup via `files` table, mark `ready`)
- **Rclone**: single-phase streaming via rclone RPC fast-list, written in batches as `ready`
- Progress streams to frontend via SSE (`/api/events`)
- File watcher (`backend/src/services/watcher.ts`) debounces adds/removes (1.5s) and triggers incremental reindex; removed files set to `isPresent = 0`

### Database

SQLite via Drizzle ORM at `backend/media-discovery.db`. Schema in `backend/src/db/schema.ts`. WAL mode, foreign keys enabled, 64MB cache.

Key table relationships: `users` → `folders` → `filePaths` ↔ `files` (deduped by content hash). Interactions (`userLikedFiles`, `userSavedFiles`, `userHiddenFiles`) and `userPreferences` are all scoped per `userId`.

### Frontend State

Three persisted Zustand stores in `frontend/lib/stores/`:
- `auth.store.ts` — token, userId, isAuthenticated
- `ui.store.ts` — viewMode (`reels`|`feed`), preferences, scroll position (v2 with migrations)
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
- `ecosystem.config.cjs` also manages `rclone-mount` and `rclone-watchdog` PM2 processes for FUSE mounts (auto-stops after 10 min inactivity)

## Documentation Map

- `PRD.md` — product requirements and design decisions
- `plan.md` — phased implementation roadmap (phases A–F)
- `AUTH_SETUP.md` — authentication setup and troubleshooting
- `MIGRATION_ZUSTAND.md` — state management refactor notes and store patterns
- `agents.md` — agent workflow constraints and task boundaries
