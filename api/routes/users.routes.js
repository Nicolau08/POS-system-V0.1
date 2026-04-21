import express from 'express';
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
router.post('/auth/admin/reset-pin', resetAdminPin);
router.get('/setup/status', getSetupStatus);
router.post('/setup/admin-password', configureSetupAdminPassword);
router.post('/setup/license/activate', activateSetupLicense);
router.post('/license/renew', renewLicense);

router.get('/users', authenticateUser, requireAdmin, getUsers);
router.post('/users', authenticateUser, requireAdmin, postUser);
router.put('/users/:id', authenticateUser, requireAdmin, putUser);
router.delete('/users/:id', authenticateUser, requireAdmin, deleteUser);

export default router;
