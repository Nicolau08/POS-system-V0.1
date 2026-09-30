import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/serverSession';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Dashboard</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Tenant: {user.tenantId} · Papel: {user.role}
          </p>
        </div>
        <a href="/" className="muted" style={{ textDecoration: 'none' }}>
          ← Início
        </a>
      </div>
      <DashboardClient role={user.role} />
    </div>
  );
}
