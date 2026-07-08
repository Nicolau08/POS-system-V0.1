-- Isolar categorias por loja: o mesmo nome pode existir em tenants diferentes.
-- Antes: categories.name era UNIQUE global (categories_name_key), o que bloqueava
-- "Comida" numa loja se outra loja já tivesse "Comida".

BEGIN;

-- Remove UNIQUE antigo só em name (constraint ou índice, nomes podem variar).
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;

DO $$
DECLARE
  idx_name text;
BEGIN
  FOR idx_name IN
    SELECT i.relname
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (x.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'categories'
      AND x.indisunique
      AND NOT x.indisprimary
      AND a.attname = 'name'
      AND array_length(x.indkey, 1) = 1
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_name);
  END LOOP;
END $$;

-- Unicidade por loja (tenant + nome).
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_tenant_name
  ON public.categories (tenant_id, lower(btrim(name)));

COMMENT ON INDEX public.uq_categories_tenant_name IS
  'Cada loja pode ter o seu próprio grupo/categoria com o mesmo nome (ex.: Comida).';

COMMIT;
