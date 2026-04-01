# Implementation Plan for Copilot Agent

## Overview
This plan provides phased, actionable steps for implementing the local-media-discovery-app as described in the PRD. It is structured for Copilot agent execution, prioritizing existing libraries, DRY principles, and incremental delivery.

---

## Frontend Migration Plan to Schema v2 (Phase F2)

Status: Planned
Owner: Frontend
Dependency: Backend Phase 2 v2 API compatibility

### Objective
Migrate frontend data flows and UI assumptions from legacy source/media semantics to schema v2-backed behavior while preserving UX contracts (mobile-first feed, reels flow, saved/liked/hidden views, and settings).

### Constraints
1. Keep 6-digit PIN auth and existing session model unchanged.
2. Use existing Zustand stores in `frontend/lib/stores` and authenticated helpers in `frontend/lib/api.ts`.
3. Preserve current route contracts where already stable; only update frontend where payload assumptions changed.
4. No telemetry or cloud dependencies.

### Workstreams

#### F2-01 API Contract Audit and Mapping
1. Inventory frontend API consumers across `frontend/components` and `frontend/lib/hooks.ts`.
2. Map each call to v2 endpoint behavior (feed, interactions, media file serving, folder tree, indexing, settings).
3. Document compatibility shims needed in API helpers for any field normalization.

Deliverables:
1. Updated request/response typings in `frontend/lib/api.ts`.
2. A compatibility matrix of endpoint payload assumptions (in this file section).

#### F2-02 Interaction and Feed State Alignment
Status: In Progress (started 2026-04-01)

1. Ensure feed item model is v2-safe (`id`, `fileKey`, active path semantics, source projection metadata).
2. Align like/save/hide optimistic updates to v2 interaction tables via existing endpoints.
3. Ensure hidden items are excluded consistently in feed, liked/saved/hidden tabs.

Deliverables:
1. Updated feed/interactions hooks in `frontend/lib/hooks.ts`.
2. Stable optimistic UI behavior across Feed/Reels/Saved/Liked/Hidden views.

#### F2-03 Folder Tree and Hide UX Alignment
1. Align folder tree rendering with v2 folder/path semantics.
2. Support deterministic file-level hide behavior from folder actions.
3. Ensure hide/unhide flows correctly invalidate and refresh list queries.

Deliverables:
1. Updated folder components (`FolderSelection`, `FolderTreeView`, `HiddenView`).
2. Query invalidation strategy documented in hooks.

#### F2-04 Settings and Storage Mode UX
1. Align settings flows with `user_storage_configs` semantics.
2. Ensure local and rclone mode status display is accurate.
3. Preserve existing setup/reindex/reset UX while using v2 backend behavior.

Deliverables:
1. Updated `Settings` and related configuration components.
2. Correct status rendering for active storage mode and indexing state.

#### F2-05 Media Playback and File Serving Validation
1. Verify image/video playback for local and rclone-indexed entries.
2. Ensure player components handle missing/deleted path states gracefully.
3. Validate thumbnail and fallback behavior under v2 paths.

Deliverables:
1. Updated `MediaCard`, `ImageViewer`, `VideoPlayer` behavior where needed.
2. UI error states for inaccessible media.

#### F2-06 Regression Sweep and Hardening
1. Run frontend lint and targeted manual smoke flows:
   - login
   - index folder
   - browse feed/reels
   - like/save/hide/unhide
   - saved/liked/hidden views
   - settings reindex/reset
2. Fix contract mismatches and stale state bugs.

Deliverables:
1. Frontend migration completion checklist in this plan.
2. Stable behavior parity with pre-v2 UX expectations.

### Execution Order
1. F2-01 API contract audit
2. F2-02 feed and interactions
3. F2-03 folders and hide
4. F2-04 settings and storage mode
5. F2-05 playback/media validation
6. F2-06 regression sweep

### Completion Criteria
1. No frontend assumptions depend on dropped legacy tables or legacy-only fields.
2. Feed, interactions, folder hide, and settings flows are functional against backend v2.
3. Frontend lint passes and migration smoke checklist is complete.

---

## High-Level Architecture


Frontend (Next.js + Tailwind CSS + Headless UI + TanStack Query) <-> Backend API (Node.js, Fastify) <-> Local FS & SQLite

Served over HTTP on LAN (mobile browser primary). Tauri desktop app is optional for host convenience only.

---

## Tech Stack & Library Choices (Explicit)

