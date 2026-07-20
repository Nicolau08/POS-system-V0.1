/**
 * Teste unitário: migração plaintext → SQLCipher + leitura com chave.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { createRequire } from 'module';
import {
  looksLikePlaintextSqlite,
  migratePlaintextToSqlCipher,
  isMarkedEncrypted,
} from '../../api/utils/dbEncryption.js';

const require = createRequire(import.meta.url);

test('migratePlaintextToSqlCipher encripta e deixa o ficheiro ilegível sem chave', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-db-enc-'));
  const dbPath = path.join(dir, 'database.db');
  const key = 'c'.repeat(64);
  const sqlite3 = require('sqlite3');

  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    db.serialize(() => {
      db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      db.run("INSERT INTO t (v) VALUES ('secret')", (err) => {
        if (err) return reject(err);
        db.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
      });
    });
  });

  assert.equal(looksLikePlaintextSqlite(dbPath), true);

  const result = await migratePlaintextToSqlCipher(dbPath, key);
  assert.equal(result.migrated, true);
  assert.equal(isMarkedEncrypted(dbPath), true);
  assert.equal(looksLikePlaintextSqlite(dbPath), false);

  const sqlcipher = require('@journeyapps/sqlcipher');
  await new Promise((resolve, reject) => {
    const db = new sqlcipher.Database(dbPath);
    db.serialize(() => {
      db.run(`PRAGMA key = '${key}'`);
      db.get('SELECT v FROM t', (err, row) => {
        if (err) return reject(err);
        assert.equal(row?.v, 'secret');
        db.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
      });
    });
  });

  await new Promise((resolve) => {
    const db = new sqlcipher.Database(dbPath);
    db.get('SELECT v FROM t', (err) => {
      assert.ok(err, 'esperado erro sem chave');
      db.close(() => resolve());
    });
  });

  fs.rmSync(dir, { recursive: true, force: true });
});
