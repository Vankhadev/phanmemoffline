/**
 *  Bán hàng offline - by Van kha mmo
 *  Backend: Node.js + Express + JSON file database
 */
const { AsyncLocalStorage } = require('async_hooks');
const requestContext = new AsyncLocalStorage();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const cron    = require('node-cron');
const path    = require('path');
const { version: APP_VERSION } = require('../../package.json');
const { loadEnv, getLoadedEnvFiles } = require('./utils/loadEnv');

loadEnv({ logErrors: true });

// --- Load DB & helpers ---
const dbModule = require('./db/database');
const {
  upsertDailyStats,
  today,
  now,
  isCancelledInvoiceStatus,
  isCompletedInvoiceStatus,
  deleteExpiredCancelledInvoices,
  runScheduledDbBackup,
} = dbModule;
const { requireAuth, requireAnyPermission, requirePermission } = require('./middleware/auth');
const { ensurePrintTemplatesSchema } = require('./db/printTemplatesSchema');
const { testPrintTemplatesMySqlConnection, getPrintTemplatesMySqlStatus } = require('./db/printTemplatesMySql');
const { ensureSettingsSchema, getSettingsMySqlStatus } = require('./db/settingsMySql');
const { getNegativeStockSettingsAsync } = require('./services/settingsService');
const { PRINT_TEMPLATE_UPLOAD_DIR, PUBLIC_PRINT_TEMPLATE_UPLOAD_PATH, ensureUploadDir } = require('./middleware/printTemplateUpload');

// --- KHA Data Guardian Services ---
const adminAlertService = require('./services/adminAlertService');
const realtimeSyncService = require('./services/realtimeSyncService');
const historyService = require('./services/historyService');
const transactionJournal = require('./services/transactionJournal');
const realtimeBackup = require('./services/realtimeBackup');
const backupScheduler = require('./services/backupScheduler');
const diskHealthMonitor = require('./services/diskHealthMonitor');
const powerLossRecovery = require('./services/powerLossRecovery');
const databaseAutoRecovery = require('./services/databaseAutoRecovery');
const maintenanceService = require('./services/maintenanceService');
const selfHealing = require('./services/selfHealing');
const integrityChecker = require('./services/integrityChecker');
const safetyRules = require('./services/safetyRules');
const authRepairService = require('./services/authRepairService');

// --- Routes ---
const storeRoutes     = require('./routes/store');
const usersRoutes     = require('./routes/users');
const syncRoutes      = require('./routes/sync');
const customersRoutes = require('./routes/customers');
const productsRoutes  = require('./routes/products');
const partnersRoutes  = require('./routes/partners');
const invoicesRoutes  = require('./routes/invoices');
const importsRoutes   = require('./routes/imports');
const combosRoutes   = require('./routes/combos');
const returnsRoutes  = require('./routes/returns');
const statsRoutes    = require('./routes/stats');
const cashBookRoutes = require('./routes/cashbook');
const payrollsRoutes = require('./routes/payrolls');
const customerTypesRoutes = require('./routes/customerTypes');
const productCategoriesRoutes = require('./routes/productCategories');
const featuresRoutes = require('./routes/features');
const updatesRoutes = require('./routes/updates');
const excelImportsRoutes = require('./routes/excelImports');
const inventoryRoutes = require('./routes/inventory');
const accountingRoutes = require('./routes/accounting');
const settingsRoutes = require('./routes/settings');
const printTemplatesRoutes = require('./routes/printTemplates');
const marketplacesRoutes = require('./routes/marketplaces');
const databaseRoutes = require('./routes/database');
const dataGuardianRoutes = require('./routes/dataGuardian');
const historyRoutes = require('./routes/history');

// ============================================================
//  EXPRESS APP
// ============================================================
const app  = express();
const PORT = Number(process.env.PORT || process.env.KHA_BACKEND_PORT || process.env.PHANMEM_PORT || 3001);
const HOST = String(
  process.env.KHA_BACKEND_HOST ||
  process.env.PHANMEM_HOST ||
  process.env.HOST ||
  '127.0.0.1'
).trim() || '127.0.0.1';
const SERVER_STARTED_AT = new Date().toISOString();
const BACKEND_INSTANCE_ID = String(process.env.KHA_BACKEND_INSTANCE_ID || '').slice(0, 100);

