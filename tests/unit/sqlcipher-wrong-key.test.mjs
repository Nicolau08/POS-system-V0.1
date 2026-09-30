/**
 * Etapa 1F.6 (item 26 — CRITICAL) — SQLCipher com chave errada NUNCA pode
 * criar silenciosamente uma BD vazia por cima dos dados existentes. Testa
 * directamente openSqliteDatabase() real (SQLCipher real via
 * @journeyapps/sqlcipher, nenhum mock), contra um ficheiro temporário —
 * nunca a BD de desenvolvimento real.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { openSqliteDatabase } from '../../api/utils/dbEncryption.js';

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function getAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function closeAsync(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

test('SQLCipher: chave errada ao reabrir -> ERRO CLARO, nunca cria BD vazia silenciosamente por cima dos dados', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-sqlcipher-'));
  const dbPath = path.join(tmpDir, 'database.db');
  const correctKey = crypto.randomBytes(32).toString('hex');
  const wrongKey = crypto.randomBytes(32).toString('hex');

  try {
    // 1. Criar BD real encriptada com a chave correcta e gravar dados reais.
    process.env.POS_DB_ENCRYPTION_KEY = correctKey;
    process.env.POS_DB_ENCRYPTION = '1';
    const { db: db1 } = await openSqliteDatabase(dbPath);
    await runAsync(db1, `CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)`);
    await runAsync(db1, `INSERT INTO test_data (value) VALUES (?)`, ['dados-reais-importantes']);
    const countBefore = await getAsync(db1, `SELECT COUNT(*) AS c FROM test_data`);
    assert.equal(countBefore.c, 1);
    await closeAsync(db1);

    const sizeAfterWrite = fs.statSync(dbPath).size;
    assert.ok(sizeAfterWrite > 0, 'ficheiro deve ter conteúdo real');

    // 2. Tentar reabrir com a chave ERRADA -> deve LANÇAR, nunca "abrir vazio".
    process.env.POS_DB_ENCRYPTION_KEY = wrongKey;
    let threw = false;
    let errorMessage = '';
    try {
      await openSqliteDatabase(dbPath);
    } catch (err) {
      threw = true;
      errorMessage = err.message;
    }
    assert.equal(threw, true, 'CRÍTICO: abrir com chave errada tem de lançar erro, nunca suceder silenciosamente');
    assert.match(errorMessage, /chave incorrecta ou ficheiro corrompido/i);

    // 3. O ficheiro no disco NUNCA foi tocado/truncado pela tentativa com chave errada.
    const sizeAfterWrongKeyAttempt = fs.statSync(dbPath).size;
    assert.equal(sizeAfterWrongKeyAttempt, sizeAfterWrite, 'ficheiro não pode ter sido alterado pela tentativa com chave errada');

    // 4. Reabrir com a chave CORRECTA de novo -> dados continuam lá, intactos.
    process.env.POS_DB_ENCRYPTION_KEY = correctKey;
    const { db: db2 } = await openSqliteDatabase(dbPath);
    const countAfter = await getAsync(db2, `SELECT COUNT(*) AS c FROM test_data`);
    assert.equal(countAfter.c, 1, 'dados devem continuar intactos após a tentativa com chave errada');
    const row = await getAsync(db2, `SELECT value FROM test_data LIMIT 1`);
    assert.equal(row.value, 'dados-reais-importantes');
    await closeAsync(db2);
  } finally {
    delete process.env.POS_DB_ENCRYPTION_KEY;
    delete process.env.POS_DB_ENCRYPTION;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test('SQLCipher: DPAPI/chave indisponível (POS_DB_ENCRYPTION_KEY ausente) sobre uma BD já encriptada -> FALHA já no open() (item 1F.6.1: antes abria "PLAINTEXT vazia" e só falhava na 1ª query — agora o preflight de dbEncryption.js apanha logo)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-sqlcipher-nokey-'));
  const dbPath = path.join(tmpDir, 'database.db');
  const correctKey = crypto.randomBytes(32).toString('hex');

  try {
    process.env.POS_DB_ENCRYPTION_KEY = correctKey;
    process.env.POS_DB_ENCRYPTION = '1';
    const { db: db1 } = await openSqliteDatabase(dbPath);
    await runAsync(db1, `CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT)`);
    await runAsync(db1, `INSERT INTO test_data (value) VALUES (?)`, ['dados-reais']);
    await closeAsync(db1);

    // Simula getOrCreateDbEncryptionKey() falhar a obter a chave (DPAPI
    // indisponível) -- o CALLER (electron/dbEncryptionKey.js) já trata este
    // caso lançando antes de chegar aqui (ver relatório) -- este teste prova
    // o comportamento de openSqliteDatabase() SE for chamado sem chave.
    delete process.env.POS_DB_ENCRYPTION_KEY;

    // Etapa 1F.6.1 (item 3/25): o ramo não-encriptado agora faz o MESMO
    // preflight (SELECT count(*) FROM sqlite_master) que o ramo SQLCipher já
    // fazia -- um ficheiro SQLCipher real não é um SQLite plaintext válido
    // para o driver sqlite3 normal, por isso agora FALHA logo no open(),
    // marcado com DATABASE_CORRUPTED, em vez de devolver um objecto que
    // parece uma BD nova vazia até à primeira query real.
    let threw = false;
    let errorMessage = '';
    try {
      await openSqliteDatabase(dbPath);
    } catch (err) {
      threw = true;
      errorMessage = err.message;
    }
    console.log('[item 26] sem chave sobre ficheiro SQLCipher real: open() lançou =', threw, errorMessage);
    assert.equal(threw, true, 'sem chave sobre um ficheiro SQLCipher real, o open() tem de FALHAR, nunca devolver uma BD "vazia"');
    assert.match(errorMessage, /DATABASE_CORRUPTED/);
  } finally {
    delete process.env.POS_DB_ENCRYPTION_KEY;
    delete process.env.POS_DB_ENCRYPTION;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
