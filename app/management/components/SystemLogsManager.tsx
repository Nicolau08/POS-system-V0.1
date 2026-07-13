'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ScrollText, Search } from 'lucide-react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

type LogItem = {
  id: string;
  level: string;
  event: string;
  message: string;
  when: string;
  where?: { source?: string | null; module?: string | null; action?: string | null };
  why?: string | null;
  who?: { id?: string | null; name?: string | null; role?: string | null };
  context?: Record<string, unknown>;
  error?: unknown;
};

function levelClass(level: string) {
  switch (String(level).toLowerCase()) {
    case 'error':
      return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'warn':
      return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'debug':
      return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30';
    default:
      return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
  }
}

function formatWhen(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function SystemLogsManager() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'app' | 'audit' | 'sync'>('app');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<LogItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('source', source);
      params.set('limit', '150');
      if (level && source === 'app') params.set('level', level);
      if (q.trim()) params.set('q', q.trim());

      const res = await fetch(`${getPosApiBase()}/system/logs?${params}`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      if (!res.ok) {
        throw new Error(res.status === 403 ? 'Sem permissão para ver logs' : 'Falha ao carregar logs');
      }
      const json = await res.json();
      const data = unwrapApiSuccessPayload<{ items?: LogItem[]; total?: number }>(json) ?? json;
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total ?? 0));
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar logs');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [level, q, source]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ScrollText size={20} className="text-zinc-400" />
            Logs do sistema
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            O quê aconteceu, quando, onde e porquê — operacional e auditoria.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="h-10 px-4 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium inline-flex items-center gap-2"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as 'app' | 'audit' | 'sync')}
          className="h-10 rounded bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-200"
        >
          <option value="app">Operacionais</option>
          <option value="sync">Sincronismo</option>
          <option value="audit">Auditoria</option>
        </select>
        {source === 'app' && (
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-10 rounded bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-200"
          >
            <option value="">Todos os níveis</option>
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
          </select>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load();
            }}
            placeholder="Pesquisar mensagem, evento, módulo…"
            className="w-full h-10 rounded bg-zinc-900 border border-zinc-700 pl-9 pr-3 text-sm text-zinc-200"
          />
        </div>
        <span className="text-xs text-zinc-500">{total} registos</span>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-3">
        <div className="overflow-auto rounded border border-zinc-800 bg-zinc-950/60">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 font-medium">Quando</th>
                <th className="px-3 py-2 font-medium">Nível</th>
                <th className="px-3 py-2 font-medium">Evento</th>
                <th className="px-3 py-2 font-medium">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                    Sem logs para os filtros seleccionados.
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelected(item)}
                  className={`border-t border-zinc-800/80 cursor-pointer hover:bg-zinc-900/80 ${
                    selected?.id === item.id ? 'bg-zinc-900' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-zinc-400 whitespace-nowrap text-xs">
                    {formatWhen(item.when)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${levelClass(
                        item.level,
                      )}`}
                    >
                      {item.level}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-300 font-mono text-xs">{item.event}</td>
                  <td className="px-3 py-2 text-zinc-200 truncate max-w-[420px]">{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-4 overflow-auto">
          {!selected ? (
            <p className="text-sm text-zinc-500">Seleccione um registo para ver o detalhe completo.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase text-zinc-500 tracking-wide">Mensagem</div>
                <div className="text-white font-medium mt-1">{selected.message}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase text-zinc-500">Quando</div>
                  <div className="text-zinc-200 mt-1">{formatWhen(selected.when)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500">Evento</div>
                  <div className="text-zinc-200 mt-1 font-mono text-xs">{selected.event}</div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-zinc-500">Onde</div>
                <div className="text-zinc-200 mt-1">
                  {[selected.where?.source, selected.where?.module, selected.where?.action]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-zinc-500">Porquê</div>
                <div className="text-zinc-200 mt-1">{selected.why || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-zinc-500">Quem</div>
                <div className="text-zinc-200 mt-1">
                  {selected.who?.name || selected.who?.id
                    ? `${selected.who?.name ?? '—'} (${selected.who?.id ?? '—'})`
                    : '—'}
                </div>
              </div>
              {selected.error != null && (
                <div>
                  <div className="text-xs uppercase text-zinc-500">Erro</div>
                  <pre className="mt-1 text-xs text-red-300 whitespace-pre-wrap break-all bg-black/40 rounded p-2 border border-red-500/20">
                    {typeof selected.error === 'string'
                      ? selected.error
                      : JSON.stringify(selected.error, null, 2)}
                  </pre>
                </div>
              )}
              <div>
                <div className="text-xs uppercase text-zinc-500">Contexto</div>
                <pre className="mt-1 text-xs text-zinc-400 whitespace-pre-wrap break-all bg-black/40 rounded p-2 border border-zinc-800">
                  {JSON.stringify(selected.context ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
