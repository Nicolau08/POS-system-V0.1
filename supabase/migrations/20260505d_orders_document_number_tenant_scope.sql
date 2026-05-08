-- PR-01.3: Scope order document uniqueness by tenant.
-- Fixes cross-tenant conflicts like VD/2026/0001 during sync.

BEGIN;

DROP INDEX IF EXISTS public.idx_orders_document_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tenant_document_number_unique
ON public.orders(tenant_id, document_number)
WHERE document_number IS NOT NULL;

COMMIT;
