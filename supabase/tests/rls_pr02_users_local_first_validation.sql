-- PR-02 users local-first validation script

-- A) structure checks
SELECT
  'A1_users_columns_present' AS check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deleted_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'sync_version')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'origin_node_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'updated_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'tenant_id')
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A2_users_sync_indexes_present' AS check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'idx_users_tenant_updated_at')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'idx_users_tenant_deleted_at')
     AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'idx_users_tenant_sync_version')
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A3_users_rls_tenant_policies' AS check_name,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_tenant_select')
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_tenant_modify')
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

SELECT
  'A4_users_policies_enforce_current_tenant' AS check_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'users'
        AND policyname = 'users_tenant_select'
        AND qual ILIKE '%current_tenant_id%'
    )
     AND EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'users'
        AND policyname = 'users_tenant_modify'
        AND qual ILIKE '%current_tenant_id%'
        AND with_check ILIKE '%current_tenant_id%'
    )
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

-- B) data integrity
SELECT
  'B1_users_null_or_empty_tenant' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.users
WHERE tenant_id IS NULL OR btrim(tenant_id) = '';

SELECT
  'B2_users_invalid_sync_version' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
  COUNT(*) AS affected_rows
FROM public.users
WHERE sync_version IS NULL OR sync_version < 1;

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
