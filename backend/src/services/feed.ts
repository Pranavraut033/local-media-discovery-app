/**
 * Feed Discovery Engine
 * Implements discovery algorithm: unseen priority, source diversity, proximity, like/save bias, entropy
 * Ensures no semantic folder interpretation
 */
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// In-memory feed cache
// ---------------------------------------------------------------------------
// The ranked+diversity-ordered feed for a given (userId, feedSeed, sourceType,
// sourceId) is fully deterministic. Caching it avoids re-scoring and re-ranking
// all media on every page request (infinite scroll issues N requests per session).
//
// Key: `userId:feedSeed:sourceType:sourceId`
// TTL: 10 minutes — old sessions auto-expire; interactions (like/hide) are
//      reflected on the next session (new feedSeed).
interface FeedCacheEntry {
  createdAt: number;
  items: FeedItem[];
}

const feedCache = new Map<string, FeedCacheEntry>();
const FEED_CACHE_TTL_MS = 10 * 60 * 1000;

function feedCacheKey(
  userId: string,
  feedSeed: string | undefined,
  sourceType: FeedSourceType,
  sourceId: string | undefined
): string {
  return `${userId}:${feedSeed ?? ''}:${sourceType}:${sourceId ?? ''}`;
}

function getFromFeedCache(key: string): FeedItem[] | null {
  const entry = feedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > FEED_CACHE_TTL_MS) {
    feedCache.delete(key);
    return null;
  }
  return entry.items;
}

function setInFeedCache(key: string, items: FeedItem[]): void {
  // Cap cache size — evict all expired entries when we reach 100 live sessions.
  if (feedCache.size >= 100) {
    const now = Date.now();
    for (const [k, v] of feedCache) {
      if (now - v.createdAt > FEED_CACHE_TTL_MS) feedCache.delete(k);
    }
  }
  feedCache.set(key, { createdAt: Date.now(), items });
}

/** Invalidate any cached feeds for a user (e.g. after indexing completes). */
export function invalidateFeedCache(userId: string): void {
  for (const key of feedCache.keys()) {
    if (key.startsWith(`${userId}:`)) feedCache.delete(key);
  }
}

interface FeedItem {
  id: string;
  path: string;
  type: string;
  sourceId: string;
  rootChildFolder: string;
  parentFolderName?: string;
  parentFolderPath?: string;
  displayName: string;
  avatarSeed: string;
  liked: boolean;
  saved: boolean;
  depth: number;
  status: 'pending' | 'ready';
  tempFileId?: string;
}

export type FeedSourceType = 'local' | 'remote' | 'all';

