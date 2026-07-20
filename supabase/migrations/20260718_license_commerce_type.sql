-- Tipo de comércio (vertical): Restauração | Retalho | Farmácia.
-- Definido na consola ao criar o cliente; sincronizado para o POS.

ALTER TABLE public.license_clients
  ADD COLUMN IF NOT EXISTS commerce_type text NOT NULL DEFAULT 'retalho';

ALTER TABLE public.pos_tenant_registry
  ADD COLUMN IF NOT EXISTS commerce_type text;

COMMENT ON COLUMN public.license_clients.commerce_type IS 'Vertical: restauracao | retalho | farmacia.';
COMMENT ON COLUMN public.pos_tenant_registry.commerce_type IS 'Vertical sincronizado para o POS.';
