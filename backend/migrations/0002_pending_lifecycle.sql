-- Migration: pending file lifecycle + indexing jobs
-- Adds status column to file_paths and a dedicated indexing_jobs tracking table.

-- Track per-file lifecycle: 'pending' = discovered/not yet hashed; 'ready' = fully indexed
ALTER TABLE file_paths ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';

-- Store the temp file id used during pending state so reconciliation can find it
ALTER TABLE file_paths ADD COLUMN temp_file_id TEXT;

-- Job tracking table persisted in SQLite (BullMQ is the authoritative queue, this is for UI queries)
CREATE TABLE IF NOT EXISTS indexing_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('local', 'rclone')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  source_path TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_indexing_jobs_user ON indexing_jobs(user_id, created_at DESC);
