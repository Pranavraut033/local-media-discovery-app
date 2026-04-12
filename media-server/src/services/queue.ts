/**
 * Priority download queue.
 *
 * Controls the rate of reads from the rclone VFS mount so that background
 * cache-fill downloads never starve active playback requests.
 *
 * Priority tiers (higher number = served first by p-queue):
 *   NEAR  (5) — the 3–5 items immediately ahead of the user's scroll position
 *   FAR   (1) — the rest of the prefetch window
 *
 * Live playback streams are served directly from the mount path (POSIX file
 * read) and are NOT queued — they get data immediately regardless of queue
 * state.
 */
import PQueue from 'p-queue';
import { config } from '../config.js';
import { isCached, writeToCache, evictIfNeeded } from './cache.js';

export const DownloadPriority = {
  NEAR: 5,
  FAR: 1,
} as const;

export type DownloadPriorityValue = (typeof DownloadPriority)[keyof typeof DownloadPriority];

const queue = new PQueue({ concurrency: config.downloadConcurrency });

const inFlight = new Set<string>(); // mediaIds currently being downloaded
const done = new Set<string>(); // mediaIds successfully cached this session

/**
 * Enqueue a background cache-fill for `mediaId`.
 * No-ops if the file is already cached, in-flight, or has been done this session.
 */
export function enqueueDownload(
  mediaId: string,
  sourcePath: string,
  priority: DownloadPriorityValue = DownloadPriority.FAR
): void {
  if (done.has(mediaId) || isCached(mediaId) || inFlight.has(mediaId)) return;

  inFlight.add(mediaId);

  queue.add(
    async () => {
      try {
        await writeToCache(sourcePath, mediaId);
        done.add(mediaId);
        // Run eviction asynchronously — don't block the queue slot.
        evictIfNeeded().catch((err) => console.warn('[queue] eviction error:', err));
      } catch (err) {
        console.warn(`[queue] cache-fill failed for ${mediaId}:`, err);
      } finally {
        inFlight.delete(mediaId);
      }
    },
    { priority }
  );
}

export function getQueueStatus() {
  return {
    pending: queue.size,
    inFlight: inFlight.size,
    done: done.size,
    concurrency: config.downloadConcurrency,
  };
}