function maskDbPath(filePath) {
  const normalized = String(filePath || '');
  const fileName = path.basename(normalized);
  const parentName = path.basename(path.dirname(normalized));
  return parentName ? path.join('...', parentName, fileName) : fileName;
}

function buildHealthPayload() {
  return {
    ok: true,
    service: 'phanmienoffline-backend',
    version: APP_VERSION,
    pid: process.pid,
    parentPid: Number(process.env.KHA_BACKEND_PARENT_PID) || null,
    instanceId: BACKEND_INSTANCE_ID || null,
    uptimeSec: Math.round(process.uptime()),
    startedAt: SERVER_STARTED_AT,
    host: HOST,
    port: PORT,
    dbPath: maskDbPath(require('./db/database').DB_PATH),
    dbFile: path.basename(require('./db/database').DB_PATH || ''),
    envFiles: getLoadedEnvFiles().map(maskDbPath),
    printTemplatesMySql: getPrintTemplatesMySqlStatus(),
    settingsMySql: getSettingsMySqlStatus(),
    node: process.version,
  };
}

function parseAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLanCorsHost(value) {
  const host = String(value || '').trim();
  if (!host) return '';
  if (['0.0.0.0', '::', '[::]'].includes(host)) return '';
  return host;
}

const DEFAULT_ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https?:\/\/\[::1\](?::\d+)?$/i,
];
const PRIVATE_NETWORK_ALLOWED_ORIGINS = [
  /^https?:\/\/10(?:\.\d{1,3}){3}(?::\d+)?$/i,
  /^https?:\/\/192\.168(?:\.\d{1,3}){2}(?::\d+)?$/i,
  /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}(?::\d+)?$/i,
];
const configuredAllowedOrigins = parseAllowedOrigins(
  process.env.KHA_CORS_ORIGINS ||
  process.env.CORS_ORIGINS ||
  process.env.ALLOWED_ORIGINS
);
const derivedAllowedOrigins = Array.from(new Set([
  HOST,
  process.env.KHA_PUBLIC_HOST,
  process.env.PHANMEM_PUBLIC_HOST,
].map(normalizeLanCorsHost).filter(Boolean))).map(host => new RegExp(`^https?:\\/\\/${escapeRegex(host)}(?::\\d+)?$`, 'i'));

function isAllowedCorsOrigin(origin) {
  if (!origin || origin === 'null') return true;
  if (configuredAllowedOrigins.includes('*')) return true;
  if (configuredAllowedOrigins.includes(origin)) return true;
  return [...DEFAULT_ALLOWED_ORIGINS, ...PRIVATE_NETWORK_ALLOWED_ORIGINS, ...derivedAllowedOrigins]
    .some(pattern => pattern.test(origin));
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin(origin, callback) {
    return callback(null, isAllowedCorsOrigin(origin));
  },
  credentials: true,
}));
app.use('/api/products/import-excel-rows', express.json({ limit: '25mb' }));
app.use('/api/excel-imports', express.json({ limit: '25mb' }));
app.use('/api/print-templates', express.json({ limit: '10mb' }));
app.use(express.json());
// Global request context middleware for database hooks
app.use((req, res, next) => {
  requestContext.run(req, () => {
    next();
  });
});
try {
  ensureUploadDir();
} catch (error) {
  console.warn(`[KHA PRINT TEMPLATE LOGO] Không thể tạo thư mục upload logo: ${error.message}`);
}
app.use(PUBLIC_PRINT_TEMPLATE_UPLOAD_PATH, express.static(PRINT_TEMPLATE_UPLOAD_DIR, {
  fallthrough: true,
  etag: true,
  maxAge: '1d',
}));

