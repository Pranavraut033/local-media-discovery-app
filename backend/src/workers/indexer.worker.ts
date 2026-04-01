/**
 * Indexing Worker
 * Processes BullMQ indexing jobs for both local and rclone sources.
 * Implements pending-first + hash-finalization pipeline.
 */
import { Worker } from 'bullmq';
import { type IndexingJobData, redisConnection, INDEXING_QUEUE } from '../queue/index.js';
import { sseEventBus } from '../queue/events.js';
import { getDatabase } from '../db/index.js';
import {
  discoverAndCreatePendingLocal,
  finalizeLocalPendingFiles,
} from '../services/indexer.js';
import {
  discoverAndCreatePendingRclone,
  finalizeRclonePendingFiles,
} from '../services/rclone-indexer.js';

async function processJob(job: { data: IndexingJobData }): Promise<void> {
  const { jobId, userId, type } = job.data;
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  // Update job status to processing
  db.prepare(
    `UPDATE indexing_jobs SET status = 'processing', updated_at = ? WHERE id = ?`
  ).run(now, jobId);

  sseEventBus.emit(userId, { type: 'job_started', jobId });

  try {
    if (type === 'local') {
      const { rootFolder } = job.data;
      if (!rootFolder) throw new Error('rootFolder required for local job');

      // Phase 1: fast discovery – creates pending records immediately
      const pending = await discoverAndCreatePendingLocal(db, rootFolder, userId, jobId, (count) => {
        sseEventBus.emit(userId, {
          type: 'job_progress',
          jobId,
          payload: { stage: 'discovery', filesFound: count },
        });
      });

      // Update total count
      db.prepare(
        `UPDATE indexing_jobs SET total_files = ?, updated_at = ? WHERE id = ?`
      ).run(pending.length, now, jobId);

      // Phase 2: hash each pending file and finalize
      await finalizeLocalPendingFiles(db, pending, userId, jobId, (done, total, fileId, finalId) => {
        sseEventBus.emit(userId, {
          type: 'file_hashed',
          jobId,
          payload: { done, total, tempId: fileId, finalId },
        });
        db.prepare(
          `UPDATE indexing_jobs SET processed_files = ?, updated_at = ? WHERE id = ?`
        ).run(done, Math.floor(Date.now() / 1000), jobId);
      });
    } else {
      const { remoteName, basePath, remoteType } = job.data;
      if (!remoteName || basePath === undefined) throw new Error('remoteName and basePath required for rclone job');

      // Phase 1: discover remote files and create pending records
      const pending = await discoverAndCreatePendingRclone(db, remoteName, basePath!, remoteType || 'unknown', userId, jobId, (count) => {
        sseEventBus.emit(userId, {
          type: 'job_progress',
          jobId,
          payload: { stage: 'discovery', filesFound: count },
        });
      });

      db.prepare(
        `UPDATE indexing_jobs SET total_files = ?, updated_at = ? WHERE id = ?`
      ).run(pending.length, Math.floor(Date.now() / 1000), jobId);

      // Phase 2: finalize rclone files (path-based hash, no re-download)
      await finalizeRclonePendingFiles(db, pending, userId, jobId, (done, total, tempId, finalId) => {
        sseEventBus.emit(userId, {
          type: 'file_hashed',
          jobId,
          payload: { done, total, tempId, finalId },
        });
        db.prepare(
          `UPDATE indexing_jobs SET processed_files = ?, updated_at = ? WHERE id = ?`
        ).run(done, Math.floor(Date.now() / 1000), jobId);
      });
    }

    db.prepare(
      `UPDATE indexing_jobs SET status = 'completed', updated_at = ? WHERE id = ?`
    ).run(Math.floor(Date.now() / 1000), jobId);

    sseEventBus.emit(userId, { type: 'job_completed', jobId, payload: { success: true } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE indexing_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
    ).run(msg, Math.floor(Date.now() / 1000), jobId);

    sseEventBus.emit(userId, { type: 'job_failed', jobId, payload: { error: msg } });
    throw err; // Let BullMQ handle retries
  }
}

let _worker: Worker | null = null;

export function startIndexingWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker<IndexingJobData>(INDEXING_QUEUE, processJob, {
    connection: redisConnection,
    concurrency: 2,
  });

  _worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });

  _worker.on('completed', (job) => {
    console.log(`[worker] job ${job.id} completed`);
  });

  return _worker;
}
