/**
 * Lightweight JSON database layer for the offline-first backend.
 *
 * The helpers in this module intentionally keep a small synchronous API because
 * the rest of the Express app is written around in-process JSON persistence.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');
const { encodeBackupData, readBackupData, isCompressedBackupPath } = require('../utils/backupCodec');

// === SQLite durable write-through (gate sau KHA_SQLITE=1; mac dinh TAT) ===
let sqliteEngine = null;
const KHA_SQLITE_ENABLED = process.env.KHA_SQLITE !== '0'; // Mac dinh BAT, tat bang KHA_SQLITE=0
if (KHA_SQLITE_ENABLED) { try { sqliteEngine = require('./sqliteEngine'); } catch (_) { sqliteEngine = null; } }
function engineEnabled() { return KHA_SQLITE_ENABLED && sqliteEngine && sqliteEngine.isAvailable(); }
function engineEnsureOpen() {
  if (!engineEnabled()) return false;
  if (!sqliteEngine.isOpen()) {
    try { sqliteEngine.open(String(DB_PATH).replace(/\.json$/i, '') + '.sqlite'); }
    catch (e) { console.warn('[KHA SQLITE] open failed:', e.message); return false; }
  }
  return true;
}
function engineUpsert(table, row) { if (engineEnsureOpen() && row && row.id != null) { try { sqliteEngine.upsertRow(table, row); } catch (e) { console.warn('[KHA SQLITE] upsert', table, e.message); } } }
function engineDelete(table, id) { if (engineEnsureOpen() && id != null) { try { sqliteEngine.deleteRow(table, id); } catch (e) { console.warn('[KHA SQLITE] delete', table, e.message); } } }
function engineReplace(table, rows) { if (engineEnsureOpen()) { try { sqliteEngine.replaceCollection(table, rows); } catch (e) { console.warn('[KHA SQLITE] replace', table, e.message); } } }
function engineBegin() { if (engineEnsureOpen()) { try { sqliteEngine.begin(); } catch (_) {} } }
function engineCommit() { if (engineEnabled() && sqliteEngine.isOpen()) { try { sqliteEngine.commit(); } catch (_) {} } }
function engineRollback() { if (engineEnabled() && sqliteEngine.isOpen()) { try { sqliteEngine.rollback(); } catch (_) {} } }
function engineFullSync() {
  if (!engineEnsureOpen()) return;
  try {
    if (sqliteEngine.getMeta('full_synced') === true) return;
    const cur = getDb();
    sqliteEngine.begin();
    for (const table of Object.keys(SCHEMA)) { sqliteEngine.replaceCollection(table, Array.isArray(cur[table]) ? cur[table] : []); }
    sqliteEngine.setMeta('full_synced', true);
    sqliteEngine.commit();
    console.log('[KHA SQLITE] full sync done');
  } catch (e) { try { sqliteEngine.rollback(); } catch (_) {} console.warn('[KHA SQLITE] full sync failed:', e.message); }
}

const DATA_PRESERVATION_BACKUP_FOLDER = 'backup_du_lieu_phan_mem_no_del';
const DATA_PRESERVATION_BACKUP_ROOTS = (process.env.KHA_DATA_PRESERVATION_BACKUP_ROOTS || 'C:\\,D:\\,E:\\,F:\\')
  .split(',')
  .map(root => root.trim())
  .filter(Boolean);

function readDatabaseConfig() {
  const paths = [];
  const appDataRoots = [];
  const roaming = process.env.APPDATA || '';
  if (roaming) {
    appDataRoots.push(path.join(roaming, 'phanmienoffline-electron'));
    appDataRoots.push(path.join(roaming, 'Ban hang offline - Van kha mmo'));
    appDataRoots.push(path.join(roaming, 'Electron'));
  }
  if (process.env.ELECTRON_USER_DATA) {
    appDataRoots.push(process.env.ELECTRON_USER_DATA);
  }
  const uniqueRoots = [...new Set(appDataRoots.map(p => path.resolve(p)))];
  for (const root of uniqueRoots) {
    paths.push(path.join(root, 'config.json'));
  }
  paths.push(path.resolve(__dirname, '..', '..', 'data', 'config.json'));

  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        const config = JSON.parse(content);
        if (config && config.database_path) {
          return { database_path: config.database_path, source: p };
        }
      } catch (_) {}
    }
  }
  return null;
}

function writeDatabaseConfig(dbPath) {
  const paths = [];
  const appDataRoots = [];
  const roaming = process.env.APPDATA || '';
  if (roaming) {
    appDataRoots.push(path.join(roaming, 'phanmienoffline-electron'));
    appDataRoots.push(path.join(roaming, 'Ban hang offline - Van kha mmo'));
    appDataRoots.push(path.join(roaming, 'Electron'));
  }
  if (process.env.ELECTRON_USER_DATA) {
    appDataRoots.push(process.env.ELECTRON_USER_DATA);
  }
  const uniqueRoots = [...new Set(appDataRoots.map(p => path.resolve(p)))];
  for (const root of uniqueRoots) {
    paths.push(path.join(root, 'config.json'));
  }
  paths.push(path.resolve(__dirname, '..', '..', 'data', 'config.json'));

  for (const p of paths) {
    try {
      const dir = path.dirname(p);
      fs.mkdirSync(dir, { recursive: true });
      let existingConfig = {};
      if (fs.existsSync(p)) {
        try {
          existingConfig = JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (_) {}
      }
      existingConfig.database_path = dbPath;
      fs.writeFileSync(p, JSON.stringify(existingConfig, null, 2), 'utf8');
    } catch (_) {}
  }
}

function getDbFileStats(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) return null;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) {
      return {
        path: filePath,
        productsCount: 0,
        customersCount: 0,
        invoicesCount: 0,
        importsCount: 0,
        transactionsCount: 0,
        isEmpty: true,
        mtimeMs: stats.mtimeMs,
      };
    }
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object') return null;

    // Check if it is a JSON database by looking for products/customers/invoices arrays.
    const productsCount = Array.isArray(data.products) ? data.products.length : 0;
    const customersCount = Array.isArray(data.customers) ? data.customers.length : 0;
    const invoicesCount = Array.isArray(data.invoices) ? data.invoices.length : 0;
    const importsCount = Array.isArray(data.import_logs) ? data.import_logs.length : 0;
    const transactionsCount = Array.isArray(data.cash_book) ? data.cash_book.length : 0;
    const isEmpty = (productsCount === 0 && customersCount === 0 && invoicesCount === 0 && importsCount === 0);

    const hasDbKeys = data.nextId || data.accounts || data.users || data.products || data.customers || data.invoices;
    if (!hasDbKeys) return null;

    return {
      path: filePath,
      productsCount,
      customersCount,
      invoicesCount,
      importsCount,
      transactionsCount,
      isEmpty,
      mtimeMs: stats.mtimeMs,
    };
  } catch (_) {
    return null;
  }
}

function getStatsDescription(stats) {
  if (stats.invoicesCount > 0) return `${stats.invoicesCount} đơn hàng`;
  if (stats.customersCount > 0) return `${stats.customersCount} khách hàng`;
  if (stats.productsCount > 0) return `${stats.productsCount} sản phẩm`;
  if (stats.transactionsCount > 0) return `${stats.transactionsCount} giao dịch`;
  return `0 sản phẩm`;
}

function compareDbStats(a, b) {
  if (a.invoicesCount !== b.invoicesCount) {
    return b.invoicesCount - a.invoicesCount;
  }
  if (a.customersCount !== b.customersCount) {
    return b.customersCount - a.customersCount;
  }
  if (a.productsCount !== b.productsCount) {
    return b.productsCount - a.productsCount;
  }
  if (a.transactionsCount !== b.transactionsCount) {
    return b.transactionsCount - a.transactionsCount;
  }
  return b.mtimeMs - a.mtimeMs;
}

function scanDirForDatabases(dir, depth = 0, maxDepth = 3) {
  const filesFound = [];
  if (depth > maxDepth) return filesFound;
  try {
    if (!fs.existsSync(dir)) return filesFound;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return filesFound;

    const name = path.basename(dir).toLowerCase();
    if (['node_modules', '.git', 'cache', 'code cache', 'gpucache', 'blob_storage', 'session storage', 'local storage', 'shared dictionary', 'webstorage', 'logs', 'network', 'service worker'].includes(name)) {
      return filesFound;
    }

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      try {
        const itemStat = fs.statSync(fullPath);
        if (itemStat.isDirectory()) {
          filesFound.push(...scanDirForDatabases(fullPath, depth + 1, maxDepth));
        } else {
          const ext = path.extname(item).toLowerCase();
          if (['.db', '.sqlite', '.sqlite3', '.mdb', '.json'].includes(ext)) {
            filesFound.push(fullPath);
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return filesFound;
}

function performDeepScan() {
  const searchDirs = [];

  // Add drive-level folders
  const drives = DATA_PRESERVATION_BACKUP_ROOTS;
  const targetFolderNames = ['data', 'database', 'appdata', 'storage', 'backup', 'backups', 'backup_du_lieu_phan_mem_no_del'];
  for (const drive of drives) {
    for (const folder of targetFolderNames) {
      searchDirs.push(path.join(drive, folder));
    }
  }

  // Add AppData folders
  const appDataRoots = [];
  const roaming = process.env.APPDATA || '';
  if (roaming) {
    appDataRoots.push(path.join(roaming, 'phanmienoffline-electron'));
    appDataRoots.push(path.join(roaming, 'Ban hang offline - Van kha mmo'));
    appDataRoots.push(path.join(roaming, 'Electron'));
  }
  if (process.env.ELECTRON_USER_DATA) {
    appDataRoots.push(process.env.ELECTRON_USER_DATA);
  }
  const uniqueRoots = [...new Set(appDataRoots.map(p => path.resolve(p)))];
  for (const root of uniqueRoots) {
    searchDirs.push(root);
    searchDirs.push(path.join(root, 'backups'));
    searchDirs.push(path.join(root, 'backup_du_lieu_phan_mem_no_del'));
    searchDirs.push(path.join(root, 'databases'));
  }

  // Add project backend data directories
  searchDirs.push(path.resolve(__dirname, '..', '..', 'data'));
  searchDirs.push(path.resolve(__dirname, '..', '..', 'data', 'backups'));
  searchDirs.push(path.resolve(__dirname, '..', '..', 'data', 'backup_du_lieu_phan_mem_no_del'));

  const uniqueSearchDirs = [...new Set(searchDirs.map(p => path.resolve(p)))];
  
  const allFiles = [];
  for (const dir of uniqueSearchDirs) {
    allFiles.push(...scanDirForDatabases(dir, 0, 3));
  }

  const uniqueFiles = [...new Set(allFiles.map(p => path.resolve(p)))];
  
  // 1. First, stat all files to get size and mtimeMs (very fast, no content reading)
  const fileCandidates = [];
  for (const f of uniqueFiles) {
    try {
      const stats = fs.statSync(f);
      if (stats.isDirectory()) continue;
      
      const name = path.basename(f).toLowerCase();
      // Skip files that are not database candidates
      const isDbName = name.includes('phanmienoffline') || name.includes('data') || name.includes('new') || name.includes('backup') || name.includes('pos');
      if (!isDbName) continue;
      
      // Skip very small files (empty database is ~1KB-5KB, populated one is much larger)
      if (stats.size < 500) continue; 

      fileCandidates.push({
        path: f,
        size: stats.size,
        mtimeMs: stats.mtimeMs
      });
    } catch (_) {}
  }

  // Also include the current defaultPath and configPath in the candidates
  const envPath = process.env.KHA_DB_PATH || process.env.DB_PATH || process.env.DATABASE_PATH;
  const defaultPath = envPath ? path.resolve(envPath) : path.resolve(__dirname, '..', '..', 'data', 'phanmienoffline.db.json');
  
  const config = readDatabaseConfig();
  let configPath = null;
  if (config && config.database_path) {
    configPath = path.resolve(config.database_path);
  }

  const activePath = configPath || defaultPath;
  const ensurePathInCandidates = (p) => {
    if (p && !fileCandidates.some(c => path.resolve(c.path) === path.resolve(p))) {
      try {
        if (fs.existsSync(p)) {
          const stats = fs.statSync(p);
          fileCandidates.push({
            path: p,
            size: stats.size,
            mtimeMs: stats.mtimeMs
          });
        }
      } catch (_) {}
    }
  };
  ensurePathInCandidates(activePath);
  ensurePathInCandidates(defaultPath);

  // 2. Sort candidates by size (largest first) and mtimeMs (newest first) to prioritize parsing the most promising ones
  fileCandidates.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return b.mtimeMs - a.mtimeMs;
  });

  // 3. Only read and parse the content of the top 15 largest files to get record counts (avoids parsing thousands of old backups)
  const topCandidates = fileCandidates.slice(0, 15);
  const statsList = [];
  for (const c of topCandidates) {
    const stats = getDbFileStats(c.path);
    if (stats) statsList.push(stats);
  }

  // Deduplicate statsList by path
  const seenPaths = new Set();
  const deduplicatedStats = [];
  for (const stats of statsList) {
    const resolvedP = path.resolve(stats.path);
    if (!seenPaths.has(resolvedP)) {
      seenPaths.add(resolvedP);
      deduplicatedStats.push(stats);
    }
  }

  deduplicatedStats.sort(compareDbStats);
  return deduplicatedStats;
}

function resolveDBPath() {
  const envPath = process.env.KHA_DB_PATH || process.env.DB_PATH || process.env.DATABASE_PATH;
  const defaultPath = envPath ? path.resolve(envPath) : path.resolve(__dirname, '..', '..', 'data', 'phanmienoffline.db.json');

  // KHA FIX 2.3.3 (backend production startup hang):
  // Khi Electron production chạy backend, nó luôn set KHA_DB_PATH (trỏ vào userData
  // của app, vd %APPDATA%\Bán Hàng Pos\phanmienoffline.db.json). Biến env này PHẢI có
  // quyền cao nhất - không để config.json cũ (có thể trỏ tới backup ở E:\...) lấn
  // ưu tiên và gây quét toàn bộ ổ đĩa khi backup đó bị thiếu/rỗng.
  // Trước đây `activePath = currentConfigPath || defaultPath` để config.json override
  // KHA_DB_PATH -> backend khởi động lại dùng DB cũ, và khi DB đó rỗng thì
  // performDeepScan() quét C:\D:\E:\F:\ parse hàng chục file JSON lớn -> backend
  // không kịp mở port 7000 -> Electron báo ECONNREFUSED 127.0.0.1:7000.
  const electronOwned = Boolean(envPath);

  const config = readDatabaseConfig();
  let currentConfigPath = null;
  if (config && config.database_path) {
    currentConfigPath = path.resolve(config.database_path);
  }

  // Ưu tiên: env KHA_DB_PATH (Electron production) > config.json > default project.
  // config.json CHỈ được dùng khi KHÔNG có envPath (chạy backend độc lập npm start).
  const activePath = electronOwned ? defaultPath : (currentConfigPath || defaultPath);
  const activeStats = getDbFileStats(activePath);

  // High-performance optimization: if current database already has data, skip startup scan
  if (activeStats && !activeStats.isEmpty) {
    console.log(`[INFO] Database hiện tại đã có dữ liệu. Sử dụng: ${activePath}`);
    return activePath;
  }

  // Khi Electron sở hữu DB path (envPath được set), KHÔNG chạy deep scan toàn ổ đĩa
  // khi khởi động - đây là nguồn gây treo backend production. Nếu DB rỗng/thiếu thì
  // tạo DB trống tại activePath và để API /api/database/restore-scan chạy theo yêu
  // cầu người dùng (nút Khôi phục dữ liệu). Tránh block port binding.
  if (electronOwned) {
    console.log(`[INFO] Chế độ Electron production (KHA_DB_PATH đã set). Bỏ qua quét ổ đĩa khi khởi động: ${activePath}`);
    return activePath;
  }

  // Perform the scan on startup ONLY if active database is empty (chỉ dev/standalone)
  const statsList = performDeepScan();

  if (statsList.length === 0) {
    console.log('[INFO] Tìm thấy 0 Database');
    console.log('[INFO] Chọn Database A làm Database chính');
    return activePath;
  }

  const best = statsList[0];
  let chosenPath = activePath;

  if (best && !best.isEmpty) {
    // If the currently resolved database is empty, OR the best database has MORE/BETTER data than the current database, we switch!
    if (!activeStats || activeStats.isEmpty || compareDbStats(activeStats, best) > 0) {
      chosenPath = best.path;
      
      // Auto restore: write configuration to config.json
      if (chosenPath !== activePath) {
        console.log(`[INFO] Tự động chọn Database tốt nhất: ${chosenPath}`);
        writeDatabaseConfig(chosenPath);
      }
    }
  }

  console.log(`[INFO] Tìm thấy ${statsList.length} Database`);
  statsList.forEach((item, index) => {
    const label = String.fromCharCode(65 + index);
    console.log(`[INFO] Database ${label}: ${getStatsDescription(item)}`);
    console.log(`[INFO] Database ${label} path: ${item.path}`);
  });

  const chosenIndex = statsList.findIndex(item => item.path === chosenPath);
  const chosenLabel = chosenIndex !== -1 ? String.fromCharCode(65 + chosenIndex) : 'A';
  console.log(`[INFO] Chọn Database ${chosenLabel} làm Database chính`);

  // Clean empty databases (except the chosen one)
  statsList.forEach((item) => {
    if (item.isEmpty && item.path !== chosenPath) {
      try {
        fs.unlinkSync(item.path);
        console.log(`[INFO] Xóa Database rỗng: ${item.path}`);
      } catch (_) {}
    }
  });

  return chosenPath;
}

function setDBPath(newPath) {
  DB_PATH = path.resolve(newPath);
}

let DB_PATH = resolveDBPath();

const DB_BACKUP_DIR = path.resolve(process.env.KHA_DB_BACKUP_DIR || path.join(path.dirname(DB_PATH), DATA_PRESERVATION_BACKUP_FOLDER));
const DB_BACKUP_RETENTION_COUNT = Math.max(1, Number(process.env.KHA_DB_BACKUP_RETENTION_COUNT) || 30);
const DB_BACKUP_MIN_INTERVAL_MS = Math.max(0, Number(process.env.KHA_DB_BACKUP_MIN_INTERVAL_MS) || 72 * 60 * 60 * 1000);
const DB_BACKUP_MAX_FILE_BYTES = Math.max(0, Number(process.env.KHA_DB_BACKUP_MAX_FILE_BYTES) || 1024 * 1024 * 1024);
const DEFAULT_ACCOUNT_SLUG = 'default';
const requestContext = new AsyncLocalStorage();

const SCHEMA = {
  accounts: [],
  sessions: [],
  roles: [],
  permissions: [],
  role_permissions: [],
  sync_metadata: [],
  audit_logs: [],
  system_backups: [],
  backup_logs: [],
  system_settings: [],
  feature_catalog: [],
  store_info: [],
  users: [],
  customers: [],
  products: [],
  product_categories: [],
  partners: [],
  invoices: [],
  invoice_details: [],
  import_logs: [],
  import_details: [],
  combos: [],
  combo_items: [],
  daily_stats: [],
  return_logs: [],
  return_details: [],
  customer_types: [],
  counters: [],
  cash_book: [],
  accounting_transactions: [],
  cash_fund: [],
  bank_accounts: [],
  customer_debts: [],
  supplier_debts: [],
  einvoice_in: [],
  einvoice_out: [],
  tax_reports: [],
  revenue_reports: [],
  profit_reports: [],
  accounting_logs: [],
  payrolls: [],
  excel_import_runs: [],
  excel_import_details: [],
  print_templates: [],
  marketplace_shops: [],
  marketplace_orders: [],
  update_releases: [],
};

const INITIAL_NEXT_ID = Object.keys(SCHEMA).reduce((acc, table) => {
  acc[table] = 1;
  return acc;
}, {});

const ACCOUNT_SCOPED_TABLES = new Set([
  'store_info', 'users', 'customers', 'products', 'product_categories', 'partners',
  'invoices', 'invoice_details', 'import_logs', 'import_details', 'combos', 'combo_items',
  'daily_stats', 'return_logs', 'return_details', 'customer_types', 'counters', 'cash_book',
  'accounting_transactions', 'cash_fund', 'bank_accounts', 'customer_debts', 'supplier_debts',
  'einvoice_in', 'einvoice_out', 'tax_reports', 'revenue_reports', 'profit_reports', 'accounting_logs',
  'payrolls', 'excel_import_runs', 'excel_import_details',
  'print_templates', 'marketplace_shops', 'marketplace_orders', 'sync_metadata', 'audit_logs', 'system_settings',
]);

const DEFAULT_PERMISSIONS = [
  ['admin_panel.read', 'Xem bảng quản trị', 'Truy cập và xem khu vực quản trị hệ thống'],
  ['admin_panel.manage', 'Quản lý bảng quản trị', 'Quản lý các cấu hình và tác vụ cấp quản trị'],
  ['features.read', 'Xem tính năng', 'Xem danh mục tính năng'],
  ['features.manage', 'Quản lý tính năng', 'Tạo, sửa tính năng và bật/tắt quyền tính năng'],
  ['updates.read', 'Xem bản cập nhật', 'Xem metadata bản cập nhật phần mềm'],
  ['updates.manage', 'Quản lý bản cập nhật', 'Tạo, sửa và phát hành metadata bản cập nhật'],
  ['users.read', 'Xem người dùng', 'Xem danh sách người dùng'],
  ['users.manage', 'Quản lý người dùng', 'Tạo, sửa và phân quyền người dùng'],
  ['store.read', 'Xem cửa hàng', 'Xem thông tin cửa hàng'],
  ['store.manage', 'Quản lý cửa hàng', 'Cập nhật thông tin cửa hàng'],
  ['products.read', 'Xem hàng hóa', 'Xem sản phẩm và danh mục'],
  ['products.manage', 'Quản lý hàng hóa', 'Tạo, sửa và xóa sản phẩm'],
  ['customers.read', 'Xem khách hàng', 'Xem danh sách khách hàng'],
  ['customers.manage', 'Quản lý khách hàng', 'Tạo, sửa thông tin khách hàng'],
  ['partners.read', 'Xem nhà cung cấp', 'Xem danh sách nhà cung cấp'],
  ['partners.manage', 'Quản lý nhà cung cấp', 'Tạo, sửa thông tin nhà cung cấp'],
  ['invoices.read', 'Xem hóa đơn', 'Xem danh sách hóa đơn'],
  ['invoices.manage', 'Quản lý hóa đơn', 'Tạo, sửa, xóa hóa đơn'],
  ['imports.read', 'Xem nhập hàng', 'Xem phiếu nhập hàng'],
  ['imports.manage', 'Quản lý nhập hàng', 'Tạo, sửa phiếu nhập hàng'],
  ['combos.read', 'Xem combo', 'Xem danh sách combo'],
  ['combos.manage', 'Quản lý combo', 'Tạo, sửa combo'],
  ['returns.read', 'Xem trả hàng', 'Xem phiếu trả hàng'],
  ['returns.manage', 'Quản lý trả hàng', 'Tạo, sửa phiếu trả hàng'],
  ['stats.read', 'Xem thống kê', 'Xem báo cáo thống kê'],
  ['cashbook.read', 'Xem sổ quỹ', 'Xem sổ quỹ'],
  ['cashbook.manage', 'Quản lý sổ quỹ', 'Tạo, sửa chứng từ sổ quỹ'],
  ['accounting.read', 'Xem kế toán', 'Xem dữ liệu tổng quan module kế toán'],
  ['accounting.manage', 'Quản lý kế toán', 'Tạo, sửa, đảo bút toán kế toán'],
  ['tax_reports.read', 'Xem báo cáo thuế', 'Xem báo cáo thuế GTGT'],
  ['tax_reports.manage', 'Quản lý báo cáo thuế', 'Tạo snapshot và quản lý báo cáo thuế'],
  ['inventory_reports.read', 'Xem báo cáo tồn kho', 'Xem báo cáo tổng hợp tồn kho'],
  ['revenue_reports.read', 'Xem báo cáo doanh thu', 'Xem tổng hợp doanh thu'],
  ['profit_reports.read', 'Xem báo cáo lợi nhuận', 'Xem tổng hợp lợi nhuận'],
  ['debts.read', 'Xem công nợ', 'Xem công nợ khách hàng và nhà cung cấp'],
  ['debts.manage', 'Quản lý công nợ', 'Tạo, sửa, đối soát công nợ'],
  ['einvoices.read', 'Xem hóa đơn điện tử', 'Xem hóa đơn điện tử đầu vào/đầu ra'],
  ['einvoices.manage', 'Quản lý hóa đơn điện tử', 'Tạo, sửa, xóa hóa đơn điện tử'],
  ['bank_accounts.read', 'Xem tài khoản ngân hàng', 'Xem danh mục tài khoản ngân hàng'],
  ['bank_accounts.manage', 'Quản lý tài khoản ngân hàng', 'Tạo, sửa, xóa tài khoản ngân hàng'],
  ['activity_logs.read', 'Xem nhật ký hoạt động', 'Xem nhật ký hoạt động nghiệp vụ'],
  ['payrolls.read', 'Xem lương', 'Xem bảng lương'],
  ['payrolls.manage', 'Quản lý lương', 'Tạo, sửa bảng lương'],
  ['sync.read', 'Xem đồng bộ', 'Xem trạng thái đồng bộ'],
  ['sync.manage', 'Quản lý đồng bộ', 'Đẩy/kéo dữ liệu đồng bộ'],
  ['settings.read', 'Xem thiết lập', 'Xem thiết lập hệ thống'],
  ['settings.manage', 'Quản lý thiết lập', 'Cập nhật thiết lập hệ thống'],
  ['print_templates.read', 'Xem mẫu in hóa đơn', 'Xem danh sách và chi tiết mẫu in hóa đơn'],
  ['print_templates.manage', 'Quản lý mẫu in hóa đơn', 'Tạo, sửa, xóa, đặt mặc định và upload logo mẫu in hóa đơn'],
];

const DEFAULT_USER_PERMISSION_KEYS = [
  'admin_panel.read', 'features.read', 'updates.read', 'users.read', 'store.read', 'products.read',
  'customers.read', 'partners.read', 'invoices.read', 'invoices.manage', 'imports.read', 'combos.read', 'returns.read',
  'stats.read', 'cashbook.read', 'payrolls.read', 'sync.read', 'sync.manage',
  'settings.read',
];

const DEFAULT_EMPLOYEE_PERMISSION_KEYS = [
  'store.read', 'products.read', 'customers.read', 'partners.read', 'invoices.read', 'invoices.manage', 'imports.read',
  'combos.read', 'returns.read', 'sync.read', 'settings.read',
];

const DEFAULT_ACCOUNTANT_PERMISSION_KEYS = [
  'stats.read', 'cashbook.read', 'cashbook.manage', 'accounting.read', 'accounting.manage',
  'tax_reports.read', 'tax_reports.manage', 'inventory_reports.read', 'revenue_reports.read',
  'profit_reports.read', 'debts.read', 'debts.manage', 'einvoices.read', 'einvoices.manage',
  'bank_accounts.read', 'bank_accounts.manage', 'activity_logs.read', 'imports.read', 'invoices.read',
  'customers.read', 'partners.read', 'products.read',
];

const DEFAULT_CASHIER_PERMISSION_KEYS = [
  'revenue_reports.read',
];

const ROLE_ALIASES = Object.freeze({
  administrator: 'admin',
  quan_tri: 'admin',
  quantri: 'admin',
  'quản_trị': 'admin',
  ke_toan: 'accountant',
  ketoan: 'accountant',
  'kế_toán': 'accountant',
  thu_ngan: 'cashier',
  thungan: 'cashier',
  'thu_ngân': 'cashier',
  nhan_vien: 'employee',
  nhanvien: 'employee',
  'nhân_viên': 'employee',
  staff: 'employee',
});

const ACCOUNTING_SCHEMA_SETTING_KEY = 'accounting_schema_version';
const ACCOUNTING_SCHEMA_VERSION = '1';

const SYNC_TRACKED_TABLES = [
  'store_info', 'users', 'customers', 'products', 'product_categories', 'partners',
  'invoices', 'invoice_details', 'import_logs', 'import_details', 'combos', 'combo_items',
  'daily_stats', 'return_logs', 'return_details', 'customer_types', 'counters', 'cash_book',
  'accounting_transactions', 'cash_fund', 'bank_accounts', 'customer_debts', 'supplier_debts',
  'einvoice_in', 'einvoice_out', 'tax_reports', 'revenue_reports', 'profit_reports', 'accounting_logs',
  'payrolls', 'excel_import_runs', 'excel_import_details', 'print_templates', 'marketplace_shops',
  'marketplace_orders', 'system_settings',
  'feature_catalog', 'update_releases',
];

const LEGACY_KEY_PREFIX = ['b', 'o', 't'].join('');
const REMOVED_LEGACY_PERMISSION_KEYS = new Set([
  `${LEGACY_KEY_PREFIX}.read`,
  `${LEGACY_KEY_PREFIX}.manage`,
]);
function isCurrentSchemaTable(tableName) {
  return Object.prototype.hasOwnProperty.call(SCHEMA, String(tableName || '').trim());
}
const PERMISSION_KEY_ALIASES = {
  'sync.write': 'sync.manage',
};
const INVOICE_CANCELLED_STATUSES = new Set([
  'cancelled',
  'canceled',
  'da_huy',
  'da huy',
  'đã hủy',
  'dã hủy',
  'huy',
  'hủy',
]);
const INVOICE_COMPLETED_STATUSES = new Set([
  'completed',
  'complete',
  'paid',
  'done',
  'da_hoan_thanh',
  'da hoan thanh',
  'đã hoàn thành',
  'dã hoàn thành',
  'da_thanh_toan',
  'da thanh toan',
  'đã thanh toán',
  'dã thanh toán',
]);
const INVOICE_CANCEL_RETENTION_MS = 24 * 60 * 60 * 1000;
const INVOICE_STATUS_CANCELLED_AT_INDEX_FIELDS = Object.freeze(['status', 'cancelled_at']);
const DB_TMP_CLEANUP_MAX_AGE_MS = 5 * 60 * 1000;
const DB_WRITE_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DB_WRITE_RETRY_ATTEMPTS = Math.max(1, Number(process.env.KHA_DB_WRITE_RETRY_ATTEMPTS) || 8);
const DB_WRITE_RETRY_BASE_DELAY_MS = Math.max(1, Number(process.env.KHA_DB_WRITE_RETRY_BASE_DELAY_MS) || 25);
const DB_WRITE_RETRY_MAX_DELAY_MS = Math.max(DB_WRITE_RETRY_BASE_DELAY_MS, Number(process.env.KHA_DB_WRITE_RETRY_MAX_DELAY_MS) || 250);
let hasLoadedDb = false;
let preMigrationBackupDone = false; // KHA hardening (PHẦN 1.3): tránh backup lại trong cùng session
let atomicWriteDepth = 0;

function sleepSync(ms) {
  const delayMs = Math.max(0, Number(ms) || 0);
  if (delayMs <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  } catch (_error) {
    // Ignore environments where synchronous sleeping is unavailable.
  }
}

function isRetryableDbWriteError(error) {
  return process.platform === 'win32' && DB_WRITE_RETRY_CODES.has(String(error?.code || '').toUpperCase());
}

function getDbWriteRetryDelayMs(attempt) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  return Math.min(DB_WRITE_RETRY_MAX_DELAY_MS, DB_WRITE_RETRY_BASE_DELAY_MS * (2 ** (safeAttempt - 1)));
}

function renameFileWithRetry(tmpPath, filePath) {
  let lastError = null;
  for (let attempt = 1; attempt <= DB_WRITE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      fs.renameSync(tmpPath, filePath);
      if (attempt > 1) {
        console.warn(`[KHA DB] Recovered DB rename after retry ${attempt}/${DB_WRITE_RETRY_ATTEMPTS}: ${path.basename(filePath)}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableDbWriteError(error) || attempt >= DB_WRITE_RETRY_ATTEMPTS) break;
      const delayMs = getDbWriteRetryDelayMs(attempt);
      console.warn(`[KHA DB] Retrying DB rename ${attempt}/${DB_WRITE_RETRY_ATTEMPTS} after ${error.code} for ${path.basename(filePath)} (${delayMs}ms)`);
      sleepSync(delayMs);
    }
  }

  if (lastError && isRetryableDbWriteError(lastError)) {
    console.error(`[KHA DB] DB rename failed after ${DB_WRITE_RETRY_ATTEMPTS} attempts for ${path.basename(filePath)}: ${lastError.message}`);
  }
  throw lastError;
}

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

function replaceDB(nextDB) {
  globalThis.__KHA_DB__ = nextDB;
}

function getDb() {
  if (!globalThis.__KHA_DB__) {
    globalThis.__KHA_DB__ = { ...SCHEMA, nextId: { ...INITIAL_NEXT_ID } };
  }
  return globalThis.__KHA_DB__;
}

const db = new Proxy({}, {
  get(_target, prop) {
    return getDb()[prop];
  },
  set(_target, prop, value) {
    getDb()[prop] = value;
    return true;
  },
  has(_target, prop) {
    return prop in getDb();
  },
  ownKeys() {
    return Reflect.ownKeys(getDb());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const current = getDb();
    if (Object.prototype.hasOwnProperty.call(current, prop)) {
      return { enumerable: true, configurable: true };
    }
    return undefined;
  },
});

function ensureDBDirectoryExists() {
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
}

function createEmptyDB() {
  return { ...Object.fromEntries(Object.keys(SCHEMA).map(table => [table, []])), nextId: { ...INITIAL_NEXT_ID } };
}

function getBackupTables() {
  return ['system_backups', 'backup_logs'];
}

function getBackupDataset() {
  const current = getDb();
  const data = createEmptyDB();
  for (const table of Object.keys(SCHEMA)) {
    if (['backup_logs'].includes(table)) continue;
    data[table] = Array.isArray(current[table]) ? current[table] : [];
  }
  data.nextId = { ...(current.nextId || {}) };
  return data;
}

function matchesDatabaseTmpFile(fileName = '') {
  const baseName = path.basename(DB_PATH || '');
  const normalized = String(fileName || '').trim();
  return Boolean(baseName) && normalized.startsWith(`${baseName}.`) && normalized.endsWith('.tmp');
}

function listDatabaseTmpFiles() {
  ensureDBDirectoryExists();
  const dir = path.dirname(DB_PATH);
  return fs.readdirSync(dir)
    .filter(matchesDatabaseTmpFile)
    .map(name => {
      const fullPath = path.join(dir, name);
      try {
        const stat = fs.statSync(fullPath);
        return { name, path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size };
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function cleanupDatabaseTempFiles(options = {}) {
  ensureDBDirectoryExists();
  const nowMs = Number(options.nowMs) || Date.now();
  const maxAgeMs = options.maxAgeMs === undefined ? DB_TMP_CLEANUP_MAX_AGE_MS : Math.max(0, Number(options.maxAgeMs) || 0);
  const recoverIfMissing = options.recoverIfMissing === true;
  const tmpFiles = listDatabaseTmpFiles();

  if (!fs.existsSync(DB_PATH) && recoverIfMissing) {
    const recoveryCandidate = tmpFiles.find(file => {
      try {
        const raw = fs.readFileSync(file.path, 'utf8');
        JSON.parse(raw);
        return true;
      } catch (_error) {
        return false;
      }
    });
    if (recoveryCandidate) {
      fs.copyFileSync(recoveryCandidate.path, DB_PATH);
    }
  }

  for (const file of tmpFiles) {
    if (maxAgeMs > 0 && nowMs - file.mtimeMs < maxAgeMs) continue;
    try {
      fs.unlinkSync(file.path);
    } catch (_error) {
      // Best-effort cleanup only.
    }
  }
}

function atomicWriteJSON(filePath, data) {
  ensureDBDirectoryExists();
  cleanupDatabaseTempFiles({ maxAgeMs: DB_TMP_CLEANUP_MAX_AGE_MS });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let renamed = false;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameFileWithRetry(tmp, filePath);
    renamed = true;
  } finally {
    if (renamed && fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (_error) {
        // Ignore best-effort tmp cleanup failure.
      }
    } else if (!renamed && fs.existsSync(tmp)) {
      console.warn(`[KHA DB] Preserving temporary DB file for recovery: ${path.basename(tmp)}`);
    }
  }
}

function ensureDBFileExists() {
  ensureDBDirectoryExists();
  cleanupDatabaseTempFiles({ recoverIfMissing: true, maxAgeMs: DB_TMP_CLEANUP_MAX_AGE_MS });
  if (!fs.existsSync(DB_PATH)) atomicWriteJSON(DB_PATH, createEmptyDB());
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePaymentMethod(method) {
  return String(method || '').trim();
}

function normalizeTextKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
}

function normalizePermissionKey(value) {
  const normalized = normalizeTextKey(value);
  return PERMISSION_KEY_ALIASES[normalized] || normalized;
}

function normalizeStatusText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ');
}

function isCancelledInvoiceStatus(status) {
  return INVOICE_CANCELLED_STATUSES.has(normalizeStatusText(status));
}

function isCompletedInvoiceStatus(status) {
  return INVOICE_COMPLETED_STATUSES.has(normalizeStatusText(status));
}

function parseTimestampMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? null : time;
}

function resolveTimestampIso(value, fallback = now()) {
  const time = parseTimestampMs(value);
  if (time != null) return new Date(time).toISOString();
  const fallbackTime = parseTimestampMs(fallback);
  return new Date(fallbackTime == null ? Date.now() : fallbackTime).toISOString();
}

function getInvoiceCancellationCutoffMs(referenceTime = Date.now()) {
  const referenceMs = parseTimestampMs(referenceTime);
  return (referenceMs == null ? Date.now() : referenceMs) - INVOICE_CANCEL_RETENTION_MS;
}

function isExpiredCancelledInvoice(invoice, referenceTime = Date.now()) {
  if (!invoice || !isCancelledInvoiceStatus(invoice.status)) return false;
  const cancelledAtMs = parseTimestampMs(invoice.cancelled_at);
  if (cancelledAtMs == null) return false;
  return cancelledAtMs <= getInvoiceCancellationCutoffMs(referenceTime);
}

function isInvoiceVisibleInActiveList(invoice, referenceTime = Date.now()) {
  return !isExpiredCancelledInvoice(invoice, referenceTime);
}

function normalizeInvoiceCancellationSchema() {
  const current = getDb();
  let changed = false;
  if (!Array.isArray(current.invoices)) return changed;

  for (const invoice of current.invoices) {
    if (!invoice || typeof invoice !== 'object') continue;
    if (isCancelledInvoiceStatus(invoice.status)) {
      const currentCancelledAt = parseTimestampMs(invoice.cancelled_at);
      if (currentCancelledAt == null) {
        invoice.cancelled_at = resolveTimestampIso(invoice.updated_at || invoice.created_at || now());
        changed = true;
      }
    } else if (invoice.cancelled_at !== null) {
      invoice.cancelled_at = null;
      changed = true;
    }
  }

  return changed;
}

const DOCUMENT_CODE_CONFIG = Object.freeze({
  invoice: Object.freeze({
    table: 'invoices',
    field: 'invoice_code',
    prefix: 'DH',
    counterName: 'invoice_seq',
    width: 6,
  }),
  import: Object.freeze({
    table: 'import_logs',
    field: 'import_code',
    prefix: 'PN',
    counterName: 'import_seq',
    width: 5,
  }),
  product: Object.freeze({
    table: 'products',
    field: 'sku',
    prefix: 'SP',
    counterName: 'product_seq',
    width: 5,
    duplicateCode: 'PRODUCT_SKU_DUPLICATE',
    duplicateMessage: code => `SKU đã tồn tại trong danh mục sản phẩm: ${code}`,
    immutableCode: 'PRODUCT_SKU_IMMUTABLE',
    immutableMessage: 'Mã SKU sản phẩm đã cấp không được thay đổi.',
  }),
});

function normalizeDocumentCodeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeDocumentCodeLookup(value) {
  return normalizeDocumentCodeText(value).toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readDocumentSequenceNumber(code, prefix) {
  const match = normalizeDocumentCodeText(code).match(new RegExp(`^${escapeRegExp(prefix)}0*(\\d+)$`, 'i'));
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function formatDocumentSequenceCode(prefix, seq, width = 5) {
  return `${String(prefix || '').toUpperCase()}${String(Math.max(1, Math.floor(Number(seq) || 1))).padStart(width, '0')}`;
}

function resolveDocumentCodeConfig(typeOrConfig) {
  if (typeof typeOrConfig === 'string') return DOCUMENT_CODE_CONFIG[typeOrConfig] || null;
  if (!typeOrConfig || typeof typeOrConfig !== 'object') return null;
  return typeOrConfig;
}

function getDocumentCodeConfigForTable(table) {
  return Object.values(DOCUMENT_CODE_CONFIG).find(config => config.table === table) || null;
}

function getMaxDocumentSequence(typeOrConfig) {
  const config = resolveDocumentCodeConfig(typeOrConfig);
  if (!config) return 0;
  const rows = Array.isArray(getDb()[config.table]) ? getDb()[config.table] : [];
  return rows.reduce(
    (max, row) => Math.max(max, readDocumentSequenceNumber(row?.[config.field], config.prefix)),
    0,
  );
}

function findDocumentByCode(typeOrConfig, code, ignoredId = null) {
  const config = resolveDocumentCodeConfig(typeOrConfig);
  const lookupKey = normalizeDocumentCodeLookup(code);
  if (!config || !lookupKey) return null;
  const rows = Array.isArray(getDb()[config.table]) ? getDb()[config.table] : [];
  return rows.find(row => {
    if (!row) return false;
    if (ignoredId != null && Number(row.id) === Number(ignoredId)) return false;
    return normalizeDocumentCodeLookup(row[config.field]) === lookupKey;
  }) || null;
}

function createDocumentCodeDuplicateError(config, code) {
  const normalizedCode = normalizeDocumentCodeText(code);
  const message = typeof config.duplicateMessage === 'function'
    ? config.duplicateMessage(normalizedCode)
    : `Ma ${normalizedCode} da ton tai.`;
  const error = new Error(message);
  error.status = 409;
  error.statusCode = 409;
  error.code = config.duplicateCode || 'DOCUMENT_CODE_DUPLICATE';
  if (config.table === 'products') {
    error.details = { sku: normalizedCode };
  }
  return error;
}

function createDocumentCodeImmutableError(config) {
  const message = config.immutableMessage || `Ma ${config.prefix} da cap khong duoc thay doi.`;
  const error = new Error(message);
  error.status = 400;
  error.statusCode = 400;
  error.code = config.immutableCode || 'DOCUMENT_CODE_IMMUTABLE';
  return error;
}

function shouldValidateDocumentCodeUpdate(config, current = {}, changes = {}, updated = {}) {
  if (!config || !Object.prototype.hasOwnProperty.call(changes || {}, config.field)) return false;

  const currentCode = normalizeDocumentCodeLookup(current?.[config.field]);
  const requestedCode = normalizeDocumentCodeLookup(changes?.[config.field]);
  const updatedCode = normalizeDocumentCodeLookup(updated?.[config.field]);
  if (!updatedCode) return false;
  if (!currentCode) return true;
  return updatedCode !== currentCode || (requestedCode && requestedCode !== currentCode);
}

function ensureSequenceCounterAtLeast(name, minValue) {
  const current = getDb();
  const requestedTarget = Math.max(0, Math.floor(Number(minValue) || 0));
  if (!Array.isArray(current.counters)) current.counters = [];
  if (!current.nextId) current.nextId = { ...INITIAL_NEXT_ID };

  const key = normalizeTextKey(name || 'default');
  let changed = false;
  const matchingCounters = current.counters.filter(row => normalizeTextKey(row?.name || row?.key) === key);
  const target = matchingCounters.reduce(
    (max, row) => Math.max(max, normalizeNumber(row?.value, 0), normalizeNumber(row?.seq, 0)),
    requestedTarget,
  );
  if (target <= 0) return false;
  let counter = matchingCounters
    .slice()
    .sort((a, b) => Math.max(normalizeNumber(b?.value, 0), normalizeNumber(b?.seq, 0))
      - Math.max(normalizeNumber(a?.value, 0), normalizeNumber(a?.seq, 0)))[0];
  const timestamp = now();

  if (!counter) {
    const id = current.nextId.counters || 1;
    current.nextId.counters = id + 1;
    current.counters.push({
      id,
      account_id: null,
      name: key,
      key,
      value: target,
      seq: target,
      created_at: timestamp,
      updated_at: timestamp,
    });
    return true;
  }

  const currentValue = Math.max(
    normalizeNumber(counter.value, 0),
    normalizeNumber(counter.seq, 0),
  );
  if (currentValue < target) {
    counter.value = target;
    counter.seq = target;
    counter.updated_at = timestamp;
    changed = true;
  }
  if (!counter.name) {
    counter.name = key;
    changed = true;
  }
  if (!counter.key) {
    counter.key = key;
    changed = true;
  }
  return changed;
}

function ensureDocumentSequenceCounter(typeOrConfig) {
  const config = resolveDocumentCodeConfig(typeOrConfig);
  if (!config) return false;
  return ensureSequenceCounterAtLeast(config.counterName, getMaxDocumentSequence(config));
}

function ensureAllDocumentSequenceCounters() {
  let changed = false;
  for (const config of Object.values(DOCUMENT_CODE_CONFIG)) {
    if (ensureDocumentSequenceCounter(config)) changed = true;
  }
  return changed;
}

function generateNextDocumentCode(typeOrConfig, options = {}) {
  const config = resolveDocumentCodeConfig(typeOrConfig);
  if (!config) {
    const error = new Error(`Unknown document code type: ${String(typeOrConfig || '')}`);
    error.code = 'DOCUMENT_CODE_TYPE_INVALID';
    throw error;
  }

  ensureDocumentSequenceCounter(config);
  for (let attempt = 0; attempt < 100000; attempt += 1) {
    const seq = getNextSeq(config.counterName, options);
    const code = formatDocumentSequenceCode(config.prefix, seq, config.width);
    if (!findDocumentByCode(config, code, options.ignoredId)) return code;
  }

  const error = new Error(`Khong the cap ma ${config.prefix} moi sau nhieu lan thu.`);
  error.code = 'DOCUMENT_CODE_EXHAUSTED';
  throw error;
}

function ensureDocumentSequenceForRow(table, row = {}) {
  const config = getDocumentCodeConfigForTable(table);
  if (!config) return false;
  const seq = readDocumentSequenceNumber(row?.[config.field], config.prefix);
  return seq > 0 ? ensureSequenceCounterAtLeast(config.counterName, seq) : false;
}

function normalizeInvoiceCodeText(value) {
  return normalizeDocumentCodeText(value);
}

function normalizeInvoiceCodeLookup(value) {
  return normalizeDocumentCodeLookup(value);
}

function readInvoiceSequenceNumber(code) {
  return readDocumentSequenceNumber(code, DOCUMENT_CODE_CONFIG.invoice.prefix);
}

function formatInvoiceSequenceCode(seq) {
  return formatDocumentSequenceCode(
    DOCUMENT_CODE_CONFIG.invoice.prefix,
    seq,
    DOCUMENT_CODE_CONFIG.invoice.width,
  );
}

function getNextAvailableInvoiceCode(usedCodes, startSeq = 1) {
  let seq = Math.max(1, Math.floor(Number(startSeq) || 1));
  for (let attempt = 0; attempt < 100000; attempt += 1) {
    const code = formatInvoiceSequenceCode(seq);
    if (!usedCodes.has(normalizeInvoiceCodeLookup(code))) return { code, seq };
    seq += 1;
  }
  return { code: `HD${Date.now().toString(36).toUpperCase()}`, seq: 0 };
}

function ensureInvoiceSequenceCounterAtLeast(minValue) {
  return ensureSequenceCounterAtLeast(DOCUMENT_CODE_CONFIG.invoice.counterName, minValue);
}

function normalizeInvoiceCodeUniqueness() {
  const current = getDb();
  let changed = false;
  if (!Array.isArray(current.invoices)) return changed;

  const invoices = current.invoices
    .filter(invoice => invoice && typeof invoice === 'object')
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  const usedCodes = new Set();
  let maxSeq = invoices.reduce((max, invoice) => Math.max(max, readInvoiceSequenceNumber(invoice.invoice_code)), 0);
  let nextSeq = maxSeq + 1;

  for (const invoice of invoices) {
    const normalizedCode = normalizeInvoiceCodeText(invoice.invoice_code);
    const lookupKey = normalizeInvoiceCodeLookup(normalizedCode);

    if (lookupKey && !usedCodes.has(lookupKey)) {
      if (invoice.invoice_code !== normalizedCode) {
        invoice.invoice_code = normalizedCode;
        changed = true;
      }
      usedCodes.add(lookupKey);
      continue;
    }

    const next = getNextAvailableInvoiceCode(usedCodes, nextSeq);
    invoice.invoice_code = next.code;
    usedCodes.add(normalizeInvoiceCodeLookup(next.code));
    if (next.seq > 0) {
      maxSeq = Math.max(maxSeq, next.seq);
      nextSeq = next.seq + 1;
    }
    changed = true;
  }

  maxSeq = invoices.reduce((max, invoice) => Math.max(max, readInvoiceSequenceNumber(invoice.invoice_code)), maxSeq);
  if (ensureInvoiceSequenceCounterAtLeast(maxSeq)) changed = true;
  return changed;
}

function normalizeDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || '').trim();
  if (!text) return '';
  const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (directMatch) return directMatch[1];
  const isoPrefixMatch = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoPrefixMatch) return isoPrefixMatch[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

const DEFAULT_PRODUCT_CATEGORIES = [];

const DEFAULT_FEATURE_CATALOG = [
  {
    feature_key: 'negative_stock_exports',
    name: 'Xuất âm tồn kho',
    description: 'Bật để cho phép xuất vượt tồn kho theo giới hạn cấu hình trong thiết lập hệ thống.',
    category: 'Kho hàng',
    active: 0,
    metadata: {},
  },
];

const DEFAULT_SYSTEM_SETTINGS = [
  {
    key: 'negative_stock_enabled',
    value: '0',
    value_type: 'boolean',
    category: 'inventory',
    description: 'Bật/tắt chức năng xuất âm tồn kho.',
  },
  {
    key: 'negative_stock_limit',
    value: '10',
    value_type: 'integer',
    category: 'inventory',
    description: 'Admin có thể chỉnh số lượng tồn âm tối đa trực tiếp từ giao diện.',
  },
];

function sanitizeBackupReason(reason = 'manual') {
  return String(reason || 'manual').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 80) || 'manual';
}

function ensureDbBackupDirectoryExists() {
  fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
}

const DB_BACKUP_TOTAL_SIZE_LIMIT_BYTES = Math.max(0, Number(process.env.KHA_DB_BACKUP_TOTAL_SIZE_LIMIT_BYTES) || 2 * 1024 * 1024 * 1024);

function normalizeBackupRecord(record = {}) {
  return {
    ...record,
    backup_type: String(record.backup_type || 'scheduled').trim(),
    status: String(record.status || 'success').trim(),
    backup_name: String(record.backup_name || '').trim(),
    file_path: String(record.file_path || '').trim(),
    note: String(record.note || '').trim(),
    created_at: record.created_at || now(),
  };
}

function ensureBackupTables() {
  const current = getDb();
  for (const table of ['system_backups', 'backup_logs']) {
    if (!Array.isArray(current[table])) current[table] = [];
    if (!current.nextId || typeof current.nextId !== 'object') current.nextId = { ...INITIAL_NEXT_ID };
    if (current.nextId[table] == null) current.nextId[table] = 1;
  }
}

function getBackupRecords(limit = 1000) {
  ensureBackupTables();
  return getAll('system_backups', null, { skipAccountScope: true })
    .slice()
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, Math.max(1, Number(limit) || 1000));
}

function getBackupLogs(limit = 200) {
  ensureBackupTables();
  return getAll('backup_logs', null, { skipAccountScope: true })
    .slice()
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, Math.max(1, Number(limit) || 200));
}

function addBackupRecord(record = {}, options = {}) {
  ensureBackupTables();
  const payload = normalizeBackupRecord(record);
  const inserted = insert('system_backups', payload, { skipSave: options.skipSave === true, skipTouch: true, skipAccountScope: true });
  return getOne('system_backups', row => Number(row.id) === Number(inserted), { skipAccountScope: true });
}

function addBackupLog(record = {}, options = {}) {
  ensureBackupTables();
  const payload = {
    ...record,
    status: String(record.status || 'success').trim(),
    created_at: record.created_at || now(),
  };
  const inserted = insert('backup_logs', payload, { skipSave: options.skipSave === true, skipTouch: true, skipAccountScope: true });
  return getOne('backup_logs', row => Number(row.id) === Number(inserted), { skipAccountScope: true });
}

function getBackupDisplayName(fileName = '') {
  return String(fileName || '').replace(/\.gz$/i, '');
}

function listDbBackups() {
  try {
    ensureDbBackupDirectoryExists();
    return fs.readdirSync(DB_BACKUP_DIR)
      .filter(file => file.startsWith('phanmienoffline-db-') && (file.endsWith('.zip') || file.endsWith('.json') || file.endsWith('.json.gz')))
      .map(file => {
        const fullPath = path.join(DB_BACKUP_DIR, file);
        try {
          const stat = fs.statSync(fullPath);
          return { file, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs, mtime: new Date(stat.mtimeMs).toISOString() };
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (_error) {
    return [];
  }
}

function pruneDbBackups(retentionCount = DB_BACKUP_RETENTION_COUNT) {
  const keep = Math.max(1, Number(retentionCount) || DB_BACKUP_RETENTION_COUNT);
  const backups = listDbBackups();
  for (const backup of backups.slice(keep)) {
    try {
      fs.unlinkSync(backup.path);
    } catch (_error) {
      // Best-effort retention cleanup only.
    }
  }
  if (DB_BACKUP_TOTAL_SIZE_LIMIT_BYTES > 0) {
    let total = backups.slice(0, keep).reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    for (const backup of backups.slice(keep).reverse()) {
      if (total <= DB_BACKUP_TOTAL_SIZE_LIMIT_BYTES) break;
      try {
        fs.unlinkSync(backup.path);
        total -= Number(backup.size) || 0;
      } catch (_error) {}
    }
  }
  return backups.slice(0, keep);
}

function createDbBackup(reason = 'manual', options = {}) {
  if (!fs.existsSync(DB_PATH)) return null;
  ensureDbBackupDirectoryExists();
  ensureBackupTables();
  const safeReason = sanitizeBackupReason(reason);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupData = getBackupDataset();
  const fileName = `phanmienoffline-db-${stamp}-${safeReason}.zip`;
  const backupPath = path.join(DB_BACKUP_DIR, fileName);
  const tempDir = fs.mkdtempSync(path.join(path.dirname(DB_BACKUP_DIR), 'kha-backup-'));
  const tempJson = path.join(tempDir, 'database.json');
  const tempManifest = path.join(tempDir, 'manifest.json');
  try {
    fs.writeFileSync(tempJson, JSON.stringify(backupData, null, 2), 'utf8');
    fs.writeFileSync(tempManifest, JSON.stringify({
      backup_name: fileName,
      backup_type: safeReason,
      created_at: now(),
      total_records: Object.keys(SCHEMA).reduce((sum, table) => sum + (Array.isArray(backupData[table]) ? backupData[table].length : 0), 0),
    }, null, 2), 'utf8');

    const zipCmd = `Compress-Archive -Path '${tempJson.replace(/'/g, "''")}', '${tempManifest.replace(/'/g, "''")}' -DestinationPath '${backupPath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`;
    const zipResult = spawnSync('powershell', ['-NoProfile', '-Command', zipCmd], { encoding: 'utf8' });
    if (zipResult.status !== 0 || !fs.existsSync(backupPath)) {
      throw new Error(zipResult.stderr || zipResult.stdout || 'Compress-Archive failed');
    }

    const stat = fs.statSync(backupPath);
    const totalRecords = Object.keys(SCHEMA).reduce((sum, table) => sum + (Array.isArray(backupData[table]) ? backupData[table].length : 0), 0);
    const record = addBackupRecord({ backup_name: fileName, backup_type: safeReason, file_path: backupPath, file_size: stat.size, total_records: totalRecords, status: 'success', note: '' }, { skipSave: true });
    addBackupLog({ backup_file: fileName, file_size: stat.size, total_records: totalRecords, status: 'success', detail: `Backup ${safeReason} created`, backup_id: record?.id || null }, { skipSave: true });

    for (const root of DATA_PRESERVATION_BACKUP_ROOTS) {
      try {
        const mirrorDir = path.join(root, DATA_PRESERVATION_BACKUP_FOLDER, 'database');
        fs.mkdirSync(mirrorDir, { recursive: true });
        fs.copyFileSync(backupPath, path.join(mirrorDir, fileName));
      } catch (_error) {}
    }

    if (options.skipRetention !== true) pruneDbBackups(options.retentionCount || DB_BACKUP_RETENTION_COUNT);
    return {
      path: backupPath,
      file: path.basename(backupPath),
      reason: safeReason,
      size: stat.size,
      created_at: now(),
      total_records: totalRecords,
    };
  } catch (error) {
    console.warn('[KHA DB] primary backup failed:', error.message);
    addBackupLog({ backup_file: fileName, file_size: 0, total_records: 0, status: 'failed', detail: error.message }, { skipSave: true });
    return null;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function backupDB(reason = 'migration') {
  const backup = createDbBackup(reason, { skipRetention: false });
  return backup ? backup.path : null;
}

function runScheduledDbBackup(reason = 'scheduled', options = {}) {
  const backups = listDbBackups();
  const newest = backups[0] || null;
  const minIntervalMs = options.minIntervalMs === undefined ? DB_BACKUP_MIN_INTERVAL_MS : Math.max(0, Number(options.minIntervalMs) || 0);
  if (newest && minIntervalMs > 0 && Date.now() - newest.mtimeMs < minIntervalMs) {
    return { ok: true, skipped: true, reason: 'recent_backup_exists', latest: newest };
  }

  const backup = createDbBackup(reason, { retentionCount: options.retentionCount || DB_BACKUP_RETENTION_COUNT });
  if (!backup) return { ok: false, skipped: true, reason: 'db_file_missing' };
  try {
    auditLog('db.backup', { backup, reason: backup.reason }, { skipSave: true });
  } catch (_error) {
    // Audit is best-effort and must never block backup.
  }
  return { ok: true, backup };
}

function recalculateNextIds() {
  const current = getDb();
  const nextId = { ...INITIAL_NEXT_ID, ...(current.nextId || {}) };
  for (const table of Object.keys(SCHEMA)) {
    const rows = Array.isArray(current[table]) ? current[table] : [];
    const max = rows.reduce((m, row) => Math.max(m, Number(row?.id) || 0), 0);
    nextId[table] = Math.max(Number(nextId[table]) || 1, max + 1);
  }
  current.nextId = nextId;
}

function normalizeRoleValue(role) {
  const raw = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return 'user';
  return ROLE_ALIASES[raw] || raw;
}

function normalizeDBData() {
  const current = getDb();
  let changed = false;

  for (const table of Object.keys(SCHEMA)) {
    if (!Array.isArray(current[table])) {
      current[table] = [];
      changed = true;
    }
  }
  if (!current.nextId || typeof current.nextId !== 'object') {
    current.nextId = { ...INITIAL_NEXT_ID };
    changed = true;
  }

  recalculateNextIds();
  return changed;
}

function getDefaultAccount() {
  const current = getDb();
  return (current.accounts || []).find(acc => acc.slug === DEFAULT_ACCOUNT_SLUG && !acc.deleted_at)
    || (current.accounts || []).find(acc => !acc.deleted_at)
    || null;
}

function ensureDefaultAccount() {
  const current = getDb();
  let account = getDefaultAccount();
  if (account) return account;

  const id = current.nextId.accounts || 1;
  current.nextId.accounts = id + 1;
  account = {
    id,
    slug: DEFAULT_ACCOUNT_SLUG,
    name: 'Tài khoản mặc định',
    status: 'active',
    created_at: now(),
    updated_at: now(),
  };
  current.accounts.push(account);
  return account;
}

function seedDefaultPermissions() {
  const current = getDb();
  const dedupedPermissions = [];
  const seenKeys = new Set();

  for (const row of current.permissions) {
    if (!row) continue;
    const normalizedKey = normalizePermissionKey(row.key);
    if (!normalizedKey) continue;
    row.key = normalizedKey;
    row.updated_at = row.updated_at || now();
    if (seenKeys.has(normalizedKey)) {
      const existing = dedupedPermissions.find(item => item.key === normalizedKey);
      if (existing) {
        existing.name = existing.name || row.name || '';
        existing.description = existing.description || row.description || '';
        existing.updated_at = now();
      }
      continue;
    }
    seenKeys.add(normalizedKey);
    dedupedPermissions.push(row);
  }
  current.permissions = dedupedPermissions;

  for (const [key, name, description] of DEFAULT_PERMISSIONS) {
    const normalizedKey = normalizePermissionKey(key);
    const existing = current.permissions.find(row => row.key === normalizedKey);
    if (existing) {
      existing.key = normalizedKey;
      existing.name = existing.name || name;
      existing.description = existing.description || description;
      existing.updated_at = now();
      continue;
    }
    const id = current.nextId.permissions || 1;
    current.nextId.permissions = id + 1;
    current.permissions.push({ id, key: normalizedKey, name, description, created_at: now(), updated_at: now() });
  }
}

function seedDefaultRolePermissions() {
  const current = getDb();
  const normalizedRolePermissions = [];
  const seenPairs = new Set();

  for (const row of current.role_permissions) {
    if (!row) continue;
    const role = normalizeRoleValue(row.role);
    const permission_key = normalizePermissionKey(row.permission_key);
    if (!permission_key) continue;
    const pairKey = `${role}:${permission_key}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    normalizedRolePermissions.push({
      ...row,
      role,
      permission_key,
      updated_at: row.updated_at || now(),
    });
  }
  current.role_permissions = normalizedRolePermissions;

  const allKeys = Array.from(new Set(current.permissions.map(p => normalizePermissionKey(p.key)).filter(Boolean)));
  const roleMap = {
    admin: allKeys,
    owner: allKeys,
    manager: allKeys.filter(key => !key.endsWith('.manage') || !['admin_panel.manage', 'features.manage', 'updates.manage', 'users.manage', 'print_templates.manage'].includes(key)),
    accountant: DEFAULT_ACCOUNTANT_PERMISSION_KEYS.map(normalizePermissionKey),
    cashier: DEFAULT_CASHIER_PERMISSION_KEYS.map(normalizePermissionKey),
    employee: DEFAULT_EMPLOYEE_PERMISSION_KEYS.map(normalizePermissionKey),
    user: DEFAULT_USER_PERMISSION_KEYS.map(normalizePermissionKey),
  };

  for (const [role, keys] of Object.entries(roleMap)) {
    for (const rawPermissionKey of keys) {
      const permission_key = normalizePermissionKey(rawPermissionKey);
      if (!permission_key) continue;
      if (current.role_permissions.some(row => row.role === role && row.permission_key === permission_key)) continue;
      const id = current.nextId.role_permissions || 1;
      current.nextId.role_permissions = id + 1;
      current.role_permissions.push({ id, role, permission_key, created_at: now(), updated_at: now() });
    }
  }
}

function cleanupRemovedLegacyArtifacts() {
  const current = getDb();
  current.permissions = current.permissions.filter(
    row => !REMOVED_LEGACY_PERMISSION_KEYS.has(String(row?.key || '').trim())
  );
  current.role_permissions = current.role_permissions.filter(
    row => !REMOVED_LEGACY_PERMISSION_KEYS.has(String(row?.permission_key || '').trim())
  );
  current.sync_metadata = current.sync_metadata.filter(
    row => isCurrentSchemaTable(row?.table_name)
  );
  if (current.nextId && typeof current.nextId === 'object') {
    for (const table of Object.keys(current.nextId)) {
      if (!isCurrentSchemaTable(table)) delete current.nextId[table];
    }
  }
}

function normalizeAccountScopedRows(defaultAccountId) {
  const current = getDb();
  for (const table of ACCOUNT_SCOPED_TABLES) {
    const rows = current[table];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && row.account_id == null) row.account_id = defaultAccountId;
    }
  }
}

function ensureSyncMetadataForAccounts() {
  const current = getDb();
  const accounts = current.accounts.length ? current.accounts : [ensureDefaultAccount()];
  for (const account of accounts) {
    for (const table of SYNC_TRACKED_TABLES) {
      if (current.sync_metadata.some(row => row.account_id === account.id && row.table_name === table)) continue;
      const id = current.nextId.sync_metadata || 1;
      current.nextId.sync_metadata = id + 1;
      current.sync_metadata.push({
        id,
        account_id: account.id,
        table_name: table,
        version: 1,
        updated_at: now(),
      });
    }
  }
}

function seedDefaultAdmin(_defaultAccountId) {
  // Intentionally disabled: first-user/bootstrap admin flow must remain intact.
}

function seedDefaultFeatureCatalog() {
  const current = getDb();
  const defaultAccount = ensureDefaultAccount();
  for (const feature of DEFAULT_FEATURE_CATALOG) {
    const featureKey = String(feature.feature_key || '').trim().toLowerCase();
    if (!featureKey) continue;
    const existing = current.feature_catalog.find(row => row && !row.deleted_at && String(row.feature_key || row.key || row.code || '').trim().toLowerCase() === featureKey);
    if (existing) continue;
    const id = current.nextId.feature_catalog || 1;
    current.nextId.feature_catalog = id + 1;
    current.feature_catalog.push({
      id,
      account_id: defaultAccount.id,
      feature_key: featureKey,
      name: feature.name || featureKey,
      description: feature.description || '',
      category: feature.category || '',
      active: feature.active === undefined ? 0 : feature.active,
      metadata: feature.metadata || {},
      created_at: now(),
      updated_at: now(),
    });
  }
}

function seedDefaultSystemSettings() {
  const current = getDb();
  const defaultAccount = ensureDefaultAccount();
  const accounts = current.accounts.length ? current.accounts.filter(account => account && !account.deleted_at) : [defaultAccount];
  const negativeStockFeature = current.feature_catalog.find(row => row
    && !row.deleted_at
    && normalizeTextKey(row.feature_key || row.key || row.code) === 'negative_stock_exports');
  const defaultValues = DEFAULT_SYSTEM_SETTINGS.map(setting => {
    if (setting.key !== 'negative_stock_enabled') return setting;
    return {
      ...setting,
      value: negativeStockFeature && negativeStockFeature.active !== 0 ? '1' : '0',
    };
  });

  for (const account of accounts) {
    const accountId = account?.id || defaultAccount.id;
    for (const setting of defaultValues) {
      const key = normalizeTextKey(setting.key);
      if (!key) continue;
      const existing = current.system_settings.find(row => row
        && !row.deleted_at
        && normalizeTextKey(row.key || row.setting_key) === key
        && (row.account_id == null || Number(row.account_id) === Number(accountId)));
      if (existing) {
        existing.key = key;
        existing.account_id = existing.account_id == null ? accountId : existing.account_id;
        existing.value_type = existing.value_type || setting.value_type || 'string';
        existing.category = existing.category || setting.category || 'general';
        existing.description = existing.description || setting.description || '';
        if (key === 'negative_stock_limit') {
          const limit = Number(existing.value);
          if (!Number.isInteger(limit) || limit < 0) existing.value = String(setting.value ?? '10');
          existing.value_type = 'integer';
          existing.category = 'inventory';
          existing.description = setting.description || existing.description || '';
        }
        existing.updated_at = existing.updated_at || now();
        continue;
      }

      const id = current.nextId.system_settings || 1;
      current.nextId.system_settings = id + 1;
      current.system_settings.push({
        id,
        account_id: accountId,
        key,
        value: String(setting.value ?? ''),
        value_type: setting.value_type || 'string',
        category: setting.category || 'general',
        description: setting.description || '',
        created_at: now(),
        updated_at: now(),
      });
    }
  }
}

function findCategoryByText(_text) { return null; }
function seedDefaultProductCategories() {
  const current = getDb();
  const defaultAccount = ensureDefaultAccount();
  for (const category of DEFAULT_PRODUCT_CATEGORIES) {
    const name = typeof category === 'string' ? category : category?.name;
    if (!name || current.product_categories.some(row => row.name === name && row.account_id === defaultAccount.id)) continue;
    const id = current.nextId.product_categories || 1;
    current.nextId.product_categories = id + 1;
    current.product_categories.push({ id, name, account_id: defaultAccount.id, created_at: now(), updated_at: now() });
  }
}
function ensureField(row, field, valueFactory) {
  if (row && row[field] == null) row[field] = typeof valueFactory === 'function' ? valueFactory(row) : valueFactory;
}

function ensureAuthAndSyncSchema() {
  const defaultAccount = ensureDefaultAccount();
  seedDefaultPermissions();
  seedDefaultRolePermissions();
  normalizeAccountScopedRows(defaultAccount.id);
  ensureSyncMetadataForAccounts();
  seedDefaultAdmin(defaultAccount.id);
}

function getAccountingSchemaVersionSetting(accountId = null) {
  const current = getDb();
  return (current.system_settings || []).find(row => row
    && normalizeTextKey(row.key || row.setting_key) === ACCOUNTING_SCHEMA_SETTING_KEY
    && (accountId == null || row.account_id == null || Number(row.account_id) === Number(accountId))) || null;
}

function hasAccountingSchemaVersion() {
  const setting = getAccountingSchemaVersionSetting();
  return setting && String(setting.value || '') === ACCOUNTING_SCHEMA_VERSION;
}

function ensureAccountingMigrationBackup() {
  if (hasAccountingSchemaVersion()) return null;
  try {
    return createDbBackup('before-accounting-schema', { skipRetention: false });
  } catch (error) {
    console.warn(`[KHA DB] Không thể tạo backup trước migration kế toán: ${error.message}`);
    return null;
  }
}

function ensureRowId(table, row) {
  const current = getDb();
  if (!row || row.id != null) return false;
  const id = current.nextId?.[table] || 1;
  row.id = id;
  current.nextId[table] = id + 1;
  return true;
}

function normalizeAccountingTableRows(defaultAccountId) {
  const current = getDb();
  let changed = false;
  const timestamp = now();
  const accountingTables = [
    'accounting_transactions', 'cash_fund', 'bank_accounts', 'customer_debts', 'supplier_debts',
    'einvoice_in', 'einvoice_out', 'tax_reports', 'revenue_reports', 'profit_reports', 'accounting_logs',
  ];

  for (const table of accountingTables) {
    const rows = current[table];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (ensureRowId(table, row)) changed = true;
      if (row.account_id == null) {
        row.account_id = defaultAccountId;
        changed = true;
      }
      if (row.created_at == null) {
        row.created_at = timestamp;
        changed = true;
      }
      if (table !== 'accounting_logs' && row.updated_at == null) {
        row.updated_at = row.created_at || timestamp;
        changed = true;
      }
      if (table === 'accounting_transactions' && !row.status) {
        row.status = 'posted';
        changed = true;
      }
      if (table === 'cash_fund' && row.active == null) {
        row.active = 1;
        changed = true;
      }
      if (table === 'bank_accounts' && row.active == null) {
        row.active = 1;
        changed = true;
      }
    }
  }
  return changed;
}

function normalizeInvoiceAccountingFields() {
  const current = getDb();
  let changed = false;
  const timestamp = now();
  for (const invoice of current.invoices || []) {
    if (!invoice || typeof invoice !== 'object') continue;
    if (!invoice.stock_effect_status) {
      invoice.stock_effect_status = isCancelledInvoiceStatus(invoice.status) ? 'restored_on_cancel' : 'deducted_on_create';
      changed = true;
    }
    if (!invoice.stock_effect_source) {
      invoice.stock_effect_source = 'legacy_create_invoice_flow';
      changed = true;
    }
    if (invoice.accounting_status == null) {
      invoice.accounting_status = isCompletedInvoiceStatus(invoice.status) ? 'pending' : (isCancelledInvoiceStatus(invoice.status) ? 'reversed' : 'not_posted');
      changed = true;
    }
    if (invoice.posted_at === undefined) {
      invoice.posted_at = null;
      changed = true;
    }
    if (invoice.reversed_at === undefined) {
      invoice.reversed_at = isCancelledInvoiceStatus(invoice.status) ? (invoice.cancelled_at || invoice.updated_at || timestamp) : null;
      changed = true;
    }
  }

  for (const importLog of current.import_logs || []) {
    if (!importLog || typeof importLog !== 'object') continue;
    if (importLog.accounting_status == null) {
      importLog.accounting_status = normalizeStatusText(importLog.status) === 'received' ? 'pending' : (normalizeStatusText(importLog.status) === 'cancelled' ? 'reversed' : 'not_posted');
      changed = true;
    }
    if (importLog.posted_at === undefined) {
      importLog.posted_at = null;
      changed = true;
    }
    if (importLog.reversed_at === undefined) {
      importLog.reversed_at = normalizeStatusText(importLog.status) === 'cancelled' ? (importLog.cancelled_at || importLog.updated_at || timestamp) : null;
      changed = true;
    }
  }
  return changed;
}

function backfillCashFundFromCashBook(defaultAccountId) {
  const current = getDb();
  let changed = false;
  const existingCashBookIds = new Set((current.cash_fund || [])
    .map(row => Number(row?.cash_book_id))
    .filter(id => Number.isFinite(id) && id > 0));

  for (const row of current.cash_book || []) {
    if (!row || row.id == null || existingCashBookIds.has(Number(row.id))) continue;
    const id = current.nextId.cash_fund || 1;
    current.nextId.cash_fund = id + 1;
    const method = normalizePaymentMethod(row.payment_method || 'cash');
    current.cash_fund.push({
      id,
      account_id: row.account_id || defaultAccountId,
      date: row.date || normalizeDateKey(row.created_at) || today(),
      time: row.time || String(row.created_at || now()).slice(11, 19) || '00:00:00',
      fund_type: method === 'bank' ? 'bank' : 'cash',
      bank_account_id: row.bank_account_id || null,
      type: row.type === 'expense' ? 'expense' : 'income',
      category: row.category || '',
      amount: normalizeNumber(row.amount, 0),
      payment_method: method,
      note: row.note || '',
      source_type: row.reference_type || 'cash_book',
      source_id: row.reference_id || row.id,
      cash_book_id: row.id,
      active: row.active === 0 ? 0 : 1,
      voided_at: row.voided_at || null,
      void_reason: row.void_reason || '',
      created_by: row.created_by || row.user_id || null,
      created_at: row.created_at || now(),
      updated_at: row.updated_at || row.created_at || now(),
    });
    existingCashBookIds.add(Number(row.id));
    changed = true;
  }
  return changed;
}

function ensureAccountingSchemaVersionSetting(defaultAccountId) {
  const current = getDb();
  const existing = getAccountingSchemaVersionSetting(defaultAccountId);
  const timestamp = now();
  if (existing) {
    if (String(existing.value || '') === ACCOUNTING_SCHEMA_VERSION) return false;
    existing.value = ACCOUNTING_SCHEMA_VERSION;
    existing.value_type = 'string';
    existing.category = 'accounting';
    existing.description = existing.description || 'Phiên bản schema kế toán backend JSON';
    existing.updated_at = timestamp;
    return true;
  }

  const id = current.nextId.system_settings || 1;
  current.nextId.system_settings = id + 1;
  current.system_settings.push({
    id,
    account_id: defaultAccountId,
    key: ACCOUNTING_SCHEMA_SETTING_KEY,
    value: ACCOUNTING_SCHEMA_VERSION,
    value_type: 'string',
    category: 'accounting',
    description: 'Phiên bản schema kế toán backend JSON',
    created_at: timestamp,
    updated_at: timestamp,
  });
  return true;
}

function migrateAccountingSchema() {
  const defaultAccount = ensureDefaultAccount();
  ensureAccountingMigrationBackup();
  normalizeAccountingTableRows(defaultAccount.id);
  normalizeInvoiceAccountingFields();
  backfillCashFundFromCashBook(defaultAccount.id);
  ensureAccountingSchemaVersionSetting(defaultAccount.id);
}

function buildDailyStatsRowsFromInvoices() {
  const current = getDb();
  const defaultAccount = ensureDefaultAccount();
  const existingRowsByKey = new Map();

  for (const row of current.daily_stats || []) {
    if (!row) continue;
    const statDate = normalizeDateKey(row.stat_date || row.date || row.created_at);
    if (!statDate) continue;
    const accountId = row.account_id == null ? defaultAccount.id : row.account_id;
    const rowKey = `${accountId}:${statDate}`;
    if (!existingRowsByKey.has(rowKey)) {
      existingRowsByKey.set(rowKey, {
        id: Number(row.id) || null,
        created_at: row.created_at || null,
      });
    }
  }

  const rowsByKey = new Map();
  for (const invoice of current.invoices || []) {
    if (!invoice || !isCompletedInvoiceStatus(invoice.status)) continue;
    const statDate = normalizeDateKey(invoice.created_at || invoice.updated_at);
    if (!statDate) continue;
    const accountId = invoice.account_id == null ? defaultAccount.id : invoice.account_id;
    const rowKey = `${accountId}:${statDate}`;
    if (!rowsByKey.has(rowKey)) {
      const existing = existingRowsByKey.get(rowKey) || {};
      rowsByKey.set(rowKey, {
        id: existing.id || null,
        account_id: accountId,
        stat_date: statDate,
        total_revenue: 0,
        total_orders: 0,
        created_at: existing.created_at || invoice.created_at || now(),
        updated_at: now(),
      });
    }
    const row = rowsByKey.get(rowKey);
    row.total_revenue += normalizeNumber(invoice.total, 0);
    row.total_orders += 1;
  }

  return Array.from(rowsByKey.values())
    .map(row => ({
      ...row,
      total_revenue: normalizeNumber(row.total_revenue, 0),
      total_orders: Math.max(0, Math.round(normalizeNumber(row.total_orders, 0))),
      updated_at: row.updated_at || now(),
      created_at: row.created_at || now(),
    }))
    .sort((a, b) => String(a.stat_date || '').localeCompare(String(b.stat_date || '')) || Number(a.account_id || 0) - Number(b.account_id || 0));
}

function rebuildAllDailyStatsFromInvoices() {
  const current = getDb();
  const rebuiltRows = buildDailyStatsRowsFromInvoices();
  for (const row of rebuiltRows) {
    const numericId = Number(row.id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      const id = current.nextId.daily_stats || 1;
      current.nextId.daily_stats = id + 1;
      row.id = id;
    }
  }
  current.daily_stats = rebuiltRows;
}

function importOldCustomerDatabase() {
  const current = getDb();
  const targetEmail = 'dongphuongqc@gmail.com';
  
  const appDataRoots = [];
  const roaming = process.env.APPDATA || '';
  if (roaming) {
    appDataRoots.push(path.join(roaming, 'phanmienoffline-electron'));
    appDataRoots.push(path.join(roaming, 'Ban hang offline - Van kha mmo'));
    appDataRoots.push(path.join(roaming, 'Electron'));
  }
  if (process.env.ELECTRON_USER_DATA && !appDataRoots.includes(process.env.ELECTRON_USER_DATA)) {
    appDataRoots.push(process.env.ELECTRON_USER_DATA);
  }

  const uniqueRoots = [...new Set(appDataRoots.map(p => path.resolve(p)))];
  const pathsToSearch = [];

  for (const root of uniqueRoots) {
    pathsToSearch.push(path.join(root, 'phanmienoffline.db.json'));

    const backupDir = path.join(root, 'backups');
    if (fs.existsSync(backupDir)) {
      try {
        const files = fs.readdirSync(backupDir);
        const sortedBackups = files
          .filter(f => f.startsWith('phanmienoffline.db.json.backup') && f.endsWith('.json'))
          .map(f => path.join(backupDir, f))
          .sort((a, b) => {
            try {
              return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
            } catch (_) {
              return 0;
            }
          });
        pathsToSearch.push(...sortedBackups);
      } catch (_) {}
    }
  }

  // Sibling/root paths
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  pathsToSearch.push(path.join(rootDir, 'phanmienoffline.db.json'));
  pathsToSearch.push(path.join(rootDir, 'backend', 'data', 'phanmienoffline.db.json'));

  // Drive mirror backups
  for (const root of DATA_PRESERVATION_BACKUP_ROOTS) {
    const mirrorDir = path.join(root, DATA_PRESERVATION_BACKUP_FOLDER, 'database');
    if (fs.existsSync(mirrorDir)) {
      try {
        const files = fs.readdirSync(mirrorDir);
        const sortedBackups = files
          .filter(f => f.startsWith('phanmienoffline-db-') && f.endsWith('.json'))
          .map(f => path.join(mirrorDir, f))
          .sort((a, b) => {
            try {
              return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
            } catch (_) {
              return 0;
            }
          });
        pathsToSearch.push(...sortedBackups);
      } catch (_) {}
    }
  }

  let oldDbFile = null;
  let oldDbData = null;

  for (const p of pathsToSearch) {
    if (!fs.existsSync(p)) continue;
    if (path.resolve(p) === path.resolve(DB_PATH)) continue;

    try {
      const content = fs.readFileSync(p, 'utf8');
      if (content.includes(targetEmail)) {
        const parsed = JSON.parse(content);
        if (parsed.users && parsed.users.some(u => String(u.email || '').trim().toLowerCase() === targetEmail)) {
          oldDbFile = p;
          oldDbData = parsed;
          break;
        }
      }
    } catch (_) {}
  }
  
  if (oldDbFile && oldDbData) {
    console.log(`[MIGRATION 1.6.8] Found old database containing ${targetEmail} at: ${oldDbFile}`);
    let importedAny = false;
    
    // Import users
    if (Array.isArray(oldDbData.users)) {
      for (const u of oldDbData.users) {
        const email = String(u.email || '').trim().toLowerCase();
        if (!email) continue;
        const exists = (current.users || []).some(currU => String(currU.email || '').trim().toLowerCase() === email);
        if (!exists) {
          const newId = current.nextId.users || 1;
          current.nextId.users = newId + 1;
          current.users.push({
            ...u,
            id: newId,
            created_at: u.created_at || now(),
            updated_at: u.updated_at || now()
          });
          importedAny = true;
        }
      }
    }
    
    // Import products
    if (Array.isArray(oldDbData.products)) {
      for (const p of oldDbData.products) {
        const sku = String(p.sku || '').trim().toLowerCase();
        const name = String(p.name || '').trim().toLowerCase();
        if (!sku && !name) continue;
        const exists = (current.products || []).some(currP => {
          const currSku = String(currP.sku || '').trim().toLowerCase();
          const currName = String(currP.name || '').trim().toLowerCase();
          return (sku && currSku === sku) || (name && currName === name);
        });
        if (!exists) {
          const newId = current.nextId.products || 1;
          current.nextId.products = newId + 1;
          current.products.push({
            ...p,
            id: newId,
            created_at: p.created_at || now(),
            updated_at: p.updated_at || now()
          });
          importedAny = true;
        }
      }
    }
    
    // Import customers
    if (Array.isArray(oldDbData.customers)) {
      for (const c of oldDbData.customers) {
        const phone = String(c.phone || '').trim().toLowerCase();
        const name = String(c.name || '').trim().toLowerCase();
        if (!phone && !name) continue;
        const exists = (current.customers || []).some(currC => {
          const currPhone = String(currC.phone || '').trim().toLowerCase();
          const currName = String(currC.name || '').trim().toLowerCase();
          return (phone && currPhone === phone) || (name && currName === name);
        });
        if (!exists) {
          const newId = current.nextId.customers || 1;
          current.nextId.customers = newId + 1;
          current.customers.push({
            ...c,
            id: newId,
            created_at: c.created_at || now(),
            updated_at: c.updated_at || now()
          });
          importedAny = true;
        }
      }
    }
    
    // Import invoices and invoice details
    if (Array.isArray(oldDbData.invoices)) {
      const invoiceIdMap = {};
      for (const inv of oldDbData.invoices) {
        const code = String(inv.invoice_code || '').trim().toLowerCase();
        if (!code) continue;
        const exists = (current.invoices || []).some(currInv => String(currInv.invoice_code || '').trim().toLowerCase() === code);
        if (!exists) {
          const newId = current.nextId.invoices || 1;
          current.nextId.invoices = newId + 1;
          invoiceIdMap[inv.id] = newId;
          current.invoices.push({
            ...inv,
            id: newId,
            created_at: inv.created_at || now(),
            updated_at: inv.updated_at || now()
          });
          importedAny = true;
        }
      }
      
      if (Array.isArray(oldDbData.invoice_details)) {
        for (const det of oldDbData.invoice_details) {
          const newInvId = invoiceIdMap[det.invoice_id];
          if (newInvId) {
            const newId = current.nextId.invoice_details || 1;
            current.nextId.invoice_details = newId + 1;
            current.invoice_details.push({
              ...det,
              id: newId,
              invoice_id: newInvId,
              created_at: det.created_at || now(),
              updated_at: det.updated_at || now()
            });
            importedAny = true;
          }
        }
      }
    }
    
    if (importedAny) {
      console.log(`[MIGRATION 1.6.8] Successfully imported products/customers/invoices/users from old database.`);
    }
  }
  
  const finalHasUser = (current.users || []).some(u => String(u.email || '').trim().toLowerCase() === 'dongphuongqc@gmail.com');
  if (!finalHasUser) {
    const newId = current.nextId.users || 1;
    current.nextId.users = newId + 1;
    
    const { hashPassword } = require('../utils/password');
    const defaultAccount = ensureDefaultAccount();
    current.users.push({
      id: newId,
      account_id: defaultAccount.id,
      name: 'Đông Phương QC',
      email: 'dongphuongqc@gmail.com',
      phone: '0904045075',
      password: hashPassword('khongnoiduoc'),
      role: 'admin',
      approved: 1,
      active: 1,
      created_at: now(),
      updated_at: now(),
      session_token: null,
    });
    console.log(`[MIGRATION 1.6.8] Seeded default user: dongphuongqc@gmail.com`);
  }
}

function migrateDB() {
  normalizeDBData();
  cleanupRemovedLegacyArtifacts();
  seedDefaultProductCategories();
  seedDefaultFeatureCatalog();
  ensureAuthAndSyncSchema();
  try {
    const authRepairService = require('../services/authRepairService');
    authRepairService.ensureAuthSchema();
  } catch (err) {
    console.error('[KHA DB] Failed to run auth schema repair:', err.message);
  }
  seedDefaultSystemSettings();
  migrateAccountingSchema();
  normalizeInvoiceCancellationSchema();
  normalizeInvoiceCodeUniqueness();
  ensureAllDocumentSequenceCounters();
  rebuildAllDailyStatsFromInvoices();
  // KHA FIX 2.3.3: bỏ qua migration "old customer database" (quét C:\D:\E:\F:\backup
  // parse từng file JSON để tìm dongphuongqc@gmail.com) khi chạy trong Electron
  // production (KHA_DB_PATH đã set). Quá trình này mất nhiều phút và là nguyên nhân
  // thứ hai gây treo startup backend production. Người dùng đã có dữ liệu trong DB
  // hiện tại; việc khôi phục dữ liệu cũ nên làm thủ công qua nút "Khôi phục dữ liệu".
  if (!process.env.KHA_DB_PATH && !process.env.DB_PATH && !process.env.DATABASE_PATH) {
    importOldCustomerDatabase();
  } else if (process.env.KHA_SKIP_OLD_DB_MIGRATION !== '0') {
    console.log('[MIGRATION 1.6.8] Bỏ qua quét old customer database khi khởi động (chế độ Electron production).');
  }
  recalculateNextIds();
}

function loadDB(options = {}) {
  const forceReload = options.forceReload === true;
  if (hasLoadedDb && !forceReload) return getDb();

  ensureDBFileExists();
  let parsed = {};
  let shouldPersist = options.forceSave === true;
  try {
    parsed = readBackupData(DB_PATH);
  } catch (error) {
    console.warn(`[KHA DB] Failed to read DB file ${path.basename(DB_PATH)}: ${error.message}`);
    backupDB('corrupt');
    parsed = createEmptyDB();
    shouldPersist = true;
  }

  const nextDB = createEmptyDB();
  for (const table of Object.keys(SCHEMA)) {
    nextDB[table] = Array.isArray(parsed[table]) ? parsed[table] : [];
  }
  nextDB.nextId = { ...INITIAL_NEXT_ID, ...(parsed.nextId || {}) };
  ensureBackupTables();

  try {
    replaceDB(nextDB);
    const beforeMigrateSnapshot = JSON.stringify(getDb());
    // KHA hardening (PHẦN 1.3 + PHẦN 2.6): backup an toàn TRƯỚC khi migrate khi có dữ liệu thực.
    // Backup fail => KHÔNG migrate (yêu cầu 1.6 - fix nguyên nhân gốc, không che lỗi).
    const hasRealData = Array.isArray(getDb().users) && getDb().users.length > 0
      || Array.isArray(getDb().products) && getDb().products.length > 0
      || Array.isArray(getDb().invoices) && getDb().invoices.length > 0;
    if (hasRealData && !preMigrationBackupDone) {
      try {
        const preMigBackup = createDbBackup('pre-migration', { skipRetention: false });
        if (!preMigBackup) throw new Error('Backup trước migrate thất bại - hủy migrate để bảo vệ dữ liệu');
        preMigrationBackupDone = true;
        console.log(`[KHA DB] Đã backup trước migrate: ${preMigBackup.file}`);
      } catch (backupErr) {
        hasLoadedDb = false;
        console.error('[KHA DB] Backup trước migrate thất bại, hủy migrate:', backupErr.message);
        throw backupErr;
      }
    }
    migrateDB();
    const afterMigrateSnapshot = JSON.stringify(getDb());
    if (shouldPersist || afterMigrateSnapshot !== beforeMigrateSnapshot) {
      saveDB();
    }
    hasLoadedDb = true;
    engineFullSync();
    console.log('[INFO] Migration thành công');
    console.log('[INFO] Đăng nhập bằng dữ liệu cũ thành công');
    return getDb();
  } catch (error) {
    hasLoadedDb = false;
    throw error;
  }
}

function saveDB() {
  atomicWriteJSON(DB_PATH, getDb());
}

function cloneDbState() {
  return JSON.parse(JSON.stringify(getDb()));
}

function shouldSaveImmediately(options = {}) {
  return options.skipSave !== true && atomicWriteDepth <= 0;
}

function withAtomicDbWrite(callback) {
  const isOuterAtomicWrite = atomicWriteDepth <= 0;
  const snapshot = isOuterAtomicWrite ? cloneDbState() : null;
  if (isOuterAtomicWrite) engineBegin();
  atomicWriteDepth += 1;
  try {
    const result = callback();
    atomicWriteDepth -= 1;
    if (isOuterAtomicWrite) { saveDB(); engineCommit(); }
    return result;
  } catch (error) {
    atomicWriteDepth = Math.max(0, atomicWriteDepth - 1);
    if (isOuterAtomicWrite) { engineRollback(); if (snapshot) replaceDB(snapshot); }
    throw error;
  }
}

function runWithRequestContext(context, callback) {
  return requestContext.run({ ...(context || {}) }, callback);
}

function getActiveContext() {
  return requestContext.getStore() || {};
}

function getActiveAccountId() {
  const context = getActiveContext();
  if (context.account_id != null) return context.account_id;
  if (context.accountId != null) return context.accountId;
  if (context.account?.id != null) return context.account.id;
  if (context.user?.account_id != null) return context.user.account_id;
  const account = getDefaultAccount();
  return account ? account.id : null;
}

function isAccountScoped(table) {
  return ACCOUNT_SCOPED_TABLES.has(table);
}

function shouldSkipAccountScope(options = {}) {
  return Boolean(options.skipAccountScope || options.skipScope || options.unscoped);
}

function isRowVisibleForCurrentScope(table, row, options = {}) {
  if (!isAccountScoped(table) || shouldSkipAccountScope(options)) return true;
  const accountId = getActiveAccountId();
  if (accountId == null) return true;
  return row?.account_id == null || Number(row.account_id) === Number(accountId);
}

function touchSyncMetadata(table, accountId = getActiveAccountId()) {
  if (!SYNC_TRACKED_TABLES.includes(table) || accountId == null) return null;
  const current = getDb();
  let meta = current.sync_metadata.find(row => row.table_name === table && Number(row.account_id) === Number(accountId));
  if (!meta) {
    const id = current.nextId.sync_metadata || 1;
    current.nextId.sync_metadata = id + 1;
    meta = { id, account_id: accountId, table_name: table, version: 0, updated_at: now() };
    current.sync_metadata.push(meta);
  }
  meta.version = normalizeNumber(meta.version, 0) + 1;
  meta.updated_at = now();
  return meta;
}

function normalizeInsertRow(table, row = {}, options = {}) {
  const timestamp = now();
  const normalized = { ...(row || {}) };
  const documentCodeConfig = getDocumentCodeConfigForTable(table);
  if (documentCodeConfig) {
    const normalizedCode = normalizeDocumentCodeText(normalized[documentCodeConfig.field]);
    normalized[documentCodeConfig.field] = normalizedCode || generateNextDocumentCode(documentCodeConfig, { skipSave: true });
  }
  if (isAccountScoped(table) && !shouldSkipAccountScope(options) && normalized.account_id == null) {
    normalized.account_id = getActiveAccountId();
  }
  if (normalized.created_at == null) normalized.created_at = timestamp;
  if (normalized.updated_at == null) normalized.updated_at = timestamp;
  if (table === 'users' && normalized.role != null) normalized.role = normalizeRoleValue(normalized.role);
  if ((table === 'invoices' || table === 'return_logs' || table === 'cash_book' || table === 'cash_fund') && normalized.payment_method != null) {
    normalized.payment_method = normalizePaymentMethod(normalized.payment_method);
  }
  if (table === 'invoices') {
    if (isCancelledInvoiceStatus(normalized.status)) {
      normalized.cancelled_at = resolveTimestampIso(normalized.cancelled_at || timestamp);
    } else if (normalized.cancelled_at === undefined) {
      normalized.cancelled_at = null;
    }
  }
  return normalized;
}

function normalizeUpdateChanges(table, current = {}, changes = {}) {
  const timestamp = now();
  const normalized = { ...(changes || {}) };
  delete normalized.id;
  const documentCodeConfig = getDocumentCodeConfigForTable(table);
  if (documentCodeConfig && Object.prototype.hasOwnProperty.call(normalized, documentCodeConfig.field)) {
    const currentCode = normalizeDocumentCodeText(current?.[documentCodeConfig.field]);
    const requestedCode = normalizeDocumentCodeText(normalized[documentCodeConfig.field]);
    if (
      currentCode
      && requestedCode
      && normalizeDocumentCodeLookup(currentCode) !== normalizeDocumentCodeLookup(requestedCode)
    ) {
      throw createDocumentCodeImmutableError(documentCodeConfig);
    }
    normalized[documentCodeConfig.field] = currentCode || requestedCode || generateNextDocumentCode(documentCodeConfig, { skipSave: true });
  }
  if (table === 'users' && normalized.role != null) normalized.role = normalizeRoleValue(normalized.role);
  if ((table === 'invoices' || table === 'return_logs' || table === 'cash_book' || table === 'cash_fund') && normalized.payment_method != null) {
    normalized.payment_method = normalizePaymentMethod(normalized.payment_method);
  }
  if (table === 'invoices') {
    const nextStatus = Object.prototype.hasOwnProperty.call(normalized, 'status') ? normalized.status : current?.status;
    if (isCancelledInvoiceStatus(nextStatus)) {
      normalized.cancelled_at = resolveTimestampIso(normalized.cancelled_at || current?.cancelled_at || timestamp);
    } else if (Object.prototype.hasOwnProperty.call(normalized, 'status') && normalized.cancelled_at === undefined) {
      normalized.cancelled_at = null;
    }
  }
  normalized.updated_at = normalized.updated_at || timestamp;
  return normalized;
}

function matchesFilter(row, filter) {
  if (filter == null) return true;
  if (typeof filter === 'function') return Boolean(filter(row));
  if (typeof filter === 'object') {
    return Object.entries(filter).every(([key, value]) => {
      if (key === 'skipAccountScope') return true;
      if (Array.isArray(value)) return value.includes(row?.[key]);
      return row?.[key] === value;
    });
  }
  return true;
}

function ensureTable(table) {
  const current = getDb();
  if (!Array.isArray(current[table])) {
    current[table] = [];
    if (current.nextId && current.nextId[table] == null) current.nextId[table] = 1;
  }
  return current[table];
}

function replaceTable(table, rows, options = {}) {
  const current = getDb();
  current[table] = Array.isArray(rows) ? rows.map(row => ({ ...(row || {}) })) : [];
  engineReplace(table, current[table]);
  recalculateNextIds();
  if (!options.skipTouch) touchSyncMetadata(table, options.accountId || getActiveAccountId());
  if (shouldSaveImmediately(options)) saveDB();
  return current[table];
}

function insert(table, row, options = {}) {
  const current = getDb();
  const rows = ensureTable(table);
  if (!current.nextId) current.nextId = { ...INITIAL_NEXT_ID };
  const id = row?.id != null ? Number(row.id) : (current.nextId[table] || 1);
  const normalized = normalizeInsertRow(table, { ...(row || {}), id }, options);
  const documentCodeConfig = getDocumentCodeConfigForTable(table);
  if (documentCodeConfig) {
    const duplicate = findDocumentByCode(documentCodeConfig, normalized[documentCodeConfig.field]);
    if (duplicate) {
      throw createDocumentCodeDuplicateError(documentCodeConfig, normalized[documentCodeConfig.field]);
    }
  }
  rows.push(normalized);
  engineUpsert(table, normalized);
  current.nextId[table] = Math.max(Number(current.nextId[table]) || 1, id + 1);
  ensureDocumentSequenceForRow(table, normalized);
  if (!options.skipTouch) touchSyncMetadata(table, normalized.account_id || options.accountId || getActiveAccountId());
  if (shouldSaveImmediately(options)) saveDB();
  return id;
}

function update(table, id, changes, options = {}) {
  const rows = ensureTable(table);
  const numericId = Number(id);
  const index = rows.findIndex(row => Number(row?.id) === numericId && isRowVisibleForCurrentScope(table, row, options));
  if (index === -1) return null;
  const current = rows[index];
  const requestedChanges = changes || {};
  const updated = { ...current, ...normalizeUpdateChanges(table, current, requestedChanges) };
  const documentCodeConfig = getDocumentCodeConfigForTable(table);
  if (shouldValidateDocumentCodeUpdate(documentCodeConfig, current, requestedChanges, updated)) {
    const duplicate = findDocumentByCode(documentCodeConfig, updated[documentCodeConfig.field], id);
    if (duplicate) {
      throw createDocumentCodeDuplicateError(documentCodeConfig, updated[documentCodeConfig.field]);
    }
  }
  rows[index] = updated;
  engineUpsert(table, updated);
  ensureDocumentSequenceForRow(table, updated);
  if (!options.skipTouch) touchSyncMetadata(table, updated.account_id || options.accountId || getActiveAccountId());
  if (shouldSaveImmediately(options)) saveDB();
  return updated;
}

function remove(table, id, options = {}) {
  const rows = ensureTable(table);
  const numericId = Number(id);
  const index = rows.findIndex(row => Number(row?.id) === numericId && isRowVisibleForCurrentScope(table, row, options));
  if (index === -1) return null;
  const [removed] = rows.splice(index, 1);
  engineDelete(table, removed && removed.id);
  if (!options.skipTouch) touchSyncMetadata(table, removed?.account_id || options.accountId || getActiveAccountId());
  if (shouldSaveImmediately(options)) saveDB();
  return removed;
}

function getAll(table, filter, options = {}) {
  const effectiveOptions = { ...options, ...(filter && typeof filter === 'object' && !Array.isArray(filter) ? { skipAccountScope: filter.skipAccountScope || options.skipAccountScope } : {}) };
  return ensureTable(table)
    .filter(row => isRowVisibleForCurrentScope(table, row, effectiveOptions))
    .filter(row => matchesFilter(row, filter));
}

function getExpiredCancelledInvoices(referenceTime = Date.now(), options = {}) {
  return getAll(
    'invoices',
    invoice => isExpiredCancelledInvoice(invoice, referenceTime),
    { skipAccountScope: true, ...options }
  );
}

function deleteExpiredCancelledInvoices(options = {}) {
  const referenceTime = options.referenceTime || options.now || Date.now();
  const expiredInvoices = getExpiredCancelledInvoices(referenceTime, { skipAccountScope: true });
  if (expiredInvoices.length === 0) {
    return { ok: true, deletedCount: 0, deletedDetailCount: 0, invoiceIds: [] };
  }

  return withAtomicDbWrite(() => {
    const invoiceIds = [];
    let deletedDetailCount = 0;

    for (const expiredInvoice of expiredInvoices) {
      const invoice = getOne('invoices', row => Number(row.id) === Number(expiredInvoice.id), { skipAccountScope: true });
      if (!isExpiredCancelledInvoice(invoice, referenceTime)) continue;

      const details = getAll('invoice_details', detail => Number(detail.invoice_id) === Number(invoice.id), { skipAccountScope: true });
      for (const detail of details) {
        if (remove('invoice_details', detail.id, {
          skipAccountScope: true,
          skipSave: true,
          accountId: detail.account_id || invoice.account_id || null,
        })) {
          deletedDetailCount += 1;
        }
      }

      const removedInvoice = remove('invoices', invoice.id, {
        skipAccountScope: true,
        skipSave: true,
        accountId: invoice.account_id || null,
      });
      if (removedInvoice) invoiceIds.push(removedInvoice.id);
    }

    return {
      ok: true,
      deletedCount: invoiceIds.length,
      deletedDetailCount,
      invoiceIds,
    };
  });
}

function getOne(table, filter, options = {}) {
  return getAll(table, filter, options)[0] || null;
}

function getAccountById(accountId) {
  return getOne('accounts', row => Number(row.id) === Number(accountId), { skipAccountScope: true });
}

function getRolePermissions(role) {
  const normalizedRole = normalizeRoleValue(role);
  return Array.from(new Set(
    getAll('role_permissions', row => row.role === normalizedRole, { skipAccountScope: true })
      .map(row => normalizePermissionKey(row.permission_key))
      .filter(Boolean)
  ));
}

function getUserPermissions(user) {
  if (!user) return [];
  if (user.role === 'admin' || user.role === 'owner') return getRolePermissions('admin');
  const explicit = parseList(user.permission_keys || user.permissions)
    .map(normalizePermissionKey)
    .filter(Boolean);
  return Array.from(new Set([...getRolePermissions(user.role || 'user'), ...explicit]));
}

function getSyncVersions(accountId = getActiveAccountId()) {
  const versions = {};
  for (const row of getAll('sync_metadata', item => accountId == null || Number(item.account_id) === Number(accountId), { skipAccountScope: true })) {
    const tableName = row.table_name;
    const rowCount = Object.prototype.hasOwnProperty.call(SCHEMA, tableName)
      ? getAll(tableName, null, { skipAccountScope: accountId == null }).filter(item => accountId == null || item?.account_id == null || Number(item.account_id) === Number(accountId)).length
      : 0;
    versions[tableName] = {
      version: normalizeNumber(row.version, 0),
      updated_at: row.updated_at || null,
      row_count: rowCount,
    };
  }
  return versions;
}

function auditLog(action, meta = {}, options = {}) {
  try {
    const context = getActiveContext();
    return insert('audit_logs', {
      action,
      meta,
      account_id: meta.account_id || context.account_id || context.account?.id || getActiveAccountId(),
      user_id: meta.user_id || context.user_id || context.user?.id || null,
      created_at: now(),
    }, { skipTouch: true, skipSave: options.skipSave === true });
  } catch (_error) {
    return null;
  }
}

function setDailyStats(statDate, totals = {}, options = {}) {
  const normalizedDate = normalizeDateKey(statDate || today());
  if (!normalizedDate) return null;

  const accountId = options.accountId === undefined ? getActiveAccountId() : options.accountId;
  const total_revenue = normalizeNumber(totals.total_revenue, 0);
  const total_orders = Math.max(0, Math.round(normalizeNumber(totals.total_orders, 0)));
  const skipSave = options.skipSave === true;
  const keepEmpty = options.keepEmpty !== false;
  const readOptions = { skipAccountScope: accountId == null };
  const existing = getOne('daily_stats', row => row.stat_date === normalizedDate && (accountId == null || Number(row.account_id) === Number(accountId)), readOptions);

  if (!keepEmpty && total_revenue === 0 && total_orders === 0) {
    if (!existing) return null;
    return remove('daily_stats', existing.id, { ...readOptions, skipSave });
  }

  const payload = {
    stat_date: normalizedDate,
    total_revenue,
    total_orders,
    account_id: accountId,
    updated_at: now(),
  };

  if (existing) {
    return update('daily_stats', existing.id, payload, { ...readOptions, skipSave });
  }

  const id = insert('daily_stats', {
    ...payload,
    created_at: now(),
  }, { skipSave, accountId });
  return getOne('daily_stats', { id }, readOptions);
}

function rebuildDailyStatsForDate(date = today(), options = {}) {
  const statDate = normalizeDateKey(date || today());
  if (!statDate) return null;
  const accountId = options.accountId === undefined ? getActiveAccountId() : options.accountId;
  const readOptions = { skipAccountScope: accountId == null };
  const invoices = getAll('invoices', invoice => {
    if (!invoice || !isCompletedInvoiceStatus(invoice.status)) return false;
    if (accountId != null && Number(invoice.account_id) !== Number(accountId)) return false;
    return normalizeDateKey(invoice.created_at || invoice.updated_at) === statDate;
  }, readOptions);

  return setDailyStats(statDate, {
    total_revenue: invoices.reduce((sum, invoice) => sum + normalizeNumber(invoice.total, 0), 0),
    total_orders: invoices.length,
  }, options);
}

function rebuildDailyStatsForDates(dates = [], options = {}) {
  const requestedDates = Array.isArray(dates) ? dates : [dates];
  return Array.from(new Set(requestedDates.map(item => normalizeDateKey(item)).filter(Boolean)))
    .map(statDate => rebuildDailyStatsForDate(statDate, options));
}

function upsertDailyStats(date, _revenue = 0, options = {}) {
  return rebuildDailyStatsForDate(date, options);
}

function getNextSeq(name, options = {}) {
  const key = normalizeTextKey(name || 'default');
  const skipSave = options.skipSave === true;
  let counter = getAll('counters', row => row.name === key || row.key === key, { skipAccountScope: true })
    .slice()
    .sort((a, b) => Math.max(normalizeNumber(b?.value, 0), normalizeNumber(b?.seq, 0))
      - Math.max(normalizeNumber(a?.value, 0), normalizeNumber(a?.seq, 0)))[0] || null;
  if (!counter) {
    const id = insert('counters', { name: key, key, value: 1, seq: 1, account_id: null }, { skipSave, skipAccountScope: true });
    return getOne('counters', { id }, { skipAccountScope: true })?.value || 1;
  }
  const nextValue = normalizeNumber(counter.value ?? counter.seq, 0) + 1;
  update('counters', counter.id, { value: nextValue, seq: nextValue }, { skipSave, skipAccountScope: true });
  return nextValue;
}

function ensureBaseData() {
  migrateDB();
  saveDB();
}

function seedData() {
  ensureBaseData();
}



const exportsObject = {
  now,
  today,
  db,
  runWithRequestContext,
  getDefaultAccount,
  SCHEMA,
  INITIAL_NEXT_ID,
  DEFAULT_ACCOUNT_SLUG,
  ACCOUNT_SCOPED_TABLES,
  DEFAULT_PERMISSIONS,
  DEFAULT_USER_PERMISSION_KEYS,
  DEFAULT_EMPLOYEE_PERMISSION_KEYS,
  DEFAULT_ACCOUNTANT_PERMISSION_KEYS,
  DEFAULT_CASHIER_PERMISSION_KEYS,
  SYNC_TRACKED_TABLES,
  DEFAULT_PRODUCT_CATEGORIES,
  DEFAULT_SYSTEM_SETTINGS,
  loadDB,
  saveDB,
  backupDB,
  createDbBackup,
  listDbBackups,
  pruneDbBackups,
  runScheduledDbBackup,
  getDb,
  insert,
  update,
  remove,
  getAll,
  getOne,
  replaceTable,
  getAccountById,
  getRolePermissions,
  getUserPermissions,
  getSyncVersions,
  auditLog,
  setDailyStats,
  rebuildDailyStatsForDate,
  rebuildDailyStatsForDates,
  upsertDailyStats,
  getNextSeq,
  DOCUMENT_CODE_CONFIG,
  generateNextDocumentCode,
  getMaxDocumentSequence,
  findDocumentByCode,
  normalizeDocumentCodeText,
  normalizeDocumentCodeLookup,
  readDocumentSequenceNumber,
  formatDocumentSequenceCode,
  ensureBaseData,
  seedData,
  normalizePaymentMethod,
  getActiveAccountId,
  touchSyncMetadata,
  normalizeNumber,
  parseList,
  findCategoryByText,
  ensureField,
  normalizePermissionKey,
  normalizeRoleValue,
  normalizeDateKey,
  isCancelledInvoiceStatus,
  isCompletedInvoiceStatus,
  parseTimestampMs,
  resolveTimestampIso,
  isExpiredCancelledInvoice,
  isInvoiceVisibleInActiveList,
  getExpiredCancelledInvoices,
  deleteExpiredCancelledInvoices,
  INVOICE_CANCEL_RETENTION_MS,
  INVOICE_STATUS_CANCELLED_AT_INDEX_FIELDS,
  cleanupDatabaseTempFiles,
  withAtomicDbWrite,
  setDBPath,
  performDeepScan,
  readDatabaseConfig,
  writeDatabaseConfig,
  seedDefaultPermissions,
  seedDefaultRolePermissions,
};

Object.defineProperty(exportsObject, 'DB_PATH', {
  get() { return DB_PATH; },
  set(val) { DB_PATH = val; },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(exportsObject, 'DB_BACKUP_DIR', {
  get() {
    return path.resolve(process.env.KHA_DB_BACKUP_DIR || path.join(path.dirname(DB_PATH), DATA_PRESERVATION_BACKUP_FOLDER));
  },
  enumerable: true,
  configurable: true,
});

module.exports = exportsObject;

loadDB();
