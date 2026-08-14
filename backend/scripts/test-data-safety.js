/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phanmienoffline-data-safety-'));
const dbPath = path.join(tempRoot, 'phanmienoffline.db.json');
process.env.KHA_DB_PATH = dbPath;
process.env.KHA_DB_BACKUP_DIR = path.join(tempRoot, 'backups');
process.env.KHA_SQLITE = '0';

const db = require('../src/db/database');

function writeLegacyFixture() {
  const legacy = {
    nextId: { products: 2, customers: 2, invoices: 2, invoice_details: 2, import_logs: 2 },
    products: [{ id: 1, sku: '123456', name: 'Sản phẩm cũ', stock: 8, active: 1 }],
    customers: [{ id: 1, name: 'Khách cũ', phone: '0900000000' }],
    invoices: [{ id: 1, invoice_code: 'DH000042', customer_id: 1, total: 100, status: 'completed', created_at: '2025-01-01T00:00:00.000Z' }],
    invoice_details: [{ id: 1, invoice_id: 1, product_id: 1, product_sku: '123456', product_name: 'Sản phẩm cũ', quantity: 1, unit_price: 100, line_total: 100 }],
    import_logs: [{ id: 1, import_code: 'PN00009', total: 50, status: 'received' }],
    import_details: [{ id: 1, import_id: 1, product_id: 1, quantity: 1, import_price: 50 }],
  };
  fs.writeFileSync(dbPath, JSON.stringify(legacy, null, 2), 'utf8');
}

function test() {
  writeLegacyFixture();
  db.loadDB({ forceReload: true });
  assert.strictEqual(db.getAll('invoices').length, 1, 'migration must retain legacy invoice');
  assert.strictEqual(db.getAll('invoice_details').length, 1, 'migration must retain legacy detail');
  assert.strictEqual(db.generateNextDocumentCode('invoice'), 'HD000043', 'HD sequence must continue DH');
  assert.strictEqual(db.generateNextDocumentCode('import'), 'NP00010', 'NP sequence must continue PN');

  const original = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const backup = db.createDbBackup('test-safety', { skipRetention: true });
  assert(backup && fs.existsSync(backup.path), 'backup must be created');
  const manifestPath = `${backup.path}.manifest.json`;
  assert(fs.existsSync(manifestPath), 'backup manifest must be created');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.valid, true, 'backup must be valid only after verification');
  assert.strictEqual(manifest.integrity_check, 'ok', 'backup integrity check must pass');
  const protectionPoint = db.createVerifiedDataProtectionPoint('test-protection', { skipRetention: true });
  assert(protectionPoint?.sha256, 'verified protection point must include a checksum');
  assert.strictEqual(protectionPoint.validation.ok, true, 'verified protection point must pass integrity validation');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dbPath, 'utf8')), original, 'backup must not modify source DB');

  db.withAtomicDbWrite(() => db.update('products', 1, { stock: 1 }, { skipSave: true }));
  const restored = db.restoreDbBackup(backup.path);
  assert.strictEqual(restored.ok, true, 'restore must succeed from verified backup');
  assert.strictEqual(db.getOne('products', { id: 1 }).stock, 8, 'restore must recover source data');
  assert.strictEqual(db.DB_PATH, dbPath, 'restore must not repoint DB_PATH');

  const badPath = path.join(tempRoot, 'bad-backup.json');
  fs.writeFileSync(badPath, '{bad json', 'utf8');
  assert.throws(() => db.restoreDbBackup(badPath, { allowLegacyBackup: true }), /backup|unexpected|integrity|expected property/i, 'corrupt backup must be rejected');
  assert.strictEqual(db.getOne('products', { id: 1 }).stock, 8, 'failed restore must leave active DB intact');

  const validation = db.validateDatabaseData(db.getDb(), { allowLegacyOrphans: false });
  assert.strictEqual(validation.ok, true, `foreign key check failed: ${validation.errors.join('; ')}`);
  console.log('PASS data safety regression tests');
}

try {
  test();
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (error) { console.error('Temporary cleanup failed:', error.message); }
}
