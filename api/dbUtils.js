import db from './database.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isSqliteBusyError(err) {
  const code = String(err?.code ?? '').toUpperCase();
  const message = String(err?.message ?? '').toUpperCase();
  return code === 'SQLITE_BUSY' || message.includes('SQLITE_BUSY');
}

async function runWithBusyRetry(sql, params = [], operation = 'run') {
  const maxRetries = Number(process.env.SQLITE_BUSY_RETRIES ?? 6);
  const baseDelayMs = Number(process.env.SQLITE_BUSY_RETRY_DELAY_MS ?? 150);

  // attempt=0 => primeira tentativa; attempt=maxRetries => última tentativa.
  // Se falhar com SQLITE_BUSY, fazemos backoff linear.
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      if (operation === 'run') {
        return await new Promise((resolve, reject) => {
          db.run(sql, params, function onRun(err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes });
          });
        });
      }

      if (operation === 'get') {
        return await new Promise((resolve, reject) => {
          db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row ?? null);
          });
        });
      }

      // operation === 'all'
      return await new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows ?? []);
        });
      });
    } catch (err) {
      if (!isSqliteBusyError(err) || attempt >= maxRetries) throw err;
      const waitMs = baseDelayMs * (attempt + 1);
      await delay(waitMs);
    }
  }
}

function run(sql, params = []) {
  return runWithBusyRetry(sql, params, 'run');
}

function get(sql, params = []) {
  return runWithBusyRetry(sql, params, 'get');
}

function all(sql, params = []) {
  return runWithBusyRetry(sql, params, 'all');
}

export { db, run, get, all };
