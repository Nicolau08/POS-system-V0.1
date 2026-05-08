-- PR-2 customers/products local-first sync baseline

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sync_version bigint NOT NULL DEFAULT 1,
  origin_node_id text
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  name text NOT NULL,
  deleted integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sync_version bigint NOT NULL DEFAULT 1,
  origin_node_id text
);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS sync_version bigint;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS origin_node_id text;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS deleted integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sync_version bigint;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origin_node_id text;

UPDATE public.customers
SET updated_at = COALESCE(updated_at, now()),
    created_at = COALESCE(created_at, now()),
    sync_version = GREATEST(COALESCE(sync_version, 1), 1)
WHERE updated_at IS NULL
   OR created_at IS NULL
   OR sync_version IS NULL
   OR sync_version < 1;

UPDATE public.products
SET deleted = COALESCE(deleted, 0),
    updated_at = COALESCE(updated_at, now()),
    created_at = COALESCE(created_at, now()),
    sync_version = GREATEST(COALESCE(sync_version, 1), 1),
    deleted_at = CASE
      WHEN COALESCE(deleted, 0) = 1 AND deleted_at IS NULL THEN COALESCE(updated_at, now())
      ELSE deleted_at
    END
WHERE deleted IS NULL
   OR updated_at IS NULL
   OR created_at IS NULL
   OR sync_version IS NULL
   OR sync_version < 1
   OR (COALESCE(deleted, 0) = 1 AND deleted_at IS NULL);

ALTER TABLE public.customers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.customers ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.customers ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN sync_version SET DEFAULT 1;
ALTER TABLE public.customers ALTER COLUMN sync_version SET NOT NULL;

ALTER TABLE public.products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN deleted SET DEFAULT 0;
ALTER TABLE public.products ALTER COLUMN deleted SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.products ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.products ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN sync_version SET DEFAULT 1;
ALTER TABLE public.products ALTER COLUMN sync_version SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_updated_at ON public.customers(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_deleted_at ON public.customers(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_sync_version ON public.customers(tenant_id, sync_version);

CREATE INDEX IF NOT EXISTS idx_products_tenant_updated_at ON public.products(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_products_tenant_deleted_at ON public.products(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_products_tenant_sync_version ON public.products(tenant_id, sync_version);
CREATE INDEX IF NOT EXISTS idx_products_tenant_deleted ON public.products(tenant_id, deleted);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_tenant_select ON public.customers;
DROP POLICY IF EXISTS customers_tenant_modify ON public.customers;
DROP POLICY IF EXISTS products_tenant_select ON public.products;
DROP POLICY IF EXISTS products_tenant_modify ON public.products;

CREATE POLICY customers_tenant_select
ON public.customers
FOR SELECT
TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY customers_tenant_modify
ON public.customers
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY products_tenant_select
ON public.products
FOR SELECT
TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY products_tenant_modify
ON public.products
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());
