/** Limites pensados para recibo térmico (~80 mm) e IPC/Electron rápidos. */
export const RECEIPT_LOGO_MAX_EDGE_PX = 280;
/** ~36 KB binário → data URL curto o suficiente para não atrasar a impressão. */
export const RECEIPT_LOGO_MAX_DATA_URL_CHARS = 48_000;
/** Acima disto consideramos o logo “grande” e comprimimos. */
export const RECEIPT_LOGO_COMPRESS_THRESHOLD_CHARS = 28_000;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem do logo.'));
    img.src = src;
  });
}

export function receiptLogoNeedsCompression(dataUrl: string | null | undefined): boolean {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  const t = dataUrl.trim();
  if (t.length < 32) return false;
  if (t.length >= RECEIPT_LOGO_COMPRESS_THRESHOLD_CHARS) return true;
  // data:image/png|jpeg sem dimensões conhecidas — se for curto, deixa passar
  return false;
}

/**
 * Redimensiona e comprime o logo (JPEG com fundo branco) para impressão rápida.
 * Se já for pequeno, devolve o original.
 */
export async function compressReceiptLogoDataUrl(
  dataUrl: string,
  options?: {
    maxEdgePx?: number;
    maxDataUrlChars?: number;
  },
): Promise<string> {
  if (typeof document === 'undefined') return dataUrl;

  const input = String(dataUrl || '').trim();
  if (!input.startsWith('data:image/')) return dataUrl;

  const maxEdge = options?.maxEdgePx ?? RECEIPT_LOGO_MAX_EDGE_PX;
  const maxChars = options?.maxDataUrlChars ?? RECEIPT_LOGO_MAX_DATA_URL_CHARS;

  if (
    input.length <= RECEIPT_LOGO_COMPRESS_THRESHOLD_CHARS &&
    !/image\/(png|webp|gif|bmp|tiff)/i.test(input.slice(0, 40))
  ) {
    // JPEG/WebP já pequeno — ok
    if (input.length <= maxChars) return input;
  }

  const img = await loadImageElement(input);
  const srcW = Math.max(1, img.naturalWidth || img.width || 1);
  const srcH = Math.max(1, img.naturalHeight || img.height || 1);
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));

  let width = Math.max(1, Math.round(srcW * scale));
  let height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return input;

  const qualities = [0.78, 0.65, 0.52, 0.4, 0.32];
  let best = input;

  for (let pass = 0; pass < 4; pass += 1) {
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of qualities) {
      const out = canvas.toDataURL('image/jpeg', quality);
      if (out.length < best.length) best = out;
      if (out.length <= maxChars) return out;
    }

    // Ainda grande: reduzir mais a resolução
    width = Math.max(48, Math.round(width * 0.72));
    height = Math.max(48, Math.round(height * 0.72));
  }

  return best.length < input.length ? best : input;
}

/** Comprime só se necessário; devolve null se input for null/vazio. */
export async function ensureCompactReceiptLogo(
  dataUrl: string | null | undefined,
): Promise<string | null> {
  if (dataUrl == null) return null;
  const trimmed = String(dataUrl).trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('data:image/')) return trimmed;

  if (!receiptLogoNeedsCompression(trimmed) && trimmed.length <= RECEIPT_LOGO_MAX_DATA_URL_CHARS) {
    return trimmed;
  }

  try {
    return await compressReceiptLogoDataUrl(trimmed);
  } catch {
    return trimmed;
  }
}
