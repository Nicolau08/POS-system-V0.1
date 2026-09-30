'use client';

import { useEffect, useState, useCallback } from 'react';
import StoreSelector from '../StoreSelector';

type Warehouse = { id: string; name: string; is_default: boolean };
type Product = { id: string; name: string };
type StockRow = { warehouse_id: string; product_id: string; quantity: number; productName: string; last_movement_at: string | null };
type Movement = {
  id: string;
  warehouse_id: string;
  product_id: string;
  type: string;
  quantity: number;
  reference_id: string;
  created_at: string;
  productName: string;
  origin: 'device' | 'backoffice';
};

const inputStyle = { background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' };

export default function StockClient() {
  const [storeId, setStoreId] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entryProductId, setEntryProductId] = useState('');
  const [entryQty, setEntryQty] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idemKey, setIdemKey] = useState<string | null>(null);

  const [adjProductId, setAdjProductId] = useState('');
  const [adjDelta, setAdjDelta] = useState('');
  const [adjSubmitting, setAdjSubmitting] = useState(false);
  const [adjIdemKey, setAdjIdemKey] = useState<string | null>(null);

  const [countProductId, setCountProductId] = useState('');
  const [countTarget, setCountTarget] = useState('');
  const [countSubmitting, setCountSubmitting] = useState(false);
  const [countIdemKey, setCountIdemKey] = useState<string | null>(null);
  const [countResult, setCountResult] = useState<string | null>(null);

  const [transferProductId, setTransferProductId] = useState('');
  const [transferToWarehouseId, setTransferToWarehouseId] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferIdemKey, setTransferIdemKey] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => !data.error && setProducts(data.products ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!storeId) return;
    fetch(`/api/warehouses?storeId=${storeId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        const list: Warehouse[] = data.warehouses ?? [];
        setWarehouses(list);
        setWarehouseId(list[0]?.id ?? '');
      })
      .catch(() => setError('Falha ao carregar armazéns.'));
  }, [storeId]);

  const load = useCallback(() => {
    if (!storeId) return;
    const whParam = warehouseId ? `&warehouseId=${warehouseId}` : '';
    fetch(`/api/stock?storeId=${storeId}${whParam}`)
      .then((res) => res.json())
      .then((data) => !data.error && setStock(data.stock ?? []))
      .catch(() => setError('Falha ao carregar saldo.'));
    fetch(`/api/stock/movements?storeId=${storeId}${whParam}`)
      .then((res) => res.json())
      .then((data) => !data.error && setMovements(data.movements ?? []))
      .catch(() => setError('Falha ao carregar movimentos.'));
  }, [storeId, warehouseId]);

  useEffect(() => {
    load();
  }, [load]);

  const submitEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId || !entryProductId) return;
    // Chave de idempotência gerada UMA vez por tentativa de submissão — um retry
    // automático (ou um duplo-clique) reutiliza a mesma, nunca gera uma nova.
    const key = idemKey ?? crypto.randomUUID();
    setIdemKey(key);
    setSubmitting(true);
    try {
      const res = await fetch('/api/stock/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, warehouseId, productId: entryProductId, quantity: Number(entryQty), idempotencyKey: key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao registar entrada.');
        return;
      }
      setEntryQty('');
      setIdemKey(null);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const submitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId || !adjProductId) return;
    const key = adjIdemKey ?? crypto.randomUUID();
    setAdjIdemKey(key);
    setAdjSubmitting(true);
    try {
      const res = await fetch('/api/stock/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, warehouseId, productId: adjProductId, delta: Number(adjDelta), idempotencyKey: key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao registar ajuste.');
        return;
      }
      setAdjDelta('');
      setAdjIdemKey(null);
      load();
    } finally {
      setAdjSubmitting(false);
    }
  };

  const submitCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId || !countProductId) return;
    const key = countIdemKey ?? crypto.randomUUID();
    setCountIdemKey(key);
    setCountSubmitting(true);
    try {
      const res = await fetch('/api/stock/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, warehouseId, productId: countProductId, targetQuantity: Number(countTarget), idempotencyKey: key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao registar contagem.');
        return;
      }
      setCountResult(
        data.status === 'no_change' ? 'O saldo já correspondia à contagem — nada foi alterado.' : `Ajuste de ${data.delta > 0 ? '+' : ''}${data.delta} aplicado.`
      );
      setCountTarget('');
      setCountIdemKey(null);
      load();
    } finally {
      setCountSubmitting(false);
    }
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId || !transferToWarehouseId || !transferProductId) return;
    const key = transferIdemKey ?? crypto.randomUUID();
    setTransferIdemKey(key);
    setTransferSubmitting(true);
    try {
      const res = await fetch('/api/stock/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, fromWarehouseId: warehouseId, toWarehouseId: transferToWarehouseId, productId: transferProductId, quantity: Number(transferQty), idempotencyKey: key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao registar transferência.');
        return;
      }
      setTransferQty('');
      setTransferIdemKey(null);
      load();
    } finally {
      setTransferSubmitting(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Loja</h2>
          <StoreSelector value={storeId} onChange={(id) => setStoreId(id)} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Armazém</h2>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} style={{ width: '100%', ...inputStyle }}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.is_default ? ' (principal)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Saldo actual</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '6px 8px' }}>Produto</th>
              <th style={{ padding: '6px 8px' }}>Quantidade</th>
            </tr>
          </thead>
          <tbody>
            {(stock ?? []).map((s) => (
              <tr key={`${s.warehouse_id}:${s.product_id}`} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>{s.productName}</td>
                <td style={{ padding: '6px 8px' }}>{s.quantity}</td>
              </tr>
            ))}
            {stock !== null && stock.length === 0 ? (
              <tr>
                <td colSpan={2} className="muted" style={{ padding: '10px 8px' }}>
                  Sem saldo neste armazém.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form onSubmit={submitEntry} className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Entrada de stock</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <select value={entryProductId} onChange={(e) => setEntryProductId(e.target.value)} required style={{ flex: 2, ...inputStyle }}>
            <option value="">Produto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Quantidade"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={entryQty}
            onChange={(e) => setEntryQty(e.target.value)}
            style={{ width: 140, ...inputStyle }}
          />
          <button className="btn" type="submit" disabled={submitting || !warehouseId}>
            {submitting ? 'A registar…' : 'Registar entrada'}
          </button>
        </div>
      </form>

      <form onSubmit={submitAdjustment} className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Ajuste manual (quebra, perda, correcção)</h2>
        <p className="muted" style={{ marginTop: 0 }}>Positivo para somar, negativo para subtrair.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <select value={adjProductId} onChange={(e) => setAdjProductId(e.target.value)} required style={{ flex: 2, ...inputStyle }}>
            <option value="">Produto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Ajuste (ex.: -5)"
            type="number"
            step="0.01"
            required
            value={adjDelta}
            onChange={(e) => setAdjDelta(e.target.value)}
            style={{ width: 140, ...inputStyle }}
          />
          <button className="btn" type="submit" disabled={adjSubmitting || !warehouseId}>
            {adjSubmitting ? 'A registar…' : 'Aplicar ajuste'}
          </button>
        </div>
      </form>

      <form onSubmit={submitCount} className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Contagem (definir o saldo real)</h2>
        <p className="muted" style={{ marginTop: 0 }}>Indica quanto foi realmente contado — o ajuste é calculado automaticamente.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <select value={countProductId} onChange={(e) => setCountProductId(e.target.value)} required style={{ flex: 2, ...inputStyle }}>
            <option value="">Produto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Contagem física"
            type="number"
            min="0"
            step="0.01"
            required
            value={countTarget}
            onChange={(e) => setCountTarget(e.target.value)}
            style={{ width: 140, ...inputStyle }}
          />
          <button className="btn" type="submit" disabled={countSubmitting || !warehouseId}>
            {countSubmitting ? 'A registar…' : 'Registar contagem'}
          </button>
        </div>
        {countResult ? <p className="muted" style={{ marginBottom: 0 }}>{countResult}</p> : null}
      </form>

      <form onSubmit={submitTransfer} className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Transferir entre armazéns (mesma Loja)</h2>
        <p className="muted" style={{ marginTop: 0 }}>De: {warehouses.find((w) => w.id === warehouseId)?.name ?? '—'}</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <select value={transferProductId} onChange={(e) => setTransferProductId(e.target.value)} required style={{ flex: 2, ...inputStyle }}>
            <option value="">Produto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={transferToWarehouseId} onChange={(e) => setTransferToWarehouseId(e.target.value)} required style={{ flex: 2, ...inputStyle }}>
            <option value="">Para…</option>
            {warehouses
              .filter((w) => w.id !== warehouseId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
          <input
            placeholder="Quantidade"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={transferQty}
            onChange={(e) => setTransferQty(e.target.value)}
            style={{ width: 140, ...inputStyle }}
          />
          <button className="btn" type="submit" disabled={transferSubmitting || !warehouseId || !transferToWarehouseId}>
            {transferSubmitting ? 'A transferir…' : 'Transferir'}
          </button>
        </div>
      </form>

      <div className="card">
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Histórico de movimentos</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '6px 8px' }}>Data</th>
              <th style={{ padding: '6px 8px' }}>Produto</th>
              <th style={{ padding: '6px 8px' }}>Tipo</th>
              <th style={{ padding: '6px 8px' }}>Qtd.</th>
              <th style={{ padding: '6px 8px' }}>Origem</th>
            </tr>
          </thead>
          <tbody>
            {(movements ?? []).map((m) => (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>{new Date(m.created_at).toLocaleString('pt-PT')}</td>
                <td style={{ padding: '6px 8px' }}>{m.productName}</td>
                <td style={{ padding: '6px 8px' }}>{m.type}</td>
                <td style={{ padding: '6px 8px' }}>{m.quantity}</td>
                <td style={{ padding: '6px 8px' }}>{m.origin === 'backoffice' ? 'Backoffice' : 'Loja'}</td>
              </tr>
            ))}
            {movements !== null && movements.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: '10px 8px' }}>
                  Nenhum movimento.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
