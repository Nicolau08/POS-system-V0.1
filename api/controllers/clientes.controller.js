import {
  createCliente,
  listAllClientes,
  removeCliente,
  updateCliente,
} from '../services/clientes.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getClientes(req, res) {
  try {
    const payload = await listAllClientes(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postCliente(req, res) {
  try {
    const payload = await createCliente(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putCliente(req, res) {
  try {
    const payload = await updateCliente(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function deleteCliente(req, res) {
  try {
    const payload = await removeCliente(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
