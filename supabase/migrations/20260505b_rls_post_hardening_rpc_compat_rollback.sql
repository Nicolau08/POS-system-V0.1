-- PR-01.1 rollback: revert post-RLS RPC compatibility layer.

BEGIN;

-- 1) Remove tenant guard triggers/functions.
DROP TRIGGER IF EXISTS trg_orders_tenant_guard_biu ON public.orders;
DROP TRIGGER IF EXISTS trg_order_items_tenant_guard_biu ON public.order_items;
DROP TRIGGER IF EXISTS trg_document_sequences_tenant_guard_biu ON public.document_sequences;
DROP TRIGGER IF EXISTS trg_customers_tenant_guard_biu ON public.customers;

DROP FUNCTION IF EXISTS public.apply_and_validate_tenant_orders();
DROP FUNCTION IF EXISTS public.apply_and_validate_tenant_order_items();
DROP FUNCTION IF EXISTS public.apply_and_validate_tenant_document_sequences();
DROP FUNCTION IF EXISTS public.apply_and_validate_tenant_customers();

-- 2) Revert document_sequences role policies to pre-PR-01.1 strict set.
DROP POLICY IF EXISTS document_sequences_insert_tenant_role ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_update_tenant_role ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_delete_tenant_role ON public.document_sequences;

CREATE POLICY document_sequences_insert_tenant_role
ON public.document_sequences FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY document_sequences_update_tenant_role
ON public.document_sequences FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('manager', 'admin')
);

CREATE POLICY document_sequences_delete_tenant_role
ON public.document_sequences FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() = 'admin'
);

-- 3) Revert document_sequences key shape.
ALTER TABLE public.document_sequences
DROP CONSTRAINT IF EXISTS document_sequences_pkey;

ALTER TABLE public.document_sequences
ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (doc_type, year);

COMMIT;
