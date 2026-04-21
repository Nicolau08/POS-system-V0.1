ALTER TABLE products
ADD COLUMN IF NOT EXISTS deleted INTEGER DEFAULT 0;

UPDATE products
SET deleted = 0
WHERE deleted IS NULL;

ALTER TABLE products
ALTER COLUMN deleted SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_deleted ON products (deleted);
