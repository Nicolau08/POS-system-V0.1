const path = require('path');
require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
});
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./database');
const { enqueueSync } = require('./syncQueue');
const { startSyncService } = require('./syncService');
const syncController = require('./syncController');
const stockController = require('./stockController');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/sync', syncController);
app.use('/stock', stockController);

console.log('ENV TEST:', {
  url: process.env.SUPABASE_URL,
  key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
});

// 🔹 TESTE
app.get('/', (req, res) => {
  res.send('API OK 🚀');
});

// 🔹 PRODUTOS (TESTE REAL)
app.get('/produtos', (req, res) => {
  db.all(
    `SELECT
      p.id,
      p.code,
      p.name,
      p.category_id,
      p.barcode,
      p.cost,
      p.price,
      p.tax,
      p.final_price,
      p.active,
      p.unit,
      p.description,
      p.age_restriction,
      p.is_service,
      p.default_quantity,
      p.stock_quantity,
      p.min_stock,
      p.color,
      p.image,
      p.created_at,
      p.updated_at,
      c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.name ASC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json(
        (rows ?? []).map((row) => ({
          ...row,
          id: String(row.id),
          category_id: row.category_id != null ? String(row.category_id) : null,
          active: Boolean(row.active),
          is_service: Boolean(row.is_service),
          default_quantity: Boolean(row.default_quantity),
          categories: row.category ? { name: row.category } : undefined,
        }))
      );
    }
  );
});

app.post('/produtos', (req, res) => {
  const payload = req.body ?? {};
  const now = new Date().toISOString();
  const finalPrice = payload.final_price ?? payload.price;
  if (!payload.name || !Number.isFinite(Number(payload.price))) {
    return res.status(400).json({ error: 'name e price sao obrigatorios' });
  }

  db.run(
    `INSERT INTO products
      (code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.code ?? null,
      payload.name,
      payload.category_id ? Number(payload.category_id) : null,
      payload.barcode ?? null,
      Number(payload.cost ?? 0),
      Number(payload.price),
      Number(payload.tax ?? 0),
      Number(finalPrice ?? payload.price),
      payload.active === false ? 0 : 1,
      payload.unit ?? 'un',
      payload.description ?? null,
      payload.age_restriction ? Number(payload.age_restriction) : null,
      payload.is_service ? 1 : 0,
      payload.default_quantity === false ? 0 : 1,
      Number(payload.stock_quantity ?? 0),
      Number(payload.min_stock ?? 0),
      payload.color ?? null,
      payload.image ?? null,
      now,
      now,
    ],
    async function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const insertedId = this.lastID;
      const syncPayload = {
        ...payload,
        id: insertedId,
      };

      try {
        await enqueueSync('product', syncPayload);
        res.json({ success: true, id: insertedId });
      } catch (queueErr) {
        res.json({
          success: true,
          id: insertedId,
          syncQueued: false,
          syncError: queueErr.message,
        });
      }
    }
  );
});

