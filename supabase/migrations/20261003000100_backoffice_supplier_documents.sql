-- Etapa 1G.4 Fase 3D — Backoffice: Documentos de Fornecedor + Pagamentos.
--
-- supplier_documents/supplier_document_items: schema novo (auditoria confirmou não
-- existir nada equivalente — só suppliers, criado na 3B). Tenant+Store scoped (é a Store
-- que recebe a mercadoria — mesmo raciocínio do stock). document_number é a referência
-- REAL do documento do fornecedor (nunca gerado por nós — document_sequences/FC
-- explicitamente fora desta fase).
--
-- total NÃO é uma coluna armazenada: é sempre SUM(quantity*unit_cost) dos items,
-- calculado onde é preciso (mesma disciplina de "nunca guardar um derivado que possa
-- dessincronizar" já usada em warehouse_stock/products.stock_quantity).
--
-- IMUTABILIDADE (draft edita livremente; confirmed é definitivo; cancel de confirmed
-- bloqueado nesta fase): imposta em DUAS camadas independentes —
--  1) RLS: UPDATE de supplier_documents só USING(status='draft'), WITH CHECK só permite
--     NEW.status IN ('draft','cancelled') — uma sessão humana NUNCA consegue, por RLS,
--     fazer UPDATE de um documento não-draft, nem passar directamente para 'confirmed'.
--  2) Trigger supplier_documents_guard_immutable: BEFORE UPDATE, se OLD.status <>
--     'draft' bloqueia SEMPRE (defesa em profundidade — mesmo um bug futuro na RLS, ou
--     um GRANT mais permissivo, nunca conseguiria alterar um documento já não-draft).
--     A própria RPC de confirmação só é possível PORQUE o seu UPDATE acontece enquanto
--     OLD.status AINDA é 'draft' (a transição draft->confirmed em si).
-- supplier_document_items segue a mesma lógica: só editável enquanto o documento pai é
-- 'draft' (RLS + trigger próprios).
--
-- CONFIRMAÇÃO = UMA operação transaccional (pedido explícito: nunca uma RPC por item do
-- browser): backoffice_confirm_supplier_document faz um único INSERT por item dentro do
-- MESMO ciclo PL/pgSQL (uma chamada RPC = uma transacção Postgres — tudo ou nada por
-- construção, nunca "confirmado a meio"). Cada restock usa a MESMA ledger/idempotência
-- da Fase 1/3C (UNIQUE(tenant,product,type,reference_id); reference_id determinístico
-- por documento+produto) e device_id=NULL (aplicado pelo Store Server exactamente uma
-- vez, Fase 1). Um retry da confirmação inteira é idempotente pelo PRÓPRIO estado do
-- documento (já 'confirmed' -> 'already_confirmed', sem tocar em nada). O armazém de
-- destino não foi especificado na aprovação — mesmo default já usado em transfer_receive
-- (armazém principal da Store) quando não indicado explicitamente.
--
-- PAGAMENTOS: escrita SÓ via RPC (backoffice_pay_supplier_document), sem GRANT directo
-- de INSERT/UPDATE a `authenticated` — mesma disciplina de stock_movements/users (a
-- validação de saldo/overpayment só existe dentro da RPC; um INSERT directo contornava-a
-- por completo). Saldo (total - pagos) calculado sob pg_advisory_xact_lock por documento
-- — serializa pagamentos concorrentes ao MESMO documento (mesmo padrão da 3C.2, nunca um
-- lost update entre ler o saldo pago e inserir o novo pagamento). Idempotência própria
-- (idempotency_key UNIQUE por tenant) — não reutiliza reference_id do ledger, é outro
-- domínio. Documento tem de estar 'confirmed' para aceitar pagamento (mercadoria ainda
-- não recebida = nada a pagar ainda, por analogia com o resto do fluxo).

ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE public.supplier_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  supplier_id UUID NOT NULL,
  document_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT supplier_documents_store_fkey FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores (tenant_id, id),
  CONSTRAINT supplier_documents_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers (tenant_id, id),
  -- Evita a mesma factura em papel ser lançada duas vezes por engano. Se um fornecedor
  -- genuinamente reutilizar números, é uma constraint a revisitar — sinalizado no relatório.
  CONSTRAINT supplier_documents_tenant_supplier_number_key UNIQUE (tenant_id, supplier_id, document_number)
);
CREATE INDEX supplier_documents_tenant_id_idx ON public.supplier_documents (tenant_id);
CREATE INDEX supplier_documents_store_id_idx ON public.supplier_documents (store_id);
CREATE INDEX supplier_documents_supplier_id_idx ON public.supplier_documents (supplier_id);
-- Alvo das FKs compostas abaixo (items/payments).
ALTER TABLE public.supplier_documents ADD CONSTRAINT supplier_documents_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TRIGGER supplier_documents_set_updated_at
  BEFORE UPDATE ON public.supplier_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.supplier_documents_guard_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'supplier_document_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_documents_guard_immutable
  BEFORE UPDATE ON public.supplier_documents
  FOR EACH ROW EXECUTE FUNCTION public.supplier_documents_guard_immutable();

ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.supplier_documents TO authenticated;
CREATE POLICY supplier_documents_select_backoffice ON public.supplier_documents
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));
CREATE POLICY supplier_documents_insert_backoffice ON public.supplier_documents
  FOR INSERT WITH CHECK (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id) AND status = 'draft');
