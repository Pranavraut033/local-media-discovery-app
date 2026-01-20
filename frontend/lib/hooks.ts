/**
 * Custom React Query hooks for feed and media interactions
 * Includes performance optimization hooks for lazy loading and preloading
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef, useCallback } from 'react';
import { getApiBase, authenticatedFetch } from '@/lib/api';

const API_BASE = getApiBase();

// ============================================================================
// Types
// ============================================================================

export interface FeedItem {
  id: string;
  path: string;
  type: string;
  sourceId: string;
  displayName: string;
  avatarSeed: string;
  liked: boolean;
  saved: boolean;
  depth: number;
}

interface FeedResponse {
  success: boolean;
  feed: FeedItem[];
  page: number;
  hasMore: boolean;
  limit: number;
}

interface MediaResponse {
  success: boolean;
  media: FeedItem & {
    viewCount: number;
    lastViewed: number | null;
  };
}

interface InteractionResponse {
  success: boolean;
  mediaId: string;
  liked?: boolean;
  saved?: boolean;
  viewRecorded?: boolean;
}

interface SavedResponse {
  success: boolean;
  savedMedia: Array<FeedItem & {
    viewCount: number;
    lastViewed: number | null;
  }>;
}

interface LikedResponse {
  success: boolean;
  likedMedia: Array<FeedItem & {
    viewCount: number;
    lastViewed: number | null;
  }>;
}

interface HiddenResponse {
  success: boolean;
  hiddenMedia: Array<FeedItem & {
    viewCount: number;
    lastViewed: number | null;
  }>;
}

interface PreloadConfig {
  prefetchDistance?: number;
  enableThumbnails?: boolean;
  enableMetadata?: boolean;
}

// ============================================================================
// Data Fetching Hooks
// ============================================================================

/**
 * Fetch paginated feed
 */
export const useFeed = (page: number = 0, limit: number = 20, lastSourceId?: string) => {
  return useQuery({
    queryKey: ['feed', page, limit, lastSourceId],
    queryFn: async (): Promise<FeedResponse> => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(lastSourceId && { lastSourceId }),
      });

      const response = await authenticatedFetch(`${API_BASE}/api/feed?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch feed');
      }
      return response.json();
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Fetch specific media item
 */
export const useMedia = (mediaId: string) => {
  return useQuery({
    queryKey: ['media', mediaId],
    queryFn: async (): Promise<MediaResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/media/${mediaId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch media');
      }
      return response.json();
    },
    enabled: !!mediaId,
    staleTime: 1 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Fetch saved items
 */
export const useSavedItems = () => {
  return useQuery({
    queryKey: ['saved'],
    queryFn: async (): Promise<SavedResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/saved`);
      if (!response.ok) {
        throw new Error('Failed to fetch saved items');
      }
      return response.json();
    },
    staleTime: 1 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Fetch liked items
 */
