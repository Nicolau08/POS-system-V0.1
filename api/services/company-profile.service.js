import { HttpError } from '../utils/httpResponse.js';
import {
  getCompanyProfileRow,
  getCompanyProfileVoidReasonsAndLogo,
  updateCompanyProfileVoidReasons,
  upsertCompanyProfile,
} from '../repositories/company-profile.repository.js';

const parseVoidReasons = (raw) => {
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

export async function getCompanyProfile() {
  const row = await getCompanyProfileRow();
  if (!row) {
    return {
      name: '',
      taxId: '',
      street: '',
      buildingNumber: '',
      additionalStreet: '',
      plotIdentification: '',
      district: '',
      city: '',
      state: '',
      country: '',
      phone: '',
      email: '',
      bankAccountNumber: '',
      bankDetails: '',
      logoDataUrl: null,
      voidReasons: [],
      updatedAt: null,
    };
  }

  return {
    name: row.name ?? '',
    taxId: row.tax_id ?? '',
    street: row.street ?? '',
    buildingNumber: row.building_number ?? '',
    additionalStreet: row.additional_street ?? '',
    plotIdentification: row.plot_identification ?? '',
    district: row.district ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    country: row.country ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    bankAccountNumber: row.bank_account_number ?? '',
    bankDetails: row.bank_details ?? '',
    logoDataUrl: row.logo_data_url ?? null,
    voidReasons: parseVoidReasons(row.void_reasons),
    updatedAt: row.updated_at ?? null,
  };
}

export async function putCompanyProfile(payload = {}) {
  const now = new Date().toISOString();
  const name = payload.name != null ? String(payload.name).trim() : '';
  const country = payload.country != null ? String(payload.country).trim() : '';
  if (!name || !country) {
    throw new HttpError(400, 'name e country sao obrigatorios');
  }

  const existing = await getCompanyProfileVoidReasonsAndLogo();
  const voidReasonsJson =
    payload.voidReasons !== undefined
      ? JSON.stringify(
          (Array.isArray(payload.voidReasons) ? payload.voidReasons : [])
            .map((x) => String(x ?? '').trim())
            .filter(Boolean)
        )
      : existing?.void_reasons != null
        ? String(existing.void_reasons)
        : '[]';

  const logoRaw = payload.logoDataUrl ?? payload.logo_data_url;
  let logoDataUrl;
  if (logoRaw === undefined) {
    logoDataUrl = existing?.logo_data_url ?? null;
  } else if (logoRaw === null || logoRaw === '') {
    logoDataUrl = null;
  } else if (typeof logoRaw === 'string' && logoRaw.length > 10 * 1024 * 1024) {
    throw new HttpError(400, 'logo muito grande (máx. ~10MB em base64)');
  } else {
    logoDataUrl = String(logoRaw);
  }

  await upsertCompanyProfile([
    name,
    payload.taxId != null ? String(payload.taxId).trim() || null : null,
    payload.street != null ? String(payload.street).trim() || null : null,
    payload.buildingNumber != null ? String(payload.buildingNumber).trim() || null : null,
    payload.additionalStreet != null ? String(payload.additionalStreet).trim() || null : null,
    payload.plotIdentification != null ? String(payload.plotIdentification).trim() || null : null,
    payload.district != null ? String(payload.district).trim() || null : null,
    payload.cep != null ? String(payload.cep).trim() || null : null,
    payload.city != null ? String(payload.city).trim() || null : null,
    payload.state != null ? String(payload.state).trim() || null : null,
    country,
    payload.phone != null ? String(payload.phone).trim() || null : null,
    payload.email != null ? String(payload.email).trim() || null : null,
    payload.bankAccountNumber != null ? String(payload.bankAccountNumber).trim() || null : null,
    payload.bankDetails != null ? String(payload.bankDetails).trim() || null : null,
    logoDataUrl,
    voidReasonsJson,
    now,
  ]);

  return { success: true, updated: true };
}

export async function putCompanyProfileVoidReasons(payload = {}) {
  const list = Array.isArray(payload.voidReasons) ? payload.voidReasons : [];
  const json = JSON.stringify(list.map((x) => String(x ?? '').trim()).filter(Boolean));
  const now = new Date().toISOString();
  const result = await updateCompanyProfileVoidReasons(json, now);
  return { success: true, updated: result.changes > 0 };
}
