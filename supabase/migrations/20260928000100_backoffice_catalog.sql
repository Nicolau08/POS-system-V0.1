-- Etapa 1G.4 Fase 3A — Backoffice: Produtos + Categorias.
--
-- Auditoria (20260917000100_rls_authenticated.sql): categories/products já têm
-- GRANT SELECT/INSERT/UPDATE a `authenticated` + RLS tenant-scoped (current_tenant_id(),
-- claim do Device JWT) — classificados aí como "BIDIRECTIONAL, baixo risco". A sessão do
-- Backoffice (Supabase Auth humano) nunca tem esse claim, por isso as policies existentes
-- nunca a deixam passar — mas o GRANT de tabela já existe, só falta uma policy ADITIVA
-- paralela (backoffice_current_tenant_id()), nunca alterando a do Device. Sem
-- service_role: a própria sessão do Backoffice lê/escreve products/categories
-- directamente, com RLS como autoridade real (ao contrário de `stores`, que continua
-- REVOKE ALL de authenticated e por isso fora desta migração).
--
-- store_products (config por Store: status active/discontinued, price_override,
-- min_stock) só tinha SELECT concedido a `authenticated` (escrita sempre foi só via RPC
-- SECURITY DEFINER, nenhuma nunca chamada por um Device directamente para esta tabela —
-- confirmado: sync_stock_movements cria a linha via INSERT ON CONFLICT DO NOTHING dentro
-- da própria RPC, nunca por um GRANT directo de escrita). Aqui SIM se acrescenta
-- GRANT INSERT/UPDATE a `authenticated`, mas as ÚNICAS policies de escrita desta tabela
-- são as do Backoffice (scope adicional por Store via backoffice_can_access_store()) —
-- um Device continua sem nenhuma policy de escrita aqui, logo continua sem conseguir
-- escrever directamente (RLS nega por omissão sem policy permissiva).
--
-- products.id é o MESMO entre Stores (catálogo é do Tenant); a configuração por Store
-- vive só em store_products — não se introduz nenhum "products por Store" aqui.
-- products.stock_quantity nunca é lido/escrito por nada desta migração (autoridade
-- continua o ledger, Fase 1).

CREATE POLICY categories_select_backoffice ON public.categories
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY categories_insert_backoffice ON public.categories
  FOR INSERT WITH CHECK (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY categories_update_backoffice ON public.categories
  FOR UPDATE USING (tenant_id = public.backoffice_current_tenant_id())
  WITH CHECK (tenant_id = public.backoffice_current_tenant_id());

CREATE POLICY products_select_backoffice ON public.products
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY products_insert_backoffice ON public.products
  FOR INSERT WITH CHECK (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY products_update_backoffice ON public.products
  FOR UPDATE USING (tenant_id = public.backoffice_current_tenant_id())
  WITH CHECK (tenant_id = public.backoffice_current_tenant_id());

GRANT INSERT, UPDATE ON public.store_products TO authenticated;
CREATE POLICY store_products_select_backoffice ON public.store_products
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));
CREATE POLICY store_products_insert_backoffice ON public.store_products
  FOR INSERT WITH CHECK (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));
CREATE POLICY store_products_update_backoffice ON public.store_products
  FOR UPDATE USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id))
  WITH CHECK (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));
