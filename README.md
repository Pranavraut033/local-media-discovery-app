# Local Media Discovery App

Local-first media discovery for personal photo and video libraries. Instead of browsing nested folders manually, you get a swipeable, source-diverse feed optimized for phones and accessible from any device on your LAN.

## Overview

- 100% local: no cloud sync, no telemetry, no external dependency for core usage.
- Mobile-first: Reels-style flow is the primary interaction model.
- Private by design: authentication and user-scoped data are built in.
- Folder-agnostic discovery: folder names are treated as structure, not categories.

## Feature Highlights

### Discovery and Feed

- Reels mode: full-screen vertical swipe experience.
- Feed mode: grid browsing for fast scanning.
- Discovery ranking combines unseen priority, source diversity, interaction bias, and entropy.
- Infinite loading with prefetching for smoother browsing.

### Media and Indexing

- Supported images: JPG, JPEG, PNG, WebP, GIF.
- Supported videos: MP4, WebM, MOV.
- Recursive indexing with live watcher updates.
- Source system generates deterministic pseudo identities (for example: @quiet_river) from top-level structure.

### Interactions and Views

- Like media.
- Save media for later.
- Hide media from the main feed.
- Track views and revisit behavior.
- Dedicated views for Saved, Liked, and Hidden items.
- Source-specific browsing for "more from this source" workflows.

### Authentication and User Scope

- 6-digit PIN login.
- JWT-backed sessions (30-day validity).
- Multi-user support on one host.
- Folder associations and interactions are isolated per user.

### Remote Sources

- Android Termux rclone daemon integration.
- Remote connection testing and configuration from Settings.
- Local storage mode and remote storage mode support.

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Media files available on local disk or via an rclone-accessible remote

### 1. Install dependencies

From the repository root:

```bash
npm run install:all
```

Or install per app:

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Initialize database and create first user

Start backend once so schema initialization runs:

```bash
cd backend
npm run dev
```

After the server logs database initialization, stop it and create your user:

```bash
cd backend
npm run create-user 123456
```

Replace 123456 with your own 6-digit PIN.

### 3. Run development servers

Terminal 1 (backend API):

```bash
cd backend
npm run dev
```

Terminal 2 (frontend UI):

```bash
cd frontend
npm run dev
```

Development URLs:

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

### 4. First login and first index

1. Open the frontend in your browser.
2. Enter your 6-digit PIN on the login screen.
3. Open folder setup and choose your root folder.
4. Start indexing.
5. Wait for initial indexing to complete, then begin browsing feed/reels.

### 5. Access from phone/tablet on LAN

Use your host IP address in the mobile browser:

- Frontend dev URL: http://<your-local-ip>:3000
- Backend API is used by the frontend on port 3001.

Find your host IP:

- macOS/Linux: ifconfig
- Windows: ipconfig

## Using the App

### Reels vs Feed

- Reels mode is best for immersive, one-item-at-a-time browsing.
- Feed mode is best for quick scanning in a grid layout.
- The selected view mode persists per user preference.

### Like, Save, Hide semantics

- Like: mark favorites and influence ranking.
- Save: explicit bookmark list for later revisits.
- Hide: remove items from normal feed flow without deleting files.

### Sources

- A source is a deterministic pseudo identity mapped from folder structure.
- Real folder names are not exposed as social labels in the feed UI.

### Settings and preferences

- View mode preference.
- Video autoplay behavior.
- Source badge visibility.
- Reindex/reset maintenance actions.

## Remote Sources (rclone)

### Android Termux setup

Install and configure rclone in Termux:

```bash
pkg update && pkg upgrade -y
pkg install rclone -y
rclone config
```

Start rclone daemon (no auth):

```bash
rclone rcd --rc-addr=0.0.0.0:5572 --rc-no-auth
```

Start rclone daemon (recommended auth on shared networks):

```bash
rclone rcd --rc-addr=0.0.0.0:5572 --rc-user=myuser --rc-pass=mypassword
```

Then in app Settings, configure Android rclone connection and test before saving.

### Notes

- Keep phone and host on the same network.
- Keep Termux session alive while scanning/indexing.
- If connectivity drops after sleep, restart rclone daemon.

## Development and Scripts

Root scripts:

- npm run install:all
- npm run dev:backend
- npm run dev:frontend
- npm run build
- npm start (builds and launches PM2 ecosystem)

Backend scripts:

- npm run dev
- npm run build
- npm run type-check
- npm run create-user <6-digit-pin>
- npm run db:migrate

Frontend scripts:

- npm run dev
- npm run build
- npm run lint

## Production Runbook

From project root:

```bash
npm run build
npm start
```

Useful PM2 commands:

- npm run status
- npm run logs
- npm run restart
- npm run stop

PM2 services are defined in ecosystem.config.cjs.

## Environment Variables

- PORT: backend port (defaults to 3001).
- NODE_ENV: environment mode.
- JWT_SECRET: recommended in production for secure token signing.

Example:

```bash
export JWT_SECRET="replace-with-a-strong-random-secret"
```

## API Summary

Authentication:

- POST /api/auth/login
- POST /api/auth/verify
- GET /api/auth/check-setup

Configuration and filesystem:

- POST /api/config/root-folder
- DELETE /api/config/root-folder
- GET /api/filesystem/roots
- GET /api/filesystem/list

Indexing:

- POST /api/index/start
- GET /api/index/status
- POST /api/index/stop

Feed and interactions:

- GET /api/feed
- POST /api/like
- POST /api/save
- POST /api/hide
- POST /api/view
- GET /api/saved
- GET /api/liked
- GET /api/hidden
- GET /api/source/:sourceId/media
- GET /api/media/:id
- GET /api/media/file/:id

## Troubleshooting

### Invalid PIN or login issues

- Confirm PIN is exactly 6 digits.
- Clear browser local storage and retry.
- Verify you created at least one user using create-user.

### No media appears after folder selection

- Check indexing status in app.
- Verify folder path still exists and is readable.
- Restart backend and trigger reindex.

### rclone connection issues

- Confirm phone/host are on same Wi-Fi.
- Confirm daemon is running and reachable on configured port.
- Re-test credentials if using rc auth.

## Privacy and Security Notes

- All data remains local to your environment.
- No telemetry or cloud sync is added by default.
- PINs are hashed; JWT is used for API authorization.
- User data is isolated per account.

## Project Structure

```text
local-media-discovery-app/
├── backend/                 # Fastify + SQLite + indexing/services/routes
├── frontend/                # Next.js app router + UI + Zustand + query hooks
├── AUTH_SETUP.md            # Authentication setup and troubleshooting
├── PRD.md                   # Product requirements
├── plan.md                  # Phased implementation plan
├── agents.md                # Agent workflow constraints
└── ecosystem.config.cjs     # PM2 process definitions
```

## Tech Stack

Backend:

- TypeScript
- Node.js + Fastify
- SQLite (better-sqlite3, Drizzle ORM)
- chokidar
- sharp
- ffmpeg-static + fluent-ffmpeg

Frontend:

- TypeScript
- Next.js + React
- TanStack Query
- Zustand
- Headless UI
- Tailwind CSS
- react-player

## Current Status

- Core architecture, indexing, feed, interactions, and mobile-first browsing are implemented.
- Auth, user scoping, and remote source integration are implemented.
- Ongoing work is tracked in plan.md.

## Additional Documentation

- Product requirements: PRD.md
- Auth setup details: AUTH_SETUP.md
- Implementation plan: plan.md
- Zustand migration notes: MIGRATION_ZUSTAND.md

## License

ISC
