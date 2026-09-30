-- Etapa 1G.4 Fase 8 — Login NUIT+username+password sobre Supabase Auth.
--
-- GoTrue exige email/phone como identidade nativa; NUIT/username NUNCA são credenciais
-- do GoTrue. Cada backoffice_users ganha uma identidade Auth interna OPACA e ESTÁVEL,
-- guardada EXPLICITAMENTE (nunca derivada/reconstruída em runtime a partir do user_id —
-- risco levantado na auditoria: admin.createUser() só devolve o id DEPOIS do email já
-- ter sido escolhido, logo "reconstruir" o email a partir do id é uma ordem de operações
-- inválida). Este email nunca é mostrado a ninguém — é só a chave interna que o GoTrue
-- exige; o login público é sempre NUIT (localiza o Tenant) + username (localiza a linha).
--
-- requires_first_access: coluna SEPARADA de must_change_password/recovery_email_verified,
-- de propósito. Sem ela, todas as linhas de backoffice_users já existentes (criadas nas
-- Fases 2-7, directo por service_role, sem passar por este fluxo) ficariam com
-- recovery_email_verified=false por omissão e seriam bloqueadas retroactivamente por
-- "primeiro acesso" nunca concluído — uma regressão real. requires_first_access só é
-- true para contas criadas pelo NOVO fluxo de provisionamento (License Console); todas
-- as linhas antigas ficam false por omissão e continuam a funcionar exactamente como
-- antes, sem qualquer gate novo.
ALTER TABLE public.backoffice_users
  ADD COLUMN username TEXT,
  ADD COLUMN auth_internal_email TEXT,
  ADD COLUMN requires_first_access BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN recovery_email TEXT,
  ADD COLUMN recovery_email_verified BOOLEAN NOT NULL DEFAULT false;

-- Nullable (mesma disciplina de tenants.nuit — 20260915000200: dados antigos/dev sem
-- username ainda não devem quebrar); único só quando preenchido, case-insensitive.
CREATE UNIQUE INDEX backoffice_users_tenant_username_key
  ON public.backoffice_users (tenant_id, lower(username))
  WHERE username IS NOT NULL AND btrim(username) <> '';
CREATE UNIQUE INDEX backoffice_users_auth_internal_email_key
  ON public.backoffice_users (auth_internal_email)
  WHERE auth_internal_email IS NOT NULL;

COMMENT ON COLUMN public.backoffice_users.auth_internal_email IS
  'Identidade interna do GoTrue (auth.users.email) — opaca, nunca mostrada ao utilizador. NÃO é o recovery_email.';

-- Tokens de reset de password / verificação de email de recuperação. Só hash guardado
-- (nunca o token em claro), TTL curto, uso único. Zero GRANT a anon/authenticated — os
-- pedidos que usam esta tabela (login pré-sessão, "esqueci a senha", clique no link de
-- verificação) correm sempre server-side com service_role, nunca com a sessão do
-- utilizador (que muitas vezes ainda nem existe nesse momento).
CREATE TABLE public.backoffice_auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.backoffice_users (user_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
  token_hash TEXT NOT NULL,
  target_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX backoffice_auth_tokens_user_purpose_idx ON public.backoffice_auth_tokens (user_id, purpose);
CREATE INDEX backoffice_auth_tokens_expires_idx ON public.backoffice_auth_tokens (expires_at);

ALTER TABLE public.backoffice_auth_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backoffice_auth_tokens FROM PUBLIC, anon, authenticated;
-- Sem GRANT nenhum e sem policy: só service_role (que ignora RLS) lê/escreve esta tabela.
