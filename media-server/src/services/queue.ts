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
import type { Readable } from 'stream';
import { config } from '../config.js';
import { isCached, writeToCache, localSource, evictIfNeeded } from './cache.js';

export const DownloadPriority = {
  NEAR: 5,
  FAR: 1,
} as const;

export type DownloadPriorityValue = (typeof DownloadPriority)[keyof typeof DownloadPriority];

const queue = new PQueue({ concurrency: config.downloadConcurrency });

const inFlight = new Set<string>(); // mediaIds currently being downloaded
const inFlightControllers = new Map<string, AbortController>(); // cancel handles for in-flight downloads
const done = new Set<string>(); // mediaIds successfully cached this session

/**
 * Enqueue a background cache-fill for `mediaId`.
 * No-ops if the file is already cached, in-flight, or has been done this session.
 *
 * `openSource` — returns a Readable of the plaintext bytes.
 *   Local: pass `localSource(mountPath)` from cache.ts
 *   Remote: pass `() => openRemoteRange(serverId, remotePath).then(r => r.stream)`
 */
export function enqueueDownload(
  mediaId: string,
  openSource: () => Promise<Readable> | Readable,
  priority: DownloadPriorityValue = DownloadPriority.FAR
): void {
  if (done.has(mediaId) || isCached(mediaId) || inFlight.has(mediaId)) return;

  inFlight.add(mediaId);

  queue.add(
    async () => {
      const ctrl = new AbortController();
      inFlightControllers.set(mediaId, ctrl);
      try {
        await writeToCache(openSource, mediaId, ctrl.signal);
        done.add(mediaId);
        // Run eviction asynchronously — don't block the queue slot.
        evictIfNeeded().catch((err) => console.warn('[queue] eviction error:', err));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.name !== 'AbortError') {
          console.warn(`[queue] cache-fill failed for ${mediaId}:`, err);
        }
      } finally {
        inFlight.delete(mediaId);
        inFlightControllers.delete(mediaId);
      }
    },
    { priority }
  );
}

/** Cancel all pending and in-flight downloads. Call when user navigates away. */
export function clearQueue(): void {
  queue.clear();
  for (const [mediaId, ctrl] of inFlightControllers) {
    ctrl.abort();
    inFlightControllers.delete(mediaId);
    inFlight.delete(mediaId);
  }
}

export function getQueueStatus() {
  return {
    pending: queue.size,
    inFlight: inFlight.size,
    done: done.size,
    concurrency: config.downloadConcurrency,
  };
}

// ── Live-read priority ──────────────────────────────────────────────────────
// A live (hover) stream must never wait behind a background cache-fill on the
// same single-lane remote. Pausing the queue blocks new fills from starting;
// aborting in-flight ones frees the lane immediately if one is already running.
// Aborted fills simply fall out of `inFlight` and can be re-queued later by the
// next /prefetch call. Counted so overlapping live requests don't resume early.
let liveActiveCount = 0;

export function acquireLiveLane(): void {
  liveActiveCount++;
  if (liveActiveCount === 1) {
    queue.pause();
    for (const ctrl of inFlightControllers.values()) ctrl.abort();
  }
}

export function releaseLiveLane(): void {
  liveActiveCount = Math.max(0, liveActiveCount - 1);
  if (liveActiveCount === 0) queue.start();
}
