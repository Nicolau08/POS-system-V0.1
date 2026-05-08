import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import {
  deleteCliente,
  getClientes,
  postCliente,
  putCliente,
} from '../controllers/clientes.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { validateClienteBody } from '../validators/request.validators.js';

const router = express.Router();

router.get('/clientes', authenticateUser, getClientes);
router.post('/clientes', authenticateUser, validateRequest({ body: validateClienteBody }), postCliente);
router.put('/clientes/:id', authenticateUser, validateRequest({ body: validateClienteBody }), putCliente);
router.delete('/clientes/:id', authenticateUser, deleteCliente);

export default router;
