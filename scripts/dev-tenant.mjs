/**
 * Dev isolado por tenant: SQLite + config + licença + machine ID em .dev-tenants/<id>/
 *
 * O app instalado continua em %APPDATA%\POSly com o Machine ID real do PC (como cliente).
 * O dev NÃO partilha pasta nem machine ID com o instalado — testes na mesma máquina ficam sólidos.
 *
 * Uso:
 *   node scripts/dev-tenant.mjs qa03          → tenant-qa-03 (BD nova se pasta não existir)
 *   node scripts/dev-tenant.mjs qa03 --fresh  → apaga pasta e recria BD limpa
 *   node scripts/dev-tenant.mjs qa02 --lan      → API escuta na LAN (0.0.0.0) para postos/Android
 *   node scripts/dev-tenant.mjs qa02 --electron → API + WEB + Electron desktop
 *   node scripts/dev-tenant.mjs default       → api/database.db (projecto)
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const fresh = argv.includes('--fresh');
const withElectron = argv.includes('--electron');
const withLan = argv.includes('--lan');
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

/** Machine ID estável por pasta de tenant (UUID v4), independente do hardware. */
function readOrCreateDevMachineId(tenantRoot) {
  const filePath = path.join(tenantRoot, 'machine-id.json');
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const id = String(parsed?.machine_id ?? parsed?.machineId ?? '').trim();
      if (id) return id;
    }
  } catch {
    // regenerar abaixo
  }
  const machineId = crypto.randomUUID();
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        machine_id: machineId,
        created_at: new Date().toISOString(),
        note: 'ID de teste POSly — não é o Machine ID do hardware / app instalado',
      },
      null,
      2,
    ),
    'utf8',
  );
  return machineId;
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(true))
      .once('listening', () => {
        tester.close(() => resolve(false));
      })
      .listen(port, '127.0.0.1');
  });
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
  const backupsDir = path.join(root, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });

  const databasePath = path.join(dataDir, 'database.db');
  const legacyDbPath = path.join(dataDir, 'pos.db');
  if (fs.existsSync(legacyDbPath) && !fs.existsSync(databasePath)) {
    fs.renameSync(legacyDbPath, databasePath);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${legacyDbPath}${suffix}`) && !fs.existsSync(`${databasePath}${suffix}`)) {
        fs.renameSync(`${legacyDbPath}${suffix}`, `${databasePath}${suffix}`);
      }
    }
    console.log('[dev-tenant] Migrado pos.db → database.db');
  }

  const machineId = readOrCreateDevMachineId(root);

  env.POS_DB_PATH = databasePath;
  env.POS_BACKUP_DIR = backupsDir;
  env.POS_CONFIG_PATH = path.join(root, 'config.json');
  env.POS_LICENSE_PATH = path.join(root, 'license.json');
  env.POS_USER_DATA_PATH = root;
  env.POS_MACHINE_ID = machineId;
  env.POS_ALLOW_MACHINE_ID_OVERRIDE = '1';
  env.DEFAULT_TENANT_ID = tenant.tenantId;
  env.DEFAULT_TENANT_NAME = tenant.tenantName;
  env.POS_DEV_TENANT = tenant.tenantId;

  const dbExists = fs.existsSync(env.POS_DB_PATH);
  console.log(`[dev-tenant] Tenant: ${tenant.tenantId} (${tenant.tenantName})`);
  console.log(`[dev-tenant] Pasta isolada: ${root}`);
  console.log(`[dev-tenant] Machine ID de teste: ${machineId}`);
  console.log(`[dev-tenant] SQLite: ${env.POS_DB_PATH}${dbExists ? ' (existente)' : ' (nova)'}`);
  console.log(`[dev-tenant] Licença: ${env.POS_LICENSE_PATH}`);
  console.log(`[dev-tenant] Config: ${env.POS_CONFIG_PATH}`);
  console.log('[dev-tenant] Instalado (cliente): %APPDATA%\\POSly + Machine ID real — não partilha esta pasta');
} else {
  for (const key of [
    'POS_DB_PATH',
    'POS_CONFIG_PATH',
    'POS_LICENSE_PATH',
    'POS_USER_DATA_PATH',
    'POS_MACHINE_ID',
    'POS_ALLOW_MACHINE_ID_OVERRIDE',
    'POS_DEV_TENANT',
    'POS_BACKUP_DIR',
  ]) {
    delete env[key];
  }
  console.log('[dev-tenant] Modo default → api/database.db (sem isolamento de tenant)');
}

if (withElectron) {
  env.POS_ELECTRON_USE_EXTERNAL_API = '1';
  env.POS_ELECTRON_DEV = '1';
  console.log('[dev-tenant] Electron desktop activado (--electron) com userData na pasta do tenant');
}

if (withLan) {
  env.POS_API_BIND = '0.0.0.0';
  env.POS_LAN_ACCESS = '1';
  env.POS_STATION_DISCOVERY = '1';
  if (!env.POS_AUTH_HMAC_SECRET && !env.AUTH_BEARER_SHARED_SECRET) {
    env.POS_AUTH_HMAC_SECRET = 'posly-dev-lan-bearer-secret';
  }
  console.log('[dev-tenant] Acesso LAN activado (--lan) → bind 0.0.0.0 + login remoto');
}

const apiPort = Number.parseInt(String(env.POS_API_PORT || process.env.POS_API_PORT || '3001'), 10) || 3001;
const webPort = Number.parseInt(String(env.POS_WEB_PORT || process.env.POS_WEB_PORT || '3000'), 10) || 3000;

if (await isPortInUse(apiPort)) {
  console.error(
    `\n[dev-tenant] ERRO: a porta ${apiPort} (API) já está ocupada.\n` +
      `Provavelmente ficou um "npm run dev:tenant" / API anterior a correr.\n` +
      `Fecha esse terminal (Ctrl+C) ou mata o processo na porta ${apiPort}, e volta a tentar.\n` +
      `Sem isto, o browser pode continuar a usar a base/licença do outro tenant.\n`,
  );
  process.exit(1);
}

if (await isPortInUse(webPort)) {
  console.error(
    `\n[dev-tenant] ERRO: a porta ${webPort} (WEB) já está ocupada.\n` +
      `Fecha o Next/dev anterior e tenta de novo.\n`,
  );
  process.exit(1);
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
