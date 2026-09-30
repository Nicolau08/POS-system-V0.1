/**
 * Etapa 1F.6 (item 25) — SQLite corrompido/ilegível: documentar o
 * comportamento REAL actual (erro claro? crash? recovery?). Nunca toca em
 * dados reais — sempre um ficheiro temporário criado e corrompido pelo
 * próprio teste. Não implementa recovery automático nesta etapa — só
 * classifica.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

function closeAsync(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function rmSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows pode manter um handle breve depois de fechar a BD — nunca falhar o teste por isto.
  }
}

test('SQLite ilegível (bytes aleatórios em vez de SQLite) -> erro claro (SQLITE_NOTADB), sem crash do processo Node', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-corrupt-'));
  const dbPath = path.join(tmpDir, 'database.db');
  fs.writeFileSync(dbPath, 'isto nao e um ficheiro sqlite, apenas texto aleatorio corrompido');

  const sqlite3Import = await import('sqlite3');
  const sqlite3 = sqlite3Import.default.verbose();
  let db;
  try {
    const result = await new Promise((resolve) => {
      db = new sqlite3.Database(dbPath, (openErr) => {
        if (openErr) return resolve({ openError: openErr.message });
        db.get('SELECT COUNT(*) AS c FROM sqlite_master', (err, row) => {
          resolve({ openError: null, queryError: err?.message ?? null, row });
        });
      });
    });
    console.log('[item 25] resultado abrir ficheiro corrompido:', JSON.stringify(result));
    // node-sqlite3 tipicamente NÃO falha no open() (lazy), mas falha na
    // primeira query real com "file is not a database" -- confirmamos que
    // ALGUM erro claro ocorre (open OU query), nunca um "0 tabelas" silencioso
    // que pareça uma BD nova vazia sem indicar corrupção.
    const gotClearError = Boolean(result.openError || result.queryError);
    assert.equal(gotClearError, true, 'deve haver um erro claro (open ou query), nunca um sucesso silencioso');
  } finally {
    if (db) await closeAsync(db);
    rmSafe(tmpDir);
  }
});

test('SQLite truncado a meio (ficheiro real válido cortado) -> comportamento documentado (item 25)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-truncate-'));
  const dbPath = path.join(tmpDir, 'database.db');

  const sqlite3Import = await import('sqlite3');
  const sqlite3 = sqlite3Import.default.verbose();

  // Cria uma BD real válida com dados.
  const dbWrite = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(d)));
  });
  await new Promise((resolve) => {
    dbWrite.serialize(() => {
      dbWrite.run('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      for (let i = 0; i < 50; i += 1) dbWrite.run('INSERT INTO t (v) VALUES (?)', [`valor-${i}`]);
      dbWrite.close(() => resolve());
    });
  });

  let db;
  try {
    const fullSize = fs.statSync(dbPath).size;
    // Trunca para metade -- simula escrita interrompida / disco cheio a meio.
    const fd = fs.openSync(dbPath, 'r+');
    fs.ftruncateSync(fd, Math.floor(fullSize / 2));
    fs.closeSync(fd);

    const result = await new Promise((resolve) => {
      db = new sqlite3.Database(dbPath, (openErr) => {
        if (openErr) return resolve({ openError: openErr.message });
        db.get('SELECT COUNT(*) AS c FROM t', (err, row) => {
          resolve({ openError: null, queryError: err?.message ?? null, row });
        });
      });
    });
    console.log('[item 25] resultado ficheiro truncado a 50%:', JSON.stringify(result));
    // Achado real (não um pass/fail fixo): para uma BD pequena, truncar a
    // meio o ficheiro pode ainda deixar as páginas com os dados intactas
    // (o SQLite aloca páginas livres/finais que podem não conter dados
    // activos) -- por isso o resultado varia. O que importa para o Release
    // Gate é que NUNCA aconteceu um "sucesso com dados errados silenciosos":
    // ou lê os dados reais correctamente, ou falha com um erro SQLite claro.
    const dataConsistent = result.row == null || result.row.c === 50 || result.openError || result.queryError;
    assert.ok(dataConsistent, `resultado inconsistente e sem erro: ${JSON.stringify(result)}`);
  } finally {
    if (db) await closeAsync(db);
    rmSafe(tmpDir);
  }
});

test('processo real api/server.js com POS_DB_PATH apontando para ficheiro corrompido -> saída CONTROLADA (item 1F.6.1: exit 1 limpo, marcador DATABASE_CORRUPTED, nunca uma excepção não apanhada crua)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-corrupt-server-'));
  const dbPath = path.join(tmpDir, 'database.db');
  fs.writeFileSync(dbPath, Buffer.from('corrompido-nao-e-sqlite-valido-'.repeat(4)));

  const port = 4989;
  const env = {
    ...process.env,
    POS_API_PORT: String(port),
    POS_DB_PATH: dbPath,
    POS_USER_DATA_PATH: tmpDir,
    NODE_ENV: 'development',
  };
  delete env.POS_DB_ENCRYPTION_KEY;
  delete env.POS_DB_ENCRYPTION;

  const result = spawnSync(process.execPath, ['api/server.js'], {
    cwd: process.cwd(),
    env,
    timeout: 15000,
    encoding: 'utf8',
  });
  const output = result.stdout + result.stderr;
  console.log('[item 25/1F.6.1] server com BD corrompida: status=', result.status, 'signal=', result.signal);
  console.log('[item 25/1F.6.1] stdout/stderr tail:', output.slice(-1500));

  assert.equal(result.signal, null, 'nunca deve morrer por sinal (crash duro) — só um exit code controlado');
  assert.equal(result.status, 1, 'saída controlada com exit code 1, nunca 0 nem um crash não intencional');
  assert.ok(output.includes('DATABASE_CORRUPTED'), 'o marcador estável tem de aparecer nos logs capturados (é o que o electron/main.js usa para distinguir este caso)');
  assert.ok(!/Emitted 'error' event on Statement instance/.test(output), 'nunca deve voltar a aparecer o stack trace cru de uma excepção não apanhada dentro do bootstrap do schema');

  // A BD original permanece byte-for-byte intacta -- nunca apagada/substituída/renomeada.
  const afterBytes = fs.readFileSync(dbPath);
  assert.ok(afterBytes.toString('utf8').startsWith('corrompido-nao-e-sqlite-valido-'), 'o ficheiro corrompido original tem de continuar exactamente como estava — nunca apagado/substituído');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
