/**
 * Etapa 1G.4 Fase 3A — categorias do Tenant. RLS própria do Backoffice já garante o
 * isolamento (backoffice_current_tenant_id()) — sem service_role, sem filtro manual de
 * tenant_id nas queries de leitura (a policy já filtra; o INSERT ainda define tenant_id
 * explicitamente porque a coluna é NOT NULL e o WITH CHECK só valida, não preenche).
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET() {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { data, error } = await session.client.from('categories').select('id,name,parent_id,color').order('name');
  if (error) return NextResponse.json({ error: 'Falha ao listar categorias.' }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { name?: string; color?: string | null; parentId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });

  const { data, error } = await session.client
    .from('categories')
    .insert({ tenant_id: session.user.tenantId, name, color: body.color ?? null, parent_id: body.parentId ?? null })
    .select('id,name,parent_id,color')
    .single();
  if (error) return NextResponse.json({ error: 'Falha ao criar categoria.' }, { status: 400 });
  return NextResponse.json({ category: data }, { status: 201 });
}
