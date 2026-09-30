#!/usr/bin/env node
/**
 * Pilot Gate — prova de runtime empacotado (nunca mais um `jose` em falta no
 * VM sem ninguém detectar antes de instalar): extrai o app.asar já construído
 * e tenta importar, a sério, os módulos Electron-main que este diagnóstico
 * introduziu — usando SÓ o node_modules que ficou dentro do pacote, nunca o
 * node_modules de desenvolvimento da raiz do repo.
 *
 * A única falha aceitável é `ERR_MODULE_NOT_FOUND` para o próprio pacote
 * `electron` (nunca resolvível fora de um processo Electron real — não é o
 * que este script está a provar). Qualquer OUTRO módulo em falta (como
 * aconteceu com `jose`) falha o script com exit code 1.
 *
 * Uso: node scripts/verify-packaged-electron-modules.mjs <caminho-para-app.asar>
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const asarPath = process.argv[2];
if (!asarPath || !fs.existsSync(asarPath)) {
  console.error('Uso: node scripts/verify-packaged-electron-modules.mjs <caminho-para-app.asar>');
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(pathToFileURL(path.join(repoRoot, 'package.json')));
const asar = require('@electron/asar');

const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-packaged-runtime-check-'));
asar.extractAll(asarPath, extractDir);

// Módulos Electron-main que este diagnóstico introduziu — os candidatos mais
// prováveis a partir daqui a esconderem uma dependência não empacotada.
const MODULES_TO_CHECK = [
  'electron/deviceAuth/deviceAuthClient.js',
  'electron/deviceAuth/deviceAuthBridge.js',
  'electron/deviceAuth/deviceAuthStorage.js',
];

let failures = 0;

for (const rel of MODULES_TO_CHECK) {
  const abs = path.join(extractDir, rel);
  if (!fs.existsSync(abs)) {
    console.error(`FALTA_NO_PACOTE: ${rel}`);
    failures += 1;
    continue;
  }
  try {
    await import(pathToFileURL(abs).href);
    console.log(`OK: ${rel}`);
  } catch (err) {
    const isMissingModule = err?.code === 'ERR_MODULE_NOT_FOUND';
    const missingSpecifier = isMissingModule ? String(err.message).match(/Cannot find package '([^']+)'/)?.[1] : null;
    if (isMissingModule && missingSpecifier === 'electron') {
      console.log(`OK (electron nunca resolvível fora do Electron real — esperado): ${rel}`);
      continue;
    }
    console.error(`FALHA REAL em ${rel}: ${err?.code ?? ''} ${err?.message ?? err}`);
    failures += 1;
  }
}

fs.rmSync(extractDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} módulo(s) falharam a importar a partir do pacote — dependência em falta no runtime empacotado.`);
  process.exit(1);
}
console.log('\nTodos os módulos Electron-main verificados resolvem as suas dependências dentro do pacote.');
