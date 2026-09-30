'use client';

import { useEffect, useState, useCallback } from 'react';

const inputStyle = { background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' };
const cardStyle = { flex: '1 1 200px' };

type Store = { id: string; name: string };
type DashboardData = {
  period: { from: string; to: string };
  storeScope: string;
  truncated: { orders: boolean; stockMovements: boolean };
  totals: { totalSold: number; documentCount: number; avgTicket: number };
  byPaymentMethod: Array<{ method: string; total: number; count: number }>;
  byStore: Array<{ storeId: string; storeName: string; total: number; count: number }> | null;
  receivables: Array<{ customerId: string; customerName: string; remaining: number }>;
  payables: Array<{ supplierId: string; supplierName: string; remaining: number }>;
  stockSummary: Array<{ type: string; count: number; quantity: number }>;
  topProducts: Array<{ productId: string; productName: string; quantity: number; revenue: number }>;
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return isoDate(d);
}

export default function DashboardClient({ role }: { role: string }) {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeId, setStoreId] = useState<string>(role === 'owner' ? 'all' : '');
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(isoDate(new Date()));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stores')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        const list: Store[] = d.stores ?? [];
        setStores(list);
        if (role !== 'owner' && !storeId && list.length > 0) setStoreId(list[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const load = useCallback(() => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/reports/dashboard?storeId=${storeId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setData(null);
          return;
        }
        setData(d);
      })
      .catch(() => setError('Falha ao calcular o dashboard.'))
      .finally(() => setLoading(false));
  }, [storeId, from, to]);

  useEffect(() => {
    if (storeId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Store
          </label>
          {stores === null ? (
            <p className="muted">A carregar…</p>
          ) : (
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inputStyle, minWidth: 180 }}>
              {role === 'owner' ? <option value="all">Todas as Stores</option> : null}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            De
          </label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            Até
          </label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
        </div>
        <button className="btn" onClick={load} disabled={loading || !storeId}>
          {loading ? 'A calcular…' : 'Aplicar'}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          {data.truncated.orders || data.truncated.stockMovements ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Aviso: volume elevado no período — alguns totais reflectem apenas as primeiras linhas devolvidas (limite interno atingido).
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="card" style={cardStyle}>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Total vendido
              </p>
              <p style={{ fontSize: 22, margin: '4px 0 0' }}>{data.totals.totalSold.toFixed(2)}</p>
            </div>
            <div className="card" style={cardStyle}>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Nº documentos
              </p>
              <p style={{ fontSize: 22, margin: '4px 0 0' }}>{data.totals.documentCount}</p>
            </div>
            <div className="card" style={cardStyle}>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Ticket médio
              </p>
              <p style={{ fontSize: 22, margin: '4px 0 0' }}>{data.totals.avgTicket.toFixed(2)}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 300px' }}>
              <h2 style={{ fontSize: 14, marginTop: 0 }}>Vendas por forma de pagamento</h2>
              <Table
                rows={data.byPaymentMethod}
                cols={[
                  { key: 'method', label: 'Método' },
                  { key: 'count', label: 'Docs' },
                  { key: 'total', label: 'Total', fmt: true },
                ]}
                empty="Sem vendas no período."
              />
            </div>
            {data.byStore ? (
              <div className="card" style={{ flex: '1 1 300px' }}>
                <h2 style={{ fontSize: 14, marginTop: 0 }}>Vendas por Store</h2>
                <Table
                  rows={data.byStore}
                  cols={[
                    { key: 'storeName', label: 'Store' },
                    { key: 'count', label: 'Docs' },
                    { key: 'total', label: 'Total', fmt: true },
                  ]}
                  empty="Sem vendas no período."
                />
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 300px' }}>
              <h2 style={{ fontSize: 14, marginTop: 0 }}>Contas a receber (clientes)</h2>
              <Table
                rows={data.receivables}
                cols={[
                  { key: 'customerName', label: 'Cliente' },
                  { key: 'remaining', label: 'Saldo', fmt: true },
                ]}
                empty="Sem saldos em aberto."
              />
            </div>
            <div className="card" style={{ flex: '1 1 300px' }}>
              <h2 style={{ fontSize: 14, marginTop: 0 }}>Contas a pagar (fornecedores)</h2>
              <Table
                rows={data.payables}
                cols={[
                  { key: 'supplierName', label: 'Fornecedor' },
                  { key: 'remaining', label: 'Saldo', fmt: true },
                ]}
                empty="Sem saldos em aberto."
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 300px' }}>
              <h2 style={{ fontSize: 14, marginTop: 0 }}>Movimentos de stock</h2>
              <Table
                rows={data.stockSummary}
                cols={[
                  { key: 'type', label: 'Tipo' },
                  { key: 'count', label: 'Movs' },
                  { key: 'quantity', label: 'Qtd líquida', fmt: true },
                ]}
                empty="Sem movimentos no período."
              />
            </div>
            <div className="card" style={{ flex: '1 1 300px' }}>
              <h2 style={{ fontSize: 14, marginTop: 0 }}>Top produtos vendidos</h2>
              <Table
                rows={data.topProducts}
                cols={[
                  { key: 'productName', label: 'Produto' },
                  { key: 'quantity', label: 'Qtd', fmt: true },
                  { key: 'revenue', label: 'Receita', fmt: true },
                ]}
                empty="Sem vendas no período."
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Table<T extends Record<string, unknown>>({ rows, cols, empty }: { rows: T[]; cols: Array<{ key: keyof T; label: string; fmt?: boolean }>; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr className="muted">
          {cols.map((c) => (
            <th key={String(c.key)} style={{ textAlign: 'left', padding: '4px 4px', fontWeight: 400 }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={String(c.key)} style={{ padding: '4px 4px' }}>
                {c.fmt ? Number(r[c.key]).toFixed(2) : String(r[c.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
