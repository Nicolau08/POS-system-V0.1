export type LicensePlan = 'PRO' | 'LITE';

export type LicenseIssuerClient = {
  id: string;
  name: string;
  tenant_id: string;
  nuit: string | null;
  plan: LicensePlan;
  created_at: string;
};

export type LicenseIssuerIssue = {
  id: string;
  client_id: string;
  tenant_id: string;
  machine_id: string;
  expiration: string;
  /** JSON string of the signed license object */
  license_json: string;
  created_at: string;
};

export type LicenseIssuerVoucher = {
  id: string;
  client_id: string;
  tenant_id: string;
  expiration: string;
  nonce: string;
  voucher_json: string;
  code_b64: string;
  /** Número de série X_XXXXXXXX (instalação local). Null em vouchers antigos. */
  serial_number: string | null;
  created_at: string;
  redeemed_machine_id: string | null;
  redeemed_at: string | null;
};

/** Loja associada a um serial (1 serial = 1 loja hoje; array para evolução). */
export type LicenseSerialStore = {
  tenant_id: string;
  name: string;
  nuit: string | null;
  plan: LicensePlan;
  expires_at: string;
  serial: string;
};

export type LicenseIssuerStore = {
  clients: LicenseIssuerClient[];
  issues: LicenseIssuerIssue[];
  vouchers: LicenseIssuerVoucher[];
};
