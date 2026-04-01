/**
 * Thumbnail Generation Service
 * Generates and caches thumbnails for images and videos using sharp and ffmpeg
 */
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { config } from '../config.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { readRemoteFile } from './rclone.js';

// Set ffmpeg path for fluent-ffmpeg
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
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
   * Check if a path is a rclone path
   */
  private isRclonePath(mediaPath: string): boolean {
    return mediaPath.startsWith('rclone:');
  }

  /**
   * Fetch file from rclone or local filesystem
   */
  private async getFileBuffer(mediaPath: string): Promise<Buffer> {
    if (this.isRclonePath(mediaPath)) {
      return await readRemoteFile(mediaPath);
    } else {
      return await fs.readFile(mediaPath);
    }
  }

  /**
   * Generate MD5 hash of file for cache validation (handles both local and rclone)
   */
  private async getFileHash(filePath: string): Promise<string> {
    try {
      if (this.isRclonePath(filePath)) {
        // For rclone files, use file path as hash (since we can't easily get mtime)
        // In production, consider using rclone's lsjson to get ModTime
        return crypto.createHash('md5').update(filePath).digest('hex').substring(0, 16);
      } else {
        const stats = await fs.stat(filePath);
        // Use file size + modification time as quick hash
        return `${stats.size}-${stats.mtimeMs}`;
      }
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
    thumbnailPath: string
  ): Promise<void> {
    try {
      if (this.isRclonePath(mediaPath)) {
        // For rclone paths, read buffer and pass to sharp
        const buffer = await this.getFileBuffer(mediaPath);
        await sharp(buffer)
          .resize(config.thumbnails.width, config.thumbnails.height, {
            fit: 'cover',
            position: 'center',
          })
          .webp({ quality: config.thumbnails.quality })
          .toFile(thumbnailPath);
      } else {
        // For local paths, use direct path
        await sharp(mediaPath)
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
   * Generate thumbnail for video (extract first frame) - handles both local and rclone paths
   */
  private async generateVideoThumbnail(
    mediaPath: string,
    thumbnailPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const processVideo = (input: string | Readable) => {
        ffmpeg(input)
          .screenshots({
            count: 1,
            folder: this.thumbnailDir,
            filename: `${path.basename(thumbnailPath, '.webp')}.png`,
            size: `${config.thumbnails.width}x${config.thumbnails.height}`,
            timestamps: ['1%'], // Get first frame (1% into video)
          })
          .on('end', async () => {
            try {
              // Convert PNG to WebP for consistency
              const pngPath = path.join(
                this.thumbnailDir,
                `${path.basename(thumbnailPath, '.webp')}.png`
              );
              await sharp(pngPath)
                .webp({ quality: config.thumbnails.quality })
                .toFile(thumbnailPath);
              // Clean up PNG
              await fs.unlink(pngPath);
              resolve();
            } catch (error) {
              reject(error);
            }
          })
          .on('error', (error) => {
            console.error(`FFmpeg error for ${mediaPath}:`, error);
            reject(error);
          });
      };

      if (this.isRclonePath(mediaPath)) {
        // For rclone paths, read buffer and convert to readable stream
        this.getFileBuffer(mediaPath)
          .then((buffer) => {
            const stream = Readable.from(buffer);
            processVideo(stream);
          })
          .catch(reject);
      } else {
        // For local paths, use path directly
        processVideo(mediaPath);
      }
    });
  }

  /**
   * Generate or retrieve cached thumbnail
   */
  async getThumbnail(
    mediaId: string,
    mediaPath: string,
    mediaType: 'image' | 'video'
  ): Promise<string> {
    const thumbnailPath = this.getThumbnailPath(mediaId);

    // Check if thumbnail exists in cache and is valid
    const cached = this.cache.get(mediaId);
    if (cached) {
      try {
        const currentHash = await this.getFileHash(mediaPath);
        if (cached.hash === currentHash) {
          // Check if thumbnail file exists
          await fs.access(cached.path);
          return cached.path;
        }
      } catch (error) {
        // Cache is invalid, regenerate
        this.cache.delete(mediaId);
      }
    }

    // Generate new thumbnail
    try {
      if (mediaType === 'image') {
        await this.generateImageThumbnail(mediaPath, thumbnailPath);
      } else {
        await this.generateVideoThumbnail(mediaPath, thumbnailPath);
      }

      // Update cache
      const hash = await this.getFileHash(mediaPath);
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
