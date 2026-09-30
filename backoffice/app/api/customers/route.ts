/**
 * Etapa 1G.4 Fase 3B — clientes do Tenant (public.customers, sem conceito de Store — ver
 * migração). RLS própria do Backoffice já garante o isolamento, sem service_role.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const q = new URL(req.url).searchParams.get('q')?.trim();
  let query = session.client.from('customers').select('id,name,phone,email,address').order('name').limit(200);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao listar clientes.' }, { status: 500 });
  return NextResponse.json({ customers: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { name?: string; phone?: string; email?: string | null; address?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
  if (!phone) return NextResponse.json({ error: 'Telefone é obrigatório.' }, { status: 400 });

  const { data, error } = await session.client
    .from('customers')
    .insert({ tenant_id: session.user.tenantId, name, phone, email: body.email ?? null, address: body.address ?? null })
    .select('id,name,phone,email,address')
    .single();
  if (error) return NextResponse.json({ error: 'Falha ao criar cliente.' }, { status: 400 });
  return NextResponse.json({ customer: data }, { status: 201 });
}
