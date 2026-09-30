'use client';

import { useEffect, useState } from 'react';

export type Store = { id: string; name: string };

type Props = {
  value?: string;
  onChange?: (storeId: string, stores: Store[]) => void;
};

/** Controlado (value/onChange) quando o chamador precisa de saber a Store escolhida
 * (ex.: para filtrar produtos por Store); sem props continua a funcionar sozinho. */
export default function StoreSelector({ value, onChange }: Props) {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [internal, setInternal] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const selected = value ?? internal;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stores')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        const list: Store[] = data.stores ?? [];
        setStores(list);
        if (list.length > 0) {
          setInternal(list[0].id);
          onChange?.(list[0].id, list);
        }
      })
      .catch(() => !cancelled && setError('Falha ao carregar Stores.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (stores === null) return <p className="muted">A carregar…</p>;
  if (stores.length === 0) return <p className="muted">Nenhuma Store atribuída a este utilizador.</p>;

  return (
    <select
      value={selected}
      onChange={(e) => {
        setInternal(e.target.value);
        onChange?.(e.target.value, stores);
      }}
      style={{ width: '100%', padding: 10 }}
    >
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
