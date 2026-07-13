function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function maxLen(value, len) {
  return String(value ?? '').length <= len;
}

export function validateCategoryBody(body) {
  if (!isObject(body)) return 'payload invalido';
  if (!body.name || !String(body.name).trim()) return 'name e obrigatorio';
  if (!maxLen(body.name, 120)) return 'name excede limite';
  return true;
}

export function validateClienteBody(body) {
  if (!isObject(body)) return 'payload invalido';
  if (!body.name || !String(body.name).trim()) return 'name e obrigatorio';
  if (!body.phone || !String(body.phone).trim()) return 'phone e obrigatorio';
  if (!maxLen(body.name, 160)) return 'name excede limite';
  if (!maxLen(body.phone, 50)) return 'phone excede limite';
  if (body.email != null && !maxLen(body.email, 190)) return 'email excede limite';
  return true;
}

export function validatePaymentMethodBody(body) {
  if (!isObject(body)) return 'payload invalido';
  if (!body.name || !String(body.name).trim()) return 'name e obrigatorio';
  if (!body.code || !String(body.code).trim()) return 'code e obrigatorio';
  if (!maxLen(body.name, 120) || !maxLen(body.code, 50)) return 'campos excedem limite';
  return true;
}

export function validateApproveCotacaoBody(body) {
  if (!isObject(body)) return 'payload invalido';
  if (!String(body.sourceId ?? '').trim()) return 'sourceId obrigatorio';
  if (!String(body.approvedDocType ?? '').trim()) return 'approvedDocType obrigatorio';
  if (!String(body.approvedDocumentNumber ?? '').trim()) return 'approvedDocumentNumber obrigatorio';
  return true;
}

export function validateRegisterDocumentPaymentBody(body) {
  if (!isObject(body)) return 'payload invalido';
  if (!String(body.documentNumber ?? '').trim()) return 'documentNumber obrigatorio';
  if (!String(body.paymentMethod ?? '').trim()) return 'paymentMethod obrigatorio';
  return true;
}

export function validateDocumentPaymentPreviewQuery(query) {
  if (!String(query?.documentNumber ?? '').trim()) return 'documentNumber obrigatorio';
  return true;
}

export function validateDocumentosNextNumberQuery(query) {
  if (!String(query?.prefix ?? '').trim()) return 'prefix obrigatorio';
  return true;
}

export function validateDocumentoBody(body) {
  if (!isObject(body)) return 'payload invalido';
  if (!String(body.prefix ?? '').trim()) return 'prefix obrigatorio';
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 200) return 'items excede limite';
  return true;
}

export function validatePermissionRulesBody(body) {
  const payload = body?.rules ?? body;
  if (!Array.isArray(payload)) return 'payload.rules precisa ser um array';
  if (payload.length > 500) return 'rules excede limite';
  return true;
}

export function validateCompanyProfileBody(body) {
  if (!isObject(body)) return 'payload invalido';
  if (!String(body.name ?? '').trim()) return 'name e obrigatorio';
  if (!String(body.country ?? '').trim()) return 'country e obrigatorio';
  if (!maxLen(body.name, 200)) return 'name excede limite';
  return true;
}
