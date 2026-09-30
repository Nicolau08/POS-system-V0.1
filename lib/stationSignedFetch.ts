/**
 * Etapa 1G.3.4 - no modo posto (Electron) todo o pedido para o Store Server passa pelo processo MAIN, que assina com a
 * chave privada da Station (que nunca chega ao renderer). Aqui so se converte o pedido em bytes e se devolve a resposta.
 * Um unico ponto: window.fetch e embrulhado uma vez, por isso os ~90 fetch() existentes ficam assinados sem alteracao.
 */
import { isStationClientMode, loadStationClientSettings } from '@/lib/stationClientSettings';

const INSTALLED = '__poslyStationSignedFetch';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function bodyBytes(input: RequestInfo | URL, init?: RequestInit): Promise<Uint8Array | null> {
  const body = init?.body;
  if (body === undefined || body === null) {
    if (typeof Request !== 'undefined' && input instanceof Request && input.body) return new Uint8Array(await input.clone().arrayBuffer());
    return null;
  }
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  // FormData/Blob/stream: nao ha bytes exactos previsiveis -> falha fechada (nunca se assina um corpo diferente do enviado)
  throw new TypeError('Corpo de pedido não suportado no modo posto (só texto/JSON/bytes).');
}

export function installStationSignedFetch(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown> & { electronAPI?: { stationFetch?: (r: unknown) => Promise<any> } };
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const settings = loadStationClientSettings();
    const base = String(settings.serverApiBaseUrl ?? '').replace(/\/$/, '');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!isStationClientMode(settings) || !base || !url.startsWith(base)) return original(input, init);
    // Etapa 1G.3.5: modo posto sem IPC de pedidos assinados (fora do Electron, build antigo, preload em falta) FALHA FECHADO:
    // nunca cai silenciosamente para um fetch HTTP normal ao Store Server.
    if (typeof w.electronAPI?.stationFetch !== 'function') {
      throw new TypeError('Modo posto: identidade segura da Station indisponível (IPC em falta). Pedido ao servidor bloqueado.');
    }

    const method = String(init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers: Record<string, string> = {};
    const collect = (h?: HeadersInit) => {
      if (!h) return;
      new Headers(h).forEach((v, k) => {
        headers[k] = v;
      });
    };
    if (typeof Request !== 'undefined' && input instanceof Request) collect(input.headers);
    collect(init?.headers);
    const bytes = await bodyBytes(input, init);
    const r = await w.electronAPI!.stationFetch!({ url, method, headers, bodyBase64: bytes ? toBase64(bytes) : null });
    if (!r?.success) throw new TypeError(String(r?.error ?? 'Falha no pedido assinado da Station'));
    const noBody = [101, 204, 205, 304].includes(r.status);
    return new Response(noBody ? null : (fromBase64(r.bodyBase64 ?? '') as unknown as BodyInit), {
      status: r.status,
      headers: r.headers as [string, string][],
    });
  };
}
