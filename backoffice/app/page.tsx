import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/serverSession';
import StoreSelector from './StoreSelector';
import LogoutButton from './LogoutButton';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>POSly Backoffice</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Tenant: {user.tenantId} · Papel: {user.role}
          </p>
        </div>
        <LogoutButton />
      </div>
      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Loja</h2>
        <StoreSelector />
      </div>
      <p style={{ marginTop: 16, display: 'flex', gap: 16 }}>
        <a href="/products">Produtos →</a>
        <a href="/parties">Clientes e Fornecedores →</a>
        <a href="/stock">Stock →</a>
        <a href="/suppliers/documents">Documentos de Fornecedor →</a>
        <a href="/orders">Vendas (VD/FT) →</a>
        <a href="/dashboard">Dashboard →</a>
        {user.role === 'owner' ? <a href="/users">Utilizadores →</a> : null}
      </p>
    </div>
  );
}
