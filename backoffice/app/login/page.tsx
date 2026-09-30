'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [nuit, setNuit] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nuit, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Falha ao entrar.');
        return;
      }
      router.push(data.firstAccessRequired ? '/first-access' : '/');
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={onSubmit} className="card" style={{ width: 320 }}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>POSly Backoffice</h1>
        <div className="field">
          <label htmlFor="nuit">NUIT</label>
          <input id="nuit" type="text" required value={nuit} onChange={(e) => setNuit(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="username">Utilizador</label>
          <input id="username" type="text" required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Palavra-passe</label>
          <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'A entrar…' : 'Entrar'}
        </button>
        <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
          <a href="/reset">Esqueci a senha</a>
        </p>
      </form>
    </div>
  );
}
