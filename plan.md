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
- Node.js
- Fastify (preferred) or Express
- better-sqlite3 (sync, fast)
- chokidar (file watching)
- mime-types (media type detection)
- sharp (image thumbnails)
- ffmpeg-static + fluent-ffmpeg (video thumbnails)
- nanoid or crypto (ID/hash generation)
- fs/promises, path


**Frontend**
- Next.js (React framework)
- Tailwind CSS (UI styling)
- Headless UI (accessible components)
- TanStack Query (data fetching/caching)
- lucide-react (icons)
- @use-gesture/react (gesture handling)
- react-player (video playback)

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

## Phase 2: Media Indexing & Source System

1. **Recursive Media Indexing**
   - Use chokidar to watch and index supported media files (images, videos; audio/text future).
   - Store metadata in SQLite: path, type, depth, parent hash, source_id.
   - Implement incremental indexing (detect add/remove, skip unchanged).
   - Use mime-types for media type detection.
   - Use fs/promises and path for recursive scanning.
   - Assign stable IDs using nanoid or crypto (path-based hash).

2. **Source Generation**
   - Derive sources from top-level folders (never expose folder names).
   - Generate deterministic display names (adjective_noun, e.g. @quiet_river) and avatars (color/SVG, optional for MVP).
   - Store sources in SQLite: id (hash), folder_path, display_name, avatar_seed.
   - Use crypto and internal word lists for name generation.
   - Handle collisions and generate avatar seeds (color/SVG, optional for MVP).

---

## Phase 3: Feed & Discovery Engine

1. **Feed API**
   - Implement endpoints for fetching media feeds (Reels mode primary, Feed mode nice-to-have).
   - Apply discovery logic: unseen priority, source diversity, proximity, like/save bias, entropy.
   - Ensure no semantic folder interpretation.
   - Add rules: avoid same source consecutively, random folder walk, like-weighted resurfacing.
   - Feed output should be mode-agnostic (works for both Reels and Feed if both implemented).

2. **Frontend Feed UI**
   - Infinite scroll/swipe (gesture library, mobile-first).
   - Reels mode: full-screen, vertical navigation (primary).
   - Feed mode: card-based, mixed media (optional).
   - Switch modes instantly if both implemented.
   - Use @use-gesture/react for swipe/gesture handling.
   - Use react-player for video playback.
   - Use Tailwind CSS and lucide-react for UI and icons.
   - Implement MediaCard, VideoPlayer, ImageViewer, LikeButton, SaveButton, SourceBadge components.
   - Add mode switcher and media preloading.

---

## Phase 4: User Interactions & Persistence

1. **Like, Save, View Tracking**
   - Implement local like/save actions and view history.
   - Store interaction data in SQLite.
   - Use data to influence feed ranking.

   - Use TanStack Query for frontend data fetching/caching.
   - Use LocalStorage for UI preferences.
   - Implement optimistic updates and cache invalidation.
   - Add resume position logic (remember where user left off).

2. **Saved Items & Navigation**
   - UI for viewing saved items.
   - Optional: "More from this source", reveal file location.

---

## Phase 5: Performance, Reliability, and Packaging

1. **Performance Optimizations**
   - Lazy load media, generate thumbnails, preload next items.
   - Use virtualized lists for large libraries.

   - Use sharp for image thumbnails, ffmpeg-static + fluent-ffmpeg for video thumbnails.
   - Generate thumbnails in background and cache them.
   - Serve thumbnails via API.

2. **Reliability**
   - Handle deleted/moved files gracefully.
   - Ensure no data loss on restart.

   - Add large library stress test, corrupt file handling, memory optimization.
   - Add reset/reindex option and "reveal file location" (advanced).

3. **Desktop Packaging (Optional)**
   - Integrate with Tauri for desktop app build (optional, not required for mobile/LAN usage).

---

## Phase 6: Documentation & Maintenance

1. **Update PRD.md**
   - Document architecture, decisions, and changes in PRD.md only.
   - Avoid new markdown files.

2. **Maintain agents.md**
   - Document Copilot agent roles, responsibilities, and usage patterns.

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

## Database Schema Additions

- Add `created_at` to sources table.
- Implement migration logic and indexes for performance.
- Schema per PRD.md: sources (id, folder_path, display_name, avatar_seed), media (id, path, source_id, depth, type, liked, saved, view_count, last_viewed)

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
- **Prefer libraries**: Use chokidar, better-sqlite3, ffmpeg, Next.js, Tailwind, etc.
- **DRY Principle**: Reuse logic for indexing, feed generation, and UI components.
- **No external network calls**: All data and processing remain local.
- **Single source of documentation**: Update PRD.md only for requirements/architecture, agents.md for agent automation. plan.md is for agent execution.

---

## Next Steps
- Begin with Phase 1 and proceed sequentially.
- After each phase, update PRD.md with implementation notes.
- Use agents.md to clarify Copilot agent automation and boundaries.
