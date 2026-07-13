import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

/** Converte "1B700019FA" / "1B 70 00 19 FA" / "0x1B,0x70..." em Buffer. */
export function parseEscPosHexCommand(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^\\x/gi, '')
    .replace(/0x/gi, '')
    .replace(/[,;\s:_-]+/g, '');
  if (!text) return null;
  if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) return null;
  const bytes = [];
  for (let i = 0; i < text.length; i += 2) {
    bytes.push(Number.parseInt(text.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes);
}

/** Comandos ESC/POS típicos para abrir gaveta (pin 2 e pin 5). */
export function defaultDrawerCommands() {
  return [
    Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]), // ESC p 0 25 250
    Buffer.from([0x1b, 0x70, 0x01, 0x19, 0xfa]), // ESC p 1 25 250
  ];
}

function buildRawPrintPowerShell(printerName, base64Payload) {
  // Winspool WritePrinter com datatype RAW — necessário para ESC/POS na XP-80C.
  const safePrinter = String(printerName).replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static string Send(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      return "OpenPrinter failed: " + Marshal.GetLastWin32Error();
    }
    var di = new DOCINFOA();
    di.pDocName = "POSly RAW";
    di.pDataType = "RAW";
    if (StartDocPrinter(hPrinter, 1, di) == 0) {
      int err = Marshal.GetLastWin32Error();
      ClosePrinter(hPrinter);
      return "StartDocPrinter failed: " + err;
    }
    StartPagePrinter(hPrinter);
    IntPtr p = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, p, bytes.Length);
      int written;
      bool ok = WritePrinter(hPrinter, p, bytes.Length, out written);
      if (!ok) {
        int err = Marshal.GetLastWin32Error();
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        return "WritePrinter failed: " + err;
      }
    } finally {
      Marshal.FreeHGlobal(p);
    }
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return "OK";
  }
}
"@
$bytes = [Convert]::FromBase64String('${base64Payload}')
$result = [PosRawPrinter]::Send('${safePrinter}', $bytes)
Write-Output $result
`.trim();
}

export async function sendRawToWindowsPrinter(printerName, data) {
  const name = String(printerName ?? '').trim();
  if (!name) {
    return { success: false, error: 'Seleccione a impressora de recibos.' };
  }
  if (!Buffer.isBuffer(data) || data.length === 0) {
    return { success: false, error: 'Comando RAW vazio.' };
  }
  if (process.platform !== 'win32') {
    return { success: false, error: 'Envio RAW só está implementado no Windows.' };
  }

  const base64 = data.toString('base64');
  const script = buildRawPrintPowerShell(name, base64);
  const scriptPath = path.join(os.tmpdir(), `posly-raw-${Date.now()}.ps1`);

  try {
    await fs.writeFile(scriptPath, script, 'utf8');
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    const output = String(stdout ?? '').trim();
    if (output === 'OK') {
      return { success: true, printer: name, bytes: data.length };
    }
    return {
      success: false,
      printer: name,
      error: output || String(stderr ?? '').trim() || 'Falha ao enviar RAW para a impressora.',
    };
  } catch (error) {
    return {
      success: false,
      printer: name,
      error: String(error?.message ?? error ?? 'Falha ao enviar RAW.'),
    };
  } finally {
    await fs.unlink(scriptPath).catch(() => {});
  }
}

export async function openCashDrawer({ printer, command, tryBothPins = true } = {}) {
  const custom = parseEscPosHexCommand(command);
  const payloads = [];
  if (custom?.length) payloads.push(custom);
  if (tryBothPins || !custom?.length) {
    for (const cmd of defaultDrawerCommands()) {
      if (!payloads.some((existing) => existing.equals(cmd))) {
        payloads.push(cmd);
      }
    }
  }

  let lastError = 'Nenhum comando de gaveta enviado.';
  for (const payload of payloads) {
    const result = await sendRawToWindowsPrinter(printer, payload);
    if (result.success) {
      return {
        success: true,
        printer: result.printer,
        commandHex: Buffer.from(payload).toString('hex').toUpperCase(),
      };
    }
    lastError = result.error || lastError;
  }
  return { success: false, error: lastError, printer };
}
