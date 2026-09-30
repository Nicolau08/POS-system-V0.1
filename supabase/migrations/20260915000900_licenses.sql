-- Etapa 1E.4 — bloco 009: licenses.
--
-- Modelo aprovado (1E.1/1E.4): tenant 1:N licenses — SEM UNIQUE(tenant_id), para
-- permitir histórico (licença antiga expirada/revogada + licença actual) sem
-- constraint permanente a impedir isso. Estados persistidos: active/suspended/
-- revoked; 'expired' continua derivado de expires_at (nunca persistido).

CREATE TABLE public.licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  status_reason TEXT,
  plan TEXT NOT NULL DEFAULT 'LITE',
  commerce_type TEXT NOT NULL DEFAULT 'retalho',
  vertical TEXT,
  capabilities_json TEXT,
  -- NULL = sem limite. Enforcement atómico feito em bootstrap_pos_device (bloco 010).
  max_devices INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX licenses_tenant_id_idx ON public.licenses (tenant_id);
-- Alvo da FK composta de pos_devices (bloco 010) — nunca "tenant A com license de B".
ALTER TABLE public.licenses ADD CONSTRAINT licenses_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TRIGGER licenses_set_updated_at
  BEFORE UPDATE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.licenses FROM PUBLIC, anon, authenticated;