app.use((err, req, res, next) => {
  if (!err) return next();
  const isJsonBodyError = err.type === 'entity.too.large' || err.type === 'entity.parse.failed' || err instanceof SyntaxError;
  if (!isJsonBodyError) return next(err);

  const isImportRequest = req.path === '/api/products/import-excel-rows' || req.path.startsWith('/api/excel-imports');
  const isPrintTemplateRequest = req.path.startsWith('/api/print-templates');
  const status = err.type === 'entity.too.large' ? 413 : 400;
  if (isImportRequest) console.warn('[KHA IMPORT EXCEL] JSON body error:', err.message);
  if (isPrintTemplateRequest) console.warn('[KHA PRINT TEMPLATES] JSON body error:', err.message);
  const message = isPrintTemplateRequest
    ? (err.type === 'entity.too.large' ? 'Dữ liệu mẫu in hóa đơn vượt quá giới hạn 10MB.' : 'Body JSON mẫu in hóa đơn không hợp lệ')
    : (err.type === 'entity.too.large'
      ? 'File Excel quá lớn hoặc có quá nhiều dòng để import một lần'
      : 'Body JSON import không hợp lệ');
  const detail = isPrintTemplateRequest
    ? (err.type === 'entity.too.large'
      ? 'layout_json/settings_json gửi lên quá lớn. Hãy giảm số component hoặc nội dung CSS.'
      : 'Backend không đọc được JSON của module mẫu in hóa đơn. Vui lòng kiểm tra payload gửi lên.')
    : (err.type === 'entity.too.large'
      ? 'Dữ liệu gửi lên vượt giới hạn 25MB. Hãy giảm số dòng/cột không cần thiết hoặc chia file import thành nhiều lần.'
      : 'Backend không đọc được JSON do frontend gửi lên. Vui lòng thử lại với file Excel hợp lệ.');
  res.status(status).json({
    ok: false,
    success: false,
    status,
    error: message,
    message,
    detail,
    errors: [],
    expectedColumns: isImportRequest ? [
      'Loại dòng',
      'SKU',
      'Parent SKU',
      'Tên sản phẩm',
      'Tên cha',
      'Giá nhập',
      'Giá lẻ',
      'Giá sỉ',
      'Giá VIP',
      'Tồn kho',
      'Đơn vị',
      'Danh mục text',
      'Default category id',
      'Supplier id',
      'Hoạt động',
      'Tên khách hàng',
      'Số điện thoại',
      'Email',
      'Mã khách hàng',
      'Địa chỉ',
      'Ghi chú',
      'Nhóm khách',
      'Mã số thuế',
    ] : undefined,
    receivedColumns: [],
    summary: isImportRequest ? { totalRows: 0, validRows: 0, createdParents: 0, updatedParents: 0, createdVariants: 0, updatedVariants: 0, errors: 1 } : undefined,
    code: isPrintTemplateRequest ? 'PRINT_TEMPLATE_JSON_BODY_ERROR' : undefined,
  });
});

app.get('/api/health', (_req, res) => {
  res.json(buildHealthPayload());
});

