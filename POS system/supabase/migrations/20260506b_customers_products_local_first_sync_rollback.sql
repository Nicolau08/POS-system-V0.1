-- rollback PR-2 customers/products local-first sync baseline

DROP POLICY IF EXISTS products_tenant_modify ON public.products;
DROP POLICY IF EXISTS products_tenant_select ON public.products;
DROP POLICY IF EXISTS customers_tenant_modify ON public.customers;
DROP POLICY IF EXISTS customers_tenant_select ON public.customers;

DROP INDEX IF EXISTS public.idx_products_tenant_deleted;
DROP INDEX IF EXISTS public.idx_products_tenant_sync_version;
DROP INDEX IF EXISTS public.idx_products_tenant_deleted_at;
DROP INDEX IF EXISTS public.idx_products_tenant_updated_at;
DROP INDEX IF EXISTS public.idx_customers_tenant_sync_version;
DROP INDEX IF EXISTS public.idx_customers_tenant_deleted_at;
DROP INDEX IF EXISTS public.idx_customers_tenant_updated_at;

-- Keep columns to avoid data loss during rollback.
-- Legacy sync code keeps working with extra columns present.
