import { test, expect } from '@playwright/test';
import { isWebAvailable, hasSupabaseEnv } from './helpers/smoke-env';

test.describe('Smoke: consola /license-admin', () => {
  test.beforeAll(async () => {
    if (!(await isWebAvailable())) {
      test.skip(true, 'Next.js indisponível (npm run dev na porta POS_BASE_URL)');
    }
  });

  test('página mostra título da consola', async ({ page }) => {
    await page.goto('/license-admin');
    await expect(page.getByRole('heading', { name: /Consola de licenças POSly/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('GET /api/license-issuer/store exige Bearer', async ({ request }) => {
    const res = await request.get('/api/license-issuer/store');
    expect([401, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('GET /api/license-issuer/store com Bearer inválido → 401', async ({ request }) => {
    const res = await request.get('/api/license-issuer/store', {
      headers: { Authorization: 'Bearer mock-invalid-token' },
    });
    if (res.status() === 503) {
      test.skip(true, 'LICENSE_ISSUER_ADMIN_TOKEN ou segredos em falta no servidor');
    }
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/inválido|ausente/i);
  });

  test('GET /api/license-issuer/store com token de teste', async ({ request }) => {
    const token = String(process.env.LICENSE_ISSUER_ADMIN_TOKEN || '').trim();
    if (!token) {
      test.skip(true, 'Defina LICENSE_ISSUER_ADMIN_TOKEN para validar Bearer');
    }
    const res = await request.get('/api/license-issuer/store', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() === 503 && !hasSupabaseEnv()) {
      test.skip(true, 'Supabase não configurado — ignorado em CI sem credenciais');
    }
    expect([200, 503, 502]).toContain(res.status());
  });
});
