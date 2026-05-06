-- Ensure helper exists even if previous migrations/rollbacks removed it.
-- Required by tenant-safe guards + sales RPCs.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'tenant_id', '');
$$;

COMMIT;

