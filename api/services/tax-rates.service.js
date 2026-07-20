import { DEFAULT_TAX_RATE_SPECS, buildDefaultTaxRateInsertRows } from '../constants/taxRateDefaults.js';
import {
  clearDefaultTaxRates,
  countProductsUsingTaxRate,
  deleteTaxRate,
  getDefaultTaxRate,
  getTaxRateByCode,
  getTaxRateById,
  insertTaxRate,
  listProductsByTaxRate,
  listTaxRates,
  updateTaxRate,
} from '../repositories/tax-rates.repository.js';
import { run } from '../dbUtils.js';
import { HttpError } from '../utils/response.js';
import { assertTenantWrite, requireTenantId } from '../utils/tenant.js';
import { computeTaxFromBasePrice } from '../utils/taxMath.js';

function resolveTenantId(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para operacao de impostos',
  });
}

function isExemptRate(rate) {
  return Number(rate) === 0;
}

function resolvePriceIncludesTax(rate, rawValue) {
  // Taxa 0% = isento: o preço nunca “inclui” imposto.
  if (isExemptRate(rate)) return false;
  if (rawValue === false || rawValue === 0 || rawValue === '0') return false;
  if (rawValue == null) return true;
  return Boolean(rawValue);
}

function normalizeRow(row) {
  const rate = Number(row.rate ?? 0);
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    code: String(row.code ?? '').toUpperCase(),
    rate,
    isFixed: Boolean(row.is_fixed),
    priceIncludesTax: resolvePriceIncludesTax(rate, row.price_includes_tax),
    isDefault: Boolean(row.is_default),
    enabled: Boolean(row.enabled),
    isSystem: Boolean(row.is_system),
  };
}

function normalizePayload(payload = {}) {
  const name = String(payload.name ?? '').trim();
  const code = String(payload.code ?? '').trim().toUpperCase();
  const rate = Number(payload.rate ?? 0);
  if (!name || !code) throw new HttpError(400, 'Nome e código são obrigatórios.');
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new HttpError(400, 'A taxa deve estar entre 0 e 100.');
  }
  const rawIncludes =
    payload.priceIncludesTax ??
    payload.price_includes_tax ??
    true;
  return {
    name,
    code,
    rate,
    isFixed: Boolean(payload.isFixed ?? payload.is_fixed),
    priceIncludesTax: resolvePriceIncludesTax(rate, rawIncludes),
    isDefault: Boolean(payload.isDefault ?? payload.is_default),
    enabled: payload.enabled !== false,
  };
}

async function applyTaxRateToAllProducts(taxRate, tenantId) {
  const now = new Date().toISOString();
  await run(
    `UPDATE products
     SET tax_rate_id = ?, updated_at = ?
     WHERE tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [taxRate.id, now, tenantId],
  );
  return recalculateProductsForTaxRate(taxRate, tenantId);
}

async function recalculateProductsForTaxRate(taxRate, tenantId) {
  const products = await listProductsByTaxRate(taxRate.id, tenantId);
  const now = new Date().toISOString();
  let updated = 0;
  for (const product of products ?? []) {
    const { tax, finalPrice } = computeTaxFromBasePrice({
      basePrice: Number(product.price ?? 0),
      rate: Number(taxRate.rate ?? 0),
      isFixed: Boolean(taxRate.is_fixed),
      priceIncludesTax:
        Number(taxRate.rate ?? 0) === 0
          ? false
          : taxRate.price_includes_tax == null
            ? true
            : Boolean(taxRate.price_includes_tax),
    });
    const result = await run(
      `UPDATE products
       SET tax = ?, final_price = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
      [tax, finalPrice, now, product.id, tenantId],
    );
    if (Number(result?.changes ?? 0) > 0) updated += 1;
  }
  return updated;
}

export async function ensureDefaultTaxRates(tenantId) {
  const now = new Date().toISOString();
  const rows = buildDefaultTaxRateInsertRows(tenantId, now);
  for (let index = 0; index < DEFAULT_TAX_RATE_SPECS.length; index += 1) {
    const spec = DEFAULT_TAX_RATE_SPECS[index];
    const existing = await getTaxRateByCode(spec.code, tenantId);
    if (!existing) await insertTaxRate(rows[index]);
  }

  // Garantir que qualquer taxa 0% (isento) fica sempre “sem imposto”.
  await run(
    `UPDATE tax_rates
     SET price_includes_tax = 0, updated_at = ?
     WHERE tenant_id = ? AND rate = 0 AND COALESCE(price_includes_tax, 1) <> 0`,
    [now, tenantId],
  );

  // Se nenhuma taxa padrão existir, marcar IVA16 (ou a primeira habilitada).
  const currentDefault = await getDefaultTaxRate(tenantId);
  if (!currentDefault?.id) {
    const ivaForDefault = await getTaxRateByCode('IVA16', tenantId);
    const fallbackId = ivaForDefault?.id;
    if (fallbackId) {
      await run(
        `UPDATE tax_rates SET is_default = 1, updated_at = ? WHERE id = ? AND tenant_id = ?`,
        [now, fallbackId, tenantId],
      );
    }
  }

  // Preferir a taxa marcada como padrão (Taxa fixa) para produtos sem imposto.
  const defaultRate = await getDefaultTaxRate(tenantId);
  const preferred = defaultRate ?? (await getTaxRateByCode('IVA16', tenantId));
  if (preferred?.id) {
    await run(
      `UPDATE products
       SET tax_rate_id = ?
       WHERE tenant_id = ? AND tax_rate_id IS NULL AND COALESCE(deleted, 0) = 0`,
      [preferred.id, tenantId],
    );
    await recalculateProductsForTaxRate(preferred, tenantId);
  }
}

