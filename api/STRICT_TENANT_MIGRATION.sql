-- Strict tenant isolation migration examples for SQLite.
-- Run inside a maintenance window after a full backup.

BEGIN IMMEDIATE TRANSACTION;

-- 1) Backfill tenant_id for legacy rows.
UPDATE products SET tenant_id = 'tenant-1'
WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = '';

UPDATE clientes SET tenant_id = 'tenant-1'
WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = '';

UPDATE users SET tenant_id = 'tenant-1'
WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = '';

UPDATE vendas SET tenant_id = 'tenant-1'
WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = '';

UPDATE orders SET tenant_id = 'tenant-1'
WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = '';

UPDATE order_items
SET tenant_id = COALESCE(
  (SELECT o.tenant_id FROM orders o WHERE CAST(o.id AS TEXT) = CAST(order_items.order_id AS TEXT)),
  'tenant-1'
)
WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = '';

-- 2) Ensure tenant indexes for hot paths.
CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clientes_tenant_id ON clientes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendas_tenant_id ON vendas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant_id ON payment_methods(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON categories(tenant_id);

-- 3) Add tenant guard triggers to reject NULL/empty tenant writes.
CREATE TRIGGER IF NOT EXISTS trg_products_tenant_insert
BEFORE INSERT ON products
FOR EACH ROW
WHEN NEW.tenant_id IS NULL OR TRIM(COALESCE(NEW.tenant_id, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'tenant_id_required_products');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_tenant_update
BEFORE UPDATE ON products
FOR EACH ROW
WHEN NEW.tenant_id IS NULL OR TRIM(COALESCE(NEW.tenant_id, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'tenant_id_required_products');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_tenant_insert
BEFORE INSERT ON orders
FOR EACH ROW
WHEN NEW.tenant_id IS NULL OR TRIM(COALESCE(NEW.tenant_id, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'tenant_id_required_orders');
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_tenant_update
BEFORE UPDATE ON orders
FOR EACH ROW
WHEN NEW.tenant_id IS NULL OR TRIM(COALESCE(NEW.tenant_id, '')) = ''
BEGIN
  SELECT RAISE(ABORT, 'tenant_id_required_orders');
END;

COMMIT;
