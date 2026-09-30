#!/usr/bin/env node
/**
 * Pilot Gate — Fase A1: PILOT TENANT REPAIR, dry-run only.
 *
 * Esta ferramenta é FISICAMENTE INCAPAZ de escrever na BD alvo:
 *  1. Abre a ligação SQLite com a flag OPEN_READONLY do próprio driver (nunca OPEN_READWRITE).
 *  2. Corre `PRAGMA query_only = ON` a seguir a abrir (defesa a nível do motor SQLite).
 *  3. Todas as queries passam por assertReadOnlySql() (api/services/localTenantMap.service.js) — só
 *     SELECT/WITH de um único statement, sem DDL/DML/PRAGMA/ATTACH.
 * As três camadas são independentes; qualquer uma sozinha já impediria uma escrita.
 *
 * NUNCA importa api/database.js nem api/dbUtils.js nem api/syncQueue.js nem
 * api/services/setup.service.js — todos abrem/tocam a BD com efeitos secundários de escrita só por
 * serem importados (top-level `import db from '../database.js'`). Esta ferramenta abre a SUA PRÓPRIA
 * ligação, à parte, sempre read-only.
 *
 * Uso:
 *   node api/scripts/pilot-tenant-repair.mjs --dry-run [--db <caminho>] [--json <ficheiro-saida>]
 *
 * --apply NÃO EXISTE nesta fase — é rejeitado explicitamente, antes de qualquer ligação à BD.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

/** import() dinâmico de um caminho absoluto exige um URL file:// no Windows — nunca um path cru. */
const importAbs = (absPath) => import(pathToFileURL(absPath).href);

function parseArgs(argv) {
  const args = { dryRun: false, apply: false, db: null, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--apply') args.apply = true;
    else if (a === '--db') args.db = argv[++i] ?? null;
    else if (a === '--json') args.json = argv[++i] ?? null;
  }
  return args;
}

function fail(message, code = 2) {
  console.error(`[pilot-tenant-repair] ${message}`);
  process.exit(code);
}

/** Mesma resolução de env que api/utils/dbEncryption.js#getDbEncryptionKey — duplicada aqui para nunca importar esse módulo indirectamente através de um caminho que arraste database.js. dbEncryption.js em si não tem esse problema, mas importamo-lo directamente mais abaixo mesmo assim (é seguro: só fs/path/createRequire). */
function resolveDbPath(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.POS_DB_PATH) return path.resolve(String(process.env.POS_DB_PATH));
  return path.join(repoRoot, 'api', 'database.db');
}

function sha256OfFileIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/**
 * `db` é o ficheiro com o CONTEÚDO persistido — tem de ficar byte-a-byte idêntico.
 *
 * `wal`/`shm`: abrir uma ligação read-only a uma BD em journal_mode=WAL pode legitimamente fazer o
 * próprio SQLite CRIAR um `-wal` de 0 bytes e/ou um `-shm` (índice de memória partilhada, sempre
 * seguro apagar/recriar) que não existiam antes — nenhum dos dois contém uma única frame de escrita
 * real quando o `-wal` tem 0 bytes. Por isso normalizamos: ausente OU 0 bytes conta como "sem WAL
 * pendente" (equivalente); só um `-wal` com bytes a mais conta como mudança real de conteúdo.
 */
function fingerprintDbFiles(dbPath) {
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  const shmSize = fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0;
  return {
    db: sha256OfFileIfExists(dbPath),
    wal_nonempty: walSize > 0 ? sha256OfFileIfExists(walPath) : null,
    shm_informational_only: sha256OfFileIfExists(shmPath),
  };
}

function contentUnchanged(before, after) {
  return before.db === after.db && before.wal_nonempty === after.wal_nonempty;
}

/** Mesma resolução de caminho que setup.service.js#resolveOfflineLicensePath — duplicada para NUNCA
 *  importar setup.service.js (que faz `import db from '../database.js'` no topo, com efeitos
 *  secundários de escrita só por ser importado). */
function resolveOfflineLicensePathReadOnly() {
  const userDataPath = String(process.env.POS_USER_DATA_PATH ?? '').trim();
  if (userDataPath) return path.join(userDataPath, 'offline-license.json');
  return path.resolve(process.cwd(), 'data', 'offline-license.json');
}

