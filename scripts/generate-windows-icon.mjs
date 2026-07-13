/**
 * Gera ícones Windows/Electron/web a partir de "POSly icon.svg".
 *
 * Saídas:
 *   assets/posly-icon.svg  — cópia canónica
 *   assets/icon.png        — 512px (referência)
 *   assets/icon.ico        — multi-size (Electron + instalador)
 *   public/favicon.ico
 *   public/icon-192.png
 *   public/icon-512.png
 *   app/icon.png           — Next.js App Router
 *
 * Em Windows (dev), a barra de tarefas usa o ícone do EXE + AppUserModelId,
 * não o BrowserWindow.icon. Criamos POSly.exe (cópia do electron.exe) com o
 * ICO aplicado via rcedit — assim o Windows não reutiliza o cache do Atom.
 */
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { rcedit } from 'rcedit';

const ROOT = process.cwd();
const SOURCE_CANDIDATES = [
  path.join(ROOT, 'POSly icon.svg'),
  path.join(ROOT, 'assets', 'posly-icon.svg'),
  path.join(ROOT, 'assets', 'POSly icon.svg'),
];

const assetsDir = path.join(ROOT, 'assets');
const publicDir = path.join(ROOT, 'public');
const appDir = path.join(ROOT, 'app');

async function patchElectronDevExe(iconIcoPath) {
  if (process.platform !== 'win32') return;

  const distDir = path.join(ROOT, 'node_modules', 'electron', 'dist');
  const electronExe = path.join(distDir, 'electron.exe');
  const poslyExe = path.join(distDir, 'POSly.exe');

  try {
    await fs.access(electronExe);
  } catch {
    console.warn('electron.exe não encontrado — salte o patch do ícone de dev.');
    return;
  }

  try {
    await fs.copyFile(electronExe, poslyExe);
    await rcedit(poslyExe, {
      icon: iconIcoPath,
      'version-string': {
        ProductName: 'POSly',
        FileDescription: 'POSly',
        InternalName: 'POSly',
        OriginalFilename: 'POSly.exe',
      },
    });
    // Também no electron.exe (fallback se alguém lançar sem o launcher).
    try {
      await rcedit(electronExe, { icon: iconIcoPath });
    } catch {
      /* pode estar em uso — POSly.exe chega */
    }
    console.log(`Dev EXE: ${poslyExe} (ícone aplicado)`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `Não foi possível criar/aplicar ícone em POSly.exe (${msg}).\n` +
        'Feche o desktop Electron e volte a correr: npm run icon:win',
    );
  }
}

async function resolveSourceSvg() {
  for (const candidate of SOURCE_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    `SVG do POSly não encontrado. Coloque "POSly icon.svg" na raiz do projecto.`,
  );
}

async function rasterize(svgBuffer, size) {
  return sharp(svgBuffer, { density: Math.max(150, size * 2) })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function main() {
  const sourceSvg = await resolveSourceSvg();
  const svgBuffer = await fs.readFile(sourceSvg);

  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(appDir, { recursive: true });

  // Cópia canónica sem espaços no nome
  await fs.writeFile(path.join(assetsDir, 'posly-icon.svg'), svgBuffer);

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const tempPngPaths = [];

  for (const size of icoSizes) {
    const png = await rasterize(svgBuffer, size);
    const tempPath = path.join(assetsDir, `.icon-${size}.png`);
    await fs.writeFile(tempPath, png);
    tempPngPaths.push(tempPath);
  }

  const icoBuffer = await pngToIco(tempPngPaths);
  const iconIcoPath = path.join(assetsDir, 'icon.ico');
  await fs.writeFile(iconIcoPath, icoBuffer);
  await fs.writeFile(path.join(publicDir, 'favicon.ico'), icoBuffer);

  const png512 = await rasterize(svgBuffer, 512);
  const png256 = await rasterize(svgBuffer, 256);
  const png192 = await rasterize(svgBuffer, 192);

  await fs.writeFile(path.join(assetsDir, 'icon.png'), png512);
  await fs.writeFile(path.join(appDir, 'icon.png'), png256);
  await fs.writeFile(path.join(publicDir, 'icon-512.png'), png512);
  await fs.writeFile(path.join(publicDir, 'icon-192.png'), png192);

  for (const tempPath of tempPngPaths) {
    await fs.unlink(tempPath).catch(() => {});
  }

  console.log(`Fonte: ${sourceSvg}`);
  console.log(`ICO:   ${iconIcoPath}`);
  console.log(`PNG:   ${path.join(assetsDir, 'icon.png')}`);
  console.log(`App:   ${path.join(appDir, 'icon.png')}`);
  console.log(`Web:   ${path.join(publicDir, 'favicon.ico')}`);

  await patchElectronDevExe(iconIcoPath);
}

main().catch((error) => {
  console.error('Failed to generate icon:', error);
  process.exit(1);
});
