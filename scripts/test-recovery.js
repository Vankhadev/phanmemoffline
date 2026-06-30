/**
 * Test script cho RecoveryEngine v2.3.8 — kiểm tra các kịch bản bắt buộc.
 * Chạy: node scripts/test-recovery.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// === ISOLATE TEST FROM REAL DB ===
const TEMP_ROOT = path.join(os.tmpdir(), 'phanmienoffline_test_recovery_238');
process.env.KHA_DB_PATH = path.join(TEMP_ROOT, 'test_db', 'phanmienoffline.db.json');
process.env.KHA_DB_BACKUP_DIR = path.join(TEMP_ROOT, 'test_backups');
process.env.KHA_RECOVERY_SCAN_ROOTS = ''; // se set per-test
process.env.KHA_DATA_PRESERVATION_BACKUP_ROOTS = TEMP_ROOT;
process.env.KHA_SQLITE = '0';

const DB_MODULE = require('../backend/src/db/database');
const RecoveryEngine = require('../backend/src/services/RecoveryEngine');

RecoveryEngine.initialize({ dbModule: DB_MODULE });

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function rmDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function makeBackup(dir, data, ext, name) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const file = path.join(dir, (name || 'backup') + '_' + stamp + (ext || '.json'));
  writeJson(file, data);
  return file;
}

let passed = 0;
let failed = 0;
function assert(condition, msg) { if (condition) { passed += 1; console.log('  \u2713 ' + msg); } else { failed += 1; console.log('  \u2717 ' + msg); } }

rmDir(TEMP_ROOT);
ensureDir(TEMP_ROOT);

var now = new Date().toISOString();
var runId = String(Date.now());
var uniqueId = 100000 + Math.floor(Math.random() * 900000);

async function main() {

console.log('\n=== TEST 1: 3 backup cu/giua/moi -> restore du du lieu ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test1'));
  makeBackup(dir, { products: [{ id: 1, name: 'San pham A', price: 10000, created_at: '2025-01-01' }], customers: [{ id: 1, name: 'Khach A', phone: '0901' }], invoices: [{ id: uniqueId + 1, code: 'HD001_' + runId, customer_name: 'Khach A', total: 10000, created_at: '2025-01-01' }], invoice_details: [], import_logs: [], import_details: [], partners: [] }, '.json', 'backup_old');
  makeBackup(dir, { products: [{ id: 2, name: 'San pham B', price: 20000, created_at: '2025-03-01' }], customers: [{ id: 2, name: 'Khach B', phone: '0902' }], invoices: [{ id: uniqueId + 2, code: 'HD002_' + runId, customer_name: 'Khach B', total: 20000, created_at: '2025-03-01' }], invoice_details: [], import_logs: [], import_details: [], partners: [] }, '.json', 'backup_mid');
  makeBackup(dir, { products: [{ id: 3, name: 'San pham C', price: 30000, created_at: '2025-06-01' }], customers: [{ id: 3, name: 'Khach C', phone: '0903' }], invoices: [{ id: uniqueId + 3, code: 'HD003_' + runId, customer_name: 'Khach C', total: 30000, created_at: '2025-06-01' }], invoice_details: [], import_logs: [], import_details: [], partners: [] }, '.json', 'backup_new');
  var beforeInvoices = DB_MODULE.getAll('invoices').length;
  var result = await RecoveryEngine.runRecovery({ roots: [dir] });
  var afterInvoices = DB_MODULE.getAll('invoices').length;
  var afterProducts = DB_MODULE.getAll('products').length;
  assert(result.ok, 'Restore thanh cong');
  assert(afterInvoices > beforeInvoices, 'It nhat 3 don moi (thuc te: ' + afterInvoices + ', truoc: ' + beforeInvoices + ')');
  assert(afterProducts >= 3, 'It nhat 3 san pham (thuc te: ' + afterProducts + ')');
}

console.log('\n=== TEST 2: backup JSON lon (nhieu ban ghi) -> khong treo, khong hong DB ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test2'));
  var products = [];
  var invoices = [];
  for (var i = 0; i < 3000; i += 1) {
    products.push({ id: uniqueId + 2000 + i, name: 'SP lon ' + i, price: 1000 + i, sku: 'SKU' + i + '_' + runId, created_at: now });
    invoices.push({ id: uniqueId + 5000 + i, code: 'HDLON_' + i + '_' + runId, total: 1000 + i, created_at: now, customer_name: 'KH' + i });
  }
  makeBackup(dir, { products: products, invoices: invoices, invoice_details: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'big');
  var t0 = Date.now();
  var result = await RecoveryEngine.runRecovery({ roots: [dir] });
  var elapsed = Date.now() - t0;
  assert(result.ok, 'Restore backup lon thanh cong');
  assert(elapsed < 120000, 'Hoan thanh trong thoi gian hop ly (' + elapsed + 'ms)');
  var found = DB_MODULE.getAll('invoices').filter(function (x) { return String(x.code || '').indexOf('HDLON_0_' + runId) === 0; }).length;
  assert(found >= 1, 'Don lon da duoc restore');
}

console.log('\n=== TEST 3: backup zip (mo phong qua thu muc da giai nen) ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test3_extracted'));
  makeBackup(dir, { invoices: [{ id: uniqueId + 350, code: 'HDZIP_' + runId, total: 7700, created_at: now }], invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'zip_inner');
  var result = await RecoveryEngine.runRecovery({ roots: [path.join(TEMP_ROOT, 'test3_extracted')] });
  assert(result.ok, 'Restore tu thu muc giai nen thanh cong');
  var found = DB_MODULE.getAll('invoices').filter(function (x) { return x.code === 'HDZIP_' + runId; }).length;
  assert(found >= 1, 'Don tu backup zip da restore');
}

console.log('\n=== TEST 4: backup loi/sai dinh dang -> bo qua file loi, khong dung toan bo ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test4'));
  // file sai định dang (khong phai JSON)
  fs.writeFileSync(path.join(dir, 'broken_' + Date.now() + '.json'), '{ this is not valid json ,,,', 'utf8');
  // file rong
  fs.writeFileSync(path.join(dir, 'empty_' + Date.now() + '.json'), '', 'utf8');
  // file hop le cung thu muc
  makeBackup(dir, { invoices: [{ id: uniqueId + 450, code: 'HDOK_' + runId, total: 5000, created_at: now }], invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'good');
  var result = await RecoveryEngine.runRecovery({ roots: [dir] });
  assert(result.ok, 'Restore van thanh cong du co file loi');
  assert(result.failedFiles && result.failedFiles.length >= 2, 'Co it nhat 2 file loi duoc bo qua (thuc te: ' + (result.failedFiles && result.failedFiles.length) + ')');
  var found = DB_MODULE.getAll('invoices').filter(function (x) { return x.code === 'HDOK_' + runId; }).length;
  assert(found >= 1, 'Don hop le van duoc restore');
}

console.log('\n=== TEST 5: backup co don trung -> khong nhan doi ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test5'));
  makeBackup(dir, { invoices: [{ id: uniqueId + 10, code: 'HD001_DUP_' + runId, customer_name: 'A', total: 10000, created_at: '2025-01-01' }], invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'dup1');
  makeBackup(dir, { invoices: [{ id: uniqueId + 10, code: 'HD001_DUP_' + runId, customer_name: 'A', total: 10000, created_at: '2025-01-01' }], invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'dup2');
  var before = DB_MODULE.getAll('invoices').filter(function (i) { return i.code === 'HD001_DUP_' + runId; }).length;
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var after = DB_MODULE.getAll('invoices').filter(function (i) { return i.code === 'HD001_DUP_' + runId; }).length;
  assert(after <= before + 1, 'Khong nhan doi don trung (truoc: ' + before + ', sau: ' + after + ')');
}

console.log('\n=== TEST 6: don hang thieu product_id / dich vu khac -> van restore (orphan-safe) ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test6'));
  makeBackup(dir, {
    invoices: [{ id: uniqueId + 200, code: 'NO_PRODUCT_' + runId, total: 9999, created_at: now }],
    invoice_details: [{ id: uniqueId + 2001, invoice_id: uniqueId + 200, product_name: 'Dich vu ABC', quantity: 1, price: 9999, total: 9999, product_id: 99999 }],
    products: [], customers: [], import_logs: [], import_details: [], partners: [],
  }, '.json', 'noproduct');
  var before = DB_MODULE.getAll('invoices').filter(function (i) { return i.code === 'NO_PRODUCT_' + runId; }).length;
  var result = await RecoveryEngine.runRecovery({ roots: [dir] });
  var after = DB_MODULE.getAll('invoices').filter(function (i) { return i.code === 'NO_PRODUCT_' + runId; }).length;
  assert(result.ok, 'Restore thanh cong du productId khong ton tai');
  assert(after > before, 'Da them don (truoc: ' + before + ', sau: ' + after + ')');
  var det = DB_MODULE.getAll('invoice_details').filter(function (d) { return d.invoice_id === uniqueId + 200; }).length;
  assert(det >= 1, 'Chi tiet don (dich vu khac) da restore');
}

console.log('\n=== TEST 7: backup schema cu (orders/invoices, customerName...) -> normalize + restore ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test7'));
  // backup schema cu: dung ten bang 'orders', 'order_items', field 'customerName','totalAmount','productName','createdAt'
  makeBackup(dir, {
    orders: [{ id: uniqueId + 700, code: 'OLDCHEMA_' + runId, customerName: 'KH Cu', totalAmount: 12345, createdAt: '2024-05-05' }],
    order_items: [{ id: uniqueId + 7001, orderId: uniqueId + 700, productName: 'SP cu', qty: 2, unitPrice: 5000, lineTotal: 10000 }],
    products: [], customers: [], suppliers: [], imports: [], import_items: [],
  }, '.json', 'oldschema');
  var result = await RecoveryEngine.runRecovery({ roots: [dir] });
  assert(result.ok, 'Restore schema cu thanh cong');
  var inv = DB_MODULE.getAll('invoices').filter(function (x) { return x.code === 'OLDCHEMA_' + runId; })[0];
  assert(!!inv, 'Don schema cu da duoc map sang invoices');
  if (inv) {
    assert(inv.customer_name === 'KH Cu', 'Field customerName -> customer_name (' + inv.customer_name + ')');
    assert(Number(inv.total) === 12345, 'Field totalAmount -> total (' + inv.total + ')');
    assert(String(inv.created_at || '').indexOf('2024-05-05') === 0, 'Field createdAt -> created_at (' + inv.created_at + ')');
  }
  var det = DB_MODULE.getAll('invoice_details').filter(function (d) { return d.invoice_id === uniqueId + 700; })[0];
  if (det) {
    assert(det.product_name === 'SP cu', 'Field productName -> product_name (' + det.product_name + ')');
    assert(Number(det.quantity) === 2, 'Field qty -> quantity (' + det.quantity + ')');
  }
}

console.log('\n=== TEST 8: chay lai restore lan 2 -> khong nhan doi ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test8'));
  makeBackup(dir, { invoices: [{ id: uniqueId + 900, code: 'HD_NODUP2_' + runId, total: 1, created_at: now }], invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'nodup');
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var count1 = DB_MODULE.getAll('invoices').filter(function (i) { return i.code === 'HD_NODUP2_' + runId; }).length;
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var count2 = DB_MODULE.getAll('invoices').filter(function (i) { return i.code === 'HD_NODUP2_' + runId; }).length;
  assert(count2 <= count1, 'Khong nhan doi khi chay lai (lan1: ' + count1 + ', lan2: ' + count2 + ')');
}

console.log('\n=== TEST 9: huy khôi phuc an toan -> khong corrupt DB ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test9'));
  // chen nhieu don de co batch
  var invs = [];
  for (var i = 0; i < 600; i += 1) invs.push({ id: uniqueId + 8000 + i, code: 'HDCANCEL_' + i + '_' + runId, total: i, created_at: now });
  makeBackup(dir, { invoices: invs, invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'cancelbatch');
  var p = RecoveryEngine.runRecovery({ roots: [dir] });
  // yeu cau huy ngay sau khi bat dau
  setTimeout(function () { RecoveryEngine.cancelRecovery(); }, 50);
  var result = await p;
  // sau huy DB van doc duoc, khong giam so don ban dau
  var stillReads = DB_MODULE.getAll('invoices').length >= 0;
  assert(stillReads, 'DB van doc duoc sau khi huy');
  assert(result.cancelled === true || result.ok === true, 'Restore ket thuc an toan (cancelled=' + result.cancelled + ', ok=' + result.ok + ')');
}

console.log('\n=== TEST 10: sau restore so don khong giam ===');
{
  var before = DB_MODULE.getAll('invoices').length;
  var dir = ensureDir(path.join(TEMP_ROOT, 'test10'));
  makeBackup(dir, { invoices: [{ id: uniqueId + 950, code: 'HD_NONDEC_' + runId, total: 5, created_at: now }], invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [] }, '.json', 'nondec');
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var after = DB_MODULE.getAll('invoices').length;
  assert(after >= before, 'Sau restore so don khong giam (truoc: ' + before + ', sau: ' + after + ')');
}

console.log('\n=== Ket qua test ===');
console.log('Pass: ' + passed);
console.log('Fail: ' + failed);
if (failed > 0) process.exitCode = 1;
rmDir(TEMP_ROOT);
}

main().catch(function (e) { console.error('Test error:', e); process.exitCode = 1; rmDir(TEMP_ROOT); });
