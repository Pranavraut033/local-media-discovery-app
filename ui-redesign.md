# UI Redesign Spec (LLM-Friendly)

## Goal
Redesign the existing app screens for both desktop and mobile with an **Ethos Narrative** theme, prioritizing **media/video immersion** and minimizing visual obstruction over content.

This document is implementation-oriented for LLM-assisted generation and refactoring.

## Scope
- Home
  - Feed view (masonry/media grid)
  - Reels view (vertical immersive video)
- Settings page
- Saved view (same structure and UX language as Home)
- Liked view (same structure and UX language as Home)

## Source Screens (Fetched from Stitch)
Project: `15187561419819791653`

### Home / Feed
- `Immersive Masonry Home Feed` (mobile): `projects/15187561419819791653/screens/3067b68270654187af93dd10dce63f26`
- `Immersive Masonry Home Feed` (desktop): `projects/15187561419819791653/screens/9867e678eb474fd996b603aa4999beb4`

### Home / Reels
- `Cinematic Desktop Reels Home` (desktop): `projects/15187561419819791653/screens/873c65c0e2ed4ede81305cd34ec449be`
- `Cinematic Desktop Reels Home` (mobile): `projects/15187561419819791653/screens/e3f214fa777a4273a4024a7a455d655e`

### Settings
- `Streamlined Settings Dashboard` (mobile): `projects/15187561419819791653/screens/3040b6fdb4984ed9a72cfa538ebcfb5b`
- `Streamlined Settings Dashboard` (desktop): `projects/15187561419819791653/screens/4bc182be9ec44687b5c0c7c297471a86`
- `Settings Dashboard with File Tree` (desktop): `projects/15187561419819791653/screens/59d49a503d2c47d49403b59b801847b8`
- `Mobile Settings with File Tree` (mobile): `projects/15187561419819791653/screens/00e3e47dbe4d4092ba537577b5087111`

## Design Direction: Ethos Narrative
"Ethos Narrative" means the interface feels like a story frame around media, not a dashboard fighting for attention.

### Core Principles
1. Media-first hierarchy: media occupies the visual center at all breakpoints.
2. Contextual chrome: controls appear only when useful (hover, tap, focus, pause).
3. Gentle contrast layers: overlays use gradients and blur to preserve readability while exposing media.
4. Narrative pacing: spacing, typography, and animation should guide attention from content to action.
5. Consistent interaction model across Home, Saved, and Liked.

## Tailwind Constraint (Strict)
- Use Tailwind utility classes only.
- Do not use CSS custom properties (`var(...)`).
- Avoid creating new theme tokens in CSS for this redesign pass.
- Prefer inline utility composition and existing component structure.

## Visual Language (No CSS vars)
- Backgrounds:
  - Page shell: `bg-neutral-950`
  - Elevated surfaces: `bg-neutral-900/80 backdrop-blur-md`
  - Soft separators: `border border-white/10`
- Typography:
  - Narrative headings: `font-serif tracking-tight`
  - UI labels/body: `font-sans`
  - Primary text: `text-neutral-100`
  - Secondary text: `text-neutral-300`
  - Muted text: `text-neutral-400`
- Accent:
  - Primary action: `bg-amber-400 text-neutral-950 hover:bg-amber-300`
  - Active chip/tab: `bg-white/15 text-white`
- Depth and shape:
  - Cards: `rounded-2xl overflow-hidden`
  - Control pods: `rounded-full bg-black/35 backdrop-blur-md border border-white/15`

## Breakpoint Rules
- Mobile-first baseline.
- Mobile (`< md`): bottom navigation, one-handed controls, max media area.
- Tablet (`md`): mixed card density, side controls optional.
- Desktop (`lg+`): split layout with persistent but low-weight navigation rail/header.

## Shared Layout Contract (Home, Saved, Liked)
Use a unified shell for all three screens.

### Top Layer (Do not block media)
- Height: `h-14 md:h-16`
- Container: `fixed top-0 inset-x-0 z-40`
- Backdrop: `bg-gradient-to-b from-black/70 to-transparent`
- Keep only:
  - page title
  - compact source selector
  - minimal status icons

### Bottom Layer (Mobile)
- Container: `fixed bottom-0 inset-x-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]`
- Pod: `mx-auto flex h-14 max-w-md items-center justify-between rounded-full bg-black/45 px-4 backdrop-blur-lg border border-white/15`
- Keep 4 to 5 actions max.

### Safe View Insets
- Main content wrapper:
  - `pt-14 md:pt-16`
  - `pb-24 md:pb-8`
- Reels media viewport must always remain fully visible behind overlays.

## Home: Feed View

