-- PR-01.1 validation tests for RPC compatibility after strict RLS.
-- Run in staging after:
-- - 20260505_rls_hardening_tenant_role.sql
-- - 20260505b_rls_post_hardening_rpc_compat.sql

BEGIN;

-- Tenant A cashier (normal sales flow role)
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cashier-a","role":"authenticated","tenant_id":"tenant-a","app_role":"cashier"}',
  true
);

-- Seed tenant A customer and create a simple order through RPC.
INSERT INTO public.customers (id, name, tenant_id)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Customer A', 'tenant-a')
ON CONFLICT (id) DO NOTHING;

SELECT *
FROM public.create_order_with_items(
  jsonb_build_object(
    'local_sale_id', 'sale-a-001',
    'customer_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'total', 100,
    'subtotal', 100,
    'tax', 0,
    'discount', 0,
    'status', 'completed',
    'doc_type', 'VD'
  ),
  '[]'::jsonb
);

-- Sequence consume should work for cashier and remain tenant-scoped.
SELECT public.vd_sequence_consume(2026) AS tenant_a_sequence;

-- Tenant B manager setup.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"manager-b","role":"authenticated","tenant_id":"tenant-b","app_role":"manager"}',
  true
);

INSERT INTO public.customers (id, name, tenant_id)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Customer B', 'tenant-b')
ON CONFLICT (id) DO NOTHING;

-- Back to tenant A cashier and attempt cross-tenant customer usage (must fail).
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cashier-a","role":"authenticated","tenant_id":"tenant-a","app_role":"cashier"}',
  true
);

-- Expect error: Customer does not belong to tenant-a
-- Run separately if your SQL runner stops on first error:
-- SELECT *
-- FROM public.create_order_with_items(
--   jsonb_build_object(
--     'local_sale_id', 'sale-a-002',
--     'customer_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
--     'total', 50,
--     'subtotal', 50,
--     'tax', 0,
--     'discount', 0
--   ),
--   '[]'::jsonb
-- );

ROLLBACK;
