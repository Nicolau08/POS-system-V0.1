-- Etapa 1E.3 — baseline nova, bloco 007: orders, order_items, document_sequences.
--
-- create_order_with_items FICA DE FORA desta migration deliberadamente — ver o
-- relatório desta etapa: encontrei uma razão técnica real para reconsiderar
-- SECURITY INVOKER (o desenho aprovado na 1E.1) e preciso de autorização antes de
-- a implementar, conforme pedido explicitamente. A tabela/constraints ficam prontas
-- para a RPC assentar em cima assim que essa decisão for tomada.
--
-- Campos mapeados do código REAL (não da migration histórica):
--  - toOrderPayload (api/syncService.js:2540-2581): local_sale_id, total, subtotal, tax,
--    discount, customer_id, table_number, doc_type, document_number (hoje pré-calculado
--    no cliente — ver incompatibilidade assinalada abaixo), payment_method,
--    received_amount, change_amount, status ('completed'|'pending'|'cancelled'),
--    tenant_id, created_at. NENHUM campo de operador/dispositivo/estação é enviado hoje.
--  - toOrderItemsPayload (api/syncService.js:2700-2759): product_id, product_name,
--    quantity (sempre > 0 — o sinal fica só em stock_movements), price, discount_amount.
--  - Auditoria de operador/estação (api/schema/operations.js local orders): user_id,
--    user_name, e (Etapa 1E.1) device_id/station_code — nenhum destes é hoje enviado
--    pela sync; adiciono as colunas (nullable) porque a Etapa 1E.1 pediu-as para
--    auditoria, mas fica registado que syncService.js precisará de as popular numa
--    etapa de integração futura.
--
-- INCOMPATIBILIDADE ENCONTRADA (secção 1/27, não corrigida agora):
--  - `document_number` é hoje ESCOLHIDO PELO CLIENTE antes de chamar a RPC (ver
--    syncService.js:2574 `document_number: sale.usedDocumentNumber`), com um
--    tratamento de conflito (23505) que RENUMERA e tenta de novo. A nova RPC
--    (quando desenhada) vai atribuir o número SEMPRE internamente e de forma atómica
--    (secção 12/13 desta etapa) — isto é uma mudança de contrato, não cosmética.
--    `syncService.js` vai deixar de precisar (e dever) de pré-calcular/renumerar;
--    fica sinalizado, não implementado.
--  - `order_items.quantity` era INTEGER na migration histórica; o SQLite local usa
--    REAL (quantidades fracionárias, ex. produtos por peso, são suportadas hoje).
--    Uso NUMERIC aqui — manter INTEGER teria truncado/rejeitado vendas reais.
--  - `products.deleted` (bloco 003) já ficou BOOLEAN; syncService.js ainda envia 0/1 —
--    mesma incompatibilidade já assinalada na 1E.2, não repetida em código aqui.

-- Alvo da FK composta de orders.customer_id (abaixo) — mesmo raciocínio de
-- products_tenant_id_id_key no bloco 006: nunca editar uma migration já aprovada
-- (004_customers.sql), antes adiciono aqui a constraint que falta.
ALTER TABLE public.customers ADD CONSTRAINT customers_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE public.document_sequences (
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doc_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_value BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, doc_type, year)
);
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_sequences FROM PUBLIC, anon, authenticated;


CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  local_sale_id TEXT NOT NULL,
  customer_id UUID,
  -- Auditoria do operador (secção 16): PROPOSITADAMENTE sem FK para public.users.
  -- Justificação: uma venda offline pode sincronizar muito depois de criada, com um
  -- operador entretanto desativado ou ainda não sincronizado para a cloud (o `users`
  -- também sincroniza de forma eventualmente consistente, por tenant inteiro — ver
  -- Etapa 1E.1). Uma FK rígida bloquearia/atrasaria o sync de vendas legítimas por
  -- causa de um problema de ORDEM de sincronização, não de integridade real. O
  -- registo é só informativo/auditoria — nunca usado para autorização cloud (isso é
  -- resolvido pelo tenant_id do JWT do device, nunca pelo operador local).
  user_id UUID,
  user_name TEXT,
  -- Auditoria de dispositivo/estação (Etapa 1E.1 secção 8): sem FK para pos_devices
  -- ainda, porque essa tabela só entra na próxima etapa (1E.4).
  device_id TEXT,
  station_code TEXT,
  table_number TEXT,
  doc_type TEXT,
  document_number TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'cancelled')),
  payment_method TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_amount NUMERIC(12,2),
  change_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_tenant_customer_fkey
    FOREIGN KEY (tenant_id, customer_id) REFERENCES public.customers (tenant_id, id)
    ON DELETE SET NULL (customer_id)
);

-- Idempotência de venda (secção 9): retry da MESMA venda (tenant+local_sale_id)
-- nunca cria uma segunda order.
CREATE UNIQUE INDEX orders_tenant_local_sale_id_key ON public.orders (tenant_id, local_sale_id);
-- Número documental único por tenant + doc_type (nunca cross-tenant, nunca duplicado
-- no mesmo tenant). ACHADO REAL (Etapa 1E.3, teste de concorrência cross-tenant):
-- sem `doc_type` aqui, dois tipos de documento diferentes (ex. 'VD' e uma futura
-- série 'FT') podiam colidir no mesmo `document_number` formatado ("2026/0001"),
-- porque o formato actual (ano/sequência) não inclui o tipo — o mesmo formato que o
-- histórico antigo já usava, com o mesmo problema latente nunca detectado. Isto NÃO
-- decide o formato fiscal definitivo (fica para a etapa fiscal, secção 13); só
-- corrige a unicidade para o formato actual.
CREATE UNIQUE INDEX orders_tenant_document_number_key
  ON public.orders (tenant_id, doc_type, document_number)
  WHERE document_number IS NOT NULL;
CREATE INDEX orders_tenant_id_idx ON public.orders (tenant_id);
CREATE INDEX orders_customer_id_idx ON public.orders (customer_id);
-- Alvo da FK composta de order_items (abaixo) — id já é PK/único globalmente, mas a
-- FK composta exige um UNIQUE explícito sobre exatamente (tenant_id, id).
ALTER TABLE public.orders ADD CONSTRAINT orders_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;


CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL,
  product_id UUID,
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "order Tenant A + item Tenant B" estruturalmente impossível: a FK composta exige
  -- uma linha em orders com o MESMO tenant_id — não há como apontar order_id de A
  -- com tenant_id de B (não existiria linha nenhuma a satisfazer a FK).
  CONSTRAINT order_items_tenant_order_fkey
    FOREIGN KEY (tenant_id, order_id) REFERENCES public.orders (tenant_id, id)
    ON DELETE CASCADE,
  -- Mesma lógica para "produto de outro tenant numa order deste tenant".
  CONSTRAINT order_items_tenant_product_fkey
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id)
    ON DELETE SET NULL (product_id)
);

CREATE INDEX order_items_tenant_id_idx ON public.order_items (tenant_id);
CREATE INDEX order_items_order_id_idx ON public.order_items (order_id);
CREATE INDEX order_items_product_id_idx ON public.order_items (product_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_items FROM PUBLIC, anon, authenticated;
