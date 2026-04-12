/**
 * Encrypted cache service.
 *
 * On-disk format:  [16-byte random IV][AES-256-CTR ciphertext]
 * Total file size = plaintext size + 16.
 *
 * AES-256-CTR is chosen specifically because it supports seekable decryption:
 * to decrypt bytes [start, end] we only need to advance the counter by
 * Math.floor(start / 16) blocks — no need to decrypt earlier ciphertext.
 * This is essential for efficient HTTP range-request serving.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { pipeline } from 'stream/promises';
import { Transform, type Readable } from 'stream';
import { config } from '../config.js';
import { getEncryptionKey } from './keystore.js';

export interface CachedFileInfo {
  cachePath: string;
  plaintextSize: number;
  iv: Buffer;
}

export function getCachePath(mediaId: string): string {
  return path.join(config.cacheDir, `${mediaId}.enc`);
}

export function isCached(mediaId: string): boolean {
  return fs.existsSync(getCachePath(mediaId));
}

export function ensureCacheDir(): void {
  fs.mkdirSync(config.cacheDir, { recursive: true });
}

/**
 * Read the IV and derive the plaintext size from a cached file's stat.
 * Returns null if the file doesn't exist or is corrupted (< 16 bytes).
 */
export async function getCachedFileInfo(mediaId: string): Promise<CachedFileInfo | null> {
  const cachePath = getCachePath(mediaId);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(cachePath);
  } catch {
    return null;
  }
  if (stat.size < 17) return null; // At minimum: 16-byte IV + 1 byte of data

  const fd = await fsp.open(cachePath, 'r');
  try {
    const ivBuf = Buffer.allocUnsafe(16);
    await fd.read(ivBuf, 0, 16, 0);
    return { cachePath, plaintextSize: stat.size - 16, iv: ivBuf };
  } finally {
    await fd.close();
  }
}

/**
 * Increment a 16-byte buffer treated as a big-endian 128-bit unsigned integer.
 * Used to advance the AES-CTR counter to a specific block index for seeking.
 */
function incrementCounter(iv: Buffer, n: bigint): Buffer {
  const result = Buffer.from(iv);
  let carry = n;
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    carry += BigInt(result[i]);
    result[i] = Number(carry & 0xffn);
    carry >>= 8n;
  }
  return result;
}

/**
 * Returns a Transform stream that discards the first `skipBytes` bytes,
 * then passes everything else through unchanged.
 * Used to align playback to a mid-block starting offset.
 */
function skipBytesTransform(skipBytes: number): Transform {
  let skipped = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      if (skipped >= skipBytes) {
        this.push(chunk);
        callback();
        return;
      }
      const remaining = skipBytes - skipped;
      if (chunk.length <= remaining) {
        skipped += chunk.length;
        // discard entire chunk — still within alignment region
      } else {
        skipped = skipBytes;
        this.push(chunk.subarray(remaining));
      }
      callback();
    },
  });
}

/**
 * Create a readable stream of decrypted bytes for the range [start, end]
 * (inclusive, 0-indexed plaintext offsets).
 *
 * For a full-file serve: start=0, end=plaintextSize-1.
 */
export function createDecryptRangeStream(info: CachedFileInfo, start: number, end: number): Readable {
  const key = getEncryptionKey();
  const blockIdx = BigInt(Math.floor(start / 16));
  const alignOffset = start % 16;

  const seekIv = incrementCounter(info.iv, blockIdx);
  const decipher = createDecipheriv('aes-256-ctr', key, seekIv);

  // File offsets: IV occupies first 16 bytes on disk.
  const fileStart = 16 + Number(blockIdx) * 16;
  const fileEnd = 16 + end; // inclusive

  const fileStream = fs.createReadStream(info.cachePath, { start: fileStart, end: fileEnd });

  if (alignOffset === 0) {
    fileStream.pipe(decipher);
    return decipher;
  }

  const skip = skipBytesTransform(alignOffset);
  fileStream.pipe(decipher).pipe(skip);
  return skip;
}

/**
 * Download `sourcePath` from the rclone VFS mount, encrypt it with AES-256-CTR,
 * and store it atomically in the cache.
 *
 * Atomic: written to `.tmp` first, then renamed. A crash mid-write leaves
 * only a `.tmp` file which is never served.
 */
export async function writeToCache(sourcePath: string, mediaId: string): Promise<void> {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cachePath = getCachePath(mediaId);
  const tmpPath = `${cachePath}.tmp`;

  ensureCacheDir();

  const src = fs.createReadStream(sourcePath);
  const cipher = createCipheriv('aes-256-ctr', key, iv);
  const dest = fs.createWriteStream(tmpPath);

  // Write the IV as the first 16 bytes of the file.
  await new Promise<void>((resolve, reject) => {
    dest.write(iv, (err) => (err ? reject(err) : resolve()));
  });

  try {
    await pipeline(src, cipher, dest);
    await fsp.rename(tmpPath, cachePath);
  } catch (err) {
    // Clean up the partial temp file on failure.
    await fsp.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Evict the oldest-accessed files from the cache until the total size is
 * below `config.cacheMaxGb`. Runs after each successful download.
 */
export async function evictIfNeeded(): Promise<void> {
  const maxBytes = config.cacheMaxGb * 1024 ** 3;

  let entries: Array<{ file: string; size: number; atime: number }>;
  try {
    const files = await fsp.readdir(config.cacheDir);
    entries = await Promise.all(
      files
        .filter((f) => f.endsWith('.enc'))
        .map(async (f) => {
          const full = path.join(config.cacheDir, f);
          const s = await fsp.stat(full);
          return { file: full, size: s.size, atime: s.atimeMs };
        })
    );
  } catch {
    return; // Cache dir might not exist yet
  }

  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
  if (totalBytes <= maxBytes) return;

  // Sort oldest-accessed first.
  entries.sort((a, b) => a.atime - b.atime);

  let freed = 0;
  const toFree = totalBytes - maxBytes;
  for (const entry of entries) {
    if (freed >= toFree) break;
    await fsp.unlink(entry.file).catch(() => undefined);
    freed += entry.size;
  }
}
