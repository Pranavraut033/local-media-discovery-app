# Local Media Discovery App

A local-first, web-based media discovery application that transforms your media folders into an exploratory, social-media-like experience—accessible from any device on your local network.

## ✨ Features

- 📱 **Mobile-first design** - Access from any device on your local network
- 🔒 **100% local and private** - No internet required, all data stays on your machine
- 🔐 **Privacy-first architecture** - Root folder path stored in browser localStorage, never on the backend
- 🎬 **Media support** - Images (JPG, PNG, WebP, GIF) and videos (MP4, WebM, MOV, MKV)
- 🎯 **Smart discovery algorithm** - Unseen priority, source diversity, like/save bias
- ❤️ **Like and save** - Track your favorite media with optimistic updates
- 🔖 **Saved items view** - Browse all your saved media in one place
- 👤 **Source system** - Auto-generated pseudo-users from top-level folders
- 🎭 **Multiple view modes** - Reels (vertical swipe) or Feed (grid) mode
- 💾 **Resume position** - Automatically remember where you left off
- 🔄 **Live file watching** - Automatically detect added/removed media
- 🌐 **Remote folder browser** - Browse host folders from mobile devices
- 📡 **LAN accessible** - Connect from any device on your network

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- A folder with media files (photos/videos)

### Installation

1. Install backend dependencies:
```bash
cd backend
npm install
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
```

### Development

1. Start the backend server:
```bash
cd backend
npm run dev
```

The backend will run in watch mode and automatically restart on file changes.

2. In a new terminal, start the frontend dev server:
```bash
cd frontend
npm run dev
```

3. Open http://localhost:3000 in your browser

### Production Build

1. Build the backend:
```bash
cd backend
npm run build
```

2. Build the frontend:
```bash
cd frontend
npm run build
```

3. Start the backend (serves both API and frontend):
```bash
cd backend
npm start
```

4. Access the app:
   - Desktop: http://localhost:3001
   - Mobile: http://`<your-local-ip>`:3001

To find your local IP:
- macOS/Linux: `ifconfig | grep "inet "`
- Windows: `ipconfig`

## Project Structure

```
local-media-discovery-app/
├── backend/           # Node.js + Fastify API server (TypeScript)
│   ├── src/
│   │   ├── db/       # SQLite database and schema
│   │   ├── routes/   # API endpoints
│   │   ├── services/ # Business logic
│   │   └── index.ts  # Server entry point
│   ├── dist/         # Compiled JavaScript (generated)
│   ├── tsconfig.json # TypeScript configuration
│   └── package.json
├── frontend/          # Next.js + React UI (TypeScript)
│   ├── app/          # Next.js app router
│   ├── components/   # React components
│   └── package.json
├── PRD.md            # Product requirements
├── plan.md           # Implementation plan
└── agents.md         # Agent automation docs
```

## Tech Stack

**Backend:**
- TypeScript 5.x
- Node.js + Fastify
- SQLite (better-sqlite3)
- chokidar (file watching)
- sharp (image processing)
- ffmpeg (video thumbnails)

**Frontend:**
- TypeScript 5.x
- Next.js 15
- React 19
- Tailwind CSS
- TanStack Query (data fetching)
- Headless UI (accessible components)
- lucide-react (icons)
- @use-gesture/react (touch gestures)
- react-player (video playback)

## 🎯 Implementation Status

### ✅ Phase 1: Project Setup & Core Infrastructure (COMPLETED)
- [x] Monorepo structure with backend/frontend
- [x] Fastify backend with TypeScript
- [x] Next.js frontend with Tailwind CSS
- [x] SQLite database with better-sqlite3
- [x] Basic folder selection UI

### ✅ Phase 2: Media Indexing & Source System (COMPLETED)
- [x] Recursive media indexing with chokidar
- [x] File type detection with mime-types
- [x] Incremental indexing (detect add/remove)
- [x] Source generation from top-level folders
- [x] Deterministic display names (@adjective_noun)
- [x] Avatar color generation from seeds
- [x] Live file watching and updates

### ✅ Phase 3: Feed & Discovery Engine (COMPLETED)
- [x] Feed API with pagination
- [x] Discovery algorithm (unseen priority, diversity, entropy)
- [x] Like/Save/View tracking endpoints
- [x] Source diversity rules (avoid consecutive same source)
- [x] Frontend feed UI with Reels and Feed modes
- [x] MediaCard, VideoPlayer, ImageViewer components
- [x] InteractionButtons with optimistic updates
- [x] Infinite scroll with TanStack Query
- [x] Touch gesture support for mobile
- [x] Media preloading

### ✅ Phase 4: User Interactions & Persistence (COMPLETED)
- [x] LocalStorage for UI preferences
- [x] Resume position logic (remember last viewed)
- [x] View mode persistence (Reels/Feed)
- [x] Saved items view UI with grid layout
- [x] Source-specific media browsing ("More from this source")
- [x] Navigation bar (Feed/Saved/Settings)
- [x] Clickable source badges
- [x] Remote folder browser for mobile devices
- [x] Backend filesystem API for browsing host folders

### 🚧 Phase 5: Performance & Reliability (NEXT)
- [ ] Thumbnail generation (sharp for images, ffmpeg for videos)
- [ ] Media caching and optimization
- [ ] Virtualized lists for large libraries
- [ ] Large library stress testing
- [ ] Error handling and graceful degradation
- [ ] Reset/reindex functionality

### 📋 Phase 6: Documentation & Polish
- [ ] User guide and setup instructions
- [ ] API documentation
- [ ] Desktop packaging with Tauri (optional)
- [ ] PWA support (optional)

## 📁 API Endpoints

**Configuration:**
- `POST /api/config/root-folder` - Set root folder and trigger indexing (path sent from frontend, not stored on backend)
- `DELETE /api/config/root-folder` - Clear database (root folder stored in browser localStorage)

**Filesystem:**
- `GET /api/filesystem/roots` - Get common root directories
- `GET /api/filesystem/list?path=...` - List directory contents

**Indexing:**
- `POST /api/index/start` - Start indexing
- `GET /api/index/status` - Get indexing status
- `POST /api/index/stop` - Stop indexing

**Feed & Media:**
- `GET /api/feed?page=0&limit=20` - Get paginated feed
- `POST /api/like` - Toggle like status
- `POST /api/save` - Toggle save status
- `POST /api/view` - Record view
- `GET /api/media/:id` - Get media metadata
- `GET /api/media/file/:id` - Serve media file
- `GET /api/saved` - Get all saved items
- `GET /api/source/:sourceId/media` - Get media from specific source

## 🎨 User Interface

**Main Views:**
- **Folder Selection** - Remote browser or manual path entry
- **Feed (Reels Mode)** - Full-screen vertical swipe navigation
- **Feed (Grid Mode)** - Card-based grid layout
- **Saved View** - Grid of all saved items
- **Source View** - Browse all media from a specific source
- **Settings** - Coming soon

**Components:**
- MediaCard - Unified media display with auto view tracking
- ImageViewer - Optimized image display
- VideoPlayer - Native HTML5 video with controls
- InteractionButtons - Like/Save with feedback
- SourceBadge - Clickable source display
- NavigationBar - Bottom navigation for mobile

## 📝 License

ISC
