import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  getProductHistory,
  listProductBom,
  replaceProductBom,
} from '../services/product.service.js';
import { resolveUserFromRequest } from '../middlewares/auth.js';
import { parseBooleanFilter } from '../services/queryOptions.service.js';
import { sendError, sendSuccess } from '../utils/response.js';

function controllerError(res, error) {
  console.error('❌ controller error:', error);
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}

export async function getProducts(req, res) {
  try {
    const resolvedUser = req.user ?? (await resolveUserFromRequest(req));
    req.user = resolvedUser;
    const includeDeleted = parseBooleanFilter(req.query?.include_deleted) === true;
    const deleted = parseBooleanFilter(req.query?.deleted);
    const wantsDeletedAccess = includeDeleted || deleted === true;

    if (wantsDeletedAccess) {
      const role = String(resolvedUser?.role ?? '').trim().toLowerCase();
      if (role !== 'admin') return sendError(res, 403, 'Forbidden', 'FORBIDDEN');
    }

    const rows = await listProducts(req.query ?? {}, resolvedUser);
    return sendSuccess(res, rows);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function postProduct(req, res) {
  try {
    const result = await createProduct(req.body ?? {}, req.user);
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function putProduct(req, res) {
  try {
    const result = await updateProduct(req.params?.id, req.body ?? {}, req.user);
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function removeProduct(req, res) {
  try {
    const result = await deleteProduct(req.params?.id, req.user);
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function getProductBom(req, res) {
  try {
    const result = await listProductBom(req.params?.id, req.user);
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function putProductBom(req, res) {
  try {
    const lines = Array.isArray(req.body?.lines)
      ? req.body.lines
      : Array.isArray(req.body)
        ? req.body
        : [];
    const result = await replaceProductBom(req.params?.id, lines, req.user);
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function postStockAdjustment(req, res) {
  try {
    const body = req.body ?? {};
    const result = await adjustStock(
      {
        productId: body.productId ?? body.product_id,
        quantity: body.quantity,
        counted_quantity: body.counted_quantity ?? body.countedQuantity,
        mode: body.mode,
      },
      req.user,
    );
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function getProductMovementHistory(req, res) {
  try {
    const resolvedUser = req.user ?? (await resolveUserFromRequest(req));
    req.user = resolvedUser;
    const result = await getProductHistory(req.params?.id, req.query?.from, req.query?.to, resolvedUser);
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    return controllerError(res, error);
  }
}
