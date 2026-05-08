'use client';

import { useEffect, useMemo, useState } from 'react';

type ParsedLicense = {
  tenant_id: string;
  machine_id: string;
  expiration: string;
  signature: string;
};

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function toIsoOrNull(rawValue: string) {
  const value = normalizeText(rawValue);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildCanonicalPayload(payload: Record<string, unknown>) {
  return {
    tenant_id: normalizeText(payload.tenant_id),
    machine_id: normalizeText(payload.machine_id),
    expiration: normalizeText(payload.expiration ?? payload.expires_at),
  };
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function signPayload(
  canonicalPayload: { tenant_id: string; machine_id: string; expiration: string },
  secret: string
) {
  const enc = new TextEncoder();
  const key = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await window.crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(JSON.stringify(canonicalPayload))
  );
  return bytesToHex(new Uint8Array(signatureBuffer));
}

function parseLicenseInput(rawInput: string): { payload: Record<string, unknown> | null; format: 'json' | 'base64' | null } {
  const input = normalizeText(rawInput);
  if (!input) return { payload: null, format: null };

  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return { payload: parsed, format: 'json' };
  } catch {
    // try base64
  }

  try {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return { payload: parsed, format: 'base64' };
  } catch {
    // invalid
  }

  return { payload: null, format: null };
}

function validatePayload(payload: Record<string, unknown> | null): {
  ok: boolean;
  errors: string[];
  normalized: ParsedLicense | null;
  signatureVerified: boolean;
} {
  if (!payload) {
    return {
      ok: false,
      errors: ['Formato inválido. Use JSON ou Base64(JSON).'],
      normalized: null,
      signatureVerified: false,
    };
  }

  const canonicalPayload = buildCanonicalPayload(payload);
  const tenantId = canonicalPayload.tenant_id;
  const machineId = canonicalPayload.machine_id;
  const expirationRaw = canonicalPayload.expiration;
  const expirationIso = toIsoOrNull(expirationRaw);
  const signature = normalizeText(payload.signature);

  const errors: string[] = [];
  if (!tenantId) errors.push('Campo obrigatório ausente: tenant_id');
  if (!machineId) errors.push('Campo obrigatório ausente: machine_id');
  if (!expirationRaw) errors.push('Campo obrigatório ausente: expiration');
  if (!signature) errors.push('Campo obrigatório ausente: signature');
  if (expirationRaw && !expirationIso) errors.push('Campo expiration/expires_at inválido');
  if (expirationIso && Date.now() > Date.parse(expirationIso)) errors.push(`Licença expirada: ${expirationIso}`);

  return {
    ok: errors.length === 0,
    errors,
    signatureVerified: false,
    normalized: expirationIso
      ? {
          tenant_id: tenantId,
          machine_id: machineId,
          expiration: expirationIso,
          signature,
        }
      : null,
  };
}

function encodeBase64(value: string) {
  return btoa(value);
}

