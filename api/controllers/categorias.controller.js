import {
  createCategoria,
  deleteCategoria,
  listCategorias,
  updateCategoria,
} from '../services/categorias.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getCategorias(req, res) {
  try {
    const payload = await listCategorias(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postCategoria(req, res) {
  try {
    const payload = await createCategoria(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putCategoria(req, res) {
  try {
    const payload = await updateCategoria(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function removeCategoria(req, res) {
  try {
    const payload = await deleteCategoria(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
