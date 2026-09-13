/**
 * Gera electron/.build-secrets.json a partir de .env / .env.local antes do electron-dist.
 * O ficheiro é incluído no pacote e lido pelo Electron em modo packaged.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: true });

const hmacSecret = String(
  process.env.POS_LICENSE_HMAC_SECRET || process.env.LICENSE_HMAC_SECRET || '',
).trim();
const issuerBaseUrl = String(process.env.POS_LICENSE_ISSUER_BASE_URL || '').trim();
const supabaseUrl = String(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
).trim();
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const supabaseAnonKey = String(
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
).trim();

if (!hmacSecret) {
  console.error(
    '[inject-pos-build-secrets] POS_LICENSE_HMAC_SECRET em falta. Defina em .env.local antes de electron-dist.',
  );
  process.exit(1);
}

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn(
    '[inject-pos-build-secrets] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em falta — sync cloud desactivado no instalador.',
  );
}

const outPath = path.join(projectRoot, 'electron', '.build-secrets.json');
const payload = {
  POS_LICENSE_HMAC_SECRET: hmacSecret,
  ...(issuerBaseUrl ? { POS_LICENSE_ISSUER_BASE_URL: issuerBaseUrl } : {}),
  ...(supabaseUrl ? { SUPABASE_URL: supabaseUrl } : {}),
  ...(supabaseServiceRoleKey ? { SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey } : {}),
  ...(supabaseAnonKey ? { SUPABASE_ANON_KEY: supabaseAnonKey } : {}),
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(
  `[inject-pos-build-secrets] Gravado ${outPath} (supabase=${Boolean(supabaseUrl && supabaseServiceRoleKey)})`,
);
