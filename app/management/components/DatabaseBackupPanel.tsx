'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, DatabaseBackup, RefreshCw, RotateCcw } from 'lucide-react';
import {
  createDatabaseBackup,
  listDatabaseBackups,
  restoreDatabaseBackup,
  type DatabaseBackupRow,
} from '@/lib/services/posService';

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-MZ');
  } catch {
    return iso;
  }
}

export default function DatabaseBackupPanel() {
  const [backups, setBackups] = useState<DatabaseBackupRow[]>([]);
  const [backupsDir, setBackupsDir] = useState<string>('');
  const [databasePath, setDatabasePath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await listDatabaseBackups();
      setBackups(data.backups);
      setBackupsDir(data.backupsDir ?? '');
      setDatabasePath(data.databasePath ?? '');
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Falha ao listar cópias de segurança',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const backup = await createDatabaseBackup();
      setMessage({
        type: 'ok',
        text: `Cópia criada: ${backup?.fileName ?? 'OK'}`,
      });
      await load();
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Falha ao criar cópia',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (fileName: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const restored = await restoreDatabaseBackup(fileName);
      setConfirmFile(null);
      const needsRestart = Boolean(restored?.requiresRestart);
      setMessage({
        type: 'ok',
        text: needsRestart
          ? `Base restaurada a partir de ${fileName}. Reinicie a aplicação POSly para continuar.`
          : `Base restaurada a partir de ${fileName}.`,
      });
      if (needsRestart && typeof window !== 'undefined' && window.electronAPI?.restartApp) {
        const doRestart = window.confirm(
          'A base de dados foi restaurada. É necessário reiniciar a aplicação agora. Reiniciar?',
        );
        if (doRestart) {
          await window.electronAPI.restartApp();
        }
      }
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Falha ao restaurar',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4 pt-4">
      <div className="rounded border border-zinc-800/80 bg-[#141414] px-3 py-2 text-[11px] text-zinc-400">
        Cópias automáticas a cada algumas horas. Ficheiro da base:{' '}
        <code className="text-zinc-300">{databasePath || 'database.db'}</code>
        {backupsDir ? (
          <>
            <br />
            Pasta: <code className="text-zinc-300">{backupsDir}</code>
          </>
        ) : null}
      </div>

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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void handleCreate()}
          className="inline-flex items-center gap-1.5 rounded bg-[#0001fb] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1a1bff] disabled:opacity-40"
        >
          <DatabaseBackup size={14} />
          Criar cópia agora
        </button>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-transparent px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:border-[#0001fb] hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={14} />
          Actualizar lista
        </button>
      </div>

      <div className="overflow-hidden rounded border border-zinc-800">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-[#1a1a1a] text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Ficheiro</th>
              <th className="px-3 py-2 font-semibold">Data</th>
              <th className="px-3 py-2 font-semibold">Tamanho</th>
              <th className="px-3 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  A carregar…
                </td>
              </tr>
            ) : backups.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  Ainda sem cópias de segurança.
                </td>
              </tr>
            ) : (
              backups.map((row) => (
                <tr key={row.fileName} className="border-t border-zinc-800/80">
                  <td className="px-3 py-2 font-mono text-zinc-200">
                    {row.fileName}
                    {row.kind === 'pre-restore' ? (
                      <span className="ml-2 text-[10px] text-amber-400">pré-restauro</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{formatWhen(row.createdAt)}</td>
                  <td className="px-3 py-2 text-zinc-400">{formatBytes(row.sizeBytes)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmFile(row.fileName)}
                      className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-amber-500 hover:text-amber-300 disabled:opacity-40"
                    >
                      <RotateCcw size={12} />
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmFile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded border border-zinc-700 bg-[#1a1a1a] p-5 space-y-4">
            <div className="flex gap-3 text-amber-300">
              <AlertTriangle size={22} className="shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Restaurar base de dados?</h3>
                <p className="mt-1 text-[11px] text-zinc-400 leading-relaxed">
                  Os dados actuais serão substituídos por{' '}
                  <code className="text-zinc-200">{confirmFile}</code>. Será criada uma cópia de
                  segurança automática antes. Depois do restauro, reinicie a aplicação.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmFile(null)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRestore(confirmFile)}
                className="rounded bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
              >
                {busy ? 'A restaurar…' : 'Sim, restaurar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
