-- Etapa 1E.2 — baseline nova, bloco 001: extensões/helpers comuns.
--
-- gen_random_uuid() já vem disponível por omissão nas imagens Supabase (função nativa
-- do Postgres 13+ usada em todo o histórico antigo sem nenhum CREATE EXTENSION) — não
-- crio nenhuma extensão "por via das dúvidas"; se o reset abaixo falhar por causa disto,
-- reviso e adiciono só a que for realmente necessária.
--
-- Único helper comum às tabelas seguintes: trigger genérico de updated_at.
-- SECURITY INVOKER (omisso = invoker), search_path fixo, privilégio de EXECUTE
-- revogado de PUBLIC — só é invocado como trigger (não precisa de ser chamável
-- directamente via RPC/PostgREST).

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- REVOKE ... FROM PUBLIC sozinho NÃO chega: a Supabase concede EXECUTE a anon/
-- authenticated por omissão via ALTER DEFAULT PRIVILEGES, uma concessão explícita
-- separada de PUBLIC — confirmado ao introspectar o Postgres real nesta etapa
-- (has_function_privilege devolvia true para anon/authenticated mesmo depois do
-- REVOKE ... FROM PUBLIC). Revogo também explicitamente destes dois roles, tal
-- como já validado em pos_devices (Etapa 1C/1D).
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
