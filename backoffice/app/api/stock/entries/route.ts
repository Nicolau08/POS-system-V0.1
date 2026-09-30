/**
 * Etapa 1G.4 Fase 3C.1 — registar entrada de stock. Nunca escreve saldo directamente:
 * chama a RPC backoffice_create_stock_movement (SECURITY DEFINER), que grava no ledger
 * (stock_movements, autoridade — ver Fase 1) e valida Tenant/Store/Warehouse/Produto no
 * servidor, nunca confiando no que o browser envie. idempotencyKey é gerada UMA vez no
 * cliente por submissão (nunca no servidor) — um retry da mesma tentativa reutiliza-a,
 * garantindo que a RPC devolve 'duplicate' em vez de duplicar o movimento.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { storeId?: string; warehouseId?: string; productId?: string; quantity?: number; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const storeId = String(body.storeId ?? '').trim();
  const warehouseId = String(body.warehouseId ?? '').trim();
  const productId = String(body.productId ?? '').trim();
  const quantity = Number(body.quantity);
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  if (!storeId || !warehouseId || !productId) {
    return NextResponse.json({ error: 'Store, armazém e produto são obrigatórios.' }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'Quantidade tem de ser maior que zero.' }, { status: 400 });
  }
  if (!idempotencyKey) return NextResponse.json({ error: 'Pedido inválido (sem chave de idempotência).' }, { status: 400 });

  const { data, error } = await session.client.rpc('backoffice_create_stock_movement', {
    p_store_id: storeId,
    p_warehouse_id: warehouseId,
    p_product_id: productId,
    p_quantity: quantity,
    p_idempotency_key: idempotencyKey,
    p_type: 'restock',
  });
  if (error) {
    const msg = String(error.message ?? '');
    const status = /store_not_authorized|warehouse_not_in_store|item_product_not_in_tenant/.test(msg) ? 403 : 400;
    return NextResponse.json({ error: 'Falha ao registar entrada.', detail: msg }, { status });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: row?.out_id, status: row?.out_status });
}
