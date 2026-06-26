const assert = require('assert');
const { parseCurrencyVND, formatCurrencyVND } = require('../src/utils/currency');
const cases = [
  ['90000', 90000, '90.000'],
  ['68000', 68000, '68.000'],
  ['139000', 139000, '139.000'],
  ['1000000', 1000000, '1.000.000'],
  ['90.000', 90000, '90.000'],
  ['139.000', 139000, '139.000'],
  [95000 * 10, 950000, '950.000'],
  [250000 * 2, 500000, '500.000'],
];
for (const [input, parsed, formatted] of cases) {
  assert.strictEqual(parseCurrencyVND(input), parsed, `parse ${input}`);
  assert.strictEqual(formatCurrencyVND(input), formatted, `format ${input}`);
}
console.log('currency-vnd tests passed');
