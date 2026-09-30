'use client';

import { useEffect, useState, useCallback } from 'react';

type Party = { id: string; name: string; phone: string | null; email: string | null; address: string | null };
type Kind = 'customers' | 'suppliers';

const LABEL: Record<Kind, { title: string; single: string; phoneRequired: boolean }> = {
  customers: { title: 'Clientes', single: 'cliente', phoneRequired: true },
  suppliers: { title: 'Fornecedores', single: 'fornecedor', phoneRequired: false },
};

function PartyTable({ kind }: { kind: Kind }) {
  const info = LABEL[kind];
  const [items, setItems] = useState<Party[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    fetch(`/api/${kind}?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setError(null);
        setItems(data[kind] ?? []);
      })
      .catch(() => setError(`Falha ao carregar ${info.title.toLowerCase()}.`));
  }, [kind, q, info.title]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch(`/api/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: phone || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Falha ao criar ${info.single}.`);
        return;
      }
      setName('');
      setPhone('');
      load();
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await fetch(`/api/${kind}/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editing.name, phone: editing.phone, email: editing.email, address: editing.address }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Falha ao actualizar.');
      return;
    }
    setEditing(null);
    load();
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <input
          placeholder={`Pesquisar ${info.title.toLowerCase()}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: '100%', background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
        />
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '6px 8px' }}>Nome</th>
              <th style={{ padding: '6px 8px' }}>Telefone</th>
              <th style={{ padding: '6px 8px' }}>Email</th>
              <th style={{ padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((p) =>
              editing?.id === p.id ? (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={{ width: '100%' }} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} style={{ width: '100%' }} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <input value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} style={{ width: '100%' }} />
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn" onClick={saveEdit}>
                      Guardar
                    </button>{' '}
                    <button className="btn" style={{ background: '#333' }} onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>{p.name}</td>
                  <td style={{ padding: '6px 8px' }}>{p.phone ?? <span className="muted">—</span>}</td>
                  <td style={{ padding: '6px 8px' }}>{p.email ?? <span className="muted">—</span>}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <button className="btn" onClick={() => setEditing(p)}>
                      Editar
                    </button>
                  </td>
                </tr>
              )
            )}
            {items !== null && items.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: '10px 8px' }}>
                  Nenhum {info.single} encontrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className="card">
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Novo {info.single}</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <input
            placeholder="Nome"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 2, background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
          />
          <input
            placeholder="Telefone"
            required={info.phoneRequired}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ flex: 1, background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' }}
          />
          <button className="btn" type="submit" disabled={creating}>
            {creating ? 'A criar…' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function PartiesClient() {
  const [tab, setTab] = useState<Kind>('customers');
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['customers', 'suppliers'] as Kind[]).map((k) => (
          <button
            key={k}
            className="btn"
            style={{ background: tab === k ? 'var(--accent)' : '#2a2e38' }}
            onClick={() => setTab(k)}
          >
            {LABEL[k].title}
          </button>
        ))}
      </div>
      <PartyTable kind={tab} />
    </div>
  );
}
