-- Etapa 1E.6 — bloco 012: license_issues (audit append-only).
--
-- Decisão (secção 6 do pedido): `license_issues` é um AUDIT LOG de licenças offline
-- emitidas, nada mais — nunca guarda a assinatura nem qualquer segredo, só metadados
-- suficientes para responder "quando/para que máquina foi emitida uma licença offline
-- desta license". `pos_tenant_registry`/`license_clients`/`license_vouchers`/
-- `license_reactivation_tokens` do sistema antigo NÃO são recriados nesta baseline —
-- ver relatório da etapa para a classificação completa (a maior parte foi
-- REMOVE: função redundante com tenants/licenses + device_activation_tokens +
-- a própria emissão de licença offline).

CREATE TABLE public.license_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  license_id UUID NOT NULL,
  machine_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT license_issues_tenant_license_fkey
    FOREIGN KEY (tenant_id, license_id) REFERENCES public.licenses (tenant_id, id)
);
CREATE INDEX license_issues_tenant_id_idx ON public.license_issues (tenant_id);
CREATE INDEX license_issues_license_id_idx ON public.license_issues (license_id);

ALTER TABLE public.license_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.license_issues FROM PUBLIC, anon, authenticated;
