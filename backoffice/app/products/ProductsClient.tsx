'use client';

import { useEffect, useState, useCallback } from 'react';
import StoreSelector, { type Store } from '../StoreSelector';

type Category = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  category_id: string | null;
  barcode: string | null;
  price: number;
  cost: number;
  active: boolean;
  unit: string;
  storeStatus: 'active' | 'discontinued' | null;
};

export default function ProductsClient() {
  const [storeId, setStoreId] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => !data.error && setCategories(data.categories ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!storeId) return;
    const params = new URLSearchParams({ storeId });
    if (q) params.set('q', q);
    if (categoryId) params.set('categoryId', categoryId);
    fetch(`/api/products?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setError(null);
        setProducts(data.products ?? []);
      })
      .catch(() => setError('Falha ao carregar produtos.'));
  }, [storeId, q, categoryId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = async (product: Product) => {
    const nextStatus = product.storeStatus === 'active' ? 'discontinued' : 'active';
    setBusyProductId(product.id);
    try {
      const res = await fetch('/api/store-products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, productId: product.id, status: nextStatus }),
      });
      if (res.ok) load();
    } finally {
      setBusyProductId(null);
    }
  };

  const createProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, price: Number(newPrice), categoryId: newCategoryId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao criar produto.');
        return;
      }
      setNewName('');
      setNewPrice('');
      setNewCategoryId('');
      load();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Loja</h2>
        <StoreSelector
          value={storeId}
          onChange={(id, list) => {
            setStoreId(id);
            setStores(list);
          }}
        />
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
        <input
          placeholder="Pesquisar por nome…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          style={{ background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '6px 8px' }}>Nome</th>
              <th style={{ padding: '6px 8px' }}>Preço</th>
              <th style={{ padding: '6px 8px' }}>Estado na Loja</th>
              <th style={{ padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>{p.name}</td>
                <td style={{ padding: '6px 8px' }}>{Number(p.price).toFixed(2)}</td>
                <td style={{ padding: '6px 8px' }}>{p.storeStatus ?? <span className="muted">não configurado</span>}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button className="btn" disabled={busyProductId === p.id} onClick={() => toggleStatus(p)}>
                    {p.storeStatus === 'active' ? 'Descontinuar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
            {products !== null && products.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: '10px 8px' }}>
                  Nenhum produto encontrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form onSubmit={createProduct} className="card">
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Novo produto</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <input
            placeholder="Nome"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 2, background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
          />
          <input
            placeholder="Preço"
            type="number"
            step="0.01"
            min="0"
            required
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            style={{ width: 120, background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
          />
          <select
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            style={{ background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn" type="submit" disabled={creating}>
            {creating ? 'A criar…' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  );
}
