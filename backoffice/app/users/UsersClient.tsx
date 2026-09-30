'use client';

import { useEffect, useState, useCallback } from 'react';
import StoreSelector, { type Store } from '../StoreSelector';

const inputStyle = { background: '#0b0d12', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', padding: '8px 10px' };

type UserRow = {
  user_id: string;
  username: string;
  role: string;
  status: string;
  recovery_email: string | null;
  recovery_email_verified: boolean;
  must_change_password: boolean;
  stores: Array<{ id: string; name: string }>;
};

export default function UsersClient() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState<{ username: string; tempPassword: string; url: string; txt: string } | null>(null);

  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'owner' | 'store_operator'>('store_operator');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setUsers(d.users ?? []);
      })
      .catch(() => setError('Falha ao carregar utilizadores.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, role, storeIds: role === 'store_operator' ? storeIds : [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao criar utilizador.');
        return;
      }
      setCredential(data);
      setUsername('');
      setRole('store_operator');
      setStoreIds([]);
      load();
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (userId: string, status: 'active' | 'disabled') => {
    setError(null);
    const res = await fetch(`/api/users/${userId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Falha ao alterar estado.');
      return;
    }
    load();
  };

  const updateStores = async (userId: string, ids: string[]) => {
    setError(null);
    const res = await fetch(`/api/users/${userId}/stores`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeIds: ids }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Falha ao alterar Stores.');
      return;
    }
    load();
  };

  return (
    <div>
      {error ? <p className="error">{error}</p> : null}

      {credential ? (
        <div className="card" style={{ marginBottom: 16, background: '#182615' }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Credencial de entrega única</h2>
          <p className="muted">Copie agora — não voltará a ser mostrada.</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{credential.txt}</pre>
          <button className="btn" onClick={() => setCredential(null)}>
            Fechar
          </button>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Utilizadores</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr className="muted">
              <th style={{ textAlign: 'left', padding: '4px' }}>Username</th>
              <th style={{ textAlign: 'left', padding: '4px' }}>Role</th>
              <th style={{ textAlign: 'left', padding: '4px' }}>Estado</th>
              <th style={{ textAlign: 'left', padding: '4px' }}>Primeiro acesso</th>
              <th style={{ textAlign: 'left', padding: '4px' }}>Stores</th>
              <th style={{ textAlign: 'left', padding: '4px' }}>Acções</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <UserRowView key={u.user_id} u={u} allStores={allStores} onSetStatus={setStatus} onUpdateStores={updateStores} />
            ))}
            {users !== null && users.length === 0 ? (
              <tr>
                <td className="muted" style={{ padding: '10px 4px' }}>
                  Nenhum utilizador.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form onSubmit={createUser} className="card">
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Novo utilizador</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <input placeholder="Username" required value={username} onChange={(e) => setUsername(e.target.value)} style={{ flex: 1, ...inputStyle }} />
          <select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'store_operator')} style={{ ...inputStyle }}>
            <option value="store_operator">store_operator</option>
            <option value="owner">owner</option>
          </select>
        </div>
        {role === 'store_operator' ? (
          <div style={{ marginBottom: 10 }}>
            <p className="muted" style={{ margin: '0 0 6px' }}>
              Stores atribuídas:
            </p>
            <StoreMultiSelect selected={storeIds} onChange={setStoreIds} onStoresLoaded={setAllStores} />
          </div>
        ) : null}
        <button className="btn" type="submit" disabled={creating}>
          {creating ? 'A criar…' : 'Criar utilizador'}
        </button>
      </form>
    </div>
  );
}

function UserRowView({
  u,
  allStores,
  onSetStatus,
  onUpdateStores,
}: {
  u: UserRow;
  allStores: Store[];
  onSetStatus: (id: string, status: 'active' | 'disabled') => void;
  onUpdateStores: (id: string, ids: string[]) => void;
}) {
  const [editingStores, setEditingStores] = useState(false);
  const [ids, setIds] = useState<string[]>(u.stores.map((s) => s.id));

  return (
    <tr>
      <td style={{ padding: '4px' }}>{u.username}</td>
      <td style={{ padding: '4px' }}>{u.role}</td>
      <td style={{ padding: '4px' }}>{u.status}</td>
      <td style={{ padding: '4px' }} className="muted">
        {u.must_change_password || !u.recovery_email_verified ? 'Por concluir' : 'Concluído'}
      </td>
      <td style={{ padding: '4px' }}>
        {u.role === 'owner' ? (
          <span className="muted">Todas</span>
        ) : editingStores ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <StoreMultiSelect selected={ids} onChange={setIds} onStoresLoaded={() => {}} />
            <button
              className="btn"
              onClick={() => {
                onUpdateStores(u.user_id, ids);
                setEditingStores(false);
              }}
            >
              Guardar
            </button>
          </div>
        ) : (
          <span>
            {u.stores.map((s) => s.name).join(', ') || <span className="muted">Nenhuma</span>}{' '}
            <button className="btn" style={{ background: '#333', padding: '2px 8px' }} onClick={() => setEditingStores(true)}>
              Editar
            </button>
          </span>
        )}
      </td>
      <td style={{ padding: '4px' }}>
        {u.status === 'active' ? (
          <button className="btn" style={{ background: '#333' }} onClick={() => onSetStatus(u.user_id, 'disabled')}>
            Desactivar
          </button>
        ) : (
          <button className="btn" onClick={() => onSetStatus(u.user_id, 'active')}>
            Activar
          </button>
        )}
      </td>
    </tr>
  );
}

function StoreMultiSelect({ selected, onChange, onStoresLoaded }: { selected: string[]; onChange: (ids: string[]) => void; onStoresLoaded: (stores: Store[]) => void }) {
  const [stores, setStores] = useState<Store[]>([]);

  useEffect(() => {
    fetch('/api/stores')
      .then((r) => r.json())
      .then((d) => {
        const list: Store[] = d.stores ?? [];
        setStores(list);
        onStoresLoaded(list);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <select
      multiple
      value={selected}
      onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
      style={{ minWidth: 180, minHeight: 70, ...inputStyle }}
    >
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
