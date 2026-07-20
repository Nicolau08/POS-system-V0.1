import express from 'express';
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

const router = express.Router();

function handle(res, err) {
  const status = err?.status || err?.statusCode || 500;
  return sendError(res, status, err?.message || 'Erro interno');
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

router.patch('/stations/server-settings', async (req, res) => {
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

router.post('/stations', async (req, res) => {
  try {
    const row = await upsertStation(req.body ?? {}, req.user);
    return sendSuccess(res, row);
  } catch (err) {
    return handle(res, err);
  }
});

router.delete('/stations/:code', async (req, res) => {
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
