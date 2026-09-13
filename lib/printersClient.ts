export type SystemPrinter = {
  name: string;
  displayName: string;
  isDefault?: boolean;
  status?: number;
};

export async function listSystemPrinters(): Promise<SystemPrinter[]> {
  if (typeof window !== 'undefined' && window.electronAPI?.listPrinters) {
    try {
      const result = await window.electronAPI.listPrinters();
      if (result?.success && Array.isArray(result.printers)) {
        return result.printers
          .map((printer) => ({
            name: String(printer.name ?? '').trim(),
            displayName: String(printer.displayName || printer.name || '').trim(),
            isDefault: Boolean(printer.isDefault),
            status: printer.status,
          }))
          .filter((printer) => printer.name);
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Resolve a impressora de recibos configurada em Opções de impressão (Windows). */
export async function resolveConfiguredReceiptPrinterName(
  preferredName?: string | null,
): Promise<string | undefined> {
  const preferred = String(preferredName ?? '').trim();
  const printers = await listSystemPrinters();

  if (preferred && printers.length > 0) {
    const preferredLower = preferred.toLowerCase();
    const match =
      printers.find((p) => p.name === preferred) ||
      printers.find((p) => p.displayName === preferred) ||
      printers.find((p) => p.name.toLowerCase() === preferredLower) ||
      printers.find((p) => p.displayName.toLowerCase() === preferredLower);
    if (match?.name) return match.name;
  }

  if (preferred) return preferred;
  const def = printers.find((p) => p.isDefault) || printers[0];
  return def?.name || undefined;
}
