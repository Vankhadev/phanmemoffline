const assert = require('assert');

const { resolveDetailCost } = require('../src/services/dataRepairService');

const products = new Map([
  [1, { id: 1, name: 'Áo cha', import_price: 120000 }],
  [2, { id: 2, name: 'Áo đỏ', parent_id: 1, import_price: 0 }],
]);

assert.deepStrictEqual(
  resolveDetailCost({ product_id: 2, parent_id: 1, cost_price_at_sale: 0 }, products),
  { value: 120000, source: 'parent' },
  'A zero cost variant must use its parent cost when available',
);
assert.deepStrictEqual(
  resolveDetailCost({ product_id: 2, cost_price_at_sale: 90000 }, products),
  { value: 90000, source: 'snapshot' },
  'A valid historical cost snapshot must remain authoritative',
);
assert.deepStrictEqual(
  resolveDetailCost({ product_id: 2, cost_price_at_sale: 0, import_price: 95000 }, products),
  { value: 95000, source: 'snapshot' },
  'A positive import price must be retained when another cost field is zero',
);
assert.strictEqual(
  resolveDetailCost({ product_id: 999, cost_price_at_sale: 0 }, products),
  null,
  'A detail without a reliable cost source must not be guessed',
);

console.log('PASS data repair cost resolution tests');
