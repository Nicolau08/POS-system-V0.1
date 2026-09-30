/**
 * Etapa 1G.4 Fase 3C.3 — transferência entre armazéns da MESMA Store
 * (backoffice_transfer_stock). Nunca escreve saldo directamente; sem validação de saldo
 * (política actual do projecto: negativo é permitido no ledger, preservada aqui).
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { storeId?: string; fromWarehouseId?: string; toWarehouseId?: string; productId?: string; quantity?: number; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const storeId = String(body.storeId ?? '').trim();
  const fromWarehouseId = String(body.fromWarehouseId ?? '').trim();
  const toWarehouseId = String(body.toWarehouseId ?? '').trim();
  const productId = String(body.productId ?? '').trim();
  const quantity = Number(body.quantity);
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  if (!storeId || !fromWarehouseId || !toWarehouseId || !productId) {
    return NextResponse.json({ error: 'Store, armazém de origem, armazém de destino e produto são obrigatórios.' }, { status: 400 });
  }
  if (fromWarehouseId === toWarehouseId) return NextResponse.json({ error: 'Os armazéns têm de ser diferentes.' }, { status: 400 });
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'Quantidade tem de ser maior que zero.' }, { status: 400 });
  }
  if (!idempotencyKey) return NextResponse.json({ error: 'Pedido inválido (sem chave de idempotência).' }, { status: 400 });

  const { data, error } = await session.client.rpc('backoffice_transfer_stock', {
    p_store_id: storeId,
    p_from_warehouse_id: fromWarehouseId,
    p_to_warehouse_id: toWarehouseId,
    p_product_id: productId,
    p_quantity: quantity,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    const msg = String(error.message ?? '');
    const status = /store_not_authorized|warehouse_not_in_store|item_product_not_in_tenant/.test(msg) ? 403 : 400;
    return NextResponse.json({ error: 'Falha ao registar transferência.', detail: msg }, { status });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ status: row?.out_status });
}
