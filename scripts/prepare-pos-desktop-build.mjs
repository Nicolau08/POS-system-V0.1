/**
 * Legacy no-op: a consola de licenças foi separada para license-console/
 * e já não existe em app/license-admin nem app/api/license-issuer no POS.
 *
 * Mantido para não partir scripts antigos (exclude | restore).
 */
const action = String(process.argv[2] || '').trim().toLowerCase();

if (action === 'exclude' || action === 'restore') {
  console.log(
    `[prepare-pos-desktop-build] ${action}: nada a fazer (consola só em license-console/).`,
  );
  process.exit(0);
}

console.error('[prepare-pos-desktop-build] Uso: exclude | restore');
process.exit(1);
