/**
 * Gera ícones do launcher Android a partir do logo POSly (mesmo do Electron).
 */
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const root = process.cwd();
const srcSvg = path.join(root, 'assets', 'posly-icon.svg');
const resRoot = path.join(root, 'apps', 'android-posto', 'android', 'app', 'src', 'main', 'res');

const densities = [
  { folder: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { folder: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { folder: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { folder: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { folder: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

async function makeSquarePng(size, insetRatio = 0) {
  const inset = Math.round(size * insetRatio);
  const logoSize = Math.max(1, size - inset * 2);
  const logo = await sharp(srcSvg)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 1, b: 251, alpha: 1 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 1, b: 251, alpha: 1 },
    },
  })
    .composite([{ input: logo, left: inset, top: inset }])
    .png()
    .toBuffer();
}

await fs.access(srcSvg);

for (const d of densities) {
  const dir = path.join(resRoot, d.folder);
  await fs.mkdir(dir, { recursive: true });
  const full = await makeSquarePng(d.launcher, 0);
  await fs.writeFile(path.join(dir, 'ic_launcher.png'), full);
  await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), full);
  const fg = await makeSquarePng(d.foreground, 0.18);
  await fs.writeFile(path.join(dir, 'ic_launcher_foreground.png'), fg);
  console.log('ok', d.folder);
}

await fs.writeFile(
  path.join(resRoot, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0001FB</color>
</resources>
`,
);

// Remover vector antigo do foreground (usar PNG)
const legacyFg = path.join(resRoot, 'drawable-v24', 'ic_launcher_foreground.xml');
try {
  await fs.unlink(legacyFg);
  console.log('removed legacy drawable-v24/ic_launcher_foreground.xml');
} catch {
  /* ok */
}

console.log('Android icons updated from assets/posly-icon.svg');
