-- Migration: reconcile interaction file_id pointers from stale temp IDs.
--
-- Background:
-- During pending indexing phases, file_paths.temp_file_id may retain older IDs
-- while file_paths.file_id points at the current canonical file record. If an
-- interaction row still references the temp ID, liked/saved/hidden queries that
-- join by file_id won't find it.
--
-- Strategy (applied to liked/saved/hidden):
-- 1) Delete conflicting source rows where the mapped target row already exists
--    for the same user (avoids UNIQUE(user_id, file_id) violations).
-- 2) Update remaining rows from old file_id -> mapped canonical file_id.

-- ---------------------------------------------------------------------------
-- user_liked_files
-- ---------------------------------------------------------------------------

DELETE FROM user_liked_files
WHERE EXISTS (
  SELECT 1
  FROM file_paths fp
  WHERE fp.user_id = user_liked_files.user_id
    AND fp.is_present = 1
    AND fp.temp_file_id = user_liked_files.file_id
    AND fp.file_id != user_liked_files.file_id
    AND EXISTS (
      SELECT 1
      FROM user_liked_files ulf_keep
      WHERE ulf_keep.user_id = user_liked_files.user_id
        AND ulf_keep.file_id = fp.file_id
    )
);

UPDATE user_liked_files
SET
  file_id = (
    SELECT fp.file_id
    FROM file_paths fp
    WHERE fp.user_id = user_liked_files.user_id
      AND fp.is_present = 1
      AND fp.temp_file_id = user_liked_files.file_id
      AND fp.file_id != user_liked_files.file_id
    ORDER BY fp.last_seen_at DESC
    LIMIT 1
  ),
  updated_at = strftime('%s', 'now')
WHERE EXISTS (
  SELECT 1
  FROM file_paths fp
  WHERE fp.user_id = user_liked_files.user_id
    AND fp.is_present = 1
    AND fp.temp_file_id = user_liked_files.file_id
    AND fp.file_id != user_liked_files.file_id
);

-- ---------------------------------------------------------------------------
-- user_saved_files
-- ---------------------------------------------------------------------------

DELETE FROM user_saved_files
WHERE EXISTS (
  SELECT 1
  FROM file_paths fp
  WHERE fp.user_id = user_saved_files.user_id
    AND fp.is_present = 1
    AND fp.temp_file_id = user_saved_files.file_id
    AND fp.file_id != user_saved_files.file_id
    AND EXISTS (
      SELECT 1
      FROM user_saved_files usf_keep
      WHERE usf_keep.user_id = user_saved_files.user_id
        AND usf_keep.file_id = fp.file_id
    )
);

UPDATE user_saved_files
SET
  file_id = (
    SELECT fp.file_id
    FROM file_paths fp
    WHERE fp.user_id = user_saved_files.user_id
      AND fp.is_present = 1
      AND fp.temp_file_id = user_saved_files.file_id
      AND fp.file_id != user_saved_files.file_id
    ORDER BY fp.last_seen_at DESC
    LIMIT 1
  ),
  updated_at = strftime('%s', 'now')
WHERE EXISTS (
  SELECT 1
  FROM file_paths fp
  WHERE fp.user_id = user_saved_files.user_id
    AND fp.is_present = 1
    AND fp.temp_file_id = user_saved_files.file_id
    AND fp.file_id != user_saved_files.file_id
);

-- ---------------------------------------------------------------------------
-- user_hidden_files
-- ---------------------------------------------------------------------------

DELETE FROM user_hidden_files
WHERE EXISTS (
  SELECT 1
  FROM file_paths fp
  WHERE fp.user_id = user_hidden_files.user_id
    AND fp.is_present = 1
    AND fp.temp_file_id = user_hidden_files.file_id
    AND fp.file_id != user_hidden_files.file_id
    AND EXISTS (
      SELECT 1
      FROM user_hidden_files uhf_keep
      WHERE uhf_keep.user_id = user_hidden_files.user_id
        AND uhf_keep.file_id = fp.file_id
    )
);

UPDATE user_hidden_files
SET
  file_id = (
    SELECT fp.file_id
    FROM file_paths fp
    WHERE fp.user_id = user_hidden_files.user_id
      AND fp.is_present = 1
      AND fp.temp_file_id = user_hidden_files.file_id
      AND fp.file_id != user_hidden_files.file_id
    ORDER BY fp.last_seen_at DESC
    LIMIT 1
  ),
  updated_at = strftime('%s', 'now')
WHERE EXISTS (
  SELECT 1
  FROM file_paths fp
  WHERE fp.user_id = user_hidden_files.user_id
    AND fp.is_present = 1
    AND fp.temp_file_id = user_hidden_files.file_id
    AND fp.file_id != user_hidden_files.file_id
);