export const useLikedItems = () => {
  return useQuery({
    queryKey: ['liked'],
    queryFn: async (): Promise<LikedResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/liked`);
      if (!response.ok) {
        throw new Error('Failed to fetch liked items');
      }
      return response.json();
    },
    staleTime: 1 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Fetch media from a specific source
 */
export const useSourceMedia = (sourceId: string, limit: number = 50) => {
  return useQuery({
    queryKey: ['sourceMedia', sourceId, limit],
    queryFn: async (): Promise<SavedResponse> => {
      const params = new URLSearchParams({
        limit: limit.toString(),
      });

      const response = await authenticatedFetch(`${API_BASE}/api/source/${sourceId}/media?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch source media');
      }
      return response.json();
    },
    enabled: !!sourceId,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

interface Source {
  id: string;
  folderPath: string;
  displayName: string;
  avatarSeed: string;
  createdAt: number;
}

/**
 * Fetch all sources (folders) accessible by the user
 */
export const useSources = () => {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async (): Promise<Source[]> => {
      const response = await authenticatedFetch(`${API_BASE}/api/sources`);
      if (!response.ok) {
        throw new Error('Failed to fetch sources');
      }
      const data = await response.json();
      return data.sources || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Like/unlike a media item
 */
export const useLikeMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mediaId, sourceId }: { mediaId: string; sourceId: string }): Promise<InteractionResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/like`, {
        method: 'POST',
        body: JSON.stringify({ mediaId, sourceId }),
      });
      if (!response.ok) {
        throw new Error('Failed to like media');
      }
      return response.json();
    },
    onMutate: async ({ mediaId }) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      const previousFeeds = queryClient.getQueriesData({ queryKey: ['feed'] });

      queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          feed: old.feed.map((item: FeedItem) =>
            item.id === mediaId ? { ...item, liked: !item.liked } : item
          ),
        };
      });

      return { previousFeeds };
    },
    onError: (err, { mediaId }, context: any) => {
      if (context?.previousFeeds) {
        queryClient.setQueriesData({ queryKey: ['feed'] }, context.previousFeeds);
      }
    },
    onSuccess: (data, { mediaId }) => {
      // Update cache with actual API response state
      if (data.liked !== undefined) {
        queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            feed: old.feed.map((item: FeedItem) =>
              item.id === mediaId ? { ...item, liked: data.liked } : item
            ),
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['liked'] });
    },
  });
};

/**
 * Save/unsave a media item
 */
export const useSaveMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mediaId, sourceId }: { mediaId: string; sourceId: string }): Promise<InteractionResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/save`, {
        method: 'POST',
        body: JSON.stringify({ mediaId, sourceId }),
      });
      if (!response.ok) {
        throw new Error('Failed to save media');
      }
      return response.json();
    },
    onMutate: async ({ mediaId }) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      const previousFeeds = queryClient.getQueriesData({ queryKey: ['feed'] });

      queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          feed: old.feed.map((item: FeedItem) =>
            item.id === mediaId ? { ...item, saved: !item.saved } : item
          ),
        };
      });

      return { previousFeeds };
    },
    onError: (err, { mediaId }, context: any) => {
      if (context?.previousFeeds) {
        queryClient.setQueriesData({ queryKey: ['feed'] }, context.previousFeeds);
      }
    },
    onSuccess: (data, { mediaId }) => {
      // Update cache with actual API response state
      if (data.saved !== undefined) {
        queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            feed: old.feed.map((item: FeedItem) =>
              item.id === mediaId ? { ...item, saved: data.saved } : item
            ),
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['saved'] });
      queryClient.invalidateQueries({ queryKey: ['liked'] });
    },
  });
};

/**
 * Record a view
 */
export const useViewMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mediaId, sourceId }: { mediaId: string; sourceId: string }): Promise<InteractionResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/view`, {
        method: 'POST',
        body: JSON.stringify({ mediaId, sourceId }),
      });
      if (!response.ok) {
        throw new Error('Failed to record view');
      }
      return response.json();
    },
  });
};

/**
 * Hide/unhide a media item
 */
export const useHideMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mediaId, sourceId }: { mediaId: string; sourceId: string }): Promise<InteractionResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/hide`, {
        method: 'POST',
        body: JSON.stringify({ mediaId, sourceId }),
      });
      if (!response.ok) {
        throw new Error('Failed to hide media');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['hidden'] });
    },
  });
};

/**
 * Fetch hidden items
 */
