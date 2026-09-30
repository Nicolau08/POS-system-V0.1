/**
 * Etapa 1F.6 (item 20) — expiração real da licença offline: usa o MESMO
 * gerador de fixtures que o license-console usa para prova de
 * interoperabilidade (license-console/scripts/gen-offline-license-fixture.mjs,
 * que assina com o código de produção real signOfflineLicense()), com
 * expires_at já no passado. Confirma que a verificação LOCAL (nunca uma
 * "resgate" via rede) reporta EXPIRED — nunca um fallback legado, nunca uma
 * query ao cloud para "salvar" a licença. Não precisa de bootstrap/activation
 * token real (não consome o rate limit de /device/bootstrap).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, mock } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fixtureScript = path.join(repoRoot, 'license-console', 'scripts', 'gen-offline-license-fixture.mjs');
const shouldRun = fs.existsSync(fixtureScript);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

function genFixture(overrides) {
  const out = execFileSync(process.execPath, [fixtureScript, JSON.stringify(overrides)], {
    cwd: path.join(repoRoot, 'license-console'),
  });
  return JSON.parse(out.toString('utf8'));
}

test(
  'licença expirada (artefacto Ed25519 real, expires_at no passado): verificação local -> EXPIRED, sem resgate via rede',
  { skip: !shouldRun && 'gen-offline-license-fixture.mjs não encontrado' },
  async () => {
    const { verifyOfflineLicense } = await import('../../lib/licensing/offlineLicense.js');
    const { installOfflineLicense, getOfflineLicenseState } = await import('../../electron/deviceAuth/offlineLicenseClient.js');

    const machineId = `machine-1f6-expiry-${crypto.randomBytes(3).toString('hex')}`;
    const pastExpiry = new Date(Date.now() - 60_000).toISOString(); // 1 minuto no passado — já expirada.

    const fixture = genFixture({
      keyId: 'itest-1f6-expiry-key',
      payload: {
        tenant_id: 'itest-1f6-expiry-tenant',
        license_id: 'itest-1f6-expiry-license',
        machine_id: machineId,
        expires_at: pastExpiry,
      },
    });

    const resolvePem = (kid) => (kid === fixture.keyId ? fixture.publicKeyPem : null);

    // Confirma primeiro que a ASSINATURA em si é genuína (Ed25519 real,
    // verificada pelo código de produção real) — só DEPOIS testamos a
    // expiração, para nunca confundir "assinatura inválida" com "expirada".
    const rawVerify = verifyOfflineLicense(fixture.envelope, resolvePem, { machineId });
    console.log('[item 20] verificação directa do artefacto expirado:', JSON.stringify(rawVerify));
    assert.equal(rawVerify.ok, false, 'um artefacto com expires_at no passado NUNCA pode verificar como válido');
    assert.equal(rawVerify.kind, 'EXPIRED', `esperava kind=EXPIRED, veio: ${JSON.stringify(rawVerify)}`);

    // Confirma também pelo caminho real de armazenamento local (o que o POS
    // realmente usa no arranque) — instala, depois relê do disco puramente localmente.
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-expiry-'));
    try {
      // installOfflineLicense() do electron/deviceAuth/offlineLicenseClient.js
      // é o caminho real chamado após uma emissão bem-sucedida — mas ele
      // próprio verifica antes de gravar, por isso instalar um artefacto já
      // expirado deve FALHAR a instalação (nunca gravar estado inválido).
      const installed = installOfflineLicense({ envelope: fixture.envelope, userDataPath, resolvePublicKeyPem: resolvePem, machineId });
      console.log('[item 20] tentativa de instalar artefacto já expirado:', JSON.stringify(installed));
      assert.equal(installed.ok, false, 'nunca deve ser possível instalar um artefacto já expirado');

      const state = getOfflineLicenseState({ userDataPath, resolvePublicKeyPem: resolvePem, machineId });
      assert.notEqual(state.ok, true, 'sem instalação bem-sucedida, o estado local nunca pode reportar VALID');
    } finally {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  },
);
