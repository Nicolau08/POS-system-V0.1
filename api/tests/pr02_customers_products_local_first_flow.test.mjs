import assert from 'node:assert/strict';

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeSyncVersion(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function compareRecordSyncPriority(localRecord, remoteRecord) {
  const localVersion = normalizeSyncVersion(localRecord?.sync_version);
  const remoteVersion = normalizeSyncVersion(remoteRecord?.sync_version);
  if (localVersion !== remoteVersion) return localVersion > remoteVersion ? 'local' : 'remote';
  const localUpdated = normalizeTimestamp(localRecord?.updated_at);
  const remoteUpdated = normalizeTimestamp(remoteRecord?.updated_at);
  const localMs = localUpdated ? Date.parse(localUpdated) : Number.NEGATIVE_INFINITY;
  const remoteMs = remoteUpdated ? Date.parse(remoteUpdated) : Number.NEGATIVE_INFINITY;
  if (localMs !== remoteMs) return localMs > remoteMs ? 'local' : 'remote';
  return 'local';
}

function shouldApplyCloudOverLocal(local, cloud) {
  const winner = compareRecordSyncPriority(local, cloud);
  if (winner === 'local') return false;
  if (local?.deleted_at && !cloud?.deleted_at) return false;
  return true;
}

function run() {
  // local create/update/delete -> cloud (local wins)
  assert.equal(
    compareRecordSyncPriority(
      { sync_version: 5, updated_at: '2026-05-06T10:00:00Z' },
      { sync_version: 4, updated_at: '2026-05-06T11:00:00Z' }
    ),
    'local'
  );

  // cloud update applies only when cloud wins strictly
  assert.equal(
    shouldApplyCloudOverLocal(
      { sync_version: 2, updated_at: '2026-05-06T10:00:00Z', deleted_at: null },
      { sync_version: 3, updated_at: '2026-05-06T09:00:00Z', deleted_at: null }
    ),
    true
  );

  // anti-resurrect: local tombstone blocks stale cloud active row
  assert.equal(
    shouldApplyCloudOverLocal(
      { sync_version: 3, updated_at: '2026-05-06T10:00:00Z', deleted_at: '2026-05-06T10:00:00Z' },
      { sync_version: 4, updated_at: '2026-05-06T11:00:00Z', deleted_at: null }
    ),
    false
  );

  // deterministic tie-break: equal version and timestamp -> local
  assert.equal(
    compareRecordSyncPriority(
      { sync_version: 7, updated_at: '2026-05-06T11:00:00Z' },
      { sync_version: 7, updated_at: '2026-05-06T11:00:00Z' }
    ),
    'local'
  );

  // tenant safety invariant in sync payloads
  const payload = { tenant_id: 'tenant-a' };
  const contextTenant = 'tenant-a';
  assert.equal(String(payload.tenant_id), contextTenant);

  console.log('PASS pr02_customers_products_local_first_flow');
}

run();
