import express from 'express';
import { sendError } from '../utils/response.js';
import { createTenantWithSerial, createLicense, listTenants } from '../controllers/saas.controller.js';

const router = express.Router();

function isSaasProvisioningAllowed(req, res, next) {
  const secret = String(process.env.POS_SAAS_ADMIN_SECRET ?? '').trim();
  const isPackagedPos =
    String(process.env.POS_APP_MODE ?? '').trim().toLowerCase() === 'pos' &&
    String(process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';

  if (isPackagedPos && !secret) {
    return sendError(res, 404, 'Recurso não disponível.', 'SAAS_DISABLED');
  }

  if (secret) {
    const got = String(req.headers['x-saas-admin-secret'] ?? '').trim();
    if (got !== secret) {
      return sendError(res, 401, 'Credencial SaaS inválida.', 'SAAS_UNAUTHORIZED');
    }
  }

  return next();
}

router.use(isSaasProvisioningAllowed);
router.post('/tenants', createTenantWithSerial);
router.get('/tenants', listTenants);
router.post('/license', createLicense);

export default router;
