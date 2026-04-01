#!/usr/bin/env node
/**
 * CLI script to create a user with a 6-digit PIN and name
 * Usage: node scripts/create-user.js <6-digit-pin> <name>
 */

import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/create-user.js <6-digit-pin> <name>');
  console.error('Example: node scripts/create-user.js 123456 Alice');
  process.exit(1);
}

const pin = args[0];
const name = args.slice(1).join(' ').trim();

// Validate PIN format
if (!/^\d{6}$/.test(pin)) {
  console.error('Error: PIN must be exactly 6 digits (0-9 only)');
  process.exit(1);
}

if (!name) {
  console.error('Error: name is required');
  process.exit(1);
}

// Initialize database
const dbPath = path.join(__dirname, '../media-discovery.db');
const db = new Database(dbPath);

async function createUser() {
  try {
    // Hash the PIN
    console.log('Hashing PIN...');
    const pinHash = await bcrypt.hash(pin, 10);
    
    const userId = randomUUID();
    
    // Insert user
    const stmt = db.prepare('INSERT INTO users (id, pin_hash, name) VALUES (?, ?, ?)');
    stmt.run(userId, pinHash, name);
    
    console.log('✅ User created successfully!');
    console.log(`User ID: ${userId}`);
    console.log(`Name: ${name}`);
    console.log(`PIN: ${pin} (keep this secure)`);
    
    // Check total users
    const count = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    console.log(`Total users in system: ${count.count}`);
    
  } catch (error: any) {
    console.error('❌ Error creating user:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

createUser();
