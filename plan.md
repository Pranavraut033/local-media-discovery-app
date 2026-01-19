# Implementation Plan for Copilot Agent

## Overview
This plan provides phased, actionable steps for implementing the local-media-discovery-app as described in the PRD. It is structured for Copilot agent execution, prioritizing existing libraries, DRY principles, and incremental delivery.

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

## Implementation Status

**Completed:**
- ✅ Phase 1: Project Setup & Core Infrastructure
- ✅ Phase 2: Media Indexing & Source System
- ✅ Phase 3: Feed & Discovery Engine
- ✅ Phase 4: Frontend Feed UI (Reels & Feed modes)
- ✅ Phase 5: Interaction Tracking & Saved Items
- ✅ Phase 6: Authentication & User Management

**Remaining:**
- Desktop packaging (Tauri - optional)
- Advanced features (filters, search, etc.)

---

## Next Steps
- Monitor performance with large libraries
- Add desktop packaging if needed
- Implement optional features as requested
- After each phase, update PRD.md with implementation notes.
- Use agents.md to clarify Copilot agent automation and boundaries.
