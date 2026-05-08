-- rollback PR-1 users local-first sync baseline

DROP POLICY IF EXISTS users_tenant_modify ON public.users;
DROP POLICY IF EXISTS users_tenant_select ON public.users;

DROP INDEX IF EXISTS public.idx_users_tenant_active;
DROP INDEX IF EXISTS public.idx_users_tenant_sync_version;
DROP INDEX IF EXISTS public.idx_users_tenant_deleted_at;
DROP INDEX IF EXISTS public.idx_users_tenant_updated_at;

-- Keep table and columns to avoid data loss during rollback.
-- Legacy sync code keeps working with extra columns present.
