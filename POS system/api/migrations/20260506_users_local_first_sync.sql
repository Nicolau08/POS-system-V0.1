BEGIN TRANSACTION;

ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN origin_node_id TEXT;

UPDATE users
SET sync_version = 1
WHERE sync_version IS NULL OR sync_version < 1;

UPDATE users
SET deleted_at = updated_at
WHERE active = 0
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_tenant_updated_at ON users(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_deleted_at ON users(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_sync_version ON users(tenant_id, sync_version);

COMMIT;
