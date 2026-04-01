/**
 * Feed Discovery Engine
 * Implements discovery algorithm: unseen priority, source diversity, proximity, like/save bias, entropy
 * Ensures no semantic folder interpretation
 */
import type Database from 'better-sqlite3';

interface FeedItem {
  id: string;
  path: string;
  type: string;
  sourceId: string;
  displayName: string;
  avatarSeed: string;
  liked: boolean;
  saved: boolean;
  depth: number;
  status: 'pending' | 'ready';
  tempFileId?: string;
}

interface FeedOptions {
  limit?: number;
  offset?: number;
  lastSourceId?: string; // To avoid same source consecutively
  userId?: string; // User ID for scoped interactions
  sourceId?: string; // Optional source filtering
  feedSeed?: string; // Session seed to vary ordering between feed sessions
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
  } = options;

  if (!userId) {
    return [];
  }

  const allMedia = db.prepare(
    `
      WITH latest_paths AS (
        SELECT fp.*
        FROM file_paths fp
        JOIN (
          SELECT file_id, MAX(last_seen_at) AS max_seen
          FROM file_paths
          WHERE user_id = ? AND is_present = 1
          GROUP BY file_id
        ) latest
          ON latest.file_id = fp.file_id
         AND latest.max_seen = fp.last_seen_at
        WHERE fp.user_id = ? AND fp.is_present = 1
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

      return {
        ...m,
        sourceId: computedSourceId,
        displayName: deriveDisplayName(computedSourceId),
        avatarSeed: computedSourceId,
        depth,
        score,
      };
    })
    .sort((a, b) => b.score - a.score); // Sort descending by score

  // Step 3: Apply source diversity rule while preserving full result set.
  // If no alternative source exists, fall back to the highest-ranked remaining item.
  const remaining = [...scoredMedia];
  const ordered: FeedItem[] = [];
  let lastUsedSourceId = lastSourceId;

  while (remaining.length > 0) {
    let nextIndex = 0;

    if (lastUsedSourceId) {
      const alternateIndex = remaining.findIndex((media) => media.sourceId !== lastUsedSourceId);
      if (alternateIndex !== -1) {
        nextIndex = alternateIndex;
      }
    }

    const [media] = remaining.splice(nextIndex, 1);
    ordered.push({
      id: media.id,
      path: media.path,
      type: media.mediaKind,
      sourceId: media.sourceId,
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
 * Generate feed with pagination support
 * This is useful for infinite scroll implementations
 */
export function generatePaginatedFeed(
  db: Database.Database,
  page: number = 0,
  itemsPerPage: number = 20,
  lastSourceId?: string,
  userId?: string,
  sourceId?: string,
  feedSeed?: string
): {
  items: FeedItem[];
  hasMore: boolean;
  page: number;
} {
  const offset = page * itemsPerPage;
  const feed = generateFeed(db, {
    limit: itemsPerPage + 1, // Fetch one extra to determine hasMore
    offset,
    lastSourceId,
    userId,
    sourceId,
    feedSeed,
  });

  const hasMore = feed.length > itemsPerPage;
  const items = feed.slice(0, itemsPerPage);

  return {
    items,
    hasMore,
    page,
  };
}
