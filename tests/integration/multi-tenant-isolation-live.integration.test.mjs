/**
 * Etapa 1F.6 (itens 34-35) — isolamento multi-tenant real: dois devices reais
 * (Device JWT distintos, tenants A e B reais), cada um só vê os SEUS dados
 * via RLS real (Postgres, supabase/), e uma tentativa explícita de A
 * escrever um produto referenciando o tenant B tem de FALHAR.
 *
 * Requer env: POSLY_1F6D_ISSUER_URL, POSLY_1F6D_SUPABASE_URL,
 *   POSLY_1F6D_SUPABASE_ANON_KEY, POSLY_1F6D_TOKEN_A, POSLY_1F6D_TENANT_A,
 *   POSLY_1F6D_TOKEN_B, POSLY_1F6D_TENANT_B.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ISSUER_URL = process.env.POSLY_1F6D_ISSUER_URL || '';
const SUPABASE_URL = process.env.POSLY_1F6D_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.POSLY_1F6D_SUPABASE_ANON_KEY || '';
const TOKEN_A = process.env.POSLY_1F6D_TOKEN_A || '';
const TENANT_A = process.env.POSLY_1F6D_TENANT_A || '';
const TOKEN_B = process.env.POSLY_1F6D_TOKEN_B || '';
const TENANT_B = process.env.POSLY_1F6D_TENANT_B || '';
const shouldRun = Boolean(ISSUER_URL && SUPABASE_URL && SUPABASE_ANON_KEY && TOKEN_A && TENANT_A && TOKEN_B && TENANT_B);

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
  'multi-tenant real: device A só vê tenant A, device B só vê tenant B, escrita cross-tenant FALHA',
  { skip: !shouldRun && 'defina POSLY_1F6D_*' },
  async () => {
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');

    const udA = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-multiA-'));
    const udB = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-multiB-'));

    const bootA = await bootstrapDevice({ activationToken: TOKEN_A, machineId: 'machine-1f6-multiA', userDataPath: udA, issuerBaseUrl: ISSUER_URL });
    assert.equal(bootA.ok, true, JSON.stringify(bootA));
    const bootB = await bootstrapDevice({ activationToken: TOKEN_B, machineId: 'machine-1f6-multiB', userDataPath: udB, issuerBaseUrl: ISSUER_URL });
    assert.equal(bootB.ok, true, JSON.stringify(bootB));

    const clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bootA.accessToken}` } },
      auth: { persistSession: false },
    });
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bootB.accessToken}` } },
      auth: { persistSession: false },
    });

    // Cada device cria o SEU produto real.
    const { data: prodA, error: errA } = await clientA
      .from('products')
      .insert({ tenant_id: TENANT_A, name: 'Produto Tenant A 1F6', price: 10 })
      .select()
      .single();
    assert.equal(errA, null, `insert real do device A falhou: ${JSON.stringify(errA)}`);

    const { data: prodB, error: errB } = await clientB
      .from('products')
      .insert({ tenant_id: TENANT_B, name: 'Produto Tenant B 1F6', price: 20 })
      .select()
      .single();
    assert.equal(errB, null, `insert real do device B falhou: ${JSON.stringify(errB)}`);

    // Item 34: A não pode LER o produto de B, e vice-versa (RLS real).
    const { data: aSeesB } = await clientA.from('products').select('id').eq('id', prodB.id);
    assert.equal((aSeesB ?? []).length, 0, 'device A NUNCA deve ver produtos do tenant B');

    const { data: bSeesA } = await clientB.from('products').select('id').eq('id', prodA.id);
    assert.equal((bSeesA ?? []).length, 0, 'device B NUNCA deve ver produtos do tenant A');

    // Item 35: A tenta ESCREVER um produto referenciando explicitamente o tenant B -> tem de FALHAR.
    const { data: crossWrite, error: crossErr } = await clientA
      .from('products')
      .insert({ tenant_id: TENANT_B, name: 'Produto Cross-Tenant Malicioso', price: 1 })
      .select();
    const crossWriteBlocked = Boolean(crossErr) || (crossWrite ?? []).length === 0;
    assert.equal(crossWriteBlocked, true, `device A conseguiu escrever no tenant B! error=${JSON.stringify(crossErr)} data=${JSON.stringify(crossWrite)}`);
    console.log('[item 35] cross-tenant write attempt result:', JSON.stringify({ crossErr, crossWrite }));

    // Item 35b: A tenta ler/actualizar um cliente/user referenciando tenant B directamente por id (update).
    const { data: crossUpdate, error: crossUpdateErr } = await clientA
      .from('products')
      .update({ price: 999 })
      .eq('id', prodB.id)
      .select();
    const crossUpdateBlocked = Boolean(crossUpdateErr) || (crossUpdate ?? []).length === 0;
    assert.equal(crossUpdateBlocked, true, 'device A NUNCA deve conseguir actualizar um produto do tenant B');

    fs.rmSync(udA, { recursive: true, force: true });
    fs.rmSync(udB, { recursive: true, force: true });
  },
);
