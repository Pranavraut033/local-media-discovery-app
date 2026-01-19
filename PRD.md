# Project Requirements Document (PRD)

## 1. Project Overview

### 1.1 Purpose

Build a **local-first, web-based media discovery application** that transforms a folder (with arbitrarily named, deeply nested subfolders) into an **exploratory, social-media-like experience**. The system runs entirely on the user’s machine and does not rely on internet connectivity.

### 1.2 Core Idea

Instead of browsing folders manually, users consume media through:

* Infinite feeds (Reels-style or Twitter-style)
* Algorithmic discovery
* Pseudo social elements (likes, saves, sources)

The application treats folders as **structural data only**, not semantic categories.

---

## 2. Goals & Non-Goals

### 2.1 Goals

* Local-only execution (privacy-first)
* Folder-agnostic content discovery
* Immersive, social-media-like UX
* Deterministic pseudo users (“Sources”)
* Minimal configuration required from the user
* High performance with large media libraries

### 2.2 Non-Goals

* No real user accounts or authentication
* No cloud sync or networking
* No comments, followers, or messaging
* No semantic interpretation of folder names

---

## 3. Target Platform

* **Mobile-first (primary UX target)**
* Desktop (host and secondary client)

### 3.1 Mobile-First Principle

* All UX decisions must prioritize **mobile screens, touch input, and one-handed usage**
* Desktop UI is an adaptive extension of the mobile UI, not a separate design
* Reels-style vertical consumption is the default interaction model

### 3.2 Access Model

* Application runs as a **local service** on the host machine
* Service is accessible via **URL over local network** (LAN)
* Mobile devices (phone/tablet) access the app through a browser using the host’s IP address and port

Example:

```
http://<local-ip>:<port>
```

### 3.3 Supported Clients

* Mobile browsers (iOS Safari, Android Chrome) — **primary**
* Desktop browsers (Chrome, Firefox, Safari)
* No native mobile app required

---

## 4. Functional Requirements

### 4.1 Media Indexing

* User selects a **root folder**
* System recursively scans all subfolders
* Supported media types:

  * Images (jpg, png, webp)
  * Videos (mp4, webm)
  * Optional: audio, text (future)
* Indexing extracts:

  * File path
  * File type
  * Folder depth
  * Parent folder hash

Indexing must:

* Be incremental
* Detect added/removed files
* Avoid reprocessing unchanged media

---

### 4.2 Source (Pseudo User) System

#### Definition

A **Source** is a deterministic, fictional identity representing a structural content origin.

#### Rules

* Sources are derived from folder structure (top-level or first-level folder)
* Folder names are never exposed
* Each source has:

  * Stable display name (e.g. `@quiet_river`)
  * Generated avatar (color or SVG)

#### Name Generation

* Deterministic
* Seeded by folder path hash
* Format: `@<adjective>_<noun>`

---

### 4.3 Feed & Discovery Engine

#### Feed Modes

* **Reels Mode**: vertical, full-screen, swipe-based
* **Feed Mode**: mixed media cards (Twitter-style)

#### Discovery Logic

Feed ordering must consider:

* Unseen media priority
* Source diversity
* Structural proximity (same folder cluster)
* Like/save bias
* Randomization (entropy)

No semantic tags or categories are used.

---

### 4.4 User Interactions

Supported interactions:

* Like (❤️)
* Save (🔖)
* View history tracking

Stored locally and used to influence discovery ranking.

---

### 4.5 Navigation & Controls

Mobile-first interaction rules:

* Vertical swipe as the primary navigation
* Tap zones optimized for thumb reach
* Long-press for secondary actions (e.g. save)
* Minimal on-screen controls

Supported controls:

* Infinite swipe / scroll
* One-tap Like (❤️)
* One-tap Save (🔖)
* Gesture or button to switch feed modes
* View saved items

Optional:

* “More from this source”
* Reveal file location (advanced / desktop-oriented)

---

## 5. Non-Functional Requirements

### 5.1 Performance

* Optimized for **mobile browsers**
* Lazy loading of media
* Thumbnail generation
* Virtualized lists
* Aggressive memory management
* Preloading next items with bandwidth awareness

### 5.2 Reliability

* No data loss on restart
* Safe handling of deleted/moved files

### 5.3 Privacy & Security

* No external network calls
* No telemetry by default
* All data stored locally

---

## 6. Data Storage

### 6.1 Database

* SQLite (single local file)

### 6.2 Core Tables

**sources**

* id (hash)
* folder_path
* display_name
* avatar_seed

**media**

* id (hash)
* path
* source_id
* depth
* type
* liked
* saved
* view_count
* last_viewed

---

## 7. Technical Requirements

### 7.1 Architecture

**Service-Oriented Local Architecture**

The application runs as a **long-lived local service**.

**Backend (Service Layer)**

* Binds to `0.0.0.0` or configurable local IP
* Serves HTTP API + static frontend
* Handles:

  * File system indexing
  * Discovery/feed generation
  * Media streaming
  * Persistence

**Frontend (Client Layer)**

* Accessed via browser over local network
* Responsive UI optimized for mobile and desktop
* Touch-first interactions for mobile (swipe, tap)

---

### 7.2 Tech Stack (Library-First, DRY)

#### Backend (Local Service)

* Node.js
* Fastify (preferred for performance) or Express
* fastify-static (serving frontend)
* chokidar (file watching)
* better-sqlite3 or sqlite3 (local DB)
* ffmpeg via wrapper (thumbnail generation)

#### Frontend (Web Client)

* React or Svelte
* Vite (single build output served by backend)
* Virtualization library (e.g. react-window)
* Gesture handling library (touch + mouse)
* Responsive layout utilities

#### Networking

* HTTP over LAN
* No external network dependencies
* Configurable port

#### Desktop Wrapper (Optional)

* Tauri (host convenience only, not required)

Libraries must be preferred over custom implementations whenever possible.

---

## 8. Documentation Strategy

* **Single primary documentation file** (this document)
* Update sections as features evolve
* Avoid multiple fragmented markdown files
* Architecture, decisions, and changes appended as sections

---

## 9. MVP Scope

Must-have:

* Folder selection
* Media indexing
* Reels feed
* Like & Save
* Source generation
* Local persistence

Nice-to-have:

* Feed mode
* Desktop packaging
* Entropy slider

---

## 10. Constraints & Assumptions

* User trusts local filesystem access
* Media libraries may be large
* Folder names are arbitrary and meaningless

---

## 11. Success Criteria

* Mobile browser is the **primary and best experience**
* One-handed navigation feels natural
* Feed interaction matches modern mobile social apps
* Service starts once and remains available on the local network
* User can open the app from a mobile browser via URL
* Media playback and feed interaction work smoothly on mobile
* No requirement to install apps on mobile devices
* Same local data and state shared across all devices on the LAN

---

## 12. Future Extensions (Out of Scope)

* Semantic tagging
* Cloud sync
* Multi-device sharing
* Collaborative features

---

**End of Document**
