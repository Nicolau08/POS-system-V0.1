import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

const DIST_DIR = path.join(process.cwd(), 'dist-electron');
const TARGETS = [
  path.join(DIST_DIR, 'win-unpacked'),
  path.join(DIST_DIR, '__uninstaller-nsis-pos-system.exe'),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isWindowsBusyError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  return (
    process.platform === 'win32' &&
    (code === 'EBUSY' || code === 'EPERM' || message.includes('resource busy') || message.includes('being used by another process'))
  );
}

function releaseWindowsLock(targetPath) {
  if (process.platform !== 'win32') return;

  const escapedPath = String(targetPath).replace(/'/g, "''");
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$target = '${escapedPath}'`,
    '$procs = Get-CimInstance Win32_Process |',
    '  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target, [System.StringComparison]::OrdinalIgnoreCase) }',
    'foreach ($p in $procs) {',
    '  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}',
    '}',
  ].join('; ');

  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
  });
}

async function renameAsStale(targetPath) {
  const parent = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const stalePath = path.join(parent, `${base}-stale-${Date.now()}`);
  await fs.rename(targetPath, stalePath);
  console.warn(`[clean-electron-dist] moved locked path to ${path.basename(stalePath)}`);
}

async function removeWithRetries(targetPath, retries = 15) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (isWindowsBusyError(error)) {
        releaseWindowsLock(targetPath);
      }
      if (attempt === retries) {
        if (isWindowsBusyError(error) && path.basename(targetPath) === 'win-unpacked') {
          try {
            await renameAsStale(targetPath);
            return;
          } catch (renameError) {
            throw new Error(
              `Failed to remove or move ${targetPath} after ${retries} attempts: ${String(renameError?.message ?? renameError)}`
            );
          }
        }
        throw new Error(`Failed to remove ${targetPath} after ${retries} attempts: ${String(error?.message ?? error)}`);
      }
      const waitMs = 350 * attempt;
      console.warn(
        `[clean-electron-dist] retry ${attempt}/${retries} for ${path.basename(targetPath)} (${waitMs}ms)`
      );
      await sleep(waitMs);
    }
  }
}

async function main() {
  await fs.mkdir(DIST_DIR, { recursive: true });
  for (const targetPath of TARGETS) {
    await removeWithRetries(targetPath);
  }
  console.log('[clean-electron-dist] cleanup completed');
}

main().catch((error) => {
  console.error('[clean-electron-dist] failed:', error);
  process.exit(1);
});
