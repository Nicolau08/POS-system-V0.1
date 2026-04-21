#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import machineIdModule from 'node-machine-id';
const { machineIdSync } = machineIdModule;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function parseExpirationToIso(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function resolveSecret(args) {
  const candidate =
    normalizeText(args.secret) ||
    normalizeText(process.env.POS_LICENSE_HMAC_SECRET) ||
    normalizeText(process.env.LICENSE_HMAC_SECRET);
  return candidate;
}

function buildCanonicalLicensePayload(payload) {
  return {
    tenant_id: normalizeText(payload?.tenant_id),
    machine_id: normalizeText(payload?.machine_id),
    expiration: normalizeText(payload?.expiration || payload?.expires_at),
  };
}

function signCanonicalLicensePayload(canonicalPayload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyLicenseSignature(payload, options = {}) {
  const secret = normalizeText(options.secret);
  const allowUnsigned = Boolean(options.allowUnsigned);
  const signature = normalizeText(payload?.signature);

  if (!signature) {
    if (allowUnsigned) return { ok: true, mode: 'unsigned-fallback' };
    return { ok: false, error: 'Campo obrigatório ausente: signature.' };
  }
  if (!secret) {
    return { ok: false, error: 'Secret ausente. Use --secret ou POS_LICENSE_HMAC_SECRET.' };
  }

  const canonicalPayload = buildCanonicalLicensePayload(payload);
  const expectedSignature = signCanonicalLicensePayload(canonicalPayload, secret);
  if (!timingSafeEqualHex(signature, expectedSignature)) {
    return { ok: false, error: 'Assinatura inválida (tampering detectado).' };
  }
  return { ok: true, mode: 'signed' };
}

function parseLicenseInput(rawInput) {
  const raw = normalizeText(rawInput);
  if (!raw) return { payload: null, format: null };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed, format: 'json' };
    }
  } catch {
    // try base64
  }

  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed, format: 'base64' };
    }
  } catch {
    // invalid
  }

  return { payload: null, format: null };
}

