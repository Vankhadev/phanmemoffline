/**
 *  Bán hàng offline - by Van kha mmo
 *  Backend: Node.js + Express + JSON file database
 */
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const path    = require('path');
const { version: APP_VERSION } = require('../../package.json');

// --- Load DB & helpers ---
const { loadDB, upsertDailyStats, today, now, db, DB_PATH } = require('./db/database');
const { requireAuth, requireAnyPermission, requirePermission } = require('./middleware/auth');
loadDB();

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
const botRoutes       = require('./routes/bot');
const customerTypesRoutes = require('./routes/customerTypes');
const productCategoriesRoutes = require('./routes/productCategories');
const printTemplatesRoutes = require('./routes/printTemplates');
const sapoSyncRoutes = require('./routes/sapoSync');
const excelImportsRoutes = require('./routes/excelImports');
const mobileRoutes = require('./routes/mobile');
const { reconcileMobileServerState } = require('./services/mobileSyncService');

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
    dbPath: maskDbPath(DB_PATH),
    dbFile: path.basename(DB_PATH || ''),
    node: process.version,
  };
}

app.use(cors());
app.use('/api/products/import-excel-rows', express.json({ limit: '25mb' }));
app.use('/api/sapo/import/customers', express.json({ limit: '25mb' }));
app.use('/api/sapo/customers/import', express.json({ limit: '25mb' }));
app.use('/api/excel-imports', express.json({ limit: '25mb' }));
app.use(express.json());

app.use((err, req, res, next) => {
  if (!err) return next();
  const isJsonBodyError = err.type === 'entity.too.large' || err.type === 'entity.parse.failed' || err instanceof SyntaxError;
  if (!isJsonBodyError) return next(err);

  const isImportRequest = req.path === '/api/products/import-excel-rows' || req.path.startsWith('/api/sapo/import/customers') || req.path.startsWith('/api/sapo/customers/import') || req.path.startsWith('/api/excel-imports');
  const status = err.type === 'entity.too.large' ? 413 : 400;
  if (isImportRequest) console.warn('[KHA IMPORT EXCEL] JSON body error:', err.message);
  res.status(status).json({
    ok: false,
    error: err.type === 'entity.too.large'
      ? 'File Excel quá lớn hoặc có quá nhiều dòng để import một lần'
      : 'Body JSON import không hợp lệ',
    detail: err.type === 'entity.too.large'
      ? 'Dữ liệu gửi lên vượt giới hạn 25MB. Hãy giảm số dòng/cột không cần thiết hoặc chia file import thành nhiều lần.'
      : 'Backend không đọc được JSON do frontend gửi lên. Vui lòng thử lại với file Excel hợp lệ.',
    errors: [],
    expectedColumns: isImportRequest ? [
      'Loại dòng',
      'SKU',
      'Parent SKU',
      'Tên sản phẩm',
      'Tên cha',
      'Giá nhập',
      'Giá sỉ',
      'Giá lẻ',
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
  });
});

app.get('/api/health', (_req, res) => {
  res.json(buildHealthPayload());
});

// ----- Mount routes -----
// Public auth/setup endpoints remain inside usersRoutes and syncRoutes; business routes require a valid server session.
app.use('/api/users',          usersRoutes);
app.use('/api',                syncRoutes);
app.use('/api/mobile',         mobileRoutes);
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
app.use('/api/bot',            requireAuth, requireAnyPermission(['bot.read', 'bot.manage']), botRoutes);
app.use('/api/customer-types', requireAuth, requireAnyPermission(['customers.read', 'customers.manage']), customerTypesRoutes);
app.use('/api/product-categories', requireAuth, requireAnyPermission(['products.read', 'products.manage']), productCategoriesRoutes);
app.use('/api/print-templates', requireAuth, requireAnyPermission(['print_templates.read', 'print_templates.manage']), printTemplatesRoutes);
app.use('/api/excel-imports', requireAuth, requireAnyPermission(['products.read', 'products.manage', 'customers.read', 'customers.manage', 'invoices.read', 'invoices.manage']), excelImportsRoutes);
app.use('/api/sapo', requireAuth, requireAnyPermission(['products.read', 'products.manage', 'customers.read', 'customers.manage', 'invoices.read', 'invoices.manage']), sapoSyncRoutes);

// ----- Dashboard -----
function buildDashboardPayload() {
  const { getAll, getOne } = require('./db/database');
  const todayKey = today();
  const invoices = getAll('invoices');
  const activeProducts = getAll('products', p => p.active !== 0);
  const todayInvoices = invoices.filter(inv => String(inv.created_at || '').startsWith(todayKey) && inv.status !== 'cancelled');
  const completedTodayInvoices = todayInvoices.filter(inv => inv.status === 'completed');

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
  console.log('[KHA CRON]', new Date().toISOString());
  const t = today();
  const { getOne } = require('./db/database');
  if (!getOne('daily_stats', s => s.stat_date === t)) {
    upsertDailyStats(t, 0);
  }
});

// ============================================================
//  CRON: mỗi 15 phút - reconcile trạng thái mobile server-side
// ============================================================
cron.schedule('*/15 * * * *', () => {
  try {
    const result = reconcileMobileServerState();
    if (result.expiredLinks || result.staleEvents) {
      console.log(`[KHA MOBILE CRON] expiredLinks=${result.expiredLinks}, staleEvents=${result.staleEvents}`);
    }
  } catch (err) {
    console.warn('[KHA MOBILE CRON] Reconcile failed:', err.message);
  }
});

// ============================================================
//  CRON: mỗi ngày lúc 02:00 - xóa đơn hàng đã hủy cũ hơn 3 ngày
// ============================================================
cron.schedule('0 2 * * *', () => {
  console.log('[KHA CRON CLEANUP] Xóa đơn hàng cũ -', new Date().toISOString());
  const { getAll, remove } = require('./db/database');
  const invoices = getAll('invoices');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 3); // 3 ngày trước

  let deletedCount = 0;
  invoices.forEach(inv => {
    if (inv.status === 'cancelled' && inv.created_at) {
      const invDate = new Date(inv.created_at);
      if (invDate < cutoffDate) {
        remove('invoices', inv.id);
        deletedCount++;
      }
    }
  });
  console.log(`[KHA CRON CLEANUP] Đã xóa ${deletedCount} đơn hàng đã hủy cũ hơn 3 ngày`);
});

// ============================================================
//  START
// ============================================================
const displayHost = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST;
console.log(`\n========================================`);
console.log(`[KHA] Backend:  http://${displayHost}:${PORT}`);
if (HOST === '0.0.0.0' || HOST === '::') {
  console.log(`[KHA] LAN:      http://<IP-may-chu>:${PORT}`);
}
console.log(`[KHA] Database: ${DB_PATH}`);
console.log(`[KHA] Version:  ${APP_VERSION}`);
console.log(`========================================\n`);

const server = app.listen(PORT, HOST, () => {
  console.log(`[KHA] Tables:`, Object.keys(db).map(k => `${k}(${Array.isArray(db[k]) ? db[k].length : 0})`).join(', '));
});

server.on('error', err => {
  console.error(`[KHA] Không thể khởi động backend trên ${HOST}:${PORT}:`, err.message);
});

module.exports = { app, server, buildHealthPayload };