async function inspectOfflineLicenseFile() {
  const filePath = resolveOfflineLicensePathReadOnly();
  if (!fs.existsSync(filePath)) return { present: false };
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { present: true, valid: false, tenantId: null, error: `unreadable_or_invalid_json: ${err?.message ?? err}` };
  }
  const { verifyOfflineLicense } = await importAbs(path.join(repoRoot, 'lib', 'licensing', 'offlineLicense.js'));
  const { resolveOfflineLicensePublicKeyPem } = await importAbs(path.join(repoRoot, 'lib', 'licensing', 'offlineLicensePublicKeys.js'));
  const { getLocalMachineId } = await importAbs(path.join(repoRoot, 'lib', 'licensing', 'localMachineId.js'));
  let machineId;
  try {
    machineId = getLocalMachineId();
  } catch {
    machineId = null;
  }
  const verification = verifyOfflineLicense(envelope, resolveOfflineLicensePublicKeyPem, { machineId });
  if (!verification.ok) {
    return { present: true, valid: false, tenantId: null, error: verification.kind ?? 'INVALID' };
  }
  return { present: true, valid: true, tenantId: String(verification.payload?.tenant_id ?? '').trim() || null };
}

/** Abre a ligação SQLite read-only (sqlcipher+chave se POS_DB_ENCRYPTION_KEY, senão sqlite3), com
 *  OPEN_READONLY do driver + PRAGMA query_only=ON. Nunca reutiliza api/database.js. */
async function openReadOnlyConnection(dbPath) {
  const { getDbEncryptionKey } = await importAbs(path.join(repoRoot, 'api', 'utils', 'dbEncryption.js'));
  const key = getDbEncryptionKey();
  const driverName = key ? '@journeyapps/sqlcipher' : 'sqlite3';
  const driverModule = require(driverName);
  const sqlite3 = driverName === 'sqlite3' ? driverModule.verbose() : driverModule;
  const openFlags = Number(sqlite3.OPEN_READONLY) || undefined;
  const flagsApplied = Boolean(openFlags);

  const db = await new Promise((resolve, reject) => {
    let instance;
    const cb = (err) => (err ? reject(err) : resolve(instance));
    instance = flagsApplied ? new sqlite3.Database(dbPath, openFlags, cb) : new sqlite3.Database(dbPath, cb);
  }).catch((err) => {
    throw new Error(`failed_to_open_database_readonly: ${err?.message ?? err}`);
  });

  const runAsync = (sql) => new Promise((resolve, reject) => db.run(sql, (err) => (err ? reject(err) : resolve())));
  const getAsync = (sql) => new Promise((resolve, reject) => db.get(sql, (err, row) => (err ? reject(err) : resolve(row))));

  if (key) {
    await runAsync(`PRAGMA key = '${key}'`);
  }
  await runAsync('PRAGMA query_only = ON');
  // Preflight: confirma que consegue mesmo LER (chave certa / ficheiro não corrompido) sem exigir escrita.
  await getAsync('SELECT count(*) AS c FROM sqlite_master');

  return { db, driverName, openReadOnlyFlagApplied: flagsApplied };
}

