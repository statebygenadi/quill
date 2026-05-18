import { pool } from '../../config/db.js';
import { errors } from '../../lib/errors.js';
import { signAssetUrl } from '../../lib/assets.js';
import { isEntitled, type AccessTier } from '../../lib/entitlements.js';
import type { AccessClaims } from '../../lib/jwt.js';

export interface SeriesRow {
  id: string;
  author_id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_asset_key: string | null;
  status: 'draft' | 'published' | 'archived';
  access_tier: AccessTier;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChapterRow {
  id: string;
  series_id: string;
  number: number;
  title: string;
  asset_key: string;
  word_count: number;
  status: 'draft' | 'scheduled' | 'published';
  publish_at: Date | null;
  published_at: Date | null;
}

export async function listPublishedSeries(opts: {
  limit: number;
  cursor?: string;
  tier?: AccessTier;
}): Promise<{ items: SeriesRow[]; next_cursor: string | null }> {
  const { limit, cursor, tier } = opts;
  const params: unknown[] = [];
  const conds = [`status = 'published'`];
  if (tier) {
    params.push(tier);
    conds.push(`access_tier = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor);
    conds.push(`id < $${params.length}`); // cursor on id desc
  }
  params.push(limit + 1);
  const { rows } = await pool.query<SeriesRow>(
    `SELECT * FROM series
     WHERE ${conds.join(' AND ')}
     ORDER BY id DESC
     LIMIT $${params.length}`,
    params,
  );
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    next_cursor: hasMore ? items[items.length - 1]!.id : null,
  };
}

export async function getSeriesBySlug(slug: string): Promise<SeriesRow | null> {
  const { rows } = await pool.query<SeriesRow>(`SELECT * FROM series WHERE slug = $1`, [slug]);
  return rows[0] ?? null;
}

export async function listChapters(seriesId: string, includeUnpublished = false): Promise<ChapterRow[]> {
  const sql = includeUnpublished
    ? `SELECT * FROM chapters WHERE series_id = $1 ORDER BY number ASC`
    : `SELECT * FROM chapters WHERE series_id = $1 AND status = 'published' ORDER BY number ASC`;
  const { rows } = await pool.query<ChapterRow>(sql, [seriesId]);
  return rows;
}

/**
 * Resolve a single chapter for a reader: enforces series.access_tier against
 * the caller's entitlement and returns a freshly-signed asset URL if allowed.
 */
export async function getChapterForReader(
  seriesSlug: string,
  chapterNumber: number,
  user: AccessClaims | undefined,
): Promise<{
  series: SeriesRow;
  chapter: ChapterRow;
  asset_url: string;
  asset_expires_at: number;
}> {
  const series = await getSeriesBySlug(seriesSlug);
  if (!series || series.status !== 'published') throw errors.notFound('series');

  const { rows } = await pool.query<ChapterRow>(
    `SELECT * FROM chapters
     WHERE series_id = $1 AND number = $2 AND status = 'published'`,
    [series.id, chapterNumber],
  );
  const chapter = rows[0];
  if (!chapter) throw errors.notFound('chapter');

  if (!isEntitled(user, series.access_tier)) {
    throw errors.paymentRequired(`requires ${series.access_tier} tier`);
  }

  const signed = signAssetUrl(chapter.asset_key);
  return { series, chapter, asset_url: signed.url, asset_expires_at: signed.expiresAt };
}

// --- author-side mutations -------------------------------------------------

export async function createSeries(
  authorUserId: string,
  input: { slug: string; title: string; description?: string; access_tier: AccessTier; cover_asset_key?: string },
): Promise<SeriesRow> {
  const { rows: authorRows } = await pool.query<{ id: string }>(
    `SELECT id FROM authors WHERE user_id = $1`,
    [authorUserId],
  );
  const author = authorRows[0];
  if (!author) throw errors.forbidden('user is not a registered author');

  try {
    const { rows } = await pool.query<SeriesRow>(
      `INSERT INTO series (author_id, slug, title, description, access_tier, cover_asset_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [author.id, input.slug, input.title, input.description ?? null, input.access_tier, input.cover_asset_key ?? null],
    );
    return rows[0]!;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw errors.conflict('slug already taken');
    }
    throw err;
  }
}

export async function publishSeries(seriesId: string, authorUserId: string): Promise<SeriesRow> {
  const { rows } = await pool.query<SeriesRow>(
    `UPDATE series s
       SET status = 'published',
           published_at = COALESCE(s.published_at, now()),
           updated_at = now()
     FROM authors a
     WHERE s.id = $1 AND s.author_id = a.id AND a.user_id = $2
     RETURNING s.*`,
    [seriesId, authorUserId],
  );
  if (rows.length === 0) throw errors.notFound('series (or not owned)');
  return rows[0]!;
}

export async function createChapter(
  seriesId: string,
  authorUserId: string,
  input: { number: number; title: string; asset_key: string; word_count: number; publish_at?: Date | null },
): Promise<ChapterRow> {
  // Verify ownership.
  const own = await pool.query<{ id: string }>(
    `SELECT s.id FROM series s
     JOIN authors a ON a.id = s.author_id
     WHERE s.id = $1 AND a.user_id = $2`,
    [seriesId, authorUserId],
  );
  if (own.rows.length === 0) throw errors.notFound('series (or not owned)');

  const status = input.publish_at ? 'scheduled' : 'draft';
  try {
    const { rows } = await pool.query<ChapterRow>(
      `INSERT INTO chapters (series_id, number, title, asset_key, word_count, status, publish_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [seriesId, input.number, input.title, input.asset_key, input.word_count, status, input.publish_at ?? null],
    );
    return rows[0]!;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw errors.conflict('chapter number already exists in this series');
    }
    throw err;
  }
}

export async function publishChapter(chapterId: string, authorUserId: string): Promise<ChapterRow> {
  const { rows } = await pool.query<ChapterRow>(
    `UPDATE chapters c
       SET status = 'published',
           published_at = COALESCE(c.published_at, now()),
           updated_at = now()
     FROM series s
     JOIN authors a ON a.id = s.author_id
     WHERE c.id = $1 AND c.series_id = s.id AND a.user_id = $2
     RETURNING c.*`,
    [chapterId, authorUserId],
  );
  if (rows.length === 0) throw errors.notFound('chapter (or not owned)');
  return rows[0]!;
}

/**
 * Publishes any scheduled chapters whose publish_at has elapsed. Idempotent.
 * Intended to be called by a periodic job (or a SKIP LOCKED worker).
 */
export async function publishDueChapters(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE chapters
       SET status = 'published',
           published_at = COALESCE(published_at, now()),
           updated_at = now()
     WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= now()`,
  );
  return rowCount ?? 0;
}
