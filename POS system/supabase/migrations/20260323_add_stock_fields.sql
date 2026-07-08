-- Migration to add stock fields to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity DECIMAL(12, 2) DEFAULT 0.00;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock DECIMAL(12, 2) DEFAULT 0.00;
