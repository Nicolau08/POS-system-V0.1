'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, DatabaseBackup, KeyRound, RefreshCw, RotateCcw } from 'lucide-react';
import {
  createDatabaseBackup,
  exportDbRecoveryKey,
  fetchDbEncryptionStatus,
  listDatabaseBackups,
  restoreDatabaseBackup,
  unwrapDbRecoveryKey,
  type DatabaseBackupRow,
  type DbEncryptionStatus,
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

function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DatabaseBackupPanel() {
  const [backups, setBackups] = useState<DatabaseBackupRow[]>([]);
  const [backupsDir, setBackupsDir] = useState<string>('');
  const [databasePath, setDatabasePath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);

  const [encStatus, setEncStatus] = useState<DbEncryptionStatus | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showUnwrap, setShowUnwrap] = useState(false);
  const [ackRisk, setAckRisk] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [wrapPassword, setWrapPassword] = useState('');
  const [wrapPasswordConfirm, setWrapPasswordConfirm] = useState('');
  const [unwrapFileText, setUnwrapFileText] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [data, status] = await Promise.all([
        listDatabaseBackups(),
        fetchDbEncryptionStatus().catch(() => null),
      ]);
      setBackups(data.backups);
      setBackupsDir(data.backupsDir ?? '');
      setDatabasePath(data.databasePath ?? '');
      setEncStatus(status);
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

  const resetRecoveryForm = () => {
    setEnteredPin('');
    setWrapPassword('');
    setWrapPasswordConfirm('');
    setAckRisk(false);
    setUnwrapFileText('');
    setRevealedKey(null);
  };

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

  const handleExportRecovery = async () => {
    if (!ackRisk) {
      setMessage({ type: 'err', text: 'Confirme que compreende o risco antes de exportar.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportDbRecoveryKey({
        enteredPin,
        wrapPassword,
        wrapPasswordConfirm,
      });
      downloadJson(result.fileName, result.recoveryPackage);
      setShowExport(false);
      resetRecoveryForm();
      setMessage({
        type: 'ok',
        text:
          result.warning ||
          `Ficheiro ${result.fileName} transferido. Guarde-o offline com a senha do ficheiro.`,
      });
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Falha ao exportar chave',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUnwrapRecovery = async () => {
    setBusy(true);
    setMessage(null);
    setRevealedKey(null);
    try {
      let recoveryPackage: unknown;
      try {
        recoveryPackage = JSON.parse(unwrapFileText);
      } catch {
        throw new Error('Cole o conteúdo JSON válido do ficheiro de recuperação.');
      }
      const result = await unwrapDbRecoveryKey({
        enteredPin,
        wrapPassword,
        recoveryPackage,
      });
      setRevealedKey(result.keyHex);
      setMessage({
        type: 'ok',
        text: result.warning || 'Chave revelada. Use só para esta instalação.',
      });
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Falha ao desbloquear chave',
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
        {encStatus ? (
          <>
            <br />
            Encriptação SQLCipher:{' '}
            <span className={encStatus.encryptionConfigured ? 'text-emerald-400' : 'text-amber-400'}>
              {encStatus.encryptionConfigured ? 'activa neste processo' : 'não activa (ex.: modo dev)'}
            </span>
            {encStatus.databaseMarkedEncrypted ? ' · BD marcada como encriptada' : ''}
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
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            resetRecoveryForm();
            setShowUnwrap(false);
            setShowExport(true);
          }}
          className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-transparent px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:border-amber-500 hover:text-amber-200 disabled:opacity-40"
        >
          <KeyRound size={14} />
          Exportar chave de recuperação
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            resetRecoveryForm();
            setShowExport(false);
            setShowUnwrap(true);
          }}
          className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-transparent px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40"
        >
          <KeyRound size={14} />
          Abrir ficheiro de recuperação
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

      {showExport ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md rounded border border-zinc-700 bg-[#1a1a1a] p-5 space-y-3">
            <div className="flex gap-3 text-amber-300">
              <KeyRound size={22} className="shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Chave de recuperação (esta loja)</h3>
                <p className="mt-1 text-[11px] text-zinc-400 leading-relaxed">
                  Gera um ficheiro cifrado só para{' '}
                  <strong className="text-zinc-200">esta instalação</strong>. Não existe senha master
                  global. Quem tiver o ficheiro e a senha do ficheiro pode ler a BD.
                </p>
              </div>
            </div>
            <label className="flex items-start gap-2 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                checked={ackRisk}
                onChange={(e) => setAckRisk(e.target.checked)}
                className="mt-0.5"
              />
              Compreendo o risco e vou guardar o ficheiro offline (não email / chat).
            </label>
            <input
              type="password"
              inputMode="numeric"
              placeholder="O seu PIN de administrador"
              value={enteredPin}
              onChange={(e) => setEnteredPin(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-[#0f0f0f] px-3 py-2 text-[12px] text-white"
            />
            <input
              type="password"
              placeholder="Senha do ficheiro (mín. 8)"
              value={wrapPassword}
              onChange={(e) => setWrapPassword(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-[#0f0f0f] px-3 py-2 text-[12px] text-white"
            />
            <input
              type="password"
              placeholder="Confirmar senha do ficheiro"
              value={wrapPasswordConfirm}
              onChange={(e) => setWrapPasswordConfirm(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-[#0f0f0f] px-3 py-2 text-[12px] text-white"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setShowExport(false);
                  resetRecoveryForm();
                }}
                className="rounded border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || !ackRisk}
                onClick={() => void handleExportRecovery()}
                className="rounded bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
              >
                {busy ? 'A exportar…' : 'Exportar ficheiro'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showUnwrap ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded border border-zinc-700 bg-[#1a1a1a] p-5 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-white">Abrir ficheiro de recuperação</h3>
              <p className="mt-1 text-[11px] text-zinc-400 leading-relaxed">
                Cole o JSON do ficheiro exportado. A chave é revelada uma vez para suporte/migração desta
                loja — não a grave em sítios inseguros.
              </p>
            </div>
            <textarea
              value={unwrapFileText}
              onChange={(e) => setUnwrapFileText(e.target.value)}
              rows={6}
              placeholder='{"v":1,"alg":"aes-256-gcm",...}'
              className="w-full rounded border border-zinc-700 bg-[#0f0f0f] px-3 py-2 font-mono text-[11px] text-white"
            />
            <input
              type="password"
              inputMode="numeric"
              placeholder="O seu PIN de administrador"
              value={enteredPin}
              onChange={(e) => setEnteredPin(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-[#0f0f0f] px-3 py-2 text-[12px] text-white"
            />
            <input
              type="password"
              placeholder="Senha do ficheiro"
              value={wrapPassword}
              onChange={(e) => setWrapPassword(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-[#0f0f0f] px-3 py-2 text-[12px] text-white"
            />
            {revealedKey ? (
              <div className="space-y-2 rounded border border-emerald-800/50 bg-emerald-950/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-emerald-400">Chave (hex)</p>
                <code className="block break-all text-[11px] text-emerald-100">{revealedKey}</code>
                <button
                  type="button"
                  className="rounded border border-emerald-700 px-2 py-1 text-[11px] text-emerald-200"
                  onClick={() => void navigator.clipboard?.writeText(revealedKey)}
                >
                  Copiar
                </button>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setShowUnwrap(false);
                  resetRecoveryForm();
                }}
                className="rounded border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300"
              >
                Fechar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleUnwrapRecovery()}
                className="rounded bg-[#0001fb] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'A desbloquear…' : 'Desbloquear chave'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
