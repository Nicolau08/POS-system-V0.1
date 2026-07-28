-- Verticais e capabilities base para activação progressiva de módulos.
-- Mantém commerce_type por compatibilidade com instalações/licenças antigas.

ALTER TABLE public.license_clients
  ADD COLUMN IF NOT EXISTS vertical text;

ALTER TABLE public.license_clients
  ADD COLUMN IF NOT EXISTS capabilities_json text;

ALTER TABLE public.pos_tenant_registry
  ADD COLUMN IF NOT EXISTS vertical text;

ALTER TABLE public.pos_tenant_registry
  ADD COLUMN IF NOT EXISTS capabilities_json text;

COMMENT ON COLUMN public.license_clients.vertical IS
  'Vertical funcional da licença (compatível com commerce_type legado).';
COMMENT ON COLUMN public.license_clients.capabilities_json IS
  'Lista JSON de capabilities activas para a licença.';
COMMENT ON COLUMN public.pos_tenant_registry.vertical IS
  'Vertical sincronizado para o POS.';
COMMENT ON COLUMN public.pos_tenant_registry.capabilities_json IS
  'Lista JSON de capabilities sincronizada para o POS.';
