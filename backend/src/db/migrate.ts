import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function applyMigration(db: Database.Database, fileName: string): void {
  const sqlPath = path.join(MIGRATIONS_DIR, fileName);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const tx = db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(fileName);
  });

  tx();
}

export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db);

  const files = listMigrationFiles();
  if (files.length === 0) {
    return;
  }

  const appliedRows = db
    .prepare('SELECT name FROM schema_migrations')
    .all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((row) => row.name));

  for (const file of files) {
    if (!applied.has(file)) {
      applyMigration(db, file);
      // Keep startup logs short but explicit for migration progress.
      console.log(`[db:migrate] applied ${file}`);
    }
  }
}

function runFromCli(): void {
  const dbPath = path.join(__dirname, '../../media-discovery.db');
  const db = new Database(dbPath);

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    console.log('[db:migrate] done');
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFromCli();
}
