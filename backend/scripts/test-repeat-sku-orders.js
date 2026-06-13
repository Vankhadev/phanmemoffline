const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const count = Math.max(1, Number(process.env.REPEAT_SKU_ORDER_COUNT || 1000) || 1000);
const sku = String(process.env.REPEAT_SKU || 'TEST-SKU-REPEAT-A').trim();
const tmpDir = path.join(repoRoot, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const tmpDbPath = path.join(tmpDir, `repeat-sku-orders-${Date.now()}.db.json`);
process.env.KHA_DB_PATH = tmpDbPath;

const sourceDbPath = path.join(repoRoot, 'backend', 'data', 'phanmienoffline.db.json');
const sourceDb = JSON.parse(fs.readFileSync(sourceDbPath, 'utf8'));

sourceDb.products = [];
sourceDb.invoices = [];
sourceDb.invoice_details = [];
sourceDb.cash_book = [];
sourceDb.accounting_transactions = [];
sourceDb.daily_stats = [];
sourceDb.counters = [];
sourceDb.nextId = {
  ...(sourceDb.nextId || {}),
  products: 1,
  invoices: 1,
  invoice_details: 1,
  cash_book: 1,
  accounting_transactions: 1,
  daily_stats: 1,
  counters: 1,
};

fs.writeFileSync(tmpDbPath, JSON.stringify(sourceDb, null, 2));

const {
  DB_PATH,
  getAll,
  getOne,
  insert,
  replaceTable,
} = require('../src/db/database');
const { createInvoiceFromPayload } = require('../src/services/invoiceCreationService');

function createOrder(product, index, detailOverrides = {}) {
  return createInvoiceFromPayload({
    customer_id: null,
    payment_method: 'cash',
    subtotal: 100,
    total: 100,
    paid_amount: 0,
    client_order_id: `repeat-sku-${Date.now()}-${index}`,
    details: [{
      product_id: product.id,
      product_name: product.name,
      name: product.name,
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      ...detailOverrides,
    }],
  }, { accountId: 1, user: { id: 1, name: 'Repeat SKU Test' } });
}

const productId = insert('products', {
  name: 'Repeat SKU Regression Product',
  sku,
  stock: count + 10,
  retail_price: 100,
  wholesale_price: 100,
  vip_price: 100,
  import_price: 0,
  unit: 'pcs',
  active: 1,
});
const product = getOne('products', row => Number(row.id) === Number(productId));
assert(product, 'Fixture product was not created');

let duplicateProductError = null;
try {
  insert('products', {
    name: 'Duplicate Repeat SKU Product',
    sku,
    stock: 0,
    retail_price: 100,
    active: 1,
  });
} catch (error) {
  duplicateProductError = error;
}
assert.strictEqual(duplicateProductError?.code, 'PRODUCT_SKU_DUPLICATE');

const legacyDuplicateProductId = Math.max(...getAll('products').map(row => Number(row.id) || 0)) + 1;
replaceTable('products', [
  ...getAll('products'),
  {
    ...product,
    id: legacyDuplicateProductId,
    name: 'Legacy Duplicate SKU Fixture',
    stock: 0,
  },
]);
const productsWithRepeatedSku = getAll('products', row => String(row.sku || '').trim() === sku);
assert.strictEqual(productsWithRepeatedSku.length, 2, 'Fixture must contain a legacy duplicate product SKU');

const first = createOrder(product, 1);
assert.strictEqual(first.created, true, 'First order with SKU A must succeed');
const second = createOrder(product, 2, { product_sku: 'STALE-ORDER-SKU', sku: 'STALE-ORDER-SKU' });
assert.strictEqual(second.created, true, 'Second order with SKU A must succeed');

for (let index = 3; index <= count; index += 1) {
  const result = createOrder(product, index);
  assert.strictEqual(result.created, true, `Order ${index} with repeated SKU must succeed`);
}

let missingProductError = null;
try {
  createInvoiceFromPayload({
    client_order_id: `missing-product-${Date.now()}`,
    subtotal: 100,
    total: 100,
    details: [{
      product_id: 999999999,
      product_name: 'Missing Product',
      quantity: 1,
      unit_price: 100,
      line_total: 100,
    }],
  }, { accountId: 1, user: { id: 1, name: 'Repeat SKU Test' } });
} catch (error) {
  missingProductError = error;
}

assert.strictEqual(missingProductError?.code, 'PRODUCT_NOT_FOUND');
assert(
  String(missingProductError.message || '').includes('Sản phẩm')
    && String(missingProductError.message || '').includes('không tồn tại trong hệ thống'),
  `Unexpected missing product message: ${missingProductError?.message || ''}`,
);

const testInvoices = getAll('invoices', row => String(row.client_order_id || '').startsWith('repeat-sku-'));
const testInvoiceIds = new Set(testInvoices.map(row => row.id));
const testDetails = getAll('invoice_details', row => testInvoiceIds.has(row.invoice_id));
const testInvoiceCodes = new Set(testInvoices.map(invoice => invoice.invoice_code));
const repeatedSkuDetails = testDetails.filter(detail => String(detail.product_sku || detail.sku || '').trim() === sku);

assert.strictEqual(testInvoices.length, count, 'Invoice count must match requested repeat count');
assert.strictEqual(testDetails.length, count, 'Invoice detail count must match requested repeat count');
assert.strictEqual(repeatedSkuDetails.length, count, 'Repeated SKU must be stored once per order line');
assert.strictEqual(testInvoiceCodes.size, count, 'Each order must have a unique invoice/order code');

console.log(JSON.stringify({
  ok: true,
  dbPath: DB_PATH,
  sku,
  requestedOrders: count,
  createdOrders: testInvoices.length,
  repeatedSkuOrderItems: repeatedSkuDetails.length,
  uniqueOrderCodes: testInvoiceCodes.size,
  legacyDuplicateSkuProducts: productsWithRepeatedSku.length,
  duplicateProductError: {
    code: duplicateProductError.code,
    status: duplicateProductError.status,
    message: duplicateProductError.message,
  },
  missingProductError: {
    code: missingProductError.code,
    status: missingProductError.status,
    message: missingProductError.message,
  },
}, null, 2));
