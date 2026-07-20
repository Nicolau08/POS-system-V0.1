'use client';

import { useSyncStatus } from '@/hooks/useSyncStatus';

export function SyncStatus() {
  const { online, pending, failed, lastSync } = useSyncStatus();
  const isOffline = !online;
  const isSyncing = online && pending > 0;

  const dotClass = isOffline
    ? 'bg-red-500'
    : isSyncing
      ? 'bg-amber-400'
      : 'bg-[#0001fb]';

  const label = isOffline ? 'Offline' : isSyncing ? 'Syncing' : 'Online';
  const title = `Online: ${online ? 'sim' : 'não'} | Pending: ${pending} | Failed: ${failed}${lastSync ? ` | Último sync: ${new Date(lastSync).toLocaleString()}` : ''}`;

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-800 bg-zinc-900/70 text-zinc-400"
      title={title}
    >
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span className="text-[10px] font-bold uppercase tracking-wide leading-none">{label}</span>
    </div>
  );
}
