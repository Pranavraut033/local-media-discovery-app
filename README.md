# Local Media Discovery

**A local-first, privacy-first media discovery app** — transforms your personal photo and video library into a swipeable, algorithmically ranked feed you can access from any device on your home network.

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)

> **Live showcase:** open `landing/index.html` in your browser for an interactive overview.

No cloud. No accounts. No telemetry. Your files stay on your machine.

---

## Features

- **Reels mode** — full-screen vertical swipe, one item at a time
- **Feed mode** — grid browsing for fast scanning
- **Algorithmic ranking** — unseen priority, source diversity, interaction bias, entropy
- **Like / Save / Hide** — interactions that refine your feed; accessible from any LAN device
- **Source identities** — deterministic pseudo-handles (e.g. `@quiet_river`) derived from folder structure
- **Remote sources** — Android Termux rclone daemon integration for phone libraries
- **Multi-user** — per-user folders, interactions, and preferences; isolated by 6-digit PIN
- **PWA-ready** — installable, works over LAN from any phone or tablet

**Supported media:** JPG, JPEG, PNG, WebP, GIF · MP4, WebM, MOV

---

## Architecture

Three independent processes managed by PM2:

| Process | Port | Responsibility |
|---|---|---|
| `backend/` | 3001 | Auth, indexing, feed ranking, SQLite (Drizzle ORM), BullMQ workers |
| `frontend/` | 3000 | Next.js static export, TanStack Query, Zustand |
| `media-server/` | 3002 | HMAC-gated streaming, thumbnail cache *(optional for local files)* |

The media server is stateless — it verifies 2-hour HMAC tokens signed by the backend without touching the database.

---

## Prerequisites

- **Node.js 18+** and npm
- **ffmpeg** (for video thumbnail generation) — installed automatically via `ffmpeg-static`
- Media files on local disk or accessible via rclone remote
- **PM2** for production: `npm install -g pm2`

---

## Quick Start

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Initialize the database

```bash
cd backend && npm run dev
# Wait for "Database initialized" in logs, then Ctrl+C
```

### 3. Create your first user

```bash
cd backend && npm run create-user 123456
# Replace 123456 with your own 6-digit PIN
```

### 4. Start development servers

```bash
# Terminal 1
cd backend && npm run dev      # API on :3001

# Terminal 2
cd frontend && npm run dev     # UI on :3000

# Terminal 3 (optional — needed for video streaming on LAN)
cd media-server && npm run dev # Media server on :3002
```

Open **http://localhost:3000**, enter your PIN, add a folder, and start indexing.

### 5. Access from phone / tablet

Find your host IP (`ifconfig` / `ipconfig`), then open `http://<host-ip>:3000` in your mobile browser.

---

## Production

```bash
npm run build   # Compiles all three services
npm start       # Build + launch via PM2
```

```bash
npm run status   # PM2 process list
npm run logs     # Stream all logs
npm run restart  # Rolling restart
npm run stop     # Stop all processes
```

---

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | auto-generated | Secret for signing JWTs — **set this in production** |
| `MEDIA_SERVER_SECRET` | auto-generated | Shared HMAC secret between backend and media-server — **must match on both** |
| `PORT` | `3001` | Backend API port |
| `NODE_ENV` | `development` | Set to `production` for hardened headers and logging |

Example `.env` for production:

```bash
JWT_SECRET=replace-with-a-strong-random-secret
MEDIA_SERVER_SECRET=same-secret-used-in-media-server
NODE_ENV=production
```

> **Important:** both `backend/` and `media-server/` must share the same `MEDIA_SERVER_SECRET` or streaming will fail.

---

## Remote Sources (Android Termux)

Install rclone in Termux and start the daemon:

```bash
pkg update && pkg install rclone -y
rclone config    # set up your remote(s)

# Start daemon (add --rc-user / --rc-pass on shared networks)
rclone rcd --rc-addr=0.0.0.0:5572 --rc-no-auth
```

Then go to **Settings → Remote sources** in the app, enter your phone's IP and port, test the connection, and save.

Keep the Termux session alive while indexing. If the phone sleeps and drops the connection, restart the daemon.

---

## Development

```bash
# Quality checks — run before finishing any change
cd backend  && npm run type-check
cd frontend && npm run lint

# Database migrations
cd backend && npm run db:migrate
```

Schema lives in `backend/src/db/schema.ts`. Run migrations after any schema change.

---

## Project Structure

```
local-media-discovery-app/
├── backend/          # Fastify API, SQLite, BullMQ indexing workers
├── frontend/         # Next.js static export, Zustand stores, TanStack Query
├── media-server/     # HMAC-gated media streaming and thumbnail cache
├── landing/          # Standalone showcase page (open index.html in browser)
├── ecosystem.config.cjs  # PM2 process definitions
└── PRD.md            # Product requirements and design decisions
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Login fails | PIN must be exactly 6 digits; confirm user was created with `create-user` |
| No media after indexing | Verify the folder path exists and is readable; trigger reindex from Settings |
| Streaming broken on LAN | Ensure both `backend` and `media-server` share the same `MEDIA_SERVER_SECRET` |
| rclone won't connect | Phone and host must be on the same Wi-Fi; check daemon is running on the configured port |
| Database errors on start | Delete `backend/media-discovery.db` and re-run `npm run dev` to reinitialize |

---

## Contributing

This is a personal project but issues and PRs are welcome. Before contributing, run the quality checks above and review `CLAUDE.md` for codebase conventions.

---

## License

ISC — see [LICENSE](LICENSE) for details.
