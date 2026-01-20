/**
 * Feed Component
 * Main Reels-style feed with infinite scroll and swipe navigation
 */
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useFeed, useLikeMutation, useSaveMutation, useMediaPreload } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { Grid3x3, Layers, Heart, Bookmark } from 'lucide-react';
import { getViewMode, setViewMode, getLastViewedMedia, setLastViewedMedia } from '@/lib/storage';
import Masonry from 'react-masonry-css';

export type FeedMode = 'reels' | 'feed';

interface FeedProps {
  initialMode?: FeedMode;
  onViewSource?: (sourceId: string, displayName: string, avatarSeed: string) => void;
}

export function Feed({ initialMode, onViewSource }: FeedProps) {
  const [mode, setMode] = useState<FeedMode>(() => initialMode || getViewMode());
  const [page, setPage] = useState(0);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isResuming, setIsResuming] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const [lastSourceId, setLastSourceId] = useState<string>();

  const { data: feedData, isLoading, isFetching } = useFeed(page, 20, lastSourceId);
  const likeMutation = useLikeMutation();
  const saveMutation = useSaveMutation();

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
  const lastItemRef = useRef<HTMLDivElement | null>(null);

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

  // Load more when reaching near the end and sync updates from cache
  useEffect(() => {
    if (feedData?.feed && feedData.feed.length > 0) {
      setAllItems((prev) => {
        const merged = [...prev];
        let hasNewItems = false;

        feedData.feed.forEach((newItem) => {
          const existingIndex = merged.findIndex((p) => p.id === newItem.id);
          if (existingIndex !== -1) {
            // Update existing item (preserves all properties including liked/saved)
            merged[existingIndex] = newItem;
          } else {
            // Add new item only if not already present
            merged.push(newItem);
            hasNewItems = true;
          }
        });

        // Only update if there were actual changes
        return hasNewItems ? merged : prev;
      });

      // Update last source ID for diversity
      if (feedData.feed.length > 0) {
        setLastSourceId(feedData.feed[feedData.feed.length - 1].sourceId);
      }
    }
  }, [feedData]);

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

  // Save current position when index changes
  useEffect(() => {
    if (!isResuming && allItems[currentIndex]) {
      setLastViewedMedia(allItems[currentIndex].id);
    }
  }, [currentIndex, allItems, isResuming]);

  // Load next page when we're near the end
  useEffect(() => {
    if (currentIndex > allItems.length - 5 && feedData?.hasMore && !isFetching) {
      setPage((p) => p + 1);
    }
  }, [currentIndex, allItems.length, feedData?.hasMore, isFetching]);

  // Set up intersection observer for infinite scroll in feed mode
  useEffect(() => {
    if (mode !== 'feed') return;

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      const lastEntry = entries[0];
      if (lastEntry.isIntersecting && feedData?.hasMore && !isFetching) {
        setPage((p) => p + 1);
      }
    };

    // Create observer if it doesn't exist
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(handleIntersection, {
        root: containerRef.current,
        rootMargin: '200px',
        threshold: 0.1,
      });
    }

    // Observe the last item if it exists
    if (lastItemRef.current && allItems.length > 0) {
      observerRef.current.observe(lastItemRef.current);
    }

    return () => {
      if (lastItemRef.current && observerRef.current) {
        observerRef.current.unobserve(lastItemRef.current);
      }
    };
  }, [mode, feedData?.hasMore, isFetching, allItems.length]);

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
      <div className="w-full h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading feed...</p>
        </div>
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">No media found. Please index your media first.</p>
        </div>
      </div>
    );
  }

  // Reels Mode (Full-screen vertical swipe)
  if (mode === 'reels') {
    return (
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="w-full h-screen bg-black overflow-hidden relative"
      >
        {/* Current Media */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: '140px', paddingTop: '60px' }}>
          <MediaCard
            media={currentMedia}
            onVisible={() => { }}
            onViewSource={onViewSource}
            mode="reels"
            className="w-full h-full"
          />
        </div>

        {/* Interaction Buttons - Right Side */}
        <div className="absolute right-4 bottom-32 flex flex-col gap-4 pointer-events-auto z-20">
          <button
            onClick={handleLike}
            disabled={likeMutation.isPending}
            className={`flex flex-col items-center gap-1 p-3 rounded-full transition-all ${currentMedia?.liked
              ? 'bg-red-500 text-white shadow-lg'
              : 'bg-white/90 text-black hover:bg-white'
              } disabled:opacity-50`}
            aria-label={currentMedia?.liked ? 'Unlike' : 'Like'}
          >
            <Heart
              size={28}
              className={currentMedia?.liked ? 'fill-current' : ''}
            />
            <span className="text-xs font-semibold">
              {currentMedia?.liked ? 'Liked' : 'Like'}
            </span>
          </button>

          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className={`flex flex-col items-center gap-1 p-3 rounded-full transition-all ${currentMedia?.saved
              ? 'bg-blue-500 text-white shadow-lg'
              : 'bg-white/90 text-black hover:bg-white'
              } disabled:opacity-50`}
            aria-label={currentMedia?.saved ? 'Unsave' : 'Save'}
          >
            <Bookmark
              size={28}
              className={currentMedia?.saved ? 'fill-current' : ''}
            />
            <span className="text-xs font-semibold">
              {currentMedia?.saved ? 'Saved' : 'Save'}
            </span>
          </button>
        </div>

        {/* Navigation Buttons */}
        <div className="absolute inset-x-0 bottom-20 flex justify-center gap-4 px-4 pointer-events-none z-10">
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="pointer-events-auto bg-white hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-black dark:text-white px-6 py-2 rounded-full font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>
          <button
            onClick={handleNext}
            disabled={currentIndex === allItems.length - 1}
            className="pointer-events-auto bg-white hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-black dark:text-white px-6 py-2 rounded-full font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="absolute top-4 left-4 right-4 flex items-center gap-2 pointer-events-none">
          <span className="text-white text-sm font-medium">
            {currentIndex + 1} / {allItems.length}
          </span>
          <div className="flex-1 bg-gray-700 rounded-full h-1 overflow-hidden">
            <div
              className="bg-white h-full transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / allItems.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Mode Toggle */}
        <button
          onClick={toggleMode}
          className="absolute top-4 right-4 bg-white hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-black dark:text-white p-2 rounded-lg transition-colors pointer-events-auto z-20"
          aria-label="Switch to feed mode"
        >
          <Grid3x3 size={24} />
        </button>

        {/* Loading indicator */}
        {isFetching && (
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-center pointer-events-none">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    );
  }

  // Masonry breakpoint configuration
  const breakpointColumns = {
    default: 4,
    1536: 4,
    1280: 3,
    1024: 3,
    768: 2,
    640: 2,
    480: 1,
  };

  // Feed Mode (Masonry grid)
  return (
    <div className="w-full h-screen flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Feed</h1>
        <button
          onClick={toggleMode}
          className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white p-2 rounded-lg transition-colors"
          aria-label="Switch to reels mode"
        >
          <Layers size={24} />
        </button>
      </div>

      {/* Masonry Grid Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 pb-20"
      >
        <Masonry
          breakpointCols={breakpointColumns}
          className="flex -ml-4 w-auto"
          columnClassName="pl-4 bg-clip-padding"
        >
          {allItems.map((item, index) => (
            <div
              key={item.id}
              ref={index === allItems.length - 1 ? lastItemRef : null}
              className="mb-4 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              <MediaCard
                media={item}
                onVisible={() => { }}
                onViewSource={onViewSource}
                mode="feed"
                className="w-full"
              />
            </div>
          ))}
        </Masonry>

        {isFetching && (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    </div>
  );
}