app.put('/produtos/:id', (req, res) => {
  const payload = req.body ?? {};
  if (!payload.name || !Number.isFinite(Number(payload.price))) {
    return res.status(400).json({ error: 'name e price sao obrigatorios' });
  }

  db.run(
    `UPDATE products SET
      code = ?,
      name = ?,
      category_id = ?,
      barcode = ?,
      cost = ?,
      price = ?,
      tax = ?,
      final_price = ?,
      active = ?,
      unit = ?,
      description = ?,
      age_restriction = ?,
      is_service = ?,
      default_quantity = ?,
      stock_quantity = ?,
      min_stock = ?,
      color = ?,
      image = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      payload.code ?? null,
      payload.name,
      payload.category_id ? Number(payload.category_id) : null,
      payload.barcode ?? null,
      Number(payload.cost ?? 0),
      Number(payload.price),
      Number(payload.tax ?? 0),
      Number(payload.final_price ?? payload.price),
      payload.active === false ? 0 : 1,
      payload.unit ?? 'un',
      payload.description ?? null,
      payload.age_restriction ? Number(payload.age_restriction) : null,
      payload.is_service ? 1 : 0,
      payload.default_quantity === false ? 0 : 1,
      Number(payload.stock_quantity ?? 0),
      Number(payload.min_stock ?? 0),
      payload.color ?? null,
      payload.image ?? null,
      new Date().toISOString(),
      Number(req.params.id),
    ],
    async function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const updated = this.changes > 0;
      if (!updated) {
        return res.json({ success: true, updated: false });
      }

      const syncPayload = {
        ...payload,
        id: Number(req.params.id),
      };

      try {
        await enqueueSync('product', syncPayload);
        res.json({ success: true, updated: true });
      } catch (queueErr) {
        res.json({
          success: true,
          updated: true,
          syncQueued: false,
          syncError: queueErr.message,
        });
      }
    }
  );
});

app.delete('/produtos/:id', (req, res) => {
  db.run(`DELETE FROM products WHERE id = ?`, [Number(req.params.id)], async function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const deleted = this.changes > 0;
    if (!deleted) {
      return res.json({ success: true, deleted: false });
    }

    try {
      await enqueueSync('product', { id: Number(req.params.id), deleted: true });
      res.json({ success: true, deleted: true });
    } catch (queueErr) {
      res.json({
        success: true,
        deleted: true,
        syncQueued: false,
        syncError: queueErr.message,
      });
    }
  });
});

app.get('/categorias', (req, res) => {
  db.all(`SELECT id, name, parent_id FROM categories ORDER BY name ASC`, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json((rows ?? []).map((row) => ({ ...row, id: String(row.id), parent_id: row.parent_id ? String(row.parent_id) : null })));
  });
});

// 🔹 CLIENTES
app.get('/clientes', (req, res) => {
  db.all(
    `SELECT id, name, phone, email, address FROM clientes ORDER BY name ASC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows ?? []);
    }
  );
});

app.post('/clientes', (req, res) => {
  const { name, phone, email, address } = req.body ?? {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'name e phone sao obrigatorios' });
  }

  db.run(
    `INSERT INTO clientes (name, phone, email, address) VALUES (?, ?, ?, ?)`,
    [name, phone, email ?? null, address ?? null],
    async function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const insertedId = this.lastID;
      const queuePayload = { id: insertedId, name, phone, email: email ?? null, address: address ?? null };
      try {
        await enqueueSync('customer', queuePayload);
        res.json({ success: true, id: insertedId });
      } catch (queueErr) {
        res.json({
          success: true,
          id: insertedId,
          syncQueued: false,
          syncError: queueErr.message,
        });
      }
    }
  );
});

app.put('/clientes/:id', (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address } = req.body ?? {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'name e phone sao obrigatorios' });
  }

  db.run(
    `UPDATE clientes SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?`,
    [name, phone, email ?? null, address ?? null, id],
    async function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const updated = this.changes > 0;
      if (!updated) {
        return res.json({ success: true, updated: false });
      }

      try {
        await enqueueSync('customer', { id: Number(id), name, phone, email: email ?? null, address: address ?? null });
        res.json({ success: true, updated: true });
      } catch (queueErr) {
        res.json({
          success: true,
          updated: true,
          syncQueued: false,
          syncError: queueErr.message,
        });
      }
    }
  );
});

app.delete('/clientes/:id', (req, res) => {
  db.run(`DELETE FROM clientes WHERE id = ?`, [req.params.id], async function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const deleted = this.changes > 0;
    if (!deleted) {
      return res.json({ success: true, deleted: false });
    }

    try {
      await enqueueSync('customer', { id: Number(req.params.id), deleted: true });
      res.json({ success: true, deleted: true });
    } catch (queueErr) {
      res.json({
        success: true,
        deleted: true,
        syncQueued: false,
        syncError: queueErr.message,
      });
    }
  });
});

