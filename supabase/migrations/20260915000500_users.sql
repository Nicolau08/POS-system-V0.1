-- Etapa 1E.2 — baseline nova, bloco 005: users (operadores).
--
-- Campos aprovados na Etapa 1E.1: id, tenant_id, name, role, access_level, active,
-- pin_hash, created_at, updated_at. Sem `password` (duplicado confuso do pin),
-- sem `pin` em claro, sem `cloud_id` (é só uma ponte local, não faz sentido na
-- cloud), sem `is_system` (conceito de instalação local, não de tenant).
--
-- `role`: confirmado no código real (api/services/user.service.js) que só existem,
-- de facto, os valores 'admin' e o default 'cashier' — 'manager' só aparecia nas
-- policies das migrations antigas que NUNCA chegaram a aplicar (ficheiros com
-- sufixo de letra, sempre ignorados pelo CLI). A autorização real não é feita por
-- um enum de role — é feita por `access_level` (numérico) contra `permission_rules`
-- (requireMinLevel/requirePermission). Por isso NÃO crio CHECK (role IN (...)):
-- bloquear um valor legítimo futuro por um enum incompleto é exactamente o erro que
-- a Etapa 1E.1 pediu para evitar. `role` fica TEXT livre, com default 'cashier'.
--
-- `pin_hash`: só pode conter hash, nunca PIN em claro. Uma migration não consegue
-- provar sozinha que um valor é bcrypt (pedido explícito para não inventar um CHECK
-- frágil como única protecção) — a protecção real é no código, antes do push
-- (verificar isBcryptHash antes de enviar; ver Etapa 1E.1 secção 11, ainda por
-- implementar em syncService.js, fora do escopo desta etapa). Adiciono só uma rede
-- estrutural barata e honesta: um hash bcrypt real tem sempre 60 caracteres; um PIN
-- em claro (4-6 dígitos) nunca teria 20+. Isto não prova "é bcrypt", só rejeita o
-- caso óbvio de alguém enviar um PIN em claro por engano.

CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  access_level INTEGER NOT NULL DEFAULT 0,
  pin_hash TEXT NOT NULL CHECK (length(pin_hash) >= 20),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_tenant_id_idx ON public.users (tenant_id);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users FROM PUBLIC, anon, authenticated;