function closeConnection(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

function printReport(plan, meta) {
  const lines = [];
  lines.push('='.repeat(78));
  lines.push('PILOT TENANT REPAIR — DRY-RUN REPORT (Fase A1, sem escrita)');
  lines.push('='.repeat(78));
  lines.push(`generated_at: ${plan.generated_at}`);
  lines.push(`target_db: ${meta.dbPath}`);
  lines.push(`driver: ${meta.driverName} | OPEN_READONLY_flag_applied: ${meta.openReadOnlyFlagApplied} | query_only_pragma: ON | assertReadOnlySql: ON`);
  lines.push(`db_content_unchanged (main db + wal, byte-a-byte): ${meta.fingerprintUnchanged}`);
  lines.push('  (o ficheiro -shm do modo WAL é ignorado nesta comparação de propósito — é só índice de');
  lines.push('   memória partilhada, sem dados persistidos; o próprio SQLite pode recriá-lo ao abrir uma');
  lines.push('   ligação read-only. Nunca esconde uma escrita real — db/wal continuam a prová-lo.)');
  lines.push(`pilot_tenant (licença real, exactamente uma): ${plan.pilot_tenant ?? 'UNRESOLVED'}`);
  lines.push('');

  if (plan.hard_fails.length) {
    lines.push('HARD FAILS (impedem qualquer plano — corrigir antes de repetir):');
    for (const hf of plan.hard_fails) lines.push(`  - ${hf.kind}: ${JSON.stringify(hf)}`);
    lines.push('');
  }

  lines.push('OFFLINE-LICENSE.JSON:');
  lines.push(`  ${JSON.stringify(plan.offline_license_check)}`);
  lines.push('ENV (DEFAULT_TENANT_ID / POS_DEV_TENANT):');
  lines.push(`  ${JSON.stringify(plan.env_check)}`);
  lines.push('');

  if (Object.keys(plan.tables).length) {
    lines.push('PER-TABLE PLAN:');
    for (const [table, t] of Object.entries(plan.tables).sort()) {
      lines.push(`  ${table}: strategy=${t.strategy} rows_affected=${t.rowsAffected}` + (t.mergeCount != null ? ` merge=${t.mergeCount} migrate=${t.migrateCount}` : ''));
    }
    lines.push('');

    lines.push('PRE/POST ROW-COUNT RECONCILIATION:');
    for (const [table, r] of Object.entries(plan.row_count_reconciliation).sort()) {
      lines.push(
        `  ${table}: before=${r.tenant1_rows_before} resolved=${r.resolved_by_plan} kept_as_history=${r.kept_as_history} ` +
          `requires_human_decision=${r.requires_human_decision} projected_after=${r.tenant1_rows_after_projected}`,
      );
    }
    lines.push('');
  }

  lines.push('TENANT-1 DELETE PROOF:');
  lines.push(`  satisfied: ${plan.tenant1_delete_proof.satisfied}`);
  if (plan.tenant1_delete_proof.remaining_non_history_tables?.length) {
    lines.push(`  remaining_non_history_tables: ${JSON.stringify(plan.tenant1_delete_proof.remaining_non_history_tables)}`);
  }
  if (plan.tenant1_delete_proof.history_only_tables?.length) {
    lines.push(`  history_only_tables (kept forever, expected): ${JSON.stringify(plan.tenant1_delete_proof.history_only_tables)}`);
  }
  lines.push('');

  lines.push(`BLOCKERS / COLLISIONS REQUIRING HUMAN DECISION (${plan.blockers.length}):`);
  for (const b of plan.blockers) lines.push(`  - [${b.table ?? 'env/file'}] ${b.kind}: ${JSON.stringify(b)}`);
  lines.push('');

  lines.push(`SAFE_TO_APPLY: ${plan.SAFE_TO_APPLY ? 'YES' : 'NO'}`);
  lines.push('='.repeat(78));
  console.log(lines.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply) {
    fail('--apply não existe nesta fase (Fase A1 é dry-run only). Nenhuma ligação à BD foi aberta.', 2);
  }
  if (!args.dryRun) {
    fail('Uso: node api/scripts/pilot-tenant-repair.mjs --dry-run [--db <caminho>] [--json <ficheiro>]', 2);
  }

  const dbPath = resolveDbPath(args.db);
  if (!fs.existsSync(dbPath)) {
    fail(`BD alvo não existe: ${dbPath}`, 2);
  }

  const before = fingerprintDbFiles(dbPath);

  const { db, driverName, openReadOnlyFlagApplied } = await openReadOnlyConnection(dbPath);
  const { createReadOnlyQuery } = await importAbs(path.join(repoRoot, 'api', 'services', 'localTenantMap.service.js'));
  const { buildPilotRepairPlan } = await importAbs(path.join(repoRoot, 'api', 'services', 'pilotTenantRepairPlan.service.js'));
  const query = createReadOnlyQuery(db);

  let plan;
  try {
    plan = await buildPilotRepairPlan({ query, inspectOfflineLicenseFile, env: process.env });
  } finally {
    await closeConnection(db);
  }

  const after = fingerprintDbFiles(dbPath);
  const fingerprintUnchanged = contentUnchanged(before, after);

  const meta = { dbPath, driverName, openReadOnlyFlagApplied, fingerprintUnchanged };
  printReport(plan, meta);

  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({ plan, meta, fingerprint: { before, after } }, null, 2), 'utf8');
    console.log(`[pilot-tenant-repair] JSON completo escrito em ${path.resolve(args.json)} (fora da BD alvo).`);
  }

  if (!fingerprintUnchanged) {
    // Não deveria ser possível dado o desenho acima — sinal de alarme, nunca silenciado.
    console.error('[pilot-tenant-repair] ALERTA: o fingerprint da BD alvo mudou durante um dry-run. Investigar antes de confiar em qualquer plano.');
    process.exit(1);
  }

  process.exit(plan.SAFE_TO_APPLY ? 0 : 1);
}

main().catch((err) => {
  console.error('[pilot-tenant-repair] erro:', err?.message ?? err);
  process.exit(1);
});
