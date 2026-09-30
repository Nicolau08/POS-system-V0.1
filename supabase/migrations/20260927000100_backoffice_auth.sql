-- Etapa 1G.4 Fase 2 — Backoffice Auth + Permissoes.
--
-- Human Auth (Supabase Auth, email/password) é DELIBERADAMENTE SEPARADO do Device Auth
-- (JWT custom assinado pelo license-console, claims tenant_id/device_id) e do Device Auth
-- Bridge usado pelo Store Server/POS. Uma sessão do Backoffice nunca carrega tenant_id nem
-- device_id — por isso public.current_tenant_id()/public.current_store_id() (que leem esses
-- claims, ver 20260915000800/20260919000200) devolvem sempre NULL para uma sessão humana.
-- NUNCA se reutilizam nem se alteram essas funções aqui — o Backoffice ganha os SEUS
-- próprios resolvers, baseados em auth.uid() (a sessão GoTrue real), sem tocar no caminho
-- do Device.
--
-- Modelo (pedido explicitamente): backoffice_users(user_id, tenant_id, role, status) +
-- backoffice_user_stores(user_id, store_id) — sem store_id NULL como "regra de owner":
-- owner = ausência de qualquer restrição por Store (resolvido em código, nunca por uma
-- linha mágica); store_operator = union das linhas em backoffice_user_stores.
--
-- Escrita destas duas tabelas: só via service_role (provisionamento manual/GIGA IT —
-- ver decisão "bootstrap manual só dev"). A sessão do próprio utilizador nunca escreve
-- aqui — só lê a SUA PRÓPRIA linha (RLS "self select only").
--
-- public.stores NÃO é tocada nesta migração: REVOKE ALL ... FROM ... authenticated já
-- existe (20260919000100) e é deliberado (fronteira de confiança do Device Auth, já
-- auditada em etapas anteriores) — o Backoffice lê Stores via Route Handler server-side
-- com service_role, sempre filtrado pela membership abaixo, nunca por uma policy nova
-- nessa tabela.

CREATE TABLE public.backoffice_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'store_operator')),
  -- Preparado para roles futuras (não implementadas agora): manter CHECK estrito por
  -- agora é mais seguro que aceitar texto livre; alargar o CHECK é sempre reversível.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX backoffice_users_tenant_id_idx ON public.backoffice_users (tenant_id);

CREATE TRIGGER backoffice_users_set_updated_at
  BEFORE UPDATE ON public.backoffice_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.backoffice_user_stores (
  user_id UUID NOT NULL REFERENCES public.backoffice_users (user_id) ON DELETE CASCADE,
  store_id UUID NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id),
  -- FK composta: estruturalmente impossível atribuir a um utilizador uma Store de um
  -- tenant_id diferente do seu (mesmo princípio já usado em stock_movements/stores).
  CONSTRAINT backoffice_user_stores_store_fkey
    FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores (tenant_id, id)
);
CREATE INDEX backoffice_user_stores_user_idx ON public.backoffice_user_stores (user_id);

ALTER TABLE public.backoffice_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backoffice_user_stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backoffice_users, public.backoffice_user_stores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.backoffice_users, public.backoffice_user_stores TO authenticated;

CREATE POLICY backoffice_users_select_self ON public.backoffice_users
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY backoffice_user_stores_select_self ON public.backoffice_user_stores
  FOR SELECT USING (user_id = auth.uid());

-- Resolvers da sessão humana actual. SECURITY DEFINER porque a própria função lê
-- backoffice_users (RLS "self only" já bastaria para o próprio uid, mas SECURITY DEFINER
-- evita qualquer dependência de GRANT adicional e mantém o padrão já usado no resto do
-- schema — ex. public.current_store_id()).
CREATE OR REPLACE FUNCTION public.backoffice_current_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM public.backoffice_users
  WHERE user_id = auth.uid() AND status = 'active';
$$;
REVOKE ALL ON FUNCTION public.backoffice_current_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_current_tenant_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.backoffice_current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.backoffice_users
  WHERE user_id = auth.uid() AND status = 'active';
$$;
REVOKE ALL ON FUNCTION public.backoffice_current_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_current_role() TO authenticated, service_role;

-- true se a sessão actual (owner do tenant da Store, ou store_operator explicitamente
-- atribuído) pode aceder a esta Store. Autoridade única para "posso ver esta Store" —
-- usada tanto por futuras RLS policies de tabelas de negócio como pelos Route Handlers
-- server-side (nunca confiar só na UI).
CREATE OR REPLACE FUNCTION public.backoffice_can_access_store(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.backoffice_users u
    WHERE u.user_id = auth.uid() AND u.status = 'active'
      AND (
        u.role = 'owner'
        AND EXISTS (SELECT 1 FROM public.stores s WHERE s.id = p_store_id AND s.tenant_id = u.tenant_id)
      )
  ) OR EXISTS (
    SELECT 1 FROM public.backoffice_user_stores s
    JOIN public.backoffice_users u ON u.user_id = s.user_id AND u.status = 'active'
    WHERE s.user_id = auth.uid() AND s.store_id = p_store_id
  );
$$;
REVOKE ALL ON FUNCTION public.backoffice_can_access_store(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_can_access_store(UUID) TO authenticated, service_role;
