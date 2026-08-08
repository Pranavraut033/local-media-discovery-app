#!/usr/bin/env node
/**
 * Resets the dev database: deletes the existing SQLite db (and WAL/SHM files),
 * re-runs migrations, and creates a default user with PIN 123456.
 * Usage: npm run reset-dev (from backend/)
 */

import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { runMigrations } from '../src/db/migrate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PIN = '123456';
const DEFAULT_NAME = 'Default';

const dbPath = process.env.DB_PATH || path.join(__dirname, '../media-discovery.db');

for (const suffix of ['', '-wal', '-shm']) {
  const filePath = `${dbPath}${suffix}`;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted ${filePath}`);
  }
}

const db = new Database(dbPath);

async function reset() {
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const pinHash = await bcrypt.hash(DEFAULT_PIN, 10);
    const userId = randomUUID();

    db.prepare('INSERT INTO users (id, pin_hash, name) VALUES (?, ?, ?)').run(
      userId,
      pinHash,
      DEFAULT_NAME
    );

    console.log('✅ Database reset and default user created');
    console.log(`User ID: ${userId}`);
    console.log(`Name: ${DEFAULT_NAME}`);
    console.log(`PIN: ${DEFAULT_PIN}`);
  } finally {
    db.close();
  }
}

reset();
