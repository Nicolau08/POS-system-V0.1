import {
  getCompanyProfile,
  putCompanyProfile,
  putCompanyProfileVoidReasons,
} from '../services/company-profile.service.js';
import { handleControllerError } from '../utils/httpResponse.js';

export async function getCompanyProfileController(_req, res) {
  try {
    const payload = await getCompanyProfile();
    return res.json(payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putCompanyProfileController(req, res) {
  try {
    const payload = await putCompanyProfile(req.body ?? {});
    return res.json(payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putCompanyProfileVoidReasonsController(req, res) {
  try {
    const payload = await putCompanyProfileVoidReasons(req.body ?? {});
    return res.json(payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
