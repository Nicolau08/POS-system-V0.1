/** Formata ISO 8601 para exibição em pt-PT (24h). */
export function formatDateTime24h(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—';
  const ms = Date.parse(String(iso));
  if (!Number.isFinite(ms)) return String(iso);
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}
