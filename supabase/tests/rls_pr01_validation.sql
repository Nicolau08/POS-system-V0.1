-- PR-01 validation tests (run in staging).
-- Assumes migration 20260505_rls_hardening_tenant_role.sql already applied.

BEGIN;

-- Simulate tenant A cashier
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"user-a","role":"authenticated","tenant_id":"tenant-a","app_role":"cashier"}',
  true
);

-- A can insert and read own tenant rows.
INSERT INTO public.customers (id, name, tenant_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'Customer A', 'tenant-a');

SELECT id, name, tenant_id
FROM public.customers
WHERE tenant_id = 'tenant-a';

-- Simulate tenant B manager creating data.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"user-b","role":"authenticated","tenant_id":"tenant-b","app_role":"manager"}',
  true
);

INSERT INTO public.customers (id, name, tenant_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'Customer B', 'tenant-b');

-- Back to tenant A cashier.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"user-a","role":"authenticated","tenant_id":"tenant-a","app_role":"cashier"}',
  true
);

-- A should NOT read tenant B rows (expect 0 rows).
SELECT id, name, tenant_id
FROM public.customers
WHERE tenant_id = 'tenant-b';

-- A should NOT insert tenant B rows (expect RLS error).
-- Run separately if your SQL runner stops on first error:
-- INSERT INTO public.customers (id, name, tenant_id)
-- VALUES ('33333333-3333-3333-3333-333333333333', 'Cross Tenant', 'tenant-b');

ROLLBACK;
