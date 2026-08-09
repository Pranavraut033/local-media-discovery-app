/**
 * MediaGalleryView
 * Shared reels/grid gallery chrome for static (non-paginated) media collections
 * (Liked, Saved, ...). Mirrors Feed.tsx's UX: mode toggle, fullscreen, keyboard
 * shortcuts, reels pager with like/save, masonry grid.
 */
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLikeMutation, useSaveMutation } from '@/lib/hooks';
import type { FeedItem } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { KeyboardShortcutsGuide } from './KeyboardShortcutsGuide';
import { ShutdownButton } from './ShutdownButton';
import { ArrowLeft, Grid3x3, Layers, Heart, Bookmark, Maximize, Minimize, Keyboard } from 'lucide-react';
import Masonry from 'react-masonry-css';
import { useFullscreen } from '@/lib/useFullscreen';
import {
  MEDIA_MASONRY_BREAKPOINTS,
  MEDIA_MASONRY_CLASS,
  MEDIA_MASONRY_COLUMN_CLASS,
  SAFE_TOP_INSET_CLASS,
} from '@/lib/layout';
import type { FeedMode } from './Feed';

interface MediaGalleryViewProps {
  items: FeedItem[];
  title: string;
  icon: React.ReactNode;
  onBack?: () => void;
  onViewSource?: (
    sourceId: string,
    displayName: string,
    avatarSeed: string,
    parentFolderPath?: string,
    parentFolderName?: string
  ) => void;
  emptyState: React.ReactNode;
  headerExtra?: React.ReactNode;
}

