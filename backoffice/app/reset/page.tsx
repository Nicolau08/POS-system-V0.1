'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetPageInner />
    </Suspense>
  );
}

function ResetPageInner() {
  const token = useSearchParams().get('token');
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {token ? <ConfirmForm token={token} /> : <RequestForm />}
    </div>
  );
}

function RequestForm() {
  const [nuit, setNuit] = useState('');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nuit, username }),
      });
      const data = await res.json();
      setMessage(data.message ?? 'Se os dados estiverem correctos, enviaremos instruções.');
      if (data.dev?.link) setMessage((m) => `${m} [dev] ${data.dev.link}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="card" style={{ width: 320 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>Esqueci a senha</h1>
      <div className="field">
        <label htmlFor="nuit">NUIT</label>
        <input id="nuit" type="text" required value={nuit} onChange={(e) => setNuit(e.target.value)} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="username">Utilizador</label>
        <input id="username" type="text" required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </div>
      {message ? <p className="muted">{message}</p> : null}
      <button type="submit" className="btn" disabled={loading}>
        {loading ? 'A enviar…' : 'Enviar instruções'}
      </button>
      <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
        <a href="/login">Voltar ao login</a>
      </p>
    </form>
  );
}

function ConfirmForm({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('A nova password tem de ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As passwords não coincidem.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao definir a nova password.');
        return;
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="card" style={{ width: 320 }}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>Password redefinida</h1>
        <p className="muted">Já pode entrar com a nova password.</p>
        <a href="/login" className="btn" style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>
          Ir para o login
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ width: 320 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>Nova password</h1>
      <div className="field">
        <label htmlFor="newPassword">Nova password</label>
        <input id="newPassword" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="field">
        <label htmlFor="confirmPassword">Confirmar password</label>
        <input id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" className="btn" disabled={loading}>
        {loading ? 'A gravar…' : 'Redefinir password'}
      </button>
    </form>
  );
}
