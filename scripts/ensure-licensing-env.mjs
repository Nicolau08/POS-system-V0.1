/**
 * Garante .env.local com segredos de dev para licenciamento POSly.
 * Não sobrescreve valores já definidos; apenas preenche chaves em falta.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');

const randomSecret = () => crypto.randomBytes(32).toString('base64url');

function parseEnvFile(content) {
  const map = new Map();
  const lines = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      lines.push({ type: 'raw', line });
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      lines.push({ type: 'raw', line });
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    map.set(key, value);
    lines.push({ type: 'kv', key, value });
  }
  return { map, lines };
}

function serializeEnv(map, templateLines) {
  const seen = new Set();
  const out = [];
  for (const entry of templateLines) {
    if (entry.type === 'raw') {
      out.push(entry.line);
      continue;
    }
    seen.add(entry.key);
    const value = map.has(entry.key) ? map.get(entry.key) : entry.value;
    out.push(`${entry.key}=${value ?? ''}`);
  }
  for (const [key, value] of map) {
    if (!seen.has(key) && value != null && String(value).trim()) {
      out.push(`${key}=${value}`);
    }
  }
  return `${out.join('\n').replace(/\n*$/, '')}\n`;
}

const defaults = [
  ['POS_LICENSE_HMAC_SECRET', randomSecret()],
  ['LICENSE_ISSUER_ADMIN_TOKEN', randomSecret()],
  ['POS_LICENSE_ISSUER_BASE_URL', 'http://localhost:3000'],
];

let map = new Map();
let templateLines = [];

if (fs.existsSync(envPath)) {
  const parsed = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  map = parsed.map;
  templateLines = parsed.lines;
} else {
  const examplePath = path.join(projectRoot, '.env.example');
  if (fs.existsSync(examplePath)) {
    const parsed = parseEnvFile(fs.readFileSync(examplePath, 'utf8'));
    templateLines = parsed.lines;
  }
}

let added = [];
for (const [key, value] of defaults) {
  const current = String(map.get(key) ?? '').trim();
  if (!current) {
    map.set(key, value);
    added.push(key);
  }
}

// Espelhar Supabase URL/keys entre público e servidor quando só um lado está preenchido.
const mirrorPairs = [
  ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
];
for (const [a, b] of mirrorPairs) {
  const va = String(map.get(a) ?? '').trim();
  const vb = String(map.get(b) ?? '').trim();
  if (va && !vb) map.set(b, va);
  if (vb && !va) map.set(a, vb);
}

if (!fs.existsSync(envPath) || added.length > 0) {
  fs.writeFileSync(envPath, serializeEnv(map, templateLines), 'utf8');
  if (!fs.existsSync(envPath)) {
    console.log(`[licensing] Criado ${envPath}`);
  } else if (added.length) {
    console.log(`[licensing] Adicionado em .env.local: ${added.join(', ')}`);
  }
}

const hmac = String(map.get('POS_LICENSE_HMAC_SECRET') ?? '').trim();
const adminToken = String(map.get('LICENSE_ISSUER_ADMIN_TOKEN') ?? '').trim();
const issuerUrl = String(map.get('POS_LICENSE_ISSUER_BASE_URL') ?? '').trim();
const supabaseUrl = String(map.get('SUPABASE_URL') || map.get('NEXT_PUBLIC_SUPABASE_URL') || '').trim();
const supabaseKey = String(map.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
const anonKey = String(map.get('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? '').trim();

function decodeJwtRole(key) {
  try {
    const parts = key.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role ? String(payload.role) : null;
  } catch {
    return null;
  }
}

const serviceRole = supabaseKey ? decodeJwtRole(supabaseKey) : null;

console.log('[licensing] Estado:');
console.log(`  POS_LICENSE_HMAC_SECRET: ${hmac ? 'ok' : 'EM FALTA'}`);
console.log(`  LICENSE_ISSUER_ADMIN_TOKEN: ${adminToken ? 'ok' : 'EM FALTA'}`);
console.log(`  POS_LICENSE_ISSUER_BASE_URL: ${issuerUrl || '(não definido)'}`);
console.log(
  `  Supabase (consola): ${
    supabaseUrl && supabaseKey && serviceRole === 'service_role'
      ? 'ok'
      : supabaseUrl && supabaseKey && serviceRole === 'anon'
        ? 'ERRO — SUPABASE_SERVICE_ROLE_KEY é a chave anon'
        : 'EM FALTA — preencha SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'
  }`,
);

if (supabaseKey && anonKey && supabaseKey === anonKey) {
  console.log('');
  console.log('[licensing] CORRIJA: copie a chave service_role (secret) em Project Settings → API.');
  console.log('  Não use NEXT_PUBLIC_SUPABASE_ANON_KEY em SUPABASE_SERVICE_ROLE_KEY.');
}

if (adminToken) {
  console.log('');
  console.log('[licensing] Token da consola /license-admin (guarde em local seguro):');
  console.log(`  ${adminToken}`);
}

if (!supabaseUrl || !supabaseKey) {
  console.log('');
  console.log('[licensing] Sem Supabase a consola não regista clientes/vouchers.');
  console.log('  Edite .env.local com as chaves do projecto Supabase e aplique a migração:');
  console.log('  supabase/migrations/20260521_posly_license_issuer.sql');
  process.exitCode = 0;
}