-- USING: só se pode partir de um documento ainda draft. WITH CHECK: o resultado nunca
-- pode ser 'confirmed' por esta via (só a RPC, SECURITY DEFINER, contorna a RLS).
CREATE POLICY supplier_documents_update_backoffice ON public.supplier_documents
  FOR UPDATE USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id) AND status = 'draft')
  WITH CHECK (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id) AND status IN ('draft', 'cancelled'));

CREATE TABLE public.supplier_document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  document_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_document_items_document_fkey FOREIGN KEY (tenant_id, document_id) REFERENCES public.supplier_documents (tenant_id, id),
  CONSTRAINT supplier_document_items_product_fkey FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id),
  CONSTRAINT supplier_document_items_document_product_key UNIQUE (document_id, product_id)
);
CREATE INDEX supplier_document_items_document_id_idx ON public.supplier_document_items (document_id);

CREATE TRIGGER supplier_document_items_set_updated_at
  BEFORE UPDATE ON public.supplier_document_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.supplier_document_items_guard_parent_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.supplier_documents WHERE id = COALESCE(NEW.document_id, OLD.document_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'supplier_document_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER supplier_document_items_guard_parent_draft
  BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_document_items
  FOR EACH ROW EXECUTE FUNCTION public.supplier_document_items_guard_parent_draft();

ALTER TABLE public.supplier_document_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_document_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_document_items TO authenticated;
CREATE POLICY supplier_document_items_select_backoffice ON public.supplier_document_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.supplier_documents d
    WHERE d.id = supplier_document_items.document_id AND d.tenant_id = supplier_document_items.tenant_id
      AND d.tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(d.store_id)
  ));
CREATE POLICY supplier_document_items_write_backoffice ON public.supplier_document_items
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.supplier_documents d
    WHERE d.id = supplier_document_items.document_id AND d.tenant_id = supplier_document_items.tenant_id
      AND d.tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(d.store_id) AND d.status = 'draft'
  )) WITH CHECK (tenant_id = public.backoffice_current_tenant_id() AND EXISTS (
    SELECT 1 FROM public.supplier_documents d
    WHERE d.id = supplier_document_items.document_id AND d.tenant_id = supplier_document_items.tenant_id
      AND public.backoffice_can_access_store(d.store_id) AND d.status = 'draft'
  ));

CREATE TABLE public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL,
  document_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method TEXT,
  idempotency_key TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_payments_supplier_fkey FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers (tenant_id, id),
  CONSTRAINT supplier_payments_document_fkey FOREIGN KEY (tenant_id, document_id) REFERENCES public.supplier_documents (tenant_id, id),
  CONSTRAINT supplier_payments_tenant_idem_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX supplier_payments_document_id_idx ON public.supplier_payments (document_id);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supplier_payments TO authenticated;
CREATE POLICY supplier_payments_select_backoffice ON public.supplier_payments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.supplier_documents d
    WHERE d.id = supplier_payments.document_id AND d.tenant_id = supplier_payments.tenant_id
      AND d.tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(d.store_id)
  ));
-- Sem GRANT de escrita nenhum: todo o INSERT passa por backoffice_pay_supplier_document
-- (a validação de saldo/overpayment só existe lá — um INSERT directo contorná-la-ia).

