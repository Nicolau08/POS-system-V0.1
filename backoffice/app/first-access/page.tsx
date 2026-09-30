import { redirect } from 'next/navigation';
import { getDetailedSession } from '@/lib/serverSession';
import FirstAccessClient from './FirstAccessClient';

export default async function FirstAccessPage({ searchParams }: { searchParams: Promise<{ verifyToken?: string }> }) {
  const session = await getDetailedSession();
  if (session.status === 'unauthenticated' || session.status === 'forbidden') redirect('/login');
  if (session.status === 'ok') redirect('/');

  const { verifyToken } = await searchParams;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <FirstAccessClient
        username={session.user.username ?? ''}
        mustChangePassword={session.mustChangePassword}
        recoveryEmail={session.recoveryEmail}
        recoveryEmailVerified={session.recoveryEmailVerified}
        verifyToken={verifyToken ?? null}
      />
    </div>
  );
}
