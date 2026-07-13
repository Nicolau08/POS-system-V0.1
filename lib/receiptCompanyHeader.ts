import type { CompanyProfile } from '@/app/pos/types';

export const FALLBACK_RECEIPT_HEADER = {
  name: 'Your Logo',
  lines: ['Av. da Marginal - Maputo', 'Tel: +258 87 2002 144', 'NUIT: 401 000 000'],
} as const;

/** Cabeçalho do recibo (pré-visualização e impressão térmica). */
export function buildReceiptHeader(profile: CompanyProfile | null) {
  if (!profile || (!profile.name.trim() && !profile.logoDataUrl)) {
    return {
      logoDataUrl: null as string | null,
      title: FALLBACK_RECEIPT_HEADER.name,
      lines: [...FALLBACK_RECEIPT_HEADER.lines],
    };
  }

  const lines: string[] = [];

  const streetLine = [profile.street.trim(), profile.buildingNumber.trim()].filter(Boolean).join(', ');
  if (streetLine) lines.push(streetLine);
  if (profile.additionalStreet.trim()) lines.push(profile.additionalStreet.trim());
  const plot = profile.plotIdentification.trim();
  if (plot) lines.push(plot);
  const cityLine = [profile.district.trim(), profile.city.trim(), profile.state.trim()]
    .filter(Boolean)
    .join(', ');
  if (cityLine) lines.push(cityLine);
  if (profile.country.trim()) lines.push(profile.country.trim());

  if (profile.phone.trim()) lines.push(`Tel: ${profile.phone.trim()}`);
  if (profile.taxId.trim()) lines.push(`NUIT: ${profile.taxId.trim()}`);
  if (profile.email.trim()) lines.push(profile.email.trim());

  return {
    logoDataUrl: profile.logoDataUrl,
    title: profile.name.trim() || FALLBACK_RECEIPT_HEADER.name,
    lines: lines.length ? lines : [...FALLBACK_RECEIPT_HEADER.lines],
  };
}

/** Src seguro para <img> no HTML de impressão (só data:image/*). */
export function safeReceiptLogoSrc(logoDataUrl: string | null): string | null {
  if (!logoDataUrl || typeof logoDataUrl !== 'string') return null;
  const t = logoDataUrl.trim();
  // Após compressão típica fica << 100 KB; 1.5 MB é teto de segurança.
  if (t.length < 24 || t.length > 1.5 * 1024 * 1024) return null;
  if (/["'<>]/.test(t)) return null;
  if (!/^data:image\/[a-z0-9+.-]+;base64,/i.test(t)) return null;
  return t;
}
