const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phanmemoffline-payment-stats-'));
const dbPath = path.join(testDir, 'payment-stats.db.json');
process.env.KHA_DB_PATH = dbPath;
process.env.KHA_DB_BACKUP_DIR = path.join(testDir, 'backups');
process.env.KHA_SQLITE = '0';
process.env.KHA_SKIP_OLD_DB_MIGRATION = '1';

const { insert, getOne } = require('../src/db/database');
const invoicesRouter = require('../src/routes/invoices');
const statsRouter = require('../src/routes/stats');

async function main() {
  const productId = insert('products', {
    name: 'Payment stats test product', sku: `PAYMENT-STATS-${Date.now()}`,
    stock: 10, import_price: 50, retail_price: 100, active: 1,
  });
  const now = new Date().toISOString();
  const invoiceId = insert('invoices', {
    invoice_code: `HD-PAY-${Date.now()}`,
    status: 'pending', subtotal: 100, total: 100, paid_amount: 0,
    remaining_amount: 100, customer_id: null, created_at: now, updated_at: now,
  });
  insert('invoice_details', {
    invoice_id: invoiceId, product_id: productId, product_name: 'Payment stats test product',
    product_sku: `PAYMENT-STATS-${Date.now()}`, quantity: 1, unit_price: 100,
    import_price: 50, cost_price_at_sale: 50, line_total: 100,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.accountId = 1; req.user = { id: 1 }; next(); });
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/stats', statsRouter);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = server.address().port;
    const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/invoices/${invoiceId}/confirm`, { method: 'PATCH' });
    const confirmBody = await confirmResponse.json();
    assert.strictEqual(confirmResponse.status, 200, JSON.stringify(confirmBody));
    const saved = getOne('invoices', row => Number(row.id) === Number(invoiceId));
    assert.strictEqual(saved.status, 'completed');
    assert.strictEqual(Number(saved.paid_amount), 100);
    assert.strictEqual(saved.payment_status, 'paid');

    const reportResponse = await fetch(`http://127.0.0.1:${port}/api/stats/product-report?from=${now.slice(0, 10)}&to=${now.slice(0, 10)}&period=custom&status=completed`);
    const report = await reportResponse.json();
    assert.strictEqual(reportResponse.status, 200, JSON.stringify(report));
    assert.strictEqual(report.summary.orderCount, 1, JSON.stringify(report));
    assert.strictEqual(reportResponse.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, proxy-revalidate');
    console.log('PASS payment-to-stats regression test');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {} });
