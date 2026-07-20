import {
  createLocation,
  createLocationTable,
  listAllLocations,
  removeLocation,
  removeLocationTable,
  updateLocationById,
  updateLocationTable,
} from '../services/locations.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getLocations(req, res) {
  try {
    const payload = await listAllLocations(req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postLocation(req, res) {
  try {
    const payload = await createLocation(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putLocation(req, res) {
  try {
    const payload = await updateLocationById(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function deleteLocationController(req, res) {
  try {
    const payload = await removeLocation(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postLocationTable(req, res) {
  try {
    const payload = await createLocationTable(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putLocationTable(req, res) {
  try {
    const payload = await updateLocationTable(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function deleteLocationTableController(req, res) {
  try {
    const payload = await removeLocationTable(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