// ----- Mount routes -----
// Public auth/setup endpoints remain inside usersRoutes and syncRoutes; business routes require a valid server session.
app.use('/api/users',          usersRoutes);
app.use('/api',                syncRoutes);
app.use('/api/database',       databaseRoutes);
app.use('/api/data-guardian',  dataGuardianRoutes);
app.use('/api/store',          requireAuth, requireAnyPermission(['store.read', 'store.manage']), storeRoutes);
app.use('/api/customers',      requireAuth, requireAnyPermission(['customers.read', 'customers.manage']), customersRoutes);
app.use('/api/products',       requireAuth, requireAnyPermission(['products.read', 'products.manage']), productsRoutes);
app.use('/api/partners',       requireAuth, requireAnyPermission(['partners.read', 'partners.manage']), partnersRoutes);
app.use('/api/invoices',       requireAuth, requireAnyPermission(['invoices.read', 'invoices.manage']), invoicesRoutes);
app.use('/api/imports',        requireAuth, requireAnyPermission(['imports.read', 'imports.manage']), importsRoutes);
app.use('/api/combos',         requireAuth, requireAnyPermission(['combos.read', 'combos.manage']), combosRoutes);
app.use('/api/returns',        requireAuth, requireAnyPermission(['returns.read', 'returns.manage']), returnsRoutes);
app.use('/api/stats',          requireAuth, requirePermission('stats.read'), statsRoutes);
app.use('/api/cash-book',      requireAuth, requireAnyPermission(['cashbook.read', 'cashbook.manage']), cashBookRoutes);
app.use('/api/payrolls',       requireAuth, requireAnyPermission(['payrolls.read', 'payrolls.manage']), payrollsRoutes);
app.use('/api/customer-types', requireAuth, requireAnyPermission(['customers.read', 'customers.manage']), customerTypesRoutes);
app.use('/api/product-categories', requireAuth, requireAnyPermission(['products.read', 'products.manage']), productCategoriesRoutes);
app.use('/api/features', featuresRoutes);
app.use('/api/updates', updatesRoutes);
app.use('/api/inventory', requireAuth, requireAnyPermission(['products.read', 'products.manage', 'inventory_reports.read']), inventoryRoutes);
app.use('/api/accounting', requireAuth, requireAnyPermission(['accounting.read', 'accounting.manage', 'tax_reports.read', 'tax_reports.manage', 'revenue_reports.read', 'profit_reports.read', 'debts.read', 'einvoices.read', 'bank_accounts.read', 'activity_logs.read']), accountingRoutes);
app.use('/api/settings', requireAuth, requireAnyPermission(['settings.read', 'settings.manage']), settingsRoutes);
app.use('/api/excel-imports', requireAuth, requireAnyPermission(['products.read', 'products.manage', 'customers.read', 'customers.manage', 'invoices.read', 'invoices.manage']), excelImportsRoutes);
app.use('/api/print-templates', requireAuth, requireAnyPermission(['print_templates.read', 'print_templates.manage']), printTemplatesRoutes);
app.use('/api/marketplaces', requireAuth, requireAnyPermission(['settings.read', 'settings.manage', 'invoices.read', 'invoices.manage']), marketplacesRoutes);
app.use('/api/history', historyRoutes);
app.get('/api/realtime/sync', (req, res) => {
  realtimeSyncService.registerClient(req, res);
});

// ----- Dashboard -----
function buildDashboardPayload() {
  const { getAll, getOne } = require('./db/database');
  const todayKey = today();
  const invoices = getAll('invoices');
  const activeProducts = getAll('products', p => p.active !== 0);
  const todayInvoices = invoices.filter(inv => String(inv.created_at || '').startsWith(todayKey) && !isCancelledInvoiceStatus(inv.status));
  const completedTodayInvoices = todayInvoices.filter(inv => isCompletedInvoiceStatus(inv.status));

  const recentInvoices = invoices
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 10)
    .map(inv => ({
      invoice_code: inv.invoice_code,
      total:        inv.total,
      status:       inv.status || '',
      created_at:   inv.created_at,
      customer_name: getOne('customers', c => c.id === inv.customer_id)?.name || '',
      user_name:    getOne('users',     u => u.id === inv.user_id)?.name     || '',
    }));
  const lowStock = activeProducts
    .filter(p => (p.stock || 0) < 10)
    .sort((a, b) => (a.stock || 0) - (b.stock || 0))
    .slice(0, 10)
    .map(p => ({ id: p.id, sku: p.sku || '', name: p.name, stock: p.stock || 0 }));

  return {
    ok: true,
    summary: {
      todayRevenue: completedTodayInvoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0),
      todayOrders: todayInvoices.length,
      paidOrders: completedTodayInvoices.length,
      totalProducts: activeProducts.length,
      outOfStock: activeProducts.filter(p => (Number(p.stock) || 0) === 0).length,
      lowStock: activeProducts.filter(p => (Number(p.stock) || 0) > 0 && (Number(p.stock) || 0) < 10).length,
    },
    recentInvoices,
    lowStock,
    serverTime: now(),
  };
}

app.get('/api/dashboard/summary', requireAuth, requirePermission('stats.read'), (_req, res) => {
  res.json(buildDashboardPayload());
});

app.get('/api/dashboard', requireAuth, requirePermission('stats.read'), (_req, res) => {
  res.json(buildDashboardPayload());
});

