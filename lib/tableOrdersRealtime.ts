/**
 * Cliente SSE (fetch stream) para pedidos de mesa partilhados.
 * Preferir API directa (não proxy Next) para evitar buffering.
 */
import { getPosApiDirectBase, getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';

export type TableOrdersSseEvent = {
  type?: string;
  tableKey?: string | null;
  updatedAt?: string | null;
  cleared?: boolean;
  at?: string;
};

function eventsUrl(): string {
  const direct = getPosApiDirectBase().replace(/\/$/, '');
  const proxy = getPosApiBase().replace(/\/$/, '');
  // SSE: preferir URL directa da API
  const base = direct || proxy;
  return `${base}/pos/table-orders/events`;
}

/**
 * Liga ao stream SSE. Devolve função de cancelamento.
 * onEvent: chamado em cada mudança (depois deve-se fazer pull).
 * onStatus: 'connected' | 'disconnected' | 'error'
 */
export function subscribeSharedTableOrderEvents(opts: {
  onEvent: (event: TableOrdersSseEvent) => void;
  onStatus?: (status: 'connected' | 'disconnected' | 'error') => void;
}): () => void {
  const ac = new AbortController();
  let stopped = false;

  const run = async () => {
    while (!stopped && !ac.signal.aborted) {
      try {
        const res = await fetch(eventsUrl(), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...getPosUserAuthHeaders(),
          },
          signal: ac.signal,
          cache: 'no-store',
        });
        if (!res.ok || !res.body) {
          opts.onStatus?.('error');
          await sleep(2000, ac.signal);
          continue;
        }
        opts.onStatus?.('connected');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped && !ac.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const chunk of parts) {
            const event = parseSseChunk(chunk);
            if (event) opts.onEvent(event);
          }
        }
        opts.onStatus?.('disconnected');
      } catch (err) {
        if (ac.signal.aborted || stopped) break;
        opts.onStatus?.('error');
        await sleep(2500, ac.signal);
      }
    }
  };

  void run();

  return () => {
    stopped = true;
    ac.abort();
  };
}

function parseSseChunk(chunk: string): TableOrdersSseEvent | null {
  const lines = chunk.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    else if (line.startsWith(':')) {
      /* heartbeat */
    }
  }
  if (eventName === 'ready') return { type: 'ready' };
  if (eventName !== 'table-orders' || !dataLines.length) return null;
  try {
    return JSON.parse(dataLines.join('\n')) as TableOrdersSseEvent;
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