interface FeedOptions {
  limit?: number;
  offset?: number;
  lastSourceId?: string; // To avoid same source consecutively
  userId?: string; // User ID for scoped interactions
  sourceId?: string; // Optional source filtering
  feedSeed?: string; // Session seed to vary ordering between feed sessions
  sourceType?: FeedSourceType; // Filter by source origin (local/remote/all), defaults to 'local'
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function deriveSourceId(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return 'root';
  const parts = normalized.split('/').filter(Boolean);
  return parts.length <= 1 ? 'root' : parts[0];
}

function deriveDepth(relativePath: string): number {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return 0;
  const parts = normalized.split('/').filter(Boolean);
  return Math.max(0, parts.length - 1);
}

function deriveImmediateParentFolder(relativePath: string): string | undefined {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return undefined;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return undefined;

  return parts[parts.length - 2];
}

function deriveParentFolderPath(relativePath: string): string | undefined {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return undefined;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return undefined;

  return parts.slice(0, -1).join('/');
}

function deriveDisplayName(sourceId: string): string {
  return sourceId === 'root' ? 'Root' : sourceId;
}

function deterministicEntropy(id: string, userId: string, feedSeed?: string): number {
  // Stable pseudo-random value in [0, 100) so pagination remains deterministic.
  const input = `${userId}:${feedSeed ?? ''}:${id}`;
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % 100;
}

function distributeLikedItems(
  items: FeedItem[],
  userId: string,
  feedSeed?: string
): FeedItem[] {
  if (items.length <= 1) return items;

  const liked: FeedItem[] = [];
  const others: FeedItem[] = [];

  for (const item of items) {
    if (item.liked) {
      liked.push(item);
    } else {
      others.push(item);
    }
  }

  if (liked.length === 0 || others.length === 0) {
    return items;
  }

  // Place liked items at deterministic spaced slots so they stay visible
  // but do not cluster at the top of the feed.
  const interval = 4;
  const startOffset = 1 + (deterministicEntropy('liked-slot-offset', userId, feedSeed) % 3);
  const output: FeedItem[] = [];
  let likedIndex = 0;
  let otherIndex = 0;

  for (let pos = 0; pos < items.length; pos += 1) {
    const eligibleLikedSlot = pos >= startOffset && (pos - startOffset) % interval === 0;

    if (eligibleLikedSlot && likedIndex < liked.length) {
      output.push(liked[likedIndex]);
      likedIndex += 1;
      continue;
    }

    if (otherIndex < others.length) {
      output.push(others[otherIndex]);
      otherIndex += 1;
      continue;
    }

    if (likedIndex < liked.length) {
      output.push(liked[likedIndex]);
      likedIndex += 1;
    }
  }

  return output;
}

export function generateFeed(db: Database.Database, options: FeedOptions = {}): FeedItem[] {
  const {
    limit = 20,
    offset = 0,
    lastSourceId,
    userId,
    sourceId,
    feedSeed,
    sourceType = 'local',
  } = options;

  if (!userId) {
    return [];
  }

  // Filter applied inside the CTE so the MAX(last_seen_at) dedup only
  // considers paths of the requested storage_mode. Without this, a file that
  // exists in both local and rclone would have its local path win the MAX()
  // and the remote storage_mode filter in the outer WHERE would find nothing.
  const storageModeFilter =
    sourceType === 'local'
      ? "AND storage_mode = 'local'"
      : sourceType === 'remote'
        ? "AND storage_mode = 'rclone'"
        : '';

  const allMedia = db.prepare(
    `
      WITH latest_paths AS (
        SELECT fp.*
        FROM file_paths fp
        JOIN (
          SELECT file_id, MAX(last_seen_at) AS max_seen
          FROM file_paths
          WHERE user_id = ? AND is_present = 1 ${storageModeFilter}
          GROUP BY file_id
        ) latest
          ON latest.file_id = fp.file_id
         AND latest.max_seen = fp.last_seen_at
        WHERE fp.user_id = ? AND fp.is_present = 1 ${storageModeFilter}
      )
      SELECT
        f.id,
        lp.absolute_path AS path,
        f.media_kind AS mediaKind,
        lp.relative_path_from_root AS relativePath,
        f.created_at AS createdAt,
        lp.status AS status,
        lp.temp_file_id AS tempFileId,
        CASE WHEN ulf.file_id IS NULL THEN 0 ELSE 1 END AS liked,
        CASE WHEN usf.file_id IS NULL THEN 0 ELSE 1 END AS saved,
        CASE WHEN uhf.file_id IS NULL THEN 0 ELSE 1 END AS hidden
      FROM files f
      JOIN latest_paths lp ON lp.file_id = f.id
      LEFT JOIN user_liked_files ulf ON ulf.user_id = ? AND ulf.file_id = f.id
      LEFT JOIN user_saved_files usf ON usf.user_id = ? AND usf.file_id = f.id
      LEFT JOIN user_hidden_files uhf ON uhf.user_id = ? AND uhf.file_id = f.id
      WHERE uhf.file_id IS NULL
      ORDER BY f.created_at ASC
    `
  ).all(userId, userId, userId, userId, userId) as Array<{
    id: string;
    path: string;
    mediaKind: string;
    relativePath: string;
    liked: number;
    saved: number;
    hidden: number;
    createdAt: number;
    status: string;
    tempFileId: string | null;
  }>;

  if (allMedia.length === 0) {
    return [];
  }

  const sourceFiltered = sourceId
    ? allMedia.filter((m) => deriveSourceId(m.relativePath) === sourceId)
    : allMedia;

  // Step 2: Score each media item based on discovery algorithm
  const scoredMedia = sourceFiltered
    .map((m) => {
      let score = 0;

      // Like bias: show liked media more often, but not all at the top.
      // A small base boost keeps liked items visible, while a selective
      // entropy pulse boosts only a subset per feed seed/session.
      if (m.liked) {
        score += 35;

        const likedPulseGate = deterministicEntropy(`liked:${m.id}`, userId, feedSeed);
        if (likedPulseGate < 28) {
          score += 95;
        }
      }
      // Save bias: de-emphasize saved content so it appears less often.
      // Apply a baseline penalty, and a deeper entropy-based penalty for
      // a subset of saved items per feed seed/session.
      else if (m.saved) {
        score -= 90;

        const savedDemotionGate = deterministicEntropy(`saved:${m.id}`, userId, feedSeed);
        if (savedDemotionGate < 60) {
          score -= 110;
        }
      }

      // Proximity bias: prefer shallow depth (easier to discover)
      const depth = deriveDepth(m.relativePath);
      score += Math.max(0, 10 - depth) * 20;

      // Entropy/randomness: stable noise for variety without breaking pagination order.
      const entropy = deterministicEntropy(m.id, userId, feedSeed);
      score += entropy;

      // Time decay: slightly prefer newer content
      const ageInDays = (Date.now() - m.createdAt * 1000) / (1000 * 60 * 60 * 24);
      const timeBoost = Math.max(0, 50 - ageInDays);
      score += timeBoost;

      const computedSourceId = deriveSourceId(m.relativePath);
      const parentFolderName = deriveImmediateParentFolder(m.relativePath);
      const parentFolderPath = deriveParentFolderPath(m.relativePath);

      return {
        ...m,
        sourceId: computedSourceId,
        rootChildFolder: computedSourceId,
        parentFolderName,
        parentFolderPath,
        displayName: deriveDisplayName(computedSourceId),
        avatarSeed: computedSourceId,
        depth,
        score,
      };
    })
    .sort((a, b) => b.score - a.score); // Sort descending by score

  // Step 3: Apply source diversity using a bucket-based O(n) pass.
  // Items are already sorted by score (desc). We group them into per-source
  // buckets (preserving score order within each bucket), then greedily pull
  // the highest-scored item that comes from a different source than the last.
  // If only one source remains, we drain it without penalty.
  type ScoredItem = (typeof scoredMedia)[number];
  const buckets = new Map<string, ScoredItem[]>();
  for (const item of scoredMedia) {
    let bucket = buckets.get(item.sourceId);
    if (!bucket) {
      bucket = [];
      buckets.set(item.sourceId, bucket);
    }
    bucket.push(item);
  }

  const ordered: FeedItem[] = [];
  let lastUsedSourceId = lastSourceId;

  while (buckets.size > 0) {
    // Pick the bucket whose top item has the highest score, excluding lastUsedSourceId
    // when an alternative exists.
    let bestKey: string | null = null;
    let bestScore = -Infinity;
    for (const [key, items] of buckets) {
      const topScore = items[0].score;
      if (key !== lastUsedSourceId && topScore > bestScore) {
        bestScore = topScore;
        bestKey = key;
      }
    }
    // Fallback: all remaining items are from the same source as the last one.
    if (bestKey === null) {
      bestKey = buckets.keys().next().value as string;
    }

    const bucket = buckets.get(bestKey)!;
    const media = bucket.shift()!;
    if (bucket.length === 0) buckets.delete(bestKey);

    ordered.push({
      id: media.id,
      path: media.path,
      type: media.mediaKind,
      sourceId: media.sourceId,
      rootChildFolder: media.rootChildFolder,
      ...(media.parentFolderName ? { parentFolderName: media.parentFolderName } : {}),
      ...(media.parentFolderPath ? { parentFolderPath: media.parentFolderPath } : {}),
      displayName: media.displayName,
      avatarSeed: media.avatarSeed,
      liked: media.liked === 1,
      saved: media.saved === 1,
      depth: media.depth,
      status: (media.status === 'pending' ? 'pending' : 'ready') as 'pending' | 'ready',
      ...(media.tempFileId ? { tempFileId: media.tempFileId } : {}),
    });
    lastUsedSourceId = media.sourceId;
  }

  const likedDistributed = distributeLikedItems(ordered, userId, feedSeed);

  return likedDistributed.slice(offset, offset + limit);
}

/**
 * Generate feed with pagination support.
 * The full ranked+diversity ordered list is computed once per (userId, feedSeed,
 * sourceType, sourceId) session and cached in memory for 10 minutes, so
 * subsequent page requests (infinite scroll) are O(1) slices rather than
 * re-ranking the entire library each time.
 */
export function generatePaginatedFeed(
  db: Database.Database,
  page: number = 0,
  itemsPerPage: number = 20,
  lastSourceId?: string,
  userId?: string,
  sourceId?: string,
  feedSeed?: string,
  sourceType?: FeedSourceType
): {
  items: FeedItem[];
  hasMore: boolean;
  page: number;
} {
  if (!userId) return { items: [], hasMore: false, page };

  const resolvedSourceType: FeedSourceType = sourceType ?? 'local';
  const cacheKey = feedCacheKey(userId, feedSeed, resolvedSourceType, sourceId);

  let allItems = getFromFeedCache(cacheKey);

  if (!allItems) {
    // Compute the full ordered list (no limit/offset — we cache it all).
    allItems = generateFeed(db, {
      userId,
      sourceId,
      feedSeed,
      sourceType: resolvedSourceType,
      lastSourceId,
      // Fetch everything; the cache makes subsequent pages free.
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    });
    setInFeedCache(cacheKey, allItems);
  }

  const offset = page * itemsPerPage;
  const items = allItems.slice(offset, offset + itemsPerPage);
  const hasMore = offset + itemsPerPage < allItems.length;

  return { items, hasMore, page };
}
