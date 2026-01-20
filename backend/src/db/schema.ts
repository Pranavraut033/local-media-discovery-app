/**
 * Database schema initialization
 * Creates tables for sources and media
 */
import type Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  // Temporarily disable foreign keys during schema setup
  db.pragma('foreign_keys = OFF');

  // Users table - represents authenticated users with PIN
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Sources table - represents top-level folders as pseudo users
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_seed TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_sources_folder ON sources(folder_path);
  `);

  // Media table - all indexed media files - create table without the hidden column reference initially
  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      source_id TEXT NOT NULL,
      depth INTEGER NOT NULL,
      type TEXT NOT NULL,
      liked INTEGER NOT NULL DEFAULT 0,
      saved INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      last_viewed INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_media_path ON media(path);
    CREATE INDEX IF NOT EXISTS idx_media_source ON media(source_id);
    CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
    CREATE INDEX IF NOT EXISTS idx_media_liked ON media(liked);
    CREATE INDEX IF NOT EXISTS idx_media_saved ON media(saved);
    CREATE INDEX IF NOT EXISTS idx_media_last_viewed ON media(last_viewed);
  `);

  // Migration: Add hidden column if it doesn't exist (for existing databases)
  try {
    db.prepare('ALTER TABLE media ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0').run();
  } catch (error: any) {
    // Column already exists, ignore error
    if (!error.message.includes('duplicate column')) {
      throw error;
    }
  }

  // Create hidden index
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_media_hidden ON media(hidden)').run();
  } catch (error: any) {
    // Index might already exist, ignore
  }

  // User-folder associations - links folders to users
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_folders (
      user_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (user_id, source_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_folders_user ON user_folders(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_folders_source ON user_folders(source_id);
  `);

  // User interactions - user-specific and folder-scoped interactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_interactions (
      user_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      liked INTEGER NOT NULL DEFAULT 0,
      saved INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      last_viewed INTEGER,
      PRIMARY KEY (user_id, source_id, media_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (source_id) REFERENCES sources(id),
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_interactions_user ON user_interactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_interactions_source ON user_interactions(source_id);
    CREATE INDEX IF NOT EXISTS idx_user_interactions_media ON user_interactions(media_id);
    CREATE INDEX IF NOT EXISTS idx_user_interactions_liked ON user_interactions(liked);
    CREATE INDEX IF NOT EXISTS idx_user_interactions_saved ON user_interactions(saved);
    CREATE INDEX IF NOT EXISTS idx_user_interactions_hidden ON user_interactions(hidden);
  `);

  // User hidden folders - tracks which subfolders each user has hidden
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_hidden_folders (
      user_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (user_id, source_id, folder_path),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (source_id) REFERENCES sources(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_hidden_folders_user ON user_hidden_folders(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_hidden_folders_source ON user_hidden_folders(source_id);
    CREATE INDEX IF NOT EXISTS idx_user_hidden_folders_path ON user_hidden_folders(folder_path);
  `);

  // Migrate existing data to default user
  migrateToUserScoped(db);

  // Re-enable foreign keys after schema setup
  db.pragma('foreign_keys = ON');

  console.log('Database schema initialized');
}

/**
 * Migrate existing data to user-scoped model
 * Creates a default user and associates all existing folders and interactions with it
 */
function migrateToUserScoped(db: Database.Database): void {
  const defaultUserId = 'default-user';

  // Check if default user already exists
  const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(defaultUserId);

  if (!existingUser) {
    console.log('Migrating existing data to user-scoped model...');

    // Create default user (with a placeholder hash that can be updated later)
    db.prepare('INSERT INTO users (id, pin_hash) VALUES (?, ?)').run(
      defaultUserId,
      '$2b$10$placeholder' // This should be updated via CLI script
    );

    // Associate all existing sources with default user
    const sources = db.prepare('SELECT id FROM sources').all() as Array<{ id: string }>;
    const insertUserFolder = db.prepare('INSERT OR IGNORE INTO user_folders (user_id, source_id) VALUES (?, ?)');

    for (const source of sources) {
      insertUserFolder.run(defaultUserId, source.id);
    }

    // Migrate media interactions to user_interactions table
    const mediaItems = db.prepare(`
      SELECT id, source_id, liked, saved, hidden, view_count, last_viewed 
      FROM media 
      WHERE liked = 1 OR saved = 1 OR hidden = 1 OR view_count > 0
    `).all() as Array<{
      id: string;
      source_id: string;
      liked: number;
      saved: number;
      hidden: number;
      view_count: number;
      last_viewed: number | null;
    }>;

    const insertInteraction = db.prepare(`
      INSERT OR IGNORE INTO user_interactions (user_id, source_id, media_id, liked, saved, hidden, view_count, last_viewed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const media of mediaItems) {
      insertInteraction.run(
        defaultUserId,
        media.source_id,
        media.id,
        media.liked,
        media.saved,
        media.hidden,
        media.view_count,
        media.last_viewed
      );
    }

    console.log(`Migrated ${sources.length} folders and ${mediaItems.length} interactions to default user`);
  }
}

