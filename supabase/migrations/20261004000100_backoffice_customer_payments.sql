-- Etapa 1G.4 Fase 3E — Backoffice: Consulta VD/FT + Recebimentos de Clientes (conta corrente).
--
-- orders/order_items: JÁ tinham SELECT + RLS Device-scoped, ZERO GRANT de escrita a
-- `authenticated` (só create_order_with_items escreve — ver 1E.8/1G.2). Preservado tal e
-- qual: só policy SELECT aditiva do Backoffice. Backoffice NUNCA cria/altera VD/FT —
-- estruturalmente impossível por RLS (sem GRANT de INSERT/UPDATE nunca concedido a
-- `authenticated` nesta tabela, para nenhuma sessão).
--
-- customer_payments: schema novo, espelha supplier_payments (3D) do lado do cliente.
-- Escrita SÓ via backoffice_pay_customer_order (sem GRANT directo — mesma disciplina).
-- Estado financeiro é sempre DERIVADO (paid=SUM(customer_payments), balance=orders.total
-- - paid); orders.status NUNCA é escrito por esta etapa nem por nenhuma RPC daqui.
-- Saldo sob pg_advisory_xact_lock por order (mesmo padrão 3C.2/3D — nunca lost update
-- entre ler o saldo pago e inserir o novo pagamento).
--
-- Só aceita pagamento para doc_type='FT' com customer_id correspondente e status <>
-- 'cancelled' (VD nunca recebe pagamento aqui; uma FT cancelada nunca aceita pagamento).

CREATE POLICY orders_select_backoffice ON public.orders
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));
CREATE POLICY order_items_select_backoffice ON public.order_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id AND o.tenant_id = order_items.tenant_id
      AND o.tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(o.store_id)
  ));

CREATE TABLE public.customer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  order_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method TEXT,
  idempotency_key TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_payments_order_fkey FOREIGN KEY (tenant_id, order_id) REFERENCES public.orders (tenant_id, id),
  CONSTRAINT customer_payments_customer_fkey FOREIGN KEY (tenant_id, customer_id) REFERENCES public.customers (tenant_id, id),
  CONSTRAINT customer_payments_tenant_idem_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX customer_payments_order_id_idx ON public.customer_payments (order_id);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_payments TO authenticated;
CREATE POLICY customer_payments_select_backoffice ON public.customer_payments
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));
-- Sem GRANT de escrita: todo o INSERT passa por backoffice_pay_customer_order (a
-- validação de saldo/overpayment/doc_type/status só existe lá).

CREATE OR REPLACE FUNCTION public.backoffice_pay_customer_order(
  p_order_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_method TEXT,
  p_idempotency_key TEXT
)
RETURNS TABLE (out_id UUID, out_status TEXT, out_remaining NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_order public.orders%ROWTYPE;
  v_existing public.customer_payments%ROWTYPE;
  v_paid NUMERIC;
  v_remaining NUMERIC;
  v_id UUID;
BEGIN
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  -- idempotência primeiro (UNIQUE(tenant,idempotency_key) é o backstop final).
  SELECT * INTO v_existing FROM public.customer_payments p WHERE p.tenant_id = v_tenant_id AND p.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.customer_payments WHERE tenant_id = v_tenant_id AND order_id = v_existing.order_id;
    SELECT total INTO v_remaining FROM public.orders WHERE id = v_existing.order_id;
    RETURN QUERY SELECT v_existing.id, 'duplicate'::text, (v_remaining - v_paid);
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = '42501'; END IF;
  IF NOT public.backoffice_can_access_store(v_order.store_id) THEN
    RAISE EXCEPTION 'store_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_order.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'order_customer_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_order.doc_type IS DISTINCT FROM 'FT' THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_cancelled' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = '22023';
  END IF;

  -- Serializa pagamentos CONCORRENTES à MESMA encomenda — mesmo padrão 3C.2/3D.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id || ':customer_payment:' || p_order_id::text, 0));

  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.customer_payments WHERE tenant_id = v_tenant_id AND order_id = p_order_id;
  v_remaining := v_order.total - v_paid;
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customer_payments (tenant_id, store_id, customer_id, order_id, amount, method, idempotency_key)
  VALUES (v_tenant_id, v_order.store_id, p_customer_id, p_order_id, p_amount, NULLIF(p_method, ''), p_idempotency_key)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'inserted'::text, (v_remaining - p_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_pay_customer_order(UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_pay_customer_order(UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
