export type DocumentSourceReference = {
  doc_type?: string | null;
  document_number?: string | null;
  approved_document_type?: string | null;
  approved_document_number?: string | null;
  /** Nº da fatura do fornecedor (Doc. Externo na compra) */
  external_document?: string | null;
};

function sourceDocKindLabel(type: string): string {
  const normalized = String(type ?? '').trim().toUpperCase();
  if (normalized === 'FT' || normalized === 'FATURA') return 'fatura';
  if (normalized === 'FTF' || normalized === 'COMPRA' || normalized.includes('FORNECEDOR')) {
    return 'fatura de fornecedor';
  }
  if (normalized === 'FP' || normalized.includes('PROFORMA') || normalized.includes('COTAC')) return 'cotação';
  if (normalized === 'RC' || normalized.includes('RECIBO')) return 'recibo';
  if (normalized === 'VD' || normalized === 'VENDA') return 'venda a dinheiro';
  if (normalized === 'PAG' || normalized === 'PAGAMENTO') return 'pagamento';
  if (
    normalized === 'ND' ||
    normalized.includes('DEBITO') ||
    normalized.includes('DÉBITO') ||
    normalized === 'NOTA DE DÉBITO' ||
    normalized === 'NOTA DE DEBITO'
  ) {
    return 'nota de débito';
  }
  if (
    normalized === 'NC' ||
    normalized.includes('CREDITO') ||
    normalized.includes('CRÉDITO')
  ) {
    return 'nota de crédito';
  }
  return normalized.toLowerCase() || 'documento';
}

function resolveDocumentFilterCode(row: DocumentSourceReference): string {
  const docType = String(row.doc_type ?? '').trim().toUpperCase();
  const docNumber = String(row.document_number ?? '').trim().toUpperCase();

  if (docType === 'VD' || docType === 'VENDA') return 'VD';
  if (docType === 'FTF' || docType === 'COMPRA' || docType.includes('FORNECEDOR')) return 'FTF';
  if (docType === 'FT' || docType === 'FATURA') return 'FT';
  if (docType === 'FP' || docType.includes('PROFORMA') || docType.includes('COTAC')) return 'FP';
  if (docType === 'RC' || docType === 'RECIBO') return 'RC';
  if (docType === 'PAG' || docType === 'PAGAMENTO') return 'PAG';
  if (docType === 'ND' || docType.includes('DEBITO') || docType.includes('DÉBITO')) return 'ND';
  if (docType === 'NC' || docType.includes('CREDITO') || docType.includes('CRÉDITO')) return 'NC';

  if (docNumber.startsWith('VD/')) return 'VD';
  if (docNumber.startsWith('FTF/')) return 'FTF';
  if (docNumber.startsWith('FT/')) return 'FT';
  if (docNumber.startsWith('FP/')) return 'FP';
  if (docNumber.startsWith('RC/') || docNumber.startsWith('PBNK')) return 'RC';
  if (docNumber.startsWith('PAG/')) return 'PAG';
  if (docNumber.startsWith('ND/')) return 'ND';
  if (docNumber.startsWith('NC/')) return 'NC';

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
  if (docCode === 'RC' || docCode === 'VD' || docCode === 'PAG' || docCode === 'ND' || docCode === 'NC') {
    return { type: refType, number: refNumber, role: 'source' };
  }
  if (docCode === 'FT' || docCode === 'FP' || docCode === 'FTF') {
    return { type: refType, number: refNumber, role: 'generated' };
  }
  return { type: refType, number: refNumber, role: 'source' };
}

export function formatDocumentReferenceDisplay(
  row: DocumentSourceReference,
  docCode?: string,
): string {
  const code = docCode || resolveDocumentFilterCode(row);

  // Fatura de fornecedor: mostrar Doc. Externo da compra (não o PAG gerado ao pagar)
  if (code === 'FTF') {
    const external = String(row.external_document ?? '').trim();
    if (external) return external;
    return '';
  }

  const linked = getLinkedDocumentReference(row);
  if (!linked) return '';

  const kindLabel = sourceDocKindLabel(linked.type);

  if (code === 'RC' || code === 'VD' || code === 'PAG' || code === 'ND' || code === 'NC') {
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
