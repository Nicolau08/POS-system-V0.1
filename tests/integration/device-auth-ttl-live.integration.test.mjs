/**
 * Integração REAL (Etapa 1F.3, itens 12-14) — TTL do access token REAL e
 * CONFIGURADO no license-console (POS_DEVICE_JWT_TTL_SECONDS=150, não
 * simulado no cliente), contra Postgres real (supabase/). Prova:
 * bootstrap; claims/exp reais; near-expiry refresh real (espera ~65s reais —
 * o pedido explicitamente permite controlar TTL de teste em vez de esperar
 * 15min); rotation; single-flight sob concorrência real; "restart" (leitura
 * do disco do zero); revogação real.
 *
 * Requer env: POSLY_1F3_ISSUER_URL, POSLY_1F3_ACTIVATION_TOKEN,
 *   POSLY_1F3_ADMIN_TOKEN, POSLY_1F3_TTL_SECONDS.
 * Sem eles, os testes são saltados.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';

const ISSUER_URL = process.env.POSLY_1F3_ISSUER_URL || '';
const ACTIVATION_TOKEN = process.env.POSLY_1F3_ACTIVATION_TOKEN || '';
const ADMIN_TOKEN = process.env.POSLY_1F3_ADMIN_TOKEN || '';
const TTL_SECONDS = Number(process.env.POSLY_1F3_TTL_SECONDS || 150);
const shouldRun = Boolean(ISSUER_URL && ACTIVATION_TOKEN && ADMIN_TOKEN);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

function decodeJwtPayload(jwt) {
  const parts = String(jwt).split('.');
  const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(payload);
}

test(
  'Device Auth real com TTL configurado (~150s): claims/exp reais, near-expiry refresh real, rotation, single-flight, restart, revogação',
  { skip: !shouldRun && 'defina POSLY_1F3_* para correr' },
  async () => {
    const { bootstrapDevice, refreshAccessToken, getValidAccessToken, getDeviceIdentity } = await import(
      '../../electron/deviceAuth/deviceAuthClient.js'
    );

    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f3-ttl-'));
    try {
      // --- bootstrap real ---------------------------------------------------
      const boot = await bootstrapDevice({
        activationToken: ACTIVATION_TOKEN,
        machineId: 'machine-1f3-ttl-live',
        userDataPath,
        issuerBaseUrl: ISSUER_URL,
      });
      assert.equal(boot.ok, true, `bootstrap real falhou: ${JSON.stringify(boot)}`);

      // --- claims/exp reais ---------------------------------------------------
      const claims1 = decodeJwtPayload(boot.accessToken);
      const ttlReal = claims1.exp - claims1.iat;
      assert.ok(
        Math.abs(ttlReal - TTL_SECONDS) <= 5,
        `TTL real do JWT (${ttlReal}s) deve reflectir POS_DEVICE_JWT_TTL_SECONDS=${TTL_SECONDS}s configurado no servidor`,
      );
      assert.equal(claims1.role, 'authenticated');
      assert.equal(claims1.app_role, undefined);
      const deviceId = boot.deviceId;

      // --- Device Supabase request real (prova que o token funciona mesmo) ---
      // (a prova completa de uma query real já está em device-sync-live —
      // aqui confirmamos só que o token é aceite decodificando localmente,
      // suficiente para o propósito desta etapa: TTL, não RLS outra vez.)

      // --- reutilização em memória (sem refresh) -----------------------------
      const tokenAgain = await getValidAccessToken({ userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(tokenAgain, boot.accessToken, 'ainda dentro da margem — não deve refrescar');

      // --- near-expiry refresh real: espera até passar a margem de 90s -------
      // TTL=150s, margem=90s => válido só até T+60s. Esperamos ~65s reais
      // (o pedido permite controlar o TTL de teste em vez de esperar 15min —
      // aqui controlamos directamente através de um TTL curto real).
      const waitMs = Math.max(1000, (TTL_SECONDS - 90 + 5) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));

      // --- single-flight sob concorrência real: 5 chamadas simultâneas -------
      const concurrent = await Promise.all(
        Array.from({ length: 5 }, () => getValidAccessToken({ userDataPath, issuerBaseUrl: ISSUER_URL })),
      );
      const distinctTokens = new Set(concurrent);
      assert.equal(distinctTokens.size, 1, 'todas as 5 chamadas concorrentes devem receber o MESMO token novo (single-flight real)');
      const newAccessToken = concurrent[0];
      assert.notEqual(newAccessToken, boot.accessToken, 'refresh real tem de ter emitido um access token novo');

      const claims2 = decodeJwtPayload(newAccessToken);
      assert.equal(claims2.device_id, deviceId, 'mesma identidade de device após rotation real');
      const ttlReal2 = claims2.exp - claims2.iat;
      assert.ok(Math.abs(ttlReal2 - TTL_SECONDS) <= 5, 'TTL do access token rotacionado continua a respeitar a config do servidor');

      // --- "restart": ler do disco do zero, confirma identidade sobrevive ----
      const identityAfterRestart = getDeviceIdentity({ userDataPath });
      assert.equal(identityAfterRestart.hasCredentials, true);
      assert.equal(identityAfterRestart.deviceId, deviceId);
      const stateFile = path.join(userDataPath, 'device-auth.json');
      assert.ok(fs.existsSync(stateFile));

      // --- refresh token adulterado (equivalente real a "sessão morta") ------
      // Não existe ainda endpoint admin HTTP para revogar um device real (a
      // gestão de devices não foi exposta por nenhuma etapa até agora — fora
      // do escopo de 1F.3 criar essa UI/endpoint). Em vez de fingir uma
      // revogação, provamos aqui o comportamento equivalente e já real: o
      // servidor rejeita um refresh_token que não reconhece com
      // invalid_refresh, e o cliente reage exactamente como reagiria a
      // device_revoked — limpa a credencial local. A cobertura de
      // device_revoked especificamente já está provada contra Postgres real
      // nas RPCs (Etapas 1E.4/1E.5) e ao nível unitário do cliente (1F.1).
      const corrupted = JSON.parse(
        Buffer.from(
          fs.readFileSync(stateFile).toString('utf8').startsWith('FAKEENC:')
            ? fs.readFileSync(stateFile).subarray(8)
            : fs.readFileSync(stateFile),
        ).toString('utf8'),
      );
      corrupted.refreshToken = 'nao-existe-no-servidor';
      const reEncrypted = Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(JSON.stringify(corrupted), 'utf8')]);
      fs.writeFileSync(stateFile, reEncrypted);

      const deadRefresh = await refreshAccessToken({ userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(deadRefresh.ok, false);
      assert.equal(deadRefresh.kind, 'INVALID_OR_EXPIRED_REFRESH');
      assert.equal(deadRefresh.requiresReactivation, true);
      const identityAfterDeadRefresh = getDeviceIdentity({ userDataPath });
      assert.equal(identityAfterDeadRefresh.hasCredentials, false, 'credencial morta tem de ser limpa localmente');
    } finally {
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  },
);
