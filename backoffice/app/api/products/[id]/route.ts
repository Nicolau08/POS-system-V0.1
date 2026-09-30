/**
 * Etapa 1G.4 Fase 3A — produto individual (Tenant, não por Store — ver route.ts).
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  const { data, error } = await session.client
    .from('products')
    .select('id,name,category_id,barcode,price,cost,active,unit,description')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao ler produto.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
  return NextResponse.json({ product: data });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  let body: { name?: string; price?: number; cost?: number; categoryId?: string | null; barcode?: string | null; unit?: string; description?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }

  if (body.categoryId) {
    const { data: cat } = await session.client.from('categories').select('id').eq('id', body.categoryId).maybeSingle();
    if (!cat) return NextResponse.json({ error: 'Categoria inválida.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
    patch.name = name;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Preço inválido.' }, { status: 400 });
    patch.price = price;
  }
  if (body.cost !== undefined) patch.cost = Number.isFinite(Number(body.cost)) ? Number(body.cost) : 0;
  if (body.categoryId !== undefined) patch.category_id = body.categoryId;
  if (body.barcode !== undefined) patch.barcode = body.barcode;
  if (body.unit !== undefined) patch.unit = String(body.unit).trim() || 'un';
  if (body.description !== undefined) patch.description = body.description;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });

  const { data, error } = await session.client
    .from('products')
    .update(patch)
    .eq('id', id)
    .select('id,name,category_id,barcode,price,cost,active,unit,description')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao actualizar produto.' }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
  return NextResponse.json({ product: data });
}
