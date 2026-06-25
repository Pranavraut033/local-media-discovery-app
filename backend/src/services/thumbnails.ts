/**
 * Thumbnail Generation Service
 * Generates and caches thumbnails for images and videos using sharp and ffmpeg
 */
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from '@ffmpeg-installer/ffmpeg';
import ffprobeStatic from '@ffprobe-installer/ffprobe';
import { config } from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getDatabase } from '../db/index.js';
import { getServerById } from './remote/servers-db.js';
import { getRcdClient } from './rclone-rcd.js';
import { fetchWebdavFile } from './remote/webdav.provider.js';

export type StorageMode = 'local' | 'rclone' | 'webdav';

// Set ffmpeg/ffprobe paths so fluent-ffmpeg uses the bundled binaries
// rather than requiring system-level installations.
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath((ffmpegStatic as any).path || ffmpegStatic);
}
if (ffprobeStatic) {
  ffmpeg.setFfprobePath((ffprobeStatic as any).path || ffprobeStatic);
}

interface ThumbnailCache {
  mediaId: string;
  path: string;
  type: 'image' | 'video';
  generatedAt: number;
  hash: string; // Hash of source file for cache invalidation
}

class ThumbnailService {
  private readonly thumbnailDir: string;
  private readonly cacheFile: string;
  private cache: Map<string, ThumbnailCache> = new Map();

  constructor(thumbnailDir: string = './.thumbnails') {
    this.thumbnailDir = thumbnailDir;
    this.cacheFile = path.join(this.thumbnailDir, 'cache.json');
  }

