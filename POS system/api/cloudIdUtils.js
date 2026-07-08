import { validate as uuidValidate, version as uuidVersion, v4 as uuidv4 } from 'uuid';

export function isUuidString(value) {
  if (value == null || typeof value !== 'string') return false;
  const trimmed = value.trim();
  return uuidValidate(trimmed) && uuidVersion(trimmed) === 4;
}

export function requireProductCloudId(cloudId, context = 'sync') {
  if (!isUuidString(cloudId)) {
    throw new Error(
      `cloud_id em falta ou invalido (${context}). Cada produto precisa de um UUID valido para sincronizar com a cloud.`
    );
  }
  return cloudId.trim();
}

export { uuidv4 };