// ============================================================
//  CRON: mỗi 5 phút - kiểm tra & đồng bộ daily_stats
// ============================================================
cron.schedule('*/5 * * * *', () => {
  console.log('[VANKHA CRON]', new Date().toISOString());
  const t = today();
  upsertDailyStats(t, 0, { keepEmpty: true });
});


function runDbBackup(source = 'scheduler') {
  try {
    const result = runScheduledDbBackup(source);
    if (result.ok && !result.skipped) {
      console.log(`[KHA DB BACKUP] ${source}: đã tạo backup ${result.backup?.file || ''}`.trim());
    }
    return result;
  } catch (error) {
    console.error(`[KHA DB BACKUP] ${source}: lỗi backup DB - ${error.message}`);
    return { ok: false, error: error.message };
  }
}

function runExpiredCancelledInvoiceCleanup(source = 'scheduler') {
  try {
    const result = deleteExpiredCancelledInvoices();
    if (result.deletedCount > 0) {
      console.log(`[KHA CRON CLEANUP] ${source}: đã xóa ${result.deletedCount} đơn hủy quá 24 giờ, ${result.deletedDetailCount} dòng chi tiết`);
    }
    return result;
  } catch (error) {
    console.error(`[KHA CRON CLEANUP] ${source}: lỗi dọn đơn hủy quá 24 giờ - ${error.message}`);
    return { ok: false, error: error.message, deletedCount: 0, deletedDetailCount: 0 };
  }
}

// ============================================================
//  CRON: mỗi 30 phút - xóa an toàn đơn hàng đã hủy sau 24 giờ
// ============================================================
cron.schedule('*/30 * * * *', () => {
  runExpiredCancelledInvoiceCleanup('scheduler-30m');
});

// ============================================================
//  CRON: mỗi ngày 02:30 - backup DB JSON với retention gọn
// ============================================================
cron.schedule('30 2 * * *', () => {
  runDbBackup('scheduler-daily');
});

// ============================================================
//  START SERVER
// ============================================================
async function bootstrapPrintTemplateSchema() {
  try {
    const connection = await testPrintTemplatesMySqlConnection();
    const target = connection.config?.host
      ? `${connection.config.user}@${connection.config.host}:${connection.config.port}/${connection.config.database}`
      : connection.config?.url || connection.mode;
    console.log(`[KHA PRINT TEMPLATES MYSQL] Kết nối MySQL thành công (${target}) - database=${connection.database || 'n/a'}, version=${connection.mysqlVersion || 'n/a'}.`);
  } catch (error) {
    const status = getPrintTemplatesMySqlStatus();
    console.warn('[KHA PRINT TEMPLATES MYSQL] Không thể kết nối MySQL cho module mẫu in hóa đơn khi startup.');
    console.warn(`[KHA PRINT TEMPLATES MYSQL] Lỗi: ${error.code || 'MYSQL_ERROR'} - ${error.message}`);
    console.warn(`[KHA PRINT TEMPLATES MYSQL] Trạng thái cấu hình: ${JSON.stringify({ configured: status.configured, mode: status.mode, missing: status.missing, config: status.config })}`);
    console.warn('[KHA PRINT TEMPLATES MYSQL] Backend tiếp tục chạy; các endpoint mẫu in hóa đơn trả JSON an toàn cho tới khi MySQL sẵn sàng.');
    return;
  }

  try {
    const result = await ensurePrintTemplatesSchema({ failSoft: true });
    if (result?.ok) {
      console.log('[KHA PRINT TEMPLATES MYSQL] Schema print_templates đã sẵn sàng.');
    } else {
      console.warn(`[KHA PRINT TEMPLATES MYSQL] Bỏ qua bootstrap schema print_templates: ${result?.error || 'chưa cấu hình MySQL'}`);
    }
  } catch (error) {
    console.warn(`[KHA PRINT TEMPLATES MYSQL] Không thể bootstrap schema print_templates, backend vẫn tiếp tục chạy: ${error.code || 'SCHEMA_ERROR'} - ${error.message}`);
  }
}

