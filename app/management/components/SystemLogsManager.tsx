'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import PosSelect from '@/components/PosSelect';

type LogSource = 'app' | 'audit' | 'sync';

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

const SOURCE_TABS: Array<{ id: LogSource; label: string }> = [
  { id: 'app', label: 'Operacionais' },
  { id: 'sync', label: 'Sincronismo' },
  { id: 'audit', label: 'Auditoria' },
];

function actionBadgeClass(level: string, event: string) {
  const lvl = String(level || '').toLowerCase();
  const ev = String(event || '').toLowerCase();
  if (lvl === 'error' || ev.includes('delete') || ev.includes('fail') || ev.includes('blocked')) {
    return 'bg-red-500/20 text-red-300 border-red-500/35';
  }
  if (lvl === 'warn' || ev.includes('skip') || ev.includes('change') || ev.includes('update')) {
    return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
  }
  if (ev.includes('create') || ev.includes('insert') || ev.includes('add')) {
    return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
  }
  if (ev.includes('sync')) {
    return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
  }
  if (lvl === 'debug') {
    return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
  }
  return 'bg-zinc-500/15 text-zinc-200 border-zinc-500/30';
}

function formatActionLabel(event: string) {
  const raw = String(event || '').trim();
  if (!raw) return 'Evento';
  const parts = raw.split('.');
  const last = parts[parts.length - 1] || raw;
  return last.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: value, time: '' };
  return {
    date: d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export default function SystemLogsManager({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<LogSource>('app');
  const [level, setLevel] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      setExpandedId(null);
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

  const subtitle = useMemo(() => {
    if (source === 'audit') return 'Alterações de negócio e acções de utilizadores.';
    if (source === 'sync') return 'Eventos de sincronização com a cloud.';
    return 'Actividade operacional da aplicação.';
  }, [source]);

  const applySearch = () => setQ(qDraft.trim());

  const handleRefresh = () => {
    const next = qDraft.trim();
    if (next !== q) {
      setQ(next);
      return;
    }
    void load();
  };

  return (
    <div className={`h-full flex flex-col gap-5 ${embedded ? 'p-0' : 'p-4'}`}>
      {!embedded ? (
        <div>
          <h2 className="text-xl font-semibold text-white tracking-tight">Actividade</h2>
          <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>
        </div>
      ) : (
        <p className="text-sm text-zinc-500 -mt-1">{subtitle}</p>
      )}

      <div className="inline-flex w-fit rounded-lg bg-zinc-900/90 p-1 border border-zinc-800">
        {SOURCE_TABS.map((tab) => {
          const active = source === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSource(tab.id);
                setLevel('');
              }}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySearch();
            }}
            placeholder="Pesquisar histórico…"
            className="w-full h-10 rounded-lg bg-zinc-900 border border-zinc-700/80 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
          />
        </div>

        {source === 'app' ? (
          <PosSelect
            value={level}
            onChange={setLevel}
            options={[
              { value: '', label: 'Todos os níveis' },
              { value: 'error', label: 'Erros' },
              { value: 'warn', label: 'Avisos' },
              { value: 'info', label: 'Info' },
            ]}
            size="md"
            className="w-[180px]"
            triggerClassName="!bg-zinc-900 !border-zinc-700/80"
          />
        ) : null}

        <button
          type="button"
          onClick={handleRefresh}
          className="h-10 px-3 rounded-lg bg-zinc-900 border border-zinc-700/80 text-zinc-300 text-sm hover:bg-zinc-800 hover:text-white inline-flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>

        <span className="ml-auto text-xs text-zinc-500">{total} registos</span>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm px-3 py-2">
          {error}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-zinc-800/80 bg-[#141414]">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[#1a1a1a] text-zinc-500 text-[11px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3 font-medium w-[72px]">ID</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Data</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Hora</th>
              <th className="px-4 py-3 font-medium min-w-[140px]">Acção</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-zinc-500">
                  Sem actividade para os filtros seleccionados.
                </td>
              </tr>
            ) : null}
            {items.map((item) => {
              const { date, time } = formatDate(item.when);
              const expanded = expandedId === item.id;
              const whereLine = [item.where?.module, item.where?.action].filter(Boolean).join(' · ');

              return (
                <tr
                  key={item.id}
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  className={`border-b border-zinc-800/70 cursor-pointer transition-colors ${
                    expanded ? 'bg-zinc-900/70' : 'hover:bg-zinc-900/40'
                  }`}
                >
                  <td className="px-4 py-3.5 align-top text-zinc-500 font-mono text-xs">
                    {String(item.id).slice(0, 8)}
                  </td>
                  <td className="px-4 py-3.5 align-top text-zinc-300 whitespace-nowrap">{date}</td>
                  <td className="px-4 py-3.5 align-top text-zinc-400 whitespace-nowrap">{time}</td>
                  <td className="px-4 py-3.5 align-top">
                    <span
                      className={`inline-flex max-w-[180px] truncate px-2 py-1 rounded-md border text-[11px] font-medium ${actionBadgeClass(
                        item.level,
                        item.event,
                      )}`}
                      title={item.event}
                    >
                      {formatActionLabel(item.event)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <div className="text-zinc-200 leading-snug truncate">
                      {item.message}
                      {(item.why || whereLine) ? (
                        <span className="text-zinc-500">
                          {' — '}
                          {[whereLine, item.why].filter(Boolean).join(' — ')}
                        </span>
                      ) : null}
                    </div>
                    {expanded ? (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="text-zinc-500">
                          Evento: <span className="font-mono text-zinc-300">{item.event}</span>
                          {' · '}
                          Nível: <span className="uppercase text-zinc-300">{item.level}</span>
                          {item.who?.name || item.who?.id ? (
                            <>
                              {' · '}
                              Utilizador:{' '}
                              <span className="text-zinc-300">{item.who?.name || item.who?.id}</span>
                            </>
                          ) : null}
                        </div>
                        {item.error != null ? (
                          <pre className="text-red-300 whitespace-pre-wrap break-all bg-black/40 rounded-lg p-2.5 border border-red-500/20">
                            {typeof item.error === 'string'
                              ? item.error
                              : JSON.stringify(item.error, null, 2)}
                          </pre>
                        ) : null}
                        <pre className="text-zinc-400 whitespace-pre-wrap break-all bg-black/40 rounded-lg p-2.5 border border-zinc-800 max-h-48 overflow-auto">
                          {JSON.stringify(item.context ?? {}, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
