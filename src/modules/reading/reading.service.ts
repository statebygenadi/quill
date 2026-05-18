import { pool } from '../../config/db.js';
import { errors } from '../../lib/errors.js';

export interface ProgressRow {
  user_id: string;
  chapter_id: string;
  position: number;
  percent: number;
  completed_at: Date | null;
  updated_at: Date;
}

export async function upsertProgress(
  userId: string,
  chapterId: string,
  position: number,
  percent: number,
): Promise<ProgressRow> {
  // Ensure chapter exists & is published (or owned in future — for now strict).
  const { rowCount: ok } = await pool.query(
    `SELECT 1 FROM chapters WHERE id = $1 AND status = 'published'`,
    [chapterId],
  );
  if (!ok) throw errors.notFound('chapter');

  // We only move progress forward — protects against out-of-order clients.
  const { rows } = await pool.query<ProgressRow>(
    `INSERT INTO reading_progress (user_id, chapter_id, position, percent, completed_at, updated_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 >= 99.5 THEN now() ELSE NULL END, now())
     ON CONFLICT (user_id, chapter_id) DO UPDATE
       SET position = GREATEST(reading_progress.position, EXCLUDED.position),
           percent  = GREATEST(reading_progress.percent,  EXCLUDED.percent),
           completed_at = CASE
             WHEN reading_progress.completed_at IS NOT NULL THEN reading_progress.completed_at
             WHEN GREATEST(reading_progress.percent, EXCLUDED.percent) >= 99.5 THEN now()
             ELSE NULL
           END,
           updated_at = now()
     RETURNING *`,
    [userId, chapterId, position, percent],
  );
  return rows[0]!;
}

export interface HistoryItem {
  chapter_id: string;
  chapter_number: number;
  chapter_title: string;
  series_id: string;
  series_slug: string;
  series_title: string;
  percent: number;
  completed_at: Date | null;
  updated_at: Date;
}

export async function listHistory(userId: string, limit = 25): Promise<HistoryItem[]> {
  const { rows } = await pool.query<HistoryItem>(
    `SELECT rp.chapter_id,
            c.number  AS chapter_number,
            c.title   AS chapter_title,
            s.id      AS series_id,
            s.slug    AS series_slug,
            s.title   AS series_title,
            rp.percent::float AS percent,
            rp.completed_at,
            rp.updated_at
     FROM reading_progress rp
     JOIN chapters c ON c.id = rp.chapter_id
     JOIN series   s ON s.id = c.series_id
     WHERE rp.user_id = $1
     ORDER BY rp.updated_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export interface BookmarkRow {
  id: string;
  user_id: string;
  chapter_id: string;
  position: number;
  note: string | null;
  created_at: Date;
}

export async function addBookmark(
  userId: string,
  chapterId: string,
  position: number,
  note?: string,
): Promise<BookmarkRow> {
  const { rowCount: ok } = await pool.query(`SELECT 1 FROM chapters WHERE id = $1`, [chapterId]);
  if (!ok) throw errors.notFound('chapter');
  const { rows } = await pool.query<BookmarkRow>(
    `INSERT INTO bookmarks (user_id, chapter_id, position, note)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, chapterId, position, note ?? null],
  );
  return rows[0]!;
}

export async function listBookmarks(userId: string, chapterId?: string): Promise<BookmarkRow[]> {
  if (chapterId) {
    const { rows } = await pool.query<BookmarkRow>(
      `SELECT * FROM bookmarks WHERE user_id = $1 AND chapter_id = $2 ORDER BY position ASC`,
      [userId, chapterId],
    );
    return rows;
  }
  const { rows } = await pool.query<BookmarkRow>(
    `SELECT * FROM bookmarks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );
  return rows;
}

export async function deleteBookmark(userId: string, bookmarkId: string): Promise<void> {
  const { rowCount } = await pool.query(`DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`, [
    bookmarkId,
    userId,
  ]);
  if (!rowCount) throw errors.notFound('bookmark');
}
