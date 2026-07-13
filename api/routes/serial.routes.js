import express from 'express';
import { listSerialPorts, writeCustomerDisplay } from '../utils/serialPorts.js';
import { sendError, sendSuccess } from '../utils/response.js';

const router = express.Router();

router.get('/serial-ports', async (_req, res) => {
  try {
    const ports = await listSerialPorts();
    return sendSuccess(res, {
      ports,
      paths: ports.map((port) => port.path),
    });
  } catch (error) {
    return sendError(res, 500, String(error?.message ?? error ?? 'Falha ao listar portas COM'), 'SERIAL_PORTS_ERROR');
  }
});

router.post('/customer-display/write', async (req, res) => {
  try {
    const result = await writeCustomerDisplay(req.body ?? {});
    if (!result.success) {
      return sendError(res, 400, result.error || 'Falha ao escrever no display', 'CUSTOMER_DISPLAY_WRITE_ERROR');
    }
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, 500, String(error?.message ?? error ?? 'Falha ao escrever no display'), 'CUSTOMER_DISPLAY_WRITE_ERROR');
  }
});

export default router;