// 🔹 USERS
app.get('/users', (req, res) => {
  db.all(`SELECT id, name, role, pin AS password FROM users ORDER BY name ASC`, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows ?? []);
  });
});

// 🔹 STOCK (placeholder)
app.post('/stock', (req, res) => {
  const { productId, quantity } = req.body ?? {};
  if (!productId || !Number.isFinite(Number(quantity))) {
    return res.status(400).json({ error: 'productId e quantity sao obrigatorios' });
  }

  db.run(
    `UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?`,
    [Number(quantity), new Date().toISOString(), Number(productId)],
    async function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const updated = this.changes > 0;
      if (!updated) {
        return res.json({ success: true, updated: false });
      }

      try {
        await enqueueSync('stock', { productId: Number(productId), quantity: Number(quantity) });
        res.json({ success: true, updated: true });
      } catch (queueErr) {
        res.json({
          success: true,
          updated: true,
          syncQueued: false,
          syncError: queueErr.message,
        });
      }
    }
  );
});

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

// 🔹 VENDAS
app.post('/vendas', async (req, res) => {
  const { total, saleTimestamp, saleDate, data, cart } = req.body ?? {};
  const totalNumber = Number(total);
  const storedDate = saleTimestamp || saleDate || data || new Date().toISOString();

  if (!Number.isFinite(totalNumber)) {
    return res.status(400).json({ error: 'total invalido' });
  }

  const stockAdjustments = Array.isArray(cart)
    ? cart
        .map((item) => ({
          productId: Number(item?.id),
          quantity: Number(item?.quantity ?? 0),
          isService: Boolean(item?.is_service),
        }))
        .filter(
          (item) =>
            Number.isFinite(item.productId) &&
            Number.isFinite(item.quantity) &&
            item.quantity > 0 &&
            !item.isService
        )
    : [];

  let usedSequence;

  try {
    const insertResult = await runDb(
      `INSERT INTO vendas (total, data) VALUES (?, ?)`,
      [totalNumber, storedDate]
    );

    usedSequence = insertResult.lastID;

    for (const adjustment of stockAdjustments) {
      await runDb(
        `UPDATE products
         SET stock_quantity = stock_quantity - ?,
             updated_at = ?
         WHERE id = ?`,
        [adjustment.quantity, new Date().toISOString(), adjustment.productId]
      );
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }

  const year = new Date(storedDate).getFullYear();
  const usedDocumentNumber = `${year}/${String(usedSequence).padStart(4, '0')}`;
  const localSaleId = crypto.randomUUID();
  const salePayload = {
    ...req.body,
    id: usedSequence,
    local_sale_id: localSaleId,
    usedSequence,
    usedDocumentNumber,
    total: totalNumber,
    saleTimestamp: storedDate,
    stockAdjustments,
  };

  try {
    console.log('[DEBUG VENDA] payload:', salePayload);

    await enqueueSync('sale', salePayload);

    console.log('[DEBUG VENDA] enqueueSync executado');

    res.json({
      success: true,
      id: usedSequence,
      usedSequence,
      usedDocumentNumber,
      syncQueued: true
    });
  } catch (queueErr) {
    console.error('[DEBUG ENQUEUE ERROR]', queueErr);

    res.json({
      success: true,
      id: usedSequence,
      usedSequence,
      usedDocumentNumber,
      syncQueued: false,
      syncError: queueErr.message,
    });
  }
});

// 🔹 NEXT VD
app.get('/next-vd', (req, res) => {
  db.get(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM vendas`, (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ next: Number(row?.next ?? 1) });
  });
});

// 🔥 START SERVER (SEMPRE NO FINAL)
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);

  const fullResetEnabled = process.env.ENABLE_FULL_RESET_SYNC === 'true';
  console.log(`[sync] full reset sync: ${fullResetEnabled ? 'ENABLED' : 'disabled'}`);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[sync] Supabase credentials not configured. Running offline-only mode.');
  } else {
    console.log('[sync] Supabase configured successfully');
    startSyncService();
  }
});