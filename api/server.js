import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

import db, { runPermissionRulesSeedIfEmpty } from './database.js';
import { uuidv4, isUuidString } from './cloudIdUtils.js';
import { enqueueSync } from './syncQueue.js';
import { startSyncService } from './syncService.js';
import syncController from './syncController.js';
import stockController from './stockController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});

const app = express();
app.use(cors());
/** Logos em base64 no PUT /company-profile excedem o default (~100kb). */
app.use(express.json({ limit: process.env.API_JSON_BODY_LIMIT || '12mb' }));
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
      p.cloud_id,
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

  const productCloudId =
    payload.cloud_id && isUuidString(String(payload.cloud_id)) ? String(payload.cloud_id).trim() : uuidv4();

  db.run(
    `INSERT INTO products
      (cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productCloudId,
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
        cloud_id: productCloudId,
      };

      try {
        await enqueueSync('product', syncPayload);
        res.json({ success: true, id: insertedId, cloud_id: productCloudId });
      } catch (queueErr) {
        res.json({
          success: true,
          id: insertedId,
          cloud_id: productCloudId,
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

  const localId = Number(req.params.id);

  db.get(`SELECT cloud_id FROM products WHERE id = ?`, [localId], (selErr, existing) => {
    if (selErr) return res.status(500).json({ error: selErr.message });

    let nextCloudId = existing?.cloud_id && isUuidString(String(existing.cloud_id)) ? String(existing.cloud_id).trim() : null;
    if (!nextCloudId) {
      nextCloudId = uuidv4();
    }

    db.run(
      `UPDATE products SET
        cloud_id = ?,
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
        nextCloudId,
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
        localId,
      ],
      async function (err) {
        if (err) return res.status(500).json({ error: err.message });
        const updated = this.changes > 0;
        if (!updated) {
          return res.json({ success: true, updated: false });
        }

        const syncPayload = {
          ...payload,
          id: localId,
          cloud_id: nextCloudId,
        };

        try {
          await enqueueSync('product', syncPayload);
          res.json({ success: true, updated: true, cloud_id: nextCloudId });
        } catch (queueErr) {
          res.json({
            success: true,
            updated: true,
            cloud_id: nextCloudId,
            syncQueued: false,
            syncError: queueErr.message,
          });
        }
      }
    );
  });
});

