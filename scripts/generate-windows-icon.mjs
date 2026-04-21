import fs from 'fs/promises';
import path from 'path';
import { PNG } from 'pngjs';
import pngToIco from 'png-to-ico';

const ROOT = process.cwd();
const assetsDir = path.join(ROOT, 'assets');
const outputIco = path.join(assetsDir, 'icon.ico');

const createPngBuffer = (size) => {
  const png = new PNG({ width: size, height: size });
  const center = (size - 1) / 2;
  const maxRadius = size * 0.45;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (size * y + x) << 2;

      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const normalized = Math.min(1, distance / maxRadius);

      // Dark background gradient
      const bgR = Math.round(14 + 10 * normalized);
      const bgG = Math.round(26 + 12 * normalized);
      const bgB = Math.round(45 + 18 * normalized);

      png.data[idx] = bgR;
      png.data[idx + 1] = bgG;
      png.data[idx + 2] = bgB;
      png.data[idx + 3] = 255;
    }
  }

  // Center accent circle + white ring so icon is visible on taskbar.
  const ringOuter = size * 0.34;
  const ringInner = size * 0.26;
  const coreRadius = size * 0.2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (size * y + x) << 2;
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= ringOuter && distance >= ringInner) {
        png.data[idx] = 236;
        png.data[idx + 1] = 242;
        png.data[idx + 2] = 248;
      } else if (distance <= coreRadius) {
        png.data[idx] = 34;
        png.data[idx + 1] = 197;
        png.data[idx + 2] = 94;
      }
    }
  }

  return PNG.sync.write(png);
};

async function main() {
  await fs.mkdir(assetsDir, { recursive: true });

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const tempPngPaths = [];
  for (const size of sizes) {
    const buffer = createPngBuffer(size);
    const tempPath = path.join(assetsDir, `.icon-${size}.png`);
    await fs.writeFile(tempPath, buffer);
    tempPngPaths.push(tempPath);
  }

  const icoBuffer = await pngToIco(tempPngPaths);
  await fs.writeFile(outputIco, icoBuffer);

  for (const tempPath of tempPngPaths) {
    await fs.unlink(tempPath).catch(() => {});
  }

  console.log(`Generated Windows icon: ${outputIco}`);
}

main().catch((error) => {
  console.error('Failed to generate icon:', error);
  process.exit(1);
});
