/**
 * Etapa 1F.6 (item 36) — re-confirma ao vivo, contra Postgres real
 * (supabase/), o guard de escalonamento de privilégio fechado na
 * Etapa 1E.9 (migração 20260917000200_user_privilege_escalation_guard.sql):
 * um device (identidade de terminal) NUNCA pode, via sync_upsert_user, criar
 * um utilizador novo com access_level>=9/role=admin.
 *
 * Requer env: POSLY_1F6F_ISSUER_URL, POSLY_1F6F_SUPABASE_URL,
 *   POSLY_1F6F_SUPABASE_ANON_KEY, POSLY_1F6F_TOKEN, POSLY_1F6F_TENANT_ID.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ISSUER_URL = process.env.POSLY_1F6F_ISSUER_URL || '';
const SUPABASE_URL = process.env.POSLY_1F6F_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.POSLY_1F6F_SUPABASE_ANON_KEY || '';
const TOKEN = process.env.POSLY_1F6F_TOKEN || '';
const TENANT_ID = process.env.POSLY_1F6F_TENANT_ID || '';
const shouldRun = Boolean(ISSUER_URL && SUPABASE_URL && SUPABASE_ANON_KEY && TOKEN && TENANT_ID);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

test(
  'privilege escalation guard real (1E.9): device tenta criar utilizador NOVO com access_level=9/role=admin via RPC -> FALHA',
  { skip: !shouldRun && 'defina POSLY_1F6F_*' },
  async () => {
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-escalate-'));

    const boot = await bootstrapDevice({ activationToken: TOKEN, machineId: 'machine-1f6-escalate', userDataPath, issuerBaseUrl: ISSUER_URL });
    assert.equal(boot.ok, true, JSON.stringify(boot));

    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${boot.accessToken}` } },
      auth: { persistSession: false },
    });

    const fakeAdminId = crypto.randomUUID();
    const bcryptLikeHash = '$2b$10$' + 'a'.repeat(53); // formato válido (regex), conteúdo irrelevante para este teste.

    const { data, error } = await client.rpc('sync_upsert_user', {
      p_id: fakeAdminId,
      p_name: 'Atacante Auto-Promovido',
      p_role: 'admin',
      p_access_level: 9,
      p_pin_hash: bcryptLikeHash,
      p_active: true,
    });

    console.log('[item 36] resultado da tentativa de escalonamento:', JSON.stringify({ data, error }));
    assert.ok(error, 'a RPC tem de FALHAR ao tentar criar um utilizador novo já elevado');
    assert.match(String(error.message ?? ''), /privilege_escalation_denied/, `esperava privilege_escalation_denied, veio: ${JSON.stringify(error)}`);

    // Confirma que NENHUMA linha foi persistida (nem clamped, nem elevada).
    const { data: rows } = await client.from('users').select('id').eq('id', fakeAdminId);
    assert.equal((rows ?? []).length, 0, 'nenhuma linha deve ter sido criada para a tentativa de escalonamento');

    fs.rmSync(userDataPath, { recursive: true, force: true });
  },
);
