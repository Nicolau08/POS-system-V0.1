import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  let body: { name?: string; phone?: string | null; email?: string | null; address?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
    patch.name = name;
  }
  if (body.phone !== undefined) patch.phone = body.phone;
  if (body.email !== undefined) patch.email = body.email;
  if (body.address !== undefined) patch.address = body.address;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });

  const { data, error } = await session.client
    .from('suppliers')
    .update(patch)
    .eq('id', id)
    .select('id,name,phone,email,address')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao actualizar fornecedor.' }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Fornecedor não encontrado.' }, { status: 404 });
  return NextResponse.json({ supplier: data });
}
