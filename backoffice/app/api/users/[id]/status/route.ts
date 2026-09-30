/**
 * Etapa 1G.4 Fase 9 — activar/desactivar utilizador. Toda a validação (owner, próprio
 * tenant, nunca a própria linha, último owner protegido) vive na RPC.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  if (session.user.role !== 'owner') return NextResponse.json({ error: 'Só o owner gere utilizadores.' }, { status: 403 });

  const { id } = await params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const status = String(body.status ?? '');
  if (status !== 'active' && status !== 'disabled') return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });

  const { error } = await session.client.rpc('backoffice_set_user_status', { p_user_id: id, p_status: status });
  if (error) {
    const msg = String(error.message ?? '');
    const map: Record<string, [string, number]> = {
      cannot_change_own_status: ['Não pode alterar o seu próprio estado.', 403],
      last_owner_protected: ['Não pode desactivar o último owner activo do Tenant.', 409],
      user_not_in_tenant: ['Utilizador não encontrado neste Tenant.', 404],
    };
    for (const [key, [message, code]] of Object.entries(map)) {
      if (msg.includes(key)) return NextResponse.json({ error: message }, { status: code });
    }
    return NextResponse.json({ error: `Falha ao alterar estado: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
