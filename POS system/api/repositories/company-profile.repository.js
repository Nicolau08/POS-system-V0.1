import { get, run } from '../dbUtils.js';

export function getCompanyProfileRow() {
  return get(`SELECT * FROM company_profile WHERE id = 1`, []);
}

export function getCompanyProfileVoidReasonsAndLogo() {
  return get(`SELECT void_reasons, logo_data_url FROM company_profile WHERE id = 1`, []);
}

export function upsertCompanyProfile(params) {
  return run(
    `INSERT INTO company_profile (
      id, name, tax_id, street, building_number, additional_street, plot_identification,
      district, cep, city, state, country, phone, email,
      bank_account_number, bank_details, logo_data_url, void_reasons, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      tax_id = excluded.tax_id,
      street = excluded.street,
      building_number = excluded.building_number,
      additional_street = excluded.additional_street,
      plot_identification = excluded.plot_identification,
      district = excluded.district,
      cep = excluded.cep,
      city = excluded.city,
      state = excluded.state,
      country = excluded.country,
      phone = excluded.phone,
      email = excluded.email,
      bank_account_number = excluded.bank_account_number,
      bank_details = excluded.bank_details,
      logo_data_url = excluded.logo_data_url,
      void_reasons = excluded.void_reasons,
      updated_at = excluded.updated_at`,
    params
  );
}

export function updateCompanyProfileVoidReasons(voidReasonsJson, updatedAt) {
  return run(
    `UPDATE company_profile SET void_reasons = ?, updated_at = ? WHERE id = 1`,
    [voidReasonsJson, updatedAt]
  );
}
