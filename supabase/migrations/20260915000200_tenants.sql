-- Etapa 1E.2 — baseline nova, bloco 002: tenants.
--
-- Tipo do id: TEXT, não UUID. Justificação (Etapa 1E.1/1E.2): todo o sistema já trata
-- tenant_id como string opaca (SQLite local: `tenant_id TEXT NOT NULL` em todas as
-- tabelas; claims JWT do device-auth: `tenant_id: string`; pos_tenant_registry/
-- license_clients antigos: `tenant_id TEXT`). Mudar para UUID obrigaria a alterar
-- geração/comparação de tenant_id em todo o POS/Electron/license-console sem nenhum
-- benefício técnico — exactamente o cenário que a Etapa 1E.1 pediu para evitar.
--
-- Estado próprio do tenant (distinto do estado da licença, que vive em `licenses` —
-- ver Etapa 1E.4): só o mínimo pedido, 'active'/'suspended'. Um tenant suspended deve,
-- numa etapa futura de device-auth, impedir renovação de tokens — a lógica fica para
-- essa etapa; aqui só o campo existe.
--
-- NUIT: nullable, com UNIQUE parcial (só quando preenchido e não vazio). Em Moçambique
-- há dados de desenvolvimento/onboarding sem NUIT ainda atribuído — bloquear por
-- NOT NULL/UNIQUE global impediria isso. Quando um NUIT real existe, não deve colidir
-- com o de outro tenant.

CREATE TABLE public.tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nuit TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenants_nuit_key
  ON public.tenants (nuit)
  WHERE nuit IS NOT NULL AND btrim(nuit) <> '';

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ligado, sem policies ainda (a etapa de RLS consolida o conjunto definitivo).
-- Enquanto isso: deny-all para anon/authenticated tanto por RLS como por GRANT
-- explícito — não confiar só na RLS (Etapa 1E.2, secção 15).
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenants FROM PUBLIC, anon, authenticated;