export async function listAllTaxRates(actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  await ensureDefaultTaxRates(tenantId);
  return (await listTaxRates(tenantId)).map(normalizeRow);
}

export async function createTaxRate(payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const value = normalizePayload(payload);
  if (await getTaxRateByCode(value.code, tenantId)) {
    throw new HttpError(409, 'Já existe um imposto com este código.');
  }
  const now = new Date().toISOString();
  if (value.isDefault) {
    await clearDefaultTaxRates(tenantId);
  }
  const result = await insertTaxRate([
    tenantId,
    value.name,
    value.code,
    value.rate,
    value.isFixed ? 1 : 0,
    value.priceIncludesTax ? 1 : 0,
    value.isDefault ? 1 : 0,
    value.enabled ? 1 : 0,
    0,
    now,
    now,
  ]);
  if (value.isDefault && result.lastID) {
    const created = await getTaxRateById(result.lastID, tenantId);
    if (created) await applyTaxRateToAllProducts(created, tenantId);
  }
  return { success: true, id: result.lastID };
}

export async function updateTaxRateById(idRaw, payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const id = Number(idRaw);
  if (!Number.isFinite(id)) throw new HttpError(400, 'Imposto inválido.');
  const existing = await getTaxRateById(id, tenantId);
  if (!existing) throw new HttpError(404, 'Imposto não encontrado.');
  const value = normalizePayload(payload);
  const duplicate = await getTaxRateByCode(value.code, tenantId);
  if (duplicate && Number(duplicate.id) !== id) {
    throw new HttpError(409, 'Já existe um imposto com este código.');
  }
  const now = new Date().toISOString();
  if (value.isDefault) {
    await clearDefaultTaxRates(tenantId, id);
  }
  const result = await updateTaxRate(id, tenantId, [
    value.name,
    value.code,
    value.rate,
    value.isFixed ? 1 : 0,
    value.priceIncludesTax ? 1 : 0,
    value.isDefault ? 1 : 0,
    value.enabled ? 1 : 0,
    now,
  ]);
  const updatedRate = await getTaxRateById(id, tenantId);
  if (updatedRate) {
    if (value.isDefault) {
      await applyTaxRateToAllProducts(updatedRate, tenantId);
    } else {
      await recalculateProductsForTaxRate(updatedRate, tenantId);
    }
  }
  // Se desmarcou a única taxa padrão, garantir outra.
  if (!value.isDefault) {
    const stillDefault = await getDefaultTaxRate(tenantId);
    if (!stillDefault?.id) {
      const iva = await getTaxRateByCode('IVA16', tenantId);
      if (iva?.id) {
        await run(
          `UPDATE tax_rates SET is_default = 1, updated_at = ? WHERE id = ? AND tenant_id = ?`,
          [now, iva.id, tenantId],
        );
      }
    }
  }
  return { success: true, updated: result.changes > 0 };
}

export async function removeTaxRate(idRaw, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const id = Number(idRaw);
  if (!Number.isFinite(id)) throw new HttpError(400, 'Imposto inválido.');
  const existing = await getTaxRateById(id, tenantId);
  if (!existing) throw new HttpError(404, 'Imposto não encontrado.');
  if (existing.is_system) {
    throw new HttpError(409, 'Os impostos padrão Isento e IVA não podem ser eliminados.');
  }
  const usage = await countProductsUsingTaxRate(id, tenantId);
  if (Number(usage?.total ?? 0) > 0) {
    throw new HttpError(409, 'Este imposto está associado a produtos. Use “Trocar impostos” primeiro.');
  }
  const result = await deleteTaxRate(id, tenantId);
  return { success: true, deleted: result.changes > 0 };
}

export async function swapTaxRates(payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const fromId = Number(payload.fromTaxRateId);
  const toId = Number(payload.toTaxRateId);
  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) {
    throw new HttpError(400, 'Selecione dois impostos diferentes.');
  }
  const [fromTax, toTax] = await Promise.all([
    getTaxRateById(fromId, tenantId),
    getTaxRateById(toId, tenantId),
  ]);
  if (!fromTax || !toTax) throw new HttpError(404, 'Imposto não encontrado.');

  await run(
    `UPDATE products
     SET tax_rate_id = ?, updated_at = ?
     WHERE tenant_id = ? AND tax_rate_id = ? AND COALESCE(deleted, 0) = 0`,
    [toId, new Date().toISOString(), tenantId, fromId],
  );
  const updatedProducts = await recalculateProductsForTaxRate(toTax, tenantId);
  return { success: true, updatedProducts };
}

export async function resolveProductTaxRate(taxRateId, tenantId) {
  await ensureDefaultTaxRates(tenantId);
  let row = taxRateId ? await getTaxRateById(Number(taxRateId), tenantId) : null;
  if (!row || !row.enabled) row = await getDefaultTaxRate(tenantId);
  if (!row || !row.enabled) row = await getTaxRateByCode('IVA16', tenantId);
  if (!row) throw new HttpError(500, 'Não foi possível resolver o imposto do produto.');
  return row;
}
