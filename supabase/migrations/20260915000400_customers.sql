-- Etapa 1E.2 — baseline nova, bloco 004: customers.
--
-- Campos a partir do código real (api/syncService.js:syncCustomer, linha ~3152-3159)
-- e do schema local (api/schema/sales-core.js: tabela `clientes`).
--
-- NUIT: não existe NENHUM campo de identificação fiscal do cliente hoje, nem local
-- nem na cloud antiga — não invento um. Se/quando o POS precisar de NUIT do cliente
-- (ex.: fatura com NUIT do comprador), isso é uma migration futura, não suposição
-- desta etapa.
--
-- `phone NOT NULL`: reflecte a coluna local (`clientes.phone TEXT NOT NULL`) — o POS
-- já obriga um valor (mesmo que seja um placeholder para cliente ocasional); não
-- relaxo isto sem evidência de que o POS aceita clientes sem telefone.
-- `points` (fidelização) existe localmente mas nunca é sincronizado para a cloud —
-- fica de fora, tal como aconteceu com `categories.icon`.

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customers_tenant_id_idx ON public.customers (tenant_id);

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customers FROM PUBLIC, anon, authenticated;
