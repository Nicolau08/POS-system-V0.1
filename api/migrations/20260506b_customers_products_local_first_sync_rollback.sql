BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_products_tenant_deleted_flag;
DROP INDEX IF EXISTS idx_products_tenant_sync_version;
DROP INDEX IF EXISTS idx_products_tenant_deleted_at;
DROP INDEX IF EXISTS idx_products_tenant_updated_at;

DROP INDEX IF EXISTS idx_clientes_tenant_sync_version;
DROP INDEX IF EXISTS idx_clientes_tenant_deleted_at;
DROP INDEX IF EXISTS idx_clientes_tenant_updated_at;

-- Keep columns to avoid data loss during rollback.
-- Legacy sync code keeps working with extra columns present.

COMMIT;
