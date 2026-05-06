-- PR-01.2 validation script (post-deploy)
-- Run as an authenticated app user that carries tenant_id in JWT.

-- =========================================================
-- A) STRUCTURE / FUNCTION / TRIGGER CHECKS
-- =========================================================
SELECT
  'A1_orders_trigger_exists' AS check_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'orders'
        AND t.tgname = 'trg_orders_tenant_guard_biu'
        AND NOT t.tgisinternal
    ) THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A2_order_items_trigger_exists' AS check_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'order_items'
        AND t.tgname = 'trg_order_items_tenant_guard_biu'
        AND NOT t.tgisinternal
    ) THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A3_create_order_with_items_has_tenant_filter' AS check_name,
  CASE
    WHEN pg_get_functiondef('public.create_order_with_items(jsonb,jsonb)'::regprocedure)
         ILIKE '%WHERE o.tenant_id = v_tenant_id%'
      AND pg_get_functiondef('public.create_order_with_items(jsonb,jsonb)'::regprocedure)
          ILIKE '%INSERT INTO public.orders (%tenant_id,%local_sale_id%'
      AND pg_get_functiondef('public.create_order_with_items(jsonb,jsonb)'::regprocedure)
          ILIKE '%INSERT INTO public.order_items (%tenant_id,%order_id%'
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A4_create_order_atomic_has_tenant_insert' AS check_name,
  CASE
    WHEN pg_get_functiondef('public.create_order_atomic(jsonb,uuid,text,text,numeric,numeric,numeric,numeric,boolean,text,numeric,numeric,timestamptz,date)'::regprocedure)
         ILIKE '%INSERT INTO public.orders (%tenant_id,%customer_id%'
      AND pg_get_functiondef('public.create_order_atomic(jsonb,uuid,text,text,numeric,numeric,numeric,numeric,boolean,text,numeric,numeric,timestamptz,date)'::regprocedure)
          ILIKE '%INSERT INTO public.order_items (%tenant_id,%order_id%'
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A5_idempotency_index_tenant_scoped' AS check_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'orders_tenant_local_sale_id_key'
    ) THEN 'PASS' ELSE 'FAIL'
  END AS result;

-- =========================================================
-- B) DATA INTEGRITY CHECKS (must be zero)
-- =========================================================
SELECT
  'B1_orders_null_or_empty_tenant' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.orders
WHERE tenant_id IS NULL OR btrim(tenant_id) = '';

SELECT
  'B2_order_items_null_or_empty_tenant' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.order_items
WHERE tenant_id IS NULL OR btrim(tenant_id) = '';

SELECT
  'B3_order_items_parent_tenant_mismatch' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
WHERE oi.tenant_id <> o.tenant_id;

-- =========================================================
-- C) OPTIONAL LIVE CHECK (run one real sale then execute)
-- Replace :local_sale_id with the id from your smoke test sale.
-- =========================================================
-- SELECT
--   'C1_new_sale_rows_have_tenant' AS check_name,
--   CASE
--     WHEN EXISTS (
--       SELECT 1
--       FROM public.orders o
--       WHERE o.local_sale_id = :local_sale_id
--         AND o.tenant_id IS NOT NULL
--         AND btrim(o.tenant_id) <> ''
--     )
--     AND NOT EXISTS (
--       SELECT 1
--       FROM public.order_items oi
--       JOIN public.orders o ON o.id = oi.order_id
--       WHERE o.local_sale_id = :local_sale_id
--         AND (oi.tenant_id IS NULL OR btrim(oi.tenant_id) = '')
--     )
--   THEN 'PASS' ELSE 'FAIL'
--   END AS result;
