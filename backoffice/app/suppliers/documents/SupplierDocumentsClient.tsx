'use client';

import { useEffect, useState, useCallback } from 'react';
import StoreSelector from '../../StoreSelector';

const inputStyle = { background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' };

type Supplier = { id: string; name: string };
type Product = { id: string; name: string };
type DocSummary = { id: string; document_number: string; status: string; supplier_id: string; created_at: string };
type DocDetail = {
  document: { id: string; document_number: string; status: string; store_id: string; supplier_id: string };
  items: Array<{ id: string; productId: string; product_id: string; quantity: number; unit_cost: number; productName: string }>;
  payments: Array<{ id: string; amount: number; method: string | null; paid_at: string }>;
  total: number;
  paid: number;
  remaining: number;
};
type ItemRow = { productId: string; quantity: string; unitCost: string };

export default function SupplierDocumentsClient() {
  const [storeId, setStoreId] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ productId: '', quantity: '', unitCost: '' }]);
  const [creating, setCreating] = useState(false);

  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => {
    fetch('/api/suppliers')
      .then((r) => r.json())
      .then((d) => !d.error && setSuppliers(d.suppliers ?? []));
    fetch('/api/products')
      .then((r) => r.json())
      .then((d) => !d.error && setProducts(d.products ?? []));
  }, []);

  const loadDocs = useCallback(() => {
    if (!storeId) return;
    fetch(`/api/supplier-documents?storeId=${storeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setDocs(d.documents ?? []);
      })
      .catch(() => setError('Falha ao carregar documentos.'));
  }, [storeId]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const loadDetail = useCallback((id: string) => {
    fetch(`/api/supplier-documents/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setDetail(d);
      })
      .catch(() => setError('Falha ao carregar documento.'));
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const addRow = () => setRows([...rows, { productId: '', quantity: '', unitCost: '' }]);
  const updateRow = (idx: number, patch: Partial<ItemRow>) => setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));

  const createDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/supplier-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          supplierId,
          documentNumber,
          items: rows.filter((r) => r.productId).map((r) => ({ productId: r.productId, quantity: Number(r.quantity), unitCost: Number(r.unitCost) })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao criar documento.');
        return;
      }
      setSupplierId('');
      setDocumentNumber('');
      setRows([{ productId: '', quantity: '', unitCost: '' }]);
      loadDocs();
    } finally {
      setCreating(false);
    }
  };

  const confirmDoc = async () => {
    if (!selectedId) return;
    setConfirmBusy(true);
    try {
      const res = await fetch(`/api/supplier-documents/${selectedId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao confirmar.');
        return;
      }
      loadDetail(selectedId);
      loadDocs();
    } finally {
      setConfirmBusy(false);
    }
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !detail) return;
    setPayBusy(true);
    try {
      const res = await fetch(`/api/supplier-documents/${selectedId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId: detail.document.supplier_id, amount: Number(payAmount), method: payMethod || null, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao registar pagamento.');
        return;
      }
      setPayAmount('');
      setPayMethod('');
      loadDetail(selectedId);
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Loja</h2>
        <StoreSelector value={storeId} onChange={(id) => setStoreId(id)} />
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div style={{ display: 'flex', gap: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Documentos</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {(docs ?? []).map((d) => (
                <tr key={d.id} style={{ cursor: 'pointer', background: selectedId === d.id ? '#20242f' : undefined }} onClick={() => setSelectedId(d.id)}>
                  <td style={{ padding: '6px 4px' }}>{d.document_number}</td>
                  <td style={{ padding: '6px 4px' }}>{d.status}</td>
                </tr>
              ))}
              {docs !== null && docs.length === 0 ? (
                <tr>
                  <td className="muted" style={{ padding: '10px 4px' }}>
                    Nenhum documento.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Detalhe</h2>
          {!detail ? (
            <p className="muted">Selecciona um documento.</p>
          ) : (
            <div>
              <p>
                <strong>{detail.document.document_number}</strong> · {detail.document.status}
              </p>
              <ul style={{ paddingLeft: 16, fontSize: 13 }}>
                {detail.items.map((it) => (
                  <li key={it.id}>
                    {it.productName} — {it.quantity} × {Number(it.unit_cost).toFixed(2)}
                  </li>
                ))}
              </ul>
              <p className="muted">
                Total: {detail.total.toFixed(2)} · Pago: {detail.paid.toFixed(2)} · Saldo: {detail.remaining.toFixed(2)}
              </p>
              {detail.document.status === 'draft' ? (
                <button className="btn" onClick={confirmDoc} disabled={confirmBusy}>
                  {confirmBusy ? 'A confirmar…' : 'Confirmar documento'}
                </button>
              ) : null}
              {detail.document.status === 'confirmed' && detail.remaining > 0 ? (
                <form onSubmit={submitPayment} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <input placeholder="Valor" type="number" min="0.01" step="0.01" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={{ width: 100, ...inputStyle }} />
                  <input placeholder="Método" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ width: 100, ...inputStyle }} />
                  <button className="btn" type="submit" disabled={payBusy}>
                    {payBusy ? 'A pagar…' : 'Pagar'}
                  </button>
                </form>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={createDoc} className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Novo documento</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required style={{ flex: 1, ...inputStyle }}>
            <option value="">Fornecedor…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input placeholder="Número do documento" required value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} style={{ flex: 1, ...inputStyle }} />
        </div>
        {rows.map((row, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={row.productId} onChange={(e) => updateRow(idx, { productId: e.target.value })} style={{ flex: 2, ...inputStyle }}>
              <option value="">Produto…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input placeholder="Qtd" type="number" min="0.01" step="0.01" value={row.quantity} onChange={(e) => updateRow(idx, { quantity: e.target.value })} style={{ width: 90, ...inputStyle }} />
            <input placeholder="Custo" type="number" min="0" step="0.01" value={row.unitCost} onChange={(e) => updateRow(idx, { unitCost: e.target.value })} style={{ width: 90, ...inputStyle }} />
            {rows.length > 1 ? (
              <button type="button" className="btn" style={{ background: '#333' }} onClick={() => removeRow(idx)}>
                ×
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className="btn" style={{ background: '#333', marginRight: 8 }} onClick={addRow}>
          + item
        </button>
        <button className="btn" type="submit" disabled={creating || !storeId}>
          {creating ? 'A criar…' : 'Criar documento'}
        </button>
      </form>
    </div>
  );
}