async function bootstrapSettingsSchema() {
  try {
    const result = await ensureSettingsSchema({ failSoft: true });
    if (result?.ok) {
      await getNegativeStockSettingsAsync({ accountId: 1 });
      console.log('[KHA SETTINGS MYSQL] Schema settings/system_settings đã sẵn sàng và đã mirror negative_stock_limit vào runtime JSON.');
    } else {
      console.warn(`[KHA SETTINGS MYSQL] Bỏ qua bootstrap schema settings: ${result?.error || 'chưa cấu hình MySQL'}`);
    }
  } catch (error) {
    console.warn(`[KHA SETTINGS MYSQL] Không thể bootstrap schema settings, backend vẫn tiếp tục chạy bằng JSON fallback: ${error.code || 'SETTINGS_SCHEMA_ERROR'} - ${error.message}`);
  }
}

// ============================================================
//  KHA DATA GUARDIAN - Bootstrap
// ============================================================
function bootstrapDataGuardian() {
  const dataDir = process.env.ELECTRON_USER_DATA || path.resolve(__dirname, '..', 'data');

  // 1. Admin Alert Service (must be first - other services depend on it)
  adminAlertService.initialize({ dataDir, appVersion: APP_VERSION });

  // 2. Transaction Journal (WAL)
  transactionJournal.initialize({ dataDir });

  // 3. Disk Health Monitor
  diskHealthMonitor.initialize({ alertService: adminAlertService });

  // 4. Integrity Checker
  integrityChecker.initialize({ alertService: adminAlertService });

  // 5. Safety Rules
  safetyRules.initialize({ alertService: adminAlertService });

  // 6. Database Auto Recovery
  databaseAutoRecovery.initialize({ alertService: adminAlertService });

  // 7. Power Loss Recovery
  powerLossRecovery.initialize({
    dataDir,
    alertService: adminAlertService,
    transactionJournal,
    backupScheduler,
  });

  // 8. Realtime Backup
  realtimeBackup.initialize({
    dataDir,
    dbModule,
    alertService: adminAlertService,
  });

  // 9. Backup Scheduler
  backupScheduler.initialize({
    dataDir,
    dbModule,
    alertService: adminAlertService,
    diskHealthMonitor,
  });

  // 10. Maintenance Service
  maintenanceService.initialize({
    dataDir,
    dbModule,
    alertService: adminAlertService,
    backupScheduler,
    integrityChecker,
    diskHealthMonitor,
  });

  // 11. Self-Healing
  selfHealing.initialize({
    dbModule,
    alertService: adminAlertService,
  });

  // 12. Realtime Sync & History Services
  realtimeSyncService.initialize();
  historyService.initialize({ dbModule });

  // 13. Auth Repair & Self-Healing Setup
  try {
    authRepairService.repairUserAuthSystem();
    authRepairService.initializeEmergencyAdmin();
  } catch (err) {
    console.error('[KHA DATA GUARDIAN] Failed to bootstrap auth repair/emergency recovery admin:', err.message);
  }

  // Set guardian services reference for API routes
  dataGuardianRoutes.setGuardianServices({
    transactionJournal,
    realtimeBackup,
    backupScheduler,
    diskHealthMonitor,
    powerLossRecovery,
    databaseAutoRecovery,
    maintenanceService,
    selfHealing,
    integrityChecker,
    adminAlertService,
    safetyRules,
    dbModule,
  });

  // Hook transaction journal into database module
  hookGuardianIntoDatabase();

  console.log('[KHA DATA GUARDIAN] All 11 modules initialized');
}

function getRequestContext() {
  const req = requestContext.getStore();
  return {
    sourceTabId: req?.headers?.['x-client-tab-id'] || '',
    clientUpdatedAt: req?.headers?.['x-client-updated-at'] || null,
    userId: req?.user?.id || null,
    userName: req?.user?.name || 'Hệ thống',
  };
}

