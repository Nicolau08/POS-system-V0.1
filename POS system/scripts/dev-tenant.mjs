/**
 * Dev isolado por tenant: SQLite + config + licença em .dev-tenants/<id>/
 *
 * Uso:
 *   node scripts/dev-tenant.mjs qa03          → tenant-qa-03 (BD nova se pasta não existir)
 *   node scripts/dev-tenant.mjs qa03 --fresh  → apaga pasta e recria BD limpa
 *   node scripts/dev-tenant.mjs qa02 --electron → API + WEB + Electron desktop
 *   node scripts/dev-tenant.mjs default       → api/pos.db (projecto)
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const fresh = argv.includes('--fresh');
const withElectron = argv.includes('--electron');
const slug = argv.find((a) => !a.startsWith('--')) || 'default';

function resolveTenant(slugInput) {
  const raw = String(slugInput || '').trim();
  if (!raw || raw === 'default') return null;

  if (raw.startsWith('tenant-')) {
    const label = raw.replace(/^tenant-/, '').replace(/-/g, ' ');
    return {
      tenantId: raw,
      folderName: raw,
      tenantName: label ? `Tenant ${label}` : raw,
    };
  }

  if (/^qa\d+$/i.test(raw)) {
    const num = raw.slice(2);
    const tenantId = `tenant-qa-${num}`;
    return {
      tenantId,
      folderName: tenantId,
      tenantName: `Tenant QA ${num}`,
    };
  }

  const tenantId = `tenant-${raw}`;
  return {
    tenantId,
    folderName: tenantId,
    tenantName: `Tenant ${raw}`,
  };
}

const tenant = resolveTenant(slug);
const env = { ...process.env };

if (tenant) {
  const root = path.join(projectRoot, '.dev-tenants', tenant.folderName);

  if (fresh && fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
    console.log(`[dev-tenant] Pasta removida (--fresh): ${root}`);
  }

  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  env.POS_DB_PATH = path.join(dataDir, 'pos.db');
  env.POS_CONFIG_PATH = path.join(root, 'config.json');
  env.POS_LICENSE_PATH = path.join(root, 'license.json');
  env.DEFAULT_TENANT_ID = tenant.tenantId;
  env.DEFAULT_TENANT_NAME = tenant.tenantName;
  env.POS_DEV_TENANT = tenant.tenantId;

  const dbExists = fs.existsSync(env.POS_DB_PATH);
  console.log(`[dev-tenant] Tenant: ${tenant.tenantId} (${tenant.tenantName})`);
  console.log(`[dev-tenant] SQLite: ${env.POS_DB_PATH}${dbExists ? ' (existente)' : ' (nova)'}`);
  console.log(`[dev-tenant] Config: ${env.POS_CONFIG_PATH}`);
} else {
  for (const key of ['POS_DB_PATH', 'POS_CONFIG_PATH', 'POS_LICENSE_PATH', 'POS_DEV_TENANT']) {
    delete env[key];
  }
  console.log('[dev-tenant] Modo default → api/pos.db');
}

if (withElectron) {
  env.POS_ELECTRON_USE_EXTERNAL_API = '1';
  console.log('[dev-tenant] Electron desktop activado (--electron)');
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmScript = withElectron ? 'dev:full:electron' : 'dev:full';
const child = spawn(npmCmd, ['run', npmScript], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
