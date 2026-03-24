ALTER TABLE orders
ADD COLUMN IF NOT EXISTS doc_type TEXT DEFAULT 'VD';

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS document_number TEXT;

UPDATE orders
SET doc_type = 'VD'
WHERE doc_type IS NULL;

WITH numbered_orders AS (
  SELECT
    id,
    TO_CHAR(created_at, 'YYYY') || '/' ||
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE_PART('year', created_at)
        ORDER BY created_at, id
      )::TEXT,
      4,
      '0'
    ) AS generated_document_number
  FROM orders
  WHERE (doc_type = 'VD' OR doc_type IS NULL)
    AND document_number IS NULL
)
UPDATE orders AS target
SET document_number = numbered_orders.generated_document_number
FROM numbered_orders
WHERE target.id = numbered_orders.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_document_number_unique
ON orders(document_number)
WHERE document_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_doc_type_created_at
ON orders(doc_type, created_at DESC);
