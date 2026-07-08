/**
 * Desktop POSly = só caixa. A consola /license-admin corre no browser (dev/cloud),
 * não entra no instalador Electron.
 *
 * Uso:
 *   node scripts/prepare-pos-desktop-build.mjs exclude
 *   node scripts/prepare-pos-desktop-build.mjs restore
 */
import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const licenseAdminApp = path.join(root, 'app', 'license-admin');
const licenseAdminSkip = path.join(root, '.build-skip', 'license-admin');

const action = String(process.argv[2] || '').trim().toLowerCase();

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function excludeLicenseAdmin() {
  if (!(await exists(licenseAdminApp))) {
    console.log('[prepare-pos-desktop-build] license-admin já excluída do build.');
  } else {
    await fs.mkdir(path.dirname(licenseAdminSkip), { recursive: true });
    await fs.rename(licenseAdminApp, licenseAdminSkip);
    console.log('[prepare-pos-desktop-build] app/license-admin movida para .build-skip/ (excluída do Next build).');
  }

  const nextDir = path.join(root, '.next');
  if (await exists(nextDir)) {
    try {
      await fs.rm(nextDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      console.log('[prepare-pos-desktop-build] cache .next removida (evita tipos stale de /license-admin).');
    } catch (error) {
      console.warn(
        '[prepare-pos-desktop-build] não foi possível limpar .next (feche `npm run dev` se estiver activo):',
        error?.message ?? error,
      );
    }
  }
}

async function restoreLicenseAdmin() {
  if (!(await exists(licenseAdminSkip))) {
    return;
  }
  if (await exists(licenseAdminApp)) {
    await fs.rm(licenseAdminSkip, { recursive: true, force: true });
    console.log('[prepare-pos-desktop-build] app/license-admin já presente; removido .build-skip/.');
    return;
  }
  await fs.mkdir(path.dirname(licenseAdminApp), { recursive: true });
  await fs.rename(licenseAdminSkip, licenseAdminApp);
  console.log('[prepare-pos-desktop-build] app/license-admin restaurada.');
}

try {
  if (action === 'exclude') {
    await excludeLicenseAdmin();
  } else if (action === 'restore') {
    await restoreLicenseAdmin();
  } else {
    console.error('[prepare-pos-desktop-build] Uso: exclude | restore');
    process.exit(1);
  }
} catch (error) {
  console.error('[prepare-pos-desktop-build] falhou:', error);
  process.exit(1);
}
