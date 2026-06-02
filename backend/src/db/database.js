/**
 * Lightweight JSON database layer for the offline-first backend.
 *
 * The helpers in this module intentionally keep a small synchronous API because
 * the rest of the Express app is written around in-process JSON persistence.
 */
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

function resolveDBPath() {
  const custom = process.env.KHA_DB_PATH || process.env.DB_PATH || process.env.DATABASE_PATH;
  if (custom) return path.resolve(custom);
  return path.resolve(__dirname, '..', '..', 'data', 'phanmienoffline.db.json');
}

const DB_PATH = resolveDBPath();
const DEFAULT_ACCOUNT_SLUG = 'default';
const requestContext = new AsyncLocalStorage();

const SCHEMA = {
  accounts: [],
  sessions: [],
  permissions: [],
  role_permissions: [],
  sync_metadata: [],
  audit_logs: [],
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
  payrolls: [],
  excel_import_runs: [],
  excel_import_details: [],
  update_releases: [],
};

const INITIAL_NEXT_ID = Object.keys(SCHEMA).reduce((acc, table) => {
  acc[table] = 1;
  return acc;
}, {});

const ACCOUNT_SCOPED_TABLES = new Set([
  'store_info', 'users', 'customers', 'products', 'product_categories', 'partners',
  'invoices', 'invoice_details', 'import_logs', 'import_details', 'combos', 'combo_items',
  'daily_stats', 'return_logs', 'return_details', 'customer_types', 'counters', 'cash_book', 'payrolls',
  'excel_import_runs', 'excel_import_details',
  'sync_metadata', 'audit_logs', 'system_settings',
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
  'customers.read', 'partners.read', 'invoices.read', 'imports.read', 'combos.read', 'returns.read',
  'stats.read', 'cashbook.read', 'payrolls.read', 'sync.read', 'sync.manage',
  'settings.read',
];

const SYNC_TRACKED_TABLES = [
  'store_info', 'users', 'customers', 'products', 'product_categories', 'partners',
  'invoices', 'invoice_details', 'import_logs', 'import_details', 'combos', 'combo_items',
  'daily_stats', 'return_logs', 'return_details', 'customer_types', 'counters', 'cash_book', 'payrolls',
  'excel_import_runs', 'excel_import_details', 'system_settings',
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
const DB_TMP_CLEANUP_MAX_AGE_MS = 5 * 60 * 1000;
const DB_WRITE_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DB_WRITE_RETRY_ATTEMPTS = Math.max(1, Number(process.env.KHA_DB_WRITE_RETRY_ATTEMPTS) || 8);
const DB_WRITE_RETRY_BASE_DELAY_MS = Math.max(1, Number(process.env.KHA_DB_WRITE_RETRY_BASE_DELAY_MS) || 25);
const DB_WRITE_RETRY_MAX_DELAY_MS = Math.max(DB_WRITE_RETRY_BASE_DELAY_MS, Number(process.env.KHA_DB_WRITE_RETRY_MAX_DELAY_MS) || 250);
let hasLoadedDb = false;
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

function backupDB(reason = 'migration') {
  if (!fs.existsSync(DB_PATH)) return null;
  const backupPath = `${DB_PATH}.${reason}.${Date.now()}.bak`;
  fs.copyFileSync(DB_PATH, backupPath);
  return backupPath;
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
  return String(role || '').trim().toLowerCase() || 'user';
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

function migrateDB() {
  normalizeDBData();
  cleanupRemovedLegacyArtifacts();
  seedDefaultProductCategories();
  seedDefaultFeatureCatalog();
  ensureAuthAndSyncSchema();
  seedDefaultSystemSettings();
  rebuildAllDailyStatsFromInvoices();
  recalculateNextIds();
}

function loadDB(options = {}) {
  const forceReload = options.forceReload === true;
  if (hasLoadedDb && !forceReload) return getDb();

  ensureDBFileExists();
  let parsed = {};
  let shouldPersist = options.forceSave === true;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    parsed = raw.trim() ? JSON.parse(raw) : {};
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

  try {
    replaceDB(nextDB);
    const beforeMigrateSnapshot = JSON.stringify(getDb());
    migrateDB();
    const afterMigrateSnapshot = JSON.stringify(getDb());
    if (shouldPersist || afterMigrateSnapshot !== beforeMigrateSnapshot) {
      saveDB();
    }
    hasLoadedDb = true;
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
  atomicWriteDepth += 1;
  try {
    const result = callback();
    atomicWriteDepth -= 1;
    if (isOuterAtomicWrite) saveDB();
    return result;
  } catch (error) {
    atomicWriteDepth = Math.max(0, atomicWriteDepth - 1);
    if (isOuterAtomicWrite && snapshot) replaceDB(snapshot);
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
  if (isAccountScoped(table) && !shouldSkipAccountScope(options) && normalized.account_id == null) {
    normalized.account_id = getActiveAccountId();
  }
  if (normalized.created_at == null) normalized.created_at = timestamp;
  if (normalized.updated_at == null) normalized.updated_at = timestamp;
  if (table === 'users' && normalized.role != null) normalized.role = normalizeRoleValue(normalized.role);
  if ((table === 'invoices' || table === 'return_logs' || table === 'cash_book') && normalized.payment_method != null) {
    normalized.payment_method = normalizePaymentMethod(normalized.payment_method);
  }
  return normalized;
}

function normalizeUpdateChanges(table, _current, changes = {}) {
  const normalized = { ...(changes || {}) };
  delete normalized.id;
  if (table === 'users' && normalized.role != null) normalized.role = normalizeRoleValue(normalized.role);
  if ((table === 'invoices' || table === 'return_logs' || table === 'cash_book') && normalized.payment_method != null) {
    normalized.payment_method = normalizePaymentMethod(normalized.payment_method);
  }
  normalized.updated_at = normalized.updated_at || now();
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
  rows.push(normalized);
  current.nextId[table] = Math.max(Number(current.nextId[table]) || 1, id + 1);
  if (!options.skipTouch) touchSyncMetadata(table, normalized.account_id || options.accountId || getActiveAccountId());
  if (shouldSaveImmediately(options)) saveDB();
  return id;
}

function update(table, id, changes, options = {}) {
  const rows = ensureTable(table);
  const numericId = Number(id);
  const index = rows.findIndex(row => Number(row?.id) === numericId && isRowVisibleForCurrentScope(table, row, options));
  if (index === -1) return null;
  const updated = { ...rows[index], ...normalizeUpdateChanges(table, rows[index], changes || {}) };
  rows[index] = updated;
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
  let counter = getOne('counters', row => row.name === key || row.key === key);
  if (!counter) {
    const id = insert('counters', { name: key, key, value: 1, seq: 1 }, { skipSave });
    return getOne('counters', { id })?.value || 1;
  }
  const nextValue = normalizeNumber(counter.value ?? counter.seq, 0) + 1;
  update('counters', counter.id, { value: nextValue, seq: nextValue }, { skipSave });
  return nextValue;
}

function ensureBaseData() {
  migrateDB();
  saveDB();
}

function seedData() {
  ensureBaseData();
}

loadDB();

module.exports = {
  now,
  today,
  db,
  runWithRequestContext,
  getDefaultAccount,
  DB_PATH,
  SCHEMA,
  INITIAL_NEXT_ID,
  DEFAULT_ACCOUNT_SLUG,
  ACCOUNT_SCOPED_TABLES,
  DEFAULT_PERMISSIONS,
  DEFAULT_USER_PERMISSION_KEYS,
  SYNC_TRACKED_TABLES,
  DEFAULT_PRODUCT_CATEGORIES,
  DEFAULT_SYSTEM_SETTINGS,
  loadDB,
  saveDB,
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
  normalizeDateKey,
  isCancelledInvoiceStatus,
  isCompletedInvoiceStatus,
  cleanupDatabaseTempFiles,
  withAtomicDbWrite,
};
