import express from 'express';
import { createLicense, createTenantWithSerial, listTenants } from '../controllers/saas.controller.js';
import { sendError } from '../utils/response.js';

const router = express.Router();

/** Exige POS_SAAS_ADMIN_SECRET (fail-closed se vazio). */
function requireSaasAdminSecret(req, res, next) {
  const expected = String(process.env.POS_SAAS_ADMIN_SECRET ?? '').trim();
  if (!expected) {
    return sendError(
      res,
      503,
      'Rotas SaaS desactivadas (POS_SAAS_ADMIN_SECRET não configurado).',
      'SAAS_DISABLED',
    );
  }
  const got = String(req.headers?.['x-saas-admin-secret'] ?? '').trim();
  if (got !== expected) {
    return sendError(res, 403, 'Segredo SaaS inválido.', 'SAAS_FORBIDDEN');
  }
  return next();
}

router.use(requireSaasAdminSecret);
router.post('/tenants', createTenantWithSerial);
router.get('/tenants', listTenants);
router.post('/license', createLicense);

export default router;