**Backend**
- TypeScript 5.x
- Node.js
- Fastify (preferred) or Express
- better-sqlite3 (sync, fast)
- chokidar (file watching)
- mime-types (media type detection)
- sharp (image thumbnails)
- ffmpeg-static + fluent-ffmpeg (video thumbnails)
- nanoid or crypto (ID/hash generation)
- fs/promises, path
- **bcrypt** (PIN hashing)
- **@fastify/jwt** (JWT authentication)


**Frontend**
- TypeScript 5.x
- Next.js (React framework)
- Tailwind CSS (UI styling)
- Headless UI (accessible components)
- TanStack Query (data fetching/caching)
- lucide-react (icons)
- @use-gesture/react (gesture handling)
- react-player (video playback)
- **react-hook-form** (PIN form handling)

**Desktop Packaging**
- Tauri
- Optional: PWA mode

---

## Phase 1: Project Setup & Core Infrastructure

1. **Initialize Project**
   - Set up monorepo or separate backend/frontend folders.
   - Configure Node.js backend (Fastify) and Next.js frontend (mobile-first, Tailwind, Headless UI, TanStack Query, etc.).
   - Add SQLite (better-sqlite3) and chokidar for file watching.
   - Add ffmpeg wrapper for thumbnail generation.
   - Add gesture and icon libraries for frontend.

2. **Folder Selection UI**
   - Implement UI for user to select root folder (browser file picker or Tauri dialog if desktop).
   - Pass folder path to backend securely (local only).

---

## Phase 2: Media Indexing & Source System (COMPLETED ✅)

1. **Recursive Media Indexing** ✅
   - Use chokidar to watch and index supported media files (images, videos; audio/text future).
   - Store metadata in SQLite: path, type, depth, parent hash, source_id.
   - Implement incremental indexing (detect add/remove, skip unchanged).
   - Use mime-types for media type detection.
   - Use fs/promises and path for recursive scanning.
   - Assign stable IDs using nanoid or crypto (path-based hash).

2. **Source Generation** ✅
   - Derive sources from top-level folders (never expose folder names).
   - Generate deterministic display names (adjective_noun, e.g. @quiet_river) and avatars (color/SVG, optional for MVP).
   - Store sources in SQLite: id (hash), folder_path, display_name, avatar_seed.
   - Use crypto and internal word lists for name generation.
   - Handle collisions and generate avatar seeds (color/SVG, optional for MVP).

---

## Phase 3: Feed & Discovery Engine (COMPLETED ✅)

1. **Feed API** ✅
   - Implement endpoints for fetching media feeds (Reels mode primary, Feed mode nice-to-have).
   - Apply discovery logic: unseen priority, source diversity, proximity, like/save bias, entropy.
   - Ensure no semantic folder interpretation.
   - Add rules: avoid same source consecutively, random folder walk, like-weighted resurfacing.
   - Feed output should be mode-agnostic (works for both Reels and Feed if both implemented).
   - **Implemented Endpoints:**
     - `GET /api/feed?page=0&limit=20&lastSourceId=xyz` - Paginated feed with source diversity
     - `POST /api/like` - Toggle like status
     - `POST /api/save` - Toggle save status
     - `POST /api/view` - Record view event
     - `GET /api/media/:id` - Fetch media metadata
     - `GET /api/media/file/:id` - Serve media file
     - `GET /api/saved` - List saved items

2. **Frontend Feed UI** ✅
   - Infinite scroll/swipe (gesture library, mobile-first).
   - Reels mode: full-screen, vertical navigation (primary).
   - Feed mode: card-based, mixed media (optional).
   - Switch modes instantly if both implemented.
   - Native touch swipe handling for mobile
   - Use react-player for video playback.
   - Use Tailwind CSS and lucide-react for UI and icons.
   - Implement MediaCard, VideoPlayer, ImageViewer, LikeButton, SaveButton, SourceBadge components.
   - Add mode switcher and media preloading.
   - **Components Created:**
     - Feed.tsx - Main feed container with Reels/Feed mode toggle
     - MediaCard.tsx - Unified media display with auto view tracking
     - ImageViewer.tsx - Optimized image display
     - VideoPlayer.tsx - Native HTML5 video with controls
     - InteractionButtons.tsx - Like/Save buttons with feedback
     - SourceBadge.tsx - Source display with avatar
     - MainLayout.tsx - App state management
   - **Hooks Created:**
     - useFeed() - Paginated feed with caching
     - useMedia() - Individual media fetch
     - useSavedItems() - Saved items list
     - useLikeMutation() - Like with optimistic updates
     - useSaveMutation() - Save with optimistic updates
     - useViewMutation() - View tracking

