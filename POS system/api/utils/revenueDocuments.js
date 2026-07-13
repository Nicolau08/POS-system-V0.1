export function resolveDocCode(doc) {
  const docType = String(doc?.doc_type ?? '').trim().toUpperCase();
  const docNumber = String(doc?.document_number ?? '').trim().toUpperCase();

  if (docType === 'VD' || docType === 'VENDA') return 'VD';
  if (docType === 'FT' || docType === 'FATURA') return 'FT';
  if (docType === 'FP' || docType.includes('PROFORMA') || docType.includes('COTAC')) return 'FP';
  if (docType === 'RC' || docType === 'RECIBO') return 'RC';
  if (docType === 'NC') return 'NC';
  if (docType === 'TK' || docType === 'TICKET') return 'TK';

  if (docNumber.startsWith('VD/')) return 'VD';
  if (docNumber.startsWith('FT/')) return 'FT';
  if (docNumber.startsWith('FP/')) return 'FP';
  if (docNumber.startsWith('RC/') || docNumber.startsWith('PBNK')) return 'RC';
  if (docNumber.startsWith('NC/')) return 'NC';
  if (docNumber.startsWith('TK/')) return 'TK';

  return docType || 'VD';
}

export function isFtPaidViaReceipt(doc) {
  const code = resolveDocCode(doc);
  if (code !== 'FT') return false;
  const refType = String(doc?.approved_document_type ?? '').trim().toUpperCase();
  if (refType === 'RC' || refType === 'RECIBO') return true;
  const refNum = String(doc?.approved_document_number ?? '').trim().toUpperCase();
  return refNum.startsWith('RC/') || refNum.startsWith('PBNK');
}

export function isPendingContaCorrenteFt(doc) {
  const code = resolveDocCode(doc);
  if (code !== 'FT') return false;
  const status = String(doc?.status ?? '').trim().toLowerCase();
  const payment = String(doc?.payment_method ?? '').toLowerCase().replace(/-/g, ' ');
  return status === 'pending' && payment.includes('conta corrente');
}

/**
 * Entrada de caixa na data de registo no sistema (sessão):
 * - VD/TK: venda imediata
 * - RC: pagamento registado hoje (mesmo que a FT seja antiga)
 * - FT: só se paga no momento (não conta corrente nem paga via RC)
 */
export function isCashInflowDocument(doc) {
  const code = resolveDocCode(doc);
  if (code === 'FP' || code === 'NC' || code === 'INV') return false;
  const docType = String(doc?.doc_type ?? '').toLowerCase();
  if (docType.includes('invent')) return false;

  if (code === 'RC') return true;
  if (code === 'VD' || code === 'TK') return true;
  if (code === 'FT') {
    const payment = String(doc?.payment_method ?? '').toLowerCase().replace(/-/g, ' ');
    if (payment.includes('conta corrente')) return false;
    if (isFtPaidViaReceipt(doc)) return false;
    return true;
  }
  return false;
}

/** @deprecated Use isCashInflowDocument */
export function isRevenueDocument(doc) {
  return isCashInflowDocument(doc);
}

export function isCompletedCashInflow(doc) {
  if (!isCashInflowDocument(doc)) return false;
  const status = String(doc?.status ?? '').trim().toLowerCase();
  if (status === 'cancelled' || status === 'cancelado') return false;
  return status === 'completed' || status === 'pago' || status === 'approved' || status === 'aprovado';
}

/** @deprecated Use isCompletedCashInflow */
export function isCompletedRevenue(doc) {
  return isCompletedCashInflow(doc);
}

export function matchesRevenueStatusFilter(doc, selectedStatus = 'all') {
  const normalized = String(selectedStatus ?? 'all').trim().toLowerCase();
  if (normalized && normalized !== 'all') {
    return String(doc?.status ?? '').trim().toLowerCase() === normalized;
  }
  return isCompletedCashInflow(doc);
}

export function filterCashInflowDocuments(docs, selectedStatus = 'all') {
  return (docs ?? []).filter(isCashInflowDocument).filter((doc) => matchesRevenueStatusFilter(doc, selectedStatus));
}

/** @deprecated Use filterCashInflowDocuments */
export function filterRevenueDocuments(docs, selectedStatus = 'all') {
  return filterCashInflowDocuments(docs, selectedStatus);
}
