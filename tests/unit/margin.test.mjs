import test from 'node:test';
import assert from 'node:assert/strict';

import { calcMargin } from '../../api/utils/margin.js';

test('calcMargin: caso normal (preço > custo)', () => {
  const { amount, percent } = calcMargin(100, 60);
  assert.equal(amount, 40);
  assert.equal(percent, 40);
});

test('calcMargin: preço 0 evita divisão por zero → percent 0', () => {
  const { amount, percent } = calcMargin(0, 60);
  assert.equal(amount, -60);
  assert.equal(percent, 0);
});

test('calcMargin: custo maior que preço → margem negativa', () => {
  const { amount, percent } = calcMargin(50, 80);
  assert.equal(amount, -30);
  assert.equal(percent, -60);
});

test('calcMargin: custo 0 → margem de 100%', () => {
  const { amount, percent } = calcMargin(100, 0);
  assert.equal(amount, 100);
  assert.equal(percent, 100);
});

test('calcMargin: entradas não numéricas são tratadas como 0', () => {
  assert.deepEqual(calcMargin('abc', 'xyz'), { amount: 0, percent: 0 });
  assert.deepEqual(calcMargin(undefined, undefined), { amount: 0, percent: 0 });
});
