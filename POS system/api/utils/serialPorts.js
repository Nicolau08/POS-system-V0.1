import { execFile } from 'child_process';
import { openSync, writeSync, closeSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function padDisplayLine(text, width) {
  const safeWidth = Math.max(8, Math.min(40, Number(width) || 20));
  const normalized = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase();
  if (normalized.length >= safeWidth) return normalized.slice(0, safeWidth);
  return normalized.padEnd(safeWidth, ' ');
}

function buildCustomerDisplayLines(line1, line2, width = 20) {
  return {
    line1: padDisplayLine(line1, width),
    line2: padDisplayLine(line2, width),
  };
}

function buildCustomerDisplayPayload(line1, line2, width = 20) {
  const lines = buildCustomerDisplayLines(line1, line2, width);
  const bytes = Buffer.alloc(1 + lines.line1.length + lines.line2.length);
  bytes[0] = 0x0c;
  bytes.write(lines.line1, 1, 'ascii');
  bytes.write(lines.line2, 1 + lines.line1.length, 'ascii');
  return { lines, bytes };
}

function normalizeParity(value) {
  const raw = String(value ?? 'None').trim().toLowerCase();
  if (raw.startsWith('e')) return 'E';
  if (raw.startsWith('o')) return 'O';
  return 'N';
}

function normalizeComPath(port) {
  const raw = String(port ?? '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('\\\\.\\')) return raw;
  if (/^COM\d+$/i.test(raw)) return `\\\\.\\${raw}`;
  return raw;
}

function sortPortEntries(entries) {
  const map = new Map();
  for (const entry of entries ?? []) {
    const path = String(entry?.path ?? '').trim().toUpperCase();
    if (!/^COM\d+$/.test(path)) continue;
    const label = String(entry?.label ?? path).trim() || path;
    const previous = map.get(path);
    // Preferir label mais descritivo (como no Device Manager)
    if (!previous || (label.length > previous.label.length && label.includes('('))) {
      map.set(path, { path, label });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => Number(a.path.replace('COM', '')) - Number(b.path.replace('COM', '')),
  );
}

async function runPowerShellJson(command) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  const raw = String(stdout ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function listWindowsComPorts() {
  const collected = [];

  // Mesma fonte visual do Device Manager: Ports (COM & LPT)
  try {
    const pnp = await runPowerShellJson(`
      $items = @()
      Get-PnpDevice -Class Ports -PresentOnly -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.FriendlyName -match '(COM\\d+)' -or $_.Name -match '(COM\\d+)') {
          $com = $Matches[1].ToUpper()
          $label = if ($_.FriendlyName) { $_.FriendlyName } else { $_.Name }
          $items += [PSCustomObject]@{ path = $com; label = $label }
        }
      }
      if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress }
    `);
    collected.push(...pnp);
  } catch {
    // ignore
  }

  // Nomes do sistema (GetPortNames)
  try {
    const names = await runPowerShellJson(`
      $ports = [System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object {
        [PSCustomObject]@{ path = $_.ToUpper(); label = $_.ToUpper() }
      }
      if (-not $ports) { '[]' } else { @($ports) | ConvertTo-Json -Compress }
    `);
    collected.push(...names);
  } catch {
    // ignore
  }

  // Registry SERIALCOMM (muito fiável no Windows)
  try {
    const registry = await runPowerShellJson(`
      $items = @()
      $key = Get-ItemProperty -Path 'HKLM:\\HARDWARE\\DEVICEMAP\\SERIALCOMM' -ErrorAction SilentlyContinue
      if ($key) {
        $key.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
          $com = [string]$_.Value
          if ($com -match '^COM\\d+$') {
            $items += [PSCustomObject]@{ path = $com.ToUpper(); label = $com.ToUpper() }
          }
        }
      }
      if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress }
    `);
    collected.push(...registry);
  } catch {
    // ignore
  }

  return sortPortEntries(collected);
}

export async function listSerialPorts() {
  if (process.platform === 'win32') {
    return listWindowsComPorts();
  }
  return [];
}

async function configureWindowsPort({ port, baudRate, dataBits, parity, stopBits }) {
  const com = String(port ?? '').trim().toUpperCase();
  if (!/^COM\d+$/i.test(com)) return;
  const args = [
    `${com}:`,
    `BAUD=${Number(baudRate) || 9600}`,
    `PARITY=${normalizeParity(parity)}`,
    `DATA=${Number(dataBits) || 8}`,
    `STOP=${Number(stopBits) || 1}`,
  ];
  try {
    await execFileAsync('mode', args, { windowsHide: true });
  } catch {
    // ignore
  }
}

export async function writeCustomerDisplay(options = {}) {
  const port = String(options.port ?? '').trim().toUpperCase();
  if (!port) {
    return { success: false, error: 'Seleccione a porta COM do display.' };
  }

  const width = Number(options.chars) || 20;
  const { lines, bytes } = buildCustomerDisplayPayload(
    options.line1 ?? '',
    options.line2 ?? '',
    width,
  );
  const devicePath = normalizeComPath(port);

  try {
    if (process.platform === 'win32' && /^COM\d+$/i.test(port)) {
      await configureWindowsPort({
        port,
        baudRate: options.baudRate,
        dataBits: options.dataBits,
        parity: options.parity,
        stopBits: options.stopBits,
      });
    }

    const fd = openSync(devicePath, 'w');
    try {
      writeSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
    return { success: true, port, line1: lines.line1, line2: lines.line2 };
  } catch (error) {
    return {
      success: false,
      port,
      error: String(error?.message ?? error ?? 'Falha ao escrever no display do cliente.'),
    };
  }
}
