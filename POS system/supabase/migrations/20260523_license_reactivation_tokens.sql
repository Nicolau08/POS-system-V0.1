-- Tokens curtos (12 dígitos) para reativar licença já vinculada a uma máquina.

CREATE TABLE IF NOT EXISTS public.license_reactivation_tokens (
  id text PRIMARY KEY,
  voucher_id text NOT NULL REFERENCES public.license_vouchers (id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES public.license_clients (id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  machine_id text NOT NULL,
  token text NOT NULL UNIQUE,
  token_expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_reactivation_tokens_voucher_id
  ON public.license_reactivation_tokens (voucher_id);

CREATE INDEX IF NOT EXISTS idx_license_reactivation_tokens_token
  ON public.license_reactivation_tokens (token);

COMMENT ON TABLE public.license_reactivation_tokens IS
  'Token de 12 dígitos para o cliente reintroduzir no POS após prolongamento na consola.';

ALTER TABLE public.license_reactivation_tokens ENABLE ROW LEVEL SECURITY;
