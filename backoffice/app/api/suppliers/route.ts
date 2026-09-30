/**
 * Etapa 1G.4 Fase 3B — fornecedores do Tenant (public.suppliers, tabela nova — ver
 * migração; sem equivalente pré-existente para reutilizar). Tenant-scoped, sem Store
 * (fornecedores não pertencem a uma Store). RLS própria do Backoffice, sem service_role.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const q = new URL(req.url).searchParams.get('q')?.trim();
  let query = session.client.from('suppliers').select('id,name,phone,email,address').order('name').limit(200);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao listar fornecedores.' }, { status: 500 });
  return NextResponse.json({ suppliers: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { name?: string; phone?: string | null; email?: string | null; address?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });

  const { data, error } = await session.client
    .from('suppliers')
    .insert({ tenant_id: session.user.tenantId, name, phone: body.phone ?? null, email: body.email ?? null, address: body.address ?? null })
    .select('id,name,phone,email,address')
    .single();
  if (error) return NextResponse.json({ error: 'Falha ao criar fornecedor.' }, { status: 400 });
  return NextResponse.json({ supplier: data }, { status: 201 });
}