export default function LicenseToolPage() {
  const [tenantId, setTenantId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [expiration, setExpiration] = useState('');
  const [generatedJson, setGeneratedJson] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [hmacSecret, setHmacSecret] = useState('');
  const [validateInput, setValidateInput] = useState('');
  const [validationResult, setValidationResult] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const nowPlusOneYear = new Date();
    nowPlusOneYear.setFullYear(nowPlusOneYear.getFullYear() + 1);
    const localIso = new Date(nowPlusOneYear.getTime() - nowPlusOneYear.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setExpiration(localIso);

    if (!window.electronAPI?.getMachineId) return;
    void window.electronAPI.getMachineId().then((result) => {
      if (result?.success && result.machineId) {
        setMachineId(result.machineId);
      }
    });
  }, []);

  const generatedCanonicalPayload = useMemo(() => {
    const expirationIso = toIsoOrNull(expiration);
    if (!tenantId.trim() || !machineId.trim() || !expirationIso) return null;
    return {
      tenant_id: tenantId.trim(),
      machine_id: machineId.trim(),
      expiration: expirationIso,
    };
  }, [tenantId, machineId, expiration]);

  const generateLicense = async () => {
    if (!generatedCanonicalPayload || !hmacSecret.trim()) {
      setStatusMessage('Preencha tenant_id, machine_id, expiration válida e HMAC secret.');
      return;
    }

    const signature = await signPayload(generatedCanonicalPayload, hmacSecret.trim());
    const generatedPayload = {
      ...generatedCanonicalPayload,
      signature,
    };
    const json = JSON.stringify(generatedPayload, null, 2);
    const base64 = encodeBase64(JSON.stringify(generatedPayload));
    setGeneratedJson(json);
    setGeneratedKey(base64);
    setValidationResult('');
    setStatusMessage('Licença gerada com sucesso.');
  };

  const validateLicense = async () => {
    const parsed = parseLicenseInput(validateInput);
    const validation = validatePayload(parsed.payload);
    const secret = hmacSecret.trim();
    let signatureOk = false;
    if (validation.normalized && secret) {
      const expected = await signPayload(
        {
          tenant_id: validation.normalized.tenant_id,
          machine_id: validation.normalized.machine_id,
          expiration: validation.normalized.expiration,
        },
        secret
      );
      signatureOk = timingSafeEqualHex(validation.normalized.signature, expected);
      if (!signatureOk) {
        validation.errors.push('Assinatura HMAC inválida (tampering detectado).');
      }
    } else if (validation.normalized && !secret) {
      validation.errors.push('Informe HMAC secret para validar assinatura.');
    }

    if (!validation.ok) {
      setValidationResult(`VALIDATION_OK=false\n${validation.errors.map((e) => `- ${e}`).join('\n')}`);
      return;
    }

    if (!signatureOk) {
      setValidationResult(`VALIDATION_OK=false\n- Assinatura não verificada.`);
      return;
    }

    setValidationResult(
      [
        `VALIDATION_OK=true`,
        `format=${parsed.format}`,
        `signature=verified`,
        ``,
        JSON.stringify(validation.normalized, null, 2),
      ].join('\n')
    );
  };

  const copyText = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatusMessage(`${label} copiado para a área de transferência.`);
    } catch {
      setStatusMessage(`Não foi possível copiar ${label.toLowerCase()}.`);
    }
  };

  return (
    <div className="min-h-screen bg-[#111111] text-zinc-100 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-bold">POS License Generator + Validator</h1>
        <p className="text-sm text-zinc-400">
          Gera e valida licenças com `tenant_id`, `machine_id` e `expiration`.
        </p>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <h2 className="text-lg font-semibold">1) Gerar licença</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              tenant_id
              <input
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="tenant-1"
              />
            </label>
            <label className="text-sm">
              machine_id
              <input
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
                value={machineId}
                onChange={(event) => setMachineId(event.target.value)}
                placeholder="Machine ID"
              />
            </label>
            <label className="text-sm">
              expiration
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
                value={expiration}
                onChange={(event) => setExpiration(event.target.value)}
              />
            </label>
          </div>
          <label className="text-sm block">
            HMAC secret (não partilhe com clientes)
            <input
              type="password"
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
              value={hmacSecret}
              onChange={(event) => setHmacSecret(event.target.value)}
              placeholder="POS_LICENSE_HMAC_SECRET"
            />
          </label>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className="rounded bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-semibold"
              onClick={() => void generateLicense()}
            >
              Gerar licença
            </button>
            <button
              type="button"
              className="rounded border border-zinc-600 hover:border-zinc-500 px-4 py-2 text-sm"
              onClick={() => void copyText(generatedJson, 'JSON')}
            >
              Copiar JSON
            </button>
            <button
              type="button"
              className="rounded border border-zinc-600 hover:border-zinc-500 px-4 py-2 text-sm"
              onClick={() => void copyText(generatedKey, 'License key')}
            >
              Copiar License Key (base64)
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              License JSON
              <textarea
                className="mt-1 h-48 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
                value={generatedJson}
                readOnly
              />
            </label>
            <label className="text-sm">
              License key (copy/paste)
              <textarea
                className="mt-1 h-48 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
                value={generatedKey}
                readOnly
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <h2 className="text-lg font-semibold">2) Validar licença</h2>
          <p className="text-xs text-amber-300">
            A validação de assinatura exige o mesmo HMAC secret usado na geração.
          </p>
          <label className="text-sm block">
            Cole JSON ou Base64(JSON)
            <textarea
              className="mt-1 h-40 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
              value={validateInput}
              onChange={(event) => setValidateInput(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold"
              onClick={() => void validateLicense()}
            >
              Validar
            </button>
            <button
              type="button"
              className="rounded border border-zinc-600 hover:border-zinc-500 px-4 py-2 text-sm"
              onClick={() => void copyText(validationResult, 'Resultado da validação')}
            >
              Copiar resultado
            </button>
          </div>
          <textarea
            className="h-40 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs"
            value={validationResult}
            readOnly
          />
        </section>

        {statusMessage ? (
          <div className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">{statusMessage}</div>
        ) : null}
      </div>
    </div>
  );
}
