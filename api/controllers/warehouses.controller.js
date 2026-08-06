import {
  createWarehouse,
  listAllWarehouses,
  listWarehouseStock,
  setDefaultWarehouseById,
  transferStock,
  updateWarehouseById,
} from '../services/warehouses.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getWarehouses(req, res) {
  try {
    const payload = await listAllWarehouses(req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function getWarehouseStock(req, res) {
  try {
    const payload = await listWarehouseStock(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postWarehouse(req, res) {
  try {
    const payload = await createWarehouse(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putWarehouse(req, res) {
  try {
    const payload = await updateWarehouseById(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postSetDefaultWarehouse(req, res) {
  try {
    const payload = await setDefaultWarehouseById(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postWarehouseTransfer(req, res) {
  try {
    const payload = await transferStock(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
