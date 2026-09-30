-- Etapa 1G.2A — Tenant -> Store -> Device: tabela `stores`, limites max_stores /
-- max_stations_per_store (independentes de max_devices), store_id obrigatório em
-- device_activation_tokens e pos_devices, criação de Store com enforcement
-- transaccional de max_stores.
--
-- Modelo: uma Store pertence a UMA licença (tenant_id + license_id). O limite
-- max_stores conta stores por licença (suspensas continuam a ocupar vaga — não há
-- DELETE). max_devices continua a contar devices por licença, inalterado.
-- max_stations_per_store é só armazenado aqui; o enforcement é local (fora do
-- âmbito desta etapa).

-- ---------------------------------------------------------------------------
-- 1. stores
-- ---------------------------------------------------------------------------
CREATE TABLE public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  license_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  code TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stores_tenant_license_fkey
    FOREIGN KEY (tenant_id, license_id) REFERENCES public.licenses (tenant_id, id),
  -- Alvo das FKs compostas de tokens/devices: "store de outro tenant/licença" impossível.
  CONSTRAINT stores_tenant_license_id_key UNIQUE (tenant_id, license_id, id)
);
CREATE UNIQUE INDEX stores_license_code_key
  ON public.stores (license_id, lower(code))
  WHERE code IS NOT NULL AND btrim(code) <> '';
CREATE INDEX stores_tenant_id_idx ON public.stores (tenant_id);
CREATE INDEX stores_license_id_idx ON public.stores (license_id);

CREATE TRIGGER stores_set_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stores FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. limites na licença (max_devices existente NÃO é tocado; NULL = ilimitado)
-- ---------------------------------------------------------------------------
ALTER TABLE public.licenses
  ADD COLUMN max_stores INTEGER CHECK (max_stores IS NULL OR max_stores >= 0),
  ADD COLUMN max_stations_per_store INTEGER CHECK (max_stations_per_store IS NULL OR max_stations_per_store >= 0);

-- ---------------------------------------------------------------------------
-- 3. store_id em tokens/devices — auditar/backfill ANTES de NOT NULL.
--    Dados pré-existentes (tokens/devices sem store) ficam ligados a uma store
--    "Loja principal" criada por licença. O trigger de limite só é criado depois
--    do backfill (dados legados nunca são bloqueados por max_stores).
-- ---------------------------------------------------------------------------
ALTER TABLE public.device_activation_tokens ADD COLUMN store_id UUID;
ALTER TABLE public.pos_devices ADD COLUMN store_id UUID;

INSERT INTO public.stores (tenant_id, license_id, name, code)
SELECT DISTINCT x.tenant_id, x.license_id, 'Loja principal', 'default'
FROM (
  SELECT tenant_id, license_id FROM public.pos_devices
  UNION
  SELECT tenant_id, license_id FROM public.device_activation_tokens
) x;

UPDATE public.device_activation_tokens t
SET store_id = s.id
FROM public.stores s
WHERE s.tenant_id = t.tenant_id AND s.license_id = t.license_id AND s.code = 'default' AND t.store_id IS NULL;

UPDATE public.pos_devices d
SET store_id = s.id
FROM public.stores s
WHERE s.tenant_id = d.tenant_id AND s.license_id = d.license_id AND s.code = 'default' AND d.store_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.device_activation_tokens WHERE store_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.pos_devices WHERE store_id IS NULL) THEN
    RAISE EXCEPTION 'backfill_store_id_incomplete';
  END IF;
END $$;

ALTER TABLE public.device_activation_tokens ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.pos_devices ALTER COLUMN store_id SET NOT NULL;

ALTER TABLE public.device_activation_tokens ADD CONSTRAINT device_activation_tokens_store_fkey
  FOREIGN KEY (tenant_id, license_id, store_id) REFERENCES public.stores (tenant_id, license_id, id);
ALTER TABLE public.pos_devices ADD CONSTRAINT pos_devices_store_fkey
  FOREIGN KEY (tenant_id, license_id, store_id) REFERENCES public.stores (tenant_id, license_id, id);
CREATE INDEX device_activation_tokens_store_id_idx ON public.device_activation_tokens (store_id);
CREATE INDEX pos_devices_store_id_idx ON public.pos_devices (store_id);

-- ---------------------------------------------------------------------------
-- 4. Enforcement transaccional de max_stores (fail-closed, qualquer caminho de INSERT).
--    O FOR UPDATE na linha da licença serializa criações concorrentes da mesma
--    licença: a 2.ª só conta depois do commit da 1.ª.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_store_limits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license public.licenses%ROWTYPE;
  v_tenant_status TEXT;
  v_count INTEGER;
BEGIN
  SELECT status INTO v_tenant_status FROM public.tenants WHERE id = NEW.tenant_id;
  IF v_tenant_status IS NULL OR v_tenant_status <> 'active' THEN
    RAISE EXCEPTION 'tenant_not_active' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_license FROM public.licenses
  WHERE id = NEW.license_id AND tenant_id = NEW.tenant_id
  FOR UPDATE;
  IF v_license.id IS NULL THEN
    RAISE EXCEPTION 'license_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'suspended' THEN
    RAISE EXCEPTION 'license_suspended' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'revoked' THEN
    RAISE EXCEPTION 'license_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_license.expires_at IS NOT NULL AND v_license.expires_at <= now() THEN
    RAISE EXCEPTION 'license_expired' USING ERRCODE = '28000';
  END IF;

  IF v_license.max_stores IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.stores WHERE license_id = NEW.license_id;
    IF v_count >= v_license.max_stores THEN
      RAISE EXCEPTION 'max_stores_reached' USING ERRCODE = '28000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER stores_enforce_limits
  BEFORE INSERT ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.enforce_store_limits();

