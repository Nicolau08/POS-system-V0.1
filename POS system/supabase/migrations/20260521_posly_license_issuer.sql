-- Consola de licenças POSly (substitui data/license-issuer-store.json).
-- Acesso via service_role na API Next; RLS activo sem políticas públicas.

CREATE TABLE IF NOT EXISTS public.license_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  tenant_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.license_issues (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES public.license_clients (id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  machine_id text NOT NULL,
  expiration timestamptz NOT NULL,
  license_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.license_vouchers (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES public.license_clients (id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  expiration timestamptz NOT NULL,
  nonce text NOT NULL UNIQUE,
  voucher_json text NOT NULL,
  code_b64 text NOT NULL,
  redeemed_machine_id text,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_issues_client_id ON public.license_issues (client_id);
CREATE INDEX IF NOT EXISTS idx_license_issues_tenant_id ON public.license_issues (tenant_id);
CREATE INDEX IF NOT EXISTS idx_license_vouchers_client_id ON public.license_vouchers (client_id);
CREATE INDEX IF NOT EXISTS idx_license_vouchers_tenant_id ON public.license_vouchers (tenant_id);

COMMENT ON TABLE public.license_clients IS 'Clientes/lojas na consola de licenças POSly.';
COMMENT ON TABLE public.license_issues IS 'Licenças directas (já com machine_id) emitidas pela consola.';
COMMENT ON TABLE public.license_vouchers IS 'Códigos de ativação; resgate via device-activation ou voucher/confirm.';

ALTER TABLE public.license_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_vouchers ENABLE ROW LEVEL SECURITY;
