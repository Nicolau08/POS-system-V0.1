/**
 * Reset local sync_queue rows for tenant + sale types.
 * Moves (dead OR failed) → pending with retries cleared.
 *
 * Usage:
 *   node api/scripts/reset-sale-queue.mjs tenant-qa-02
 *
 * Relies on POS_DB_PATH env var (same convention as api/database.js).
 */

import sqlite3Import from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlite3 = sqlite3Import.verbose();

const dbPath = process.env.POS_DB_PATH
  ? path.resolve(String(process.env.POS_DB_PATH))
  : path.join(__dirname, '..', 'pos.db');

const tenantId = (process.argv[2] ?? '').trim();
if (!tenantId) {
  console.error('Missing tenantId. Usage: node api/scripts/reset-sale-queue.mjs <tenantId>');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });

try {
  const now = new Date().toISOString();
  const sql = `UPDATE sync_queue
                SET status = 'pending',
                    retries = 0,
                    next_retry_at = NULL,
                    lock_token = NULL,
                    locked_at = NULL,
                    updated_at = ?
                WHERE type = 'sale'
                  AND tenant_id = ?
                  AND (status = 'dead' OR status = 'failed')`;

  const res = await run(sql, [now, tenantId]);
  console.log(JSON.stringify({ dbPath, tenantId, reset: res.changes }, null, 2));
} finally {
  db.close();
}

