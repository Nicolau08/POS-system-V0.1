/**
 * Mensagens de conflito de licença (tenant / máquina / BD).
 * Partilhado entre Electron, API Express e UI React.
 */

/** Mensagem canónica devolvida pela validação / issuer. */
export const LICENSE_IN_USE_MESSAGE =
  'Esta licença já está a ser usada noutra máquina ou base de dados.';

/** Texto do popup no POS (mensagem para o cliente final). */
export const LICENSE_IN_USE_POPUP_DETAIL =
  'Esta licença já está a ser usada noutra base de dados ou máquina. Contacte o suporte para desvincular a licença e poder ativá-la neste PC.';

const LEGACY_CONFLICT_SNIPPETS = [
  'já está a ser usada noutra máquina ou base de dados',
  'não pertence ao tenant desta instalação',
  'não corresponde ao tenant desta instalação',
  'não corresponde ao tenant local',
  'vinculada a outra máquina',
  'já foi associado a outra máquina',
  'já foi activada noutro computador',
  'já foi ativada noutro computador',
];

/**
 * @param {unknown} message
 * @returns {boolean}
 */
export function isLicenseInUseConflict(message) {
  const text = String(message ?? '')
    .trim()
    .toLowerCase();
  if (!text) return false;
  return LEGACY_CONFLICT_SNIPPETS.some((snippet) => text.includes(snippet));
}
