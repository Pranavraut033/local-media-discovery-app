/**
 * Feed Component
 * Main Reels-style feed with infinite scroll and swipe navigation
 */
'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useInfiniteFeed, useLikeMutation, useSaveMutation, useMediaPreload } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { FeedItem } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { PlyrVideoModal } from './PlyrVideoModal';
import { Grid3x3, Layers, Heart, Bookmark, Maximize, Minimize } from 'lucide-react';
import { getViewMode, setViewMode, getLastViewedMedia, setLastViewedMedia } from '@/lib/storage';
import Masonry from 'react-masonry-css';
import { useFullscreen } from '@/lib/useFullscreen';
import {
  MEDIA_MASONRY_BREAKPOINTS,
  MEDIA_MASONRY_CLASS,
  MEDIA_MASONRY_COLUMN_CLASS,
} from '@/lib/layout';
import { useIndexingStore } from '@/lib/stores/indexing.store';
import { useUIStore } from '@/lib/stores/ui.store';

export type FeedMode = 'reels' | 'feed';

interface FeedProps {
  initialMode?: FeedMode;
  onViewSource?: (
    sourceId: string,
    displayName: string,
    avatarSeed: string,
    parentFolderPath?: string,
    parentFolderName?: string
  ) => void;
  onModeChange?: (mode: FeedMode) => void;
}

