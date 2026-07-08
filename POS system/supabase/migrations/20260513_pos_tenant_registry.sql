-- Registo de lojas activadas pelo POS (consola de licenças → Supabase).
-- O serviço usa service_role (API Next / Edge) e ignora RLS.

CREATE TABLE IF NOT EXISTS public.pos_tenant_registry (
  tenant_id text PRIMARY KEY,
  display_name text,
  machine_id text NOT NULL,
  license_expires_at timestamptz,
  activated_at timestamptz NOT NULL DEFAULT now(),
  voucher_nonce text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_tenant_registry_machine_id
  ON public.pos_tenant_registry (machine_id);

COMMENT ON TABLE public.pos_tenant_registry IS
  'Máquinas/lojas registadas quando o POS chama POST /api/license-issuer/device-activation.';

ALTER TABLE public.pos_tenant_registry ENABLE ROW LEVEL SECURITY;
