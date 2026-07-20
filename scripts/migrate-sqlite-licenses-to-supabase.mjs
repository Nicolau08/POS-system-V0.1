/**
 * Importa tenants/licenças do SQLite local para Supabase (license_clients + pos_tenant_registry).
 * A consola de licenças (license-console/) lê APENAS Supabase — este script alinha dados legados.
 */
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: true });

const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) {
  console.error('[migrate] Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const dbPath = process.env.POS_DB_PATH || path.join(projectRoot, 'api', 'database.db');
const supabase = createClient(url, key, { auth: { persistSession: false } });

const allSqlite = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])));
  });

const rows = await new Promise((resolve, reject) => {
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) return reject(err);
    allSqlite(
      db,
      `SELECT t.id AS tenant_id, t.name,
              tp.nuit, tp.license_type,
              l.expires_at, l.active, l.machine_id, l.plan
       FROM tenants t
       LEFT JOIN tenant_profile tp ON tp.id = t.id
       LEFT JOIN licenses l ON l.tenant_id = t.id AND l.active = 1
       ORDER BY t.created_at`,
    )
      .then((r) => {
        db.close();
        resolve(r);
      })
      .catch((e) => {
        db.close();
        reject(e);
      });
  });
});

if (!rows.length) {
  console.log('[migrate] Nenhum tenant no SQLite.');
  process.exit(0);
}

console.log(`[migrate] ${rows.length} tenant(s) no SQLite → Supabase (${new URL(url).host})`);

let clientsUpserted = 0;
let registryUpserted = 0;

for (const row of rows) {
  const tenantId = String(row.tenant_id || '').trim();
  const name = String(row.name || tenantId).trim() || tenantId;
  if (!tenantId) continue;

  const { data: existingClient } = await supabase
    .from('license_clients')
    .select('id, tenant_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const clientId = existingClient?.id || crypto.randomUUID();
  const plan = String(row.license_type || row.plan || 'LITE').toUpperCase().includes('PRO') ? 'PRO' : 'LITE';
  const nuit = row.nuit != null && String(row.nuit).trim() ? String(row.nuit).trim() : null;

  if (!existingClient) {
    const { error } = await supabase.from('license_clients').insert({
      id: clientId,
      name,
      tenant_id: tenantId,
      nuit,
      plan,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error(`[migrate] license_clients ${tenantId}:`, error.message);
      continue;
    }
    clientsUpserted += 1;
    console.log(`  + cliente: ${name} (${tenantId})`);
  } else {
    console.log(`  = cliente já existe: ${tenantId}`);
  }

  const machineId = row.machine_id != null ? String(row.machine_id).trim() : '';
  const expiresAt = row.expires_at ? new Date(String(row.expires_at)).toISOString() : null;
  if (machineId && expiresAt) {
    const { error } = await supabase.from('pos_tenant_registry').upsert(
      {
        tenant_id: tenantId,
        display_name: name,
        machine_id: machineId,
        license_expires_at: expiresAt,
        nuit,
        plan,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    );
    if (error) {
      console.error(`[migrate] pos_tenant_registry ${tenantId}:`, error.message);
    } else {
      registryUpserted += 1;
      console.log(`  + registo máquina: ${machineId.slice(0, 8)}…`);
    }
  }
}

console.log('');
console.log(`[migrate] Concluído: ${clientsUpserted} cliente(s) novos, ${registryUpserted} registo(s) de máquina.`);
