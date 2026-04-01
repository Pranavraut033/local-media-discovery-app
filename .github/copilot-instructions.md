# Project Guidelines

## Architecture
- This is a local-first app split into `backend/` (Fastify + SQLite + indexing/services/routes) and `frontend/` (Next.js app router + UI components + Zustand + TanStack Query).
- Keep responsibilities separated:
  - Backend owns auth, indexing, feed ranking, filesystem access, thumbnails, and media serving.
  - Frontend owns UI rendering, interaction state, API calls, and client persistence.
- Follow phased implementation and constraints from `plan.md` and product goals in `PRD.md`.

## Build and Test
- Install dependencies:
  - Root: `npm run install:all`
  - Or per app: `cd backend && npm install`, `cd frontend && npm install`
- Development:
  - Backend: `cd backend && npm run dev`
  - Frontend: `cd frontend && npm run dev`
- Production build:
  - Root: `npm run build`
  - Run stack with PM2: `npm start`
- Quality checks currently available:
  - Backend type-check: `cd backend && npm run type-check`
  - Frontend lint: `cd frontend && npm run lint`
- If you change code, run the most relevant script(s) for touched areas before finishing.

## Conventions
- DRY and library-first: prefer existing dependencies over bespoke implementations.
- Local-only and privacy-first:
  - Do not add telemetry, cloud sync, or external network dependencies.
  - Treat root-folder path as client-side only (do not persist server-side).
- Authentication and scoping:
  - Keep PIN auth as exactly 6 numeric digits.
  - Keep folders and interactions scoped per authenticated user.
- State management:
  - Prefer Zustand store hooks from `frontend/lib/stores/` (migration details in `MIGRATION_ZUSTAND.md`).
  - Do not introduce new raw localStorage patterns when a store already exists.
- API usage:
  - Use authenticated API helpers in `frontend/lib/api.ts` for protected endpoints.
- UX direction:
  - Preserve mobile-first behavior; Reels-style flow remains primary.

## Project-Specific Gotchas
- Frontend and backend run on different dev ports (`3000` and `3001`).
- Frontend uses static export config in `frontend/next.config.ts`; keep compatibility with export mode.
- User creation requires DB initialization first; see `AUTH_SETUP.md`.
- If auth appears broken in development, check token state/local storage and setup steps in `AUTH_SETUP.md`.

## Documentation Map
- Product requirements and decisions: `PRD.md`
- Phased implementation plan: `plan.md`
- Authentication setup and troubleshooting: `AUTH_SETUP.md`
- Zustand migration and state patterns: `MIGRATION_ZUSTAND.md`
- Project overview and runbook: `README.md`
- Agent workflow constraints and boundaries: `agents.md`