app.delete('/produtos/:id', (req, res) => {
  const localId = Number(req.params.id);
  db.get(`SELECT cloud_id FROM products WHERE id = ?`, [localId], (selErr, row) => {
    if (selErr) return res.status(500).json({ error: selErr.message });
    const cloudId = row?.cloud_id && isUuidString(String(row.cloud_id)) ? String(row.cloud_id).trim() : null;

    db.run(`DELETE FROM products WHERE id = ?`, [localId], async function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const deleted = this.changes > 0;
      if (!deleted) {
        return res.json({ success: true, deleted: false });
      }

      try {
        await enqueueSync('product', { id: localId, cloud_id: cloudId, deleted: true });
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
});

app.get('/produtos/:id/historico', (req, res) => {
  const productId = String(req.params.id ?? '').trim();
  if (!productId) {
    return res.status(400).json({ error: 'id invalido' });
  }

  const fromDateRaw = String(req.query?.from ?? '').trim();
  const toDateRaw = String(req.query?.to ?? '').trim();
  const fromDate = fromDateRaw ? `${fromDateRaw}T00:00:00.000Z` : null;
  const toDate = toDateRaw ? `${toDateRaw}T23:59:59.999Z` : null;

  const sql = `
    SELECT
      oi.id AS movement_id,
      oi.product_id,
      oi.product_name,
      oi.quantity,
      oi.price,
      oi.discount_amount,
      oi.created_at AS item_created_at,
      o.id AS document_id,
      o.document_number,
      o.doc_type,
      o.doc_prefix,
      o.created_at AS document_date,
      o.customer_id,
      COALESCE(c.name, 'Unknown') AS customer_name
    FROM order_items oi
    LEFT JOIN orders o ON CAST(o.id AS TEXT) = CAST(oi.order_id AS TEXT)
    LEFT JOIN clientes c ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
    WHERE CAST(oi.product_id AS TEXT) = CAST(? AS TEXT)
      AND (? IS NULL OR datetime(COALESCE(o.created_at, oi.created_at)) >= datetime(?))
      AND (? IS NULL OR datetime(COALESCE(o.created_at, oi.created_at)) <= datetime(?))
    ORDER BY datetime(COALESCE(o.created_at, oi.created_at)) DESC, oi.id DESC
  `;

  db.all(sql, [productId, fromDate, fromDate, toDate, toDate], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const normalized = (rows ?? []).map((row) => {
      const docType = String(row?.doc_type ?? '').trim();
      const docPrefix = String(row?.doc_prefix ?? '').trim().toUpperCase();
      const docTypeNormalized = docType.toLowerCase();

      let movementType = 'venda';
      if (
        docPrefix === 'WH/IN' ||
        docTypeNormalized === 'entrada de stock' ||
        docTypeNormalized === 'entrada de armazem' ||
        docTypeNormalized === 'entrada de armazém'
      ) {
        movementType = 'entrada';
      } else if (
        docPrefix === 'WH/LOSS' ||
        docTypeNormalized === 'perdas' ||
        docTypeNormalized.includes('quebra')
      ) {
        movementType = 'quebra';
      } else if (
        docTypeNormalized.includes('devol')
      ) {
        movementType = 'devolucao';
      } else if (
        docPrefix === 'WH/ADJ' ||
        docTypeNormalized.includes('regularização') ||
        docTypeNormalized.includes('regularizacao') ||
        docTypeNormalized.includes('ajuste')
      ) {
        movementType = 'ajuste';
      }

      const rawQty = Number(row?.quantity ?? 0);
      const quantity = Number.isFinite(rawQty) ? rawQty : 0;
      const signedQuantity =
        movementType === 'entrada' || movementType === 'devolucao'
          ? Math.abs(quantity)
          : movementType === 'ajuste'
            ? quantity
            : -Math.abs(quantity);

      // Para entradas de stock, a hora correta costuma estar no item_created_at.
      // Em bases antigas, created_at do documento pode estar em 00:00:00.
      const movementDate =
        movementType === 'entrada'
          ? String(row?.item_created_at ?? row?.document_date ?? '')
          : String(row?.document_date ?? row?.item_created_at ?? '');

      return {
        id: String(row?.movement_id ?? ''),
        product_id: row?.product_id != null ? String(row.product_id) : null,
        product_name: String(row?.product_name ?? ''),
        movement_type: movementType,
        document_type: docType || null,
        document_number: row?.document_number ? String(row.document_number) : null,
        document_id: row?.document_id ? String(row.document_id) : null,
        customer_name: String(row?.customer_name ?? 'Unknown'),
        quantity: signedQuantity,
        quantity_abs: Math.abs(quantity),
        unit_price: Number(row?.price ?? 0) || 0,
        discount_amount: Number(row?.discount_amount ?? 0) || 0,
        date: movementDate,
      };
    });

    res.json(normalized);
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
    `SELECT id, cloud_id, name, phone, email, address FROM clientes ORDER BY name ASC`,
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

  const customerCloudId = req.body?.cloud_id && isUuidString(String(req.body.cloud_id))
    ? String(req.body.cloud_id).trim()
    : uuidv4();

  db.run(
    `INSERT INTO clientes (name, phone, email, address, cloud_id) VALUES (?, ?, ?, ?, ?)`,
    [name, phone, email ?? null, address ?? null, customerCloudId],
    async function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const insertedId = this.lastID;
      const queuePayload = {
        id: insertedId,
        cloud_id: customerCloudId,
        name,
        phone,
        email: email ?? null,
        address: address ?? null,
      };
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

  db.get(`SELECT cloud_id FROM clientes WHERE id = ?`, [id], (selErr, existing) => {
    if (selErr) {
      return res.status(500).json({ error: selErr.message });
    }
    const customerCloudId =
      existing?.cloud_id && isUuidString(String(existing.cloud_id)) ? String(existing.cloud_id).trim() : uuidv4();

    db.run(
      `UPDATE clientes SET name = ?, phone = ?, email = ?, address = ?, cloud_id = ? WHERE id = ?`,
      [name, phone, email ?? null, address ?? null, customerCloudId, id],
      async function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const updated = this.changes > 0;
      if (!updated) {
        return res.json({ success: true, updated: false });
      }

      try {
        await enqueueSync('customer', {
          id: Number(id),
          cloud_id: customerCloudId,
          name,
          phone,
          email: email ?? null,
          address: address ?? null,
        });
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
});

app.delete('/clientes/:id', (req, res) => {
  db.get(`SELECT cloud_id FROM clientes WHERE id = ?`, [req.params.id], (selErr, row) => {
    if (selErr) return res.status(500).json({ error: selErr.message });
    const customerCloudId = row?.cloud_id && isUuidString(String(row.cloud_id)) ? String(row.cloud_id).trim() : null;

    db.run(`DELETE FROM clientes WHERE id = ?`, [req.params.id], async function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const deleted = this.changes > 0;
    if (!deleted) {
      return res.json({ success: true, deleted: false });
    }

    try {
        await enqueueSync('customer', { id: Number(req.params.id), cloud_id: customerCloudId, deleted: true });
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
});

// 🔹 USERS
app.get('/users', (req, res) => {
  db.all(
    `SELECT
      id,
      name,
      surname,
      email,
      role,
      pin AS password,
      access_level,
      active
     FROM users
     ORDER BY name ASC`,
    (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows ?? []);
    }
  );
});

app.post('/users', (req, res) => {
  const payload = req.body ?? {};
  const now = new Date().toISOString();

  const name = String(payload.name ?? '').trim();
  const surname = payload.surname == null ? null : String(payload.surname).trim();
  const email = payload.email == null ? null : String(payload.email).trim();
  const role = String(payload.role ?? 'cashier').trim();
  const pin = payload.pin ?? payload.password ?? payload.access_code ?? '';
  const accessLevel = payload.access_level ?? payload.accessLevel ?? 0;
  const active = payload.active === false ? 0 : 1;

  if (!name || !pin) {
    return res.status(400).json({ error: 'name e pin sao obrigatorios' });
  }

  const userId = payload.id && String(payload.id).trim() ? String(payload.id).trim() : uuidv4();

  db.run(
    `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, name, surname || null, email || null, role, String(pin), Number(accessLevel) || 0, active, now],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: userId });
    }
  );
});

app.put('/users/:id', (req, res) => {
  const payload = req.body ?? {};
  const userId = String(req.params.id ?? '').trim();
  if (!userId) return res.status(400).json({ error: 'id invalido' });

  const now = new Date().toISOString();

  const updates = [];
  const params = [];

  if (payload.name !== undefined) {
    updates.push('name = ?');
    params.push(String(payload.name ?? '').trim());
  }
  if (payload.surname !== undefined) {
    updates.push('surname = ?');
    params.push(payload.surname == null ? null : String(payload.surname).trim() || null);
  }
  if (payload.email !== undefined) {
    updates.push('email = ?');
    params.push(payload.email == null ? null : String(payload.email).trim() || null);
  }
  if (payload.role !== undefined) {
    updates.push('role = ?');
    params.push(String(payload.role ?? '').trim() || 'cashier');
  }
  if (payload.pin !== undefined || payload.password !== undefined) {
    const pin = payload.pin ?? payload.password;
    if (!pin) return res.status(400).json({ error: 'pin invalido' });
    updates.push('pin = ?');
    params.push(String(pin));
  }
  if (payload.access_level !== undefined || payload.accessLevel !== undefined) {
    const accessLevel = payload.access_level ?? payload.accessLevel;
    updates.push('access_level = ?');
    params.push(Number(accessLevel) || 0);
  }
  if (payload.active !== undefined) {
    updates.push('active = ?');
    params.push(payload.active === false ? 0 : 1);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'nenhuma atualizacao informada' });
  }

  params.push(now);
  params.push(userId);

  db.run(
    `UPDATE users SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`,
    params,
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, updated: this.changes > 0 });
    }
  );
});

app.delete('/users/:id', (req, res) => {
  const userId = String(req.params.id ?? '').trim();
  if (!userId) return res.status(400).json({ error: 'id invalido' });
  const now = new Date().toISOString();

  db.run(`UPDATE users SET active = 0, updated_at = ? WHERE id = ?`, [now, userId], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deactivated: this.changes > 0 });
  });
});

// 🔹 PERMISSION RULES (global required access levels)
app.get('/permission-rules', (_req, res) => {
  db.all(
    `SELECT key, required_level, updated_at FROM permission_rules ORDER BY key ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(
        (rows ?? []).map((r) => ({
          key: String(r.key),
          required_level: Number(r.required_level ?? 0),
        }))
      );
    }
  );
});

app.put('/permission-rules', (req, res) => {
  const payload = req.body ?? {};
  const rulesInput = payload.rules ?? payload;
  const rulesArray = Array.isArray(rulesInput) ? rulesInput : payload.rules;

  if (!Array.isArray(rulesArray)) {
    return res.status(400).json({ error: 'payload.rules precisa ser um array' });
  }

  const now = new Date().toISOString();
  const normalized = rulesArray
    .filter((r) => r && r.key != null)
    .map((r) => ({
      key: String(r.key),
      required_level: Number(r.required_level ?? r.requiredLevel ?? 0),
    }));

  db.serialize(() => {
    let responded = false;
    let completed = 0;
    const total = normalized.length;
    if (total === 0) {
      responded = true;
      res.status(400).json({ error: 'nenhuma regra fornecida' });
      return;
    }

    for (const rule of normalized) {
      const level = Math.max(0, Math.min(9, Number.isFinite(rule.required_level) ? rule.required_level : 0));
      db.run(
        `INSERT INTO permission_rules (key, required_level, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET required_level = excluded.required_level, updated_at = excluded.updated_at`,
        [rule.key, level, now],
        (err) => {
          if (responded) return;
          if (err) {
            responded = true;
            res.status(500).json({ error: err.message });
            return;
          }

          completed += 1;
          if (completed === total) {
            responded = true;
            res.json({ success: true, updated: completed });
          }
        }
      );
    }
  });
});

// Payment methods
app.get('/payment-methods', (_req, res) => {
  db.all(
    `SELECT
      id,
      name,
      code,
      shortcut,
      position,
      enabled,
      quick_payment,
      required_customer,
      allow_change,
      mark_as_paid,
      print_receipt,
      open_cash_drawer
     FROM payment_methods
     ORDER BY position ASC, name ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(
        (rows ?? []).map((row) => ({
          id: String(row.id),
          name: String(row.name ?? ''),
          code: String(row.code ?? '').toLowerCase(),
          shortcut: row.shortcut ?? null,
          position: Number(row.position ?? 1),
          enabled: Boolean(row.enabled),
          quickPayment: Boolean(row.quick_payment),
          requiredCustomer: Boolean(row.required_customer),
          allowChange: Boolean(row.allow_change),
          markAsPaid: Boolean(row.mark_as_paid),
          printReceipt: Boolean(row.print_receipt),
          openCashDrawer: Boolean(row.open_cash_drawer),
        }))
      );
    }
  );
});

app.post('/payment-methods', (req, res) => {
  const payload = req.body ?? {};
  const name = String(payload.name ?? '').trim();
  const code = String(payload.code ?? '').trim().toLowerCase();
  if (!name || !code) {
    return res.status(400).json({ error: 'name e code sao obrigatorios' });
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO payment_methods
      (name, code, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      code,
      String(payload.shortcut ?? '').trim() || null,
      Math.max(1, Number(payload.position ?? 1) || 1),
      payload.enabled === false ? 0 : 1,
      payload.quickPayment === false ? 0 : 1,
      payload.requiredCustomer ? 1 : 0,
      payload.allowChange ? 1 : 0,
      payload.markAsPaid === false ? 0 : 1,
      payload.printReceipt === false ? 0 : 1,
      payload.openCashDrawer ? 1 : 0,
      now,
      now,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.put('/payment-methods/:id', (req, res) => {
  const payload = req.body ?? {};
  const id = Number(req.params.id);
  const name = String(payload.name ?? '').trim();
  const code = String(payload.code ?? '').trim().toLowerCase();
  if (!Number.isFinite(id) || !name || !code) {
    return res.status(400).json({ error: 'id, name e code sao obrigatorios' });
  }
  db.run(
    `UPDATE payment_methods SET
      name = ?,
      code = ?,
      shortcut = ?,
      position = ?,
      enabled = ?,
      quick_payment = ?,
      required_customer = ?,
      allow_change = ?,
      mark_as_paid = ?,
      print_receipt = ?,
      open_cash_drawer = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      name,
      code,
      String(payload.shortcut ?? '').trim() || null,
      Math.max(1, Number(payload.position ?? 1) || 1),
      payload.enabled === false ? 0 : 1,
      payload.quickPayment === false ? 0 : 1,
      payload.requiredCustomer ? 1 : 0,
      payload.allowChange ? 1 : 0,
      payload.markAsPaid === false ? 0 : 1,
      payload.printReceipt === false ? 0 : 1,
      payload.openCashDrawer ? 1 : 0,
      new Date().toISOString(),
      id,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, updated: this.changes > 0 });
    }
  );
});

app.delete('/payment-methods/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalido' });
  db.run(`DELETE FROM payment_methods WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deleted: this.changes > 0 });
  });
});

app.post('/payment-methods/reset-defaults', (_req, res) => {
  const now = new Date().toISOString();
  db.serialize(() => {
    db.run(`DELETE FROM payment_methods`, (deleteErr) => {
      if (deleteErr) return res.status(500).json({ error: deleteErr.message });

      const defaults = [
        ['DINHEIRO', 'cash', '', 1, 1, 1, 0, 1, 1, 1, 1, now, now],
        ['CARTAO', 'card', '', 2, 1, 1, 0, 0, 1, 1, 0, now, now],
        ['PIX', 'pix', '', 3, 1, 1, 0, 0, 1, 1, 0, now, now],
      ];

      let completed = 0;
      for (const row of defaults) {
        db.run(
          `INSERT INTO payment_methods
            (name, code, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row,
          (insertErr) => {
            if (insertErr) return res.status(500).json({ error: insertErr.message });
            completed += 1;
            if (completed === defaults.length) {
              res.json({ success: true, count: defaults.length });
            }
          }
        );
      }
    });
  });
});

const parseVoidReasons = (raw) => {
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

app.get('/company-profile', (_req, res) => {
  db.get(`SELECT * FROM company_profile WHERE id = 1`, [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) {
      return res.json({
        name: '',
        taxId: '',
        street: '',
        buildingNumber: '',
        additionalStreet: '',
        plotIdentification: '',
        district: '',
        city: '',
        state: '',
        country: '',
        phone: '',
        email: '',
        bankAccountNumber: '',
        bankDetails: '',
        logoDataUrl: null,
        voidReasons: [],
        updatedAt: null,
      });
    }
    res.json({
      name: row.name ?? '',
      taxId: row.tax_id ?? '',
      street: row.street ?? '',
      buildingNumber: row.building_number ?? '',
      additionalStreet: row.additional_street ?? '',
      plotIdentification: row.plot_identification ?? '',
      district: row.district ?? '',
      city: row.city ?? '',
      state: row.state ?? '',
      country: row.country ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      bankAccountNumber: row.bank_account_number ?? '',
      bankDetails: row.bank_details ?? '',
      logoDataUrl: row.logo_data_url ?? null,
      voidReasons: parseVoidReasons(row.void_reasons),
      updatedAt: row.updated_at ?? null,
    });
  });
});

app.put('/company-profile', (req, res) => {
  const payload = req.body ?? {};
  const now = new Date().toISOString();

  const name = payload.name != null ? String(payload.name).trim() : '';
  const country = payload.country != null ? String(payload.country).trim() : '';
  if (!name || !country) {
    return res.status(400).json({ error: 'name e country sao obrigatorios' });
  }

  db.get(`SELECT void_reasons, logo_data_url FROM company_profile WHERE id = 1`, [], (selErr, existing) => {
    if (selErr) return res.status(500).json({ error: selErr.message });

    const voidReasonsJson =
      payload.voidReasons !== undefined
        ? JSON.stringify(
            (Array.isArray(payload.voidReasons) ? payload.voidReasons : [])
              .map((x) => String(x ?? '').trim())
              .filter(Boolean)
          )
        : existing?.void_reasons != null
          ? String(existing.void_reasons)
          : '[]';

    const logoRaw = payload.logoDataUrl ?? payload.logo_data_url;
    let logoDataUrl;
    if (logoRaw === undefined) {
      logoDataUrl = existing?.logo_data_url ?? null;
    } else if (logoRaw === null || logoRaw === '') {
      logoDataUrl = null;
    } else if (typeof logoRaw === 'string' && logoRaw.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'logo muito grande (máx. ~10MB em base64)' });
    } else {
      logoDataUrl = String(logoRaw);
    }

    db.run(
      `INSERT INTO company_profile (
        id, name, tax_id, street, building_number, additional_street, plot_identification,
        district, cep, city, state, country, phone, email,
        bank_account_number, bank_details, logo_data_url, void_reasons, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        tax_id = excluded.tax_id,
        street = excluded.street,
        building_number = excluded.building_number,
        additional_street = excluded.additional_street,
        plot_identification = excluded.plot_identification,
        district = excluded.district,
        cep = excluded.cep,
        city = excluded.city,
        state = excluded.state,
        country = excluded.country,
        phone = excluded.phone,
        email = excluded.email,
        bank_account_number = excluded.bank_account_number,
        bank_details = excluded.bank_details,
        logo_data_url = excluded.logo_data_url,
        void_reasons = excluded.void_reasons,
        updated_at = excluded.updated_at`,
      [
        name,
        payload.taxId != null ? String(payload.taxId).trim() || null : null,
        payload.street != null ? String(payload.street).trim() || null : null,
        payload.buildingNumber != null ? String(payload.buildingNumber).trim() || null : null,
        payload.additionalStreet != null ? String(payload.additionalStreet).trim() || null : null,
        payload.plotIdentification != null ? String(payload.plotIdentification).trim() || null : null,
        payload.district != null ? String(payload.district).trim() || null : null,
        payload.cep != null ? String(payload.cep).trim() || null : null,
        payload.city != null ? String(payload.city).trim() || null : null,
        payload.state != null ? String(payload.state).trim() || null : null,
        country,
        payload.phone != null ? String(payload.phone).trim() || null : null,
        payload.email != null ? String(payload.email).trim() || null : null,
        payload.bankAccountNumber != null ? String(payload.bankAccountNumber).trim() || null : null,
        payload.bankDetails != null ? String(payload.bankDetails).trim() || null : null,
        logoDataUrl,
        voidReasonsJson,
        now,
      ],
      function onCompanySave(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, updated: true });
      }
    );
  });
});

