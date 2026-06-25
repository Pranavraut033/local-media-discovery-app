-- Migration: widen indexing_jobs.job_type CHECK to allow 'remote' (servers.ts add-source)
-- SQLite has no ALTER TABLE ... DROP/ADD CHECK, so rebuild the table.

CREATE TABLE indexing_jobs_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('local', 'rclone', 'remote')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  source_path TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO indexing_jobs_new SELECT * FROM indexing_jobs;
DROP TABLE indexing_jobs;
ALTER TABLE indexing_jobs_new RENAME TO indexing_jobs;

CREATE INDEX IF NOT EXISTS idx_indexing_jobs_user ON indexing_jobs(user_id, created_at DESC);
