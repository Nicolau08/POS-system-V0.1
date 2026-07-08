/**
 * Build instalador Windows POSly (sem consola de licenças no bundle).
 * Garante restore de app/license-admin mesmo se o build falhar.
 */
import { spawnSync } from 'child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, command, args, extraEnv = {}) {
  console.log(`\n[electron-dist-pos] ${label}…`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, POS_APP_MODE: 'pos', ...extraEnv },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${label} falhou (exit ${result.status ?? 'null'})`);
  }
}

async function main() {
  const dirOnly = process.argv.includes('--dir');
  const builderArgs = dirOnly
    ? ['electron-builder', '--win', 'nsis', '--dir']
    : ['electron-builder', '--win', 'nsis'];

  run('excluir license-admin do Next', process.execPath, [
    'scripts/prepare-pos-desktop-build.mjs',
    'exclude',
  ]);

  try {
    run('next build', npmCmd, ['run', 'build']);
    run('limpar dist-electron', npmCmd, ['run', 'electron:clean']);
    run('electron-builder', 'npx', builderArgs, { POS_APP_MODE: 'pos' });
  } finally {
    run('restaurar license-admin', process.execPath, [
      'scripts/prepare-pos-desktop-build.mjs',
      'restore',
    ]);
  }
  console.log('\n[electron-dist-pos] Concluído. Instalador em dist-electron/');
}

main().catch((error) => {
  console.error('[electron-dist-pos]', error?.message ?? error);
  process.exit(1);
});
