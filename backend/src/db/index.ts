/**
 * Database connection and initialization with SQL migrations
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../media-discovery.db');
    db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Enable foreign key constraints
    db.pragma('foreign_keys = ON');

    // Performance tuning
    db.pragma('cache_size = -65536');   // 64 MB page cache (negative = kibibytes)
    db.pragma('synchronous = NORMAL'); // fsync only at WAL checkpoints, not every write
    db.pragma('temp_store = MEMORY');  // keep temp tables/indexes in RAM
    db.pragma('mmap_size = 268435456'); // 256 MB memory-mapped I/O

    runMigrations(db);
  }

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
