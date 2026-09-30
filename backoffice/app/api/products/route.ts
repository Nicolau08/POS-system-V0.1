/**
 * Etapa 1G.4 Fase 3A — produtos do Tenant (catálogo único, products.id é o MESMO entre
 * Stores). Quando `storeId` é passado, junta o estado por Store (store_products.status) —
 * a RLS de store_products já nega silenciosamente uma Store não autorizada (devolve []),
 * nunca é preciso validar `storeId` aqui à parte (ver backoffice-catalog-rls-live).
 * products.stock_quantity nunca é lido aqui (não é autoridade — ver Fase 1).
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const categoryId = url.searchParams.get('categoryId');
  const storeId = url.searchParams.get('storeId');

  let query = session.client
    .from('products')
    .select('id,name,category_id,barcode,price,cost,active,unit')
    .eq('deleted', false)
    .order('name')
    .limit(200);
  if (q) query = query.ilike('name', `%${q}%`);
  if (categoryId) query = query.eq('category_id', categoryId);

  const { data: products, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao listar produtos.' }, { status: 500 });

  if (!storeId || (products ?? []).length === 0) {
    return NextResponse.json({ products: (products ?? []).map((p) => ({ ...p, storeStatus: null })) });
  }

  const ids = (products ?? []).map((p) => p.id);
  const { data: storeRows, error: storeErr } = await session.client
    .from('store_products')
    .select('product_id,status')
    .eq('store_id', storeId)
    .in('product_id', ids);
  if (storeErr) return NextResponse.json({ error: 'Falha ao ler estado por Store.' }, { status: 500 });
  const statusByProduct = new Map((storeRows ?? []).map((r) => [r.product_id, r.status]));

  return NextResponse.json({
    products: (products ?? []).map((p) => ({ ...p, storeStatus: statusByProduct.get(p.id) ?? null })),
  });
}

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { name?: string; price?: number; cost?: number; categoryId?: string | null; barcode?: string | null; unit?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim();
  const price = Number(body.price);
  if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
  if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Preço inválido.' }, { status: 400 });

  // categories.category_id não tem FK composta por tenant (achado pré-existente, fora do
  // escopo desta etapa alterar o schema) — validado aqui pela RLS da própria sessão: se a
  // categoria não pertencer ao tenant, esta SELECT devolve 0 linhas.
  if (body.categoryId) {
    const { data: cat } = await session.client.from('categories').select('id').eq('id', body.categoryId).maybeSingle();
    if (!cat) return NextResponse.json({ error: 'Categoria inválida.' }, { status: 400 });
  }

  const { data, error } = await session.client
    .from('products')
    .insert({
      tenant_id: session.user.tenantId,
      name,
      price,
      cost: Number.isFinite(Number(body.cost)) ? Number(body.cost) : 0,
      category_id: body.categoryId ?? null,
      barcode: body.barcode ?? null,
      unit: body.unit?.trim() || 'un',
    })
    .select('id,name,category_id,barcode,price,cost,active,unit')
    .single();
  if (error) return NextResponse.json({ error: 'Falha ao criar produto.' }, { status: 400 });
  return NextResponse.json({ product: data }, { status: 201 });
}
