-- Migration: covering indexes for feed query hot paths

-- Covering index for the latest_paths CTE that runs on every feed request:
--   SELECT file_id, MAX(last_seen_at) FROM file_paths
--   WHERE user_id = ? AND is_present = 1
--   GROUP BY file_id
-- Without this, the CTE does a full table scan filtered to user+present rows.
CREATE INDEX IF NOT EXISTS idx_file_paths_user_present_feed
  ON file_paths(user_id, is_present, file_id, last_seen_at);

-- Composite index to accelerate the outer CTE join:
--   WHERE fp.user_id = ? AND fp.is_present = 1 (with file_id lookup)
CREATE INDEX IF NOT EXISTS idx_file_paths_user_present_file
  ON file_paths(user_id, is_present, file_id);

-- Interaction table indexes: feed LEFT JOINs these three tables by (user_id, file_id).
-- The UNIQUE constraint already creates an index but name it explicitly for clarity.
CREATE INDEX IF NOT EXISTS idx_user_liked_files_user_file
  ON user_liked_files(user_id, file_id);

CREATE INDEX IF NOT EXISTS idx_user_saved_files_user_file
  ON user_saved_files(user_id, file_id);

CREATE INDEX IF NOT EXISTS idx_user_hidden_files_user_file
  ON user_hidden_files(user_id, file_id);