export const useHiddenItems = () => {
  return useQuery({
    queryKey: ['hidden'],
    queryFn: async (): Promise<HiddenResponse> => {
      const response = await authenticatedFetch(`${API_BASE}/api/hidden`);
      if (!response.ok) {
        throw new Error('Failed to fetch hidden items');
      }
      return response.json();
    },
    staleTime: 1 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

// ============================================================================
// Performance Optimization Hooks
// ============================================================================

/**
 * Hook for lazy loading images with intersection observer
 */
export const useLazyImage = (ref: React.RefObject<HTMLImageElement>, src: string) => {
  useEffect(() => {
    if (!ref.current || !src) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && ref.current) {
          ref.current.src = src;
          observer.unobserve(ref.current);
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, src]);
};

/**
 * Hook for preloading next items in feed
 */
export const useMediaPreload = (mediaIds: string[], config: PreloadConfig = {}) => {
  const {
    prefetchDistance = 3,
    enableThumbnails = true,
    enableMetadata = true,
  } = config;

  const queryClient = useQueryClient();
  const preloadedRef = useRef(new Set<string>());

  const preloadMedia = useCallback(
    async (mediaId: string) => {
      if (preloadedRef.current.has(mediaId)) return;

      try {
        if (enableMetadata) {
          queryClient.prefetchQuery({
            queryKey: ['media', mediaId],
            queryFn: async () => {
              const response = await authenticatedFetch(`${API_BASE}/api/media/${mediaId}`);
              if (!response.ok) throw new Error('Failed to fetch');
              return response.json();
            },
          });
        }

        if (enableThumbnails) {
          queryClient.prefetchQuery({
            queryKey: ['thumbnail', mediaId],
            queryFn: async () => {
              const response = await authenticatedFetch(`${API_BASE}/api/thumbnail/${mediaId}`, {
                signal: AbortSignal.timeout(5000),
              });
              return response.ok;
            },
          });
        }

        preloadedRef.current.add(mediaId);
      } catch (error) {
        console.debug('Preload failed for', mediaId, error);
      }
    },
    [queryClient, enableMetadata, enableThumbnails]
  );

  useEffect(() => {
    const indicesToPreload = mediaIds.slice(0, prefetchDistance);
    indicesToPreload.forEach((id) => preloadMedia(id));
  }, [mediaIds, prefetchDistance, preloadMedia]);

  return { preloadedIds: preloadedRef.current };
};

/**
 * Hook for batch thumbnail preloading
 */
export const useBatchThumbnailPreload = (mediaIds: string[], enabled: boolean = true) => {
  const queryClient = useQueryClient();
  const preloadedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || mediaIds.length === 0) return;

    const idsToPreload = mediaIds.filter((id) => !preloadedRef.current.has(id));
    if (idsToPreload.length === 0) return;

    const batchSize = 20;
    const preloadBatch = async () => {
      for (let i = 0; i < idsToPreload.length; i += batchSize) {
        const batch = idsToPreload.slice(i, i + batchSize);

        try {
          await authenticatedFetch(`${API_BASE}/api/thumbnails/batch`, {
            method: 'POST',
            body: JSON.stringify({ ids: batch }),
            signal: AbortSignal.timeout(10000),
          });

          batch.forEach((id) => preloadedRef.current.add(id));
        } catch (error) {
          console.debug('Batch thumbnail preload failed:', error);
        }
      }
    };

    preloadBatch();
  }, [mediaIds, enabled, queryClient]);

  return { preloadedIds: preloadedRef.current };
};

/**
 * Hook for image error handling and fallback
 */
export const useImageErrorHandler = (src: string) => {
  const [imageSrc, setImageSrc] = React.useState(src);
  const [error, setError] = React.useState(false);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  React.useEffect(() => {
    setImageSrc(src);
    setError(false);
  }, [src]);

  return { imageSrc, error, handleError };
};

/**
 * Helper: throttle function for performance
 */
function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Hook for virtual scrolling optimization
 */
export const useVirtualScrolling = (
  items: any[],
  itemHeight: number,
  bufferSize: number = 5
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = React.useState({ start: 0, end: bufferSize });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;

      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
      const end = Math.min(
        items.length,
        Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferSize
      );

      setVisibleRange({ start, end });
    };

    const throttledScroll = throttle(handleScroll, 100);
    container.addEventListener('scroll', throttledScroll);

    return () => container.removeEventListener('scroll', throttledScroll);
  }, [items.length, itemHeight, bufferSize]);

  return {
    containerRef,
    visibleItems: items.slice(visibleRange.start, visibleRange.end),
    visibleRange,
  };
};

// ============================================================================
// Folder Management Hooks
// ============================================================================

import type { FolderNode } from '@/lib/api';
import { getFolderTree, toggleFolderHide, getHiddenFolders } from '@/lib/api';

/**
 * Fetch folder tree for a source
 */
export const useFolderTree = (sourceId: string | null) => {
  return useQuery({
    queryKey: ['folderTree', sourceId],
    queryFn: async (): Promise<FolderNode> => {
      if (!sourceId) {
        throw new Error('Source ID is required');
      }
      return getFolderTree(sourceId);
    },
    enabled: !!sourceId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

/**
 * Toggle folder hide status
 */
export const useHideFolderMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sourceId, folderPath }: { sourceId: string; folderPath: string }) =>
      toggleFolderHide(sourceId, folderPath),
    onSuccess: (_, variables) => {
      // Invalidate folder tree to refresh
      queryClient.invalidateQueries({ queryKey: ['folderTree', variables.sourceId] });
      // Invalidate feed to reflect hidden folder changes
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['sourceFeed'] });
    },
  });
};

/**
 * Fetch hidden folders for a source
 */
export const useHiddenFolders = (sourceId: string | null) => {
  return useQuery({
    queryKey: ['hiddenFolders', sourceId],
    queryFn: async (): Promise<Array<{ folder_path: string }>> => {
      if (!sourceId) {
        throw new Error('Source ID is required');
      }
      return getHiddenFolders(sourceId);
    },
    enabled: !!sourceId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};
