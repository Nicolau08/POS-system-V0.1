import express from 'express';
import {
  deleteLocationController,
  deleteLocationTableController,
  getLocations,
  postLocation,
  postLocationTable,
  putLocation,
  putLocationTable,
} from '../controllers/locations.controller.js';

const router = express.Router();

router.get('/locations', getLocations);
router.post('/locations', postLocation);
router.put('/locations/:id', putLocation);
router.delete('/locations/:id', deleteLocationController);
router.post('/locations/:id/tables', postLocationTable);
router.put('/location-tables/:id', putLocationTable);
router.delete('/location-tables/:id', deleteLocationTableController);

export default router;
