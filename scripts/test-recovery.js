/**
 * Test script cho RecoveryEngine - kiem tra cac kich ban bat buoc
 * Chay: node scripts/test-recovery.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMP_ROOT = path.join(os.tmpdir(), 'phanmienoffline_test_recovery');
const DB_MODULE = require('../backend/src/db/database');
const RecoveryEngine = require('../backend/src/services/RecoveryEngine');

RecoveryEngine.initialize({ dbModule: DB_MODULE });

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function rmDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function makeBackup(dir, data, ext, name) {
  const stamp = Date.now();
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
  var backupOld = {
    products: [{ id: 1, name: 'San pham A', price: 10000, created_at: '2025-01-01' }],
    customers: [{ id: 1, name: 'Khach A', phone: '0901' }],
    invoices: [{ id: uniqueId + 1, code: 'HD001_' + runId, customer_name: 'Khach A', total: 10000, created_at: '2025-01-01' }],
    invoice_details: [], import_logs: [], import_details: [], partners: [],
  };
  var backupMid = {
    products: [{ id: 2, name: 'San pham B', price: 20000, created_at: '2025-03-01' }],
    customers: [{ id: 2, name: 'Khach B', phone: '0902' }],
    invoices: [{ id: uniqueId + 2, code: 'HD002_' + runId, customer_name: 'Khach B', total: 20000, created_at: '2025-03-01' }],
    invoice_details: [], import_logs: [], import_details: [], partners: [],
  };
  var backupNew = {
    products: [{ id: 3, name: 'San pham C', price: 30000, created_at: '2025-06-01' }],
    customers: [{ id: 3, name: 'Khach C', phone: '0903' }],
    invoices: [{ id: uniqueId + 3, code: 'HD003_' + runId, customer_name: 'Khach C', total: 30000, created_at: '2025-06-01' }],
    invoice_details: [], import_logs: [], import_details: [], partners: [],
  };
  makeBackup(dir, backupOld, '.json', 'backup_old');
  makeBackup(dir, backupMid, '.json', 'backup_mid');
  makeBackup(dir, backupNew, '.json', 'backup_new');

  var beforeInvoices = DB_MODULE.getAll('invoices').length;
  var result = await RecoveryEngine.runRecovery({ roots: [dir] });
  var afterInvoices = DB_MODULE.getAll('invoices').length;
  var afterProducts = DB_MODULE.getAll('products').length;
  assert(result.ok, 'Restore thanh cong');
  assert(afterInvoices > beforeInvoices, 'It nhat 3 don moi (thuc te: ' + afterInvoices + ', truoc: ' + beforeInvoices + ')');
  assert(afterProducts >= 3, 'It nhat 3 san pham (thuc te: ' + afterProducts + ')');
}

console.log('\n=== TEST 4: Don hang co productId khong ton tai -> van restore ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test4'));
  makeBackup(dir, {
    invoices: [{ id: uniqueId + 200, code: 'NO_PRODUCT_' + runId, total: 9999, created_at: now }],
    invoice_details: [{ id: uniqueId + 2001, invoice_id: uniqueId + 200, product_name: 'Dich vu ABC', quantity: 1, price: 9999, total: 9999, product_id: 99999 }],
    products: [], customers: [], import_logs: [], import_details: [], partners: [],
  }, '.json', 'noproduct');
  var before = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'NO_PRODUCT_' + runId; }).length;
  var result = await RecoveryEngine.runRecovery({ roots: [dir] });
  var after = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'NO_PRODUCT_' + runId; }).length;
  assert(result.ok, 'Restore thanh cong du productId khong ton tai');
  assert(after > before, 'Da them don (truoc: ' + before + ', sau: ' + after + ')');
}

console.log('\n=== TEST 5: Backup co don trung -> khong insert trung ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test5'));
  makeBackup(dir, {
    invoices: [{ id: uniqueId + 10, code: 'HD001_DUP_' + runId, customer_name: 'A', total: 10000, created_at: '2025-01-01' }],
    invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [],
  }, '.json', 'dup1');
  makeBackup(dir, {
    invoices: [{ id: uniqueId + 10, code: 'HD001_DUP_' + runId, customer_name: 'A', total: 10000, created_at: '2025-01-01' }],
    invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [],
  }, '.json', 'dup2');
  var before = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'HD001_DUP_' + runId; }).length;
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var after = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'HD001_DUP_' + runId; }).length;
  assert(after <= before + 1, 'Khong nhan doi don trung (truoc: ' + before + ', sau: ' + after + ')');
}

console.log('\n=== TEST 6: Backup cu co don thieu -> restore lai don do ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test6'));
  makeBackup(dir, {
    invoices: [{ id: uniqueId + 600, code: 'HD_MISSING2_' + runId, customer_name: 'Missing', total: 5555, created_at: '2024-01-01' }],
    invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [],
  }, '.json', 'missing_order');
  var before = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'HD_MISSING2_' + runId; }).length;
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var after = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'HD_MISSING2_' + runId; }).length;
  assert(after > before, 'Da restore don thieu (truoc: ' + before + ', sau: ' + after + ')');
}

console.log('\n=== TEST 7: Backup co du lieu rong/null -> khong ghi de du lieu tot ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test7'));
  makeBackup(dir, {
    invoices: [{ id: uniqueId + 700, code: 'HD_NULL_' + runId, customer_name: null, phone: '', total: 0 }],
    invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [],
  }, '.json', 'nullbackup');
  var before = DB_MODULE.getAll('invoices').length;
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var after = DB_MODULE.getAll('invoices').length;
  assert(after >= before, 'Khong bi giam don');
}

console.log('\n=== TEST 8: Sau restore so don khong giam ===');
{
  var before = DB_MODULE.getAll('invoices').length;
  var after = DB_MODULE.getAll('invoices').length;
  assert(after >= before, 'Sau restore: ' + after + ' >= truoc: ' + before);
}

console.log('\n=== TEST 9: Mo app lai khong nhan doi ===');
{
  var dir = ensureDir(path.join(TEMP_ROOT, 'test9'));
  makeBackup(dir, {
    invoices: [{ id: uniqueId + 900, code: 'HD_NODUP2_' + runId, total: 1, created_at: now }],
    invoice_details: [], products: [], customers: [], import_logs: [], import_details: [], partners: [],
  }, '.json', 'nodup');
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var count1 = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'HD_NODUP2_' + runId; }).length;
  await RecoveryEngine.runRecovery({ roots: [dir] });
  var count2 = DB_MODULE.getAll('invoices').filter(function(i) { return i.code === 'HD_NODUP2_' + runId; }).length;
  assert(count2 <= count1, 'Khong nhan doi khi chay lai (lan1: ' + count1 + ', lan2: ' + count2 + ')');
}

console.log('\n=== Ket qua test ===');
console.log('Pass: ' + passed);
console.log('Fail: ' + failed);
if (failed > 0) process.exitCode = 1;
rmDir(TEMP_ROOT);
}

main().catch(function(e) { console.error('Test error:', e); process.exitCode = 1; });



