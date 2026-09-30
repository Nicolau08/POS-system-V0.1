/**
 * Etapa 1G.3.4 - IPC da Station (pairing minimo + pedidos assinados). Nunca devolve chave privada ao renderer.
 */
import { createStationIdentityStore, normalizeServerOrigin, parsePairingToken } from './stationIdentity.js';
import { createStationClient } from './stationClient.js';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';

const ok = (extra = {}) => ({ success: true, ...extra });
const fail = (err) => ({
  success: false,
  error: String(err?.message ?? err),
  code: err?.code ?? null,
  status: err?.status ?? null,
  serverCode: err?.serverCode ?? null,
});

export function registerStationIpc({ ipcMain, safeStorage, getUserDataPath, readRuntimeConfig, writeRuntimeConfig, fetchImpl = null }) {
  const store = () => createStationIdentityStore({ userDataPath: getUserDataPath(), safeStorage });
  // um cliente por processo: mantem o offset de relogio em memoria
  let cached = null;
  const getClient = async () => {
    if (!cached) {
      const cfg = await readRuntimeConfig?.();
      cached = createStationClient({
        identityStore: store(),
        fetchImpl,
        // sem identidade so se fala com o servidor configurado (para o UI mostrar o 401 do Server)
        allowedUnsignedOrigin: () => {
          try {
            return cfg?.serverApiBaseUrl ? normalizeServerOrigin(cfg.serverApiBaseUrl) : null;
          } catch {
            return null; // URL http/invalida persistida: nada passa (falha fechada)
          }
        },
      });
    }
    return cached;
  };

  // serverUrl https + (token do admin `POSLY-PAIR-1.<codigo>.<fingerprint>` OU codigo + fingerprint). A fingerprint tem de vir
  // FORA DE BANDA (do admin); nunca e obtida ao ligar ao servidor (sem TOFU).
  ipcMain.handle('station:pair', async (_e, { serverUrl, code, fingerprint } = {}) => {
    try {
      const token = parsePairingToken(code);
      const r = await store().pair({
        serverUrl,
        code: token ? token.code : code,
        expectedFingerprint: token ? token.fingerprint : fingerprint,
        machineId: getLocalMachineId(),
        fetchImpl,
      });
      await writeRuntimeConfig({ mode: 'client', serverApiBaseUrl: r.serverUrl, stationId: r.stationId });
      cached = null;
      return ok({ stationId: r.stationId, serverUrl: r.serverUrl });
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('station:getIdentity', async () => {
    try {
      return ok(store().status());
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('station:clearIdentity', async () => {
    try {
      store().clear();
      await writeRuntimeConfig({ stationId: null });
      cached = null;
      return ok();
    } catch (err) {
      return fail(err);
    }
  });
  ipcMain.handle('station:fetch', async (_e, { url, method, headers, bodyBase64 } = {}) => {
    try {
      const body = bodyBase64 ? Buffer.from(String(bodyBase64), 'base64') : null;
      const r = await (await getClient()).request({ url, method, headers, body });
      return ok({ status: r.status, headers: r.headers, bodyBase64: r.body.toString('base64') });
    } catch (err) {
      return fail(err);
    }
  });
}
