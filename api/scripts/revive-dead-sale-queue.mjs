/**
 * Reset local sync_queue rows: sale + dead → pending (retries cleared).
 * Uses POS_DB_PATH when set (same as api/database.js), else api/pos.db.
 *
 * Usage:
 *   node api/scripts/revive-dead-sale-queue.mjs
 *   node api/scripts/revive-dead-sale-queue.mjs tenant-qa-02
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

const db = new sqlite3.Database(dbPath);
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });

try {
  const now = new Date().toISOString();
  const sql = tenantId
    ? `UPDATE sync_queue
       SET status = 'pending',
           retries = 0,
           next_retry_at = NULL,
           lock_token = NULL,
           locked_at = NULL,
           updated_at = ?
       WHERE type = 'sale'
         AND status = 'dead'
         AND tenant_id = ?`
    : `UPDATE sync_queue
       SET status = 'pending',
           retries = 0,
           next_retry_at = NULL,
           lock_token = NULL,
           locked_at = NULL,
           updated_at = ?
       WHERE type = 'sale'
         AND status = 'dead'`;
  const params = tenantId ? [now, tenantId] : [now];
  const { changes } = await run(sql, params);
  console.log(JSON.stringify({ dbPath, tenantId: tenantId || null, revived: changes }, null, 2));
} finally {
  db.close();
}