function validateLicensePayload(payload, options = {}) {
  const expectedMachineId = normalizeText(options.expectedMachineId);
  const expectedTenantId = normalizeText(options.expectedTenantId);
  const signatureCheck = verifyLicenseSignature(payload, {
    secret: options.secret,
    allowUnsigned: Boolean(options.allowUnsigned),
  });

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Payload de licença inválido.'] };
  }
  if (!signatureCheck.ok) {
    return { ok: false, errors: [String(signatureCheck.error || 'Assinatura inválida.')], normalized: null };
  }

  const errors = [];
  const canonicalPayload = buildCanonicalLicensePayload(payload);
  const tenantId = canonicalPayload.tenant_id;
  const machineId = canonicalPayload.machine_id;
  const expirationRaw = canonicalPayload.expiration;
  const expirationIso = parseExpirationToIso(expirationRaw);

  if (!tenantId) errors.push('Campo obrigatório ausente: tenant_id.');
  if (!machineId) errors.push('Campo obrigatório ausente: machine_id.');
  if (!expirationRaw) errors.push('Campo obrigatório ausente: expiration.');
  if (expirationRaw && !expirationIso) errors.push('Campo expiration/expires_at inválido.');

  if (expectedTenantId && tenantId && tenantId !== expectedTenantId) {
    errors.push(`tenant_id divergente. Esperado "${expectedTenantId}", recebido "${tenantId}".`);
  }

  if (expectedMachineId && machineId && machineId !== expectedMachineId) {
    errors.push('machine_id não corresponde ao esperado.');
  }

  if (expirationIso && Date.now() > Date.parse(expirationIso)) {
    errors.push(`Licença expirada em ${expirationIso}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      tenant_id: tenantId,
      machine_id: machineId,
      expiration: expirationIso,
      signature: normalizeText(payload.signature),
    },
  };
}

function buildLicense(tenantId, machineId, expirationIso, signature) {
  return {
    tenant_id: tenantId,
    machine_id: machineId,
    expiration: expirationIso,
    signature,
  };
}

function encodeLicenseBase64(licensePayload) {
  return Buffer.from(JSON.stringify(licensePayload), 'utf8').toString('base64');
}

async function readInputFromFile(filePath) {
  const resolved = path.resolve(process.cwd(), String(filePath));
  return fs.readFile(resolved, 'utf8');
}

function printUsage() {
  console.log(`
POS License Tool

Generate:
  node api/scripts/license-tool.mjs generate --tenant <tenant_id> --machine <machine_id> --expires <ISO-or-date>
  node api/scripts/license-tool.mjs generate --tenant tenant-1 --machine auto --expires "2027-12-31T23:59:59Z"

Validate:
  node api/scripts/license-tool.mjs validate --key "<base64-or-json>"
  node api/scripts/license-tool.mjs validate --file "./license.json" --check-local-machine --secret "<HMAC_SECRET>"

Options:
  --tenant <value>              tenant_id
  --machine <value|auto>        machine_id (auto = read from node-machine-id)
  --expires <value>             expiration date/time (ISO preferred)
  --secret <value>              HMAC secret (or use POS_LICENSE_HMAC_SECRET env)
  --key <value>                 license input (JSON or base64 JSON)
  --file <path>                 file with license input (JSON or base64 JSON)
  --expected-tenant <value>     validate tenant_id exactly
  --expected-machine <value>    validate machine_id exactly
  --check-local-machine         validate machine_id against local machine
  --allow-unsigned              allow legacy unsigned licenses (migration mode only)
`);
}

async function runGenerate(args) {
  const tenantId = normalizeText(args.tenant);
  const machineArg = normalizeText(args.machine);
  const expiresArg = normalizeText(args.expires);
  const secret = resolveSecret(args);

  if (!tenantId) {
    throw new Error('Missing --tenant.');
  }
  if (!machineArg) {
    throw new Error('Missing --machine (use value or "auto").');
  }
  if (!expiresArg) {
    throw new Error('Missing --expires.');
  }
  if (!secret) {
    throw new Error('Missing HMAC secret. Use --secret or POS_LICENSE_HMAC_SECRET.');
  }

  const machineId = machineArg.toLowerCase() === 'auto' ? machineIdSync({ original: true }) : machineArg;
  const expirationIso = parseExpirationToIso(expiresArg);
  if (!expirationIso) {
    throw new Error('Invalid --expires value. Use ISO like 2027-12-31T23:59:59Z.');
  }
  if (Date.now() > Date.parse(expirationIso)) {
    throw new Error('Expiration is in the past.');
  }

  const canonicalPayload = buildCanonicalLicensePayload({
    tenant_id: tenantId,
    machine_id: machineId,
    expiration: expirationIso,
  });
  const signature = signCanonicalLicensePayload(canonicalPayload, secret);
  const license = buildLicense(tenantId, machineId, expirationIso, signature);
  const licenseJson = JSON.stringify(license, null, 2);
  const licenseBase64 = encodeLicenseBase64(license);

  console.log('--- LICENSE JSON ---');
  console.log(licenseJson);
  console.log('');
  console.log('--- LICENSE KEY (BASE64) ---');
  console.log(licenseBase64);
  console.log('');
  console.log('--- COPY/PASTE OUTPUT ---');
  console.log(`LICENSE_KEY=${licenseBase64}`);
}

async function runValidate(args) {
  let input = normalizeText(args.key);
  if (!input && args.file) {
    input = await readInputFromFile(args.file);
  }
  if (!input) {
    throw new Error('Missing --key or --file.');
  }

  const { payload, format } = parseLicenseInput(input);
  if (!payload) {
    throw new Error('License format invalid. Expected JSON or base64(JSON).');
  }

  const expectedMachineId = args['check-local-machine']
    ? machineIdSync({ original: true })
    : normalizeText(args['expected-machine']);
  const expectedTenantId = normalizeText(args['expected-tenant']);
  const secret = resolveSecret(args);
  const allowUnsigned = Boolean(args['allow-unsigned']);

  const result = validateLicensePayload(payload, {
    expectedMachineId,
    expectedTenantId,
    secret,
    allowUnsigned,
  });

  console.log('--- VALIDATION INPUT ---');
  console.log(`format=${format}`);
  console.log(`allowUnsigned=${allowUnsigned ? 'true' : 'false'}`);
  console.log('');
  console.log('--- NORMALIZED PAYLOAD ---');
  console.log(JSON.stringify(result.normalized, null, 2));
  console.log('');

  if (!result.ok) {
    console.log('--- VALIDATION ERRORS ---');
    for (const err of result.errors) {
      console.log(`- ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('VALIDATION_OK=true');
  console.log(`LICENSE_KEY=${encodeLicenseBase64(result.normalized)}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = normalizeText(argv[0]).toLowerCase();
  const args = parseArgs(argv.slice(command ? 1 : 0));

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'generate') {
    await runGenerate(args);
    return;
  }

  if (command === 'validate') {
    await runValidate(args);
    return;
  }

  throw new Error(`Unknown command "${command}". Use generate|validate.`);
}

main().catch((error) => {
  console.error(`ERROR: ${String(error?.message ?? error)}`);
  process.exit(1);
});