app.put('/company-profile/void-reasons', (req, res) => {
  const list = Array.isArray(req.body?.voidReasons) ? req.body.voidReasons : [];
  const json = JSON.stringify(list.map((x) => String(x ?? '').trim()).filter(Boolean));
  const now = new Date().toISOString();
  db.run(
    `UPDATE company_profile SET void_reasons = ?, updated_at = ? WHERE id = 1`,
    [json, now],
    function onVoidSave(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, updated: this.changes > 0 });
    }
  );
});

// 🔹 STOCK (placeholder)
app.post('/stock', (req, res) => {
  const { productId, quantity } = req.body ?? {};
  if (!productId || !Number.isFinite(Number(quantity))) {
    return res.status(400).json({ error: 'productId e quantity sao obrigatorios' });
  }

  db.run(
    `UPDATE products
     SET stock_quantity = stock_quantity + ?, updated_at = ?
     WHERE id = ?
       AND stock_quantity + ? >= 0`,
    [Number(quantity), new Date().toISOString(), Number(productId), Number(quantity)],
    async function (err) {
      if (err) return res.status(500).json({ error: err.message });
      const updated = this.changes > 0;
      if (!updated) {
        return res.status(409).json({ success: false, updated: false, error: 'Estoque insuficiente para ajuste' });
      }

      res.json({
        success: true,
        updated: true,
        syncQueued: false,
        syncSkippedReason: 'stock_sync_removed_use_sale_rpc',
      });
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

const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

app.post('/maintenance/reset-database', async (req, res) => {
  const payload = req.body ?? {};
  const backupDirRaw = String(payload.backupDir ?? '').trim();
  const adminPassword = String(payload.adminPassword ?? '').trim();
  const resetProducts = Boolean(payload.resetProducts);
  const resetCustomers = Boolean(payload.resetCustomers);
  const resetDocuments = Boolean(payload.resetDocuments);

  if (!backupDirRaw) return res.status(400).json({ error: 'backupDir obrigatorio' });
  if (!path.isAbsolute(backupDirRaw)) return res.status(400).json({ error: 'backupDir deve ser absoluto' });
  if (!adminPassword) return res.status(400).json({ error: 'senha do administrador obrigatoria' });
  if (!resetProducts && !resetCustomers && !resetDocuments) {
    return res.status(400).json({ error: 'selecione pelo menos uma entidade para redefinir' });
  }

  try {
    const adminUser = await getDb(
      `SELECT id FROM users WHERE active = 1 AND role = 'admin' AND pin = ? LIMIT 1`,
      [adminPassword]
    );
    if (!adminUser) return res.status(403).json({ error: 'senha do administrador invalida' });

    await fs.mkdir(backupDirRaw, { recursive: true });

    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupFilePath = path.join(backupDirRaw, `pos-backup-${stamp}.db`);
    const escapedBackupPath = backupFilePath.replace(/'/g, "''");

    await runDb(`VACUUM INTO '${escapedBackupPath}'`);

    const stats = {
      products: 0,
      customers: 0,
      documents: 0,
    };

    await runDb('BEGIN IMMEDIATE TRANSACTION');
    try {
      if (resetDocuments) {
        const deletedOrderItems = await runDb(`DELETE FROM order_items`);
        const deletedOrders = await runDb(`DELETE FROM orders`);
        const deletedSales = await runDb(`DELETE FROM vendas`);
        stats.documents =
          Number(deletedOrderItems?.changes ?? 0) +
          Number(deletedOrders?.changes ?? 0) +
          Number(deletedSales?.changes ?? 0);
      }

      if (resetProducts) {
        await runDb(`DELETE FROM stock_movements`);
        const deletedProducts = await runDb(`DELETE FROM products`);
        stats.products = Number(deletedProducts?.changes ?? 0);
      }

      if (resetCustomers) {
        const deletedCustomers = await runDb(`DELETE FROM clientes`);
        stats.customers = Number(deletedCustomers?.changes ?? 0);
      }

      await runDb('COMMIT');
    } catch (txErr) {
      await runDb('ROLLBACK');
      throw txErr;
    }

    return res.json({
      success: true,
      backupFile: backupFilePath,
      reset: {
        products: resetProducts,
        customers: resetCustomers,
        documents: resetDocuments,
      },
      deleted: stats,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'falha ao redefinir base de dados' });
  }
});

// 🔹 VENDAS
app.get('/vendas', (_req, res) => {
  db.all(
    `
      SELECT
        CAST(v.id AS TEXT) AS id,
        CASE
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'FP'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'TK' THEN 'TK'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT' THEN 'FT'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'VD' THEN 'VD'
          WHEN LOWER(COALESCE(v.payment_method, '')) LIKE '%conta corrente%' THEN 'FT'
          ELSE 'VD'
        END AS doc_type,
        (
          CASE
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'FP'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'TK' THEN 'TK'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT' THEN 'FT'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'VD' THEN 'VD'
            WHEN LOWER(COALESCE(v.payment_method, '')) LIKE '%conta corrente%' THEN 'FT'
            ELSE 'VD'
          END
          || '/' ||
          CAST(strftime('%Y', v.data) AS TEXT)
          || '/' ||
          printf('%04d', COALESCE(v.doc_sequence, v.id))
        ) AS document_number,
        v.payment_method AS payment_method,
        CASE
          WHEN LOWER(COALESCE(v.status, '')) IN ('approved', 'aprovado') THEN 'approved'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'pending'
          WHEN LOWER(COALESCE(v.payment_method, '')) LIKE '%conta corrente%' THEN 'pending'
          ELSE COALESCE(v.status, 'completed')
        END AS status,
        v.approved_document_type AS approved_document_type,
        v.approved_document_number AS approved_document_number,
        0 AS discount,
        v.total AS total,
        v.data AS created_at,
        v.customer_id AS customer_id,
        CAST(v.id AS TEXT) AS local_sale_id,
        v.user_name AS user_name,
        COALESCE(c.name, v.customer_name, 'Consumidor final') AS client_name
      FROM vendas v
      LEFT JOIN clientes c ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
      ORDER BY datetime(v.data) DESC, v.id DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows ?? []);
    }
  );
});

app.patch('/vendas/:id/payment-status', async (req, res) => {
  const saleId = Number(req.params?.id);
  if (!Number.isFinite(saleId)) {
    return res.status(400).json({ error: 'id invalido' });
  }
  const paid = Boolean(req.body?.paid);
  const paymentMethod = paid ? 'dinheiro' : 'conta corrente';
  try {
    const result = await runDb(
      `UPDATE vendas
       SET payment_method = ?,
           status = CASE
             WHEN LOWER(COALESCE(status, '')) = 'approved' THEN status
             ELSE ?
           END
       WHERE id = ?`,
      [paymentMethod, paid ? 'completed' : 'pending', saleId]
    );
    if (Number(result?.changes ?? 0) === 0) {
      const existing = await getDb(`SELECT id FROM vendas WHERE id = ? LIMIT 1`, [saleId]);
      if (!existing?.id) {
        return res.status(404).json({ error: 'venda nao encontrada' });
      }
    }
    return res.json({
      success: true,
      id: saleId,
      status: paid ? 'completed' : 'pending',
      payment_method: paymentMethod,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message ?? 'Falha ao atualizar status da venda' });
  }
});

app.post('/vendas', async (req, res) => {
  const {
    total,
    saleTimestamp,
    saleDate,
    data,
    cart,
    selectedCustomerId,
    selectedCustomerName,
    selectedUserId,
    selectedUserName,
    paymentMethod,
    payments,
    isMultiplePayment,
    docType,
    paymentStatus,
  } = req.body ?? {};
  const totalNumber = Number(total);
  const storedDate = saleTimestamp || saleDate || data || new Date().toISOString();
  const localCustomerId = selectedCustomerId == null ? null : String(selectedCustomerId).trim() || null;
  const localCustomerName = selectedCustomerName == null ? null : String(selectedCustomerName).trim() || null;
  const localUserId = selectedUserId == null ? null : String(selectedUserId).trim() || null;
  const localUserName = selectedUserName == null ? null : String(selectedUserName).trim() || null;
  const paymentFromList = Array.isArray(payments)
    ? payments
        .map((p) => String(p?.method ?? '').trim())
        .filter(Boolean)
    : [];
  const localPaymentMethod =
    Boolean(isMultiplePayment) && paymentFromList.length > 0
      ? paymentFromList.join(' + ')
      : String(paymentMethod ?? paymentFromList[0] ?? '').trim() || null;
  const normalizedDocType = String(docType ?? 'VD').trim().toUpperCase() || 'VD';
  const shouldDecreaseStock = normalizedDocType !== 'FP';
  const normalizedPaymentStatus = String(paymentStatus ?? '').trim().toLowerCase();
  const localStatus =
    normalizedDocType === 'FP'
      ? 'pending'
      : normalizedPaymentStatus === 'pending'
        ? 'pending'
        : 'completed';

  if (!Number.isFinite(totalNumber)) {
    return res.status(400).json({ error: 'total invalido' });
  }

  const stockAdjustments = shouldDecreaseStock && Array.isArray(cart)
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

  let usedSaleId;
  let usedSequence;

  try {
    await runDb('BEGIN IMMEDIATE TRANSACTION');

    const nextSequenceRow = await getDb(
      `SELECT COALESCE(MAX(COALESCE(doc_sequence, id)), 0) + 1 AS next
         FROM vendas
        WHERE UPPER(COALESCE(doc_type, 'VD')) = ?`,
      [normalizedDocType]
    );
    usedSequence = Number(nextSequenceRow?.next ?? 1);

    const insertResult = await runDb(
      `INSERT INTO vendas (
        total,
        data,
        doc_type,
        doc_sequence,
        status,
        customer_id,
        customer_name,
        payment_method,
        user_id,
        user_name,
        approved_document_type,
        approved_document_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        totalNumber,
        storedDate,
        normalizedDocType,
        usedSequence,
        localStatus,
        localCustomerId,
        localCustomerName,
        localPaymentMethod,
        localUserId,
        localUserName,
        null,
        null,
      ]
    );

    usedSaleId = insertResult.lastID;

    // Persiste os itens da venda no formato usado pelo módulo de Documentos local.
    if (Array.isArray(cart) && cart.length > 0) {
      for (const rawItem of cart) {
        const quantity = Number(rawItem?.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;

        const linePrice = Number(rawItem?.price ?? rawItem?.unit_price ?? 0);
        const discountAmount = Number(rawItem?.discount_amount ?? rawItem?.discountAmount ?? 0);
        const nowIso = new Date().toISOString();

        await runDb(
          `INSERT INTO order_items
            (id, order_id, product_id, product_name, quantity, price, discount_amount, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            String(usedSaleId),
            rawItem?.id != null ? String(rawItem.id) : null,
            String(rawItem?.name ?? rawItem?.product_name ?? 'Item'),
            quantity,
            Number.isFinite(linePrice) ? linePrice : 0,
            Number.isFinite(discountAmount) ? discountAmount : 0,
            nowIso,
            nowIso,
          ]
        );
      }
    }

    console.log(
      '[VENDA] stockAdjustments:',
      stockAdjustments.map((a) => ({ productId: a.productId, qty: a.quantity, isService: a.isService }))
    );

    for (const adjustment of stockAdjustments) {
      const before = await getDb(`SELECT stock_quantity FROM products WHERE id = ? LIMIT 1`, [
        adjustment.productId,
      ]);

      console.log('[STOCK BEFORE]', adjustment.productId, before?.stock_quantity ?? null);
      console.log('[STOCK SOLD]', adjustment.quantity);

      const updateResult = await runDb(
        `UPDATE products
         SET stock_quantity = stock_quantity - ?,
             updated_at = ?
         WHERE id = ?
           AND stock_quantity >= ?`,
        [adjustment.quantity, new Date().toISOString(), adjustment.productId, adjustment.quantity]
      );

      const after = await getDb(`SELECT stock_quantity FROM products WHERE id = ? LIMIT 1`, [
        adjustment.productId,
      ]);

      console.log('[STOCK AFTER]', after?.stock_quantity ?? null);

      if (Number(updateResult?.changes ?? 0) === 0) {
        throw new Error(`Estoque insuficiente para o produto ${adjustment.productId}`);
      }
    }
    await runDb('COMMIT');
  } catch (error) {
    try {
      await runDb('ROLLBACK');
    } catch {
      // If transaction is not active, rollback can fail safely.
    }
    const statusCode = String(error?.message || '').includes('Estoque insuficiente') ? 409 : 500;
    return res.status(statusCode).json({ error: error.message });
  }

  const year = new Date(storedDate).getFullYear();
  const usedDocumentNumber = `${normalizedDocType}/${year}/${String(usedSequence).padStart(4, '0')}`;
  const localSaleId = crypto.randomUUID();

  const salePayload = {
    ...req.body,
    id: usedSaleId,
    local_sale_id: localSaleId,
    usedSequence,
    usedDocType: normalizedDocType,
    usedDocumentNumber,
    total: totalNumber,
    saleTimestamp: storedDate,
    stockAdjustments,
  };

  try {
    console.log('[VENDA] salePayload local_sale_id=', localSaleId, 'document=', usedDocumentNumber);

    await enqueueSync('sale', salePayload);
    console.log('[VENDA] enqueueSync(sale) ok');

    res.json({
      success: true,
      id: usedSaleId,
      usedSequence,
      usedDocType: normalizedDocType,
      usedDocumentNumber,
      syncQueued: true
    });
  } catch (queueErr) {
    console.error('[DEBUG ENQUEUE ERROR]', queueErr);

    res.json({
      success: true,
      id: usedSaleId,
      usedSequence,
      usedDocType: normalizedDocType,
      usedDocumentNumber,
      syncQueued: false,
      syncError: queueErr.message,
    });
  }
});

// 🔹 DOCUMENTOS (LOCAL SQLITE)
app.get('/documentos', (_req, res) => {
  db.all(
    `
      SELECT
        *
      FROM (
        SELECT
          CAST(o.id AS TEXT) AS id,
          o.doc_type AS doc_type,
          o.document_number AS document_number,
          o.payment_method AS payment_method,
          o.status AS status,
          o.approved_document_type AS approved_document_type,
          o.approved_document_number AS approved_document_number,
          o.discount AS discount,
          o.subtotal AS subtotal,
          o.tax AS tax,
          o.total AS total,
          o.created_at AS created_at,
          o.customer_id AS customer_id,
          o.local_sale_id AS local_sale_id,
          o.user_name AS user_name,
          COALESCE(c.name, 'Consumidor final') AS client_name
        FROM orders o
        LEFT JOIN clientes c ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)

        UNION ALL

        SELECT
          ('venda:' || CAST(v.id AS TEXT)) AS id,
          CASE
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'FP'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'TK' THEN 'TK'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT' THEN 'FT'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'VD' THEN 'VD'
            WHEN LOWER(COALESCE(v.payment_method, '')) LIKE '%conta corrente%' THEN 'FT'
            ELSE 'VD'
          END AS doc_type,
          (
            CASE
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'FP'
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'TK' THEN 'TK'
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT' THEN 'FT'
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'VD' THEN 'VD'
              WHEN LOWER(COALESCE(v.payment_method, '')) LIKE '%conta corrente%' THEN 'FT'
              ELSE 'VD'
            END
            || '/' ||
            CAST(strftime('%Y', v.data) AS TEXT)
            || '/' ||
            printf('%04d', COALESCE(v.doc_sequence, v.id))
          ) AS document_number,
          v.payment_method AS payment_method,
          CASE
            WHEN LOWER(COALESCE(v.status, '')) IN ('approved', 'aprovado') THEN 'approved'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'pending'
            WHEN LOWER(COALESCE(v.payment_method, '')) LIKE '%conta corrente%' THEN 'pending'
            ELSE COALESCE(v.status, 'completed')
          END AS status,
          v.approved_document_type AS approved_document_type,
          v.approved_document_number AS approved_document_number,
          0 AS discount,
          v.total AS subtotal,
          0 AS tax,
          v.total AS total,
          v.data AS created_at,
          v.customer_id AS customer_id,
          CAST(v.id AS TEXT) AS local_sale_id,
          v.user_name AS user_name,
          COALESCE(c.name, v.customer_name, 'Consumidor final') AS client_name
        FROM vendas v
        LEFT JOIN clientes c ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
      ) docs
      ORDER BY datetime(created_at) DESC, id DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows ?? []);
    }
  );
});

app.post('/cotacoes/aprovar', async (req, res) => {
  const sourceIdRaw = String(req.body?.sourceId ?? '').trim();
  const sourceTypeRaw = String(req.body?.sourceType ?? '').trim().toLowerCase();
  const approvedDocType = String(req.body?.approvedDocType ?? '').trim().toUpperCase();
  const approvedDocumentNumber = String(req.body?.approvedDocumentNumber ?? '').trim();

  if (!sourceIdRaw) return res.status(400).json({ error: 'sourceId obrigatorio' });
  if (!approvedDocType) return res.status(400).json({ error: 'approvedDocType obrigatorio' });
  if (!approvedDocumentNumber) return res.status(400).json({ error: 'approvedDocumentNumber obrigatorio' });

  const sourceType =
    sourceTypeRaw === 'sale' || sourceIdRaw.startsWith('venda:')
      ? 'sale'
      : sourceTypeRaw === 'order'
        ? 'order'
        : 'order';
  const sourceId = sourceType === 'sale' ? sourceIdRaw.replace(/^venda:/, '') : sourceIdRaw.replace(/^venda:/, '');

  try {
    if (sourceType === 'sale') {
      const saleId = Number(sourceId);
      if (!Number.isFinite(saleId)) return res.status(400).json({ error: 'sourceId de venda invalido' });
      const result = await runDb(
        `UPDATE vendas
         SET status = ?,
             approved_document_type = ?,
             approved_document_number = ?
         WHERE id = ?`,
        ['approved', approvedDocType, approvedDocumentNumber, saleId]
      );
      if (Number(result?.changes ?? 0) === 0) return res.status(404).json({ error: 'cotacao de venda nao encontrada' });
      return res.json({
        success: true,
        sourceType: 'sale',
        sourceId: String(saleId),
        status: 'approved',
        approvedDocumentType: approvedDocType,
        approvedDocumentNumber,
      });
    }

    const result = await runDb(
      `UPDATE orders
       SET status = ?,
           approved_document_type = ?,
           approved_document_number = ?,
           updated_at = ?
       WHERE CAST(id AS TEXT) = ?`,
      ['approved', approvedDocType, approvedDocumentNumber, new Date().toISOString(), sourceId]
    );
    if (Number(result?.changes ?? 0) === 0) return res.status(404).json({ error: 'cotacao nao encontrada' });
    return res.json({
      success: true,
      sourceType: 'order',
      sourceId,
      status: 'approved',
      approvedDocumentType: approvedDocType,
      approvedDocumentNumber,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message ?? 'Falha ao aprovar cotacao' });
  }
});

app.patch('/documentos/:id/payment-status', async (req, res) => {
  const orderId = String(req.params?.id ?? '').trim();
  if (!orderId) {
    return res.status(400).json({ error: 'id invalido' });
  }
  const paid = Boolean(req.body?.paid);
  const nextStatus = paid ? 'completed' : 'pending';
  try {
    const result = await runDb(
      `UPDATE orders
       SET status = ?,
           updated_at = ?
       WHERE CAST(id AS TEXT) = ?`,
      [nextStatus, new Date().toISOString(), orderId]
    );
    if (Number(result?.changes ?? 0) === 0) {
      const existing = await getDb(`SELECT id FROM orders WHERE CAST(id AS TEXT) = ? LIMIT 1`, [orderId]);
      if (!existing?.id) {
        return res.status(404).json({ error: 'documento nao encontrado' });
      }
    }
    return res.json({ success: true, id: orderId, status: nextStatus });
  } catch (error) {
    return res.status(500).json({ error: error?.message ?? 'Falha ao atualizar status do documento' });
  }
});

app.get('/documentos-itens', (_req, res) => {
  db.all(
    `
    SELECT
      id,
      order_id,
      product_id,
      product_name,
      quantity,
      price,
      discount_amount
    FROM order_items
    ORDER BY datetime(created_at) DESC, id DESC
  `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows ?? []);
    }
  );
});

app.get('/documentos/next-number', (req, res) => {
  const prefix = String(req.query?.prefix ?? '').trim().toUpperCase();
  const yearRaw = Number(req.query?.year ?? new Date().getFullYear());
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
  if (!prefix) {
    return res.status(400).json({ error: 'prefix obrigatorio' });
  }

  db.get(
    `SELECT COALESCE(MAX(COALESCE(doc_sequence, 0)), 0) + 1 AS next
       FROM orders
      WHERE UPPER(COALESCE(doc_prefix, '')) = ?
        AND COALESCE(doc_year, 0) = ?`,
    [prefix, year],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const sequence = Number(row?.next ?? 1);
      const padSize = prefix === 'FP' ? 4 : 5;
      const documentNumber = `${prefix}/${year}/${String(sequence).padStart(padSize, '0')}`;
      return res.json({ prefix, year, sequence, documentNumber });
    }
  );
});

app.post('/documentos', async (req, res) => {
  const payload = req.body ?? {};
  const now = new Date().toISOString();
  const documentDate = payload.documentDate ? String(payload.documentDate) : now;
  const documentType = String(payload.documentType ?? 'Documento').trim() || 'Documento';
  const prefix = String(payload.prefix ?? '').trim().toUpperCase();
  const discount = Number(payload.discount ?? 0);
  const total = Number(payload.total ?? 0);
  const customerId = payload.customerId == null ? null : String(payload.customerId).trim() || null;
  const customerName = payload.customerName == null ? null : String(payload.customerName).trim() || null;
  const userId = payload.userId == null ? null : String(payload.userId).trim() || null;
  const userName = payload.userName == null ? null : String(payload.userName).trim() || null;
  const paymentMethod = payload.paymentMethod == null ? null : String(payload.paymentMethod).trim() || null;
  const paid = Boolean(payload.paid);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const status = paid ? 'completed' : 'pending';
  if (!prefix) return res.status(400).json({ error: 'prefix obrigatorio' });
  const normalizedDocType = String(documentType).trim().toLowerCase();
  const shouldIncreaseStock =
    prefix === 'WH/IN' ||
    normalizedDocType === 'entrada de stock' ||
    normalizedDocType === 'entrada de armazem' ||
    normalizedDocType === 'entrada de armazém';

  const dateObj = new Date(documentDate);
  const year = Number.isNaN(dateObj.getTime()) ? new Date().getFullYear() : dateObj.getFullYear();

  try {
    await runDb('BEGIN IMMEDIATE TRANSACTION');
    const touchedProductIds = new Set();

    const nextSequenceRow = await getDb(
      `SELECT COALESCE(MAX(COALESCE(doc_sequence, 0)), 0) + 1 AS next
         FROM orders
        WHERE UPPER(COALESCE(doc_prefix, '')) = ?
          AND COALESCE(doc_year, 0) = ?`,
      [prefix, year]
    );
    const usedSequence = Number(nextSequenceRow?.next ?? 1);
    const padSize = prefix === 'FP' ? 4 : 5;
    const documentNumber = `${prefix}/${year}/${String(usedSequence).padStart(padSize, '0')}`;
    const orderId = crypto.randomUUID();

    await runDb(
      `INSERT INTO orders
        (id, customer_id, user_id, user_name, total, subtotal, tax, discount, payment_method, status, doc_type, doc_prefix, doc_year, doc_sequence, document_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        customerId,
        userId,
        userName,
        total,
        total,
        0,
        discount,
        paymentMethod,
        status,
        documentType,
        prefix,
        year,
        usedSequence,
        documentNumber,
        documentDate,
        now,
      ]
    );

    for (const rawItem of items) {
      const quantity = Number(rawItem?.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const unitPrice = Number(rawItem?.unitPrice ?? rawItem?.price ?? 0);
      const discountAmount = Number(rawItem?.discountAmount ?? 0);
      const productId = rawItem?.productId != null ? String(rawItem.productId) : null;
      await runDb(
        `INSERT INTO order_items
          (id, order_id, product_id, product_name, quantity, price, discount_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          orderId,
          productId,
          String(rawItem?.name ?? 'Item'),
          quantity,
          Number.isFinite(unitPrice) ? unitPrice : 0,
          Number.isFinite(discountAmount) ? discountAmount : 0,
          now,
          now,
        ]
      );

      // Documentos de entrada incrementam o stock local imediatamente.
      if (shouldIncreaseStock && productId) {
        await runDb(
          `UPDATE products
           SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
               cost = ?,
               updated_at = ?
           WHERE CAST(id AS TEXT) = ?`,
          [quantity, Number.isFinite(unitPrice) ? unitPrice : 0, now, productId]
        );
        touchedProductIds.add(String(productId));
      }
    }

    await runDb('COMMIT');

    if (shouldIncreaseStock && touchedProductIds.size > 0) {
      for (const localProductId of touchedProductIds) {
        try {
          const productRow = await getDb(
            `SELECT
               id, cloud_id, code, name, category_id, barcode, cost, price, tax, final_price,
               active, unit, description, age_restriction, is_service, default_quantity,
               stock_quantity, min_stock, color, image
             FROM products
             WHERE CAST(id AS TEXT) = ?
             LIMIT 1`,
            [String(localProductId)]
          );
          if (!productRow?.id || !productRow?.cloud_id) continue;
          await enqueueSync('product', {
            ...productRow,
            id: Number(productRow.id),
            category_id: productRow.category_id != null ? Number(productRow.category_id) : null,
            cost: Number(productRow.cost ?? 0),
            price: Number(productRow.price ?? 0),
            tax: Number(productRow.tax ?? 0),
            final_price: Number(productRow.final_price ?? productRow.price ?? 0),
            stock_quantity: Number(productRow.stock_quantity ?? 0),
            min_stock: Number(productRow.min_stock ?? 0),
            active: Number(productRow.active ?? 1) !== 0,
            is_service: Number(productRow.is_service ?? 0) !== 0,
            default_quantity: Number(productRow.default_quantity ?? 1) !== 0,
            updated_at: now,
          });
        } catch (queueErr) {
          console.warn('[documentos] falha ao enfileirar sync de produto', {
            localProductId,
            error: queueErr?.message,
          });
        }
      }
    }

    return res.json({
      success: true,
      id: orderId,
      documentNumber,
      sequence: usedSequence,
      year,
      prefix,
      status,
      customerName: customerName ?? 'Consumidor final',
      userName: userName ?? '-',
    });
  } catch (error) {
    try {
      await runDb('ROLLBACK');
    } catch {}
    return res.status(500).json({ error: error?.message ?? 'Falha ao salvar documento' });
  }
});

const DASHBOARD_SUMMARY_CACHE_TTL_MS = Math.max(1000, Number(process.env.DASHBOARD_SUMMARY_CACHE_TTL_MS ?? 8000));
const dashboardSummaryCache = new Map();

app.get('/dashboard-summary', async (req, res) => {
  const yearFromQuery = Number(req.query?.year);
  const targetYear = Number.isFinite(yearFromQuery) ? yearFromQuery : new Date().getFullYear();
  const cacheKey = String(targetYear);
  const forceRefresh = String(req.query?.refresh ?? '').toLowerCase() === 'true';

  if (!forceRefresh) {
    const cached = dashboardSummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.payload);
    }
  }

  const allDb = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows ?? []);
      });
    });

  try {
    const orderRows = await allDb(
      `
      SELECT
        o.id,
        o.status,
        o.total,
        o.created_at,
        o.customer_id,
        COALESCE(c.name, 'Consumidor final') AS client_name
      FROM orders o
      LEFT JOIN clientes c ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
      ORDER BY datetime(o.created_at) DESC, o.id DESC
    `
    );

    const saleRows = await allDb(
      `
        SELECT
          CAST(v.id AS TEXT) AS id,
          CASE
            WHEN LOWER(COALESCE(v.payment_method, '')) LIKE '%conta corrente%' THEN 'pending'
            ELSE 'completed'
          END AS status,
          v.total AS total,
          v.data AS created_at,
          v.customer_id AS customer_id,
          COALESCE(c.name, v.customer_name, 'Consumidor final') AS client_name
        FROM vendas v
        LEFT JOIN clientes c ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
        ORDER BY datetime(v.data) DESC, v.id DESC
      `
    );

    // Painel deve considerar sempre orders + vendas locais.
    const documents = [...(orderRows ?? []), ...(saleRows ?? [])];

    const completedDocs = (documents ?? []).filter((doc) => String(doc?.status ?? '').toLowerCase() === 'completed');
    const currentYearDocs = completedDocs.filter((doc) => {
      const date = new Date(doc?.created_at ?? '');
      return !Number.isNaN(date.getTime()) && date.getFullYear() === targetYear;
    });

    const monthlySalesData = Array.from({ length: 12 }, (_, i) => ({
      name: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i],
      sales: 0,
    }));

    for (const doc of currentYearDocs) {
      const date = new Date(doc?.created_at ?? '');
      if (Number.isNaN(date.getTime())) continue;
      monthlySalesData[date.getMonth()].sales += Number(doc?.total ?? 0);
    }

    const totalSales = currentYearDocs.reduce((acc, doc) => acc + Number(doc?.total ?? 0), 0);

    let bestMonth = '---';
    let bestMonthValue = 0;
    for (const month of monthlySalesData) {
      if (month.sales > bestMonthValue) {
        bestMonth = month.name;
        bestMonthValue = month.sales;
      }
    }

    const validOrderIds = new Set(completedDocs.map((doc) => String(doc?.id ?? '')));
    const itemRows = await allDb(
      `
      SELECT
        order_id,
        product_name,
        quantity,
        price
      FROM order_items
      ORDER BY datetime(created_at) DESC, id DESC
    `
    );

    const productMap = {};
    for (const item of itemRows ?? []) {
      const orderId = String(item?.order_id ?? '');
      if (!orderId || !validOrderIds.has(orderId)) continue;
      const productName = String(item?.product_name ?? '').trim() || 'Sem nome';
      const qty = Number(item?.quantity ?? 0);
      const price = Number(item?.price ?? 0);
      if (!productMap[productName]) {
        productMap[productName] = { sales: 0, price };
      }
      productMap[productName].sales += qty;
    }

    const topProducts = Object.entries(productMap)
      .map(([name, data]) => ({ name, sales: data.sales, price: data.price }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    const customerRows = await allDb(`SELECT id, cloud_id, name FROM clientes ORDER BY name ASC`);
    const customerMapById = new Map();
    const customerMapByCloudId = new Map();
    for (const row of customerRows ?? []) {
      const id = row?.id != null ? String(row.id) : '';
      const cloudId = row?.cloud_id != null ? String(row.cloud_id) : '';
      const name = String(row?.name ?? '').trim();
      if (id && name) customerMapById.set(id, name);
      if (cloudId && name) customerMapByCloudId.set(cloudId, name);
    }

    const customerTotals = {};
    for (const doc of completedDocs) {
      const customerId = doc?.customer_id != null ? String(doc.customer_id) : '';
      const fallbackName = String(doc?.client_name ?? '').trim();
      const customerName =
        customerMapById.get(customerId) ||
        customerMapByCloudId.get(customerId) ||
        fallbackName ||
        'Consumidor final';
      customerTotals[customerName] = (customerTotals[customerName] || 0) + Number(doc?.total ?? 0);
    }

    const topCustomers = Object.entries(customerTotals)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const payload = {
      year: targetYear,
      totalSales,
      monthlySalesData,
      bestMonth,
      bestMonthValue,
      topProducts,
      topCustomers,
      topGroups: [],
    };

    dashboardSummaryCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + DASHBOARD_SUMMARY_CACHE_TTL_MS,
    });

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Falha ao montar dashboard-summary' });
  }
});

// 🔹 NEXT VD
app.get('/next-vd', (req, res) => {
  db.get(
    `SELECT COALESCE(MAX(COALESCE(doc_sequence, id)), 0) + 1 AS next
       FROM vendas
      WHERE UPPER(COALESCE(doc_type, 'VD')) = 'VD'`,
    (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ next: Number(row?.next ?? 1) });
    }
  );
});

// 🔥 START SERVER (SEMPRE NO FINAL)
const PORT = process.env.PORT || 3001;

function startApiServer() {
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
}

// Garante tabela em bases antigas ou se o CREATE inicial falhou (evita 500 em /permission-rules)
db.run(
  `
  CREATE TABLE IF NOT EXISTS permission_rules (
    key TEXT PRIMARY KEY,
    required_level INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`,
  (schemaErr) => {
    if (schemaErr) {
      console.error('[fatal] permission_rules:', schemaErr.message);
      process.exit(1);
    }
    runPermissionRulesSeedIfEmpty((seedErr) => {
      if (seedErr) {
        console.error('[fatal] permission_rules seed:', seedErr.message);
        process.exit(1);
      }
      startApiServer();
    });
  }
);