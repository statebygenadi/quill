import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from '../src/config/db.js';

const MIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

async function ensureTracker(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function main(): Promise<void> {
  await ensureTracker();
  const files = (await readdir(MIG_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM _migrations');
  const done = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (done.has(file)) {
      console.log(`✓ ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(MIG_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file} applied`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${file} failed:`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
