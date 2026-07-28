export type CompanyBankAccount = {
  id: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  nib: string;
  swift: string;
  currency: string;
};

export const EMPTY_COMPANY_BANK_ACCOUNT: Omit<CompanyBankAccount, 'id'> = {
  bankName: '',
  accountHolder: '',
  accountNumber: '',
  nib: '',
  swift: '',
  currency: 'MZN',
};

export const COMPANY_BANK_CURRENCY_OPTIONS = [
  { value: 'MZN', label: 'MZN — Metical' },
  { value: 'USD', label: 'USD — Dólar americano' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'ZAR', label: 'ZAR — Rand' },
] as const;

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function createBankAccountId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBankAccount(raw: unknown, fallbackAccountNumber = ''): CompanyBankAccount | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const account: CompanyBankAccount = {
    id: asText(row.id) || createBankAccountId(),
    bankName: asText(row.bankName ?? row.banco ?? row.bank ?? row.nomeBanco),
    accountHolder: asText(row.accountHolder ?? row.titular),
    accountNumber: asText(row.accountNumber ?? row.numeroConta) || fallbackAccountNumber,
    nib: asText(row.nib),
    swift: asText(row.swift),
    currency: asText(row.currency).toUpperCase() || 'MZN',
  };
  const hasData = Boolean(
    account.bankName ||
    account.accountHolder ||
      account.accountNumber ||
      account.nib ||
      account.swift ||
      (account.currency && account.currency !== 'MZN'),
  );
  return hasData ? account : null;
}

/** Compatível com: array, { accounts: [] }, objecto único legado, ou texto livre. */
export function parseCompanyBankAccounts(
  bankDetailsRaw: unknown,
  bankAccountNumberRaw: unknown = '',
): CompanyBankAccount[] {
  const fallbackAccount = asText(bankAccountNumberRaw);
  const raw = asText(bankDetailsRaw);

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => normalizeBankAccount(item))
          .filter((item): item is CompanyBankAccount => Boolean(item));
      }
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.accounts)) {
          return parsed.accounts
            .map((item: unknown) => normalizeBankAccount(item))
            .filter((item: CompanyBankAccount | null): item is CompanyBankAccount => Boolean(item));
        }
        const single = normalizeBankAccount(parsed, fallbackAccount);
        return single ? [single] : [];
      }
    } catch {
      // Texto legado livre.
    }
  }

  if (raw && !raw.startsWith('{') && !raw.startsWith('[')) {
    return [
      {
        id: createBankAccountId(),
        bankName: '',
        accountHolder: raw,
        accountNumber: fallbackAccount,
        nib: '',
        swift: '',
        currency: 'MZN',
      },
    ];
  }

  if (fallbackAccount) {
    return [
      {
        id: createBankAccountId(),
        ...EMPTY_COMPANY_BANK_ACCOUNT,
        accountNumber: fallbackAccount,
      },
    ];
  }

  return [];
}

/** @deprecated Prefer parseCompanyBankAccounts — mantido para callers antigos. */
export function parseCompanyBankDetails(
  bankDetailsRaw: unknown,
  bankAccountNumberRaw: unknown = '',
): CompanyBankAccount {
  const accounts = parseCompanyBankAccounts(bankDetailsRaw, bankAccountNumberRaw);
  return (
    accounts[0] ?? {
      id: createBankAccountId(),
      ...EMPTY_COMPANY_BANK_ACCOUNT,
    }
  );
}

export function serializeCompanyBankAccounts(accounts: CompanyBankAccount[]): string {
  const normalized = accounts
    .map((account) => normalizeBankAccount(account))
    .filter((item): item is CompanyBankAccount => Boolean(item));
  if (normalized.length === 0) return '';
  return JSON.stringify({ accounts: normalized });
}

/** @deprecated Prefer serializeCompanyBankAccounts */
export function serializeCompanyBankDetails(bank: CompanyBankAccount): string {
  return serializeCompanyBankAccounts([bank]);
}

export function formatCompanyBankAccountLine(bank: CompanyBankAccount): string {
  const parts: string[] = [];
  if (bank.bankName) parts.push(`Banco: ${bank.bankName}`);
  if (bank.accountHolder) parts.push(`Titular: ${bank.accountHolder}`);
  if (bank.accountNumber) parts.push(`Conta: ${bank.accountNumber}`);
  if (bank.nib) parts.push(`NIB: ${bank.nib}`);
  if (bank.swift) parts.push(`SWIFT: ${bank.swift}`);
  if (bank.currency) parts.push(`Moeda: ${bank.currency}`);
  return parts.join(' · ');
}

export function formatCompanyBankDetailsForFooter(accountsOrSingle: CompanyBankAccount[] | CompanyBankAccount): string {
  const accounts = Array.isArray(accountsOrSingle) ? accountsOrSingle : [accountsOrSingle];
  return accounts
    .map((account) => formatCompanyBankAccountLine(account))
    .filter(Boolean)
    .join(' | ');
}

export function createEmptyBankAccountDraft(): CompanyBankAccount {
  return {
    id: createBankAccountId(),
    ...EMPTY_COMPANY_BANK_ACCOUNT,
  };
}
