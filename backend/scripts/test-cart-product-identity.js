const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phanmienoffline-cart-identity-'));
process.env.KHA_DB_PATH = path.join(tempRoot, 'phanmienoffline.db.json');
process.env.KHA_DB_BACKUP_DIR = path.join(tempRoot, 'backups');
process.env.KHA_SQLITE = '0';
process.env.KHA_SKIP_OLD_DB_MIGRATION = '1';

const db = require('../src/db/database');
const { createInvoiceFromPayload } = require('../src/services/invoiceCreationService');

try {
  const productId = db.insert('products', {
    name: '1 CÂY NẾN NƯỚC ĐIỆN 8.5X26(CM) Cầu vồng',
    sku: 'CANDLE-RAINBOW', stock: 5, retail_price: 100, import_price: 50, active: 1,
  });
  const result = createInvoiceFromPayload({
    client_order_id: `cart-identity-${Date.now()}`,
    subtotal: 100, total: 100, paid_amount: 100,
    // This is intentionally only the cart identity snapshot. It proves order
    // creation never depends on a transient frontend search-results cache.
    details: [{ product_id: productId, product_name: '1 CÂY NẾN NƯỚC ĐIỆN 8.5X26(CM) Cầu vồng', quantity: 1, unit_price: 100, line_total: 100 }],
  }, { accountId: 1, user: { id: 1 } });
  assert.strictEqual(result.created, true, 'product selected from an expired search cache must still create an invoice');
  assert.strictEqual(db.getOne('products', { id: productId }).stock, 4, 'authoritative backend validation must deduct stock');
  console.log('PASS cart product identity regression test');
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
}
