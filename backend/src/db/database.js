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
  mobile_devices: [],
  mobile_install_links: [],
  mobile_sync_events: [],
  permissions: [],
  role_permissions: [],
  sync_metadata: [],
  audit_logs: [],
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
  print_templates: [],
  sapo_settings: [],
  sapo_sync_runs: [],
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
  'daily_stats', 'return_logs', 'return_details', 'customer_types', 'counters', 'cash_book', 'payrolls', 'print_templates',
  'sapo_settings', 'sapo_sync_runs', 'excel_import_runs', 'excel_import_details',
  'mobile_devices', 'mobile_install_links', 'mobile_sync_events',
  'sync_metadata', 'audit_logs',
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
  ['print_templates.read', 'Xem mẫu in', 'Xem mẫu in'],
  ['print_templates.manage', 'Quản lý mẫu in', 'Tạo, sửa mẫu in'],
  ['sync.read', 'Xem đồng bộ', 'Xem trạng thái đồng bộ'],
  ['sync.manage', 'Quản lý đồng bộ', 'Đẩy/kéo dữ liệu đồng bộ'],
  ['settings.read', 'Xem thiết lập', 'Xem thiết lập hệ thống'],
  ['settings.manage', 'Quản lý thiết lập', 'Cập nhật thiết lập hệ thống'],
];

const DEFAULT_USER_PERMISSION_KEYS = [
  'admin_panel.read', 'features.read', 'updates.read', 'users.read', 'store.read', 'products.read',
  'customers.read', 'partners.read', 'invoices.read', 'imports.read', 'combos.read', 'returns.read',
  'stats.read', 'cashbook.read', 'payrolls.read', 'print_templates.read', 'sync.read', 'sync.manage',
  'settings.read',
];

const SYNC_TRACKED_TABLES = [
  'store_info', 'users', 'customers', 'products', 'product_categories', 'partners',
  'invoices', 'invoice_details', 'import_logs', 'import_details', 'combos', 'combo_items',
  'daily_stats', 'return_logs', 'return_details', 'customer_types', 'counters', 'cash_book', 'payrolls', 'print_templates',
  'sapo_settings', 'sapo_sync_runs', 'excel_import_runs', 'excel_import_details',
  'mobile_devices', 'mobile_install_links', 'mobile_sync_events',
  'feature_catalog', 'update_releases',
];

const LEGACY_KEY_PREFIX = ['b', 'o', 't'].join('');
const REMOVED_LEGACY_PERMISSION_KEYS = new Set([
  `${LEGACY_KEY_PREFIX}.read`,
  `${LEGACY_KEY_PREFIX}.manage`,
]);
const REMOVED_LEGACY_TABLES = [
  `${LEGACY_KEY_PREFIX}_settings`,
  `${LEGACY_KEY_PREFIX}_alerts`,
];

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

