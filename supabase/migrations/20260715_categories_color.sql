-- Category group colors for POS family chips / management UI
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS color TEXT;

COMMENT ON COLUMN public.categories.color IS 'Hex color (#RRGGBB) for product group chips in the POS.';
