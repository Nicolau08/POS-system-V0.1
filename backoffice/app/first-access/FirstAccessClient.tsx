'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  username: string;
  mustChangePassword: boolean;
  recoveryEmail: string | null;
  recoveryEmailVerified: boolean;
  verifyToken: string | null;
};

export default function FirstAccessClient({ username, mustChangePassword: initialMustChange, recoveryEmail: initialRecoveryEmail, recoveryEmailVerified: initialVerified, verifyToken }: Props) {
  const router = useRouter();
  const [mustChangePassword, setMustChangePassword] = useState(initialMustChange);
  const [recoveryEmail, setRecoveryEmail] = useState(initialRecoveryEmail);
  const [recoveryEmailVerified, setRecoveryEmailVerified] = useState(initialVerified);
  const [emailSent, setEmailSent] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(Boolean(verifyToken));

  useEffect(() => {
    if (!verifyToken) return;
    fetch('/api/auth/first-access/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setRecoveryEmailVerified(true);
        router.refresh();
      })
      .catch(() => setError('Falha ao verificar o email.'))
      .finally(() => setVerifying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyToken]);

  const submitPassword = async (e: React.FormEvent) => {
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
      const res = await fetch('/api/auth/first-access/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao definir a nova password.');
        return;
      }
      setMustChangePassword(false);
    } finally {
      setLoading(false);
    }
  };

  const submitRecoveryEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/first-access/recovery-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryEmail: recoveryEmailInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Falha ao gravar o email de recuperação.');
        return;
      }
      setRecoveryEmail(recoveryEmailInput);
      setEmailSent(true);
      setInfo('Enviámos um link de verificação para esse email.');
      if (data.dev?.link) setInfo((prev) => `${prev} [dev] ${data.dev.link}`);
    } finally {
      setLoading(false);
    }
  };

  if (recoveryEmailVerified && !mustChangePassword) {
    return (
      <div className="card" style={{ width: 360 }}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>Primeiro acesso concluído</h1>
        <p className="muted">Já pode aceder ao Backoffice.</p>
        <button className="btn" onClick={() => router.push('/')}>
          Continuar
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ width: 360 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>Primeiro acesso</h1>
      <p className="muted" style={{ marginTop: -8 }}>Utilizador: {username}</p>
      {error ? <p className="error">{error}</p> : null}
      {info ? <p className="muted">{info}</p> : null}

      {mustChangePassword ? (
        <form onSubmit={submitPassword}>
          <p className="muted">Passo 1 de 2 — defina a sua nova password.</p>
          <div className="field">
            <label htmlFor="newPassword">Nova password</label>
            <input id="newPassword" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirmar password</label>
            <input id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'A gravar…' : 'Definir password'}
          </button>
        </form>
      ) : !recoveryEmailVerified ? (
        <div>
          <p className="muted">Passo 2 de 2 — email de recuperação.</p>
          {!emailSent && !recoveryEmail ? (
            <form onSubmit={submitRecoveryEmail}>
              <div className="field">
                <label htmlFor="recoveryEmail">Email de recuperação</label>
                <input id="recoveryEmail" type="email" required value={recoveryEmailInput} onChange={(e) => setRecoveryEmailInput(e.target.value)} autoComplete="email" />
              </div>
              <button type="submit" className="btn" disabled={loading}>
                {loading ? 'A enviar…' : 'Enviar verificação'}
              </button>
            </form>
          ) : (
            <div>
              <p className="muted">{verifying ? 'A verificar…' : `Enviámos um email para ${recoveryEmail}. Abra o link para concluir.`}</p>
              {!verifying ? (
                <button className="btn" style={{ background: '#333' }} onClick={() => router.refresh()}>
                  Já verifiquei
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