---

## Phase 4: User Interactions & Persistence (COMPLETED ✅)

1. **Like, Save, View Tracking** ✅
   - Implement local like/save actions and view history.
   - Store interaction data in SQLite.
   - Use data to influence feed ranking.

   - Use TanStack Query for frontend data fetching/caching.
   - Use LocalStorage for UI preferences.
   - Implement optimistic updates and cache invalidation.
   - Add resume position logic (remember where user left off).
   - **Implemented Features:**
     - LocalStorage utilities for view mode, last viewed media, scroll position, and user preferences
     - Resume position logic to restore user's last viewed media on app restart
     - Automatic view mode persistence (Reels/Feed mode)
     - View position tracking with automatic recovery

2. **Saved Items & Navigation** ✅
   - UI for viewing saved items.
   - Optional: "More from this source", reveal file location.
   - **Implemented Features:**
     - SavedView component for browsing all saved items in a grid
     - SourceView component to browse all media from a specific source
     - NavigationBar component for switching between Feed, Saved, and Settings
     - Clickable source badges to view "More from this source"
     - Backend endpoint `GET /api/source/:sourceId/media` for fetching source-specific media
     - Frontend hook `useSourceMedia()` for data fetching
     - Empty states and loading states for all views
     - Integrated navigation with persistent bottom bar

---

## Phase 5: Performance, Reliability, and Packaging (COMPLETED ✅)

1. **Performance Optimizations**
   - Lazy load media, generate thumbnails, preload next items.
   - Use virtualized lists for large libraries.

   - Use sharp for image thumbnails, ffmpeg-static + fluent-ffmpeg for video thumbnails.
   - Generate thumbnails in background and cache them.
   - Serve thumbnails via API.
   - Add thumbnail generation endpoints and workers.
   - Implement thumbnail caching strategy.

2. **Reliability**
   - Handle deleted/moved files gracefully.
   - Ensure no data loss on restart.

   - Add large library stress test, corrupt file handling, memory optimization.
   - Add reset/reindex option and "reveal file location" (advanced).
   - Implement error boundaries and graceful degradation.
   - Add file integrity checks.

3. **Desktop Packaging (Optional)**
   - Integrate with Tauri for desktop app build (optional, not required for mobile/LAN usage).
   - PWA manifest for installable web app.

---

## Phase 6: Large Library Optimization & Polish (NEXT)

1. **Update PRD.md**
   - Document architecture, decisions, and changes in PRD.md only.
   - Avoid new markdown files.

2. **Maintain agents.md**
   - Document Copilot agent roles, responsibilities, and usage patterns.

---


---

## Phase 6: Authentication & User Management (COMPLETED ✅)

1. **Database Schema Updates** ✅
   - Added `users` table with hashed 6-digit PINs
   - Added `user_folders` table to link users to folders
   - Added `user_interactions` table with `(user_id, source_id, media_id)` composite key
   - Implemented automatic migration of existing data to default user

2. **PIN Authentication Backend** ✅
   - Installed bcrypt and @fastify/jwt
   - Created authentication routes:
     - `POST /api/auth/login` - 6-digit PIN authentication
     - `POST /api/auth/verify` - JWT token verification
     - `GET /api/auth/check-setup` - Check if users exist
   - Registered JWT plugin with authenticate middleware
   - Created CLI script: `npm run create-user <pin>`

3. **User-Scoped Operations** ✅
   - Updated sources service to associate folders with users
   - Updated indexing routes to require authentication
   - Updated feed service to use `user_interactions` table
   - All interactions now include `userId` and `sourceId`
   - Query endpoints filter by authenticated user

4. **Frontend Authentication** ✅
   - Installed react-hook-form
   - Created authentication context with JWT management
   - Built PIN login screen with 6-digit input
   - Updated main page to show login on unauthenticated access
   - Implemented long-lived session storage (30 days)

5. **API Client Updates** ✅
   - Created `authenticatedFetch` wrapper for JWT tokens
   - Updated all API hooks to use authenticated fetch
   - Modified mutation hooks to accept `sourceId`
   - Updated components to pass `sourceId` to mutations
   - Automatic token refresh and 401 handling

---

## Backend API Endpoints (Explicit)

