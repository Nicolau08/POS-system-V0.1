/**
 * Etapa 1F.4 (itens 18, 19, 32, 33) — varre artefactos de build (app.asar,
 * resources/, o instalador NSIS, ou qualquer directório) à procura de:
 *   1. um valor EXACTO proibido (ex.: canary de teste ou uma chave real
 *      comprometida), passado via --value ou POS_SCAN_FORBIDDEN_VALUE;
 *   2. nomes de campo/credencial proibidos (SUPABASE_SERVICE_ROLE_KEY e
 *      aliases antigos conhecidos);
 *   3. marcadores de chave privada (BEGIN ... PRIVATE KEY e equivalentes);
 *   4. heurística de JWT (eyJ...) — apenas como COMPLEMENTO informativo,
 *      nunca como prova principal (falsos positivos são esperados: JWTs de
 *      teste, anon keys legítimas, etc.).
 *
 * Varre ficheiros binários como bytes (Buffer.includes) — funciona
 * directamente sobre um app.asar sem o extrair primeiro, e sobre o próprio
 * .exe do instalador NSIS.
 *
 * Uso:
 *   node scripts/scan-packaged-secrets.mjs <caminho1> [<caminho2> ...] \
 *     [--value SEGREDO_EXACTO_A_PROCURAR]
 *
 * Sai com exit code 1 (FAIL) se qualquer ocorrência proibida (1-3) for
 * encontrada. A heurística JWT (4) nunca falha o processo sozinha.
 */
import fs from 'fs';
import path from 'path';

const FORBIDDEN_FIELD_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
  'serviceRoleKey',
  'legacy_service_role',
  'SERVICE_ROLE_KEY',
  // Etapa 1F.5c: segredo de assinatura HMAC da licença local (removido do POS).
  'POS_LICENSE_HMAC_SECRET',
  'LICENSE_HMAC_SECRET',
];

const PRIVATE_KEY_MARKERS = [
  'BEGIN PRIVATE KEY',
  'BEGIN EC PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN ENCRYPTED PRIVATE KEY',
  'BEGIN DSA PRIVATE KEY',
];

const JWT_HEURISTIC = 'eyJ';

// Propositadamente NÃO ignora node_modules: o objectivo deste scanner é
// precisamente inspeccionar artefactos de build empacotados (app.asar,
// app.asar.unpacked, resources/web/node_modules do standalone Next), onde
// dependências de terceiros também são copiadas para o produto final.
const SKIP_DIR_NAMES = new Set(['.git']);

function parseArgs(argv) {
  const paths = [];
  let value = process.env.POS_SCAN_FORBIDDEN_VALUE || '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--value') {
      value = argv[i + 1] || '';
      i += 1;
    } else {
      paths.push(argv[i]);
    }
  }
  return { paths, value };
}

function listFilesRecursive(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let stat;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIR_NAMES.has(path.basename(current))) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(current);
      } catch {
        continue;
      }
      for (const entry of entries) stack.push(path.join(current, entry));
    } else if (stat.isFile()) {
      out.push(current);
    }
  }
  return out;
}

function resolveTargets(inputPaths) {
  const files = [];
  for (const p of inputPaths) {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      console.warn(`[scan-packaged-secrets] caminho inexistente, a ignorar: ${p}`);
      continue;
    }
    if (stat.isDirectory()) files.push(...listFilesRecursive(p));
    else files.push(p);
  }
  return files;
}

function scanFile(filePath, forbiddenValue) {
  const findings = [];
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    return findings;
  }

  if (forbiddenValue && buf.includes(Buffer.from(forbiddenValue, 'utf8'))) {
    findings.push({ kind: 'EXACT_FORBIDDEN_VALUE', detail: '(valor não impresso)' });
  }
  for (const name of FORBIDDEN_FIELD_NAMES) {
    if (buf.includes(Buffer.from(name, 'utf8'))) {
      findings.push({ kind: 'FORBIDDEN_FIELD_NAME', detail: name });
    }
  }
  for (const marker of PRIVATE_KEY_MARKERS) {
    if (buf.includes(Buffer.from(marker, 'utf8'))) {
      findings.push({ kind: 'PRIVATE_KEY_MARKER', detail: marker });
    }
  }
  if (buf.includes(Buffer.from(JWT_HEURISTIC, 'utf8'))) {
    findings.push({ kind: 'JWT_HEURISTIC_INFO', detail: 'contém "eyJ" — complemento informativo apenas' });
  }
  return findings;
}

function main() {
  const { paths, value } = parseArgs(process.argv.slice(2));
  if (paths.length === 0) {
    console.error('Uso: node scripts/scan-packaged-secrets.mjs <caminho...> [--value SEGREDO]');
    process.exit(2);
  }

  const files = resolveTargets(paths);
  console.log(`[scan-packaged-secrets] A varrer ${files.length} ficheiro(s) em ${paths.join(', ')}`);
  if (value) console.log('[scan-packaged-secrets] valor exacto proibido: definido (não impresso)');

  let failCount = 0;
  let infoCount = 0;
  for (const file of files) {
    const findings = scanFile(file, value);
    for (const finding of findings) {
      const rel = path.relative(process.cwd(), file);
      if (finding.kind === 'JWT_HEURISTIC_INFO') {
        infoCount += 1;
        console.log(`[INFO] ${rel}: ${finding.detail}`);
        continue;
      }
      failCount += 1;
      console.error(`[FAIL] ${rel}: ${finding.kind} — ${finding.detail}`);
    }
  }

  console.log(
    `[scan-packaged-secrets] Concluído. ${failCount} ocorrência(s) proibida(s), ${infoCount} heurística(s) JWT informativa(s) (não bloqueiam).`,
  );
  process.exit(failCount > 0 ? 1 : 0);
}

main();