function hookGuardianIntoDatabase() {
  // Store original functions
  const originalInsert = dbModule.insert;
  const originalUpdate = dbModule.update;
  const originalRemove = dbModule.remove;
  const originalReplaceTable = dbModule.replaceTable;
  const originalSaveDB = dbModule.saveDB;
  const originalWithAtomicDbWrite = dbModule.withAtomicDbWrite;

  let transactionDepth = 0;
  let pendingBroadcasts = [];

  function queueOrBroadcast(tables, detail) {
    if (transactionDepth > 0) {
      pendingBroadcasts.push({ tables, detail });
    } else {
      realtimeSyncService.broadcastChangeEvent(tables, detail);
    }
  }

  // Hook withAtomicDbWrite to buffer events during transactions
  if (typeof originalWithAtomicDbWrite === 'function') {
    dbModule.withAtomicDbWrite = function guardianWithAtomicDbWrite(callback) {
      transactionDepth++;
      try {
        const result = originalWithAtomicDbWrite.call(this, callback);
        transactionDepth--;
        if (transactionDepth === 0) {
          const uniqueTables = Array.from(new Set(pendingBroadcasts.flatMap(b => b.tables)));
          const broadcastsToProcess = [...pendingBroadcasts];
          pendingBroadcasts = [];
          if (uniqueTables.length > 0) {
            const ctx = getRequestContext();
            realtimeSyncService.broadcastChangeEvent(uniqueTables, {
              sourceTabId: ctx?.sourceTabId,
              reason: 'transaction-committed',
              broadcasts: broadcastsToProcess,
            });
          }
        }
        return result;
      } catch (error) {
        transactionDepth--;
        if (transactionDepth === 0) {
          pendingBroadcasts = [];
        }
        throw error;
      }
    };
  }

  // Hook insert
  dbModule.insert = function guardianInsert(table, row, options = {}) {
    const result = originalInsert.call(this, table, row, options);
    transactionJournal.writeEntry('insert', table, result?.id || row?.id, { after: result || row });
    realtimeBackup.onDataChange(table, 'insert', result?.id || row?.id);

    // Ghi nhận lịch sử và phát realtime
    const ctx = getRequestContext();
    if (!options.skipHistory && table !== 'edit_history') {
      historyService.recordChange(table, result?.id || row?.id, 'insert', null, result || row, ctx);
    }
    queueOrBroadcast([table], {
      sourceTabId: ctx.sourceTabId,
      op: 'insert',
      id: result?.id || row?.id,
    });

    return result;
  };

  // Hook update
  dbModule.update = function guardianUpdate(table, id, changes, options = {}) {
    const before = dbModule.getOne(table, r => r.id === id);
    const result = originalUpdate.call(this, table, id, changes, options);
    transactionJournal.writeEntry('update', table, id, { before, after: changes });
    realtimeBackup.onDataChange(table, 'update', id);

    // Ghi nhận lịch sử và phát realtime
    const ctx = getRequestContext();
    if (!options.skipHistory && table !== 'edit_history') {
      historyService.recordChange(table, id, 'update', before, result || changes, ctx);
    }
    queueOrBroadcast([table], {
      sourceTabId: ctx.sourceTabId,
      op: 'update',
      id: id,
    });

    return result;
  };

  // Hook remove with safety rules
  dbModule.remove = function guardianRemove(table, id, options = {}) {
    const existingRow = dbModule.getOne(table, r => r.id === id);
    const safetyResult = safetyRules.applySafetyOnRemove(table, id, existingRow);

    if (safetyResult.action === 'block') {
      console.warn(`[KHA SAFETY] Blocked delete on ${table} id=${id}: ${safetyResult.reason}`);
      return null;
    }

    const ctx = getRequestContext();
    let result;
    if (safetyResult.action === 'soft_delete') {
      // Convert to update with soft-delete fields
      transactionJournal.writeEntry('update', table, id, { before: existingRow, after: safetyResult.data });
      realtimeBackup.onDataChange(table, 'update', id);
      result = originalUpdate.call(this, table, id, safetyResult.data, options);

      // Ghi nhận lịch sử và phát realtime
      if (!options.skipHistory && table !== 'edit_history') {
        historyService.recordChange(table, id, 'delete', existingRow, safetyResult.data, ctx);
      }
      queueOrBroadcast([table], {
        sourceTabId: ctx.sourceTabId,
        op: 'delete',
        id: id,
      });
      return result;
    }

    // Allow delete for non-protected tables
    transactionJournal.writeEntry('delete', table, id, { before: existingRow });
    realtimeBackup.onDataChange(table, 'delete', id);
    result = originalRemove.call(this, table, id, options);

    // Ghi nhận lịch sử và phát realtime
    if (!options.skipHistory && table !== 'edit_history') {
      historyService.recordChange(table, id, 'delete', existingRow, null, ctx);
    }
    queueOrBroadcast([table], {
      sourceTabId: ctx.sourceTabId,
      op: 'delete',
      id: id,
    });

    return result;
  };

  // Hook replaceTable
  dbModule.replaceTable = function guardianReplaceTable(table, rows, options = {}) {
    const result = originalReplaceTable.call(this, table, rows, options);
    const ctx = getRequestContext();
    queueOrBroadcast([table], {
      sourceTabId: ctx.sourceTabId,
      op: 'replace',
    });
    return result;
  };

  // Hook saveDB to mark journal committed
  dbModule.saveDB = function guardianSaveDB() {
    const result = originalSaveDB.call(this);
    transactionJournal.markCommitted();
    return result;
  };
}