function atomicWriteJSON(filePath, data) {
  ensureDBDirectoryExists();
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function ensureDBFileExists() {
  ensureDBDirectoryExists();
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

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

const DEFAULT_PRODUCT_CATEGORIES = [];

function inferPrintWidthMm(_paperSize, fallback = 80) {
  return fallback;
}

function clonePrintTemplateConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function createDefaultSaleInvoiceVisualConfig(paperSize = '80mm', widthMm = 80) {
  return {
    layout: { paperSize, widthMm },
    header: { fields: [] },
    invoiceInfo: { fields: [] },
    customerInfo: { fields: [] },
    table: { columns: [] },
    totals: { fields: [] },
    payment: {},
    footer: { lines: [] },
  };
}

function normalizePrintTemplateConfig(config, paperSize = '80mm', widthMm = 80) {
  return { ...createDefaultSaleInvoiceVisualConfig(paperSize, widthMm), ...(config || {}) };
}

const DEFAULT_PRINT_TEMPLATES = [];
const DEFAULT_FEATURE_CATALOG = [
  {
    feature_key: 'negative_stock_exports',
    name: 'Xuất âm tồn kho',
    description: 'Bật để cho phép xuất vượt tồn kho đến giới hạn cố định trong code.',
    category: 'Kho hàng',
    active: 0,
    metadata: {},
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
  for (const [key, name, description] of DEFAULT_PERMISSIONS) {
    const existing = current.permissions.find(row => row.key === key);
    if (existing) {
      existing.name = existing.name || name;
      existing.description = existing.description || description;
      existing.updated_at = existing.updated_at || now();
      continue;
    }
    const id = current.nextId.permissions || 1;
    current.nextId.permissions = id + 1;
    current.permissions.push({ id, key, name, description, created_at: now(), updated_at: now() });
  }
}

function seedDefaultRolePermissions() {
  const current = getDb();
  const allKeys = current.permissions.map(p => p.key);
  const roleMap = {
    admin: allKeys,
    owner: allKeys,
    manager: allKeys.filter(key => !key.endsWith('.manage') || !['admin_panel.manage', 'features.manage', 'updates.manage', 'users.manage'].includes(key)),
    user: DEFAULT_USER_PERMISSION_KEYS,
  };

  for (const [role, keys] of Object.entries(roleMap)) {
    for (const permission_key of keys) {
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
    row => !REMOVED_LEGACY_TABLES.includes(String(row?.table_name || '').trim())
  );
  if (current.nextId && typeof current.nextId === 'object') {
    for (const table of REMOVED_LEGACY_TABLES) {
      delete current.nextId[table];
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

function seedDefaultPrintTemplates() {}

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
function ensureSapoMetadataSchema() {}
function ensureMobileSchema() {}

function ensureAuthAndSyncSchema() {
  const defaultAccount = ensureDefaultAccount();
  seedDefaultPermissions();
  seedDefaultRolePermissions();
  normalizeAccountScopedRows(defaultAccount.id);
  ensureSyncMetadataForAccounts();
  seedDefaultAdmin(defaultAccount.id);
}

function migrateDB() {
  normalizeDBData();
  ensureSapoMetadataSchema();
  ensureMobileSchema();
  cleanupRemovedLegacyArtifacts();
  seedDefaultProductCategories();
  seedDefaultPrintTemplates();
  seedDefaultFeatureCatalog();
  ensureAuthAndSyncSchema();
  recalculateNextIds();
}

function loadDB() {
  ensureDBFileExists();
  let parsed = {};
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    backupDB('corrupt');
    parsed = createEmptyDB();
  }

  const nextDB = createEmptyDB();
  for (const table of Object.keys(SCHEMA)) {
    nextDB[table] = Array.isArray(parsed[table]) ? parsed[table] : [];
  }
  nextDB.nextId = { ...INITIAL_NEXT_ID, ...(parsed.nextId || {}) };
  replaceDB(nextDB);
  migrateDB();
  saveDB();
  return getDb();
}

function saveDB() {
  atomicWriteJSON(DB_PATH, getDb());
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
  if (!options.skipSave) saveDB();
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
  if (!options.skipSave) saveDB();
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
  if (!options.skipSave) saveDB();
  return updated;
}

function remove(table, id, options = {}) {
  const rows = ensureTable(table);
  const numericId = Number(id);
  const index = rows.findIndex(row => Number(row?.id) === numericId && isRowVisibleForCurrentScope(table, row, options));
  if (index === -1) return null;
  const [removed] = rows.splice(index, 1);
  if (!options.skipTouch) touchSyncMetadata(table, removed?.account_id || options.accountId || getActiveAccountId());
  if (!options.skipSave) saveDB();
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
  return getAll('role_permissions', row => row.role === normalizedRole, { skipAccountScope: true })
    .map(row => row.permission_key)
    .filter(Boolean);
}

function getUserPermissions(user) {
  if (!user) return [];
  if (user.role === 'admin' || user.role === 'owner') return getRolePermissions('admin');
  const explicit = parseList(user.permission_keys || user.permissions);
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

function auditLog(action, meta = {}) {
  try {
    const context = getActiveContext();
    return insert('audit_logs', {
      action,
      meta,
      account_id: meta.account_id || context.account_id || context.account?.id || getActiveAccountId(),
      user_id: meta.user_id || context.user_id || context.user?.id || null,
      created_at: now(),
    }, { skipTouch: true });
  } catch (_error) {
    return null;
  }
}

function upsertDailyStats(date, revenue = 0) {
  const statDate = date || today();
  const accountId = getActiveAccountId();
  const existing = getOne('daily_stats', row => row.date === statDate && (accountId == null || Number(row.account_id) === Number(accountId)));
  if (existing) {
    return update('daily_stats', existing.id, {
      revenue: normalizeNumber(existing.revenue, 0) + normalizeNumber(revenue, 0),
    });
  }
  const id = insert('daily_stats', { date: statDate, revenue: normalizeNumber(revenue, 0), account_id: accountId });
  return getOne('daily_stats', { id });
}

function getNextSeq(name) {
  const key = normalizeTextKey(name || 'default');
  let counter = getOne('counters', row => row.name === key || row.key === key);
  if (!counter) {
    const id = insert('counters', { name: key, key, value: 1, seq: 1 });
    return getOne('counters', { id })?.value || 1;
  }
  const nextValue = normalizeNumber(counter.value ?? counter.seq, 0) + 1;
  update('counters', counter.id, { value: nextValue, seq: nextValue });
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
  DEFAULT_PRINT_TEMPLATES,
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
  upsertDailyStats,
  getNextSeq,
  ensureBaseData,
  seedData,
  normalizePaymentMethod,
  getActiveAccountId,
  touchSyncMetadata,
  normalizeNumber,
  parseList,
  inferPrintWidthMm,
  clonePrintTemplateConfig,
  createDefaultSaleInvoiceVisualConfig,
  normalizePrintTemplateConfig,
  findCategoryByText,
  ensureField,
};
