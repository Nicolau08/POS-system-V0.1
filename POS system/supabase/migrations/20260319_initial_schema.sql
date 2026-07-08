-- Initial Schema for NINO POS

-- 1. Categories Table
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Products Table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  color TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Customers Table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  table_number TEXT,
  total DECIMAL(12, 2) NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  tax DECIMAL(12, 2) NOT NULL,
  discount DECIMAL(12, 2) DEFAULT 0.00,
  payment_method TEXT,
  received_amount DECIMAL(12, 2),
  change_amount DECIMAL(12, 2),
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  discount_amount DECIMAL(12, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Create Policies (Allowing all for now, but in production these should be restricted)
CREATE POLICY "Allow public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Allow public read products" ON products FOR SELECT USING (true);
CREATE POLICY "Allow public read customers" ON customers FOR SELECT USING (true);
CREATE POLICY "Allow public read orders" ON orders FOR SELECT USING (true);
CREATE POLICY "Allow public read order_items" ON order_items FOR SELECT USING (true);

CREATE POLICY "Allow all for authenticated users" ON categories FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON products FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON customers FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON orders FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON order_items FOR ALL USING (true);

-- Seed Initial Categories
INSERT INTO categories (name, icon) VALUES 
('Bebidas', 'GlassWater'),
('Comidas', 'Pizza'),
('Sobremesas', 'IceCream'),
('Café', 'Coffee')
ON CONFLICT (name) DO NOTHING;

-- Seed Initial Products (Example)
INSERT INTO products (name, price, category_id, color) 
SELECT 'Coca-Cola 330ml', 65.00, id, 'bg-red-500/20' FROM categories WHERE name = 'Bebidas'
UNION ALL
SELECT 'Água Mineral 500ml', 40.00, id, 'bg-blue-500/20' FROM categories WHERE name = 'Bebidas'
UNION ALL
SELECT 'Pizza Margherita', 450.00, id, 'bg-orange-500/20' FROM categories WHERE name = 'Comidas'
UNION ALL
SELECT 'Hambúrguer Clássico', 350.00, id, 'bg-amber-500/20' FROM categories WHERE name = 'Comidas'
UNION ALL
SELECT 'Café Expresso', 80.00, id, 'bg-stone-500/20' FROM categories WHERE name = 'Café'
ON CONFLICT DO NOTHING;
