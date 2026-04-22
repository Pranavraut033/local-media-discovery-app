-- Migration: remove all rclone-sourced data and stored rclone config
-- Deletes file_paths and cascading data for rclone storage_mode,
-- then clears the encrypted rclone config columns from user_storage_configs.

PRAGMA foreign_keys = OFF;

-- 1. Delete interactions that reference rclone file_path rows (via file_id)
-- DELETE FROM user_liked_files
-- WHERE file_id IN (
--   SELECT DISTINCT file_id FROM file_paths WHERE storage_mode = 'rclone'
-- );

-- DELETE FROM user_saved_files
-- WHERE file_id IN (
--   SELECT DISTINCT file_id FROM file_paths WHERE storage_mode = 'rclone'
-- );

-- DELETE FROM user_hidden_files
-- WHERE file_id IN (
--   SELECT DISTINCT file_id FROM file_paths WHERE storage_mode = 'rclone'
-- );

-- 2. Delete rclone file_paths rows
DELETE FROM file_paths WHERE storage_mode = 'rclone';

-- 3. Delete orphaned files (files with no remaining file_paths row)
DELETE FROM files
WHERE id NOT IN (SELECT DISTINCT file_id FROM file_paths);

-- 4. Delete rclone folders
DELETE FROM folders WHERE storage_mode = 'rclone';

-- 5. Reset the discover session seen-ids for all users so stale rclone IDs
--    no longer block discovery of local content
UPDATE user_discover_session SET seen_file_ids = '[]';

-- 6. Clear stored rclone config from user_storage_configs
UPDATE user_storage_configs
SET
  rclone_config_encrypted = NULL,
  rclone_config_nonce     = NULL,
  rclone_config_kdf_salt  = NULL,
  rclone_config_version   = 1;

PRAGMA foreign_keys = ON;
