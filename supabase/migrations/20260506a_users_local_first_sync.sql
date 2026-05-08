-- PR-1 users local-first sync baseline

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'cashier',
  password text,
  pin text,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sync_version bigint NOT NULL DEFAULT 1,
  origin_node_id text
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pin text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS active boolean;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sync_version bigint;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS origin_node_id text;

UPDATE public.users
SET active = COALESCE(active, true),
    updated_at = COALESCE(updated_at, now()),
    created_at = COALESCE(created_at, now()),
    sync_version = GREATEST(COALESCE(sync_version, 1), 1)
WHERE active IS NULL
   OR updated_at IS NULL
   OR created_at IS NULL
   OR sync_version IS NULL
   OR sync_version < 1;

ALTER TABLE public.users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN active SET DEFAULT true;
ALTER TABLE public.users ALTER COLUMN active SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.users ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.users ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN sync_version SET DEFAULT 1;
ALTER TABLE public.users ALTER COLUMN sync_version SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant_updated_at ON public.users(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_deleted_at ON public.users(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_sync_version ON public.users(tenant_id, sync_version);
CREATE INDEX IF NOT EXISTS idx_users_tenant_active ON public.users(tenant_id, active);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_select ON public.users;
DROP POLICY IF EXISTS users_tenant_modify ON public.users;

CREATE POLICY users_tenant_select
ON public.users
FOR SELECT
TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY users_tenant_modify
ON public.users
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());
