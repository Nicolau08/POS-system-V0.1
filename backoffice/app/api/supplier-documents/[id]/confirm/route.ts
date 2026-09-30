/**
 * Etapa 1G.4 Fase 3D — confirmar documento: UMA chamada RPC (transaccional, atómica —
 * nunca uma RPC por item aqui). Nunca escreve saldo directamente.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  let body: { warehouseId?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    // corpo opcional
  }

  const { data, error } = await session.client.rpc('backoffice_confirm_supplier_document', {
    p_document_id: id,
    p_warehouse_id: body.warehouseId ?? null,
  });
  if (error) {
    const msg = String(error.message ?? '');
    const status = /store_not_authorized/.test(msg) ? 403 : /document_not_found/.test(msg) ? 404 : 400;
    return NextResponse.json({ error: 'Falha ao confirmar documento.', detail: msg }, { status });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ status: row?.out_status, itemsApplied: row?.out_items_applied });
}
