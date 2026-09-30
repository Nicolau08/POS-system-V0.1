import express from 'express';
import { requireLoopbackOnly } from '../middlewares/stationAuth.js';
import { authenticateUser, requireAdmin } from '../middlewares/auth.js';
import {
  activateSetupLicense,
  configureSetupAdminPassword,
  deleteUser,
  getSetupStatus,
  getUsers,
  login,
  postUser,
  putUser,
  renewLicense,
  resetAdminPin,
} from '../controllers/users.controller.js';

const router = express.Router();

router.post('/auth/login', login);
// Etapa 1G.3.5: alteram credenciais/licenca do Store Server -> so loopback
router.post('/auth/admin/reset-pin', requireLoopbackOnly, resetAdminPin);
router.get('/setup/status', getSetupStatus);
router.post('/setup/admin-password', requireLoopbackOnly, configureSetupAdminPassword);
router.post('/setup/license/activate', requireLoopbackOnly, activateSetupLicense);
router.post('/license/renew', requireLoopbackOnly, renewLicense);

router.get('/users', authenticateUser, requireAdmin, getUsers);
router.post('/users', authenticateUser, requireAdmin, postUser);
router.put('/users/:id', authenticateUser, requireAdmin, putUser);
router.delete('/users/:id', authenticateUser, requireAdmin, deleteUser);

export default router;
