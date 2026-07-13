import express from 'express';
import {
  listPermissionRulesController,
  updatePermissionRulesController,
} from '../controllers/permission-rules.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { validatePermissionRulesBody } from '../validators/request.validators.js';
import { authenticateUser, requirePermission } from '../middlewares/auth.js';

const router = express.Router();

router.get('/permission-rules', authenticateUser, listPermissionRulesController);
router.put(
  '/permission-rules',
  authenticateUser,
  requirePermission('painel.usuarios_seguranca', 0),
  validateRequest({ body: validatePermissionRulesBody }),
  updatePermissionRulesController
);

export default router;
