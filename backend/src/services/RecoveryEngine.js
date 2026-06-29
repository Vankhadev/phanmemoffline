const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const BACKUP_EXTENSIONS = ['.json', '.db', '.sqlite', '.sqlite3', '.bak', '.backup', '.sql', '.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz'];
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz'];
const IMPORTANT_TABLES = ['invoices', 'invoice_details', 'products', 'customers', 'partners', 'import_logs', 'import_details'];
const ALIAS_TABLES = {
  orders: 'invoices', invoices: 'invoices', sales: 'invoices',
  order_items: 'invoice_details', invoice_items: 'invoice_details', invoice_details: 'invoice_details',
  products: 'products', customers: 'customers', suppliers: 'partners', partners: 'partners',
  imports: 'import_logs', purchase_orders: 'import_logs', import_logs: 'import_logs',
  import_items: 'import_details', purchase_items: 'import_details', import_details: 'import_details',
  payments: 'cash_book', expenses: 'cash_book', cashbook: 'cash_book', ledger: 'accounting_transactions',
  debts: 'customer_debts', settings: 'system_settings', print_templates: 'print_templates', users: 'users',
  categories: 'product_categories', units: 'system_settings', service_items: 'invoice_details', other_services: 'invoice_details', logs: 'audit_logs',
};

let dbModule = null;
let initialized = false;
let running = false;
let status = { running: false, progress: 'Chưa chạy', lastReport: null, lastLogPath: null, foundFiles: [] };

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
function setProgress(text) { status.progress = text; }

function listExistingDrives() {
  if (process.env.KHA_RECOVERY_SCAN_ROOTS) return process.env.KHA_RECOVERY_SCAN_ROOTS.split(';').map(s => s.trim()).filter(Boolean);
  if (process.platform !== 'win32') return ['/'];
  const roots = [];
  for (let code = 67; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try { if (fs.existsSync(root)) roots.push(root); } catch (_) {}
  }
  return roots;
}

function walk(dir, onFile, options = {}) {
  const maxFiles = Math.max(1, Number(options.maxFiles) || 200000);
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 40;
  const state = options.state || { count: 0 };
  if (state.count >= maxFiles || maxDepth < 0) return;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  const priority = ['backup', 'backups', 'backup_du_lieu_phan_mem_no_del', 'data', 'database', 'db', 'restore', 'phanmemoffline', 'pos', 'sales'];
  items.sort((a, b) => priority.includes(b.name.toLowerCase()) - priority.includes(a.name.toLowerCase()));
  for (const item of items) {
    if (state.count >= maxFiles) break;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      const name = item.name.toLowerCase();
      if (['node_modules', '.git', '$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)'].includes(name)) continue;
      walk(full, onFile, { ...options, maxDepth: maxDepth - 1, state });
    } else if (item.isFile()) {
      state.count += 1;
      if (isCandidate(full)) onFile(full);
    }
  }
}

function scanBackups(options = {}) {
  const drives = options.roots || listExistingDrives();
  const found = new Map();
  for (const drive of drives) {
    setProgress(`Đang quét ổ ${drive}...`);
    walk(drive, file => {
      try {
        const st = fs.statSync(file);
        found.set(path.resolve(file).toLowerCase(), { path: path.resolve(file), size: st.size, mtimeMs: st.mtimeMs, createdMs: st.birthtimeMs });
      } catch (_) {}
    }, { maxFiles: options.maxFiles, maxDepth: options.maxDepth });
  }
  return { drives, files: Array.from(found.values()) };
}

