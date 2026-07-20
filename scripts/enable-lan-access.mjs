/**
 * Activa Acesso LAN + descoberta na BD do tenant (dev).
 * Uso:
 *   node scripts/enable-lan-access.mjs
 *   node scripts/enable-lan-access.mjs .dev-tenants/tenant-qa-02/data/database.db
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const argPath = process.argv[2];
if (argPath) {
  process.env.POS_DB_PATH = path.resolve(projectRoot, argPath);
}

const { default: db } = await import(pathToFileURL(path.join(projectRoot, 'api/database.js')).href);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

await run(`
  CREATE TABLE IF NOT EXISTS station_server_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    lan_access_enabled INTEGER NOT NULL DEFAULT 0,
    discovery_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )
`);
await run(
  `INSERT OR IGNORE INTO station_server_settings (id, lan_access_enabled, discovery_enabled, updated_at)
   VALUES (1, 0, 1, datetime('now'))`,
);
await run(
  `UPDATE station_server_settings
   SET lan_access_enabled = 1, discovery_enabled = 1, updated_at = datetime('now')
   WHERE id = 1`,
);

const row = await get(`SELECT * FROM station_server_settings WHERE id = 1`);
console.log('DB:', process.env.POS_DB_PATH || '(default api)');
console.log('station_server_settings:', row);
console.log('OK — reinicie a API com POS_API_BIND=0.0.0.0 (um só processo na :3001).');
process.exit(0);