export function Feed({ initialMode, onViewSource, onModeChange }: FeedProps) {
  const [mode, setMode] = useState<FeedMode>(() => initialMode || getViewMode());
  const [allItems, setAllItems] = useState<FeedItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isResuming, setIsResuming] = useState(true);
  const [feedSeed] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const [expandedVideo, setExpandedVideo] = useState<{ src: string; title?: string } | null>(null);
  const feedSourceType = useUIStore((s) => s.preferences.feedSourceType);
  const jobs = useIndexingStore((s) => s.jobs);
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  const {
    data: feedPages,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteFeed(50, undefined, feedSeed, feedSourceType);
  const likeMutation = useLikeMutation();
  const saveMutation = useSaveMutation();

  const activeJob = Object.values(jobs).find((j) => j.status === 'queued' || j.status === 'processing');

  // When an indexing job completes and the feed is still empty, refetch automatically
  useEffect(() => {
    const completedJob = Object.values(jobs).find((j) => j.status === 'completed');
    if (completedJob && allItems.length === 0) {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const mergedFeedItems = useMemo(() => {
    if (!feedPages?.pages?.length) return [];

    const byId = new Map<string, FeedItem>();
    feedPages.pages.forEach((page) => {
      page.feed.forEach((item) => {
        byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
      });
    });

    return Array.from(byId.values());
  }, [feedPages]);

  const currentMedia = allItems[currentIndex];

  // Preload next media items for better performance
  const mediaIds = allItems.map(item => item.id);
  useMediaPreload(mediaIds, {
    prefetchDistance: 5,
    enableThumbnails: true,
    enableMetadata: true,
  });

  // Refs to track which mutations have been processed to avoid infinite loops
  const processedLikeMutationRef = useRef<string | null>(null);
  const processedSaveMutationRef = useRef<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const lastWheelNavigationAtRef = useRef(0);
  const initialPrefetchDoneRef = useRef(false);

  // Sync mutations back into allItems
  useEffect(() => {
    if (likeMutation.isSuccess && likeMutation.data?.mediaId) {
      // Only process if this mutation hasn't been processed yet
      if (processedLikeMutationRef.current !== likeMutation.data.mediaId) {
        processedLikeMutationRef.current = likeMutation.data.mediaId;
        setAllItems((prev) =>
          prev.map((item) =>
            item.id === likeMutation.data.mediaId
              ? { ...item, liked: likeMutation.data.liked ?? !item.liked }
              : item
          )
        );
      }
    }
  }, [likeMutation.isSuccess, likeMutation.data?.mediaId, likeMutation.data?.liked]);

  useEffect(() => {
    if (saveMutation.isSuccess && saveMutation.data?.mediaId) {
      // Only process if this mutation hasn't been processed yet
      if (processedSaveMutationRef.current !== saveMutation.data.mediaId) {
        processedSaveMutationRef.current = saveMutation.data.mediaId;
        setAllItems((prev) =>
          prev.map((item) =>
            item.id === saveMutation.data.mediaId
              ? { ...item, saved: saveMutation.data.saved ?? !item.saved }
              : item
          )
        );
      }
    }
  }, [saveMutation.isSuccess, saveMutation.data?.mediaId, saveMutation.data?.saved]);

  const reconciliationMap = useIndexingStore((s) => s.reconciliationMap);

  // Reconcile temp IDs → final IDs when hashing completes (Phase 9)
  useEffect(() => {
    if (Object.keys(reconciliationMap).length === 0) return;
    setAllItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        const finalId = reconciliationMap[item.id];
        if (finalId && finalId !== item.id) {
          changed = true;
          return { ...item, id: finalId, status: 'ready' };
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [reconciliationMap]);

  // Load more when reaching near the end and sync updates from cache
  useEffect(() => {
    if (mergedFeedItems.length > 0) {
      setAllItems((prev) => {
        const merged = [...prev];
        let hasNewItems = false;
        let hasUpdatedItems = false;

        mergedFeedItems.forEach((newItem) => {
          const existingIndex = merged.findIndex((p) => p.id === newItem.id);
          if (existingIndex !== -1) {
            const existing = merged[existingIndex];
            const next = { ...existing, ...newItem };
            const changed =
              existing.liked !== next.liked ||
              existing.saved !== next.saved ||
              existing.hidden !== next.hidden ||
              existing.path !== next.path ||
              existing.activePath !== next.activePath;

            if (changed) {
              merged[existingIndex] = next;
              hasUpdatedItems = true;
            }
          } else {
            // Add new item only if not already present
            merged.push(newItem);
            hasNewItems = true;
          }
        });

        // Only update if there were actual changes
        return hasNewItems || hasUpdatedItems ? merged : prev;
      });

    }
  }, [mergedFeedItems]);

  // Resume position from last session
  useEffect(() => {
    if (isResuming && allItems.length > 0) {
      const lastViewed = getLastViewedMedia();
      if (lastViewed) {
        const index = allItems.findIndex(item => item.id === lastViewed.mediaId);
        if (index !== -1) {
          setCurrentIndex(index);
        }
      }
      setIsResuming(false);
    }
  }, [allItems, isResuming]);

  // Let the layout react to feed/reels mode for global chrome visibility.
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  // Save current position when index changes
  useEffect(() => {
    if (!isResuming && allItems[currentIndex]) {
      setLastViewedMedia(allItems[currentIndex].id);
    }
  }, [currentIndex, allItems, isResuming]);

  // Load next page when we're near the end in reels mode.
  // Feed mode uses the intersection observer below.
  useEffect(() => {
    if (mode !== 'reels') return;

    if (currentIndex > allItems.length - 5 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [mode, currentIndex, allItems.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Set up intersection observer for infinite scroll in feed mode
  useEffect(() => {
    if (mode !== 'feed') return;

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      const lastEntry = entries[0];
      if (lastEntry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    };

    // Recreate observer so callback always uses fresh pagination state.
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: containerRef.current,
      rootMargin: '200px',
      threshold: 0.1,
    });

    const observer = observerRef.current;

    // Observe a dedicated sentinel placed after the masonry list.
    if (sentinelRef.current && allItems.length > 0) {
      observer.observe(sentinelRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [mode, hasNextPage, isFetchingNextPage, allItems.length, fetchNextPage]);

  // Warm up feed mode by prefetching one extra page once initial data has loaded.
  useEffect(() => {
    if (mode !== 'feed') return;
    if (initialPrefetchDoneRef.current) return;
    if (allItems.length === 0) return;
    if (!hasNextPage || isFetchingNextPage) return;

    initialPrefetchDoneRef.current = true;
    void fetchNextPage();
  }, [mode, allItems.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Handle touch/swipe gestures
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (mode !== 'reels') return;
    touchStartY.current = e.touches[0].clientY;
  }, [mode]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (mode !== 'reels') return;
    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchStartY.current - touchEndY;

    // Swipe up (next) if diff > 50px
    if (diff > 50) {
      setCurrentIndex((prev) => Math.min(prev + 1, allItems.length - 1));
    }
    // Swipe down (prev) if diff < -50px
    else if (diff < -50) {
      setCurrentIndex((prev) => Math.max(prev - 1, 0));
    }
  }, [mode, allItems.length]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, allItems.length - 1));
  }, [allItems.length]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (mode !== 'reels' || allItems.length <= 1) return;

    const threshold = 24;
    const deltaY = e.deltaY;
    if (Math.abs(deltaY) < threshold) return;

    const now = Date.now();
    // Throttle wheel/trackpad gestures to one reel step at a time.
    if (now - lastWheelNavigationAtRef.current < 260) return;
    lastWheelNavigationAtRef.current = now;

    e.preventDefault();

    if (deltaY > 0) {
      handleNext();
      return;
    }

    handlePrevious();
  }, [mode, allItems.length, handleNext, handlePrevious]);

  const handleLike = useCallback(async () => {
    if (currentMedia) {
      await likeMutation.mutateAsync({ mediaId: currentMedia.id, sourceId: currentMedia.sourceId });
    }
  }, [currentMedia, likeMutation]);

  const handleSave = useCallback(async () => {
    if (currentMedia) {
      await saveMutation.mutateAsync({ mediaId: currentMedia.id, sourceId: currentMedia.sourceId });
    }
  }, [currentMedia, saveMutation]);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const newMode = prev === 'reels' ? 'feed' : 'reels';
      setViewMode(newMode);
      return newMode;
    });
  }, []);

  if (isLoading && allItems.length === 0) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-neutral-950">
        <div className="text-center space-y-6">
          <div className="w-14 h-14 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto"></div>
          <div className="space-y-2">
            <h1 className="font-serif text-2xl tracking-tight text-neutral-100">Loading feed</h1>
            <p className="text-neutral-400">Gathering your media...</p>
          </div>
        </div>
      </div>
    );
  }


  if (allItems.length === 0) {
    if (activeJob) {
      const progressPct = activeJob.total ? Math.round(((activeJob.done ?? 0) / activeJob.total) * 100) : null;
      const label = activeJob.stage === 'discovery'
        ? `Discovering files${activeJob.filesFound ? ` — ${activeJob.filesFound} found` : ''}…`
        : activeJob.done !== undefined && activeJob.total
          ? `Hashing ${activeJob.done} / ${activeJob.total}`
          : 'Queued…';
      return (
        <div className="w-full h-screen flex items-center justify-center px-4 bg-neutral-950">
          <div className="text-center space-y-6 max-w-md w-full">
            <div className="w-14 h-14 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
            <div className="space-y-2">
              <h1 className="font-serif text-2xl tracking-tight text-neutral-100">Indexing your media</h1>
              <p className="text-neutral-400 text-sm">{label}</p>
            </div>
            {progressPct !== null && (
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
            <p className="text-neutral-600 text-xs">Media will appear here once indexing completes</p>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full h-screen flex items-center justify-center px-4 bg-neutral-950">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="font-serif text-3xl tracking-tight text-neutral-100">No media yet</h1>
          <p className="text-neutral-400">No media found. Please index your media first.</p>
        </div>
      </div>
    );
  }

  // Reels Mode (Cinematic, immersive vertical pager)
  if (mode === 'reels') {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-neutral-950">
        {/* Top Chrome - Gradient fade with controls */}
        <div className="fixed top-0 inset-x-0 z-40 h-16 bg-linear-to-b from-black/70 to-transparent flex items-start justify-between px-4 pt-2">
          <span className="text-neutral-100 text-xs font-medium pt-2">
            {currentIndex + 1} / {allItems.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={toggleMode}
              className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              aria-label="Switch to feed mode"
            >
              <Grid3x3 size={20} />
            </button>
            <button
              onClick={toggleFullscreen}
              className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>

        {/* Media Pager Container - Touch swipe enabled */}
        <div
          ref={containerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
          className="absolute inset-0 h-full w-full overflow-hidden"
        >
          {/* Single Media Item (Full Height) */}
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

        {/* Bottom Navigation - Context aware */}
        <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4">
          <div className="mx-auto max-w-xl flex h-14 items-center gap-2 rounded-full bg-black/45 px-3 backdrop-blur-lg border border-white/15">
            <button
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="text-white/60 hover:text-white disabled:opacity-30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded px-2 shrink-0"
              aria-label="Previous"
            >
              ← Prev
            </button>

            <button
              onClick={handleLike}
              disabled={likeMutation.isPending}
              className={`h-9 w-9 rounded-full backdrop-blur-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 flex items-center justify-center shrink-0 ${currentMedia?.liked
                ? 'bg-red-500/80 text-white border-red-400'
                : 'bg-black/35 text-white/80 border-white/20 hover:text-white'
                } disabled:opacity-50`}
              aria-label={currentMedia?.liked ? 'Unlike' : 'Like'}
            >
              <Heart
                size={18}
                className={currentMedia?.liked ? 'fill-current' : ''}
              />
            </button>

            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className={`h-9 w-9 rounded-full backdrop-blur-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 flex items-center justify-center shrink-0 ${currentMedia?.saved
                ? 'bg-amber-400/80 text-neutral-950 border-amber-300'
                : 'bg-black/35 text-white/80 border-white/20 hover:text-white'
                } disabled:opacity-50`}
              aria-label={currentMedia?.saved ? 'Unsave' : 'Save'}
            >
              <Bookmark
                size={18}
                className={currentMedia?.saved ? 'fill-current' : ''}
              />
            </button>

            <div className="flex-1 mx-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / allItems.length) * 100}%` }}
              />
            </div>

            <button
              onClick={handleNext}
              disabled={currentIndex === allItems.length - 1}
              className="text-white/60 hover:text-white disabled:opacity-30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded px-2 shrink-0"
              aria-label="Next"
            >
              Next →
            </button>
          </div>
        </div>

        {/* Loading indicator */}
        {isFetchingNextPage && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    );
  }

  // Feed Mode (Masonry grid with Ethos Narrative chrome)
  return (
    <div className="w-full h-screen flex flex-col bg-neutral-950 overflow-hidden">
      {/* Top Chrome - Gradient chrome with title and controls */}
      <div className="fixed top-0 inset-x-0 z-40 h-14 md:h-16 bg-linear-to-b from-black/70 to-transparent flex items-start justify-between px-4 md:px-8 pt-3">
        <h1 className="font-serif text-xl md:text-2xl tracking-tight text-neutral-100">Feed</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMode}
            className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            aria-label="Switch to reels mode"
          >
            <Layers size={20} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
      </div>

      {/* Masonry Grid Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto pt-14 md:pt-16 pb-24 md:pb-8 px-2 md:px-4"
      >
        <div className="mx-auto max-w-400 flex flex-col">
          <Masonry
            breakpointCols={MEDIA_MASONRY_BREAKPOINTS}
            className={MEDIA_MASONRY_CLASS}
            columnClassName={MEDIA_MASONRY_COLUMN_CLASS}
          >
            {allItems.map((item) => (
              <div
                key={item.id}
                className="mb-2 md:mb-4 break-inside-avoid"
              >
                <MediaCard
                  media={item}
                  onVisible={() => { }}
                  onViewSource={onViewSource}
                  onVideoExpand={(src, title) => setExpandedVideo({ src, title })}
                  mode="feed"
                  enableHoverAutoplay={true}
                  className="w-full rounded-2xl overflow-hidden"
                />
              </div>
            ))}
          </Masonry>

          <div ref={sentinelRef} className="h-8 w-full" aria-hidden="true" />

          {isFetchingNextPage && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            </div>
          )}
        </div>
      </div>

      <PlyrVideoModal
        isOpen={expandedVideo !== null}
        src={expandedVideo?.src ?? ''}
        title={expandedVideo?.title}
        onClose={() => setExpandedVideo(null)}
      />
    </div>
  );
}