function runTool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result;
}
function extractArchive(file, report) {
  const tempDir = fs.mkdtempSync(path.join(getTempRoot(), 'extract-'));
  try {
    const lower = file.toLowerCase();
    if (lower.endsWith('.zip')) {
      runTool('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${JSON.stringify(file)} -DestinationPath ${JSON.stringify(tempDir)} -Force`]);
    } else if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz')) {
      const out = path.join(tempDir, path.basename(file).replace(/\.gz$/i, ''));
      fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(file)));
    } else {
      const sevenZip = find7Zip();
      if (!sevenZip) throw new Error('Thiếu công cụ 7-Zip để giải nén rar/7z/tar/tar.gz');
      runTool(sevenZip, ['x', '-y', `-o${tempDir}`, file]);
    }
    report.archiveFilesExtracted.push({ path: file, tempDir });
    const nested = [];
    walk(tempDir, f => nested.push({ path: f, extractedFrom: file, mtimeMs: fs.statSync(f).mtimeMs }), { maxFiles: 20000, maxDepth: 20 });
    return nested;
  } catch (error) {
    report.failedFiles.push({ path: file, error: error.message });
    return [];
  }
}
function find7Zip() {
  const candidates = [process.env.KHA_7ZIP_PATH, 'C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].filter(Boolean);
  return candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}

function parseTimestampFromName(file) {
  const s = path.basename(file);
  const m = s.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[T _-]?([0-2]\d)?[-_]?([0-5]\d)?[-_]?([0-5]\d)?/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function sortBackups(files) { return files.sort((a, b) => (parseTimestampFromName(a.path) || a.createdMs || a.mtimeMs || 0) - (parseTimestampFromName(b.path) || b.createdMs || b.mtimeMs || 0)); }

function readBackupFile(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.sql')) return parseSqlDump(fs.readFileSync(file, 'utf8'));
  const raw = fs.readFileSync(file);
  const text = (lower.endsWith('.gz') || (raw[0] === 0x1f && raw[1] === 0x8b)) ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return JSON.parse(text);
}
function parseSqlDump(_sql) { throw new Error('Chưa hỗ trợ parse SQL dump an toàn, đã bỏ qua để không làm hỏng dữ liệu'); }
function normalizeBackupData(data) {
  if (!data || typeof data !== 'object') return null;
  const src = data.database && typeof data.database === 'object' ? data.database : data;
  const out = {};
  for (const [key, table] of Object.entries(ALIAS_TABLES)) {
    if (Array.isArray(src[key])) out[table] = [...(out[table] || []), ...src[key]];
  }
  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    if (Array.isArray(src[table])) out[table] = [...(out[table] || []), ...src[table]];
  }
  out.nextId = src.nextId || src.next_id || null;
  return Object.keys(out).some(k => Array.isArray(out[k]) && out[k].length) ? out : null;
}

function pickKey(prefix, values, fallback) {
  const value = values.find(hasValue);
  return value == null ? fallback : prefix + ':' + String(value);
}
function buildKey(table, row, index = 0) {
  const r = row || {};
  if (['invoices'].includes(table)) return pickKey('order', [r.orderId, r.invoiceId, r.orderCode, r.invoiceCode, r.code, r.id], `orderhash:${norm(r.created_at || r.createdAt)}|${norm(r.customer_name || r.customerName)}|${norm(r.customer_phone || r.customerPhone)}|${money(r.total ?? r.totalAmount)}|${hashObject(r.items || r.details || '')}`);
  if (['invoice_details'].includes(table)) return pickKey('item', [r.id, r.itemId], `itemhash:${r.invoice_id || r.invoiceId || r.orderCode || ''}|${norm(r.product_name || r.productName || r.name)}|${r.quantity}|${r.price}|${r.total}|${index}|${hashObject(r)}`);
  if (table === 'products') return pickKey('product', [r.id, r.sku, r.barcode, r.productCode, r.code], `producthash:${norm(r.name)}|${norm(r.category || r.category_name)}`);
  if (table === 'customers') return pickKey('customer', [r.customerId, r.id, r.phone, r.email], `customerhash:${norm(r.name)}|${norm(r.address)}`);
  if (table === 'partners') return pickKey('supplier', [r.supplierId, r.partnerId, r.id, r.phone, r.email, r.name], `supplierhash:${hashObject(r)}`);
  if (table === 'import_logs') return pickKey('import', [r.importId, r.importCode, r.code, r.id], `importhash:${r.supplier_id || r.supplierId || norm(r.supplier_name || r.supplierName)}|${norm(r.created_at || r.createdAt)}|${money(r.total ?? r.totalAmount)}`);
  if (table === 'import_details') return pickKey('importitem', [r.id, r.itemId], `importitemhash:${r.import_id || r.importId || r.importCode || ''}|${norm(r.product_name || r.productName)}|${r.quantity}|${r.price}|${index}|${hashObject(r)}`);
  if (table === 'print_templates') return pickKey('template', [r.id, r.key, r.name, r.code], `templatehash:${hashObject(r)}`);
  return pickKey(table, [r.id, r.code, r.key, r.uuid], `${table}hash:${hashObject(r)}`);
}
function mergeFields(existing, incoming, table) {
  const historical = new Set(['invoices', 'invoice_details', 'import_logs', 'import_details']);
  const moneyFields = new Set(['price', 'cost', 'import_price', 'sale_price', 'total', 'subtotal', 'discount', 'profit', 'capital_price']);
  let changed = false;
  for (const [k, v] of Object.entries(incoming || {})) {
    if (!hasValue(v)) continue;
    if (!hasValue(existing[k])) { existing[k] = v; changed = true; continue; }
    if (historical.has(table) && moneyFields.has(k)) continue;
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
function countTables(db) { return IMPORTANT_TABLES.reduce((acc, t) => { acc[t] = Array.isArray(db[t]) ? db[t].length : 0; return acc; }, {}); }

function mergeDataset(current, incoming, report) {
  const restored = report.restoredCounts;
  const skipped = report.skippedDuplicates;
  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    if (!Array.isArray(incoming[table])) continue;
    if (!Array.isArray(current[table])) current[table] = [];
    const index = new Map(current[table].map((row, i) => [buildKey(table, row, i), row]));
    incoming[table].forEach((row, i) => {
      if (!row || typeof row !== 'object') return;
      const key = buildKey(table, row, i);
      const existing = index.get(key);
      if (existing) {
        const changed = mergeFields(existing, row, table);
        if (changed) {
          restored[`${table}_merged`] = (restored[`${table}_merged`] || 0) + 1;
        } else {
          skipped[table] = (skipped[table] || 0) + 1;
        }
        return;
      }
      current[table].push(safeJsonClone(row));
      index.set(key, current[table][current[table].length - 1]);
      restored[table] = (restored[table] || 0) + 1;
    });
  }
  ensureNextIds(current);
}

async function runRecovery(options = {}) {
  if (!initialized) initialize();
  if (running) return { ok: false, running: true, message: 'Recovery đang chạy nền.' };
  running = true; status.running = true; status.progress = 'Bắt đầu khôi phục...';
  const report = { startedAt: new Date().toISOString(), finishedAt: null, drivesScanned: [], backupFilesFound: [], archiveFilesExtracted: [], parsedFiles: [], failedFiles: [], restoredCounts: {}, skippedDuplicates: {}, warnings: [], errors: [], rollbackStatus: 'not_needed', beforeCounts: {}, afterCounts: {} };
  const logPath = path.join(getLogDir(), `recovery_${stamp()}.json`);
  let snapshot = null;
  let safetyBackup = null;
  try {
    snapshot = safeJsonClone(dbModule.getDb());
    report.beforeCounts = countTables(snapshot);
    safetyBackup = dbModule.createDbBackup('recovery_pre_restore_' + stamp(), { skipRetention: true });
    if (!safetyBackup) throw new Error('Không tạo được backup database hiện tại trước khi khôi phục');
    report.safetyBackup = safetyBackup;
    const scan = scanBackups(options);
    report.drivesScanned = scan.drives;
    let files = scan.files;
    for (const f of [...files]) if (isArchive(f.path)) files.push(...extractArchive(f.path, report));
    files = sortBackups(files.filter(f => !path.resolve(f.path).toLowerCase().includes(path.resolve(dbModule.DB_PATH).toLowerCase())));
    report.backupFilesFound = files.map(f => ({ path: f.path, size: f.size || null, mtimeMs: f.mtimeMs || null, extractedFrom: f.extractedFrom || null }));
    status.foundFiles = report.backupFilesFound;
    const current = dbModule.getDb();
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i]; setProgress(`Đang đọc backup ${i + 1}/${files.length}...`);
      if (isArchive(f.path)) continue;
      try {
        const normalized = normalizeBackupData(readBackupFile(f.path));
        if (!normalized) { report.failedFiles.push({ path: f.path, error: 'Không có dữ liệu database phù hợp' }); continue; }
        const counts = countTables(normalized);
        report.parsedFiles.push({ path: f.path, counts });
        mergeDataset(current, normalized, report);
      } catch (error) { report.failedFiles.push({ path: f.path, error: error.message }); }
    }
    setProgress('Đang validate dữ liệu sau khôi phục...');
    report.afterCounts = countTables(dbModule.getDb());
    for (const t of IMPORTANT_TABLES) if ((report.afterCounts[t] || 0) < (report.beforeCounts[t] || 0)) throw new Error(`Bảng ${t} bị giảm sau restore`);
    dbModule.saveDB();
    report.rollbackStatus = 'not_needed';
    setProgress('Hoàn tất.');
    report.message = `Đã quét ${report.backupFilesFound.length} file backup, khôi phục ${report.restoredCounts.invoices || 0} đơn hàng, ${report.restoredCounts.products || 0} sản phẩm, ${report.restoredCounts.customers || 0} khách hàng, ${report.restoredCounts.import_logs || 0} phiếu nhập. Xem chi tiết log.`;
    return { ok: true, ...report, logPath };
  } catch (error) {
    report.errors.push(error.message);
    try { Object.keys(dbModule.getDb()).forEach(k => delete dbModule.getDb()[k]); Object.assign(dbModule.getDb(), snapshot); dbModule.saveDB(); report.rollbackStatus = 'rolled_back'; } catch (rbErr) { report.rollbackStatus = 'rollback_failed: ' + rbErr.message; }
    return { ok: false, message: 'Khôi phục lỗi, đã rollback database trước restore.', error: error.message, ...report, logPath };
  } finally {
    report.finishedAt = new Date().toISOString();
    try { fs.writeFileSync(logPath, JSON.stringify(report, null, 2), 'utf8'); } catch (_) {}
    status = { running: false, progress: report.message || 'Kết thúc', lastReport: report, lastLogPath: logPath, foundFiles: report.backupFilesFound || [] };
    running = false;
  }
}
function startBackgroundRecovery(options = {}) {
  setTimeout(() => runRecovery(options).catch(() => {}), Math.max(1000, Number(options.delayMs) || 3000));
}
function getStatus() { return { initialized, ...status }; }
function getLogs(limit = 20) { try { return fs.readdirSync(getLogDir()).filter(f => /^recovery_.*\.json$/i.test(f)).sort().reverse().slice(0, limit).map(f => ({ file: f, path: path.join(getLogDir(), f) })); } catch (_) { return []; } }
function readLog(filePath) {
  const target = path.isAbsolute(String(filePath || '')) ? filePath : path.join(getLogDir(), path.basename(String(filePath || '')));
  return JSON.parse(fs.readFileSync(target, 'utf8'));
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
  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    if (Array.isArray(normalized[table])) db[table] = [...normalized[table]];
  }
  if (normalized.nextId) db.nextId = { ...db.nextId, ...normalized.nextId };
  ensureNextIds(db);
  dbModule.saveDB();
  return { ok: true };
}
module.exports = { initialize, runRecovery, startBackgroundRecovery, getStatus, getLogs, readLog, rollbackToPreRestore, scanBackups, normalizeBackupData, mergeDataset };

