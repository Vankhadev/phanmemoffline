const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phanmemoffline-combo-stock-'));
process.env.KHA_DB_PATH = path.join(testDir, 'combo-stock.db.json');
process.env.KHA_DB_BACKUP_DIR = path.join(testDir, 'backups');
process.env.KHA_SQLITE = '0';
process.env.KHA_SKIP_OLD_DB_MIGRATION = '1';

const { getOne, insert, withAtomicDbWrite } = require('../src/db/database');
const { createInvoiceFromPayload, applyInvoiceDetailsStock } = require('../src/services/invoiceCreationService');

function createProduct(name, stock) {
  const id = insert('products', {
    name,
    sku: `SKU-${name}`,
    stock,
    retail_price: 100,
    import_price: 50,
    active: 1,
  });
  return getOne('products', row => Number(row.id) === Number(id));
}

try {
  const first = createProduct('Combo component A', 20);
  const second = createProduct('Combo component B', 10);
  const comboId = insert('combos', { name: 'Combo regression', sku: 'COMBO-REGRESSION', active: 1 });
  insert('combo_items', { combo_id: comboId, product_id: first.id, quantity: 2 });
  insert('combo_items', { combo_id: comboId, product_id: second.id, quantity: 1 });

  const created = createInvoiceFromPayload({
    client_order_id: `combo-stock-${Date.now()}`,
    subtotal: 300,
    total: 300,
    paid_amount: 300,
    details: [{
      type: 'combo',
      item_type: 'combo',
      combo_id: comboId,
      product_name: 'Combo regression',
      quantity: 3,
      unit_price: 100,
      line_total: 300,
    }],
  }, { accountId: 1, user: { id: 1 } });

  assert.strictEqual(getOne('products', { id: first.id }).stock, 14, 'Combo must deduct every component quantity');
  assert.strictEqual(getOne('products', { id: second.id }).stock, 7, 'Combo must deduct each component');

  withAtomicDbWrite(() => applyInvoiceDetailsStock([{
    type: 'combo', combo_id: comboId, quantity: 3, product_name: 'Combo regression',
  }], 'restore', { skipSave: true, invoiceId: created.invoice_id, revision: 3 }));
  assert.strictEqual(getOne('products', { id: first.id }).stock, 20, 'Cancelled combo must restore first component');
  assert.strictEqual(getOne('products', { id: second.id }).stock, 10, 'Cancelled combo must restore second component');

  console.log('PASS combo invoice stock regression tests');
} finally {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
}
