/**
 * Etapa 1G.4 Fase 3D — documentos de fornecedor. Escrita directa via RLS (draft
 * editável), a confirmação é sempre pela RPC dedicada (ver [id]/confirm/route.ts).
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const storeId = new URL(req.url).searchParams.get('storeId');
  let query = session.client.from('supplier_documents').select('id,store_id,supplier_id,document_number,status,created_at,confirmed_at').order('created_at', { ascending: false }).limit(100);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao listar documentos.' }, { status: 500 });
  return NextResponse.json({ documents: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { storeId?: string; supplierId?: string; documentNumber?: string; items?: Array<{ productId: string; quantity: number; unitCost: number }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const storeId = String(body.storeId ?? '').trim();
  const supplierId = String(body.supplierId ?? '').trim();
  const documentNumber = String(body.documentNumber ?? '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!storeId || !supplierId || !documentNumber) {
    return NextResponse.json({ error: 'Store, fornecedor e número do documento são obrigatórios.' }, { status: 400 });
  }
  if (items.length === 0) return NextResponse.json({ error: 'O documento precisa de pelo menos um item.' }, { status: 400 });
  for (const it of items) {
    if (!it.productId || !(Number(it.quantity) > 0) || !(Number(it.unitCost) >= 0)) {
      return NextResponse.json({ error: 'Item inválido (produto, quantidade > 0 e custo unitário obrigatórios).' }, { status: 400 });
    }
  }

  const { data: doc, error: docErr } = await session.client
    .from('supplier_documents')
    .insert({ tenant_id: session.user.tenantId, store_id: storeId, supplier_id: supplierId, document_number: documentNumber })
    .select('id,store_id,supplier_id,document_number,status')
    .single();
  if (docErr) return NextResponse.json({ error: 'Falha ao criar documento.', detail: docErr.message }, { status: 400 });

  const { error: itemsErr } = await session.client.from('supplier_document_items').insert(
    items.map((it) => ({ tenant_id: session.user.tenantId, document_id: doc.id, product_id: it.productId, quantity: it.quantity, unit_cost: it.unitCost }))
  );
  if (itemsErr) return NextResponse.json({ error: 'Documento criado, mas falhou ao gravar os items.', detail: itemsErr.message }, { status: 400 });

  return NextResponse.json({ document: doc }, { status: 201 });
}
