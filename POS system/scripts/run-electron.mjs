/**
 * Lança o Electron em Windows via POSly.exe (cópia com ícone próprio).
 * O Windows associa o ícone da taskbar ao caminho do EXE + AppUserModelId;
 * usar electron.exe mantém o ícone Atom em cache mesmo após rcedit.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'node_modules', 'electron', 'dist');
const poslyExe = path.join(distDir, 'POSly.exe');
const defaultExe = require('electron');

const exe =
  process.platform === 'win32' && fs.existsSync(poslyExe) ? poslyExe : defaultExe;

const child = spawn(exe, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
  env: {
    ...process.env,
    // POSly.exe ≠ electron.exe → Electron marca isPackaged=true; forçar modo dev.
    ...(exe === poslyExe ? { POS_ELECTRON_DEV: '1' } : {}),
  },
});

let closed = false;
child.on('close', (code, signal) => {
  closed = true;
  if (code === null) {
    console.error(exe, 'exited with signal', signal);
    process.exit(1);
  }
  process.exit(code);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2']) {
  process.on(signal, () => {
    if (!closed) child.kill(signal);
  });
}
