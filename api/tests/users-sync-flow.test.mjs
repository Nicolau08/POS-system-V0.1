import assert from 'node:assert/strict';
import { compareRecordSyncPriority } from '../syncService.js';

function shouldApplyCloudToLocal(localRow, cloudRow) {
  return compareRecordSyncPriority(
    { sync_version: localRow.sync_version, updated_at: localRow.updated_at },
    { sync_version: cloudRow.sync_version, updated_at: cloudRow.updated_at }
  ) === 'remote';
}

function run() {
  // local create/update/delete -> cloud (local wins on equal/final tie)
  assert.equal(
    shouldApplyCloudToLocal(
      { sync_version: 5, updated_at: '2026-05-06T08:00:00.000Z' },
      { sync_version: 4, updated_at: '2026-05-06T09:00:00.000Z' }
    ),
    false
  );

  // cloud create/update/delete -> local (apply when cloud is strictly newer)
  assert.equal(
    shouldApplyCloudToLocal(
      { sync_version: 2, updated_at: '2026-05-06T08:00:00.000Z' },
      { sync_version: 3, updated_at: '2026-05-06T07:00:00.000Z' }
    ),
    true
  );

  // conflict local vs cloud (tie version -> newer updated_at wins)
  assert.equal(
    shouldApplyCloudToLocal(
      { sync_version: 7, updated_at: '2026-05-06T10:00:00.000Z' },
      { sync_version: 7, updated_at: '2026-05-06T11:00:00.000Z' }
    ),
    true
  );

  // final tie => local priority
  assert.equal(
    shouldApplyCloudToLocal(
      { sync_version: 7, updated_at: '2026-05-06T11:00:00.000Z' },
      { sync_version: 7, updated_at: '2026-05-06T11:00:00.000Z' }
    ),
    false
  );

  // anti-resurrect: local deleted more recent must not be overwritten by stale cloud active row
  assert.equal(
    shouldApplyCloudToLocal(
      { sync_version: 10, updated_at: '2026-05-06T12:00:00.000Z', deleted_at: '2026-05-06T12:00:00.000Z' },
      { sync_version: 8, updated_at: '2026-05-06T09:00:00.000Z', deleted_at: null }
    ),
    false
  );

  console.log('users-sync-flow.test.mjs: PASS');
}

run();
