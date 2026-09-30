-- Etapa 1E.2 — baseline nova, bloco 003: catalog (categories, products).
--
-- Campos escolhidos a partir do código REAL que sincroniza com a cloud
-- (api/syncService.js: syncCategory/upsertCategory linha ~3039-3046, syncProduct
-- linha ~2933-2958), não das migrations antigas. Colunas que existiam nas migrations
-- antigas mas que o código nunca sincroniza (`categories.icon`, `customers.points`
-- em 004) foram deliberadamente deixadas de fora — não copiar histórico morto.
--
-- `local_id` (products): o SQLite local guarda um id autoincremento próprio por
-- instalação; o código empurra esse valor para a cloud como referência informativa
-- (nunca é chave de nada aqui — cada instalação tem a sua própria numeração).
--
-- Unicidade de `barcode`/`code`: confirmado no código (api/services/product.service.js)
-- que estes campos são só pesquisados (LIKE), nunca validados como únicos, local nem
-- na cloud antiga. Não invento uma constraint que a aplicação não espera.

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nome único por tenant (não globalmente) — dois tenants podem ambos ter "Bebidas".
CREATE UNIQUE INDEX categories_tenant_name_key
  ON public.categories (tenant_id, lower(btrim(name)));
CREATE INDEX categories_tenant_id_idx ON public.categories (tenant_id);
CREATE INDEX categories_parent_id_idx ON public.categories (parent_id);

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.categories FROM PUBLIC, anon, authenticated;


CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  local_id INTEGER,
  code INTEGER,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  barcode TEXT,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  unit TEXT NOT NULL DEFAULT 'un',
  description TEXT,
  age_restriction INTEGER,
  is_service BOOLEAN NOT NULL DEFAULT false,
  default_quantity BOOLEAN NOT NULL DEFAULT true,
  track_lot BOOLEAN NOT NULL DEFAULT false,
  color TEXT,
  image TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX products_tenant_id_idx ON public.products (tenant_id);
CREATE INDEX products_category_id_idx ON public.products (category_id);
-- Índice de apoio à pesquisa por barcode (não é unicidade — ver nota acima).
CREATE INDEX products_tenant_barcode_idx
  ON public.products (tenant_id, barcode)
  WHERE barcode IS NOT NULL;

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.products FROM PUBLIC, anon, authenticated;
