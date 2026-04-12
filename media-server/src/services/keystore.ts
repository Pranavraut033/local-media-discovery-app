/**
 * Keystore: auto-generates and persists the AES-256 encryption key for the
 * media cache. The key is written as a 64-character hex string to a file with
 * mode 0600 (owner-read-only). If the keyfile is deleted, all existing cached
 * files become unreadable and will be re-downloaded on next access.
 */
import fs from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { config } from '../config.js';

let encryptionKey: Buffer | null = null;

export function loadOrCreateKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  const keyfilePath = config.keyfilePath;

  if (fs.existsSync(keyfilePath)) {
    const raw = fs.readFileSync(keyfilePath, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/i.test(raw)) {
      throw new Error(`Keyfile at ${keyfilePath} is malformed — expected 64 hex chars. Delete it to auto-generate a new key.`);
    }
    encryptionKey = Buffer.from(raw, 'hex');
    return encryptionKey;
  }

  // First start: generate a fresh key.
  const key = randomBytes(32);
  const keyDir = path.dirname(keyfilePath);
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }
  fs.writeFileSync(keyfilePath, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  console.log(`[keystore] Generated new encryption key → ${keyfilePath}`);

  encryptionKey = key;
  return encryptionKey;
}

export function getEncryptionKey(): Buffer {
  if (!encryptionKey) throw new Error('Keystore not initialised — call loadOrCreateKey() at startup');
  return encryptionKey;
}