**Authentication**
- `POST /api/auth/login` - Authenticate with 6-digit PIN
- `POST /api/auth/verify` - Verify JWT token
- `GET /api/auth/check-setup` - Check if users exist

**Feed & Media** (All require authentication)
- `GET /api/feed?page=0&limit=20&sourceId=xyz` - Get paginated feed (user-scoped)
- `POST /api/like` - Toggle like (requires mediaId + sourceId)
- `POST /api/save` - Toggle save (requires mediaId + sourceId)
- `POST /api/hide` - Toggle hide (requires mediaId + sourceId)
- `POST /api/view` - Record view (requires mediaId + sourceId)
- `GET /api/media/:id` - Get media metadata
- `GET /api/media/file/:id` - Serve media file
- `GET /api/saved` - Get saved items (user-scoped)
- `GET /api/liked` - Get liked items (user-scoped)
- `GET /api/hidden` - Get hidden items (user-scoped)

**Sources & Indexing** (All require authentication)
- `GET /api/sources` - Get user's folders
- `POST /api/index` - Index root folder (user-scoped)

REST API includes JWT validation, error handling. All endpoints are local-only, served over HTTP on LAN.

---

## Database Schema

**users**
- id (TEXT, PRIMARY KEY)
- pin_hash (TEXT, bcrypt hashed)
- created_at (INTEGER)

**user_folders**
- user_id (TEXT, FOREIGN KEY)
- source_id (TEXT, FOREIGN KEY)
- created_at (INTEGER)
- PRIMARY KEY (user_id, source_id)

**user_interactions**
- user_id (TEXT, FOREIGN KEY)
- source_id (TEXT, FOREIGN KEY)
- media_id (TEXT, FOREIGN KEY)
- liked (INTEGER, default 0)
- saved (INTEGER, default 0)
- hidden (INTEGER, default 0)
- view_count (INTEGER, default 0)
- last_viewed (INTEGER, nullable)
- PRIMARY KEY (user_id, source_id, media_id)

**sources** (unchanged)
- id, folder_path, display_name, avatar_seed, created_at

**media** (unchanged - interactions moved to user_interactions)
- id, path, source_id, depth, type, created_at

---

## Backend API Endpoints (Explicit)

- `GET /feed` (Reels mode primary, Feed mode optional)
- `POST /like`
- `POST /save`
- `POST /view`
- `GET /media/:id`
- `GET /sources/:id`

REST API must include validation and error handling. All endpoints are local-only, served over HTTP on LAN.

---

## Database Schema

**users**
- id (TEXT, PRIMARY KEY)
- pin_hash (TEXT, bcrypt hashed)
- created_at (INTEGER)

**user_folders**
- user_id (TEXT, FOREIGN KEY)
- source_id (TEXT, FOREIGN KEY)
- created_at (INTEGER)
- PRIMARY KEY (user_id, source_id)

**user_interactions**
- user_id (TEXT, FOREIGN KEY)
- source_id (TEXT, FOREIGN KEY)
- media_id (TEXT, FOREIGN KEY)
- liked (INTEGER, default 0)
- saved (INTEGER, default 0)
- hidden (INTEGER, default 0)
- view_count (INTEGER, default 0)
- last_viewed (INTEGER, nullable)
- PRIMARY KEY (user_id, source_id, media_id)

**sources** (unchanged)
- id, folder_path, display_name, avatar_seed, created_at

**media** (unchanged - interactions moved to user_interactions)
- id, path, source_id, depth, type, created_at

---

## File Watcher & Live Updates

- Use chokidar for live file system updates.
- Detect file add/remove, incremental re-index, UI refresh triggers.

---

## Agent Execution Strategy

- Each phase = milestone, each task = atomic ticket.
- No task > 300 LOC.
- No cross-phase coupling.
- Deterministic outputs.

---

## MVP Cut (Fastest Path)

- Skip avatars (optional for MVP)
- Images + videos only
- No file watcher (manual reindex button)
- Single feed mode (Reels)

---

## General Guidelines
- **Prefer libraries**: Use chokidar, better-sqlite3, ffmpeg, Next.js, Tailwind, bcrypt, JWT, etc.
- **DRY Principle**: Reuse logic for indexing, feed generation, authentication, and UI components.
- **No external network calls**: All data and processing remain local.
- **Single source of documentation**: Update PRD.md only for requirements/architecture, agents.md for agent automation. plan.md is for agent execution.
- **User isolation**: All operations are scoped to authenticated users with user_id context.

---

## Phase 7: UI Unification, Layout Stability & UX Polish (NEXT)

