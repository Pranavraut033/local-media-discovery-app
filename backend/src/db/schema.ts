/**
 * Database schema initialization
 * Creates tables for sources and media
 */
import type Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
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

  console.log('Database schema initialized');
}

