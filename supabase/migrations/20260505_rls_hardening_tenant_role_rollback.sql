-- PR-01 rollback: restore previous permissive policies.
-- Use only if the hardening migration causes blocking incidents.

BEGIN;

-- 1) Remove strict policies.
DROP POLICY IF EXISTS categories_select_tenant ON public.categories;
DROP POLICY IF EXISTS categories_insert_tenant_role ON public.categories;
DROP POLICY IF EXISTS categories_update_tenant_role ON public.categories;
DROP POLICY IF EXISTS categories_delete_tenant_role ON public.categories;

DROP POLICY IF EXISTS products_select_tenant ON public.products;
DROP POLICY IF EXISTS products_insert_tenant_role ON public.products;
DROP POLICY IF EXISTS products_update_tenant_role ON public.products;
DROP POLICY IF EXISTS products_delete_tenant_role ON public.products;

DROP POLICY IF EXISTS customers_select_tenant ON public.customers;
DROP POLICY IF EXISTS customers_insert_tenant_role ON public.customers;
DROP POLICY IF EXISTS customers_update_tenant_role ON public.customers;
DROP POLICY IF EXISTS customers_delete_tenant_role ON public.customers;

DROP POLICY IF EXISTS orders_select_tenant ON public.orders;
DROP POLICY IF EXISTS orders_insert_tenant_role ON public.orders;
DROP POLICY IF EXISTS orders_update_tenant_role ON public.orders;
DROP POLICY IF EXISTS orders_delete_tenant_role ON public.orders;

DROP POLICY IF EXISTS order_items_select_tenant ON public.order_items;
DROP POLICY IF EXISTS order_items_insert_tenant_role ON public.order_items;
DROP POLICY IF EXISTS order_items_update_tenant_role ON public.order_items;
DROP POLICY IF EXISTS order_items_delete_tenant_role ON public.order_items;

DROP POLICY IF EXISTS document_sequences_select_tenant ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_insert_tenant_role ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_update_tenant_role ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_delete_tenant_role ON public.document_sequences;

-- 2) Stop forcing RLS.
ALTER TABLE public.categories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_sequences NO FORCE ROW LEVEL SECURITY;

-- 3) Recreate old permissive policies.
CREATE POLICY "Allow public read categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Allow public read products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Allow public read customers" ON public.customers FOR SELECT USING (true);
CREATE POLICY "Allow public read orders" ON public.orders FOR SELECT USING (true);
CREATE POLICY "Allow public read order_items" ON public.order_items FOR SELECT USING (true);

CREATE POLICY "Allow all for authenticated users" ON public.categories FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON public.products FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON public.customers FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON public.orders FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON public.order_items FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON public.document_sequences FOR ALL USING (true) WITH CHECK (true);

-- 4) Keep tenant_id columns to avoid destructive rollback.
-- Drop helper functions only if not needed by other migrations.
DROP FUNCTION IF EXISTS public.current_tenant_id();
DROP FUNCTION IF EXISTS public.current_app_role();

COMMIT;
