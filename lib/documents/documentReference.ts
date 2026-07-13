export type DocumentSourceReference = {
  doc_type?: string | null;
  document_number?: string | null;
  approved_document_type?: string | null;
  approved_document_number?: string | null;
};

function sourceDocKindLabel(type: string): string {
  const normalized = String(type ?? '').trim().toUpperCase();
  if (normalized === 'FT' || normalized === 'FATURA') return 'fatura';
  if (normalized === 'FP' || normalized.includes('PROFORMA') || normalized.includes('COTAC')) return 'cotação';
  if (normalized === 'RC' || normalized.includes('RECIBO')) return 'recibo';
  if (normalized === 'VD' || normalized === 'VENDA') return 'venda a dinheiro';
  return normalized.toLowerCase() || 'documento';
}

function resolveDocumentFilterCode(row: DocumentSourceReference): string {
  const docType = String(row.doc_type ?? '').trim().toUpperCase();
  const docNumber = String(row.document_number ?? '').trim().toUpperCase();

  if (docType === 'VD' || docType === 'VENDA') return 'VD';
  if (docType === 'FT' || docType === 'FATURA') return 'FT';
  if (docType === 'FP' || docType.includes('PROFORMA') || docType.includes('COTAC')) return 'FP';
  if (docType === 'RC' || docType === 'RECIBO') return 'RC';

  if (docNumber.startsWith('VD/')) return 'VD';
  if (docNumber.startsWith('FT/')) return 'FT';
  if (docNumber.startsWith('FP/')) return 'FP';
  if (docNumber.startsWith('RC/') || docNumber.startsWith('PBNK')) return 'RC';

  return docType || 'VD';
}

export function getLinkedDocumentReference(row: DocumentSourceReference): {
  type: string;
  number: string;
  role: 'source' | 'generated';
} | null {
  const refType = String(row.approved_document_type ?? '').trim().toUpperCase();
  const refNumber = String(row.approved_document_number ?? '').trim();
  if (!refNumber) return null;

  const docCode = resolveDocumentFilterCode(row);
  if (docCode === 'RC' || docCode === 'VD') {
    return { type: refType, number: refNumber, role: 'source' };
  }
  if (docCode === 'FT' || docCode === 'FP') {
    return { type: refType, number: refNumber, role: 'generated' };
  }
  return { type: refType, number: refNumber, role: 'source' };
}

export function formatDocumentReferenceDisplay(
  row: DocumentSourceReference,
  docCode?: string,
): string {
  const linked = getLinkedDocumentReference(row);
  if (!linked) return '';

  const code = docCode || resolveDocumentFilterCode(row);
  const kindLabel = sourceDocKindLabel(linked.type);

  if (code === 'RC' || code === 'VD') {
    return `Referente à ${kindLabel} ${linked.number}`;
  }
  if (code === 'FT' && linked.type === 'RC') {
    return `Recibo ${linked.number}`;
  }
  if (code === 'FP' && linked.type === 'VD') {
    return `Venda a dinheiro ${linked.number}`;
  }
  if (linked.role === 'generated') {
    return `${kindLabel} ${linked.number}`;
  }
  return `Referente à ${kindLabel} ${linked.number}`;
}

export function formatDocumentSourceReferenceLabel(row: DocumentSourceReference): string {
  const linked = getLinkedDocumentReference(row);
  if (!linked || linked.role !== 'source') return '';
  return `Referente à ${sourceDocKindLabel(linked.type)} ${linked.number}`;
}
