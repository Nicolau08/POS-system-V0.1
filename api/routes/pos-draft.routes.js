import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import { deletePosDraft, getPosDraft, putPosDraft } from '../controllers/pos-draft.controller.js';

const router = express.Router();

router.get('/pos/draft', authenticateUser, getPosDraft);
router.put('/pos/draft', authenticateUser, putPosDraft);
router.delete('/pos/draft', authenticateUser, deletePosDraft);

export default router;
