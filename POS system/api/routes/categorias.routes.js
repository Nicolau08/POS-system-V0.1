import express from 'express';
import {
  getCategorias,
  postCategoria,
  putCategoria,
  removeCategoria,
} from '../controllers/categorias.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { validateCategoryBody } from '../validators/request.validators.js';

const router = express.Router();

router.get('/categorias', getCategorias);
router.post('/categorias', validateRequest({ body: validateCategoryBody }), postCategoria);
router.put('/categorias/:id', validateRequest({ body: validateCategoryBody }), putCategoria);
router.delete('/categorias/:id', removeCategoria);

export default router;
