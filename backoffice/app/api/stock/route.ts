/**
 * Etapa 1G.4 Fase 3C.1 — consulta de saldo (warehouse_stock: VIEW derivada do ledger,
 * nunca escrita directamente — ver Fase 1/migração). Junta o nome do produto (query
 * separada, mesma razão que em /api/products: FK composta não é embutida pelo PostgREST).
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const url = new URL(req.url);
  const storeId = url.searchParams.get('storeId');
  const warehouseId = url.searchParams.get('warehouseId');
  if (!storeId) return NextResponse.json({ error: 'storeId é obrigatório.' }, { status: 400 });

  let query = session.client.from('warehouse_stock').select('warehouse_id,product_id,quantity,last_movement_at').eq('store_id', storeId);
  if (warehouseId) query = query.eq('warehouse_id', warehouseId);
  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao ler saldo.' }, { status: 500 });

  const productIds = [...new Set((rows ?? []).map((r) => r.product_id))];
  let names = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await session.client.from('products').select('id,name').in('id', productIds);
    names = new Map((products ?? []).map((p) => [p.id, p.name]));
  }

  return NextResponse.json({
    stock: (rows ?? []).map((r) => ({ ...r, productName: names.get(r.product_id) ?? r.product_id })),
  });
}
