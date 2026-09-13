/**
 * Build instalador Windows POSly (caixa apenas).
 * A consola de licenças vive em license-console/ (browser/Vercel) — não entra no bundle.
 */
import { spawnSync } from 'child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, command, args, extraEnv = {}) {
  console.log(`\n[electron-dist-pos] ${label}…`);
  const useShell = process.platform === 'win32';
  // Com shell no Windows, caminhos com espaços (ex.: Program Files) têm de ir entre aspas.
  const cmd =
    useShell && typeof command === 'string' && /\s/.test(command)
      ? `"${command}"`
      : command;
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, POS_APP_MODE: 'pos', ...extraEnv },
    shell: useShell,
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

  try {
    run('inject build secrets', process.execPath, ['scripts/inject-pos-build-secrets.mjs']);
    // Portas do instalado (3730 web / 3731 API) — distintas de npm run dev (3000/3001).
    // POS_API_PORT embute o rewrite /pos-backend; DIRECT_URL para uploads grandes no cliente.
    run('next build', npmCmd, ['run', 'build'], {
      POS_API_PORT: '3731',
      NEXT_PUBLIC_POS_API_DIRECT_URL: 'http://127.0.0.1:3731',
    });
    run('ofuscar pack (api/electron/lib)', process.execPath, ['scripts/obfuscate-pack.mjs']);
    run('limpar dist-electron', npmCmd, ['run', 'electron:clean']);
    // Config gerada por obfuscate-pack.mjs — usa pastas ofuscadas em vez do source.
    const packConfig = 'build/electron-builder.pack.json';
    run(
      'electron-builder',
      'npx',
      [...builderArgs, '--config', packConfig],
      { POS_APP_MODE: 'pos' },
    );
  } catch (error) {
    throw error;
  }
  console.log('\n[electron-dist-pos] Concluído. Instalador em dist-electron/');
}

main().catch((error) => {
  console.error('[electron-dist-pos]', error?.message ?? error);
  process.exit(1);
});
