import type Database from 'better-sqlite3';

export interface V2MediaStats {
  total: number;
  images: number;
  videos: number;
  savedCount: number;
  likedCount: number;
  hiddenCount: number;
  presentPathCount: number;
  folderCount: number;
}

export function clearUserIndexedDataV2(db: Database.Database, userId: string): void {
  const clearUserData = db.transaction(() => {
    db.prepare('DELETE FROM user_hidden_files WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_liked_files WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_saved_files WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM file_paths WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM folders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_storage_configs WHERE user_id = ?').run(userId);

    // Keep only files still referenced by at least one remaining path.
    db.prepare('DELETE FROM files WHERE id NOT IN (SELECT DISTINCT file_id FROM file_paths)').run();
  });

  clearUserData();
}

export function clearAllIndexedDataV2(db: Database.Database): void {
  const clearAllData = db.transaction(() => {
    db.prepare('DELETE FROM user_hidden_files').run();
    db.prepare('DELETE FROM user_liked_files').run();
    db.prepare('DELETE FROM user_saved_files').run();
    db.prepare('DELETE FROM file_paths').run();
    db.prepare('DELETE FROM folders').run();
    db.prepare('DELETE FROM files').run();
    db.prepare('DELETE FROM user_storage_configs').run();
  });

  clearAllData();
}

export function getV2MediaStats(db: Database.Database): V2MediaStats {
  const media = db
    .prepare(
      `
      SELECT
        COUNT(DISTINCT fp.file_id) as total,
        COUNT(DISTINCT CASE WHEN f.media_kind = 'image' THEN fp.file_id END) as images,
        COUNT(DISTINCT CASE WHEN f.media_kind = 'video' THEN fp.file_id END) as videos,
        COUNT(fp.id) as presentPathCount
      FROM file_paths fp
      JOIN files f ON f.id = fp.file_id
      WHERE fp.is_present = 1
      `
    )
    .get() as {
    total: number | null;
    images: number | null;
    videos: number | null;
    presentPathCount: number | null;
  };

  const saved = db.prepare('SELECT COUNT(*) as count FROM user_saved_files').get() as {
    count: number;
  };
  const liked = db.prepare('SELECT COUNT(*) as count FROM user_liked_files').get() as {
    count: number;
  };
  const hidden = db.prepare('SELECT COUNT(*) as count FROM user_hidden_files').get() as {
    count: number;
  };
  const folders = db.prepare('SELECT COUNT(*) as count FROM folders').get() as {
    count: number;
  };

  return {
    total: media.total ?? 0,
    images: media.images ?? 0,
    videos: media.videos ?? 0,
    savedCount: saved.count,
    likedCount: liked.count,
    hiddenCount: hidden.count,
    presentPathCount: media.presentPathCount ?? 0,
    folderCount: folders.count,
  };
}