/**
 * DiscoverView Component
 * Shows a random batch of unseen, non-liked, non-saved media.
 * Supports reels and grid modes matching the main Feed.
 */
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  useDiscoverFeed,
  useDiscoverSession,
  useAppendDiscoverSession,
  useResetDiscoverSession,
  useLikeMutation,
  useSaveMutation,
  useMediaPreload,
} from '@/lib/hooks';
import type { FeedItem } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { PlyrVideoModal } from './PlyrVideoModal';
import {
  Grid3x3,
  Layers,
  Shuffle,
  RotateCcw,
  Heart,
  Bookmark,
  Maximize,
  Minimize,
} from 'lucide-react';
import Masonry from 'react-masonry-css';
import { useFullscreen } from '@/lib/useFullscreen';
import {
  MEDIA_MASONRY_BREAKPOINTS,
  MEDIA_MASONRY_CLASS,
  MEDIA_MASONRY_COLUMN_CLASS,
} from '@/lib/layout';
import type { FeedMode } from '@/components/Feed';

interface DiscoverViewProps {
  onViewSource?: (
    sourceId: string,
    displayName: string,
    avatarSeed: string,
    parentFolderPath?: string,
    parentFolderName?: string
  ) => void;
}

export function DiscoverView({ onViewSource }: DiscoverViewProps) {
  const [mode, setMode] = useState<FeedMode>('feed');
  const [batchSize, setBatchSize] = useState<50 | 100>(50);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [currentBatchIds, setCurrentBatchIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expandedVideo, setExpandedVideo] = useState<{ src: string; title?: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isAtEnd, setIsAtEnd] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef(0);
  const lastWheelAtRef = useRef(0);
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  const { data: feedData, isLoading, refetch: refetchFeed } = useDiscoverFeed(batchSize);
  const { data: sessionData, refetch: refetchSession } = useDiscoverSession();
  const appendSession = useAppendDiscoverSession();
  const resetSession = useResetDiscoverSession();
  const likeMutation = useLikeMutation();
  const saveMutation = useSaveMutation();

  // Sync like/save results back into local items state
  const processedLikeRef = useRef<string | null>(null);
  const processedSaveRef = useRef<string | null>(null);

  useEffect(() => {
    if (likeMutation.isSuccess && likeMutation.data?.mediaId) {
      if (processedLikeRef.current !== likeMutation.data.mediaId) {
        processedLikeRef.current = likeMutation.data.mediaId;
        setItems((prev) =>
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
      if (processedSaveRef.current !== saveMutation.data.mediaId) {
        processedSaveRef.current = saveMutation.data.mediaId;
        setItems((prev) =>
          prev.map((item) =>
            item.id === saveMutation.data.mediaId
              ? { ...item, saved: saveMutation.data.saved ?? !item.saved }
              : item
          )
        );
      }
    }
  }, [saveMutation.isSuccess, saveMutation.data?.mediaId, saveMutation.data?.saved]);

  // Load items when feed data arrives
  useEffect(() => {
    if (feedData?.feed) {
      setItems(feedData.feed);
      setCurrentBatchIds(feedData.feed.map((i) => i.id));
      setCurrentIndex(0);
      setIsAtEnd(false);
    }
  }, [feedData]);

  // Preload next items
  const mediaIds = items.map((i) => i.id);
  useMediaPreload(mediaIds, { prefetchDistance: 5, enableThumbnails: true, enableMetadata: true });

  // Intersection observer for end-of-list in feed mode
  useEffect(() => {
    if (mode !== 'feed') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && items.length > 0) setIsAtEnd(true);
      },
      { rootMargin: '200px', threshold: 0.1 }
    );
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [mode, items.length]);

  // Detect end of reels
  useEffect(() => {
    if (mode === 'reels' && items.length > 0 && currentIndex >= items.length - 1) {
      setIsAtEnd(true);
    }
  }, [mode, currentIndex, items.length]);

  const handleReshuffle = useCallback(async () => {
    // Save seen IDs before fetching new batch
    if (currentBatchIds.length > 0) {
      await appendSession.mutateAsync(currentBatchIds);
    }
    await refetchFeed();
    await refetchSession();
    setIsAtEnd(false);
  }, [currentBatchIds, appendSession, refetchFeed, refetchSession]);

  const handleResetSession = useCallback(async () => {
    await resetSession.mutateAsync();
    setShowResetConfirm(false);
    await refetchFeed();
    await refetchSession();
    setIsAtEnd(false);
  }, [resetSession, refetchFeed, refetchSession]);

  const handleBatchSizeChange = useCallback(
    (size: 50 | 100) => {
      if (size !== batchSize) {
        setBatchSize(size);
      }
    },
    [batchSize]
  );

  // Touch and wheel handlers for reels mode
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (mode !== 'reels') return;
      touchStartY.current = e.touches[0].clientY;
    },
    [mode]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (mode !== 'reels') return;
      const diff = touchStartY.current - e.changedTouches[0].clientY;
      if (diff > 50) setCurrentIndex((p) => Math.min(p + 1, items.length - 1));
      else if (diff < -50) setCurrentIndex((p) => Math.max(p - 1, 0));
    },
    [mode, items.length]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (mode !== 'reels' || items.length <= 1) return;
      if (Math.abs(e.deltaY) < 24) return;
      const now = Date.now();
      if (now - lastWheelAtRef.current < 260) return;
      lastWheelAtRef.current = now;
      e.preventDefault();
      if (e.deltaY > 0) setCurrentIndex((p) => Math.min(p + 1, items.length - 1));
      else setCurrentIndex((p) => Math.max(p - 1, 0));
    },
    [mode, items.length]
  );

  const currentMedia = items[currentIndex];

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

  const seenCount = sessionData?.seenCount ?? 0;
  const isBusy =
    isLoading || appendSession.isPending || resetSession.isPending;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading && items.length === 0) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-neutral-950">
        <div className="text-center space-y-6">
          <div className="w-14 h-14 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
          <div className="space-y-2">
            <h1 className="font-serif text-2xl tracking-tight text-neutral-100">
              Discovering media
            </h1>
            <p className="text-neutral-400">Finding something new for you…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!isLoading && items.length === 0) {
    return (
      <div className="w-full h-screen flex items-center justify-center px-4 bg-neutral-950">
        <div className="text-center space-y-4 max-w-md">
          <Shuffle size={40} className="text-neutral-500 mx-auto" />
          <h1 className="font-serif text-2xl tracking-tight text-neutral-100">
            Nothing left to discover
          </h1>
          <p className="text-neutral-400 text-sm">
            {seenCount > 0
              ? `You've seen all available media (${seenCount} items). Reset the session to start fresh.`
              : 'All media has been liked or saved, or nothing is indexed yet.'}
          </p>
          {seenCount > 0 && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="mt-2 px-5 py-2.5 rounded-full bg-white/10 text-white text-sm hover:bg-white/20 transition-all border border-white/15"
            >
              Reset session
            </button>
          )}
        </div>

        {/* Reset confirm dialog */}
        {showResetConfirm && (
          <ResetConfirmDialog
            seenCount={seenCount}
            onConfirm={handleResetSession}
            onCancel={() => setShowResetConfirm(false)}
            busy={resetSession.isPending}
          />
        )}
      </div>
    );
  }

  // ── Shared header controls ────────────────────────────────────────────────
  const headerControls = (
    <div className="fixed top-0 inset-x-0 z-40 h-14 md:h-16 bg-linear-to-b from-black/70 to-transparent flex items-start justify-between px-4 md:px-8 pt-3">
      <div className="flex items-center gap-2 pt-0.5">
        <h1 className="font-serif text-xl md:text-2xl tracking-tight text-neutral-100">
          Discover
        </h1>
        {seenCount > 0 && (
          <span className="text-neutral-500 text-xs">{seenCount} seen</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {/* Batch size toggle */}
        <div className="flex rounded-lg overflow-hidden border border-white/15 bg-black/40 backdrop-blur-md">
          {([50, 100] as const).map((n) => (
            <button
              key={n}
              onClick={() => handleBatchSizeChange(n)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${batchSize === n
                  ? 'bg-white/20 text-white'
                  : 'text-white/60 hover:text-white'
                }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Reset session */}
        <button
          onClick={() => setShowResetConfirm(true)}
          className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          aria-label="Reset session"
          title="Reset discover session"
        >
          <RotateCcw size={18} />
        </button>

        {/* Mode toggle */}
        <button
          onClick={() => setMode((m) => (m === 'reels' ? 'feed' : 'reels'))}
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
      </div>
    </div>
  );

  // ── Reshuffle CTA (end-of-batch) ──────────────────────────────────────────
  const reshuffleCta = isAtEnd ? (
    <div className="flex flex-col items-center gap-3 py-10 px-4">
      <p className="text-neutral-400 text-sm">
        Batch complete — {items.length} items shown
        {seenCount > 0 && `, ${seenCount} seen in total`}
      </p>
      <button
        onClick={handleReshuffle}
        disabled={isBusy}
        className="flex items-center gap-2 px-6 py-3 rounded-full bg-amber-400 text-neutral-950 font-semibold text-sm hover:bg-amber-300 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <Shuffle size={16} />
        {isBusy ? 'Loading…' : 'Reshuffle'}
      </button>
    </div>
  ) : null;

  // ── Reels mode ────────────────────────────────────────────────────────────
  if (mode === 'reels') {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-neutral-950">
        {headerControls}

        <div
          ref={containerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
          className="absolute inset-0 h-full w-full overflow-hidden"
        >
          <div className="relative h-full w-full flex items-center justify-center">
            {isAtEnd ? (
              <div className="flex flex-col items-center gap-4 px-6 text-center">
                <p className="text-neutral-400 text-sm">
                  {items.length} items shown
                  {seenCount > 0 && `, ${seenCount} seen in total`}
                </p>
                <button
                  onClick={handleReshuffle}
                  disabled={isBusy}
                  className="flex items-center gap-2 px-6 py-3 rounded-full bg-amber-400 text-neutral-950 font-semibold text-sm hover:bg-amber-300 transition-all disabled:opacity-50"
                >
                  <Shuffle size={16} />
                  {isBusy ? 'Loading…' : 'Reshuffle'}
                </button>
              </div>
            ) : (
              <MediaCard
                media={currentMedia}
                onVisible={() => { }}
                onViewSource={onViewSource}
                mode="reels"
                className="w-full h-full"
              />
            )}
          </div>
        </div>

        {/* Bottom bar */}
        {!isAtEnd && (
          <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4">
            <div className="mx-auto max-w-xl flex h-14 items-center gap-2 rounded-full bg-black/45 px-3 backdrop-blur-lg border border-white/15">
              <button
                onClick={() => setCurrentIndex((p) => Math.max(p - 1, 0))}
                disabled={currentIndex === 0}
                className="text-white/60 hover:text-white disabled:opacity-30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded px-2 shrink-0"
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
              >
                <Heart size={18} className={currentMedia?.liked ? 'fill-current' : ''} />
              </button>

              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className={`h-9 w-9 rounded-full backdrop-blur-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 flex items-center justify-center shrink-0 ${currentMedia?.saved
                    ? 'bg-amber-400/80 text-neutral-950 border-amber-300'
                    : 'bg-black/35 text-white/80 border-white/20 hover:text-white'
                  } disabled:opacity-50`}
              >
                <Bookmark size={18} className={currentMedia?.saved ? 'fill-current' : ''} />
              </button>

              <div className="flex-1 mx-1 h-0.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all duration-300"
                  style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}
                />
              </div>

              <span className="text-neutral-400 text-xs shrink-0">
                {currentIndex + 1}/{items.length}
              </span>

              <button
                onClick={() => setCurrentIndex((p) => Math.min(p + 1, items.length - 1))}
                disabled={currentIndex >= items.length - 1}
                className="text-white/60 hover:text-white disabled:opacity-30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded px-2 shrink-0"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Reset confirm */}
        {showResetConfirm && (
          <ResetConfirmDialog
            seenCount={seenCount}
            onConfirm={handleResetSession}
            onCancel={() => setShowResetConfirm(false)}
            busy={resetSession.isPending}
          />
        )}
      </div>
    );
  }

  // ── Grid / feed mode ──────────────────────────────────────────────────────
  return (
    <div className="w-full h-screen flex flex-col bg-neutral-950 overflow-hidden">
      {headerControls}

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
            {items.map((item) => (
              <div key={item.id} className="mb-2 md:mb-4 break-inside-avoid">
                <MediaCard
                  media={item}
                  onVisible={() => { }}
                  onViewSource={onViewSource}
                  onVideoExpand={(src, title) => setExpandedVideo({ src, title })}
                  mode="feed"
                  enableHoverAutoplay
                  className="w-full rounded-2xl overflow-hidden"
                />
              </div>
            ))}
          </Masonry>

          <div ref={sentinelRef} className="h-8 w-full" aria-hidden="true" />

          {reshuffleCta}
        </div>
      </div>

      <PlyrVideoModal
        isOpen={expandedVideo !== null}
        src={expandedVideo?.src ?? ''}
        title={expandedVideo?.title}
        onClose={() => setExpandedVideo(null)}
      />

      {showResetConfirm && (
        <ResetConfirmDialog
          seenCount={seenCount}
          onConfirm={handleResetSession}
          onCancel={() => setShowResetConfirm(false)}
          busy={resetSession.isPending}
        />
      )}
    </div>
  );
}

// ── Reset confirm dialog ───────────────────────────────────────────────────
interface ResetConfirmDialogProps {
  seenCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

function ResetConfirmDialog({ seenCount, onConfirm, onCancel, busy }: ResetConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-neutral-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
        <h2 className="font-serif text-xl text-neutral-100">Reset discover session?</h2>
        <p className="text-neutral-400 text-sm">
          This will clear {seenCount} seen IDs so those media can appear again.
          Liked and saved items will still be excluded.
        </p>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-full border border-white/15 text-neutral-300 text-sm hover:bg-white/5 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2.5 rounded-full bg-white text-neutral-950 font-semibold text-sm hover:bg-neutral-200 transition-all disabled:opacity-50"
          >
            {busy ? 'Resetting…' : 'Reset'}
          </button>
        </div>
      </div>
    </div>
  );
}
