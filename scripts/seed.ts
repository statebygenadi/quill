import { pool } from '../src/config/db.js';
import { hashPassword } from '../src/lib/password.js';

async function main(): Promise<void> {
  const adminPass = await hashPassword('AdminPasswordChangeMe!');
  const authorPass = await hashPassword('AuthorPasswordChangeMe!');
  const readerPass = await hashPassword('ReaderPasswordChangeMe!');

  await pool.query('BEGIN');
  try {
    await pool.query(
      `INSERT INTO users (email, password_hash, display_name, role, email_verified_at)
       VALUES
         ('admin@quill.local',  $1, 'Quill Admin', 'admin',  now()),
         ('author@quill.local', $2, 'Ada Author',  'author', now()),
         ('reader@quill.local', $3, 'Rey Reader',  'reader', now())
       ON CONFLICT (email) DO NOTHING`,
      [adminPass, authorPass, readerPass],
    );

    const { rows: au } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'author@quill.local'`,
    );
    const authorUserId = au[0]!.id;

    await pool.query(
      `INSERT INTO authors (user_id, pen_name, bio)
       VALUES ($1, 'A. Aurelius', 'Writes long-form fiction.')
       ON CONFLICT (user_id) DO NOTHING`,
      [authorUserId],
    );

    const { rows: aRows } = await pool.query<{ id: string }>(`SELECT id FROM authors WHERE user_id = $1`, [
      authorUserId,
    ]);
    const authorId = aRows[0]!.id;

    const { rows: sRows } = await pool.query<{ id: string }>(
      `INSERT INTO series (author_id, slug, title, description, status, access_tier, published_at)
       VALUES ($1, 'the-glass-tower', 'The Glass Tower',
               'A serialized novella about a city of mirrors.', 'published', 'free', now())
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [authorId],
    );
    const seriesId = sRows[0]!.id;

    await pool.query(
      `INSERT INTO chapters (series_id, number, title, asset_key, word_count, status, published_at)
       VALUES
         ($1, 1, 'The Arrival',  'chapter/seed/glass-tower-01.md', 4200, 'published', now()),
         ($1, 2, 'The Mirror',   'chapter/seed/glass-tower-02.md', 4800, 'published', now()),
         ($1, 3, 'The Fracture', 'chapter/seed/glass-tower-03.md', 5100, 'published', now())
       ON CONFLICT (series_id, number) DO NOTHING`,
      [seriesId],
    );

    await pool.query('COMMIT');
    console.log('seed complete');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