export function MediaGalleryView({ items, title, icon, onBack, onViewSource, emptyState, headerExtra }: MediaGalleryViewProps) {
  const [mode, setMode] = useState<FeedMode>('feed');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const lastWheelAtRef = useRef(0);
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const likeMutation = useLikeMutation();
  const saveMutation = useSaveMutation();

  // Clamp so the index stays valid as the underlying collection shrinks (e.g. unliking in reels mode).
  const clampedIndex = Math.min(currentIndex, Math.max(items.length - 1, 0));
  const currentMedia = items[clampedIndex];

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (mode !== 'reels') return;
    touchStartY.current = e.touches[0].clientY;
  }, [mode]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (mode !== 'reels') return;
    const diff = touchStartY.current - e.changedTouches[0].clientY;
    if (diff > 50) setCurrentIndex((p) => Math.min(p + 1, items.length - 1));
    else if (diff < -50) setCurrentIndex((p) => Math.max(p - 1, 0));
  }, [mode, items.length]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (mode !== 'reels' || items.length <= 1) return;
    if (Math.abs(e.deltaY) < 24) return;
    const now = Date.now();
    if (now - lastWheelAtRef.current < 260) return;
    lastWheelAtRef.current = now;
    e.preventDefault();
    if (e.deltaY > 0) setCurrentIndex((p) => Math.min(p + 1, items.length - 1));
    else setCurrentIndex((p) => Math.max(p - 1, 0));
  }, [mode, items.length]);

  const handlePrevious = useCallback(() => setCurrentIndex((p) => Math.max(p - 1, 0)), []);
  const handleNext = useCallback(() => setCurrentIndex((p) => Math.min(p + 1, items.length - 1)), [items.length]);

  const handleOpenInReels = useCallback((index: number) => {
    setCurrentIndex(index);
    setMode('reels');
  }, []);

  const toggleMode = useCallback(() => setMode((m) => (m === 'reels' ? 'feed' : 'reels')), []);

  const handleLike = useCallback(async () => {
    if (currentMedia) await likeMutation.mutateAsync({ mediaId: currentMedia.id, sourceId: currentMedia.sourceId });
  }, [currentMedia, likeMutation]);

  const handleSave = useCallback(async () => {
    if (currentMedia) await saveMutation.mutateAsync({ mediaId: currentMedia.id, sourceId: currentMedia.sourceId });
  }, [currentMedia, saveMutation]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }
      if (e.key === 'Escape' && showShortcuts) {
        e.preventDefault();
        setShowShortcuts(false);
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        toggleMode();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if (mode !== 'reels') return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevious();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleLike();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, showShortcuts, handlePrevious, handleNext, handleLike, handleSave, toggleMode, toggleFullscreen]);

  const headerControls = (
    <div className={`fixed inset-x-0 z-40 h-14 md:h-16 bg-linear-to-b from-black/70 to-transparent flex items-start justify-between px-4 md:px-8 pt-3 pointer-events-none ${SAFE_TOP_INSET_CLASS}`}>
      <div className="pointer-events-auto flex items-center gap-3 pt-0.5 min-w-0">
        {onBack && (
          <button
            onClick={onBack}
            className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 shrink-0"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className="font-serif text-xl md:text-2xl tracking-tight text-neutral-100 flex items-center gap-2 truncate">
          {icon}
          {title}
        </h1>
        {items.length > 0 && (
          <span className="hidden sm:inline text-neutral-500 text-xs shrink-0">({items.length})</span>
        )}
      </div>
      <div className="pointer-events-auto flex items-center gap-1 sm:gap-1.5 shrink-0">
        {headerExtra}
        <button
          onClick={toggleMode}
          className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          aria-label={mode === 'reels' ? 'Switch to grid' : 'Switch to reels'}
        >
          {mode === 'reels' ? <Grid3x3 size={20} /> : <Layers size={20} />}
        </button>
        <button
          onClick={toggleFullscreen}
          className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
        <button
          onClick={() => setShowShortcuts(true)}
          className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          aria-label="Show keyboard shortcuts"
        >
          <Keyboard size={20} />
        </button>
        <ShutdownButton />
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="w-full h-dvh flex flex-col bg-neutral-950 overflow-hidden">
        {headerControls}
        <div className="flex-1 flex items-center justify-center px-4">{emptyState}</div>
      </div>
    );
  }

  if (mode === 'reels') {
    return (
      <div className="relative h-dvh w-full overflow-hidden bg-neutral-950">
        {headerControls}

        <div
          ref={containerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
          className="absolute inset-0 h-full w-full overflow-hidden overscroll-contain touch-none"
        >
          <div className="relative h-full w-full flex items-center justify-center">
            <MediaCard
              media={currentMedia}
              onVisible={() => { }}
              onViewSource={onViewSource}
              mode="reels"
              className="w-full h-full"
            />
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 pointer-events-none">
          <div className="pointer-events-auto mx-auto max-w-xl flex h-14 items-center gap-2 rounded-full bg-black/45 px-3 backdrop-blur-lg border border-white/15">
            <button
              onClick={handlePrevious}
              disabled={clampedIndex === 0}
              className="text-white/60 hover:text-white disabled:opacity-30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded px-3 py-2 shrink-0"
              aria-label="Previous"
            >
              ← Prev
            </button>

            <button
              onClick={handleLike}
              disabled={likeMutation.isPending}
              className={`h-11 w-11 rounded-full backdrop-blur-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 flex items-center justify-center shrink-0 ${currentMedia?.liked
                ? 'bg-red-500/80 text-white border-red-400'
                : 'bg-black/35 text-white/80 border-white/20 hover:text-white'
                } disabled:opacity-50`}
              aria-label={currentMedia?.liked ? 'Unlike' : 'Like'}
            >
              <Heart size={18} className={currentMedia?.liked ? 'fill-current' : ''} />
            </button>

            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className={`h-11 w-11 rounded-full backdrop-blur-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 flex items-center justify-center shrink-0 ${currentMedia?.saved
                ? 'bg-amber-400/80 text-neutral-950 border-amber-300'
                : 'bg-black/35 text-white/80 border-white/20 hover:text-white'
                } disabled:opacity-50`}
              aria-label={currentMedia?.saved ? 'Unsave' : 'Save'}
            >
              <Bookmark size={18} className={currentMedia?.saved ? 'fill-current' : ''} />
            </button>

            <div className="flex-1 mx-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-300"
                style={{ width: `${((clampedIndex + 1) / items.length) * 100}%` }}
              />
            </div>

            <button
              onClick={handleNext}
              disabled={clampedIndex === items.length - 1}
              className="text-white/60 hover:text-white disabled:opacity-30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded px-3 py-2 shrink-0"
              aria-label="Next"
            >
              Next →
            </button>
          </div>
        </div>

        <KeyboardShortcutsGuide isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      </div>
    );
  }

  return (
    <div className="w-full h-dvh flex flex-col bg-neutral-950 overflow-hidden">
      {headerControls}

      <div className="flex-1 overflow-y-auto pt-14 md:pt-16 pb-24 md:pb-8 px-2 md:px-4">
        <div className="mx-auto max-w-400 flex flex-col">
          <Masonry
            breakpointCols={MEDIA_MASONRY_BREAKPOINTS}
            className={MEDIA_MASONRY_CLASS}
            columnClassName={MEDIA_MASONRY_COLUMN_CLASS}
          >
            {items.map((item, index) => (
              <div key={item.id} className="mb-2 md:mb-4 break-inside-avoid">
                <MediaCard
                  media={item}
                  index={index}
                  onVisible={() => { }}
                  onViewSource={onViewSource}
                  onOpenInReels={handleOpenInReels}
                  mode="feed"
                  enableHoverAutoplay
                  className="w-full rounded-2xl overflow-hidden"
                />
              </div>
            ))}
          </Masonry>
        </div>
      </div>

      <KeyboardShortcutsGuide isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}
