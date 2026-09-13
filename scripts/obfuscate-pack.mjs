/**
 * Pré-pack: copia electron/api/lib (.js) para build/pack-obfuscated e ofusca.
 * Gera build/electron-builder.pack.json para o electron-builder usar essas pastas.
 * Dev (npm run dev) não é afectado — só corre no electron-dist.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'build', 'pack-obfuscated');
const BUILDER_CONFIG_PATH = path.join(ROOT, 'build', 'electron-builder.pack.json');

const JS_EXT = new Set(['.js', '.mjs', '.cjs']);
const COPY_AS_IS_EXT = new Set([
  '.json',
  '.html',
  '.css',
  '.svg',
  '.png',
  '.ico',
  '.jpg',
  '.jpeg',
  '.webp',
  '.node',
  '.dll',
  '.exe',
  '.md',
  '.txt',
  '.wasm',
]);

/** Perfil médio — evita controlFlowFlattening/selfDefending (partem Electron/sqlite). */
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  rotateStringArray: true,
  stringArrayThreshold: 0.6,
  stringArrayEncoding: ['base64'],
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  target: 'node',
  sourceMap: false,
  ignoreImports: true,
};

function rmDirIfExists(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function shouldSkipPath(relPosix) {
  const lower = relPosix.toLowerCase();
  if (lower.includes('/node_modules/')) return true;
  if (lower.includes('/__tests__/') || lower.includes('/test/')) return true;
  if (lower.endsWith('.test.js') || lower.endsWith('.spec.js')) return true;
  if (lower.endsWith('.map') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return true;
  if (lower.endsWith('.d.ts')) return true;
  if (lower.includes('.env')) return true;
  return false;
}

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function obfuscateJsSource(code, fileLabel) {
  try {
    const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
    return result.getObfuscatedCode();
  } catch (err) {
    console.warn(
      `[obfuscate-pack] Falha a ofuscar ${fileLabel} — a copiar original:`,
      err?.message || err,
    );
    return code;
  }
}

function processTree(srcDir, destDir, { obfuscate }) {
  const files = listFilesRecursive(srcDir);
  let copied = 0;
  let obfuscated = 0;
  let skipped = 0;

  for (const srcFile of files) {
    const rel = path.relative(srcDir, srcFile);
    const relPosix = rel.split(path.sep).join('/');
    if (shouldSkipPath(relPosix)) {
      skipped += 1;
      continue;
    }

    const ext = path.extname(srcFile).toLowerCase();
    const destFile = path.join(destDir, rel);
    ensureDir(path.dirname(destFile));

    if (obfuscate && JS_EXT.has(ext)) {
      const raw = fs.readFileSync(srcFile, 'utf8');
      const out = obfuscateJsSource(raw, relPosix);
      fs.writeFileSync(destFile, out, 'utf8');
      obfuscated += 1;
      copied += 1;
      continue;
    }

    if (JS_EXT.has(ext) || COPY_AS_IS_EXT.has(ext) || !ext) {
      fs.copyFileSync(srcFile, destFile);
      copied += 1;
      continue;
    }

    // Outros binários/assets (ex. sem extensão útil): copiar
    fs.copyFileSync(srcFile, destFile);
    copied += 1;
  }

  return { copied, obfuscated, skipped };
}

function readPackageBuildConfig() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return { pkg, build: { ...(pkg.build || {}) } };
}

function writeBuilderConfig(build) {
  ensureDir(path.dirname(BUILDER_CONFIG_PATH));
  // electron-builder --config espera o objecto de build (ou root com "build").
  // Usamos o objecto de build directamente + campos úteis no root.
  const config = {
    ...build,
    files: [
      {
        from: 'build/pack-obfuscated/electron',
        to: 'electron',
        filter: ['**/*'],
      },
      {
        from: 'build/pack-obfuscated/api',
        to: 'api',
        filter: ['**/*'],
      },
      {
        from: 'build/pack-obfuscated/lib',
        to: 'lib',
        filter: ['**/*'],
      },
      'assets/**/*',
      'package.json',
      '!**/*.map',
      '!**/*.ts',
      '!**/*.tsx',
      '!**/*.d.ts',
      '!**/.env',
      '!**/.env.*',
      '!**/license-console/**',
      '!**/.dev-tenants/**',
      '!**/__tests__/**',
      '!**/*.test.js',
      '!**/*.spec.js',
    ],
  };
  fs.writeFileSync(BUILDER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function main() {
  console.log('[obfuscate-pack] A preparar build/pack-obfuscated…');
  rmDirIfExists(OUT_ROOT);
  ensureDir(OUT_ROOT);

  const electronSrc = path.join(ROOT, 'electron');
  const apiSrc = path.join(ROOT, 'api');
  const libSrc = path.join(ROOT, 'lib');

  const electronStats = processTree(electronSrc, path.join(OUT_ROOT, 'electron'), {
    obfuscate: true,
  });
  const apiStats = processTree(apiSrc, path.join(OUT_ROOT, 'api'), { obfuscate: true });
  // Só .js de lib (licenciamento + helpers usados pela API/Electron); .ts fica de fora.
  const libStats = processTree(libSrc, path.join(OUT_ROOT, 'lib'), { obfuscate: true });

  const { build } = readPackageBuildConfig();
  writeBuilderConfig(build);

  console.log('[obfuscate-pack] electron:', electronStats);
  console.log('[obfuscate-pack] api:', apiStats);
  console.log('[obfuscate-pack] lib:', libStats);
  console.log('[obfuscate-pack] Config:', path.relative(ROOT, BUILDER_CONFIG_PATH));
  console.log('[obfuscate-pack] Concluído.');
}

main();
