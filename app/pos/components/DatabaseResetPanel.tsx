'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen } from 'lucide-react';
import { listDatabaseBackups, resetDatabase } from '@/lib/services/posService';

export default function DatabaseResetPanel() {
  const inputCls = () =>
    'w-full rounded border bg-pos-bg px-2.5 py-1.5 text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-[#0001fb] border-pos-border';

  const [resetBackupPath, setResetBackupPath] = useState('');
  const [resetSelections, setResetSelections] = useState({
    products: true,
    customers: true,
    documents: true,
  });
  const [adminPassword, setAdminPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void listDatabaseBackups()
      .then((data) => {
        if (data.backupsDir) setResetBackupPath(data.backupsDir);
      })
      .catch(() => {
        /* ignore — utilizador pode escolher pasta */
      });
  }, []);

  const handleSelectBackupFolder = useCallback(async () => {
    try {
      const selectedPath = await window.electronAPI?.selectFolder?.();
      if (!selectedPath) return;
      setResetBackupPath(selectedPath);
    } catch {
      setMessage({ type: 'err', text: 'Não foi possível abrir o seletor de pasta.' });
    }
  }, []);

  const handleResetDatabase = useCallback(async () => {
    const hasSelection = resetSelections.products || resetSelections.customers || resetSelections.documents;
    if (!hasSelection) {
      setMessage({ type: 'err', text: 'Selecione pelo menos uma entidade para redefinir.' });
      return;
    }
    if (!resetBackupPath.trim()) {
      setMessage({ type: 'err', text: 'Informe um caminho de backup válido.' });
      return;
    }
    if (!adminPassword.trim()) {
      setMessage({ type: 'err', text: 'Digite a senha do administrador para confirmar.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await resetDatabase({
        backupDir: resetBackupPath.trim(),
        adminPassword: adminPassword.trim(),
        resetProducts: resetSelections.products,
        resetCustomers: resetSelections.customers,
        resetDocuments: resetSelections.documents,
      });

      const deleted = result?.deleted ?? {};
      setMessage({
        type: 'ok',
        text: `Redefinição concluída. Backup: ${result?.backupFile ?? 'gerado'} | Produtos: ${Number(
          deleted.products ?? 0,
        )} | Clientes: ${Number(deleted.customers ?? 0)} | Documentos: ${Number(deleted.documents ?? 0)}`,
      });
      setAdminPassword('');
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Falha ao redefinir banco de dados' });
    } finally {
      setSaving(false);
    }
  }, [adminPassword, resetBackupPath, resetSelections]);

  return (
    <div className="max-w-3xl space-y-4 pt-4">
      {message ? (
        <div
          className={`rounded border px-3 py-2 text-[11px] ${
            message.type === 'ok'
              ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-200'
              : 'border-red-700/50 bg-red-950/30 text-red-200'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="rounded border border-yellow-700/70 bg-yellow-950/25 px-3 py-2 text-[11px] text-yellow-200/90">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} />
          <span>Esta é uma operação destrutiva. Por favor, certifique-se de ler as instruções antes de prosseguir.</span>
        </div>
      </div>

      <section className="rounded border border-pos-border/80 bg-pos-card p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0001fb] text-[12px] font-bold text-white">
            1
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold text-zinc-200">Local do backup do banco de dados</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              O backup do banco de dados será executado antes da redefinição. Pode alterar o destino padrão abaixo.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                className={inputCls()}
                value={resetBackupPath}
                onChange={(e) => setResetBackupPath(e.target.value)}
                placeholder="Ex.: C:\\Users\\SeuUsuario\\Documents\\POSly Backup"
              />
              <button
                type="button"
                onClick={() => void handleSelectBackupFolder()}
                className="inline-flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded border border-zinc-600 bg-transparent text-zinc-200 transition-colors hover:text-[#0001fb]"
                aria-label="Escolher pasta de backup"
                title="Escolher pasta"
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-pos-border/80 bg-pos-card p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0001fb] text-[12px] font-bold text-white">
            2
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold text-zinc-200">Selecione entidades para redefinir</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">As entidades selecionadas serão excluídas do banco de dados.</p>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300 transition-colors hover:text-[#0001fb]">
                <input
                  type="checkbox"
                  checked={resetSelections.products}
                  onChange={(e) => setResetSelections((s) => ({ ...s, products: e.target.checked }))}
                />
                Produtos
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300 transition-colors hover:text-[#0001fb]">
                <input
                  type="checkbox"
                  checked={resetSelections.customers}
                  onChange={(e) => setResetSelections((s) => ({ ...s, customers: e.target.checked }))}
                />
                Clientes
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300 transition-colors hover:text-[#0001fb]">
                <input
                  type="checkbox"
                  checked={resetSelections.documents}
                  onChange={(e) => setResetSelections((s) => ({ ...s, documents: e.target.checked }))}
                />
                Documentos
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-pos-border/80 bg-pos-card p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0001fb] text-[12px] font-bold text-white">
            3
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold text-zinc-200">Confirmação</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Autorize e execute a redefinição nas entidades selecionadas.</p>
            <div className="mt-2 max-w-[240px] space-y-2">
              <input
                type="password"
                className={inputCls()}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Digite a senha do administrador"
              />
              <button
                type="button"
                disabled={
                  saving ||
                  !adminPassword.trim() ||
                  !(resetSelections.products || resetSelections.customers || resetSelections.documents)
                }
                onClick={() => void handleResetDatabase()}
                className="inline-flex w-full items-center justify-center rounded border border-zinc-600 bg-transparent px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:text-[#0001fb] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Redefinir banco de dados
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

