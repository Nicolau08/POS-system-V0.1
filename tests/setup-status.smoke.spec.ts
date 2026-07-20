import { test, expect } from '@playwright/test';
import { API_BASE, isApiAvailable } from './helpers/smoke-env';

const SETUP_STATUS_FIELDS = [
  'dbPath',
  'dbExists',
  'hadDatabaseOnBoot',
  'tenantExists',
  'tenantId',
  'tenantName',
  'adminPasswordSet',
  'licenseActivated',
  'printerType',
  'setupCompleted',
  'setupCompletedAt',
  'isSetupComplete',
  'setupConfigPath',
  'licensePath',
  'requiresWizard',
  'licenseExpired',
  'licenseExpiresAt',
] as const;

test.describe('Smoke API: GET /setup/status', () => {
  test.beforeAll(async () => {
    if (!(await isApiAvailable())) {
      test.skip(true, `API indisponível em ${API_BASE} (npm run api:dev)`);
    }
  });

  test('responde 200 com envelope success e campos de setup', async ({ request }) => {
    const res = await request.get(`${API_BASE}/setup/status`, {
      headers: { 'Cache-Control': 'no-store' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ success: true, error: null });
    expect(body.data).toBeTruthy();
    expect(typeof body.data).toBe('object');

    for (const key of SETUP_STATUS_FIELDS) {
      expect(body.data).toHaveProperty(key);
    }

    expect(typeof body.data.dbExists).toBe('boolean');
    expect(typeof body.data.tenantExists).toBe('boolean');
    expect(typeof body.data.requiresWizard).toBe('boolean');
    expect(typeof body.data.isSetupComplete).toBe('boolean');
    expect(typeof body.data.licenseExpired).toBe('boolean');
  });
});
