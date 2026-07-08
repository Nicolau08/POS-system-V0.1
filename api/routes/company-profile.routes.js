import express from 'express';
import {
  getCompanyProfileController,
  putCompanyProfileController,
  putCompanyProfileVoidReasonsController,
} from '../controllers/company-profile.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { validateCompanyProfileBody } from '../validators/request.validators.js';

const router = express.Router();

router.get('/company-profile', getCompanyProfileController);
router.put('/company-profile', validateRequest({ body: validateCompanyProfileBody }), putCompanyProfileController);
router.put('/company-profile/void-reasons', putCompanyProfileVoidReasonsController);

export default router;
