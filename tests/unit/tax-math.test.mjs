import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTaxFromBasePrice, extractTaxFromGross } from '../../api/utils/taxMath.js';

test('computeTaxFromBasePrice: taxa 0% (isento) nunca cobra imposto', () => {
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: 100, rate: 0, priceIncludesTax: true }),
    { tax: 0, finalPrice: 100 },
  );
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: 100, rate: 0, priceIncludesTax: false }),
    { tax: 0, finalPrice: 100 },
  );
});

test('computeTaxFromBasePrice: percentual, preço já inclui imposto (extrai)', () => {
  // 116 com IVA de 16% incluído → imposto = 16, preço final mantém-se 116
  const result = computeTaxFromBasePrice({ basePrice: 116, rate: 16, priceIncludesTax: true });
  assert.equal(result.finalPrice, 116);
  assert.equal(result.tax, 16);
});

test('computeTaxFromBasePrice: percentual, preço sem imposto (soma)', () => {
  // 100 + IVA de 16% → imposto = 16, preço final = 116
  const result = computeTaxFromBasePrice({ basePrice: 100, rate: 16, priceIncludesTax: false });
  assert.equal(result.tax, 16);
  assert.equal(result.finalPrice, 116);
});

test('computeTaxFromBasePrice: imposto fixo, preço inclui imposto → tax = min(preço, valor fixo)', () => {
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: 50, rate: 20, isFixed: true, priceIncludesTax: true }),
    { tax: 20, finalPrice: 50 },
  );
  // valor fixo maior que o preço → imposto limitado ao preço
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: 10, rate: 20, isFixed: true, priceIncludesTax: true }),
    { tax: 10, finalPrice: 10 },
  );
});

test('computeTaxFromBasePrice: imposto fixo, preço sem imposto → soma o valor fixo', () => {
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: 50, rate: 20, isFixed: true, priceIncludesTax: false }),
    { tax: 20, finalPrice: 70 },
  );
});

test('computeTaxFromBasePrice: entradas inválidas/negativas são tratadas como 0', () => {
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: -50, rate: 16, priceIncludesTax: false }),
    { tax: 0, finalPrice: 0 },
  );
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: 'abc', rate: 16, priceIncludesTax: false }),
    { tax: 0, finalPrice: 0 },
  );
  assert.deepEqual(
    computeTaxFromBasePrice({ basePrice: 100, rate: -16, priceIncludesTax: false }),
    { tax: 0, finalPrice: 100 },
  );
});

test('computeTaxFromBasePrice: arredonda a 2 casas decimais', () => {
  // 100 com 15% → imposto = 100 - 100/1.15 = 13.043478... → arredonda para 13.04
  const result = computeTaxFromBasePrice({ basePrice: 100, rate: 15, priceIncludesTax: true });
  assert.equal(result.tax, 13.04);
});

test('extractTaxFromGross: percentual normal', () => {
  // 116 com 16% incluído → 16 de imposto
  assert.equal(extractTaxFromGross(116, 16), 16);
});

test('extractTaxFromGross: taxa <= 0 devolve sempre 0', () => {
  assert.equal(extractTaxFromGross(100, 0), 0);
  assert.equal(extractTaxFromGross(100, -5), 0);
});

test('extractTaxFromGross: imposto fixo multiplica pela quantidade e limita ao total', () => {
  assert.equal(extractTaxFromGross(50, 5, true, 3), 15); // 5 * 3 = 15, dentro do total
  assert.equal(extractTaxFromGross(10, 5, true, 3), 10); // 5*3=15 > 10 → limitado a 10
});

test('extractTaxFromGross: valores negativos/ausentes tratados como 0', () => {
  assert.equal(extractTaxFromGross(-100, 16), 0);
  assert.equal(extractTaxFromGross(undefined, 16), 0);
});
