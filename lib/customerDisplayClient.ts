import {
  buildCustomerDisplayLines,
  buildCustomerDisplayPayload,
  type CustomerDisplayView,
} from '@/lib/customerDisplayFormat';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { extractApiErrorMessage, unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { loadPosSettings, type PosSettings } from '@/lib/posSettings';

export type CustomerDisplayWriteResult = {
  success: boolean;
  softOnly?: boolean;
  port?: string;
  error?: string;
};

export type SerialPortOption = {
  path: string;
  label: string;
};

type WebSerialLikePort = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open: (options: Record<string, unknown>) => Promise<void>;
};

let webSerialPort: WebSerialLikePort | null = null;
let webSerialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
let lastPayloadKey = '';

function settingsOrLoaded(settings?: PosSettings | null): PosSettings {
  return settings ?? loadPosSettings();
}

function normalizePortOptions(ports: Array<{ path?: string; label?: string } | string>): SerialPortOption[] {
  const map = new Map<string, SerialPortOption>();
  for (const entry of ports) {
    const path =
      typeof entry === 'string'
        ? entry.trim().toUpperCase()
        : String(entry?.path ?? '').trim().toUpperCase();
    if (!/^COM\d+$/.test(path)) continue;
    const label =
      typeof entry === 'string'
        ? path
        : String(entry?.label ?? path).trim() || path;
    const previous = map.get(path);
    if (!previous || label.length > previous.label.length) {
      map.set(path, { path, label });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => Number(a.path.replace('COM', '')) - Number(b.path.replace('COM', '')),
  );
}

export function getCustomerDisplayView(
  line1: string,
  line2: string,
  settings?: PosSettings | null,
): CustomerDisplayView {
  const cfg = settingsOrLoaded(settings);
  const width = Number(cfg.customerDisplayChars) || 20;
  const lines = buildCustomerDisplayLines(line1, line2, width);
  return { ...lines, width };
}

async function writeViaElectron(
  line1: string,
  line2: string,
  settings: PosSettings,
): Promise<CustomerDisplayWriteResult> {
  if (!window.electronAPI?.writeCustomerDisplay) {
    return { success: false, error: 'API Electron indisponível' };
  }
  if (!settings.customerDisplayPort) {
    return { success: false, error: 'Seleccione a porta COM do display.' };
  }
  return window.electronAPI.writeCustomerDisplay({
    line1,
    line2,
    port: settings.customerDisplayPort,
    baudRate: Number(settings.customerDisplayBaud) || 9600,
    dataBits: Number(settings.customerDisplayDataBits) || 8,
    parity: settings.customerDisplayParity || 'None',
    stopBits: Number(settings.customerDisplayStopBits) || 1,
    flowControl: settings.customerDisplayFlowControl || 'None',
    chars: Number(settings.customerDisplayChars) || 20,
  });
}

async function writeViaApi(
  line1: string,
  line2: string,
  settings: PosSettings,
): Promise<CustomerDisplayWriteResult> {
  if (!settings.customerDisplayPort) {
    return { success: false, error: 'Seleccione a porta COM do display.' };
  }
  try {
    const response = await fetch(`${getPosApiBase()}/customer-display/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getPosUserAuthHeaders(),
      },
      body: JSON.stringify({
        line1,
        line2,
        port: settings.customerDisplayPort,
        baudRate: Number(settings.customerDisplayBaud) || 9600,
        dataBits: Number(settings.customerDisplayDataBits) || 8,
        parity: settings.customerDisplayParity || 'None',
        stopBits: Number(settings.customerDisplayStopBits) || 1,
        flowControl: settings.customerDisplayFlowControl || 'None',
        chars: Number(settings.customerDisplayChars) || 20,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error: extractApiErrorMessage(payload, `Falha HTTP ${response.status}`),
      };
    }
    try {
      const data = unwrapApiSuccessPayload<{
        success?: boolean;
        port?: string;
        error?: string;
      }>(payload);
      return {
        success: true,
        port: data?.port,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : extractApiErrorMessage(payload, 'Falha no display'),
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao contactar API do display',
    };
  }
}

async function ensureWebSerialPort(allowPicker: boolean): Promise<boolean> {
  if (webSerialPort && webSerialWriter) return true;
  const nav = navigator as Navigator & {
    serial?: {
      requestPort: () => Promise<WebSerialLikePort>;
    };
  };
  if (!nav.serial) return false;
  try {
    if (!allowPicker && !webSerialPort) return false;
    const port = webSerialPort ?? (await nav.serial.requestPort().catch(() => null));
    if (!port) return false;
    const settings = loadPosSettings();
    if (!port.writable) {
      await port.open({
        baudRate: Number(settings.customerDisplayBaud) || 9600,
        dataBits: Number(settings.customerDisplayDataBits) || 8,
        stopBits: Number(settings.customerDisplayStopBits) || 1,
        parity: String(settings.customerDisplayParity || 'none').toLowerCase(),
        flowControl:
          String(settings.customerDisplayFlowControl || 'none').toLowerCase() === 'hardware'
            ? 'hardware'
            : 'none',
      });
    }
    webSerialPort = port;
    webSerialWriter = port.writable?.getWriter() ?? null;
    return Boolean(webSerialWriter);
  } catch {
    return false;
  }
}

async function writeViaWebSerial(
  line1: string,
  line2: string,
  settings: PosSettings,
  allowPicker: boolean,
): Promise<CustomerDisplayWriteResult> {
  const ok = await ensureWebSerialPort(allowPicker);
  if (!ok || !webSerialWriter) {
    return { success: false, error: 'Web Serial indisponível ou porta não seleccionada' };
  }
  try {
    const payload = buildCustomerDisplayPayload(
      line1,
      line2,
      Number(settings.customerDisplayChars) || 20,
    );
    await webSerialWriter.write(payload);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao escrever no display',
    };
  }
}

export async function writeCustomerDisplay(
  line1: string,
  line2: string,
  options?: { settings?: PosSettings | null; force?: boolean; allowPortPicker?: boolean },
): Promise<CustomerDisplayWriteResult> {
  const settings = settingsOrLoaded(options?.settings);
  if (!settings.customerDisplayEnabled && !options?.force) {
    return { success: false, error: 'Display do cliente desactivado' };
  }
  if (!String(settings.customerDisplayPort || '').trim()) {
    return { success: false, error: 'Seleccione a porta COM do display.' };
  }

  const view = getCustomerDisplayView(line1, line2, settings);
  const payloadKey = `${view.line1}|${view.line2}|${view.width}|${settings.customerDisplayPort}`;
  if (!options?.force && payloadKey === lastPayloadKey) {
    return { success: true, softOnly: true };
  }
  lastPayloadKey = payloadKey;

  if (window.electronAPI?.writeCustomerDisplay) {
    return writeViaElectron(view.line1, view.line2, settings);
  }

  const apiResult = await writeViaApi(view.line1, view.line2, settings);
  if (apiResult.success) return apiResult;

  if (options?.allowPortPicker || webSerialPort) {
    const serialResult = await writeViaWebSerial(
      view.line1,
      view.line2,
      settings,
      Boolean(options?.allowPortPicker),
    );
    if (serialResult.success) return serialResult;
  }

  return {
    success: false,
    error: apiResult.error || 'Falha ao enviar para o display do cliente.',
  };
}

export async function listCustomerDisplayPorts(): Promise<SerialPortOption[]> {
  const collected: Array<{ path?: string; label?: string } | string> = [];

  if (window.electronAPI?.listSerialPorts) {
    try {
      const result = await window.electronAPI.listSerialPorts();
      if (result?.success && Array.isArray(result.ports)) {
        collected.push(...result.ports);
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const response = await fetch(`${getPosApiBase()}/serial-ports`, {
      headers: { ...getPosUserAuthHeaders() },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractApiErrorMessage(payload, `Falha ao listar portas (${response.status})`));
    }
    const data = unwrapApiSuccessPayload<{
      paths?: string[];
      ports?: Array<{ path?: string; label?: string }>;
    }>(payload);
    if (Array.isArray(data?.ports)) collected.push(...data.ports);
    if (Array.isArray(data?.paths)) collected.push(...data.paths.map(String));
  } catch (error) {
    if (!collected.length) {
      throw error instanceof Error
        ? error
        : new Error('Falha ao listar portas COM. Reinicie o servidor (npm run dev:tenant).');
    }
  }

  return normalizePortOptions(collected);
}

export function resetCustomerDisplayCache() {
  lastPayloadKey = '';
}