CREATE OR REPLACE FUNCTION public.backoffice_confirm_supplier_document(
  p_document_id UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS TABLE (out_status TEXT, out_items_applied INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_doc public.supplier_documents%ROWTYPE;
  v_wh UUID;
  v_item RECORD;
  v_ref TEXT;
  v_count INT := 0;
BEGIN
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_doc FROM public.supplier_documents WHERE id = p_document_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = '42501'; END IF;
  IF NOT public.backoffice_can_access_store(v_doc.store_id) THEN
    RAISE EXCEPTION 'store_not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_doc.status = 'confirmed' THEN
    RETURN QUERY SELECT 'already_confirmed'::text, 0;
    RETURN;
  END IF;
  IF v_doc.status = 'cancelled' THEN
    RAISE EXCEPTION 'document_cancelled' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.supplier_document_items i WHERE i.document_id = p_document_id) THEN
    RAISE EXCEPTION 'document_has_no_items' USING ERRCODE = '22023';
  END IF;

  IF p_warehouse_id IS NULL THEN
    SELECT w.id INTO v_wh FROM public.warehouses w
    WHERE w.store_id = v_doc.store_id AND w.tenant_id = v_tenant_id AND w.is_default AND w.is_active;
  ELSE
    SELECT w.id INTO v_wh FROM public.warehouses w
    WHERE w.id = p_warehouse_id AND w.store_id = v_doc.store_id AND w.tenant_id = v_tenant_id AND w.is_active;
  END IF;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501'; END IF;

  FOR v_item IN SELECT * FROM public.supplier_document_items i WHERE i.document_id = p_document_id LOOP
    v_ref := 'backoffice:supplier_doc:' || p_document_id::text || ':' || v_item.product_id::text;
    INSERT INTO public.store_products (tenant_id, store_id, product_id)
    VALUES (v_tenant_id, v_doc.store_id, v_item.product_id)
    ON CONFLICT (store_id, product_id) DO NOTHING;
    INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, product_id, type, quantity, reference_id, device_id)
    VALUES (v_tenant_id, v_doc.store_id, v_wh, v_item.product_id, 'restock', v_item.quantity, v_ref, NULL)
    ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.supplier_documents SET status = 'confirmed', confirmed_at = now() WHERE id = p_document_id;

  RETURN QUERY SELECT 'confirmed'::text, v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_confirm_supplier_document(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_confirm_supplier_document(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.backoffice_pay_supplier_document(
  p_document_id UUID,
  p_supplier_id UUID,
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
  v_doc public.supplier_documents%ROWTYPE;
  v_existing public.supplier_payments%ROWTYPE;
  v_total NUMERIC;
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

  -- idempotência primeiro (UNIQUE(tenant,idempotency_key) é o backstop final contra
  -- concorrência com a MESMA chave).
  SELECT * INTO v_existing FROM public.supplier_payments p WHERE p.tenant_id = v_tenant_id AND p.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT COALESCE(SUM(quantity * unit_cost), 0) INTO v_total FROM public.supplier_document_items WHERE document_id = v_existing.document_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.supplier_payments WHERE tenant_id = v_tenant_id AND document_id = v_existing.document_id;
    RETURN QUERY SELECT v_existing.id, 'duplicate'::text, (v_total - v_paid);
    RETURN;
  END IF;

  SELECT * INTO v_doc FROM public.supplier_documents WHERE id = p_document_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = '42501'; END IF;
  IF NOT public.backoffice_can_access_store(v_doc.store_id) THEN
    RAISE EXCEPTION 'store_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_doc.supplier_id <> p_supplier_id THEN
    RAISE EXCEPTION 'document_supplier_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_doc.status <> 'confirmed' THEN
    RAISE EXCEPTION 'document_not_confirmed' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = '22023';
  END IF;

  -- Serializa pagamentos CONCORRENTES ao MESMO documento — nunca um lost update entre
  -- ler o saldo pago e inserir o novo pagamento (mesmo padrão da 3C.2/backoffice_set_stock_count).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id || ':supplier_payment:' || p_document_id::text, 0));

  SELECT COALESCE(SUM(quantity * unit_cost), 0) INTO v_total FROM public.supplier_document_items WHERE document_id = p_document_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.supplier_payments WHERE tenant_id = v_tenant_id AND document_id = p_document_id;
  v_remaining := v_total - v_paid;
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.supplier_payments (tenant_id, supplier_id, document_id, amount, method, idempotency_key)
  VALUES (v_tenant_id, p_supplier_id, p_document_id, p_amount, NULLIF(p_method, ''), p_idempotency_key)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'inserted'::text, (v_remaining - p_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_pay_supplier_document(UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_pay_supplier_document(UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
