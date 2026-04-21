import { getPermissionRules, putPermissionRules } from '../services/permission-rules.service.js';
import { handleControllerError } from '../utils/httpResponse.js';

export async function listPermissionRulesController(req, res) {
  try {
    const payload = await getPermissionRules(req.query ?? {});
    return res.json(payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function updatePermissionRulesController(req, res) {
  try {
    const payload = await putPermissionRules(req.body ?? {});
    return res.json(payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
