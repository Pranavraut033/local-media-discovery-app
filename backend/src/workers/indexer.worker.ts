/**
 * Indexing Worker
 * Processes indexing jobs for both local and rclone sources.
 * Implements pending-first + hash-finalization pipeline.
 */
import { type IndexingJobData, registerIndexingProcessor } from '../queue/index.js';
import { sseEventBus } from '../queue/events.js';
import { getDatabase } from '../db/index.js';
import {
  discoverAndCreatePendingLocal,
  finalizeLocalPendingFiles,
} from '../services/indexer.js';
import {
  discoverAndCreatePendingRclone,
  finalizeRclonePendingFiles,
  indexRcloneFilesStreaming,
} from '../services/rclone-indexer.js';
import { indexRemoteFilesStreaming } from '../services/remote/indexer.js';
import { getServerById } from '../services/remote/servers-db.js';
import { invalidateFeedCache } from '../services/feed.js';

async function processJob(data: IndexingJobData): Promise<void> {
  const { jobId, userId, type } = data;
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  // Update job status to processing
  db.prepare(
    `UPDATE indexing_jobs SET status = 'processing', updated_at = ? WHERE id = ?`
  ).run(now, jobId);

  sseEventBus.emit(userId, { type: 'job_started', jobId });

  try {
    if (type === 'local') {
      const { rootFolder } = data;
      if (!rootFolder) throw new Error('rootFolder required for local job');

      // Phase 1: fast discovery – creates pending records per directory as they are scanned
      const pending = await discoverAndCreatePendingLocal(db, rootFolder, userId, jobId, (foldersScanned, filesFound) => {
        sseEventBus.emit(userId, {
          type: 'scan_progress',
          jobId,
          payload: { foldersScanned, filesFound },
        });
      });

      // Scan complete — update total count and signal UI to transition to hashing stage
      db.prepare(
        `UPDATE indexing_jobs SET total_files = ?, updated_at = ? WHERE id = ?`
      ).run(pending.length, now, jobId);
      sseEventBus.emit(userId, {
        type: 'job_progress',
        jobId,
        payload: { stage: 'discovery', filesFound: pending.length },
      });

      // Phase 2: hash each pending file and finalize.
      // The SSE event fires per file (the frontend needs each temp→final ID to
      // reconcile its feed), but the indexing_jobs row is only written every
      // PROGRESS_PERSIST_EVERY files (and once at the end) to avoid a DB write
      // per file during fast parallel hashing.
      const PROGRESS_PERSIST_EVERY = 25;
      await finalizeLocalPendingFiles(db, pending, userId, jobId, (done, total, fileId, finalId) => {
        sseEventBus.emit(userId, {
          type: 'file_hashed',
          jobId,
          payload: { done, total, tempId: fileId, finalId },
        });
        if (done % PROGRESS_PERSIST_EVERY === 0 || done === total) {
          db.prepare(
            `UPDATE indexing_jobs SET processed_files = ?, updated_at = ? WHERE id = ?`
          ).run(done, Math.floor(Date.now() / 1000), jobId);
        }
      });
    } else if (type === 'remote') {
      // Generic remote provider path (rclone via rcd, webdav, …)
      const { serverId, remotePath } = data;
      if (!serverId || remotePath === undefined) throw new Error('serverId and remotePath required for remote job');

      const server = getServerById(db, serverId);
      if (!server) throw new Error(`Remote server not found: ${serverId}`);

      const indexedCount = await indexRemoteFilesStreaming(
        db, server, remotePath, userId, jobId,
        (count) => {
          db.prepare(`UPDATE indexing_jobs SET total_files = ?, updated_at = ? WHERE id = ?`).run(count, Math.floor(Date.now() / 1000), jobId);
          sseEventBus.emit(userId, { type: 'job_progress', jobId, payload: { stage: 'discovery', filesFound: count } });
        },
        (done, total) => {
          db.prepare(`UPDATE indexing_jobs SET processed_files = ?, updated_at = ? WHERE id = ?`).run(done, Math.floor(Date.now() / 1000), jobId);
          sseEventBus.emit(userId, { type: 'file_hashed', jobId, payload: { done, total } });
        }
      );
      db.prepare(`UPDATE indexing_jobs SET total_files = ?, processed_files = ?, updated_at = ? WHERE id = ?`)
        .run(indexedCount, indexedCount, Math.floor(Date.now() / 1000), jobId);

    } else {
      // Legacy rclone via FUSE mount subprocess (type === 'rclone')
      const { remoteName, basePath, remoteType } = data;
      if (!remoteName || basePath === undefined) throw new Error('remoteName and basePath required for rclone job');

      const indexedCount = await indexRcloneFilesStreaming(
        db, remoteName, basePath, remoteType || 'unknown', userId, jobId,
        (count) => {
          db.prepare(`UPDATE indexing_jobs SET total_files = ?, updated_at = ? WHERE id = ?`).run(count, Math.floor(Date.now() / 1000), jobId);
          sseEventBus.emit(userId, { type: 'job_progress', jobId, payload: { stage: 'discovery', filesFound: count } });
        },
        (done, total, _batchIds) => {
          db.prepare(`UPDATE indexing_jobs SET processed_files = ?, updated_at = ? WHERE id = ?`).run(done, Math.floor(Date.now() / 1000), jobId);
          sseEventBus.emit(userId, { type: 'file_hashed', jobId, payload: { done, total } });
        }
      );
      db.prepare(`UPDATE indexing_jobs SET total_files = ?, processed_files = ?, updated_at = ? WHERE id = ?`)
        .run(indexedCount, indexedCount, Math.floor(Date.now() / 1000), jobId);
    }

    db.prepare(
      `UPDATE indexing_jobs SET status = 'completed', updated_at = ? WHERE id = ?`
    ).run(Math.floor(Date.now() / 1000), jobId);

    // Invalidate cached feed rankings so the newly indexed files appear immediately.
    invalidateFeedCache(userId);

    sseEventBus.emit(userId, { type: 'job_completed', jobId, payload: { success: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE indexing_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
    ).run(msg, Math.floor(Date.now() / 1000), jobId);

    sseEventBus.emit(userId, { type: 'job_failed', jobId, payload: { error: msg } });
    throw err; // let the queue's retry/backoff handle re-attempts
  }
}

let started = false;

export function startIndexingWorker(): void {
  if (started) return;
  started = true;
  registerIndexingProcessor(processJob);
}
