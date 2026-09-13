'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  DoorOpen,
  Info,
  Loader2,
  Printer,
  Users,
  User,
  X,
} from 'lucide-react';
import { PosSwitch } from '@/components/PosSwitch';
import {
  closeCashSession,
  ensureCashSession,
  fetchReportX,
  fetchZReportDetail,
  fetchZReportHistory,
  printCashReport,
  withdrawCashSession,
  type CashSessionSnapshot,
  type CashReportPayload,
} from '@/lib/cashSession';

type WithdrawOption = 'user' | 'all' | 'close' | null;
type MainTab = 'day' | 'history';
type DetailTab = 'open' | 'dayTotal';

function money(n: number) {
  return Number(n || 0).toLocaleString('pt-MZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-PT');
}

function formatDateTime(iso: string) {
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

function ActionTile({
  selected,
  disabled,
  icon,
  label,
  onClick,
}: {
  selected?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-[108px] h-[108px] rounded border flex flex-col items-center justify-center gap-2 px-2 text-center transition-all ${
        selected
          ? 'pos-on-accent bg-[#0001fb] border-[#0001fb] text-white shadow-[0_0_0_1px_rgba(0,1,251,0.35)]'
          : 'bg-pos-field border-pos-border text-pos-fg hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)]'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span className={selected ? 'text-white' : 'text-[#0001fb]'}>{icon}</span>
      <span className="text-[11px] font-semibold leading-tight">{label}</span>
    </button>
  );
}

export function EndOfDayModal({
  isOpen,
  onClose,
  companyName,
  operatorName,
  onToast,
}: {
  isOpen: boolean;
  onClose: () => void;
  companyName?: string | null;
  operatorName?: string | null;
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [mainTab, setMainTab] = useState<MainTab>('day');
  const [option, setOption] = useState<WithdrawOption>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('open');
  const [snapshot, setSnapshot] = useState<CashSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printItems, setPrintItems] = useState(true);
  const [printZ, setPrintZ] = useState(true);
  const [history, setHistory] = useState<Array<{ id: string; zNumber: number; generatedAt: string }>>([]);
  const [selectedZId, setSelectedZId] = useState<string | null>(null);
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [historyTo, setHistoryTo] = useState(() => new Date().toISOString().slice(0, 10));

  const toast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      onToast?.(message, type);
    },
    [onToast],
  );

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ensureCashSession();
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar sessão');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const fromIso = `${historyFrom}T00:00:00.000Z`;
      const toIso = `${historyTo}T23:59:59.999Z`;
      const data = await fetchZReportHistory(fromIso, toIso);
      setHistory(data.items || []);
      if (!selectedZId && data.items?.[0]) setSelectedZId(data.items[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar histórico');
    }
  }, [historyFrom, historyTo, selectedZId]);

  useEffect(() => {
    if (!isOpen) return;
    setMainTab('day');
    setOption(null);
    setPrintModalOpen(false);
    void loadSession();
  }, [isOpen, loadSession]);

  useEffect(() => {
    if (!isOpen || mainTab !== 'history') return;
    void loadHistory();
  }, [isOpen, mainTab, loadHistory]);

  const dayLabel = useMemo(() => {
    const opened = snapshot?.session?.openedAt;
    return opened ? formatDate(opened) : formatDate(new Date().toISOString());
  }, [snapshot?.session?.openedAt]);

  const totals = snapshot?.totals;
  const cashForOption =
    option === 'user' ? Number(totals?.userCashAvailable || 0) : Number(totals?.cashAvailable || 0);
  const saqueNeedsCash = option === 'user' || option === 'all';
  const canContinue = option != null && !busy && (!saqueNeedsCash || cashForOption > 0);
  const operatorLabel = String(operatorName || snapshot?.session?.openedByName || '').trim();

  const handlePrintX = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await fetchReportX();
      await printCashReport(report, companyName || 'POSly');
      toast('Relatório X enviado para impressão', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao imprimir Relatório X';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    if (!option) return;
    if (option === 'close') {
      setPrintModalOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await withdrawCashSession(option);
      setSnapshot(next);
      toast(
        option === 'all'
          ? `Saque de todos registado (${money(next.totals?.withdrawnTotal || 0)})`
          : 'Saque do operador registado',
        'success',
      );
      setOption(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha no saque';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmClose = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await closeCashSession({ printItems, printZ });
      if (printZ || printItems) {
        await printCashReport(result.report, companyName || 'POSly');
      }
      toast(
        result.backup?.fileName
          ? `Caixa fechado — Z nº ${result.zNumber} · backup ${result.backup.fileName}`
          : `Caixa fechado — Relatório Z nº ${result.zNumber}`,
        'success',
      );
      setPrintModalOpen(false);
      onClose();
      // Reabrir sessão automaticamente para o próximo turno
      void ensureCashSession().catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao fechar caixa';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReprintZ = async () => {
    if (!selectedZId) return;
    setBusy(true);
    try {
      const detail = await fetchZReportDetail(selectedZId);
      if (!detail.report) throw new Error('Payload do Relatório Z em falta');
      await printCashReport(detail.report as CashReportPayload, companyName || 'POSly');
      toast(`Relatório Z nº ${detail.zNumber} reimpresso`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao reimprimir';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

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
            className="w-full max-w-[1100px] max-h-[92vh] overflow-hidden rounded border border-pos-border bg-pos-surface shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-pos-border">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-pos-fg tracking-tight">Fim do dia</h2>
                {operatorLabel ? (
                  <p className="mt-0.5 truncate text-xs text-pos-muted">
                    Operador: {operatorLabel}
                    {snapshot?.session?.openedAt ? ` · Aberto ${formatDateTime(snapshot.session.openedAt)}` : ''}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded text-pos-muted hover:text-pos-fg hover:bg-pos-surface-3 transition-colors"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-5 pt-2 border-b border-pos-border flex gap-6">
              {(
                [
                  { id: 'day' as const, label: 'Fim do dia' },
                  { id: 'history' as const, label: 'Histórico' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMainTab(tab.id)}
                  className={`pb-2.5 text-sm font-medium transition-colors border-b-2 ${
                    mainTab === tab.id
                      ? 'text-pos-fg border-[#0001fb]'
                      : 'text-pos-muted border-transparent hover:text-pos-fg'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {error && (
                <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 text-red-600 text-sm px-3 py-2">
                  {error}
                </div>
              )}

              {mainTab === 'day' ? (
                <div className="space-y-5">
                  <p className="text-sm text-pos-muted">Seleccione a opção de saque ou fecho</p>

                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-wrap gap-3">
                      <ActionTile
                        selected={option === 'user'}
                        icon={<User size={28} strokeWidth={1.75} />}
                        label="Saque"
                        onClick={() => setOption('user')}
                      />
                      <ActionTile
                        selected={option === 'all'}
                        icon={<Users size={28} strokeWidth={1.75} />}
                        label="Saque de todos os utilizadores"
                        onClick={() => setOption('all')}
                      />
                      <ActionTile
                        selected={option === 'close'}
                        icon={<DoorOpen size={28} strokeWidth={1.75} />}
                        label="Fechar caixa"
                        onClick={() => setOption('close')}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void handlePrintX()}
                      disabled={busy || loading}
                      className="w-[108px] h-[108px] rounded border border-pos-border bg-pos-field hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] text-pos-fg flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-40"
                      title="Imprimir Relatório X"
                    >
                      <span className="text-4xl font-black leading-none tracking-tight text-[#0001fb]">X</span>
                      <span className="text-[10px] font-bold tracking-[0.12em] text-pos-muted">
                        RELATÓRIO
                      </span>
                    </button>
                  </div>

                  {loading ? (
                    <div className="min-h-[240px] flex items-center justify-center text-pos-muted gap-2">
                      <Loader2 className="animate-spin" size={18} /> A carregar sessão…
                    </div>
                  ) : !option ? (
                    <div className="min-h-[240px] flex items-center justify-center rounded border border-pos-border bg-pos-bg text-pos-muted text-sm px-6 text-center">
                      Opção não seleccionada. Escolha saque, saque de todos ou fechar caixa para continuar.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[260px]">
                      {/* Left summary */}
                      <div className="rounded border border-pos-border bg-pos-bg overflow-hidden">
                        <div className="flex border-b border-pos-border">
                          <button
                            type="button"
                            onClick={() => setDetailTab('open')}
                            className={`flex-1 px-3 py-2.5 text-xs font-semibold ${
                              detailTab === 'open'
                                ? 'text-pos-fg border-b-2 border-[#0001fb] bg-pos-field'
                                : 'text-pos-muted'
                            }`}
                          >
                            Sessão aberta
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailTab('dayTotal')}
                            className={`flex-1 px-3 py-2.5 text-xs font-semibold ${
                              detailTab === 'dayTotal'
                                ? 'text-pos-fg border-b-2 border-[#0001fb] bg-pos-field'
                                : 'text-pos-muted'
                            }`}
                          >
                            Total do dia ({dayLabel})
                          </button>
                        </div>
                        <div className="p-4 space-y-2">
                          {detailTab === 'dayTotal' && (
                            <div className="text-[11px] uppercase tracking-wide text-pos-muted mb-2">
                              Meios de pagamento
                            </div>
                          )}
                          {(totals?.byTender || []).map((t) => (
                            <div
                              key={t.label}
                              className="flex justify-between text-sm text-pos-fg"
                            >
                              <span className="font-semibold uppercase">{t.label}</span>
                              <span>{money(t.amount)}</span>
                            </div>
                          ))}
                          {(!totals?.byTender || totals.byTender.length === 0) && (
                            <p className="text-sm text-pos-muted">Sem vendas nesta sessão.</p>
                          )}
                          <div className="flex justify-between pt-3 mt-2 border-t border-pos-border">
                            <span className="font-bold text-pos-fg">TOTAL</span>
                            <span className="font-bold text-[#0001fb] text-lg">
                              {money(totals?.salesTotal || 0)}
                            </span>
                          </div>
                          <div className="text-xs text-pos-muted pt-1 space-y-1">
                            <div>
                              Dinheiro disponível:{' '}
                              <span className="text-pos-fg font-medium">
                                {money(cashForOption)}
                              </span>
                            </div>
                            {saqueNeedsCash && cashForOption <= 0 ? (
                              <p className="text-amber-600">
                                Não há dinheiro em caixa para este saque.
                              </p>
                            ) : null}
                            {option === 'close' ? (
                              <p>O fecho emite o Relatório Z e cria um backup automático.</p>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Right per-user */}
                      <div className="rounded border border-pos-border bg-pos-bg overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-pos-border text-xs font-semibold text-pos-muted">
                          Por operador
                        </div>
                        <div className="p-4 space-y-5 max-h-[320px] overflow-y-auto">
                          {(totals?.byUser || []).map((u) => (
                            <div key={u.userId}>
                              <div className="font-bold text-pos-fg text-sm mb-2 tracking-wide">
                                {u.userName}
                              </div>
                              {u.byTender.map((t) => (
                                <div
                                  key={`${u.userId}-${t.label}`}
                                  className="flex justify-between text-sm text-pos-muted py-0.5"
                                >
                                  <span className="uppercase">{t.label}</span>
                                  <span>{money(t.amount)}</span>
                                </div>
                              ))}
                              <div className="flex justify-between pt-2 mt-1 border-t border-pos-border/80">
                                <span className="font-bold text-pos-fg text-sm">TOTAL</span>
                                <span className="font-bold text-[#0001fb]">
                                  {money(u.total)}
                                </span>
                              </div>
                            </div>
                          ))}
                          {(!totals?.byUser || totals.byUser.length === 0) && (
                            <p className="text-sm text-pos-muted">Sem operadores com vendas.</p>
                          )}
                          {(snapshot?.withdrawals || []).length > 0 ? (
                            <div className="pt-2 border-t border-pos-border">
                              <div className="text-xs font-semibold text-pos-muted mb-2">Saques desta sessão</div>
                              {snapshot?.withdrawals.map((w) => (
                                <div key={w.id} className="flex justify-between text-sm text-pos-fg py-0.5">
                                  <span>
                                    {w.scope === 'all' ? 'Todos' : w.userName || 'Operador'}
                                  </span>
                                  <span>-{money(w.amount)}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded border border-[#0001fb]/35 bg-[#0001fb]/10 px-4 py-3">
                    <Info className="text-[#0001fb] shrink-0 mt-0.5" size={18} />
                    <p className="text-sm text-pos-fg">
                      Use a lista abaixo para seleccionar e imprimir uma cópia de qualquer Relatório Z
                      gerado anteriormente.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="flex items-center gap-2 text-sm text-pos-fg">
                      <input
                        type="date"
                        value={historyFrom}
                        onChange={(e) => setHistoryFrom(e.target.value)}
                        className="h-9 rounded bg-pos-field border border-pos-border px-2 text-sm text-pos-fg"
                      />
                      <span className="text-pos-muted">—</span>
                      <input
                        type="date"
                        value={historyTo}
                        onChange={(e) => setHistoryTo(e.target.value)}
                        className="h-9 rounded bg-pos-field border border-pos-border px-2 text-sm text-pos-fg"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!selectedZId || busy}
                      onClick={() => void handleReprintZ()}
                      className="h-10 px-4 rounded border border-pos-border bg-pos-field text-sm text-pos-fg inline-flex items-center gap-2 disabled:opacity-40 hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)]"
                    >
                      <Printer size={16} />
                      Imprimir relatório seleccionado
                    </button>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-pos-fg mb-2">Relatórios</h3>
                    <div className="rounded border border-pos-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-pos-bg text-pos-muted text-xs uppercase">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium">Número</th>
                            <th className="text-left px-3 py-2 font-medium">Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.length === 0 && (
                            <tr>
                              <td colSpan={2} className="px-3 py-8 text-center text-pos-muted">
                                Nenhum Relatório Z neste período.
                              </td>
                            </tr>
                          )}
                          {history.map((row) => (
                            <tr
                              key={row.id}
                              onClick={() => setSelectedZId(row.id)}
                              className={`border-t border-pos-border cursor-pointer ${
                                selectedZId === row.id
                                  ? 'bg-[#0001fb]/10 outline outline-1 outline-[#0001fb]/50'
                                  : 'hover:bg-pos-field'
                              }`}
                            >
                              <td className="px-3 py-2.5 text-pos-fg font-medium">{row.zNumber}</td>
                              <td className="px-3 py-2.5 text-pos-muted">
                                {formatDateTime(row.generatedAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {mainTab === 'day' && (
              <div className="px-5 py-4 border-t border-pos-border flex justify-end gap-3">
                <button
                  type="button"
                  disabled={!canContinue}
                  onClick={() => void handleContinue()}
                  className={`h-11 min-w-[140px] px-5 rounded font-semibold text-sm inline-flex items-center justify-center gap-2 transition-all ${
                    canContinue
                      ? 'pos-on-accent bg-[#0001fb] hover:bg-[#1a1bff] text-white'
                      : 'border border-pos-border bg-pos-surface-3 text-pos-muted cursor-not-allowed'
                  }`}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Continuar
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 min-w-[140px] px-5 rounded pos-on-accent bg-red-600 hover:bg-red-500 text-white font-semibold text-sm inline-flex items-center justify-center gap-2"
                >
                  <X size={16} />
                  Cancelar
                </button>
              </div>
            )}
          </motion.div>

          {/* Print close modal */}
          <AnimatePresence>
            {printModalOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[110] flex items-center justify-center p-4 pos-modal-overlay"
                onClick={() => !busy && setPrintModalOpen(false)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="w-full max-w-md rounded border border-pos-border bg-pos-surface p-5 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-semibold text-pos-fg mb-2">
                    Imprimir relatórios de fecho
                  </h3>
                  <p className="text-sm text-pos-muted mb-5">
                    Seleccione relatórios para imprimir. A impressão usa a impressora
                    definida em Opções de impressão (lista do Windows).
                  </p>

                  <div className="space-y-4 mb-6">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-pos-fg">Imprimir produtos vendidos</span>
                      <PosSwitch checked={printItems} onChange={setPrintItems} />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-pos-fg">Imprimir Relatório Z (totais)</span>
                      <PosSwitch checked={printZ} onChange={setPrintZ} />
                    </div>
                  </div>

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      disabled={busy || (!printItems && !printZ)}
                      onClick={() => void handleConfirmClose()}
                      className="h-11 px-5 rounded pos-on-accent bg-[#0001fb] hover:bg-[#1a1bff] disabled:opacity-40 text-white font-semibold text-sm inline-flex items-center gap-2"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                      Continuar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPrintModalOpen(false)}
                      className="h-11 px-5 rounded pos-on-accent bg-red-600 hover:bg-red-500 text-white font-semibold text-sm inline-flex items-center gap-2"
                    >
                      <X size={16} />
                      Cancelar
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
