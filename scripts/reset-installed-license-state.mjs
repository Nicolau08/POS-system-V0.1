/**
 * Desbloqueia instalação local após «Limpar licença» com setup ainda completo.
 * Uso: node scripts/reset-installed-license-state.mjs
 * (Não imprime segredos. Apaga license.json e marca config para reabrir wizard;
 * a BD encriptada é reposta na próxima arranque se o utilizador apagar database.db.)
 */
import fs from 'fs';
import path from 'path';

const userData = path.join(process.env.APPDATA || '', 'POSly');
const licensePath = path.join(userData, 'license.json');
const configPath = path.join(userData, 'config.json');
const dbPath = path.join(userData, 'data', 'database.db');

if (!process.env.APPDATA) {
  console.error('APPDATA em falta');
  process.exit(1);
}

try {
  fs.unlinkSync(licensePath);
  console.log('license.json removido');
} catch {
  console.log('license.json já ausente');
}

if (fs.existsSync(configPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg.setupCompleted = false;
    cfg.setupCompletedAt = null;
    cfg.licenseClearedAt = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    console.log('config.json: setupCompleted=false');
  } catch (err) {
    console.warn('config.json não actualizado:', err?.message ?? err);
  }
}

console.log('');
console.log('Próximos passos:');
console.log('1. Feche o POSly por completo.');
console.log('2. Se ainda ficar no ecrã de renovação, apague também:');
console.log('   ' + dbPath);
console.log('3. Abra o POSly, desvincule na consola se preciso, e introduza o número de série.');
console.log('4. Não clique em «Limpar licença local» depois de activar com sucesso.');
