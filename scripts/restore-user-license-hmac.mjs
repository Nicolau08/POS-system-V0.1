/**
 * Restaura POS_LICENSE_HMAC_SECRET no ambiente do utilizador Windows
 * a partir de .env / .env.local (sem imprimir o valor).
 * Útil quando um HMAC curto/errado no User env marca licenças como tampering.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

const secret = String(
  process.env.POS_LICENSE_HMAC_SECRET || process.env.LICENSE_HMAC_SECRET || '',
).trim();

if (!secret || secret.length < 20) {
  console.error('[restore-user-license-hmac] Segredo em falta ou demasiado curto em .env.local');
  process.exit(1);
}

const ps = `
$ErrorActionPreference = 'Stop'
[Environment]::SetEnvironmentVariable('POS_LICENSE_HMAC_SECRET', $env:POSLY_HMAC_RESTORE, 'User')
$got = [Environment]::GetEnvironmentVariable('POS_LICENSE_HMAC_SECRET', 'User')
if (-not $got -or $got.Length -ne $env:POSLY_HMAC_RESTORE.Length) {
  throw 'Falha ao gravar variável de utilizador'
}
Write-Output ('user_hmac_restored_len=' + $got.Length)
`;

execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', ps],
  {
    env: { ...process.env, POSLY_HMAC_RESTORE: secret },
    stdio: 'inherit',
  },
);