### Mobile
- Layout: single-column staggered masonry.
- Grid wrapper: `columns-2 gap-2 px-2`
- Card spacing: `mb-2 break-inside-avoid`
- Media card:
  - container: `group relative rounded-2xl overflow-hidden bg-neutral-900`
  - image/video: `w-full h-auto object-cover`
  - hover/tap overlay: `absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity`
- Actions in overlay lower-right, compact circular controls.

### Desktop
- Layout: denser masonry with persistent filter row.
- Outer: `mx-auto max-w-[1600px] px-4 lg:px-8`
- Grid: `columns-3 xl:columns-4 2xl:columns-5 gap-4`
- Keep interaction affordances hidden until hover/focus.

## Home: Reels View

### Mobile
- Pager container: `h-[100dvh] snap-y snap-mandatory overflow-y-auto`
- Reel item: `relative h-[100dvh] snap-start`
- Video: `absolute inset-0 h-full w-full object-cover`
- Readability veil: `absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30`
- Right action rail:
  - `absolute right-3 bottom-24 z-20 flex flex-col gap-3`
  - Buttons: `h-11 w-11 rounded-full bg-black/40 backdrop-blur-md border border-white/20`
- Caption block:
  - `absolute left-3 right-16 bottom-6 z-20`
  - Keep to max 3 lines before expand.

### Desktop
- Centered cinematic stage with optional side context.
- Stage wrapper: `mx-auto grid h-[100dvh] max-w-[1800px] grid-cols-12 gap-4 px-4`
- Main reel: `col-span-12 lg:col-span-8 xl:col-span-9`
- Side rail: `hidden lg:flex lg:col-span-4 xl:col-span-3`
- Preserve unobstructed video area by docking metadata below or side, not across center.

## Saved and Liked Views
These should be structurally identical to Home Feed/Reels with only data source and empty states changed.

### Requirements
- Same shell, spacing, overlay strategy, and controls as Home.
- Tab switch between Feed/Reels remains in same location and style.
- Empty states are narrative but lightweight:
  - `min-h-[50vh] grid place-items-center text-center`
  - CTA returns user to Home discovery.

## Settings Page

### Mobile
- Sections stacked as cards.
- Container: `px-3 pb-24 pt-16 space-y-3`
- Card: `rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-white/10 p-4`
- Keep controls touch-friendly (`h-11+`).

### Desktop
- Two-panel narrative utility layout.
- Wrapper: `mx-auto grid max-w-[1440px] grid-cols-12 gap-6 px-6 py-6`
- Left nav panel: `col-span-12 lg:col-span-4 xl:col-span-3`
- Right content panel: `col-span-12 lg:col-span-8 xl:col-span-9`
- File tree panel can be sticky: `lg:sticky lg:top-20`

### Settings UX Priority
1. Library/indexing controls
2. Source management (including rclone flow)
3. Playback and feed preferences
4. Account/session actions

## Motion and Interaction
- Keep motion intentional and sparse.
- Enter transitions:
  - `animate-[fadeIn_.28s_ease-out]`
  - `animate-[slideUp_.32s_ease-out]`
- Card reveal stagger:
  - incremental `delay-[Nms]` utilities for first render batches only.
- Avoid continuous animation that distracts from media.

## Accessibility and Readability
- Text over media must pass contrast through overlay gradients.
- Touch targets at least `44x44` (`h-11 w-11` minimum).
- Focus ring visible: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300`
- Keyboard navigation must work for all controls on desktop.

## Component Mapping (Current Codebase)
Apply redesign primarily in these components:
- `frontend/components/MainLayout.tsx`
- `frontend/components/Feed.tsx`
- `frontend/components/MediaCard.tsx`
- `frontend/components/VideoPlayer.tsx`
- `frontend/components/NavigationBar.tsx`
- `frontend/components/Settings.tsx`
- `frontend/components/SavedView.tsx`
- `frontend/components/LikedView.tsx`

## LLM Implementation Checklist
1. Rebuild shared shell with top gradient chrome + mobile bottom action pod.
2. Refactor Feed cards for minimal default chrome and hover/tap overlays.
3. Rebuild Reels viewport with strict full-height media and side/bottom control rails.
4. Apply same Home structure to Saved and Liked views.
5. Restructure Settings into mobile stacked cards and desktop split panels.
6. Remove/avoid CSS variable usage and use Tailwind utility classes directly.
7. Validate on mobile and desktop breakpoints for unobstructed video/media viewing.

## Acceptance Criteria
- Desktop and mobile layouts implemented for Home (Feed + Reels), Settings, Saved, and Liked.
- Media remains the dominant visual element with non-intrusive controls.
- Saved and Liked mirror Home interaction pattern.
- Tailwind-only styling, no `var(...)` usage.
- UI reflects Ethos Narrative style with coherent typography, spacing, and cinematic overlays.
