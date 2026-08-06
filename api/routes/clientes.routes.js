import express from 'express';
import { authenticateUser, requireMinLevel } from '../middlewares/auth.js';
import {
  deleteCliente,
  getClientes,
  postCliente,
  putCliente,
} from '../controllers/clientes.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { validateClienteBody } from '../validators/request.validators.js';

const router = express.Router();

// GET/POST/PUT ficam abertos a utilizadores autenticados (o POS precisa de listar
// e criar clientes no checkout). DELETE exige nível ≥ 5 para evitar apagar PII
// com conta de caixa.
router.get('/clientes', authenticateUser, getClientes);
router.post('/clientes', authenticateUser, validateRequest({ body: validateClienteBody }), postCliente);
router.put('/clientes/:id', authenticateUser, validateRequest({ body: validateClienteBody }), putCliente);
router.delete('/clientes/:id', authenticateUser, requireMinLevel(5), deleteCliente);

export default router;
