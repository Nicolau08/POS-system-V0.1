import { Router } from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import {
  getKitchenTickets,
  patchKitchenTicket,
  postKitchenAdjust,
  postKitchenTickets,
  streamKitchenEvents,
} from '../controllers/kitchen.controller.js';

const router = Router();

router.get('/kitchen/events', authenticateUser, streamKitchenEvents);
router.get('/kitchen/tickets', authenticateUser, getKitchenTickets);
router.post('/kitchen/tickets', authenticateUser, postKitchenTickets);
router.post('/kitchen/adjust', authenticateUser, postKitchenAdjust);
router.patch('/kitchen/tickets/:id', authenticateUser, patchKitchenTicket);

export default router;
