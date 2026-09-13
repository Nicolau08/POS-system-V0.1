'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, Loader2, Wallet, X } from 'lucide-react';
import { numberInputDisplayValue, parseNumberInput } from '@/lib/numberInput';
import {
  createCashMovement,
  ensureCashSession,
  withdrawCashSession,
  type CashSessionSnapshot,
} from '@/lib/cashSession';
import { fetchCustomers } from '@/lib/services/posService';

type TabId = 'movements' | 'float' | 'advances';
type MovementKind = 'in' | 'out' | 'float' | 'advance_in' | 'advance_out';

function money(n: number) {
  return Number(n || 0).toLocaleString('pt-MZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const KIND_LABEL: Record<MovementKind, string> = {
  in: 'Entrada',
  out: 'Saída',
  float: 'Fundo de maneio',
  advance_in: 'Adiantamento de cliente',
  advance_out: 'Adiantamento a fornecedor',
};

function kindIsOut(kind: MovementKind) {
  return kind === 'out' || kind === 'advance_out';
}

export function CashMovementModal({
  isOpen,
  onClose,
  operatorName,
  onToast,
}: {
  isOpen: boolean;
  onClose: () => void;
  operatorName?: string | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [tab, setTab] = useState<TabId>('movements');
  const [snapshot, setSnapshot] = useState<CashSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<MovementKind>('in');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [partyName, setPartyName] = useState('');
  const [parties, setParties] = useState<Array<{ id: string; name: string; is_supplier?: boolean }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, customers] = await Promise.all([
        ensureCashSession(),
        fetchCustomers().catch(() => []),
      ]);
      setSnapshot(data);
      setParties(customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a caixa');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTab('movements');
    setKind('in');
    setAmount('');
    setNote('');
    setPartyName('');
    void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (tab === 'float') setKind('float');
    else if (tab === 'advances') setKind((prev) => (prev === 'advance_out' ? 'advance_out' : 'advance_in'));
    else setKind((prev) => (prev === 'out' ? 'out' : 'in'));
  }, [tab]);

  const totals = snapshot?.totals;
  const cashAvailable = Number(totals?.cashAvailable || 0);
  const floatTotal = Number(totals?.floatTotal || 0);
  const cashSalesTotal = Number(totals?.cashSalesTotal || 0);
  const entriesTotal = cashSalesTotal + Number(totals?.movementIn || 0);
  const exitsTotal = Number(totals?.movementOut || 0) + Number(totals?.withdrawnTotal || 0);
  const dayCarryOverPending = Boolean(snapshot?.dayCarryOver?.pending);
  const dayCarryMessage =
    snapshot?.dayCarryOver?.message ||
    'O caixa de ontem não foi esvaziado. Retire o valor em dinheiro para avançar para o dia de hoje.';

  const settlePriorDay = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await withdrawCashSession('all');
      setSnapshot(next);
      if (next.dayAdvanced || !next.dayCarryOver?.pending) {
        onToast?.('Caixa de ontem esvaziado. Sessão do dia de hoje aberta.', 'success');
      } else {
        onToast?.(`Saque registado. Em caixa: ${money(Number(next.totals?.cashAvailable || 0))} MT`, 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao retirar o valor do caixa';
      setError(msg);
      onToast?.(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const ledger = useMemo(() => {
    if (Array.isArray(snapshot?.ledger)) return snapshot.ledger;
    const rows: NonNullable<CashSessionSnapshot['ledger']> = [];
    if (cashSalesTotal > 0) {
      rows.push({
        id: 'sales-cash',
        source: 'sale',
        kind: 'sale',
        amount: cashSalesTotal,
        direction: 1,
        label: 'Vendas em dinheiro',
        note: totals?.saleCount ? `${totals.saleCount} venda(s)` : null,
        createdAt: snapshot?.session?.openedAt,
      });
    }
    for (const movement of snapshot?.movements ?? []) {
      const direction: 1 | -1 = kindIsOut(movement.kind) ? -1 : 1;
      rows.push({
        id: movement.id,
        source: 'movement',
        kind: movement.kind,
        amount: movement.amount,
        direction,
        label: KIND_LABEL[movement.kind] || movement.kind,
        note: movement.note || null,
        partyName: movement.partyName || null,
        userName: movement.userName || null,
        createdAt: movement.createdAt,
      });
    }
    for (const withdrawal of snapshot?.withdrawals ?? []) {
      rows.push({
        id: withdrawal.id,
        source: 'withdraw',
        kind: 'withdraw',
        amount: withdrawal.amount,
        direction: -1,
        label: withdrawal.scope === 'all' ? 'Saque (todos)' : 'Saque',
        userName: withdrawal.userName || null,
        createdAt: withdrawal.createdAt,
      });
    }
    return rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [snapshot, cashSalesTotal, totals?.saleCount]);

  const visibleLedger = useMemo(() => {
    if (tab === 'float') return ledger.filter((row) => row.kind === 'float');
    if (tab === 'advances') return ledger.filter((row) => row.kind === 'advance_in' || row.kind === 'advance_out');
    return ledger.filter((row) => row.kind === 'sale' || row.kind === 'in' || row.kind === 'out' || row.kind === 'withdraw');
  }, [ledger, tab]);

  const submit = async () => {
    if (dayCarryOverPending) {
      setError(dayCarryMessage);
      return;
    }
    const value = parseNumberInput(amount);
    if (!(value > 0)) {
      setError('Indique um valor maior do que zero.');
      return;
    }
    if (kindIsOut(kind) && value > cashAvailable + 0.001) {
      setError(`Saída excede o dinheiro em caixa (${money(cashAvailable)} MT).`);
      return;
    }
    if ((kind === 'advance_in' || kind === 'advance_out') && !partyName.trim()) {
      setError(kind === 'advance_in' ? 'Indique o nome do cliente.' : 'Indique o nome do fornecedor.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const next = await createCashMovement({
        kind,
        amount: value,
        note: note.trim() || undefined,
        partyKind: kind === 'advance_in' ? 'customer' : kind === 'advance_out' ? 'supplier' : null,
        partyName: partyName.trim() || undefined,
      });
      setSnapshot(next);
      setAmount('');
      setNote('');
      setPartyName('');
      onToast?.(`${KIND_LABEL[kind]} registada (${money(value)} MT)`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao registar movimento';
      setError(msg);
      onToast?.(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const partyOptions = useMemo(() => {
    const wantSupplier = kind === 'advance_out';
    return parties.filter((p) => Boolean(p.is_supplier) === wantSupplier && p.name.trim());
  }, [kind, parties]);
  const operatorLabel = String(operatorName || snapshot?.session?.openedByName || '').trim();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 pos-modal-overlay"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="flex w-full max-w-[980px] max-h-[92vh] flex-col overflow-hidden rounded border border-pos-border bg-pos-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-pos-border px-5 py-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-pos-fg">Movimento de caixa</h2>
                <p className="mt-0.5 truncate text-xs text-pos-muted">
                  {operatorLabel ? `Operador: ${operatorLabel}` : 'Sessão actual'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-2 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {!loading ? (
              <div className="border-b border-pos-border bg-pos-surface-2 px-5 py-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-pos-muted">
                      Valor actual no caixa
                    </p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums text-pos-fg">
                      {money(cashAvailable)} <span className="text-sm font-semibold text-pos-muted">MT</span>
                    </p>
                  </div>
                  {dayCarryOverPending ? (
                    <button
                      type="button"
                      disabled={busy || cashAvailable <= 0}
                      onClick={() => void settlePriorDay()}
                      className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? 'A processar…' : `Retirar ${money(cashAvailable)} MT e abrir o dia`}
                    </button>
                  ) : null}
                </div>
                {dayCarryOverPending ? (
                  <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
                    {dayCarryMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-6 border-b border-pos-border px-5 pt-2">
              {(
                [
                  { id: 'movements' as const, label: 'Entradas e saídas' },
                  { id: 'float' as const, label: 'Fundo de maneio' },
                  { id: 'advances' as const, label: 'Adiantamentos' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                    tab === item.id
                      ? 'border-[#0001fb] text-pos-fg'
                      : 'border-transparent text-pos-muted hover:text-pos-fg'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {error ? (
                <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              ) : null}

              {loading ? (
                <div className="flex min-h-[240px] items-center justify-center gap-2 text-pos-muted">
                  <Loader2 className="animate-spin" size={18} /> A carregar a caixa…
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <SummaryCard label="Valor actual no caixa" value={cashAvailable} />
                      <SummaryCard label="Fundo de maneio" value={floatTotal} />
                      <SummaryCard label="Entradas" value={entriesTotal} positive />
                      <SummaryCard label="Saídas" value={exitsTotal} negative />
                    </div>

                    {tab === 'movements' ? (
                      <div className="flex gap-2">
                        <KindButton
                          active={kind === 'in'}
                          icon={<ArrowDownLeft size={16} />}
                          label="Entrada"
                          onClick={() => setKind('in')}
                        />
                        <KindButton
                          active={kind === 'out'}
                          icon={<ArrowUpRight size={16} />}
                          label="Saída"
                          onClick={() => setKind('out')}
                        />
                      </div>
                    ) : null}

                    {tab === 'float' ? (
                      <p className="text-sm text-pos-muted">
                        Registe o valor colocado na gaveta (abertura ou reforço). Entra no dinheiro em caixa
                        e distingue-se das vendas do dia.
                      </p>
                    ) : null}

                    {tab === 'advances' ? (
                      <div className="flex gap-2">
                        <KindButton
                          active={kind === 'advance_in'}
                          icon={<ArrowDownLeft size={16} />}
                          label="Cliente"
                          onClick={() => setKind('advance_in')}
                        />
                        <KindButton
                          active={kind === 'advance_out'}
                          icon={<ArrowUpRight size={16} />}
                          label="Fornecedor"
                          onClick={() => setKind('advance_out')}
                        />
                      </div>
                    ) : null}

                    {(kind === 'advance_in' || kind === 'advance_out') && (
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-pos-muted">
                          {kind === 'advance_in' ? 'Cliente' : 'Fornecedor'}
                        </span>
                        <input
                          list="cash-movement-parties"
                          value={partyName}
                          onChange={(e) => setPartyName(e.target.value)}
                          placeholder={kind === 'advance_in' ? 'Nome do cliente' : 'Nome do fornecedor'}
                          className="h-11 w-full rounded border border-pos-border bg-pos-field px-3 text-sm text-pos-fg outline-none focus:border-[#0001fb]"
                        />
                        <datalist id="cash-movement-parties">
                          {partyOptions.map((p) => (
                            <option key={p.id} value={p.name} />
                          ))}
                        </datalist>
                      </label>
                    )}

                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-pos-muted">Valor (MT)</span>
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={numberInputDisplayValue(amount)}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="h-11 w-full rounded border border-pos-border bg-pos-field px-3 text-right font-mono text-sm text-pos-fg outline-none focus:border-[#0001fb]"
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-pos-muted">Nota (opcional)</span>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          tab === 'float'
                            ? 'Ex.: fundo de abertura'
                            : tab === 'advances'
                              ? 'Ex.: adiantamento encomenda'
                              : 'Ex.: sangria / reforço'
                        }
                        className="h-11 w-full rounded border border-pos-border bg-pos-field px-3 text-sm text-pos-fg outline-none focus:border-[#0001fb]"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={busy || dayCarryOverPending}
                      onClick={() => void submit()}
                      className="pos-on-accent inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-[#0001fb] text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
                      {dayCarryOverPending
                        ? 'Movimentos bloqueados — retire o caixa de ontem'
                        : `Registar ${KIND_LABEL[kind].toLowerCase()}`}
                    </button>
                  </div>

                  <div className="overflow-hidden rounded border border-pos-border bg-pos-bg">
                    <div className="border-b border-pos-border px-4 py-2.5 text-xs font-semibold text-pos-muted">
                      {tab === 'float'
                        ? 'Fundo de maneio desta sessão'
                        : tab === 'advances'
                          ? 'Adiantamentos desta sessão'
                          : 'Vendas e movimentos desta sessão'}
                    </div>
                    <div className="max-h-[420px] space-y-1 overflow-y-auto p-3">
                      {visibleLedger.length === 0 ? (
                        <p className="px-1 py-8 text-center text-sm text-pos-muted">
                          Ainda não há movimentos neste separador.
                        </p>
                      ) : (
                        visibleLedger.map((row) => {
                          const out = row.direction < 0;
                          return (
                            <div
                              key={row.id}
                              className="flex items-start justify-between gap-3 rounded border border-pos-border bg-pos-field px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-pos-fg">
                                  {row.label}
                                  {row.partyName ? ` · ${row.partyName}` : ''}
                                </div>
                                <div className="mt-0.5 text-[11px] text-pos-muted">
                                  {formatWhen(row.createdAt || '')}
                                  {row.userName ? ` · ${row.userName}` : ''}
                                  {row.note ? ` · ${row.note}` : ''}
                                </div>
                              </div>
                              <span className={`shrink-0 font-mono text-sm font-semibold ${out ? 'text-red-600' : 'text-emerald-600'}`}>
                                {out ? '−' : '+'}
                                {money(row.amount)}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-pos-border px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="pos-on-accent inline-flex h-11 min-w-[140px] items-center justify-center gap-2 rounded bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-500"
              >
                <X size={16} />
                Fechar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SummaryCard({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded border border-pos-border bg-pos-bg px-3 py-2.5">
      <div className="text-[11px] font-medium text-pos-muted">{label}</div>
      <div
        className={`mt-0.5 font-mono text-sm font-semibold ${
          negative ? 'text-red-600' : positive ? 'text-emerald-600' : 'text-pos-fg'
        }`}
      >
        {money(value)} MT
      </div>
    </div>
  );
}

function KindButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'pos-on-accent border-[#0001fb] bg-[#0001fb] text-white'
          : 'border-pos-border bg-pos-field text-pos-fg hover:border-[#0001fb]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
