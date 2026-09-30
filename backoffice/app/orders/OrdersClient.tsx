'use client';

import { useEffect, useState, useCallback } from 'react';
import StoreSelector from '../StoreSelector';

const inputStyle = { background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' };

const STATUS_LABEL: Record<string, string> = { paid: 'Pago', partial: 'Parcialmente pago', pending: 'Pendente' };

type OrderSummary = { id: string; doc_type: string | null; document_number: string | null; status: string; total: number; customer_id: string | null; created_at: string };
type OrderDetail = {
  order: { id: string; doc_type: string | null; document_number: string | null; status: string; customer_id: string | null; total: number; created_at: string };
  items: Array<{ id: string; product_id: string | null; product_name: string; quantity: number; price: number }>;
  payments: Array<{ id: string; amount: number; method: string | null; paid_at: string }>;
  total: number;
  paid: number;
  remaining: number;
  paymentStatus: 'paid' | 'partial' | 'pending';
};

export default function OrdersClient() {
  const [storeId, setStoreId] = useState('');
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const loadOrders = useCallback(() => {
    if (!storeId) return;
    fetch(`/api/orders?storeId=${storeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setOrders(d.orders ?? []);
      })
      .catch(() => setError('Falha ao carregar documentos.'));
  }, [storeId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const loadDetail = useCallback((id: string) => {
    fetch(`/api/orders/${id}`)
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

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !detail || !detail.order.customer_id) return;
    setPayBusy(true);
    try {
      const res = await fetch(`/api/orders/${selectedId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: detail.order.customer_id, amount: Number(payAmount), method: payMethod || null, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao registar recebimento.');
        return;
      }
      setPayAmount('');
      setPayMethod('');
      loadDetail(selectedId);
      loadOrders();
    } finally {
      setPayBusy(false);
    }
  };

  const canPay = detail && detail.order.doc_type === 'FT' && detail.order.customer_id && detail.order.status !== 'cancelled' && detail.remaining > 0;

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
              {(orders ?? []).map((o) => (
                <tr key={o.id} style={{ cursor: 'pointer', background: selectedId === o.id ? '#20242f' : undefined }} onClick={() => setSelectedId(o.id)}>
                  <td style={{ padding: '6px 4px' }}>
                    {o.doc_type ?? '—'} {o.document_number ?? ''}
                  </td>
                  <td style={{ padding: '6px 4px' }}>{Number(o.total).toFixed(2)}</td>
                  <td style={{ padding: '6px 4px' }} className="muted">
                    {o.status}
                  </td>
                </tr>
              ))}
              {orders !== null && orders.length === 0 ? (
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
                <strong>
                  {detail.order.doc_type ?? '—'} {detail.order.document_number ?? ''}
                </strong>{' '}
                · {STATUS_LABEL[detail.paymentStatus]}
              </p>
              <ul style={{ paddingLeft: 16, fontSize: 13 }}>
                {detail.items.map((it) => (
                  <li key={it.id}>
                    {it.product_name} — {it.quantity} × {Number(it.price).toFixed(2)}
                  </li>
                ))}
              </ul>
              <p className="muted">
                Total: {detail.total.toFixed(2)} · Recebido: {detail.paid.toFixed(2)} · Saldo: {detail.remaining.toFixed(2)}
              </p>
              {detail.payments.length > 0 ? (
                <ul style={{ paddingLeft: 16, fontSize: 12 }} className="muted">
                  {detail.payments.map((p) => (
                    <li key={p.id}>
                      {new Date(p.paid_at).toLocaleString()} — {Number(p.amount).toFixed(2)} {p.method ? `(${p.method})` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canPay ? (
                <form onSubmit={submitPayment} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <input placeholder="Valor" type="number" min="0.01" step="0.01" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={{ width: 100, ...inputStyle }} />
                  <input placeholder="Método" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ width: 100, ...inputStyle }} />
                  <button className="btn" type="submit" disabled={payBusy}>
                    {payBusy ? 'A registar…' : 'Registar recebimento'}
                  </button>
                </form>
              ) : detail.order.doc_type !== 'FT' ? (
                <p className="muted">Só documentos FT com cliente aceitam recebimento.</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
