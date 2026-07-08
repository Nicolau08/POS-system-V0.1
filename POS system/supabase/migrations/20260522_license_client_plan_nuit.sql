-- Plano (PRO/LITE) e NUIT por cliente; espelhados no registo da máquina activada.

ALTER TABLE public.license_clients
  ADD COLUMN IF NOT EXISTS nuit text,
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'LITE';

ALTER TABLE public.pos_tenant_registry
  ADD COLUMN IF NOT EXISTS nuit text,
  ADD COLUMN IF NOT EXISTS plan text;

COMMENT ON COLUMN public.license_clients.plan IS 'Plano comercial: PRO ou LITE.';
COMMENT ON COLUMN public.license_clients.nuit IS 'NUIT da loja (contribuinte).';
COMMENT ON COLUMN public.pos_tenant_registry.plan IS 'Plano sincronizado para o POS (rodapé).';
COMMENT ON COLUMN public.pos_tenant_registry.nuit IS 'NUIT sincronizado para o POS (rodapé).';
