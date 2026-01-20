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
  userId?: string; // User ID for scoped interactions
  sourceId?: string; // Optional source filtering
}

export function generateFeed(db: Database.Database, options: FeedOptions = {}): FeedItem[] {
  const {
    limit = 20,
    offset = 0,
    lastSourceId,
    userId,
    sourceId,
  } = options;

  // Build query to join media with sources and user interactions
  let query = `
    SELECT 
      m.id,
      m.path,
      m.type,
      m.source_id as sourceId,
      m.depth,
      m.created_at as createdAt,
      s.display_name as displayName,
      s.avatar_seed as avatarSeed,
      COALESCE(ui.liked, 0) as liked,
      COALESCE(ui.saved, 0) as saved,
      COALESCE(ui.hidden, 0) as hidden,
      COALESCE(ui.view_count, 0) as viewCount,
      ui.last_viewed as lastViewed
    FROM media m
    JOIN sources s ON m.source_id = s.id
    LEFT JOIN user_interactions ui ON m.id = ui.media_id 
      AND m.source_id = ui.source_id
      ${userId ? 'AND ui.user_id = ?' : ''}
    WHERE COALESCE(ui.hidden, 0) = 0
    ${sourceId ? 'AND m.source_id = ?' : ''}
  `;

  if (userId) {
    // Filter to user's folders
    query += ` AND m.source_id IN (
      SELECT source_id FROM user_folders WHERE user_id = ?
    )`;

    // Exclude media from hidden subfolders
    query += ` AND NOT EXISTS (
      SELECT 1 FROM user_hidden_folders uhf
      WHERE uhf.user_id = ?
        AND uhf.source_id = m.source_id
        AND uhf.hidden = 1
        AND (m.path LIKE uhf.folder_path || '/%' OR m.path = uhf.folder_path)
    )`;
  }

  query += ' ORDER BY m.created_at ASC';

  const params: string[] = [];
  if (userId) {
    params.push(userId);
    if (sourceId) {
      params.push(sourceId);
    }
    params.push(userId);
    params.push(userId); // For hidden folders check
  } else if (sourceId) {
    params.push(sourceId);
  }

  const allMedia = db.prepare(query).all(...params) as Array<{
    id: string;
    path: string;
    type: string;
    sourceId: string;
    liked: number;
    saved: number;
    hidden: number;
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
  lastSourceId?: string,
  userId?: string,
  sourceId?: string
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
  });

  const hasMore = feed.length > itemsPerPage;
  const items = feed.slice(0, itemsPerPage);

  return {
    items,
    hasMore,
    page,
  };
}
