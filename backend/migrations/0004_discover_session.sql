-- Migration: discover session table for tracking seen media per user
CREATE TABLE IF NOT EXISTS user_discover_session (
  user_id TEXT PRIMARY KEY,
  seen_file_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
