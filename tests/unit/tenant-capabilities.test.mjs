import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getVerticalPreset,
  hasCapability,
  inferVerticalFromCommerceType,
  normalizeCapabilities,
  normalizeVertical,
} from '../../api/utils/tenantCapabilities.js';

test('normalizeVertical faz fallback para commerce_type legado', () => {
  assert.equal(normalizeVertical(null, 'restauracao'), 'restauracao');
  assert.equal(normalizeVertical('', 'farmacia'), 'farmacia');
  assert.equal(normalizeVertical('Barbearia', 'retalho'), 'barbearia');
  assert.equal(inferVerticalFromCommerceType('restaurant'), 'restauracao');
});

test('normalizeCapabilities usa preset quando capabilities_json está vazio', () => {
  assert.deepEqual(normalizeCapabilities(null, 'retalho'), getVerticalPreset('retalho'));
  assert.deepEqual(normalizeCapabilities('', 'farmacia'), getVerticalPreset('farmacia'));
});

test('normalizeCapabilities limpa entradas inválidas e mantém capabilities válidas', () => {
  const caps = normalizeCapabilities(
    '["sales", "print_centers", "print_centers", "foo", "kds"]',
    'restauracao',
  );

  assert.deepEqual(caps, ['sales', 'print_centers', 'kds']);
  assert.equal(hasCapability(caps, 'print_centers'), true);
  assert.equal(hasCapability(caps, 'tables'), false);
});
