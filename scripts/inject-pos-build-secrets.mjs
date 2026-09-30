/**
 * Gera electron/.build-secrets.json a partir de .env / .env.local antes do electron-dist.
 * O ficheiro é incluído no pacote e lido pelo Electron em modo packaged.
 *
 * Etapa 1F.4: o POS runtime não depende mais de SUPABASE_SERVICE_ROLE_KEY
 * (Etapa 1F.3 — sync automático e stockController já usam Device JWT).
 * Etapa 1F.5c: o POS runtime também não depende mais de
 * POS_LICENSE_HMAC_SECRET (licença offline Ed25519 + Device Auth). Este
 * injector NUNCA escreve nenhuma das duas em .build-secrets.json, mesmo que
 * existam no ambiente da máquina de build — o produto distribuível não pode
 * conter nenhuma credencial privilegiada Supabase nem o segredo de
 * assinatura HMAC de licença. process.env.* é lido apenas para os avisos
 * abaixo (nunca copiado para o payload).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: true });

const issuerBaseUrl = String(process.env.POS_LICENSE_ISSUER_BASE_URL || '').trim();
const supabaseUrl = String(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
).trim();
const supabaseAnonKey = String(
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
).trim();

// Item 16: a mera EXISTÊNCIA destas variáveis no ambiente da máquina de build
// nunca falha o build — são sempre ignoradas de propósito, só avisadas.
if (String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
  console.warn(
    '[inject-pos-build-secrets] SUPABASE_SERVICE_ROLE_KEY está definida no ambiente da máquina de build — ' +
      'ignorada de propósito (Etapa 1F.4). O POS runtime nunca usa esta credencial; ela NUNCA é escrita em .build-secrets.json.',
  );
}
if (
  String(process.env.POS_LICENSE_HMAC_SECRET || '').trim() ||
  String(process.env.LICENSE_HMAC_SECRET || '').trim()
) {
  console.warn(
    '[inject-pos-build-secrets] POS_LICENSE_HMAC_SECRET está definida no ambiente da máquina de build — ' +
      'ignorada de propósito (Etapa 1F.5c). O POS runtime nunca usa este segredo (licença offline Ed25519 + ' +
      'Device Auth); ele NUNCA é escrito em .build-secrets.json.',
  );
}

if (!issuerBaseUrl) {
  console.warn(
    '[inject-pos-build-secrets] POS_LICENSE_ISSUER_BASE_URL em falta — activação de licença desactivada no instalador.',
  );
}
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[inject-pos-build-secrets] SUPABASE_URL / SUPABASE_ANON_KEY em falta — sync cloud (Device JWT) desactivado no instalador.',
  );
}

const outPath = path.join(projectRoot, 'electron', '.build-secrets.json');
const payload = {
  ...(issuerBaseUrl ? { POS_LICENSE_ISSUER_BASE_URL: issuerBaseUrl } : {}),
  ...(supabaseUrl ? { SUPABASE_URL: supabaseUrl } : {}),
  ...(supabaseAnonKey ? { SUPABASE_ANON_KEY: supabaseAnonKey } : {}),
};

// Assertion de segurança (item 16): o build tem de FALHAR, nunca embalar
// silenciosamente, se qualquer uma destas chaves alguma vez voltar a
// aparecer no payload gerado.
const FORBIDDEN_PAYLOAD_KEYS = ['SUPABASE_SERVICE_ROLE_KEY', 'POS_LICENSE_HMAC_SECRET', 'LICENSE_HMAC_SECRET'];
const foundForbidden = FORBIDDEN_PAYLOAD_KEYS.filter((key) => key in payload);
if (foundForbidden.length > 0) {
  console.error(
    `[inject-pos-build-secrets] BUG: ${foundForbidden.join(', ')} não pode(m) estar no payload. Abortado.`,
  );
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(
  `[inject-pos-build-secrets] Gravado ${outPath} (supabase_device_jwt=${Boolean(supabaseUrl && supabaseAnonKey)}, service_role_incluido=false, license_hmac_incluido=false)`,
);
