-- PR-01.3 rollback: restore global document_number uniqueness.

BEGIN;

DROP INDEX IF EXISTS public.idx_orders_tenant_document_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_document_number_unique
ON public.orders(document_number)
WHERE document_number IS NOT NULL;

COMMIT;
