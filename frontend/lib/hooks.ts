/**
 * Custom React Query hooks for feed and media interactions
 * Includes performance optimization hooks for lazy loading and preloading
 */
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import React, { useEffect, useRef, useCallback } from 'react';
import { getApiBase, authenticatedFetch } from '@/lib/api';

const API_BASE = getApiBase();

// ============================================================================
// Types
// ============================================================================

export interface FeedItem {
  id: string;
  fileKey: string;
  path: string;
  activePath: string;
  type: string;
  sourceId: string;
  displayName: string;
  avatarSeed: string;
  liked: boolean;
  saved: boolean;
  hidden: boolean;
  depth: number;
  source?: {
    id: string;
    displayName: string;
    avatarSeed: string;
    folderPath?: string;
  };
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
  hidden?: boolean;
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

interface SourceMediaResponse {
  success: boolean;
  media: Array<FeedItem & {
    viewCount: number;
    lastViewed: number | null;
  }>;
}

interface PreloadConfig {
  prefetchDistance?: number;
  enableThumbnails?: boolean;
  enableMetadata?: boolean;
}

interface QuerySnapshot {
  queryKey: readonly unknown[];
  data: unknown;
}

interface MutationSnapshotContext {
  snapshots: QuerySnapshot[];
  targetItem?: FeedItem;
}

type QueryCollectionKey = 'feed' | 'savedMedia' | 'likedMedia' | 'hiddenMedia' | 'media';

type UnknownRecord = Record<string, unknown>;

const MUTATION_QUERY_ROOTS = ['feed', 'saved', 'liked', 'hidden', 'sourceMedia'] as const;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const toBoolean = (value: unknown, fallback: boolean = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return fallback;
};

const toNumber = (value: unknown, fallback: number = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const inferSourceIdFromPath = (path: string): string => {
  if (!path) return 'root';
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return 'root';
  const firstSegment = normalized.split('/').filter(Boolean)[0];
  return firstSegment || 'root';
};

const normalizeFeedItem = (rawInput: unknown, options?: { hidden?: boolean }): FeedItem => {
  const raw = isRecord(rawInput) ? rawInput : {};
  const source = isRecord(raw.source) ? raw.source : {};
  const sourceId =
    (typeof raw.sourceId === 'string' ? raw.sourceId : undefined) ||
    (typeof source.id === 'string' ? source.id : undefined) ||
    inferSourceIdFromPath(
      (typeof raw.activePath === 'string' ? raw.activePath : undefined) ||
      (typeof raw.path === 'string' ? raw.path : undefined) ||
      (typeof raw.filePath === 'string' ? raw.filePath : undefined) ||
      ''
    );
  const displayName =
    (typeof raw.displayName === 'string' ? raw.displayName : undefined) ||
    (typeof source.displayName === 'string' ? source.displayName : undefined) ||
    (sourceId === 'root' ? 'Root' : sourceId);
  const avatarSeed =
    (typeof raw.avatarSeed === 'string' ? raw.avatarSeed : undefined) ||
    (typeof source.avatarSeed === 'string' ? source.avatarSeed : undefined) ||
    sourceId;
  const activePath =
    (typeof raw.activePath === 'string' ? raw.activePath : undefined) ||
    (typeof raw.path === 'string' ? raw.path : undefined) ||
    (typeof raw.filePath === 'string' ? raw.filePath : undefined) ||
    '';
  const id =
    (typeof raw.id === 'string' ? raw.id : undefined) ||
    (typeof raw.fileKey === 'string' ? raw.fileKey : undefined) ||
    '';

  return {
    id,
    fileKey: (typeof raw.fileKey === 'string' ? raw.fileKey : undefined) || id,
    path: activePath,
    activePath,
    type:
      (typeof raw.type === 'string' ? raw.type : undefined) ||
      (typeof raw.mediaKind === 'string' ? raw.mediaKind : undefined) ||
      'unknown',
    sourceId,
    displayName,
    avatarSeed,
    liked: toBoolean(raw.liked),
    saved: toBoolean(raw.saved),
    hidden: toBoolean(raw.hidden, options?.hidden ?? false),
    depth: toNumber(raw.depth, 0),
    source: {
      id: sourceId,
      displayName,
      avatarSeed,
      folderPath: typeof source.folderPath === 'string' ? source.folderPath : undefined,
    },
  };
};

const normalizeFeedResponse = (response: FeedResponse): FeedResponse => ({
  ...response,
  feed: (response.feed || []).map((item) => normalizeFeedItem(item)),
});

const normalizeMediaResponse = (response: MediaResponse): MediaResponse => ({
  ...response,
  media: {
    ...normalizeFeedItem(response.media),
    viewCount: toNumber(response.media?.viewCount, 0),
    lastViewed: response.media?.lastViewed ?? null,
  },
});

const normalizeSavedResponse = (response: SavedResponse): SavedResponse => ({
  ...response,
  savedMedia: (response.savedMedia || []).map((item) => ({
    ...normalizeFeedItem(item),
    viewCount: toNumber(item.viewCount, 0),
    lastViewed: item.lastViewed ?? null,
  })),
});

const normalizeLikedResponse = (response: LikedResponse): LikedResponse => ({
  ...response,
  likedMedia: (response.likedMedia || []).map((item) => ({
    ...normalizeFeedItem(item),
    viewCount: toNumber(item.viewCount, 0),
    lastViewed: item.lastViewed ?? null,
  })),
});

const normalizeHiddenResponse = (response: HiddenResponse): HiddenResponse => ({
  ...response,
  hiddenMedia: (response.hiddenMedia || []).map((item) => ({
    ...normalizeFeedItem(item, { hidden: true }),
    viewCount: toNumber(item.viewCount, 0),
    lastViewed: item.lastViewed ?? null,
  })),
});

const normalizeSourceMediaResponse = (response: unknown): SourceMediaResponse => {
  const payload = isRecord(response) ? response : {};
  const rawMedia = Array.isArray(payload.media)
    ? payload.media
    : Array.isArray(payload.savedMedia)
      ? payload.savedMedia
      : [];

  return {
    success: Boolean(payload.success),
    media: rawMedia.map((item) => ({
      ...normalizeFeedItem(item),
      viewCount: toNumber(isRecord(item) ? item.viewCount : undefined, 0),
      lastViewed: isRecord(item) ? (item.lastViewed as number | null | undefined) ?? null : null,
    })),
  };
};

const collectMutationSnapshots = (queryClient: ReturnType<typeof useQueryClient>): QuerySnapshot[] => {
  const snapshots: QuerySnapshot[] = [];

  MUTATION_QUERY_ROOTS.forEach((root) => {
    const entries = queryClient.getQueriesData({ queryKey: [root] });
    entries.forEach(([queryKey, data]) => {
      snapshots.push({ queryKey, data });
    });
  });

  return snapshots;
};

const restoreMutationSnapshots = (
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: QuerySnapshot[] | undefined
) => {
  if (!snapshots?.length) return;
  snapshots.forEach(({ queryKey, data }) => {
    queryClient.setQueryData(queryKey, data);
  });
};

const updateQueryCollection = (
  queryClient: ReturnType<typeof useQueryClient>,
  rootKey: string,
  collectionKey: QueryCollectionKey,
  updater: (items: FeedItem[]) => FeedItem[]
) => {
  queryClient.setQueriesData({ queryKey: [rootKey] }, (old) => {
    if (!isRecord(old) || !Array.isArray(old[collectionKey])) return old;
    return {
      ...old,
      [collectionKey]: updater(old[collectionKey] as FeedItem[]),
    };
  });
};

const findItemInMutationCaches = (
  queryClient: ReturnType<typeof useQueryClient>,
  mediaId: string
): FeedItem | undefined => {
  const locations: Array<{ root: string; key: QueryCollectionKey }> = [
    { root: 'feed', key: 'feed' },
    { root: 'saved', key: 'savedMedia' },
    { root: 'liked', key: 'likedMedia' },
    { root: 'hidden', key: 'hiddenMedia' },
    { root: 'sourceMedia', key: 'media' },
  ];

  for (const location of locations) {
    const entries = queryClient.getQueriesData({ queryKey: [location.root] });
    for (const [, data] of entries) {
      const items = isRecord(data) ? data[location.key] : undefined;
      if (!Array.isArray(items)) continue;
      const match = items.find((item) => isRecord(item) && item.id === mediaId);
      if (match) return normalizeFeedItem(match);
    }
  }

  return undefined;
};

const patchItemInAllCollections = (
  queryClient: ReturnType<typeof useQueryClient>,
  mediaId: string,
  patch: Partial<FeedItem>,
  options?: {
    removeFromVisibleLists?: boolean;
    removeFromHiddenList?: boolean;
    prependToHiddenList?: FeedItem;
  }
) => {
  const patchItem = (item: FeedItem): FeedItem =>
    item.id === mediaId ? { ...item, ...patch } : item;

  const filterVisible = (items: FeedItem[]) =>
    options?.removeFromVisibleLists ? items.filter((item) => item.id !== mediaId) : items.map(patchItem);

  updateQueryCollection(queryClient, 'feed', 'feed', filterVisible);
  updateQueryCollection(queryClient, 'saved', 'savedMedia', filterVisible);
  updateQueryCollection(queryClient, 'liked', 'likedMedia', filterVisible);
  updateQueryCollection(queryClient, 'sourceMedia', 'media', filterVisible);

  updateQueryCollection(queryClient, 'hidden', 'hiddenMedia', (items) => {
    let next = items;

    if (options?.removeFromHiddenList) {
      next = next.filter((item) => item.id !== mediaId);
    } else {
      next = next.map(patchItem);
    }

    if (options?.prependToHiddenList && !next.some((item) => item.id === mediaId)) {
      next = [options.prependToHiddenList, ...next];
    }

    return next;
  });
};

// ============================================================================
// Data Fetching Hooks
// ============================================================================

/**
 * Fetch paginated feed
 */
export const useFeed = (
  page: number = 0,
  limit: number = 20,
  lastSourceId?: string,
  feedSeed?: string
) => {
  return useQuery({
    queryKey: ['feed', page, limit, lastSourceId, feedSeed],
    queryFn: async (): Promise<FeedResponse> => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(lastSourceId && { lastSourceId }),
        ...(feedSeed && { feedSeed }),
      });

      const response = await authenticatedFetch(`${API_BASE}/api/feed?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch feed');
      }
      const data = await response.json();
      return normalizeFeedResponse(data);
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Fetch feed with infinite pagination
 */
export const useInfiniteFeed = (limit: number = 20, sourceId?: string, feedSeed?: string, sourceType?: string) => {
  return useInfiniteQuery({
    queryKey: ['feed', 'infinite', limit, sourceId, feedSeed, sourceType],
    queryFn: async ({ pageParam = 0 }): Promise<FeedResponse> => {
      const params = new URLSearchParams({
        page: String(pageParam),
        limit: String(limit),
        ...(sourceId ? { sourceId } : {}),
        ...(feedSeed ? { feedSeed } : {}),
        ...(sourceType ? { sourceType } : {}),
      });

      const response = await authenticatedFetch(`${API_BASE}/api/feed?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch feed');
      }

      const data = await response.json();
      return normalizeFeedResponse(data);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
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
      const data = await response.json();
      return normalizeMediaResponse(data);
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
      const data = await response.json();
      return normalizeSavedResponse(data);
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
      const data = await response.json();
      return normalizeLikedResponse(data);
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
    queryFn: async (): Promise<SourceMediaResponse> => {
      const params = new URLSearchParams({
        limit: limit.toString(),
      });

      const response = await authenticatedFetch(`${API_BASE}/api/source/${sourceId}/media?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch source media');
      }
      const data = await response.json();
      return normalizeSourceMediaResponse(data);
    },
    enabled: !!sourceId,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

export interface Source {
  id: string;
  displayName: string;
  avatarSeed: string;
  // Legacy fields may be absent in schema v2 source projections.
  folderPath?: string;
  createdAt?: number;
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
    onMutate: async ({ mediaId }): Promise<MutationSnapshotContext> => {
      await Promise.all(MUTATION_QUERY_ROOTS.map((root) => queryClient.cancelQueries({ queryKey: [root] })));

      const snapshots = collectMutationSnapshots(queryClient);
      const targetItem = findItemInMutationCaches(queryClient, mediaId);
      const nextLiked = !(targetItem?.liked ?? false);

      patchItemInAllCollections(queryClient, mediaId, { liked: nextLiked });

      return { snapshots, targetItem };
    },
    onError: (_err, _variables, context) => {
      restoreMutationSnapshots(queryClient, context?.snapshots);
    },
    onSuccess: (data, { mediaId }) => {
      if (data.liked !== undefined) {
        patchItemInAllCollections(queryClient, mediaId, { liked: data.liked });
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
    onMutate: async ({ mediaId }): Promise<MutationSnapshotContext> => {
      await Promise.all(MUTATION_QUERY_ROOTS.map((root) => queryClient.cancelQueries({ queryKey: [root] })));

      const snapshots = collectMutationSnapshots(queryClient);
      const targetItem = findItemInMutationCaches(queryClient, mediaId);
      const nextSaved = !(targetItem?.saved ?? false);

      patchItemInAllCollections(queryClient, mediaId, { saved: nextSaved });

      return { snapshots, targetItem };
    },
    onError: (_err, _variables, context) => {
      restoreMutationSnapshots(queryClient, context?.snapshots);
    },
    onSuccess: (data, { mediaId }) => {
      if (data.saved !== undefined) {
        patchItemInAllCollections(queryClient, mediaId, { saved: data.saved });
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
    onMutate: async ({ mediaId }): Promise<MutationSnapshotContext> => {
      await Promise.all(MUTATION_QUERY_ROOTS.map((root) => queryClient.cancelQueries({ queryKey: [root] })));

      const snapshots = collectMutationSnapshots(queryClient);
      const targetItem = findItemInMutationCaches(queryClient, mediaId);
      const nextHidden = !(targetItem?.hidden ?? false);
      const hiddenCandidate = targetItem
        ? {
          ...targetItem,
          hidden: true,
        }
        : undefined;

      patchItemInAllCollections(
        queryClient,
        mediaId,
        { hidden: nextHidden },
        {
          removeFromVisibleLists: nextHidden,
          removeFromHiddenList: !nextHidden,
          prependToHiddenList: nextHidden ? hiddenCandidate : undefined,
        }
      );

      return { snapshots, targetItem };
    },
    onError: (_err, _variables, context) => {
      restoreMutationSnapshots(queryClient, context?.snapshots);
    },
    onSuccess: (data, { mediaId }) => {
      if (typeof data.hidden === 'boolean') {
        patchItemInAllCollections(
          queryClient,
          mediaId,
          { hidden: data.hidden },
          {
            removeFromVisibleLists: data.hidden,
            removeFromHiddenList: !data.hidden,
          }
        );
      }

      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['saved'] });
      queryClient.invalidateQueries({ queryKey: ['liked'] });
      queryClient.invalidateQueries({ queryKey: ['hidden'] });
      queryClient.invalidateQueries({ queryKey: ['sourceMedia'] });
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
      const data = await response.json();
      return normalizeHiddenResponse(data);
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
export const useFolderTree = (sourceIds: string[]) => {
  return useQuery({
    queryKey: ['folderTree', sourceIds],
    queryFn: async (): Promise<FolderNode> => {
      if (!sourceIds?.length) {
        throw new Error('Source ID is required');
      }
      return getFolderTree(sourceIds);
    },
    enabled: !!sourceIds.length,
    staleTime: 1000 * 30, // 30 seconds - fresh enough for hide toggles
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
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
    onSuccess: async (data, variables) => {
      console.log('Folder hide toggled:', data, 'for', variables.folderPath);

      // Update the cache directly with server response
      queryClient.setQueriesData({ queryKey: ['folderTree'] }, (old: any) => {
        if (!old) return old;

        const updateNodeHidden = (node: FolderNode): FolderNode => {
          if (node.path === variables.folderPath) {
            return { ...node, hidden: data.hidden };
          }
          return {
            ...node,
            children: node.children.map(updateNodeHidden),
          };
        };

        return updateNodeHidden(old);
      });

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['sourceFeed'] });
      queryClient.invalidateQueries({ queryKey: ['hiddenFolders'] });
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
