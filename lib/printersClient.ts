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
