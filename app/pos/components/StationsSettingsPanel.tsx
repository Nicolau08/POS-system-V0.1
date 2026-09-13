'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { PosSwitch } from '@/components/PosSwitch';
import PosSelect from '@/components/PosSelect';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import {
  loadStationClientSettings,
  normalizeServerApiBaseUrl,
  normalizeStationMode,
  normalizeStationRole,
  saveStationClientSettings,
  stationRoleLabel,
  type StationClientSettings,
  type StationMode,
  type StationRole,
} from '@/lib/stationClientSettings';

type ServerSettings = {
  lanAccessEnabled: boolean;
  discoveryEnabled: boolean;
  port: number;
  localAddresses: string[];
  restartHint?: string;
};

type StationRow = {
  id: string;
  code: string;
  name: string;
  role: StationRole;
  active: boolean;
};

export function StationsSettingsPanel() {
  const [client, setClient] = useState<StationClientSettings>(() => loadStationClientSettings());
  const [server, setServer] = useState<ServerSettings | null>(null);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [message, setMessage] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<
    Array<{ url: string; store_name?: string; tenant_id?: string; port?: number }>
  >([]);
  const [draftStation, setDraftStation] = useState({ code: '', name: '', role: 'caixa' as StationRole });

  const persistClient = useCallback((next: StationClientSettings) => {
    setClient(next);
    saveStationClientSettings(next);
  }, []);

  const loadServerSide = useCallback(async () => {
    if (client.stationMode === 'client') return;
    try {
      const base = getPosApiBase().replace(/\/$/, '');
      const res = await fetch(`${base}/stations/server-settings`, {
        headers: { ...getPosUserAuthHeaders() },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      const data = json?.success ? json.data : json;
      if (res.ok && data) {
        setServer({
          lanAccessEnabled: Boolean(data.lanAccessEnabled ?? data.effectiveLanAccess),
          discoveryEnabled: Boolean(data.discoveryEnabled ?? true),
          port: Number(data.port) || 3001,
          localAddresses: Array.isArray(data.localAddresses) ? data.localAddresses : [],
          restartHint: data.restartHint,
        });
      }
      const stRes = await fetch(`${base}/stations`, {
        headers: { ...getPosUserAuthHeaders() },
        cache: 'no-store',
      });
      const stJson = await stRes.json().catch(() => null);
      const rows = stJson?.success ? stJson.data : stJson;
      if (stRes.ok && Array.isArray(rows)) {
        setStations(
          rows.map((r: StationRow) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            role: normalizeStationRole(r.role),
            active: r.active !== false,
          })),
        );
      }
    } catch {
      // offline
    }
  }, [client.stationMode]);

  useEffect(() => {
    void loadServerSide();
  }, [loadServerSide]);

  const setMode = (mode: StationMode) => {
    persistClient({ ...client, stationMode: mode });
    setMessage(
      mode === 'client'
        ? 'Modo posto: indique a URL do servidor ou use «Procurar na rede».'
        : mode === 'server'
          ? 'Modo servidor da loja. Active o acesso LAN se quiser postos na rede.'
          : '',
    );
  };

  const testConnection = async () => {
    const url = normalizeServerApiBaseUrl(client.serverApiBaseUrl);
    if (!url) {
      setTestStatus('Indique a URL do servidor.');
      return;
    }
    setTestStatus('A testar…');
    try {
      const res = await fetch(`${url}/station/discover`, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      const data = json?.success ? json.data : json;
      if (res.ok && data?.app === 'posly') {
        setTestStatus(`OK — ${data.store_name || data.tenant_id || url}`);
        return;
      }
      const ping = await fetch(`${url}/`, { cache: 'no-store' });
      if (ping.ok) {
        setTestStatus('API alcançável (descoberta pode estar desactivada).');
        return;
      }
      setTestStatus(`Falha HTTP ${res.status}`);
    } catch (err) {
      setTestStatus(`Sem ligação: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const scanLan = async () => {
    setScanning(true);
    setDiscovered([]);
    setTestStatus('A varrer a rede…');
    try {
      const result = await window.electronAPI?.scanLanStations?.();
      if (!result?.success) {
        setTestStatus(result?.error || 'Varredura só disponível na app desktop (Electron).');
        return;
      }
      const list = Array.isArray(result.servers) ? result.servers : [];
      setDiscovered(list);
      setTestStatus(list.length ? `${list.length} servidor(es) encontrado(s).` : 'Nenhum servidor POSly encontrado.');
    } catch (err) {
      setTestStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const connectTo = (url: string) => {
    persistClient({
      ...client,
      stationMode: 'client',
      serverApiBaseUrl: normalizeServerApiBaseUrl(url),
    });
    setMessage('Ligado como posto. Reinicie a app se a API local ainda estiver activa.');
    setTestStatus(`URL: ${normalizeServerApiBaseUrl(url)}`);
  };

  const saveServerToggles = async (patch: Partial<ServerSettings>) => {
    try {
      const base = getPosApiBase().replace(/\/$/, '');
      const res = await fetch(`${base}/stations/server-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify({
          lanAccessEnabled: patch.lanAccessEnabled ?? server?.lanAccessEnabled,
          discoveryEnabled: patch.discoveryEnabled ?? server?.discoveryEnabled,
        }),
      });
      const json = await res.json().catch(() => null);
      const data = json?.success ? json.data : json;
      if (!res.ok) {
        setMessage(String(data?.error || data?.message || 'Falha ao guardar.'));
        return;
      }
      setServer({
        lanAccessEnabled: Boolean(data.lanAccessEnabled),
        discoveryEnabled: Boolean(data.discoveryEnabled),
        port: Number(data.port) || 3001,
        localAddresses: Array.isArray(data.localAddresses) ? data.localAddresses : [],
        restartHint: data.restartHint,
      });
      // Espelhar no Electron para o próximo arranque
      void window.electronAPI?.saveStationRuntimeConfig?.({
        mode: 'server',
        lanAccessEnabled: Boolean(data.lanAccessEnabled),
        discoveryEnabled: Boolean(data.discoveryEnabled),
      });
      setMessage(data.restartHint || 'Definições do servidor guardadas.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const saveStationRow = async () => {
    const code = draftStation.code.trim().toLowerCase().replace(/\s+/g, '-');
    if (code.length < 2) {
      setMessage('Código do posto inválido.');
      return;
    }
    try {
      const base = getPosApiBase().replace(/\/$/, '');
      const res = await fetch(`${base}/stations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify({
          code,
          name: draftStation.name.trim() || code,
          role: draftStation.role,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMessage(String(json.error || json.message || 'Falha ao guardar posto.'));
        return;
      }
      setDraftStation({ code: '', name: '', role: 'caixa' });
      await loadServerSide();
      setMessage('Posto guardado.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="max-w-2xl space-y-6 text-sm">
      <p className="text-zinc-400">
        O mesmo aplicativo pode ser <strong className="text-zinc-200">servidor da loja</strong> (API +
        base) ou <strong className="text-zinc-200">posto</strong> (liga ao servidor na LAN). A licença
        fica no servidor; os postos herdam-na.
      </p>

      <div className="space-y-3 rounded border border-pos-border bg-pos-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Modo desta instalação</p>
        <PosSelect
          value={client.stationMode === 'unset' ? 'server' : client.stationMode}
          onChange={(v) => setMode(normalizeStationMode(v))}
          options={[
            { value: 'server', label: 'Servidor da loja' },
            { value: 'client', label: 'Posto remoto (cliente)' },
          ]}
          size="md"
          className="max-w-[320px]"
          triggerClassName="!bg-pos-bg !border-zinc-600"
        />
      </div>

      {(client.stationMode === 'server' || client.stationMode === 'unset') && (
        <div className="space-y-4 rounded border border-pos-border bg-pos-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Servidor</p>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-zinc-200">Acesso LAN</p>
              <p className="text-xs text-zinc-500">Permite login e API a partir de outros PCs na rede.</p>
            </div>
            <PosSwitch
              checked={Boolean(server?.lanAccessEnabled)}
              onChange={(v) => void saveServerToggles({ lanAccessEnabled: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-zinc-200">Permitir descoberta na rede</p>
              <p className="text-xs text-zinc-500">Postos podem encontrar este servidor automaticamente.</p>
            </div>
            <PosSwitch
              checked={Boolean(server?.discoveryEnabled)}
              onChange={(v) => void saveServerToggles({ discoveryEnabled: v })}
            />
          </div>
          {server ? (
            <div className="space-y-1 text-xs text-zinc-400">
              <p>
                Porta API: <span className="font-mono text-zinc-200">{server.port}</span>
              </p>
              {server.localAddresses.length > 0 ? (
                <p>
                  IPs locais:{' '}
                  {server.localAddresses.map((ip) => (
                    <span key={ip} className="mr-2 font-mono text-zinc-200">
                      http://{ip}:{server.port}
                    </span>
                  ))}
                </p>
              ) : (
                <p>Nenhum IPv4 de rede detectado.</p>
              )}
              <p className="text-amber-200/80">
                No Windows, permita a porta no Firewall quando activar a LAN. Reinicie a app após mudar o
                acesso LAN.
              </p>
            </div>
          ) : null}

          <div className="border-t border-pos-border pt-4">
            <p className="mb-2 text-zinc-200">Postos registados</p>
            <ul className="mb-3 space-y-1 text-xs text-zinc-400">
              {stations.length === 0 ? <li>Nenhum posto ainda — crie abaixo.</li> : null}
              {stations.map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span>
                    <span className="font-mono text-zinc-200">{s.code}</span> — {s.name} (
                    {stationRoleLabel(s.role)})
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                value={draftStation.code}
                onChange={(e) => setDraftStation((d) => ({ ...d, code: e.target.value }))}
                placeholder="código (ex. caixa-2)"
                className="h-9 rounded border border-zinc-600 bg-pos-bg px-2 text-sm text-white"
              />
              <input
                value={draftStation.name}
                onChange={(e) => setDraftStation((d) => ({ ...d, name: e.target.value }))}
                placeholder="nome"
                className="h-9 rounded border border-zinc-600 bg-pos-bg px-2 text-sm text-white"
              />
              <PosSelect
                value={draftStation.role}
                onChange={(v) => setDraftStation((d) => ({ ...d, role: normalizeStationRole(v) }))}
                options={[
                  { value: 'caixa', label: 'Caixa' },
                  { value: 'garcom', label: 'Garçom' },
                  { value: 'consulta', label: 'Consulta' },
                  { value: 'cozinha', label: 'Cozinha' },
                ]}
                size="md"
                triggerClassName="!bg-pos-bg !border-zinc-600"
              />
            </div>
            <button
              type="button"
              onClick={() => void saveStationRow()}
              className="mt-2 rounded bg-[#0001fb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a1bff]"
            >
              Guardar posto
            </button>
          </div>
        </div>
      )}

      {client.stationMode === 'client' && (
        <div className="space-y-4 rounded border border-pos-border bg-pos-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Posto remoto</p>
          <label className="block">
            <span className="text-zinc-300">IP da API do servidor</span>
            <input
              value={client.serverApiBaseUrl}
              onChange={(e) =>
                persistClient({ ...client, serverApiBaseUrl: e.target.value })
              }
              placeholder="192.168.1.20"
              className="mt-1 h-9 w-full max-w-md rounded border border-zinc-600 bg-pos-bg px-3 font-mono text-sm text-white"
            />
            <span className="mt-1 block text-[11px] text-zinc-500">
              Basta o IP — acrescentamos http e a porta 3731. Em dev use IP:3001.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void testConnection()}
              className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              Testar ligação
            </button>
            <button
              type="button"
              disabled={scanning}
              onClick={() => void scanLan()}
              className="rounded bg-[#0001fb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a1bff] disabled:opacity-50"
            >
              {scanning ? 'A procurar…' : 'Procurar na rede'}
            </button>
            <button
              type="button"
              onClick={() => {
                persistClient({
                  ...client,
                  stationMode: 'unset',
                  serverApiBaseUrl: '',
                });
                setMessage('Ligação esquecida.');
              }}
              className="rounded border border-pos-border px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Esquecer ligação
            </button>
          </div>
          {testStatus ? <p className="text-xs text-zinc-400">{testStatus}</p> : null}
          {discovered.length > 0 ? (
            <ul className="space-y-1">
              {discovered.map((s) => (
                <li key={s.url}>
                  <button
                    type="button"
                    onClick={() => connectTo(s.url)}
                    className="w-full rounded border border-pos-border px-3 py-2 text-left text-xs hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)]"
                  >
                    <span className="text-zinc-100">{s.store_name || 'POSly'}</span>
                    <span className="mt-0.5 block font-mono text-zinc-500">{s.url}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block text-xs text-zinc-400">
              Código do posto
              <input
                value={client.stationCode}
                onChange={(e) => persistClient({ ...client, stationCode: e.target.value })}
                className="mt-1 h-9 w-full rounded border border-zinc-600 bg-pos-bg px-2 font-mono text-sm text-white"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Nome
              <input
                value={client.stationName}
                onChange={(e) => persistClient({ ...client, stationName: e.target.value })}
                className="mt-1 h-9 w-full rounded border border-zinc-600 bg-pos-bg px-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Papel
              <div className="mt-1">
                <PosSelect
                  value={client.stationRole}
                  onChange={(v) =>
                    persistClient({ ...client, stationRole: normalizeStationRole(v) })
                  }
                  options={[
                    { value: 'caixa', label: 'Caixa' },
                    { value: 'garcom', label: 'Garçom' },
                    { value: 'consulta', label: 'Consulta' },
                    { value: 'cozinha', label: 'Cozinha' },
                  ]}
                  size="md"
                  triggerClassName="!bg-pos-bg !border-zinc-600"
                />
              </div>
            </label>
          </div>
        </div>
      )}

      {message ? <p className="text-xs text-[#a5b4fc]">{message}</p> : null}
    </div>
  );
}
