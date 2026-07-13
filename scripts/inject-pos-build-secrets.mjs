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

if (!hmacSecret) {
  console.error(
    '[inject-pos-build-secrets] POS_LICENSE_HMAC_SECRET em falta. Defina em .env.local antes de electron-dist.',
  );
  process.exit(1);
}

const outPath = path.join(projectRoot, 'electron', '.build-secrets.json');
const payload = {
  POS_LICENSE_HMAC_SECRET: hmacSecret,
  ...(issuerBaseUrl ? { POS_LICENSE_ISSUER_BASE_URL: issuerBaseUrl } : {}),
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`[inject-pos-build-secrets] Gravado ${outPath}`);
