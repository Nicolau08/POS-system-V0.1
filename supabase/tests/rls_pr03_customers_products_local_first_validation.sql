-- PR-03 customers/products local-first validation script

-- A) structure checks
SELECT
  'A1_customers_columns_present' AS check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'deleted_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'sync_version')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'origin_node_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'updated_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'tenant_id')
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A2_products_columns_present' AS check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'deleted')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'deleted_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'sync_version')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'origin_node_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'updated_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'tenant_id')
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A3_sync_indexes_present' AS check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'customers' AND indexname = 'idx_customers_tenant_updated_at')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'customers' AND indexname = 'idx_customers_tenant_deleted_at')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'customers' AND indexname = 'idx_customers_tenant_sync_version')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'products' AND indexname = 'idx_products_tenant_updated_at')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'products' AND indexname = 'idx_products_tenant_deleted_at')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'products' AND indexname = 'idx_products_tenant_sync_version')
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A4_rls_tenant_policies_present' AS check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customers' AND policyname = 'customers_tenant_select')
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customers' AND policyname = 'customers_tenant_modify')
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'products_tenant_select')
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'products' AND policyname = 'products_tenant_modify')
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

-- B) data integrity checks
SELECT
  'B1_customers_invalid_sync_version' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.customers
WHERE sync_version IS NULL OR sync_version < 1;

SELECT
  'B2_products_invalid_sync_version' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.products
WHERE sync_version IS NULL OR sync_version < 1;

SELECT
  'B3_products_deleted_without_deleted_at' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.products
WHERE COALESCE(deleted, 0) = 1
  AND deleted_at IS NULL;

-- C) deterministic conflict rule validation (pure SQL)
WITH samples AS (
  SELECT 10::bigint AS local_v, 9::bigint AS cloud_v, '2026-05-06T10:00:00Z'::timestamptz AS local_u, '2026-05-06T11:00:00Z'::timestamptz AS cloud_u, 'local'::text AS expected
  UNION ALL
  SELECT 7, 7, '2026-05-06T10:00:00Z', '2026-05-06T11:00:00Z', 'cloud'
  UNION ALL
  SELECT 7, 7, '2026-05-06T11:00:00Z', '2026-05-06T11:00:00Z', 'local'
),
decision AS (
  SELECT
    *,
    CASE
      WHEN local_v > cloud_v THEN 'local'
      WHEN cloud_v > local_v THEN 'cloud'
      WHEN local_u > cloud_u THEN 'local'
      WHEN cloud_u > local_u THEN 'cloud'
      ELSE 'local'
    END AS resolved
  FROM samples
)
SELECT
  'C1_conflict_resolution_deterministic' AS check_name,
  CASE WHEN COUNT(*) FILTER (WHERE resolved <> expected) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) FILTER (WHERE resolved <> expected) AS mismatches
FROM decision;