-- tenant/licença de uma store são imutáveis (impede mover uma store para outra
-- licença e contornar o limite).
CREATE OR REPLACE FUNCTION public.stores_scope_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.license_id IS DISTINCT FROM OLD.license_id THEN
    RAISE EXCEPTION 'store_scope_immutable' USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stores_scope_immutable
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.stores_scope_immutable();

-- Só backend (service_role): cria store; o limite é imposto pelo trigger acima.
CREATE OR REPLACE FUNCTION public.create_store(
  p_tenant_id TEXT,
  p_license_id UUID,
  p_name TEXT,
  p_code TEXT DEFAULT NULL
)
RETURNS TABLE (out_store_id UUID)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.stores (tenant_id, license_id, name, code)
  VALUES (p_tenant_id, p_license_id, btrim(p_name), NULLIF(btrim(COALESCE(p_code, '')), ''))
  RETURNING id INTO v_id;
  out_store_id := v_id;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.create_store(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Token de activação só pode ser emitido para uma store activa.
CREATE OR REPLACE FUNCTION public.activation_token_store_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.stores WHERE id = NEW.store_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'store_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'store_suspended' USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER device_activation_tokens_store_active
  BEFORE INSERT ON public.device_activation_tokens
  FOR EACH ROW EXECUTE FUNCTION public.activation_token_store_active();

-- ---------------------------------------------------------------------------
-- 5. bootstrap_pos_device: store_id derivado EXCLUSIVAMENTE do activation token.
--    Assinatura e tipo de retorno inalterados (nenhum parâmetro store_id do cliente).
--    Acrescenta: tenant activo e store activa. max_devices/lock/uso único inalterados.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_pos_device(
  p_activation_token_hash TEXT,
  p_device_id UUID,
  p_machine_id TEXT,
  p_station_code TEXT,
  p_refresh_token_hash TEXT,
  p_refresh_token_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
  out_tenant_id TEXT,
  out_license_id UUID,
  out_device_id UUID,
  out_token_version INTEGER
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_activation public.device_activation_tokens%ROWTYPE;
  v_license public.licenses%ROWTYPE;
  v_store public.stores%ROWTYPE;
  v_tenant_status TEXT;
  v_device_count INTEGER;
BEGIN
  SELECT * INTO v_activation FROM public.device_activation_tokens
  WHERE token_hash = p_activation_token_hash
  FOR UPDATE;

  IF v_activation.id IS NULL THEN
    RAISE EXCEPTION 'activation_token_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_activation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'activation_token_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_activation.expires_at <= now() THEN
    RAISE EXCEPTION 'activation_token_expired' USING ERRCODE = '28000';
  END IF;
  IF v_activation.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'activation_token_already_used' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_license FROM public.licenses
  WHERE id = v_activation.license_id AND tenant_id = v_activation.tenant_id
  FOR UPDATE;

  IF v_license.id IS NULL THEN
    RAISE EXCEPTION 'license_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'suspended' THEN
    RAISE EXCEPTION 'license_suspended' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'revoked' THEN
    RAISE EXCEPTION 'license_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_license.expires_at IS NOT NULL AND v_license.expires_at <= now() THEN
    RAISE EXCEPTION 'license_expired' USING ERRCODE = '28000';
  END IF;

  SELECT status INTO v_tenant_status FROM public.tenants WHERE id = v_activation.tenant_id;
  IF v_tenant_status IS NULL OR v_tenant_status <> 'active' THEN
    RAISE EXCEPTION 'tenant_not_active' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_store FROM public.stores
  WHERE id = v_activation.store_id
    AND tenant_id = v_activation.tenant_id
    AND license_id = v_activation.license_id
  FOR SHARE;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'store_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_store.status <> 'active' THEN
    RAISE EXCEPTION 'store_suspended' USING ERRCODE = '28000';
  END IF;

  IF v_license.max_devices IS NOT NULL THEN
    SELECT count(*) INTO v_device_count FROM public.pos_devices
    WHERE license_id = v_license.id AND revoked_at IS NULL;
    IF v_device_count >= v_license.max_devices THEN
      RAISE EXCEPTION 'max_devices_reached' USING ERRCODE = '28000';
    END IF;
  END IF;

  UPDATE public.device_activation_tokens
  SET used_at = now(), used_by_device_id = p_device_id
  WHERE id = v_activation.id;

  INSERT INTO public.pos_devices (
    id, tenant_id, license_id, store_id, machine_id, station_code,
    refresh_token_hash, refresh_token_expires_at, token_version
  ) VALUES (
    p_device_id, v_activation.tenant_id, v_activation.license_id, v_store.id, p_machine_id, p_station_code,
    p_refresh_token_hash, p_refresh_token_expires_at, 1
  );

  out_tenant_id := v_activation.tenant_id;
  out_license_id := v_activation.license_id;
  out_device_id := p_device_id;
  out_token_version := 1;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_pos_device(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
