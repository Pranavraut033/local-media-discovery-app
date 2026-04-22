-- Migration: reclassify mis-tagged rclone records as local.
--
-- Why:
-- Some local files were indexed with storage_mode='rclone', which causes
-- local-only feed queries to miss liked items.
--
-- What this does:
-- 1) If a rclone folder has an equivalent local folder (same user + rel path),
--    repoint file_paths.folder_id to that local folder.
-- 2) Convert remaining rclone folders to local when no local duplicate exists.
-- 3) Remove duplicate rclone folders that are now redundant.
-- 4) Convert all file_paths storage_mode='rclone' to 'local'.

-- 1) Repoint file_paths that reference a rclone folder to an existing
--    equivalent local folder (when present).
UPDATE file_paths
SET folder_id = (
  SELECT lf.id
  FROM folders rf
  JOIN folders lf
    ON lf.user_id = rf.user_id
   AND lf.relative_path_from_root = rf.relative_path_from_root
   AND lf.storage_mode = 'local'
  WHERE rf.id = file_paths.folder_id
    AND rf.storage_mode = 'rclone'
  LIMIT 1
)
WHERE folder_id IN (SELECT id FROM folders WHERE storage_mode = 'rclone')
  AND EXISTS (
    SELECT 1
    FROM folders rf
    JOIN folders lf
      ON lf.user_id = rf.user_id
     AND lf.relative_path_from_root = rf.relative_path_from_root
     AND lf.storage_mode = 'local'
    WHERE rf.id = file_paths.folder_id
      AND rf.storage_mode = 'rclone'
  );

-- 2) Convert non-duplicate rclone folders to local.
UPDATE folders
SET
  storage_mode = 'local',
  updated_at = strftime('%s', 'now')
WHERE storage_mode = 'rclone'
  AND NOT EXISTS (
    SELECT 1
    FROM folders lf
    WHERE lf.user_id = folders.user_id
      AND lf.relative_path_from_root = folders.relative_path_from_root
      AND lf.storage_mode = 'local'
  );

-- 3) Remove any rclone folder that has an equivalent local folder.
--    file_paths were repointed in step (1), so these are redundant now.
DELETE FROM folders
WHERE storage_mode = 'rclone'
  AND EXISTS (
    SELECT 1
    FROM folders lf
    WHERE lf.user_id = folders.user_id
      AND lf.relative_path_from_root = folders.relative_path_from_root
      AND lf.storage_mode = 'local'
  );

-- 4) Reclassify all file paths to local so local-filtered feed/liked queries
--    can surface these items again.
UPDATE file_paths
SET
  storage_mode = 'local',
  updated_at = strftime('%s', 'now')
WHERE storage_mode = 'rclone';