### Goal
Deliver a consistent mobile-first UI/UX across all pages, remove overlay collisions, and make grid behavior predictable on every screen.

### 7.1 Shared UI Foundation
1. **Create a unified page-shell pattern**
   - Standardize page structure: `Header + Content + Bottom-safe spacing`.
   - Reuse one header behavior for all pages (title, optional back button, optional actions).
   - Keep sticky vs non-sticky headers consistent by page type.

2. **Standardize states and spacing**
   - Reuse common loading, empty, and error state patterns.
   - Align typography scale, icon sizing, border radius, and spacing tokens.
   - Ensure all pages reserve bottom space for the fixed navigation bar.

3. **Extract shared grid configuration**
   - Define one Masonry breakpoint config and one card container style.
   - Reuse it in Feed (grid mode), Saved, Liked, Hidden, and Source views.

### 7.2 Page-by-Page Unification Scope
1. **Feed (Reels mode + Grid mode)**
   - Fix right-side interaction buttons and lower navigation controls so they never overlap with bottom nav.
   - Use safe-area aware offsets (`env(safe-area-inset-*)`) for top/bottom controls.
   - Keep mode/fullscreen controls at a consistent position and z-index layer.

2. **Saved / Liked / Hidden**
   - Refactor duplicated layout blocks to shared wrappers.
   - Ensure identical header behavior, item counters, empty states, and Masonry spacing.
   - Keep scrolling area and bottom padding behavior uniform.

3. **Source view**
   - Replace custom square grid with the same shared Masonry/grid system used elsewhere.
   - Match card styling and spacing with Feed/Saved/Liked/Hidden.

4. **Settings / Folder selection / Login**
   - Align visual language with the rest of the app (container width, spacing rhythm, card surfaces, button hierarchy).
   - Remove isolated styling patterns that feel like separate apps.

### 7.3 Overlay & Layering Fix Plan (Critical)
1. **Define z-index contract**
   - Navigation bar, page header, in-content media controls, and modal/overlay layers get fixed z-index rules.
   - Remove ad-hoc z-index usage where possible.

2. **Define safe-area + bottom-nav spacing contract**
   - Introduce shared bottom inset utility (e.g., `pb-[calc(5rem+env(safe-area-inset-bottom))]`).
   - Apply to every scroll container and reels overlay control region.

3. **Regression checks for overlap**
   - Verify no button collision in portrait mobile, landscape mobile, and desktop widths.
   - Verify touch targets remain tappable and visible while scrolling.

### 7.4 UX Quality Pass
1. **Mobile-first interaction polish**
   - Minimum tap target size (44x44).
   - Consistent feedback for like/save/hide actions.
   - Preserve one-handed reach for primary actions.

2. **Accessibility pass**
   - Keyboard/focus states visible on controls.
   - Sufficient contrast in light/dark mode.
   - ARIA labels validated for icon-only buttons.

### 7.5 Implementation Sequence
1. Build shared layout/grid utilities.
2. Migrate Saved/Liked/Hidden to shared patterns.
3. Migrate Source view to shared grid.
4. Fix Feed overlay/layering collisions.
5. Unify Settings, FolderSelection, Login styling.
6. Final responsive/accessibility regression pass.

### 7.6 Acceptance Criteria
- All major pages use the same layout primitives and state patterns.
- No overlay button collisions with bottom nav or headers on mobile.
- Grid behavior is consistent across Feed, Saved, Liked, Hidden, and Source pages.
- Login/FolderSelection/Settings visually match the app-wide design language.
- No new markdown files created; updates remain in `plan.md`/`PRD.md`/`agents.md` only.

---

## Implementation Status

**Completed:**
- ✅ Phase 1: Project Setup & Core Infrastructure
- ✅ Phase 2: Media Indexing & Source System
- ✅ Phase 3: Feed & Discovery Engine
- ✅ Phase 4: Frontend Feed UI (Reels & Feed modes)
- ✅ Phase 5: Interaction Tracking & Saved Items
- ✅ Phase 6: Authentication & User Management

**Remaining:**
- Phase 7: UI unification, overlay fixes, and cross-page UX polish
- Desktop packaging (Tauri - optional)
- Advanced features (filters, search, etc.)

---

## Next Steps
- Monitor performance with large libraries
- Add desktop packaging if needed
- Implement optional features as requested
- After each phase, update PRD.md with implementation notes.
- Use agents.md to clarify Copilot agent automation and boundaries.
