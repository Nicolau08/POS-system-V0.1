import express from 'express';
import {
  listPermissionRulesController,
  updatePermissionRulesController,
} from '../controllers/permission-rules.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { validatePermissionRulesBody } from '../validators/request.validators.js';

const router = express.Router();

router.get('/permission-rules', listPermissionRulesController);
router.put('/permission-rules', validateRequest({ body: validatePermissionRulesBody }), updatePermissionRulesController);

export default router;
