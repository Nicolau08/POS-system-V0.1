/**
 * Margem bruta a partir do preço de venda e custo unitário.
 *
 * Fórmulas:
 * - amount = sellingPrice - unitCost
 * - percent = sellingPrice > 0 ? (amount / sellingPrice) * 100 : 0
 *
 * @param {number} sellingPrice
 * @param {number} unitCost
 * @returns {{ amount: number, percent: number }}
 */
export function calcMargin(sellingPrice, unitCost) {
  const price = Number(sellingPrice);
  const cost = Number(unitCost);
  const safePrice = Number.isFinite(price) ? price : 0;
  const safeCost = Number.isFinite(cost) ? cost : 0;
  const amount = safePrice - safeCost;
  const percent = safePrice > 0 ? (amount / safePrice) * 100 : 0;
  return { amount, percent };
}
