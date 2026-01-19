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
}

interface FeedOptions {
  limit?: number;
  offset?: number;
  lastSourceId?: string; // To avoid same source consecutively
  userLikedIds?: Set<string>;
  userSavedIds?: Set<string>;
}

export function generateFeed(db: Database.Database, options: FeedOptions = {}): FeedItem[] {
  const {
    limit = 20,
    offset = 0,
    lastSourceId,
    userLikedIds = new Set(),
    userSavedIds = new Set(),
  } = options;

  // Step 1: Fetch all media with interaction data
  const allMedia = db
    .prepare(
      `
    SELECT 
      m.id,
      m.path,
      m.type,
      m.source_id as sourceId,
      m.liked,
      m.saved,
      m.view_count as viewCount,
      m.last_viewed as lastViewed,
      m.created_at as createdAt,
      m.depth,
      s.display_name as displayName,
      s.avatar_seed as avatarSeed
    FROM media m
    JOIN sources s ON m.source_id = s.id
    ORDER BY m.created_at ASC
  `
    )
    .all() as Array<{
      id: string;
      path: string;
      type: string;
      sourceId: string;
      liked: number;
      saved: number;
      viewCount: number;
      lastViewed: number | null;
      createdAt: number;
      depth: number;
      displayName: string;
      avatarSeed: string;
    }>;

  if (allMedia.length === 0) {
    return [];
  }

  // Step 2: Score each media item based on discovery algorithm
  const scoredMedia = allMedia
    .map((m) => {
      let score = 0;

      // Unseen priority: highest weight
      if (m.viewCount === 0) {
        score += 1000;
      } else {
        // Penalize viewed content slightly
        score -= m.viewCount * 10;
      }

      // Like bias: boost liked content
      if (m.liked) {
        score += 500;
      }

      // Save bias: boost saved content
      if (m.saved) {
        score += 300;
      }

      // Proximity bias: prefer shallow depth (easier to discover)
      score += Math.max(0, 10 - m.depth) * 20;

      // Entropy/randomness: add noise for variety
      const entropy = Math.random() * 100;
      score += entropy;

      // Time decay: slightly prefer newer content
      const ageInDays = (Date.now() - m.createdAt * 1000) / (1000 * 60 * 60 * 24);
      const timeBoost = Math.max(0, 50 - ageInDays);
      score += timeBoost;

      return {
        ...m,
        score,
      };
    })
    .sort((a, b) => b.score - a.score); // Sort descending by score

  // Step 3: Apply source diversity rule: avoid same source consecutively
  const feed: FeedItem[] = [];
  let lastUsedSourceId = lastSourceId;

  for (const media of scoredMedia) {
    if (feed.length >= limit) {
      break;
    }

    // Skip if this is the same source as the last item
    if (lastUsedSourceId && media.sourceId === lastUsedSourceId) {
      continue;
    }

    feed.push({
      id: media.id,
      path: media.path,
      type: media.type,
      sourceId: media.sourceId,
      displayName: media.displayName,
      avatarSeed: media.avatarSeed,
      liked: media.liked === 1,
      saved: media.saved === 1,
      depth: media.depth,
    });

    lastUsedSourceId = media.sourceId;
  }

  return feed;
}

/**
 * Generate feed with pagination support
 * This is useful for infinite scroll implementations
 */
export function generatePaginatedFeed(
  db: Database.Database,
  page: number = 0,
  itemsPerPage: number = 20,
  lastSourceId?: string
): {
  items: FeedItem[];
  hasMore: boolean;
  page: number;
} {
  const feed = generateFeed(db, {
    limit: itemsPerPage + 1, // Fetch one extra to determine hasMore
    lastSourceId,
  });

  const hasMore = feed.length > itemsPerPage;
  const items = feed.slice(0, itemsPerPage);

  return {
    items,
    hasMore,
    page,
  };
}
