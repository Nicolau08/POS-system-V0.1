import express from 'express';
import { requireAdmin } from '../middlewares/auth.js';
import {
  claimTableLock,
  getServerStationSettings,
  listLocalIpv4Addresses,
  listStations,
  listTableLocks,
  releaseTableLock,
  removeStation,
  updateServerStationSettings,
  upsertStation,
} from '../services/station.service.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { createPairing, setStationStatus } from '../services/stationPairing.service.js';
import { requireLoopbackOnly } from '../middlewares/stationAuth.js';

const router = express.Router();

function handle(res, err) {
  const status = err?.status || err?.statusCode || 500;
  // propaga o codigo de erro do servico (ex.: STATION_LIMIT_REACHED, PUBLIC_KEY_RETIRED) para o cliente
  return sendError(res, status, err?.message || 'Erro interno', err?.code);
}

router.get('/stations/server-settings', async (_req, res) => {
  try {
    const settings = await getServerStationSettings();
    const port = Number(process.env.POS_API_PORT || process.env.PORT || 3001);
    return sendSuccess(res, {
      ...settings,
      port,
      localAddresses: listLocalIpv4Addresses(),
    });
  } catch (err) {
    return handle(res, err);
  }
});

// Etapa 1G.3.5: ligar/desligar LAN e impressora do Server -> so loopback (uma Station nao pode desligar a LAN que usa)
router.patch('/stations/server-settings', requireLoopbackOnly, requireAdmin, async (req, res) => {
  try {
    const settings = await updateServerStationSettings({
      lanAccessEnabled: req.body?.lanAccessEnabled,
      discoveryEnabled: req.body?.discoveryEnabled,
      receiptPrinterName: req.body?.receiptPrinterName ?? req.body?.receipt_printer_name,
    });
    return sendSuccess(res, {
      ...settings,
      port: Number(process.env.POS_API_PORT || process.env.PORT || 3001),
      localAddresses: listLocalIpv4Addresses(),
      restartHint:
        'Reinicie a aplicação desktop para aplicar o bind de rede (acesso LAN).',
    });
  } catch (err) {
    return handle(res, err);
  }
});

router.get('/stations', async (req, res) => {
  try {
    const rows = await listStations(req.user);
    return sendSuccess(res, rows);
  } catch (err) {
    return handle(res, err);
  }
});

// Etapa 1G.3.2: criar/apagar/alterar postos exige admin; Station com identidade so nasce por pairing.
router.post('/stations/pairings', requireAdmin, async (req, res) => {
  try {
    const row = await createPairing({ name: req.body?.name, role: req.body?.role, actorUser: req.user });
    return sendSuccess(res, row, 201);
  } catch (err) {
    return handle(res, err);
  }
});

router.post('/stations/:id/status', requireAdmin, async (req, res) => {
  try {
    return sendSuccess(res, await setStationStatus(req.params.id, req.body?.status, { actorUser: req.user }));
  } catch (err) {
    return handle(res, err);
  }
});

router.post('/stations', requireAdmin, async (req, res) => {
  try {
    const row = await upsertStation(req.body ?? {}, req.user);
    return sendSuccess(res, row);
  } catch (err) {
    return handle(res, err);
  }
});

router.delete('/stations/:code', requireAdmin, async (req, res) => {
  try {
    await removeStation(req.params.code, req.user);
    return sendSuccess(res, { ok: true });
  } catch (err) {
    return handle(res, err);
  }
});

router.get('/table-locks', async (req, res) => {
  try {
    const rows = await listTableLocks(req.user);
    return sendSuccess(res, rows);
  } catch (err) {
    return handle(res, err);
  }
});

router.post('/table-locks/claim', async (req, res) => {
  try {
    const row = await claimTableLock(req.body ?? {}, req.user);
    return sendSuccess(res, row);
  } catch (err) {
    return handle(res, err);
  }
});

router.post('/table-locks/release', async (req, res) => {
  try {
    const result = await releaseTableLock(req.body ?? {}, req.user);
    return sendSuccess(res, result);
  } catch (err) {
    return handle(res, err);
  }
});

export default router;