  /**
   * Initialize thumbnail directory and load cache
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.thumbnailDir, { recursive: true });
      await this.loadCache();
      console.log(`Thumbnail service initialized at ${this.thumbnailDir}`);
    } catch (error) {
      console.error('Failed to initialize thumbnail service:', error);
      throw error;
    }
  }

  /**
   * Load cache from disk
   */
  private async loadCache(): Promise<void> {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const cacheArray = JSON.parse(data) as ThumbnailCache[];
      this.cache = new Map(cacheArray.map((item) => [item.mediaId, item]));
      console.log(`Loaded ${this.cache.size} cached thumbnails`);
    } catch (error) {
      // Cache file doesn't exist yet, start with empty cache
      this.cache = new Map();
    }
  }

  /**
   * Save cache to disk
   */
  private async saveCache(): Promise<void> {
    try {
      const cacheArray = Array.from(this.cache.values());
      await fs.writeFile(this.cacheFile, JSON.stringify(cacheArray, null, 2));
    } catch (error) {
      console.error('Failed to save thumbnail cache:', error);
    }
  }

  /**
   * Fetch file bytes — local filesystem read, or remote fetch via rcd (rclone)
   * / authenticated GET (webdav), keyed by the file's stored storage_mode.
   */
  private async getFileBuffer(
    mediaPath: string,
    storageMode: StorageMode,
    serverId: string | null
  ): Promise<Buffer> {
    if (storageMode === 'local') {
      return await fs.readFile(mediaPath);
    }

    if (storageMode === 'rclone') {
      const client = getRcdClient();
      if (!client) throw new Error('rcd sidecar not ready — cannot fetch remote file');
      return await client.fetchFile(mediaPath);
    }

    // webdav
    if (!serverId) throw new Error(`webdav file ${mediaPath} is missing serverId`);
    const server = getServerById(getDatabase(), serverId);
    if (!server) throw new Error(`Remote server ${serverId} not found`);
    return await fetchWebdavFile(server.connection, mediaPath);
  }

  /**
   * Generate MD5 hash of file for cache validation (handles both local and remote)
   */
  private async getFileHash(filePath: string, storageMode: StorageMode): Promise<string> {
    try {
      if (storageMode !== 'local') {
        // Remote files: use the path as the hash (no cheap mtime available
        // without an extra round-trip) — cache invalidates only if the path changes.
        return crypto.createHash('md5').update(filePath).digest('hex').substring(0, 16);
      }
      const stats = await fs.stat(filePath);
      // Use file size + modification time as quick hash
      return `${stats.size}-${stats.mtimeMs}`;
    } catch (error) {
      console.error(`Failed to hash file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get thumbnail filename for a media ID
   */
  private getThumbnailPath(mediaId: string): string {
    return path.join(this.thumbnailDir, `${mediaId}.webp`);
  }

  /**
   * Generate thumbnail for image (handles both local and rclone paths)
   */
  private async generateImageThumbnail(
    mediaPath: string,
    thumbnailPath: string,
    storageMode: StorageMode,
    serverId: string | null
  ): Promise<void> {
    try {
      if (storageMode === 'local') {
        // For local paths, use direct path
        await sharp(mediaPath)
          .resize(config.thumbnails.width, config.thumbnails.height, {
            fit: 'cover',
            position: 'center',
          })
          .webp({ quality: config.thumbnails.quality })
          .toFile(thumbnailPath);
      } else {
        // For remote paths, read buffer and pass to sharp
        const buffer = await this.getFileBuffer(mediaPath, storageMode, serverId);
        await sharp(buffer)
          .resize(config.thumbnails.width, config.thumbnails.height, {
            fit: 'cover',
            position: 'center',
          })
          .webp({ quality: config.thumbnails.quality })
          .toFile(thumbnailPath);
      }
    } catch (error) {
      console.error(`Failed to generate image thumbnail for ${mediaPath}:`, error);
      throw error;
    }
  }

  /**
   * Generate thumbnail for video (extract first frame) - handles both local and rclone paths.
   * Pipes ffmpeg mjpeg output directly to sharp — no PNG temp file.
   *
   * Remote files are written to a temp file rather than piped to ffmpeg's stdin:
   * MP4s without a "fast start" moov atom require ffmpeg to seek the input, which
   * a stdin pipe can't do ("Invalid data found when processing input").
   */
  private async generateVideoThumbnail(
    mediaPath: string,
    thumbnailPath: string,
    storageMode: StorageMode,
    serverId: string | null
  ): Promise<void> {
    let tempFile: string | null = null;
    try {
      let input = mediaPath;
      if (storageMode !== 'local') {
        const buffer = await this.getFileBuffer(mediaPath, storageMode, serverId);
        tempFile = path.join(os.tmpdir(), `thumb-src-${crypto.randomUUID()}${path.extname(mediaPath) || '.mp4'}`);
        await fs.writeFile(tempFile, buffer);
        input = tempFile;
      }

      await new Promise<void>((resolve, reject) => {
        const sharpPipeline = sharp()
          .resize(config.thumbnails.width, config.thumbnails.height, {
            fit: 'cover',
            position: 'center',
          })
          .webp({ quality: config.thumbnails.quality });

        sharpPipeline.toFile(thumbnailPath).then(() => resolve()).catch(reject);

        ffmpeg(input)
          .frames(1)
          .format('mjpeg')
          .on('error', (err) => {
            console.error(`FFmpeg error for ${mediaPath}:`, err);
            reject(err);
          })
          .pipe(sharpPipeline);
      });
    } finally {
      if (tempFile) await fs.unlink(tempFile).catch(() => {});
    }
  }

  /**
   * Generate or retrieve cached thumbnail
   */
  async getThumbnail(
    mediaId: string,
    mediaPath: string,
    mediaType: 'image' | 'video',
    storageMode: StorageMode = 'local',
    serverId: string | null = null
  ): Promise<string> {
    const thumbnailPath = this.getThumbnailPath(mediaId);

    // ponytail: skip getFileHash on cache hit — source files don't change in place on this app.
    // Only verify the .webp still exists on disk; regenerate if missing.
    const cached = this.cache.get(mediaId);
    if (cached) {
      try {
        await fs.access(cached.path);
        return cached.path;
      } catch {
        this.cache.delete(mediaId);
      }
    }

    // Generate new thumbnail
    try {
      if (mediaType === 'image') {
        await this.generateImageThumbnail(mediaPath, thumbnailPath, storageMode, serverId);
      } else {
        await this.generateVideoThumbnail(mediaPath, thumbnailPath, storageMode, serverId);
      }

      // Update cache
      const hash = await this.getFileHash(mediaPath, storageMode);
      const cacheEntry: ThumbnailCache = {
        mediaId,
        path: thumbnailPath,
        type: mediaType,
        generatedAt: Date.now(),
        hash,
      };
      this.cache.set(mediaId, cacheEntry);
      await this.saveCache();

      return thumbnailPath;
    } catch (error) {
      console.error(`Failed to generate thumbnail for ${mediaPath}:`, error);
      throw error;
    }
  }

  /**
   * Clear cache and regenerate all thumbnails (expensive operation)
   */
  async clearCache(): Promise<void> {
    try {
      this.cache.clear();
      const files = await fs.readdir(this.thumbnailDir);
      for (const file of files) {
        if (file !== 'cache.json') {
          await fs.unlink(path.join(this.thumbnailDir, file));
        }
      }
      await this.saveCache();
      console.log('Thumbnail cache cleared');
    } catch (error) {
      console.error('Failed to clear thumbnail cache:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalCached: number;
    cacheDir: string;
    cacheSize: number;
  } {
    return {
      totalCached: this.cache.size,
      cacheDir: this.thumbnailDir,
      cacheSize: this.cache.size, // Rough estimate
    };
  }
}

// Singleton instance
let thumbnailService: ThumbnailService | null = null;

/**
 * Get or create thumbnail service instance
 */
export function getThumbnailService(
  thumbnailDir?: string
): ThumbnailService {
  if (!thumbnailService) {
    thumbnailService = new ThumbnailService(thumbnailDir);
  }
  return thumbnailService;
}

/**
 * Initialize thumbnail service
 */
export async function initThumbnailService(
  thumbnailDir?: string
): Promise<ThumbnailService> {
  const service = getThumbnailService(thumbnailDir);
  await service.init();
  return service;
}