function startGuardianServices() {
  // Detect previous crash
  const crashInfo = powerLossRecovery.detectCrash();
  if (crashInfo.crashed) {
    console.log('[KHA DATA GUARDIAN] Previous crash detected, performing recovery...');
    powerLossRecovery.performRecovery(dbModule);
  }

  // Database auto recovery check
  databaseAutoRecovery.runStartupCheck(dbModule);

  // Create lock file
  powerLossRecovery.createLock();

  // Start all scheduled services
  backupScheduler.startSchedules();
  diskHealthMonitor.startMonitoring();
  maintenanceService.startSchedule();
  selfHealing.startMonitoring();

  // Log startup alert
  adminAlertService.sendInfoAlert('system', `KHA Data Guardian khởi động thành công. Version: ${APP_VERSION}`);

  console.log('[KHA DATA GUARDIAN] All services started');
}

function shutdownGuardian() {
  console.log('[KHA DATA GUARDIAN] Shutting down...');
  try { realtimeSyncService.shutdown(); } catch (_) {}
  try { selfHealing.shutdown(); } catch (_) {}
  try { maintenanceService.shutdown(); } catch (_) {}
  try { diskHealthMonitor.shutdown(); } catch (_) {}
  try { backupScheduler.shutdown(); } catch (_) {}
  try { realtimeBackup.shutdown(); } catch (_) {}
  try { transactionJournal.shutdown(); } catch (_) {}
  try { powerLossRecovery.shutdown(); } catch (_) {}
  console.log('[KHA DATA GUARDIAN] Shutdown complete');
}

async function startServer() {
  await bootstrapSettingsSchema();
  await bootstrapPrintTemplateSchema();

  // Initialize Data Guardian
  bootstrapDataGuardian();

  runDbBackup('startup');
  runExpiredCancelledInvoiceCleanup('startup');

  // Start Data Guardian services
  startGuardianServices();

  const server = app.listen(PORT, HOST, () => {
    console.log(`
----------------------------------------------
📡 KHA Backend listening at http://${HOST}:${PORT}
🛡️  KHA Data Guardian: ACTIVE
----------------------------------------------
DB path: ${dbModule.DB_PATH}
Started: ${SERVER_STARTED_AT}
----------------------------------------------
`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[KHA SERVER] Cong ${PORT} dang bi mot ung dung khac chiem dung (EADDRINUSE).`);
      console.error('[KHA SERVER] Hay tat ung dung dang giu cong nay, hoac dat bien moi truong PORT=<cong_khac> roi chay lai backend.');
    } else {
      console.error('[KHA SERVER] Loi HTTP server:', err && err.message ? err.message : err);
    }
    process.exit(1);
  });
}

// Clean shutdown handlers
process.on('SIGINT', () => {
  shutdownGuardian();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdownGuardian();
  process.exit(0);
});
process.on('exit', () => {
  try { shutdownGuardian(); } catch (_) {}
});

startServer().catch(error => {
  console.error('[KHA SERVER] Lỗi khởi động không mong muốn:', error);
  process.exit(1);
});
