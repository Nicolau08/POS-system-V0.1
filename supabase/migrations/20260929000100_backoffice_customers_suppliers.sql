-- Etapa 1G.4 Fase 3B — Backoffice: Clientes + Fornecedores.
--
-- CLIENTES: reutiliza public.customers tal como está (já tem GRANT SELECT/INSERT/UPDATE
-- a `authenticated` + RLS tenant-scoped desde 1E.8, igual a products/categories — ver
-- 20260917000100_rls_authenticated.sql). Só falta a policy ADITIVA do Backoffice
-- (backoffice_current_tenant_id()), nunca tocando na do Device. Sem service_role.
-- Tenant-scoped só (customers não tem store_id nenhum, local nem cloud — um cliente
-- não pertence a uma Store; "respeitar Store quando o modelo actual exigir" não se
-- aplica aqui, porque o modelo actual não tem esse conceito para clientes).
--
-- FORNECEDORES: auditoria confirmou que NÃO existe NENHUMA estrutura equivalente, nem
-- local (api/schema/*.js) nem cloud — só public.party_credits.party_kind='supplier'
-- (um ledger de créditos, referencia party_id como texto livre, nunca uma tabela mestre
-- com nome/contacto). "Não duplicar schema existente" não se aplica — não há nada para
-- reutilizar; cria-se public.suppliers de raiz, com a MESMA forma de public.customers
-- (mesma disciplina da migration 004: não inventar campos sem evidência — ex. NUIT só
-- entraria com uma migration futura, quando existir um consumidor real).
-- Diferença deliberada: `phone` aqui é NULLABLE (customers.phone é NOT NULL porque
-- reflecte uma constraint já existente no POS local `clientes.phone`; fornecedores não
-- têm nenhuma tabela local a impor isso — não inventar uma obrigatoriedade sem evidência).
--
-- Fornecedores são só-cloud, só-Backoffice por agora: o POS (local/Device) ainda não
-- tem nenhuma funcionalidade de fornecedores (a IMPORTANTE explícita desta etapa —
-- "não implementar documentos... ainda" — confirma que não há consumidor no POS ainda);
-- por isso sem GRANT/policy nenhuma para o Device, só para o Backoffice. Quando existir
-- um fluxo de documentos de fornecedor no POS (fase futura), essa etapa acrescenta o
-- GRANT+policy do Device (e o pull local), nunca esta.

CREATE POLICY customers_select_backoffice ON public.customers
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY customers_insert_backoffice ON public.customers
  FOR INSERT WITH CHECK (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY customers_update_backoffice ON public.customers
  FOR UPDATE USING (tenant_id = public.backoffice_current_tenant_id())
  WITH CHECK (tenant_id = public.backoffice_current_tenant_id());

CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_tenant_id_idx ON public.suppliers (tenant_id);

CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suppliers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;

CREATE POLICY suppliers_select_backoffice ON public.suppliers
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY suppliers_insert_backoffice ON public.suppliers
  FOR INSERT WITH CHECK (tenant_id = public.backoffice_current_tenant_id());
CREATE POLICY suppliers_update_backoffice ON public.suppliers
  FOR UPDATE USING (tenant_id = public.backoffice_current_tenant_id())
  WITH CHECK (tenant_id = public.backoffice_current_tenant_id());
-- Sem DELETE (mesma disciplina de customers/products/categories — nunca hard delete).
