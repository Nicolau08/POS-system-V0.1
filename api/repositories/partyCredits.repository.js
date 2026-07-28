import crypto from 'crypto';
import { all, get, run } from '../dbUtils.js';

export async function insertPartyCredit(row) {
  return run(
    `INSERT INTO party_credits (
      id, tenant_id, party_id, party_kind, amount, remaining,
      source_order_id, source_document_number, source_prefix, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row
  );
}

export async function listPartyCredits(tenantId, partyKind, partyId) {
  return all(
    `SELECT * FROM party_credits
     WHERE tenant_id = ? AND party_kind = ? AND party_id = ? AND remaining > 0.0001
     ORDER BY created_at ASC`,
    [tenantId, partyKind, String(partyId)]
  );
}

export async function getPartyCreditBalance(tenantId, partyKind, partyId) {
  const row = await get(
    `SELECT COALESCE(SUM(remaining), 0) AS balance
     FROM party_credits
     WHERE tenant_id = ? AND party_kind = ? AND party_id = ?`,
    [tenantId, partyKind, String(partyId)]
  );
  return Number(row?.balance ?? 0) || 0;
}

export async function applyPartyCreditAmount(tenantId, partyKind, partyId, amountToApply, now) {
  let remaining = Number(amountToApply) || 0;
  if (remaining <= 0) return 0;
  const credits = await listPartyCredits(tenantId, partyKind, partyId);
  let applied = 0;
  for (const credit of credits) {
    if (remaining <= 0) break;
    const available = Number(credit.remaining ?? 0) || 0;
    if (available <= 0) continue;
    const use = Math.min(available, remaining);
    const nextRemaining = available - use;
    await run(
      `UPDATE party_credits SET remaining = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      [nextRemaining, now, credit.id, tenantId]
    );
    remaining -= use;
    applied += use;
  }
  return applied;
}

export function createPartyCreditId() {
  return crypto.randomUUID();
}
