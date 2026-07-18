const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phanmemoffline-legacy-sku-'));
const dbPath = path.join(testDir, 'legacy-sku.db.json');

process.env.KHA_DB_PATH = dbPath;
process.env.KHA_DB_BACKUP_DIR = path.join(testDir, 'backups');
process.env.KHA_SQLITE = '0';
process.env.KHA_SKIP_OLD_DB_MIGRATION = '1';

const {
  getAll,
  getOne,
  insert,
  update,
  generateNextDocumentCode,
} = require('../src/db/database');
const { createInvoiceFromPayload } = require('../src/services/invoiceCreationService');
const invoicesRouter = require('../src/routes/invoices');

function createProduct(name, sku) {
  const id = insert('products', {
    name,
    sku,
    stock: 10,
    retail_price: 100,
    wholesale_price: 100,
    vip_price: 100,
    import_price: 50,
    unit: 'cái',
    active: 1,
  });
  return getOne('products', row => Number(row.id) === Number(id));
}

async function main() {
  // Mã cũ phải được tính vào bộ đếm để chuyển prefix không cấp lại số từ đầu.
  insert('invoices', { invoice_code: 'DH000999', total: 0, status: 'completed' });
  insert('import_logs', { import_code: 'PN00999', total: 0, status: 'received' });

  const products = [
    createProduct('SKU số nhập tay', 123456),
    createProduct('SKU chữ nhập tay', 'MA-HANG-CU-01'),
    createProduct('SKU dạng SP cũ', 'sp000435'),
  ];

  assert.strictEqual(products[0].sku, '123456', 'SKU số phải được lưu dưới dạng chuỗi ổn định');

  const created = createInvoiceFromPayload({
    client_order_id: `legacy-sku-edit-${Date.now()}`,
    subtotal: 300,
    total: 300,
    paid_amount: 0,
    details: products.map(product => ({
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      sku: product.sku,
      quantity: 1,
      unit_price: 100,
      cost_price_at_sale: 50,
      line_total: 100,
    })),
  }, { accountId: 1, user: { id: 1, name: 'Legacy SKU Test' } });

  assert(/^HD\d{6,}$/i.test(created.invoice_code), `Mã đơn mới phải dùng HD, nhận được ${created.invoice_code}`);
  assert(Number(created.invoice_code.replace(/\D/g, '')) > 999, 'Bộ đếm HD phải tiếp tục sau mã DH cũ');

  const generatedImportCode = generateNextDocumentCode('import');
  assert(/^NP\d{5,}$/i.test(generatedImportCode), `Mã nhập hàng mới phải dùng NP, nhận được ${generatedImportCode}`);
  assert(Number(generatedImportCode.replace(/\D/g, '')) > 999, 'Bộ đếm NP phải tiếp tục sau mã PN cũ');

  const savedDetails = getAll('invoice_details', row => Number(row.invoice_id) === Number(created.invoice_id));
  assert.strictEqual(savedDetails.length, 3, 'Đơn test phải có đủ 3 dòng SKU');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.accountId = 1;
    req.user = { id: 1, name: 'Legacy SKU Test' };
    next();
  });
  app.use('/api/invoices', invoicesRouter);

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = server.address().port;
    const prices = [110, 120, 130];
    const details = savedDetails.map((detail, index) => ({
      ...detail,
      // Ba kiểu dữ liệu cũ thường gặp: SKU số, product_id cũ không còn đúng, và chỉ còn SKU.
      product_id: index === 1 ? 999999999 : (index === 2 ? null : detail.product_id),
      variant_id: null,
      product_sku: index === 0 ? Number(detail.product_sku) : detail.product_sku,
      sku: index === 0 ? Number(detail.sku) : detail.sku,
      unit_price: prices[index],
      sale_price_at_sale: prices[index],
      line_total: prices[index],
    }));

    const response = await fetch(`http://127.0.0.1:${port}/api/invoices/${created.invoice_id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subtotal: prices.reduce((sum, value) => sum + value, 0),
        total: prices.reduce((sum, value) => sum + value, 0),
        details,
      }),
    });
    const body = await response.json();
    assert.strictEqual(response.status, 200, `Sửa hóa đơn thất bại: ${JSON.stringify(body)}`);
    assert.strictEqual(body.ok, true, `Backend không xác nhận lưu thành công: ${JSON.stringify(body)}`);

    const persisted = getAll('invoice_details', row => Number(row.invoice_id) === Number(created.invoice_id))
      .sort((a, b) => Number(a.id) - Number(b.id));
    assert.deepStrictEqual(persisted.map(row => Number(row.unit_price)), prices, 'Giá sửa phải được lưu đúng');
    assert.deepStrictEqual(
      persisted.map(row => String(row.product_sku)),
      ['123456', 'MA-HANG-CU-01', 'sp000435'],
      'SKU snapshot cũ phải được giữ nguyên sau khi sửa hóa đơn',
    );
    assert.deepStrictEqual(
      products.map(product => Number(getOne('products', row => Number(row.id) === Number(product.id)).stock)),
      [9, 9, 9],
      'Sửa giá không được trừ kho lần thứ hai',
    );

    console.log(JSON.stringify({
      ok: true,
      invoice_code: created.invoice_code,
      import_code: generatedImportCode,
      tested_skus: persisted.map(row => row.product_sku),
      saved_prices: persisted.map(row => row.unit_price),
      final_stocks: products.map(product => getOne('products', row => Number(row.id) === Number(product.id)).stock),
    }, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });
