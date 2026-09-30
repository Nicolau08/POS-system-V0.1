/**
 * Etapa 1G.4 Fase 3C.1 — histórico básico de movimentos (SELECT directo, ledger =
 * autoridade — nunca escrito aqui). RLS aditiva do Backoffice já filtra por Store.
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

  let query = session.client
    .from('stock_movements')
    .select('id,warehouse_id,product_id,type,quantity,reference_id,device_id,created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (warehouseId) query = query.eq('warehouse_id', warehouseId);
  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao ler movimentos.' }, { status: 500 });

  const productIds = [...new Set((rows ?? []).map((r) => r.product_id))];
  let names = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await session.client.from('products').select('id,name').in('id', productIds);
    names = new Map((products ?? []).map((p) => [p.id, p.name]));
  }

  return NextResponse.json({
    movements: (rows ?? []).map((r) => ({
      ...r,
      productName: names.get(r.product_id) ?? r.product_id,
      origin: r.device_id ? 'device' : 'backoffice',
    })),
  });
}
