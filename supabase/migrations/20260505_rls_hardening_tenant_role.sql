-- PR-01: RLS hardening (deny-by-default + tenant isolation + role gates)
-- Safe to run in staging first; idempotent where possible.

BEGIN;

-- 1) Tenant column hardening on critical tables.
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.document_sequences ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- 2) Backfill legacy rows to a controlled bootstrap tenant.
-- IMPORTANT: Replace 'tenant-bootstrap' with a real tenant before production rollout.
UPDATE public.categories SET tenant_id = 'tenant-bootstrap' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE public.products SET tenant_id = 'tenant-bootstrap' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE public.customers SET tenant_id = 'tenant-bootstrap' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE public.orders SET tenant_id = 'tenant-bootstrap' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE public.order_items oi
SET tenant_id = COALESCE(o.tenant_id, 'tenant-bootstrap')
FROM public.orders o
WHERE oi.order_id = o.id
  AND (oi.tenant_id IS NULL OR btrim(oi.tenant_id) = '');
UPDATE public.document_sequences SET tenant_id = 'tenant-bootstrap' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';

ALTER TABLE public.categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.document_sequences ALTER COLUMN tenant_id SET NOT NULL;

-- 3) Tenant indexes (read/write hot path).
CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON public.categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON public.products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON public.customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON public.orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON public.order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_sequences_tenant_id ON public.document_sequences(tenant_id);

-- 4) Helper functions for policy predicates.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'tenant_id', '');
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(auth.jwt() ->> 'app_role', ''), 'viewer');
$$;

-- 5) Force RLS (owners must also obey policies).
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_sequences FORCE ROW LEVEL SECURITY;

-- 6) Drop permissive legacy policies.
DROP POLICY IF EXISTS "Allow public read categories" ON public.categories;
DROP POLICY IF EXISTS "Allow public read products" ON public.products;
DROP POLICY IF EXISTS "Allow public read customers" ON public.customers;
DROP POLICY IF EXISTS "Allow public read orders" ON public.orders;
DROP POLICY IF EXISTS "Allow public read order_items" ON public.order_items;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.categories;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.products;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.customers;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.orders;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.order_items;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.document_sequences;

-- 7) Deny-by-default, role-scoped policies by table and operation.
-- Role model:
-- - viewer: read-only
-- - cashier: read + insert/update
-- - manager: read + full write
-- - admin: full write + delete

-- categories
CREATE POLICY categories_select_tenant
ON public.categories FOR SELECT
USING (tenant_id = public.current_tenant_id());

CREATE POLICY categories_insert_tenant_role
ON public.categories FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY categories_update_tenant_role
ON public.categories FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY categories_delete_tenant_role
ON public.categories FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() = 'admin'
);

-- products
CREATE POLICY products_select_tenant
ON public.products FOR SELECT
USING (tenant_id = public.current_tenant_id());

CREATE POLICY products_insert_tenant_role
ON public.products FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY products_update_tenant_role
ON public.products FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY products_delete_tenant_role
ON public.products FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() = 'admin'
);

-- customers
CREATE POLICY customers_select_tenant
ON public.customers FOR SELECT
USING (tenant_id = public.current_tenant_id());

CREATE POLICY customers_insert_tenant_role
ON public.customers FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY customers_update_tenant_role
ON public.customers FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY customers_delete_tenant_role
ON public.customers FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

-- orders
CREATE POLICY orders_select_tenant
ON public.orders FOR SELECT
USING (tenant_id = public.current_tenant_id());

CREATE POLICY orders_insert_tenant_role
ON public.orders FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY orders_update_tenant_role
ON public.orders FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY orders_delete_tenant_role
ON public.orders FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

-- order_items
CREATE POLICY order_items_select_tenant
ON public.order_items FOR SELECT
USING (tenant_id = public.current_tenant_id());

CREATE POLICY order_items_insert_tenant_role
ON public.order_items FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY order_items_update_tenant_role
ON public.order_items FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY order_items_delete_tenant_role
ON public.order_items FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

-- document_sequences
CREATE POLICY document_sequences_select_tenant
ON public.document_sequences FOR SELECT
USING (tenant_id = public.current_tenant_id());

CREATE POLICY document_sequences_insert_tenant_role
ON public.document_sequences FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY document_sequences_update_tenant_role
ON public.document_sequences FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY document_sequences_delete_tenant_role
ON public.document_sequences FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() = 'admin'
);

COMMIT;
