/**
 * RecoveryEngine v2.3.8 — Khôi phục dữ liệu an toàn, KHÔNG treo giao diện.
 *
 * Điểm khác biệt so với v2.3.7 (nguyên nhân treo đã được sửa):
 *   - Toàn bộ quá trình (quét ổ, đọc file, giải nén, parse, merge) chạy nền
 *     và CHIA NHỎ thành các chunk, xen kẽ `await yieldToEventLoop()` để
 *     Node.js event loop vẫn phục vụ Express (UI poll /api/recovery/status).
 *   - Mỗi file backup có try/catch riêng + timeout 180s; 1 file lỗi không làm
 *     treo/dừng toàn bộ.
 *   - Giới hạn kích thước file (mặc định 256MB), đọc stream cho file lớn.
 *   - Progress chi tiết: ổ đang quét, số file tìm thấy, file đang xử lý,
 *     số bản ghi khôi phục từng loại, file lỗi/bỏ qua, % tiến trình.
 *   - Snapshot trước restore + rollback; log tiếng Việt ra file .txt.
 *   - Normalize field-level cho schema cũ (invoices→orders, customerName→
 *     customer_name, productName→product_name, totalAmount→total,
 *     created_at/createdAt/date...).
 *   - Hủy an toàn theo batch; checkpoint sau mỗi batch.
 *   - Không bỏ sót backup hợp lệ: quét C/D/E/F/USB, ưu tiên thư mục backup.
 *   - Sắp xếp cũ → mới; merge + dedup; orphan-safe cho đơn thiếu product/customer.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const VERSION = '2.3.8';

const BACKUP_EXTENSIONS = ['.json', '.db', '.sqlite', '.sqlite3', '.bak', '.backup', '.sql', '.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz'];
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz'];
const IMPORTANT_TABLES = ['invoices', 'invoice_details', 'products', 'customers', 'partners', 'import_logs', 'import_details'];

// Bảng chuẩn (schema hiện tại) và các alias tên bảng từ backup cũ.
const ALIAS_TABLES = {
  orders: 'invoices', invoices: 'invoices', sales: 'invoices', receipts: 'invoices', bills: 'invoices',
  order_items: 'invoice_details', invoice_items: 'invoice_details', invoice_details: 'invoice_details', sales_items: 'invoice_details', order_lines: 'invoice_details',
  products: 'products', items: 'products', goods: 'products',
  customers: 'customers', clients: 'customers', customer: 'customers',
  suppliers: 'partners', partners: 'partners', vendors: 'partners',
  imports: 'import_logs', purchase_orders: 'import_logs', import_logs: 'import_logs', purchases: 'import_logs',
  import_items: 'import_details', purchase_items: 'import_details', import_details: 'import_details', purchase_lines: 'import_details',
  payments: 'cash_book', expenses: 'cash_book', cashbook: 'cash_book', cash_book: 'cash_book',
  ledger: 'accounting_transactions', accounting_transactions: 'accounting_transactions',
  debts: 'customer_debts', customer_debts: 'customer_debts', supplier_debts: 'supplier_debts',
  settings: 'system_settings', system_settings: 'system_settings', print_templates: 'print_templates',
  users: 'users', categories: 'product_categories', product_categories: 'product_categories',
  service_items: 'invoice_details', other_services: 'invoice_details',
  logs: 'audit_logs', audit_logs: 'audit_logs',
};

// Map tên field cũ → tên field schema hiện tại, theo bảng.
const FIELD_ALIASES = {
  invoices: {
    orderId: 'id', invoiceId: 'id', orderCode: 'code', invoiceCode: 'code', number: 'code',
    customerName: 'customer_name', customerPhone: 'customer_phone', customerAddress: 'customer_address',
    customerId: 'customer_id', client_id: 'customer_id',
    totalAmount: 'total', grandTotal: 'total', amount: 'total', finalTotal: 'total',
    subTotal: 'subtotal', discountAmount: 'discount', discountValue: 'discount',
    paidAmount: 'paid', remainingAmount: 'remaining', changeAmount: 'change',
    createdAt: 'created_at', createdTime: 'created_at', date: 'created_at', orderDate: 'created_at', time: 'created_at',
    updatedAt: 'updated_at', modifiedAt: 'updated_at',
    statusName: 'status', orderStatus: 'status', invoiceStatus: 'status',
    noteText: 'note', description: 'note', remark: 'note',
    sellerId: 'user_id', cashierId: 'user_id', staffId: 'user_id',
  },
  invoice_details: {
    itemId: 'id', lineId: 'id',
    invoiceId: 'invoice_id', orderId: 'invoice_id', orderCode: 'invoice_id',
    productId: 'product_id', sku: 'product_sku', barcode: 'product_barcode',
    productName: 'product_name', name: 'product_name', itemName: 'product_name', title: 'product_name',
    qty: 'quantity', count: 'quantity',
    unitPrice: 'unit_price', pricePerUnit: 'unit_price', sellPrice: 'unit_price', salePrice: 'sale_price_at_sale',
    lineTotal: 'total', lineSubtotal: 'total', amount: 'total',
    capitalPrice: 'cost', costPrice: 'cost', importPrice: 'cost',
    lineProfit: 'profit', profitAmount: 'profit',
  },
  products: {
    productCode: 'code', code: 'code', sku: 'sku', barCode: 'barcode', barcode: 'barcode',
    productName: 'name', title: 'name', itemName: 'name',
    salePrice: 'price', price: 'price', unitPrice: 'price',
    importPrice: 'cost', costPrice: 'cost', capitalPrice: 'cost',
    categoryName: 'category', category: 'category', catId: 'category_id',
    inStock: 'stock', qty: 'stock', quantity: 'stock', stockQty: 'stock',
    createdAt: 'created_at', createdTime: 'created_at', date: 'created_at',
    updatedAt: 'updated_at', modifiedAt: 'updated_at',
  },
  customers: {
    customerId: 'id', name: 'name', fullName: 'name', customerName: 'name',
    phone: 'phone', tel: 'phone', mobile: 'phone',
    email: 'email', mail: 'email',
    address: 'address', addr: 'address', fullAddress: 'address',
    createdAt: 'created_at', createdTime: 'created_at', date: 'created_at',
    updatedAt: 'updated_at', modifiedAt: 'updated_at',
  },
  partners: {
    supplierId: 'id', partnerId: 'id', supplierName: 'name', partnerName: 'name', name: 'name',
    phone: 'phone', tel: 'phone', email: 'email', address: 'address',
    createdAt: 'created_at', date: 'created_at', updatedAt: 'updated_at',
  },
  import_logs: {
    importId: 'id', importCode: 'code', code: 'code', number: 'code',
    supplierId: 'supplier_id', partnerId: 'supplier_id', supplierName: 'supplier_name', partnerName: 'supplier_name',
    totalAmount: 'total', grandTotal: 'total', amount: 'total',
    createdAt: 'created_at', date: 'created_at', importDate: 'created_at', time: 'created_at',
    updatedAt: 'updated_at', modifiedAt: 'updated_at',
  },
  import_details: {
    itemId: 'id', lineId: 'id',
    importId: 'import_id', importCode: 'import_id',
    productId: 'product_id', productName: 'product_name', name: 'product_name',
    qty: 'quantity', count: 'quantity',
    unitPrice: 'unit_price', price: 'unit_price', cost: 'cost', costPrice: 'cost',
    lineTotal: 'total', amount: 'total',
  },
  print_templates: { id: 'id', key: 'key', name: 'name', code: 'code', content: 'content', body: 'content' },
};

const DEFAULT_FILE_TIMEOUT_MS = 180000;       // 180s/file
const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024; // 256MB
const DEFAULT_BATCH_SIZE = 200;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information', 'windows',
  'program files', 'program files (x86)', 'programdata', 'appdata', 'temp',
  'tmp', 'cache', 'cache2', 'cookies', '.cache', 'i386', 'amd64', 'drivers',
  'driverstore', 'winsxs', 'assembly', 'msocache', 'recovery', '$windows.~bt',
  '$windows.~ws', 'intel', 'perflogs', 'config.msi', 'vendor', 'dist', 'build',
  'release', '.tmp', '.npm-cache', '.electron-cache', '.electron-builder-cache',
]);
const PRIORITY_DIRS = new Set([
  'backup', 'backups', 'backup_du_lieu_phan_mem_no_del', 'data', 'database',
  'db', 'restore', 'phanmemoffline', 'phanmienoffline', 'pos', 'sales', 'app-data',
  'userdata', 'user-data', 'documents', 'desktop', 'downloads',
]);

let dbModule = null;
let initialized = false;
let running = false;
let cancelRequested = false;
let status = { running: false, progress: 'Chưa chạy', phase: 'idle', lastReport: null, lastLogPath: null, foundFiles: [], details: {} };

// ---- helpers ----
function initialize(options = {}) {
  dbModule = options.dbModule || require('../db/database');
  initialized = true;
}
function stamp(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}
function safeJsonClone(v) { return JSON.parse(JSON.stringify(v || {})); }
function hasValue(v) { return !(v === null || v === undefined || (typeof v === 'string' && v.trim() === '')); }
function norm(v) { return String(v ?? '').trim().toLowerCase(); }
function money(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function hashObject(v) { try { return Buffer.from(JSON.stringify(v ?? null)).toString('base64').slice(0, 80); } catch (_) { return String(v); } }
function isArchive(file) { const l = String(file).toLowerCase(); return ARCHIVE_EXTENSIONS.some(ext => l.endsWith(ext)); }
function isCandidate(file) { const l = String(file).toLowerCase(); return BACKUP_EXTENSIONS.some(ext => l.endsWith(ext)); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function getLogDir() { return ensureDir(path.resolve(process.env.KHA_RECOVERY_LOG_DIR || path.join(process.cwd(), 'logs', 'recovery'))); }
function getTempRoot() { return ensureDir(path.resolve(process.env.KHA_RECOVERY_TEMP_DIR || path.join(os.tmpdir(), 'phanmienoffline', 'recovery_temp'))); }
function setProgress(text, extra = {}) { status.progress = text; status.details = { ...status.details, ...extra }; }

// Trả quyền cho Node event loop giữa các chunk nặng -> Express vẫn phục vụ UI.
function yieldToEventLoop() { return new Promise(resolve => setImmediate(resolve)); }

class Logger {
  constructor(filePath) { this.filePath = filePath; this.lines = []; }
  add(line) { const ts = new Date().toLocaleString('vi-VN'); const full = `[${ts}] ${line}`; this.lines.push(full); }
  flush() { try { fs.writeFileSync(this.filePath, this.lines.join('\r\n') + '\r\n', 'utf8'); } catch (_) {} }
}
function countTables(db) { return IMPORTANT_TABLES.reduce((acc, t) => { acc[t] = Array.isArray(db[t]) ? db[t].length : 0; return acc; }, {}); }

// ---- quét ổ ----
function listExistingDrives() {
  if (process.env.KHA_RECOVERY_SCAN_ROOTS) return process.env.KHA_RECOVERY_SCAN_ROOTS.split(';').map(s => s.trim()).filter(Boolean);
  if (process.platform !== 'win32') return ['/'];
  const roots = [];
  for (let code = 67; code <= 90; code += 1) { // C..Z
    const root = `${String.fromCharCode(code)}:\\`;
    try { if (fs.existsSync(root)) roots.push(root); } catch (_) {}
  }
  return roots;
}

async function walkAsync(dir, onFile, options = {}, logger) {
  const maxFiles = Math.max(1, Number(options.maxFiles) || 200000);
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 40;
  const state = options.state || { count: 0, dirsScanned: 0 };
  if (state.count >= maxFiles || maxDepth < 0) return;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  state.dirsScanned += 1;
  // Thư mục ưu tiên lên trước để tìm nhanh backup.
  items.sort((a, b) => (PRIORITY_DIRS.has(b.name.toLowerCase()) ? 1 : 0) - (PRIORITY_DIRS.has(a.name.toLowerCase()) ? 1 : 0));
  for (const item of items) {
    if (cancelRequested) break;
    if (state.count >= maxFiles) break;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      const name = item.name.toLowerCase();
      if (SKIP_DIRS.has(name) || name.startsWith('$') || name.startsWith('.')) continue;
      // Chỉ đi sâu nếu thư mục "có vẻ" chứa backup, hoặc đang ở độ sâu nông.
      if (maxDepth < 12 && !PRIORITY_DIRS.has(name) && !name.includes('backup') && !name.includes('phan') && !name.includes('pos') && !name.includes('sales') && !name.includes('data')) {
        continue;
      }
      if (state.dirsScanned % 50 === 0) { await yieldToEventLoop(); if (logger) logger.add(`  Đã quét ${state.dirsScanned} thư mục...`); }
      await walkAsync(full, onFile, { ...options, maxDepth: maxDepth - 1, state }, logger);
    } else if (item.isFile()) {
      state.count += 1;
      if (isCandidate(full)) onFile(full);
      if (state.count % 500 === 0) { await yieldToEventLoop(); }
    }
  }
}

async function scanBackups(options = {}, logger) {
  const drives = options.roots || listExistingDrives();
  const found = new Map();
  for (const drive of drives) {
    if (cancelRequested) break;
    setProgress(`Đang quét ổ ${drive}...`, { scanningDrive: drive });
    logger.add(`Bắt đầu quét ổ ${drive}`);
    await walkAsync(drive, file => {
      try {
        const st = fs.statSync(file);
        if (st.size > (options.maxFileBytes || DEFAULT_MAX_FILE_BYTES)) {
          logger.add(`  Bỏ qua file quá lớn (>256MB): ${file} (${st.size} bytes)`);
          return;
        }
        found.set(path.resolve(file).toLowerCase(), { path: path.resolve(file), size: st.size, mtimeMs: st.mtimeMs, createdMs: st.birthtimeMs });
      } catch (_) {}
    }, { maxFiles: options.maxFiles, maxDepth: options.maxDepth, maxFileBytes: options.maxFileBytes }, logger);
    await yieldToEventLoop();
  }
  return { drives, files: Array.from(found.values()) };
}

function runTool(command, args, timeoutMs) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs || 120000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result;
}
function find7Zip() {
  const candidates = [process.env.KHA_7ZIP_PATH, 'C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].filter(Boolean);
  return candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}
async function extractArchive(file, report, logger, options) {
  const tempDir = fs.mkdtempSync(path.join(getTempRoot(), 'extract-'));
  try {
    const lower = file.toLowerCase();
    logger.add(`Đang giải nén: ${file}`);
    if (lower.endsWith('.zip')) {
      runTool('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${JSON.stringify(file)} -DestinationPath ${JSON.stringify(tempDir)} -Force`], options.fileTimeoutMs);
    } else if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz')) {
      const out = path.join(tempDir, path.basename(file).replace(/\.gz$/i, ''));
      fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(file)));
    } else {
      const sevenZip = find7Zip();
      if (!sevenZip) { throw new Error('Thiếu công cụ 7-Zip để giải nén rar/7z/tar/tar.gz'); }
      runTool(sevenZip, ['x', '-y', `-o${tempDir}`, file], options.fileTimeoutMs);
    }
    report.archiveFilesExtracted.push({ path: file, tempDir });
    const nested = [];
    await walkAsync(tempDir, f => {
      try { const st = fs.statSync(f); nested.push({ path: f, extractedFrom: file, mtimeMs: st.mtimeMs, size: st.size }); } catch (_) {}
    }, { maxFiles: 20000, maxDepth: 20 }, logger);
    return nested;
  } catch (error) {
    report.failedFiles.push({ path: file, error: error.message });
    logger.add(`Lỗi giải nén ${file}: ${error.message}`);
    return [];
  }
}

// ---- timestamp & sắp xếp ----
function parseTimestampFromName(file) {
  const s = path.basename(file);
  const m = s.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[T _-]?([0-2]\d)?[-_]?([0-5]\d)?[-_]?([0-5]\d)?/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function sortBackups(files) {
  return files.sort((a, b) => (parseTimestampFromName(a.path) || a.createdMs || a.mtimeMs || 0) - (parseTimestampFromName(b.path) || b.createdMs || b.mtimeMs || 0));
}

// ---- đọc backup ----
function readBackupFileSync(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.sql')) throw new Error('Chưa hỗ trợ parse SQL dump an toàn, đã bỏ qua để không làm hỏng dữ liệu');
  const raw = fs.readFileSync(file);
  const text = (lower.endsWith('.gz') || (raw[0] === 0x1f && raw[1] === 0x8b)) ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return JSON.parse(text);
}

// Đọc file lớn theo stream để không chiếm RAM đột biến; parse JSON an toàn.
function readBackupFileStream(file) {
  return new Promise((resolve, reject) => {
    const lower = file.toLowerCase();
    let stream = fs.createReadStream(file);
    if (lower.endsWith('.gz') || lower === '.tar.gz') { stream = stream.pipe(zlib.createGunzip()); }
    const chunks = [];
    let total = 0;
    const MAX = DEFAULT_MAX_FILE_BYTES;
    stream.on('data', c => { total += c.length; if (total > MAX) { stream.destroy(); reject(new Error('File backup quá lớn (>256MB), đã bỏ qua')); return; } chunks.push(c); });
    stream.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error('JSON lỗi: ' + e.message)); } });
    stream.on('error', reject);
  });
}

// ---- normalize ----
function normalizeRow(table, row) {
  if (!row || typeof row !== 'object') return row;
  const aliases = FIELD_ALIASES[table];
  if (!aliases) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const target = aliases[k] || k;
    if (!hasValue(out[target])) out[target] = v; // không ghi đè trường đã có sẵn
  }
  return out;
}

function normalizeBackupData(data) {
  if (!data || typeof data !== 'object') return null;
  const src = data.database && typeof data.database === 'object' ? data.database : data;
  const out = {};
  // 1) map alias tên bảng -> bảng chuẩn
  for (const [key, table] of Object.entries(ALIAS_TABLES)) {
    if (Array.isArray(src[key])) {
      out[table] = out[table] || [];
      for (const row of src[key]) out[table].push(normalizeRow(table, row));
    }
  }
  // 2) bảng đã đúng tên schema
  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    if (Array.isArray(src[table])) {
      out[table] = out[table] || [];
      for (const row of src[table]) out[table].push(normalizeRow(table, row));
    }
  }
  out.nextId = src.nextId || src.next_id || null;
  return Object.keys(out).some(k => Array.isArray(out[k]) && out[k].length) ? out : null;
}

// ---- dedup keys ----
function pickKey(prefix, values, fallback) {
  const value = values.find(hasValue);
  return value == null ? fallback : prefix + ':' + String(value);
}
function buildKey(table, row, index = 0) {
  const r = row || {};
  if (table === 'invoices') return pickKey('order', [r.id, r.code], `orderhash:${norm(r.created_at)}|${norm(r.customer_name)}|${norm(r.customer_phone)}|${money(r.total)}|${hashObject(r.items || r.details || '')}`);
  if (table === 'invoice_details') return pickKey('item', [r.id], `itemhash:${r.invoice_id || r.invoice_code || ''}|${norm(r.product_name)}|${r.quantity}|${r.unit_price}|${r.total}|${index}|${hashObject(r)}`);
  if (table === 'products') return pickKey('product', [r.id, r.sku, r.barcode, r.code], `producthash:${norm(r.name)}|${norm(r.category)}`);
  if (table === 'customers') return pickKey('customer', [r.id, r.phone, r.email], `customerhash:${norm(r.name)}|${norm(r.address)}`);
  if (table === 'partners') return pickKey('supplier', [r.id, r.phone, r.email, r.name], `supplierhash:${hashObject(r)}`);
  if (table === 'import_logs') return pickKey('import', [r.id, r.code], `importhash:${r.supplier_id || norm(r.supplier_name)}|${norm(r.created_at)}|${money(r.total)}`);
  if (table === 'import_details') return pickKey('importitem', [r.id], `importitemhash:${r.import_id || r.import_code || ''}|${norm(r.product_name)}|${r.quantity}|${r.unit_price}|${index}|${hashObject(r)}`);
  if (table === 'print_templates') return pickKey('template', [r.id, r.key, r.name, r.code], `templatehash:${hashObject(r)}`);
  return pickKey(table, [r.id, r.code, r.key, r.uuid], `${table}hash:${hashObject(r)}`);
}

// ---- merge ----
function mergeFields(existing, incoming, table) {
  const historical = new Set(['invoices', 'invoice_details', 'import_logs', 'import_details']);
  const moneyFields = new Set(['price', 'cost', 'unit_price', 'sale_price_at_sale', 'total', 'subtotal', 'discount', 'profit', 'capital_price']);
  let changed = false;
  for (const [k, v] of Object.entries(incoming || {})) {
    if (!hasValue(v)) continue;
    if (!hasValue(existing[k])) { existing[k] = v; changed = true; continue; }      // backfill trường trống
    if (historical.has(table) && moneyFields.has(k)) continue;                      // giữ giá lịch sử, không đè
    const inTime = Date.parse(incoming.updated_at || incoming.updatedAt || 0);
    const exTime = Date.parse(existing.updated_at || existing.updatedAt || 0);
    if (inTime && exTime && inTime > exTime && JSON.stringify(existing[k]) !== JSON.stringify(v)) { existing[k] = v; changed = true; }
  }
  return changed;
}
function ensureNextIds(db) {
  db.nextId = db.nextId || {};
  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    const maxId = Array.isArray(db[table]) ? db[table].reduce((m, r) => Math.max(m, Number(r && r.id) || 0), 0) : 0;
    db.nextId[table] = Math.max(Number(db.nextId[table]) || 1, maxId + 1);
  }
}

// Merge theo batch để UI có checkpoint; có thể hủy giữa batch.
async function mergeDataset(current, incoming, report, logger, options) {
  const restored = report.restoredCounts;
  const skipped = report.skippedDuplicates;
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    if (!Array.isArray(incoming[table])) continue;
    if (!Array.isArray(current[table])) current[table] = [];
    const index = new Map(current[table].map((row, i) => [buildKey(table, row, i), row]));
    const rows = incoming[table];
    for (let i = 0; i < rows.length; i += batchSize) {
      if (cancelRequested) { logger.add(`Đã hủy ở bảng ${table}, batch ${Math.floor(i / batchSize) + 1}`); report.cancelled = true; return; }
      const batch = rows.slice(i, i + batchSize);
      for (let j = 0; j < batch.length; j += 1) {
        const row = batch[j];
        if (!row || typeof row !== 'object') continue;
        const key = buildKey(table, row, i + j);
        const existing = index.get(key);
        if (existing) {
          const changed = mergeFields(existing, row, table);
          if (changed) restored[`${table}_merged`] = (restored[`${table}_merged`] || 0) + 1;
          else skipped[table] = (skipped[table] || 0) + 1;
        } else {
          current[table].push(safeJsonClone(row));
          index.set(key, current[table][current[table].length - 1]);
          restored[table] = (restored[table] || 0) + 1;
        }
      }
      // checkpoint: lưu DB sau mỗi batch để tắt giữa chừng không hỏng.
      try { dbModule.saveDB(); } catch (_) {}
      report.checkpoint = { table, batch: Math.floor(i / batchSize) + 1, totalBatches: Math.ceil(rows.length / batchSize) };
      setProgress(`Đang merge ${table}: batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rows.length / batchSize)}`, { checkpoint: report.checkpoint });
      await yieldToEventLoop();
    }
  }
  ensureNextIds(current);
}

// Chạy hàm với timeout; 1 file xử lý quá lâu sẽ bị bỏ qua, không treo toàn bộ.
function withTimeout(promiseFactory, timeoutMs, label, logger) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`File ${label} xử lý quá lâu (>${timeoutMs}ms), đã bỏ qua`)); }, timeoutMs);
    Promise.resolve().then(() => promiseFactory()).then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

// ---- main ----
async function runRecovery(options = {}) {
  if (!initialized) initialize();
  if (running) return { ok: false, running: true, message: 'Đang có tiến trình khôi phục dữ liệu đang chạy. Vui lòng đợi hoàn tất.' };
  running = true; cancelRequested = false;
  status = { running: true, progress: 'Bắt đầu khôi phục...', phase: 'init', lastReport: null, lastLogPath: null, foundFiles: [], details: {} };
  const report = {
    startedAt: new Date().toISOString(), finishedAt: null, version: VERSION,
    drivesScanned: [], backupFilesFound: [], archiveFilesExtracted: [], parsedFiles: [],
    failedFiles: [], restoredCounts: {}, skippedDuplicates: {}, backfilled: {}, warnings: [], errors: [],
    rollbackStatus: 'not_needed', beforeCounts: {}, afterCounts: {}, cancelled: false, checkpoint: null,
  };
  const logPath = path.join(getLogDir(), `restore-log-${stamp()}.txt`);
  const logger = new Logger(logPath);
  logger.add('========== BẮT ĐẦU KHÔI PHỤC DỮ LIỆU ==========');
  logger.add(`Phiên bản RecoveryEngine: ${VERSION}`);
  logger.add(`Thời gian bắt đầu: ${report.startedAt}`);
  let snapshot = null;
  let safetyBackup = null;
  try {
    status.phase = 'snapshot';
    setProgress('Đang tạo snapshot database hiện tại trước khi khôi phục...', {});
    logger.add('Bước 1: Tạo snapshot database hiện tại (pre-restore)');
    snapshot = safeJsonClone(dbModule.getDb());
    report.beforeCounts = countTables(snapshot);
    logger.add(`Số lượng hiện tại trước restore: ${JSON.stringify(report.beforeCounts)}`);
    safetyBackup = dbModule.createDbBackup('recovery_pre_restore_' + stamp(), { skipRetention: true });
    if (!safetyBackup) {
      // Dự phòng: ghi snapshot JSON thuần túp vào logs/recovery để vẫn có rollback khi zip backup lỗi.
      const fallbackPath = path.join(getLogDir(), `pre-restore-${stamp()}.json`);
      try {
        fs.writeFileSync(fallbackPath, JSON.stringify(snapshot, null, 2), 'utf8');
        safetyBackup = { path: fallbackPath, file: path.basename(fallbackPath), reason: 'recovery_pre_restore_fallback', isJsonSnapshot: true, created_at: new Date().toISOString() };
        logger.add(`Zip backup thất bại, đã ghi snapshot JSON dự phòng: ${fallbackPath}`);
      } catch (e) {
        throw new Error('Không tạo được backup database hiện tại trước khi khôi phục (cả zip và JSON dự phòng đều thất bại): ' + e.message);
      }
    }
    report.safetyBackup = safetyBackup;
    logger.add(`Đã tạo snapshot backup an toàn: ${safetyBackup.path}`);

    status.phase = 'scan';
    const scan = await scanBackups(options, logger);
    report.drivesScanned = scan.drives;
    logger.add(`Đã quét các ổ: ${scan.drives.join(', ')}`);
    let files = scan.files;
    logger.add(`Tìm thấy ${files.length} file backup ứng viên.`);
    setProgress(`Đã tìm thấy ${files.length} file backup. Đang kiểm tra giải nén...`, { foundFiles: files.length });

    status.phase = 'extract';
    for (const f of [...files]) {
      if (cancelRequested) break;
      if (isArchive(f.path)) {
        const nested = await extractArchive(f.path, report, logger, options);
        files.push(...nested);
        await yieldToEventLoop();
      }
    }
    // Loại file DB hiện tại + file snapshot pre-restore để không tự import chính mình.
    const dbPathLower = path.resolve(dbModule.DB_PATH).toLowerCase();
    files = sortBackups(files.filter(f => {
      const p = path.resolve(f.path).toLowerCase();
      if (p === dbPathLower) return false;
      if (p.includes(path.basename(dbPathLower))) return false;
      return true;
    }));
    report.backupFilesFound = files.map(f => ({ path: f.path, size: f.size || null, mtimeMs: f.mtimeMs || null, extractedFrom: f.extractedFrom || null }));
    status.foundFiles = report.backupFilesFound;
    logger.add(`Sau khi lọc & sắp xếp, sẽ xử lý ${files.length} file (thứ tự cũ → mới).`);

    status.phase = 'merge';
    const current = dbModule.getDb();
    let processed = 0;
    for (let i = 0; i < files.length; i += 1) {
      if (cancelRequested) { logger.add('Đã nhận yêu cầu hủy, dừng sau batch hiện tại.'); report.cancelled = true; break; }
      const f = files[i];
      if (isArchive(f.path)) continue;
      processed += 1;
      const pct = files.length ? Math.round((processed / files.length) * 100) : 100;
      setProgress(`Đang xử lý backup ${processed}/${files.length} (${pct}%): ${path.basename(f.path)}`, { file: f.path, processed, total: files.length, percent: pct });
      logger.add(`--- Xử lý file ${processed}/${files.length}: ${f.path} ---`);
      try {
        let parsed;
        // file lớn đọc stream, file nhỏ đọc đồng bộ.
        if ((f.size || 0) > 16 * 1024 * 1024) {
          parsed = await withTimeout(() => readBackupFileStream(f.path), options.fileTimeoutMs || DEFAULT_FILE_TIMEOUT_MS, f.path, logger);
        } else {
          parsed = await withTimeout(() => Promise.resolve(readBackupFileSync(f.path)), options.fileTimeoutMs || DEFAULT_FILE_TIMEOUT_MS, f.path, logger);
        }
        const normalized = normalizeBackupData(parsed);
        if (!normalized) { report.failedFiles.push({ path: f.path, error: 'Không có dữ liệu database phù hợp' }); logger.add(`  Bỏ qua: không có dữ liệu database phù hợp.`); continue; }
        const counts = countTables(normalized);
        report.parsedFiles.push({ path: f.path, counts });
        logger.add(`  Dữ liệu hợp lệ: ${JSON.stringify(counts)}`);
        await mergeDataset(current, normalized, report, logger, options);
      } catch (error) {
        report.failedFiles.push({ path: f.path, error: error.message });
        logger.add(`  LỖI file: ${error.message}`);
      }
      await yieldToEventLoop();
    }

    status.phase = 'validate';
    setProgress('Đang kiểm tra dữ liệu sau khôi phục...', {});
    logger.add('Bước kiểm tra: so sánh số lượng sau restore với trước restore.');
    report.afterCounts = countTables(dbModule.getDb());
    logger.add(`Số lượng sau restore: ${JSON.stringify(report.afterCounts)}`);
    for (const t of IMPORTANT_TABLES) {
      if ((report.afterCounts[t] || 0) < (report.beforeCounts[t] || 0)) {
        throw new Error(`Bảng ${t} bị giảm sau restore (trước ${report.beforeCounts[t]}, sau ${report.afterCounts[t]})`);
      }
    }
    if (!report.cancelled) {
      dbModule.saveDB();
      report.rollbackStatus = 'not_needed';
    } else {
      report.rollbackStatus = 'not_needed';
      logger.add('Khôi phục bị hủy nhưng dữ liệu đã merge đến checkpoint vẫn được giữ (không rollback).');
    }
    status.phase = 'done';
    setProgress(report.cancelled ? 'Đã hủy khôi phục (an toàn).' : 'Hoàn tất khôi phục.', {});
    const r = report.restoredCounts;
    report.message = report.cancelled
      ? `Đã hủy an toàn. Đã xử lý ${report.parsedFiles.length}/${files.length} file. Khôi phục được ${r.invoices || 0} đơn, ${r.products || 0} sản phẩm, ${r.customers || 0} khách hàng, ${r.import_logs || 0} phiếu nhập. Xem log chi tiết.`
      : `Đã tìm thấy ${report.backupFilesFound.length} backup, xử lý ${report.parsedFiles.length}/${files.length} file. Khôi phục ${r.invoices || 0} đơn hàng, ${r.products || 0} sản phẩm, ${r.customers || 0} khách hàng, ${r.import_logs || 0} phiếu nhập. Trùng/bỏ qua: ${Object.values(report.skippedDuplicates).reduce((a, b) => a + b, 0)}. File lỗi: ${report.failedFiles.length}. Xem log chi tiết.`;
    logger.add(`KẾT QUẢ: ${report.message}`);
    if (report.failedFiles.length) { logger.add('Danh sách file lỗi/bỏ qua:'); for (const fl of report.failedFiles) logger.add(`  - ${fl.path}: ${fl.error}`); }
    logger.add('========== KẾT THÚC KHÔI PHỤC ==========');
    return { ok: !report.cancelled, ...report, logPath };
  } catch (error) {
    report.errors.push(error.message);
    logger.add(`LỖI NGHIÊM TRỌNG: ${error.message}`);
    try {
      Object.keys(dbModule.getDb()).forEach(k => delete dbModule.getDb()[k]);
      Object.assign(dbModule.getDb(), snapshot);
      dbModule.saveDB();
      report.rollbackStatus = 'rolled_back';
      logger.add('Đã rollback database về snapshot trước restore.');
    } catch (rbErr) { report.rollbackStatus = 'rollback_failed: ' + rbErr.message; logger.add(`Rollback thất bại: ${rbErr.message}`); }
    logger.add('========== KẾT THÚC KHÔI PHỤC (LỖI) ==========');
    return { ok: false, message: 'Khôi phục lỗi nghiêm trọng, đã rollback database về bản trước restore.', error: error.message, ...report, logPath };
  } finally {
    report.finishedAt = new Date().toISOString();
    logger.add(`Thời gian kết thúc: ${report.finishedAt}`);
    logger.flush();
    status = { running: false, progress: report.message || 'Kết thúc', phase: report.cancelled ? 'cancelled' : (report.errors.length ? 'error' : 'done'), lastReport: report, lastLogPath: logPath, foundFiles: report.backupFilesFound || [], details: {} };
    running = false;
    cancelRequested = false;
  }
}

function startBackgroundRecovery(options = {}) {
  if (running) return { ok: false, running: true, message: 'Đang có tiến trình khôi phục dữ liệu đang chạy.' };
  const delay = Math.max(100, Number(options.delayMs) || 500);
  setTimeout(() => runRecovery(options).catch(e => { console.error('[RecoveryEngine] error:', e); }), delay);
  return { ok: true, message: 'Đã khởi động khôi phục nền.', started: true };
}
function cancelRecovery() {
  if (!running) return { ok: false, message: 'Không có tiến trình khôi phục nào đang chạy.' };
  cancelRequested = true;
  return { ok: true, message: 'Đã yêu cầu hủy. Tiến trình sẽ dừng sau batch hiện tại (an toàn).' };
}
function getStatus() { return { initialized, version: VERSION, ...status }; }
function getLogs(limit = 20) {
  try {
    return fs.readdirSync(getLogDir())
      .filter(f => /^restore-log-.*\.txt$/i.test(f) || /^recovery_.*\.json$/i.test(f))
      .sort().reverse().slice(0, limit)
      .map(f => ({ file: f, path: path.join(getLogDir(), f) }));
  } catch (_) { return []; }
}
function readLog(filePath) {
  const target = path.isAbsolute(String(filePath || '')) ? filePath : path.join(getLogDir(), path.basename(String(filePath || '')));
  const lower = String(target).toLowerCase();
  if (lower.endsWith('.txt')) return { type: 'text', content: fs.readFileSync(target, 'utf8') };
  return { type: 'json', content: JSON.parse(fs.readFileSync(target, 'utf8')) };
}
function rollbackToPreRestore(backupPath) {
  if (!backupPath) throw new Error('Thiếu đường dẫn backup rollback');
  if (!fs.existsSync(backupPath)) throw new Error('File backup rollback không tồn tại: ' + backupPath);
  const { readBackupData } = require('../utils/backupCodec');
  const data = readBackupData(backupPath);
  const normalized = normalizeBackupData(data);
  if (!normalized) throw new Error('Backup rollback không chứa dữ liệu hợp lệ');
  const db = dbModule.getDb();
  for (const key of Object.keys(db)) { if (Array.isArray(db[key])) db[key] = []; }
  for (const table of Object.keys(dbModule.SCHEMA || {})) { if (Array.isArray(normalized[table])) db[table] = [...normalized[table]]; }
  if (normalized.nextId) db.nextId = { ...db.nextId, ...normalized.nextId };
  ensureNextIds(db);
  dbModule.saveDB();
  return { ok: true };
}

module.exports = {
  initialize, runRecovery, startBackgroundRecovery, cancelRecovery,
  getStatus, getLogs, readLog, rollbackToPreRestore,
  scanBackups, normalizeBackupData, normalizeRow, mergeDataset, sortBackups, VERSION,
};
