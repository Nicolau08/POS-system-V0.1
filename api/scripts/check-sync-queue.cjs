const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath =
  process.env.POS_DB_PATH
    ? path.resolve(String(process.env.POS_DB_PATH))
    : path.join(__dirname, '..', 'pos.db');

const tenantId = process.argv[2] ? String(process.argv[2]).trim() : null;

if (!tenantId) {
  console.error('Usage: node api/scripts/check-sync-queue.cjs <tenantId>');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

(async () => {
  try {
    const byStatus = await all(
      `SELECT status, retries, COUNT(*) AS n
       FROM sync_queue
       WHERE tenant_id = ?
       GROUP BY status, retries
       ORDER BY status, retries`,
      [tenantId],
    );

    const recentLogs = await all(
      `SELECT id, type, queue_id, error_message, created_at
       FROM sync_logs
       WHERE queue_id IS NOT NULL
         AND (type = 'sale' OR type = 'queue-cycle')
       ORDER BY id DESC
       LIMIT 10`,
      [],
    );

    console.log(
      JSON.stringify(
        { dbPath, tenantId, byStatus, recentLogs },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

