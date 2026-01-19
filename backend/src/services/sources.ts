/**
 * Source Generation Service
 * Generates pseudo-user sources from top-level folders with deterministic names
 */
import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import fs from 'fs/promises';
import path from 'path';

// Word lists for generating display names
const ADJECTIVES = [
  'quiet', 'bright', 'gentle', 'swift', 'calm', 'bold', 'soft', 'warm',
  'cool', 'wild', 'free', 'wise', 'kind', 'pure', 'fair', 'deep',
  'high', 'true', 'still', 'dark', 'light', 'clear', 'fresh', 'rare',
  'grand', 'noble', 'quick', 'slow', 'sharp', 'smooth', 'rough', 'fine',
  'vast', 'tiny', 'sweet', 'sour', 'rich', 'poor', 'young', 'old',
  'new', 'ancient', 'modern', 'classic', 'simple', 'complex', 'plain', 'fancy',
];

const NOUNS = [
  'river', 'mountain', 'forest', 'ocean', 'valley', 'meadow', 'stream', 'lake',
  'peak', 'hill', 'grove', 'garden', 'field', 'prairie', 'canyon', 'cliff',
  'beach', 'island', 'desert', 'plain', 'ridge', 'coast', 'shore', 'bay',
  'harbor', 'pond', 'creek', 'brook', 'waterfall', 'spring', 'marsh', 'swamp',
  'wood', 'thicket', 'clearing', 'path', 'trail', 'road', 'bridge', 'stone',
  'boulder', 'rock', 'sand', 'earth', 'sky', 'cloud', 'wind', 'rain',
];

interface SourceInfo {
  id: string;
  folderPath: string;
  displayName: string;
  avatarSeed: string;
}

/**
 * Generate a stable ID from folder path
 */
function generateSourceId(folderPath: string): string {
  return createHash('sha256').update(folderPath).digest('hex').substring(0, 16);
}

/**
 * Generate a deterministic display name from folder path
 * Format: @adjective_noun
 */
function generateDisplayName(folderPath: string): string {
  const hash = createHash('sha256').update(folderPath).digest('hex');

  // Use hash to deterministically select words
  const adjIndex = parseInt(hash.substring(0, 8), 16) % ADJECTIVES.length;
  const nounIndex = parseInt(hash.substring(8, 16), 16) % NOUNS.length;

  const adjective = ADJECTIVES[adjIndex];
  const noun = NOUNS[nounIndex];

  return `@${adjective}_${noun}`;
}

/**
 * Generate an avatar seed for color/SVG generation
 */
function generateAvatarSeed(folderPath: string): string {
  const hash = createHash('sha256').update(folderPath).digest('hex');
  return hash.substring(0, 8);
}

/**
 * Get all top-level folders from root folder
 */
async function getTopLevelFolders(rootFolder: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootFolder, { withFileTypes: true });
    const folders: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        folders.push(path.join(rootFolder, entry.name));
      }
    }

    return folders;
  } catch (error) {
    console.error(`Error reading top-level folders from ${rootFolder}:`, error);
    return [];
  }
}

/**
 * Generate and store sources for top-level folders
 * Associates folders with the authenticated user
 */
export async function generateSources(
  db: Database.Database,
  rootFolder: string,
  userId?: string
): Promise<SourceInfo[]> {
  console.log(`Generating sources from: ${rootFolder}`);

  const topLevelFolders = await getTopLevelFolders(rootFolder);
  console.log(`Found ${topLevelFolders.length} top-level folders`);

  const sources: SourceInfo[] = [];
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO sources (id, folder_path, display_name, avatar_seed)
    VALUES (?, ?, ?, ?)
  `);
  
  const insertUserFolderStmt = userId
    ? db.prepare('INSERT OR IGNORE INTO user_folders (user_id, source_id) VALUES (?, ?)')
    : null;

  for (const folderPath of topLevelFolders) {
    const sourceId = generateSourceId(folderPath);
    const displayName = generateDisplayName(folderPath);
    const avatarSeed = generateAvatarSeed(folderPath);

    insertStmt.run(sourceId, folderPath, displayName, avatarSeed);
    
    // Associate folder with user if userId is provided
    if (userId && insertUserFolderStmt) {
      insertUserFolderStmt.run(userId, sourceId);
    }

    sources.push({
      id: sourceId,
      folderPath,
      displayName,
      avatarSeed,
    });
  }

  console.log(`Generated ${sources.length} sources`);

  return sources;
}

/**
 * Get source by ID
 */
export function getSourceById(db: Database.Database, sourceId: string): SourceInfo | null {
  const stmt = db.prepare('SELECT id, folder_path, display_name, avatar_seed FROM sources WHERE id = ?');
  const result = stmt.get(sourceId) as any;

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    folderPath: result.folder_path,
    displayName: result.display_name,
    avatarSeed: result.avatar_seed,
  };
}

/**
 * Get all sources
 * Optionally filter by user ID
 */
export function getAllSources(db: Database.Database, userId?: string): SourceInfo[] {
  let stmt;
  let results;
  
  if (userId) {
    stmt = db.prepare(`
      SELECT s.id, s.folder_path, s.display_name, s.avatar_seed 
      FROM sources s
      INNER JOIN user_folders uf ON s.id = uf.source_id
      WHERE uf.user_id = ?
    `);
    results = stmt.all(userId) as any[];
  } else {
    stmt = db.prepare('SELECT id, folder_path, display_name, avatar_seed FROM sources');
    results = stmt.all() as any[];
  }

  return results.map(r => ({
    id: r.id,
    folderPath: r.folder_path,
    displayName: r.display_name,
    avatarSeed: r.avatar_seed,
  }));
}

/**
 * Handle display name collisions by appending a suffix
 */
export function handleCollision(db: Database.Database, displayName: string): string {
  const existingNames = db
    .prepare('SELECT display_name FROM sources WHERE display_name LIKE ?')
    .all(`${displayName}%`)
    .map((r: any) => r.display_name);

  if (existingNames.length === 0) {
    return displayName;
  }

  // Find the next available suffix
  let suffix = 2;
  while (existingNames.includes(`${displayName}${suffix}`)) {
    suffix++;
  }

  return `${displayName}${suffix}`;
}
