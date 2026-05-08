BEGIN TRANSACTION;

ALTER TABLE clientes ADD COLUMN deleted_at TEXT;
ALTER TABLE clientes ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clientes ADD COLUMN origin_node_id TEXT;

ALTER TABLE products ADD COLUMN deleted_at TEXT;
ALTER TABLE products ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN origin_node_id TEXT;

UPDATE clientes
SET sync_version = 1
WHERE sync_version IS NULL OR sync_version < 1;

UPDATE products
SET sync_version = 1
WHERE sync_version IS NULL OR sync_version < 1;

UPDATE products
SET deleted_at = updated_at
WHERE COALESCE(deleted, 0) = 1
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_tenant_updated_at ON clientes(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_clientes_tenant_deleted_at ON clientes(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_clientes_tenant_sync_version ON clientes(tenant_id, sync_version);

CREATE INDEX IF NOT EXISTS idx_products_tenant_updated_at ON products(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_products_tenant_deleted_at ON products(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_products_tenant_sync_version ON products(tenant_id, sync_version);
CREATE INDEX IF NOT EXISTS idx_products_tenant_deleted_flag ON products(tenant_id, deleted);

COMMIT;
