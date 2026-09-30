/**
 * Etapa 1G.4 Fase 3C.2 — contagem por saldo-alvo. O delta é SEMPRE calculado no servidor
 * (backoffice_set_stock_count, dentro de um advisory lock por produto+armazém — nunca no
 * browser, que podia ler um saldo já desactualizado). targetQuantity é a contagem física
 * (nunca negativa); a RPC devolve 'no_change' sem gravar nada se já bater certo.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { storeId?: string; warehouseId?: string; productId?: string; targetQuantity?: number; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const storeId = String(body.storeId ?? '').trim();
  const warehouseId = String(body.warehouseId ?? '').trim();
  const productId = String(body.productId ?? '').trim();
  const targetQuantity = Number(body.targetQuantity);
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  if (!storeId || !warehouseId || !productId) {
    return NextResponse.json({ error: 'Store, armazém e produto são obrigatórios.' }, { status: 400 });
  }
  if (!Number.isFinite(targetQuantity) || targetQuantity < 0) {
    return NextResponse.json({ error: 'A contagem tem de ser um número maior ou igual a zero.' }, { status: 400 });
  }
  if (!idempotencyKey) return NextResponse.json({ error: 'Pedido inválido (sem chave de idempotência).' }, { status: 400 });

  const { data, error } = await session.client.rpc('backoffice_set_stock_count', {
    p_store_id: storeId,
    p_warehouse_id: warehouseId,
    p_product_id: productId,
    p_target_quantity: targetQuantity,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    const msg = String(error.message ?? '');
    const status = /store_not_authorized|warehouse_not_in_store|item_product_not_in_tenant/.test(msg) ? 403 : 400;
    return NextResponse.json({ error: 'Falha ao registar contagem.', detail: msg }, { status });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: row?.out_id, status: row?.out_status, delta: row?.out_delta });
}
