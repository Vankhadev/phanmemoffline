/**
 * Database helper - JSON file storage
 * - Dev/web local: dùng DB ở root project phanmienoffline.db.json
 * - Electron packaged: Electron main truyền KHA_DB_PATH trỏ tới userData (writable)
 * - Khi chưa có DB runtime thì tạo DB sạch/tối thiểu từ schema/code, không copy seed vận hành.
 */
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { hashPassword, isPasswordHash } = require('../utils/password');

const requestContext = new AsyncLocalStorage();

const APP_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_DB_PATH = path.join(APP_ROOT, 'phanmienoffline.db.json');
function resolveDBPath() {
  if (process.env.KHA_DB_PATH) return path.resolve(process.env.KHA_DB_PATH);
  if (process.env.ELECTRON_USER_DATA) return path.join(process.env.ELECTRON_USER_DATA, 'phanmienoffline.db.json');
  return DEFAULT_DB_PATH;
}

const DB_PATH = resolveDBPath();

const SCHEMA = {
  accounts: [],
  sessions: [],
  permissions: [],
  role_permissions: [],
  sync_metadata: [],
  audit_logs: [],
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
  bot_settings: [],
  bot_alerts: [],
  customer_types: [],
  counters: [],
  cash_book: [],
  payrolls: [],
  print_templates: [],
  sapo_settings: [],
  sapo_sync_runs: [],
  excel_import_runs: [],
  excel_import_details: [],
};

const INITIAL_NEXT_ID = {
  accounts: 1, sessions: 1, permissions: 1, role_permissions: 1, sync_metadata: 1, audit_logs: 1,
  store_info: 1, users: 1, customers: 1, products: 1, product_categories: 1, partners: 1,
  invoices: 1, invoice_details: 1, import_logs: 1, import_details: 1,
  combos: 1, combo_items: 1, daily_stats: 1,
  return_logs: 1, return_details: 1,
  bot_settings: 1, bot_alerts: 1, customer_types: 1, counters: 1,
  cash_book: 1, payrolls: 1, print_templates: 1, sapo_settings: 1, sapo_sync_runs: 1,
  excel_import_runs: 1, excel_import_details: 1,
};

const DEFAULT_ACCOUNT_SLUG = 'default';
const ACCOUNT_SCOPED_TABLES = new Set([
  'store_info', 'users', 'customers', 'products', 'product_categories', 'partners',
  'invoices', 'invoice_details', 'import_logs', 'import_details', 'combos', 'combo_items',
  'daily_stats', 'return_logs', 'return_details', 'bot_settings', 'bot_alerts',
  'customer_types', 'counters', 'cash_book', 'payrolls', 'print_templates',
  'sapo_settings', 'sapo_sync_runs', 'excel_import_runs', 'excel_import_details',
  'sync_metadata', 'audit_logs',
]);

const DEFAULT_PERMISSIONS = [
  ['users.read', 'Xem tài khoản', 'Xem danh sách và hồ sơ tài khoản trong cửa hàng'],
  ['users.manage', 'Quản lý tài khoản', 'Tạo, sửa, khóa tài khoản và vai trò'],
  ['store.read', 'Xem cấu hình cửa hàng', 'Xem thông tin cửa hàng'],
  ['store.manage', 'Quản lý cấu hình cửa hàng', 'Cập nhật thông tin cửa hàng'],
  ['products.read', 'Xem sản phẩm', 'Xem sản phẩm, biến thể và danh mục'],
  ['products.manage', 'Quản lý sản phẩm', 'Tạo, sửa, xóa, import sản phẩm'],
  ['customers.read', 'Xem khách hàng', 'Xem khách hàng và nhóm khách'],
  ['customers.manage', 'Quản lý khách hàng', 'Tạo, sửa, xóa khách hàng và nhóm khách'],
  ['partners.read', 'Xem đối tác', 'Xem nhà cung cấp/đối tác'],
  ['partners.manage', 'Quản lý đối tác', 'Tạo, sửa, xóa nhà cung cấp/đối tác'],
  ['invoices.read', 'Xem đơn hàng', 'Xem hóa đơn và báo cáo đơn hàng'],
  ['invoices.manage', 'Quản lý đơn hàng', 'Tạo, sửa, hủy, xác nhận hóa đơn'],
  ['imports.read', 'Xem nhập hàng', 'Xem phiếu nhập hàng'],
  ['imports.manage', 'Quản lý nhập hàng', 'Tạo, sửa, hủy phiếu nhập hàng'],
  ['combos.read', 'Xem combo', 'Xem combo bán hàng'],
  ['combos.manage', 'Quản lý combo', 'Tạo, sửa, xóa combo bán hàng'],
  ['returns.read', 'Xem trả hàng', 'Xem phiếu trả hàng'],
  ['returns.manage', 'Quản lý trả hàng', 'Tạo, sửa, xóa phiếu trả hàng'],
  ['stats.read', 'Xem thống kê', 'Xem thống kê, dashboard và báo cáo'],
  ['cashbook.read', 'Xem sổ quỹ', 'Xem thu chi'],
  ['cashbook.manage', 'Quản lý sổ quỹ', 'Tạo, sửa, xóa thu chi'],
  ['payrolls.read', 'Xem lương', 'Xem bảng lương'],
  ['payrolls.manage', 'Quản lý lương', 'Tạo, sửa, xóa bảng lương'],
  ['print_templates.read', 'Xem mẫu in', 'Xem mẫu in hóa đơn/phiếu'],
  ['print_templates.manage', 'Quản lý mẫu in', 'Tạo, sửa, xóa mẫu in'],
  ['sync.read', 'Đồng bộ đọc', 'Pull dữ liệu đồng bộ từ server'],
  ['sync.write', 'Đồng bộ ghi', 'Push dữ liệu đồng bộ lên server'],
  ['bot.read', 'Xem bot', 'Xem cấu hình và cảnh báo bot'],
  ['bot.manage', 'Quản lý bot', 'Cập nhật cấu hình bot'],
  ['settings.read', 'Xem thiết lập', 'Xem các thiết lập hệ thống'],
  ['settings.manage', 'Quản lý thiết lập', 'Cập nhật thiết lập hệ thống'],
];

const DEFAULT_USER_PERMISSION_KEYS = [
  'store.read',
  'products.read', 'products.manage',
  'customers.read', 'customers.manage',
  'partners.read', 'partners.manage',
  'invoices.read', 'invoices.manage',
  'imports.read', 'imports.manage',
  'combos.read', 'combos.manage',
  'returns.read', 'returns.manage',
  'stats.read',
  'cashbook.read', 'cashbook.manage',
  'payrolls.read', 'payrolls.manage',
  'print_templates.read', 'print_templates.manage',
  'sync.read', 'sync.write',
  'bot.read', 'bot.manage',
  'settings.read',
];

const SYNC_TRACKED_TABLES = [
  'store_info', 'users', 'customers', 'products', 'product_categories', 'partners',
  'invoices', 'invoice_details', 'import_logs', 'import_details', 'combos', 'combo_items',
  'daily_stats', 'return_logs', 'return_details', 'bot_settings', 'bot_alerts',
  'customer_types', 'cash_book', 'payrolls', 'print_templates',
  'excel_import_runs', 'excel_import_details',
];

const db = JSON.parse(JSON.stringify(SCHEMA));
let nextId = { ...INITIAL_NEXT_ID };

function replaceDB(nextDB) {
  for (const key of Object.keys(db)) delete db[key];
  Object.assign(db, JSON.parse(JSON.stringify(SCHEMA)), nextDB || {});
}

function ensureDBFileExists() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  return fs.existsSync(DB_PATH);
}

function recalculateNextIds() {
  nextId = { ...INITIAL_NEXT_ID };
  for (const table of Object.keys(nextId)) {
    if (!Array.isArray(db[table]) || db[table].length === 0) continue;
    const numericIds = db[table]
      .map(r => Number(r && r.id))
      .filter(id => Number.isFinite(id));
    if (numericIds.length > 0) nextId[table] = Math.max(...numericIds) + 1;
  }
}

function sanitizeBackupReason(reason) {
  return String(reason || 'migration').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'migration';
}

function backupDB(reason = 'migration') {
  if (!fs.existsSync(DB_PATH)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${DB_PATH}.backup.${stamp}.${sanitizeBackupReason(reason)}.json`;
  fs.copyFileSync(DB_PATH, backupPath);
  console.log('[KHA] DB backup created before migration:', backupPath);
  return backupPath;
}

function needsMigrationBackup() {
  if (!Array.isArray(db.accounts) || db.accounts.length === 0) return true;
  if (!Array.isArray(db.sessions) || !Array.isArray(db.permissions) || !Array.isArray(db.role_permissions)) return true;
  if (!Array.isArray(db.sync_metadata) || !Array.isArray(db.audit_logs)) return true;
  if (!db.permissions.some(permission => permission && permission.key === 'sync.read')) return true;

  for (const table of ACCOUNT_SCOPED_TABLES) {
    const rows = Array.isArray(db[table]) ? db[table] : [];
    if (rows.some(row => row && (row.account_id === undefined || row.sync_version === undefined || row.server_updated_at === undefined))) {
      return true;
    }
  }

  return false;
}

function loadDB() {
  const hasDBFile = ensureDBFileExists();

  if (hasDBFile && fs.existsSync(DB_PATH)) {
    let parsed;
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn('[KHA] Corrupted DB file, resetting...', e.message);
      replaceDB(JSON.parse(JSON.stringify(SCHEMA)));
      nextId = { ...INITIAL_NEXT_ID };
      seedData();
      saveDB();
      console.log('[KHA] DB reset and seeded');
      return;
    }

    const needsSapoMigration = !Array.isArray(parsed.sapo_settings) || !Array.isArray(parsed.sapo_sync_runs);
    replaceDB(parsed);
    recalculateNextIds();
    if (needsMigrationBackup() || needsSapoMigration) backupDB(needsSapoMigration ? 'pre-sapo-sync-migration' : 'pre-auth-sync-migration');
    migrateDB();
    recalculateNextIds();
    console.log('[KHA] DB loaded from', DB_PATH);
    return;
  }

  replaceDB(JSON.parse(JSON.stringify(SCHEMA)));
  nextId = { ...INITIAL_NEXT_ID };
  seedData();
  saveDB();
  console.log('[KHA] New DB created at', DB_PATH);
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePaymentMethod(method) {
  const value = String(method || '').trim().toLowerCase();
  if (value === 'cash' || value === 'bank' || value === 'debt') return value;
  if (value === 'card' || value === 'other') return 'debt';
  if (value === 'tiền mặt' || value === 'tien mat') return 'cash';
  if (value === 'chuyển khoản' || value === 'chuyen khoan') return 'bank';
  if (value === 'công nợ' || value === 'cong no') return 'debt';
  return 'cash';
}

function normalizeTextKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeGroupKey(value) {
  return normalizeTextKey(value).replace(/\s+/g, '_');
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '').split(/[,;\n]/).map(v => v.trim()).filter(Boolean);
}

const DEFAULT_PRODUCT_CATEGORIES = [
  { name: 'vòng', group_name: 'vòng', keywords: ['vòng', 'vong'], aliases: ['vong'] },
  { name: 'vòng led', group_name: 'vòng', keywords: ['vòng led', 'vong led', 'led'], aliases: ['vong led'] },
  { name: 'vòng dẻo', group_name: 'vòng', keywords: ['vòng dẻo', 'vong deo', 'dẻo', 'deo'], aliases: ['vong deo'] },
  { name: 'nến', group_name: 'nến', keywords: ['nến', 'nen'], aliases: ['nen'] },
];

function inferPrintWidthMm(paperSize, fallback = 80) {
  const text = String(paperSize || '').trim().toLowerCase();
  if (text === 'a4') return 210;
  if (text === 'a5') return 148;
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return fallback;
  return normalizeNumber(match[1].replace(',', '.'), fallback);
}

function clonePrintTemplateConfig(config) {
  if (config === undefined || config === null || config === '') return null;
  if (typeof config === 'string') {
    try {
      return clonePrintTemplateConfig(JSON.parse(config));
    } catch (_) {
      return null;
    }
  }
  if (typeof config !== 'object') return null;
  return JSON.parse(JSON.stringify(config));
}

function createDefaultSaleInvoiceVisualConfig(paperSize = '80mm', widthMm = 80) {
  return {
    version: 1,
    layout: {
      paperSize,
      widthMm: Number(widthMm) || inferPrintWidthMm(paperSize, 80),
      fontFamily: 'Arial, Helvetica, sans-serif',
      baseFontSize: 11,
      paddingMm: 4,
      borderStyle: 'dashed',
    },
    header: {
      visible: true,
      align: 'center',
      showLogo: true,
      logoWidthMm: 24,
      title: 'HÓA ĐƠN BÁN HÀNG',
      subtitle: '',
      titleFontSize: 15,
      subtitleFontSize: 11,
      fields: [
        { key: 'store.name', label: '', visible: true, align: 'center', fontSize: 15, bold: true, uppercase: true },
        { key: 'store.address', label: 'Địa chỉ', visible: true, align: 'center', fontSize: 10 },
        { key: 'store.phone', label: 'ĐT', visible: true, align: 'center', fontSize: 10 },
        { key: 'store.tax_code', label: 'MST', visible: true, align: 'center', fontSize: 10 },
      ],
    },
    invoiceInfo: {
      visible: true,
      title: '',
      columns: 1,
      fontSize: 11,
      fields: [
        { key: 'invoice.code', label: 'Số hóa đơn', visible: true, align: 'left', fontSize: 11, boldValue: true },
        { key: 'invoice.created_at', label: 'Ngày giờ', visible: true, align: 'left', fontSize: 11 },
        { key: 'invoice.cashier', label: 'Thu ngân', visible: true, align: 'left', fontSize: 11 },
      ],
    },
    customerInfo: {
      visible: true,
      title: '',
      columns: 1,
      fontSize: 11,
      fields: [
        { key: 'customer.name', label: 'Khách hàng', visible: true, align: 'left', fontSize: 11 },
        { key: 'customer.phone', label: 'Điện thoại', visible: true, align: 'left', fontSize: 11 },
        { key: 'customer.address', label: 'Địa chỉ', visible: false, align: 'left', fontSize: 11 },
      ],
    },
    table: {
      visible: true,
      fontSize: 10,
      headerFontSize: 10,
      showSku: true,
      columns: [
        { key: 'index', label: '#', visible: true, align: 'center', width: '7%' },
        { key: 'name', label: 'Sản phẩm', visible: true, align: 'left', width: '33%' },
        { key: 'unit', label: 'ĐVT', visible: false, align: 'center', width: '10%' },
        { key: 'quantity', label: 'SL', visible: true, align: 'center', width: '10%' },
        { key: 'price', label: 'Đơn giá', visible: true, align: 'right', width: '18%' },
        { key: 'discount', label: 'Giảm', visible: false, align: 'right', width: '12%' },
        { key: 'line_total', label: 'Thành tiền', visible: true, align: 'right', width: '22%' },
      ],
    },
    totals: {
      visible: true,
      align: 'right',
      fontSize: 11,
      fields: [
        { key: 'totals.subtotal', label: 'Tạm tính', visible: true, align: 'right', fontSize: 11 },
        { key: 'totals.discount', label: 'Giảm giá', visible: true, align: 'right', fontSize: 11 },
        { key: 'totals.delivery_fee', label: 'Phí giao hàng', visible: true, align: 'right', fontSize: 11 },
        { key: 'invoice.payment_method', label: 'Hình thức TT', visible: true, align: 'right', fontSize: 11 },
        { key: 'totals.total', label: 'Tổng tiền', visible: true, align: 'right', fontSize: 13, bold: true },
        { key: 'totals.paid', label: 'Tiền khách đưa', visible: true, align: 'right', fontSize: 11 },
        { key: 'totals.change', label: 'Tiền thừa', visible: true, align: 'right', fontSize: 11 },
        { key: 'totals.remaining', label: 'Còn phải trả', visible: true, align: 'right', fontSize: 11 },
        { key: 'invoice.note', label: 'Ghi chú', visible: true, align: 'left', fontSize: 10 },
      ],
    },
    payment: {
      visible: true,
      showQr: true,
      showQrLogo: true,
      qrSizeMm: 28,
      label: 'Quét mã để thanh toán',
      fontSize: 10,
      align: 'center',
    },
    footer: {
      visible: true,
      align: 'center',
      fontSize: 10,
      lines: [
        { text: '{{store.invoice_note}}', visible: true, fontSize: 10, bold: false },
        { text: '{{store.invoice_slogan}}', visible: true, fontSize: 10, bold: false },
        { text: 'Cảm ơn quý khách và hẹn gặp lại!', visible: true, fontSize: 10, bold: true },
      ],
    },
  };
}

function normalizePrintTemplateConfig(config, paperSize = '80mm', widthMm = 80) {
  const cloned = clonePrintTemplateConfig(config);
  if (!cloned) return null;
  if (!cloned.layout || typeof cloned.layout !== 'object') cloned.layout = {};
  if (!cloned.layout.paperSize) cloned.layout.paperSize = paperSize;
  if (!cloned.layout.widthMm) cloned.layout.widthMm = Number(widthMm) || inferPrintWidthMm(paperSize, 80);
  if (!cloned.version) cloned.version = 1;
  return cloned;
}

const DEFAULT_PRINT_TEMPLATES = [
  {
    code: 'sale_invoice_80mm',
    name: 'Hóa đơn bán hàng 80mm',
    type: 'sale_invoice',
    paper_size: '80mm',
    width_mm: 80,
    is_default: true,
    html: `
<div class="print-template sale-invoice">
  <div class="store-header">
    <img class="store-logo" src="{{store.invoice_logo}}" alt="Logo cửa hàng" />
    <div class="store-name">{{store.name}}</div>
    <div class="store-meta">{{store.address}}</div>
    <div class="store-meta">ĐT: {{store.phone}} - MST: {{store.tax_code}}</div>
  </div>

  <h1>HÓA ĐƠN BÁN HÀNG</h1>
  <div class="invoice-meta">
    <div>Số: <strong>{{invoice.invoice_code}}</strong></div>
    <div>Ngày: {{invoice.created_at}}</div>
    <div>Khách hàng: {{customer.name}}</div>
    <div>Điện thoại: {{customer.phone}}</div>
  </div>

  <table class="items-table">
    <thead>
      <tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr>
    </thead>
    <tbody>
      {{#items}}
      <tr>
        <td class="product-cell"><img class="product-image" src="{{image_url}}" alt="{{name}}" /><span>{{name}}</span></td>
        <td class="text-center">{{quantity}}</td>
        <td class="text-right">{{price}}</td>
        <td class="text-right">{{line_total}}</td>
      </tr>
      {{/items}}
    </tbody>
  </table>

  <div class="totals">
    <div><span>Tạm tính</span><strong>{{invoice.subtotal}}</strong></div>
    <div><span>Giảm giá</span><strong>{{invoice.discount}}</strong></div>
    <div><span>Hình thức TT</span><strong>{{invoice.payment_method}}</strong></div>
    <div class="grand-total"><span>Tổng cộng</span><strong>{{invoice.total}}</strong></div>
    <div><span>Tiền khách đưa</span><strong>{{invoice.paid}}</strong></div>
    <div><span>Tiền thừa</span><strong>{{invoice.change}}</strong></div>
    <div><span>Ghi chú</span><strong>{{invoice.note}}</strong></div>
  </div>

  <div class="payment-qr">
    <img class="qr-image" src="{{invoice.qr_url}}" alt="QR thanh toán" />
    <img class="qr-logo" src="{{store.invoice_vietqr_logo}}" alt="VietQR logo" />
  </div>

  <div class="note">{{store.invoice_note}}</div>
  <div class="footer">{{store.invoice_slogan}}</div>
</div>`,
    css: `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; font-size: 11px; }
.print-template { width: 80mm; min-height: 100%; padding: 4mm; }
.store-header { text-align: center; border-bottom: 1px dashed #999; padding-bottom: 6px; margin-bottom: 8px; }
.store-logo { max-width: 24mm; max-height: 16mm; object-fit: contain; display: block; margin: 0 auto 4px; }
.store-name { font-size: 15px; font-weight: 700; text-transform: uppercase; }
.store-meta { font-size: 10px; line-height: 1.35; }
h1 { margin: 8px 0 6px; text-align: center; font-size: 15px; }
.invoice-meta { line-height: 1.45; margin-bottom: 6px; }
.items-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.items-table th, .items-table td { border-bottom: 1px dashed #ddd; padding: 4px 2px; vertical-align: top; }
.items-table th { font-size: 10px; text-align: left; }
.product-cell { display: flex; gap: 4px; align-items: center; }
.product-image { width: 10mm; height: 10mm; object-fit: cover; border-radius: 2px; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.totals { margin-top: 8px; border-top: 1px dashed #999; padding-top: 6px; }
.totals div { display: flex; justify-content: space-between; margin: 2px 0; }
.grand-total { font-size: 13px; font-weight: 700; }
.payment-qr { text-align: center; margin: 8px 0; }
.qr-image { width: 28mm; height: 28mm; object-fit: contain; }
.qr-logo { max-width: 32mm; max-height: 8mm; object-fit: contain; display: block; margin: 2px auto 0; }
.note, .footer { text-align: center; font-size: 10px; margin-top: 6px; }
@media print { body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`,
    config: createDefaultSaleInvoiceVisualConfig('80mm', 80),
  },
  {
    code: 'temporary_bill_80mm',
    name: 'Phiếu tạm tính 80mm',
    type: 'temporary_bill',
    paper_size: '80mm',
    width_mm: 80,
    is_default: true,
    html: `
<div class="print-template temporary-bill">
  <div class="store-header">
    <div class="store-name">{{store.name}}</div>
    <div class="store-meta">{{store.address}}</div>
    <div class="store-meta">ĐT: {{store.phone}}</div>
  </div>

  <h1>PHIẾU TẠM TÍNH</h1>
  <div class="invoice-meta">
    <div>Mã phiếu: <strong>{{invoice.invoice_code}}</strong></div>
    <div>Ngày: {{invoice.created_at}}</div>
    <div>Khách hàng: {{customer.name}}</div>
  </div>

  <table class="items-table">
    <thead>
      <tr><th>Mặt hàng</th><th>SL</th><th>Giá</th><th>Tiền</th></tr>
    </thead>
    <tbody>
      {{#items}}
      <tr>
        <td class="product-cell"><img class="product-image" src="{{image_url}}" alt="{{name}}" /><span>{{name}}</span></td>
        <td class="text-center">{{quantity}}</td>
        <td class="text-right">{{price}}</td>
        <td class="text-right">{{line_total}}</td>
      </tr>
      {{/items}}
    </tbody>
  </table>

  <div class="totals">
    <div><span>Tổng tạm tính</span><strong>{{invoice.total}}</strong></div>
  </div>
  <div class="note">Phiếu chưa phải hóa đơn thanh toán</div>
</div>`,
    css: `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; font-size: 11px; }
.print-template { width: 80mm; padding: 4mm; }
.store-header { text-align: center; border-bottom: 1px dashed #999; padding-bottom: 6px; margin-bottom: 8px; }
.store-name { font-size: 15px; font-weight: 700; text-transform: uppercase; }
.store-meta { font-size: 10px; line-height: 1.35; }
h1 { margin: 8px 0 6px; text-align: center; font-size: 15px; }
.invoice-meta { line-height: 1.45; margin-bottom: 6px; }
.items-table { width: 100%; border-collapse: collapse; }
.items-table th, .items-table td { border-bottom: 1px dashed #ddd; padding: 4px 2px; vertical-align: top; }
.product-cell { display: flex; gap: 4px; align-items: center; }
.product-image { width: 10mm; height: 10mm; object-fit: cover; border-radius: 2px; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.totals { margin-top: 8px; border-top: 1px dashed #999; padding-top: 6px; }
.totals div { display: flex; justify-content: space-between; font-size: 13px; }
.note { text-align: center; font-style: italic; font-size: 10px; margin-top: 8px; }
@media print { body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`,
  },
  {
    code: 'return_invoice_a5',
    name: 'Phiếu trả hàng A5',
    type: 'return_invoice',
    paper_size: 'A5',
    width_mm: 148,
    is_default: true,
    html: `
<div class="print-template return-invoice">
  <div class="store-header">
    <img class="store-logo" src="{{store.invoice_logo}}" alt="Logo cửa hàng" />
    <div>
      <div class="store-name">{{store.name}}</div>
      <div class="store-meta">{{store.address}}</div>
      <div class="store-meta">ĐT: {{store.phone}} - MST: {{store.tax_code}}</div>
    </div>
  </div>

  <h1>PHIẾU TRẢ HÀNG</h1>
  <div class="invoice-meta two-cols">
    <div>Số phiếu: <strong>{{return.return_code}}</strong></div>
    <div>Ngày: {{return.created_at}}</div>
    <div>Khách hàng/NCC: {{partner.name}}</div>
    <div>Điện thoại: {{partner.phone}}</div>
  </div>

  <table class="items-table">
    <thead>
      <tr><th>Sản phẩm</th><th>SL trả</th><th>Đơn giá</th><th>Thành tiền</th><th>Lý do</th></tr>
    </thead>
    <tbody>
      {{#items}}
      <tr>
        <td class="product-cell"><img class="product-image" src="{{image_url}}" alt="{{name}}" /><span>{{name}}</span></td>
        <td class="text-center">{{quantity}}</td>
        <td class="text-right">{{price}}</td>
        <td class="text-right">{{line_total}}</td>
        <td>{{reason}}</td>
      </tr>
      {{/items}}
    </tbody>
  </table>

  <div class="totals">
    <div><span>Tổng tiền hoàn/trừ</span><strong>{{return.total}}</strong></div>
  </div>

  <div class="signatures">
    <div><strong>Người lập phiếu</strong><span>Ký, ghi rõ họ tên</span></div>
    <div><strong>Người nhận</strong><span>Ký, ghi rõ họ tên</span></div>
  </div>
</div>`,
    css: `
@page { size: A5; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; font-size: 12px; }
.print-template { width: 148mm; padding: 0; }
.store-header { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 10px; }
.store-logo { width: 22mm; height: 18mm; object-fit: contain; }
.store-name { font-size: 18px; font-weight: 700; text-transform: uppercase; }
.store-meta { font-size: 11px; line-height: 1.4; }
h1 { margin: 10px 0; text-align: center; font-size: 18px; }
.two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 10px; }
.items-table { width: 100%; border-collapse: collapse; }
.items-table th, .items-table td { border: 1px solid #ddd; padding: 6px; vertical-align: top; }
.items-table th { background: #f5f5f5; }
.product-cell { display: flex; gap: 6px; align-items: center; }
.product-image { width: 12mm; height: 12mm; object-fit: cover; border-radius: 2px; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.totals { margin-top: 10px; display: flex; justify-content: flex-end; }
.totals div { min-width: 55mm; display: flex; justify-content: space-between; font-size: 14px; }
.signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 30mm; margin-top: 18mm; text-align: center; }
.signatures span { display: block; margin-top: 4px; font-size: 11px; color: #555; }
@media print { body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }`,
  },
];

function seedDefaultPrintTemplates() {
  if (!Array.isArray(db.print_templates)) db.print_templates = [];
  if (!nextId.print_templates) nextId.print_templates = 1;
  if (db.print_templates.length > 0) return false;

  const time = now();
  for (const template of DEFAULT_PRINT_TEMPLATES) {
    db.print_templates.push({
      id: nextId.print_templates++,
      code: template.code,
      name: template.name,
      type: template.type,
      paper_size: template.paper_size,
      width_mm: template.width_mm,
      html: template.html.trim(),
      css: template.css.trim(),
      config: clonePrintTemplateConfig(template.config),
      is_default: template.is_default === true,
      active: true,
      created_at: time,
      updated_at: time,
    });
  }
  return true;
}

function findCategoryByText(text) {
  const key = normalizeTextKey(text);
  if (!key) return null;
  return (db.product_categories || []).find(c => {
    if (!c || c.active === 0) return false;
    const values = [c.name, c.group_name, c.group_key, ...parseList(c.keywords), ...parseList(c.aliases)];
    return values.some(v => normalizeTextKey(v) === key || key.includes(normalizeTextKey(v)) || normalizeTextKey(v).includes(key));
  }) || null;
}

function seedDefaultProductCategories() {
  if (!Array.isArray(db.product_categories)) db.product_categories = [];
  if (db.product_categories.length > 0) return false;

  const time = now();
  for (const category of DEFAULT_PRODUCT_CATEGORIES) {
    db.product_categories.push({
      id: nextId.product_categories++,
      name: category.name,
      group_name: category.group_name,
      group_key: normalizeGroupKey(category.group_name),
      keywords: category.keywords,
      aliases: category.aliases,
      active: 1,
      created_at: time,
      updated_at: time,
    });
  }
  return true;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function ensureField(row, field, valueFactory) {
  if (!row || typeof row !== 'object' || hasOwn(row, field)) return false;
  row[field] = typeof valueFactory === 'function' ? valueFactory(row) : valueFactory;
  return true;
}

function ensureSapoMetadataSchema() {
  let changed = false;

  const productDefaults = {
    barcode: '',
    image_url: '',
    description: '',
    option1: '',
    option2: '',
    option3: '',
    sapo_product_id: '',
    sapo_variant_id: '',
    sapo_parent_product_id: '',
    sapo_status: '',
    sapo_updated_at: '',
    sapo_last_synced_at: '',
    sync_source: '',
  };
  for (const product of db.products || []) {
    for (const [field, defaultValue] of Object.entries(productDefaults)) {
      if (ensureField(product, field, defaultValue)) changed = true;
    }
  }

  const customerDefaults = {
    sapo_customer_id: '',
    customer_code: '',
    address: '',
    sapo_updated_at: '',
    sapo_last_synced_at: '',
    sync_source: '',
  };
  for (const customer of db.customers || []) {
    for (const [field, defaultValue] of Object.entries(customerDefaults)) {
      if (ensureField(customer, field, defaultValue)) changed = true;
    }
  }

  const invoiceDefaults = {
    sapo_order_id: '',
    sapo_order_number: '',
    sapo_customer_id: '',
    sapo_status: '',
    sapo_payment_status: '',
    sapo_fulfillment_status: '',
    sapo_updated_at: '',
    sapo_last_synced_at: '',
    sync_source: '',
  };
  for (const invoice of db.invoices || []) {
    for (const [field, defaultValue] of Object.entries(invoiceDefaults)) {
      if (ensureField(invoice, field, defaultValue)) changed = true;
    }
  }

  const invoiceDetailDefaults = {
    sapo_line_item_id: '',
    sapo_order_id: '',
    sapo_product_id: '',
    sapo_variant_id: '',
    sapo_sku: '',
    sapo_barcode: '',
  };
  for (const detail of db.invoice_details || []) {
    for (const [field, defaultValue] of Object.entries(invoiceDetailDefaults)) {
      if (ensureField(detail, field, defaultValue)) changed = true;
    }
  }

  const runDefaults = {
    resource: '',
    resources: () => [],
    mode: '',
    phase: '',
    progress_json: '{}',
    summary_json: row => JSON.stringify(row.summary || {}),
    warnings_json: row => JSON.stringify(row.warnings || []),
    errors_json: row => JSON.stringify(row.errors || []),
  };
  for (const run of db.sapo_sync_runs || []) {
    for (const [field, defaultValue] of Object.entries(runDefaults)) {
      if (ensureField(run, field, defaultValue)) changed = true;
    }
  }

  return changed;
}

function normalizeRoleValue(role) {
  const value = String(role || '').trim().toLowerCase();
  return value === 'admin' ? 'admin' : 'user';
}

function getDefaultAccount() {
  return (db.accounts || []).find(account => account && account.slug === DEFAULT_ACCOUNT_SLUG && account.active !== 0)
    || (db.accounts || []).find(account => account && account.active !== 0)
    || null;
}

function ensureDefaultAccount() {
  let changed = false;
  if (!Array.isArray(db.accounts)) {
    db.accounts = [];
    changed = true;
  }
  if (!nextId.accounts) nextId.accounts = 1;

  let account = getDefaultAccount();
  const time = now();
  if (!account) {
    const store = Array.isArray(db.store_info) ? db.store_info[0] : null;
    account = {
      id: nextId.accounts++,
      slug: DEFAULT_ACCOUNT_SLUG,
      name: (store && store.name) ? store.name : 'Tài khoản mặc định',
      plan: 'local-server',
      active: 1,
      created_at: time,
      updated_at: time,
      server_updated_at: time,
    };
    db.accounts.push(account);
    changed = true;
  } else {
    if (!account.slug) { account.slug = DEFAULT_ACCOUNT_SLUG; changed = true; }
    if (!account.name) { account.name = 'Tài khoản mặc định'; changed = true; }
    if (account.active === undefined) { account.active = 1; changed = true; }
    if (!account.created_at) { account.created_at = time; changed = true; }
    if (!account.updated_at) { account.updated_at = account.created_at || time; changed = true; }
    if (!account.server_updated_at) { account.server_updated_at = account.updated_at || time; changed = true; }
  }

  return { account, changed };
}

function seedDefaultPermissions() {
  let changed = false;
  if (!Array.isArray(db.permissions)) {
    db.permissions = [];
    changed = true;
  }
  if (!nextId.permissions) nextId.permissions = 1;

  const byKey = new Map(db.permissions.filter(permission => permission && permission.key).map(permission => [permission.key, permission]));
  const time = now();
  for (const [key, name, description] of DEFAULT_PERMISSIONS) {
    let permission = byKey.get(key);
    if (!permission) {
      permission = {
        id: nextId.permissions++,
        key,
        name,
        description,
        category: key.split('.')[0],
        active: 1,
        created_at: time,
        updated_at: time,
      };
      db.permissions.push(permission);
      byKey.set(key, permission);
      changed = true;
      continue;
    }
    if (permission.name !== name) { permission.name = name; changed = true; }
    if (permission.description !== description) { permission.description = description; changed = true; }
    if (!permission.category) { permission.category = key.split('.')[0]; changed = true; }
    if (permission.active === undefined) { permission.active = 1; changed = true; }
    if (!permission.created_at) { permission.created_at = time; changed = true; }
    if (!permission.updated_at) { permission.updated_at = time; changed = true; }
  }
  return changed;
}

function seedDefaultRolePermissions() {
  let changed = false;
  if (!Array.isArray(db.role_permissions)) {
    db.role_permissions = [];
    changed = true;
  }
  if (!nextId.role_permissions) nextId.role_permissions = 1;

  const allPermissionKeys = DEFAULT_PERMISSIONS.map(([key]) => key);
  const rolePermissionMap = {
    admin: allPermissionKeys,
    user: DEFAULT_USER_PERMISSION_KEYS,
  };
  const time = now();

  for (const [role, permissionKeys] of Object.entries(rolePermissionMap)) {
    for (const permission_key of permissionKeys) {
      let row = db.role_permissions.find(item => item && item.role === role && item.permission_key === permission_key);
      if (!row) {
        row = {
          id: nextId.role_permissions++,
          role,
          permission_key,
          active: 1,
          created_at: time,
          updated_at: time,
        };
        db.role_permissions.push(row);
        changed = true;
      } else {
        if (row.active === undefined) { row.active = 1; changed = true; }
        if (!row.created_at) { row.created_at = time; changed = true; }
        if (!row.updated_at) { row.updated_at = time; changed = true; }
      }
    }
  }

  return changed;
}

function normalizeAccountScopedRows(defaultAccountId) {
  let changed = false;
  const time = now();

  for (const table of ACCOUNT_SCOPED_TABLES) {
    if (!Array.isArray(db[table])) {
      db[table] = [];
      changed = true;
    }

    for (const row of db[table]) {
      if (!row || typeof row !== 'object') continue;
      if (row.account_id === undefined || row.account_id === null || row.account_id === '') {
        row.account_id = defaultAccountId;
        changed = true;
      }
      if (!hasOwn(row, 'sync_version')) {
        row.sync_version = 1;
        changed = true;
      } else {
        const version = Math.max(1, normalizeNumber(row.sync_version, 1));
        if (row.sync_version !== version) { row.sync_version = version; changed = true; }
      }
      if (!row.server_updated_at) {
        row.server_updated_at = row.updated_at || row.created_at || time;
        changed = true;
      }
      if (!row.created_at) {
        row.created_at = row.server_updated_at || time;
        changed = true;
      }
      if (!row.updated_at) {
        row.updated_at = row.server_updated_at || row.created_at || time;
        changed = true;
      }
    }
  }

  return changed;
}

function ensureSyncMetadataForAccounts() {
  let changed = false;
  if (!Array.isArray(db.sync_metadata)) {
    db.sync_metadata = [];
    changed = true;
  }
  if (!nextId.sync_metadata) nextId.sync_metadata = 1;

  const accounts = Array.isArray(db.accounts) && db.accounts.length > 0 ? db.accounts : [getDefaultAccount()].filter(Boolean);
  const time = now();
  for (const account of accounts) {
    if (!account || account.active === 0) continue;
    for (const table_name of SYNC_TRACKED_TABLES) {
      const rows = Array.isArray(db[table_name]) ? db[table_name].filter(row => row && row.account_id === account.id) : [];
      const maxVersion = Math.max(1, ...rows.map(row => normalizeNumber(row.sync_version, 1)));
      let meta = db.sync_metadata.find(row => row && row.account_id === account.id && row.table_name === table_name);
      if (!meta) {
        meta = {
          id: nextId.sync_metadata++,
          account_id: account.id,
          table_name,
          version: maxVersion,
          row_count: rows.length,
          updated_at: time,
          server_updated_at: time,
          created_at: time,
          sync_version: maxVersion,
        };
        db.sync_metadata.push(meta);
        changed = true;
      } else {
        const version = Math.max(normalizeNumber(meta.version, 1), maxVersion);
        if (meta.version !== version) { meta.version = version; changed = true; }
        if (meta.row_count !== rows.length) { meta.row_count = rows.length; changed = true; }
        if (!meta.updated_at) { meta.updated_at = time; changed = true; }
        if (!meta.server_updated_at) { meta.server_updated_at = meta.updated_at || time; changed = true; }
        if (!meta.created_at) { meta.created_at = meta.updated_at || time; changed = true; }
        if (!meta.sync_version) { meta.sync_version = version; changed = true; }
      }
    }
  }

  return changed;
}

function ensureAuthAndSyncSchema() {
  let changed = false;
  const result = ensureDefaultAccount();
  const defaultAccount = result.account;
  if (result.changed) changed = true;
  if (seedDefaultPermissions()) changed = true;
  if (seedDefaultRolePermissions()) changed = true;
  if (normalizeAccountScopedRows(defaultAccount.id)) changed = true;
  if (ensureSyncMetadataForAccounts()) changed = true;
  return changed;
}

function normalizeDBData() {
  let changed = false;

  if (!nextId.print_templates) {
    nextId.print_templates = 1;
    changed = true;
  }

  for (const table of Object.keys(SCHEMA)) {
    if (!Array.isArray(db[table])) {
      db[table] = [];
      changed = true;
    }
  }

  if (ensureAuthAndSyncSchema()) changed = true;
  if (ensureSapoMetadataSchema()) changed = true;

  for (const category of db.product_categories) {
    if (!category.name) { category.name = 'Danh mục'; changed = true; }
    if (!category.group_name) { category.group_name = category.name; changed = true; }
    const groupKey = normalizeGroupKey(category.group_key || category.group_name || category.name);
    if (category.group_key !== groupKey) { category.group_key = groupKey; changed = true; }
    if (!Array.isArray(category.keywords)) { category.keywords = parseList(category.keywords); changed = true; }
    if (!Array.isArray(category.aliases)) { category.aliases = parseList(category.aliases); changed = true; }
    if (category.active === undefined) { category.active = 1; changed = true; }
    if (!category.created_at) { category.created_at = now(); changed = true; }
    if (!category.updated_at) { category.updated_at = now(); changed = true; }
  }

  for (const template of db.print_templates) {
    const templateType = String(template.type || 'sale_invoice').trim();
    const paperSize = String(template.paper_size || '80mm').trim();
    const normalizedWidth = inferPrintWidthMm(paperSize, 80);
    if (!template.code) { template.code = `${templateType}_${paperSize}_${template.id || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); changed = true; }
    if (!template.name) { template.name = 'Mẫu in'; changed = true; }
    if (template.type !== templateType) { template.type = templateType; changed = true; }
    if (template.paper_size !== paperSize) { template.paper_size = paperSize; changed = true; }
    if (template.width_mm === undefined || template.width_mm === null || template.width_mm === '' || Number.isNaN(Number(template.width_mm))) { template.width_mm = normalizedWidth; changed = true; }
    if (template.html === undefined || template.html === null) { template.html = ''; changed = true; }
    if (template.css === undefined || template.css === null) { template.css = ''; changed = true; }
    const isSeededSaleInvoiceDefault = template.code === 'sale_invoice_80mm';
    const defaultConfig = isSeededSaleInvoiceDefault ? createDefaultSaleInvoiceVisualConfig(paperSize, template.width_mm || normalizedWidth) : null;
    const normalizedConfig = normalizePrintTemplateConfig(template.config, paperSize, template.width_mm || normalizedWidth) || defaultConfig;
    if (JSON.stringify(template.config === undefined ? null : template.config) !== JSON.stringify(normalizedConfig)) { template.config = normalizedConfig; changed = true; }
    if (template.is_default === undefined) { template.is_default = false; changed = true; }
    if (template.active === undefined) { template.active = true; changed = true; }
    if (!template.created_at) { template.created_at = now(); changed = true; }
    if (!template.updated_at) { template.updated_at = template.created_at; changed = true; }
  }

  const productNumberFields = ['import_price', 'wholesale_price', 'retail_price', 'vip_price', 'stock'];
  for (const product of db.products) {
    for (const field of productNumberFields) {
      if (product[field] === null || product[field] === undefined || product[field] === '' || Number.isNaN(Number(product[field]))) {
        product[field] = 0;
        changed = true;
      }
    }
    if (product.active === undefined) { product.active = 1; changed = true; }
    if (product.parent_id === undefined) { product.parent_id = null; changed = true; }
    if (!product.unit) { product.unit = 'cái'; changed = true; }
    if (!product.hasOwnProperty('default_category_id')) { product.default_category_id = null; changed = true; }
  }

  for (const stat of db.daily_stats) {
    for (const field of ['total_revenue', 'total_orders', 'total_profit']) {
      if (stat[field] === null || stat[field] === undefined || Number.isNaN(Number(stat[field]))) {
        stat[field] = 0;
        changed = true;
      }
    }
  }

  for (const invoice of db.invoices) {
    const normalizedPayment = normalizePaymentMethod(invoice.payment_method);
    if (invoice.payment_method !== normalizedPayment) {
      invoice.payment_method = normalizedPayment;
      changed = true;
    }
    for (const field of ['paid_amount', 'change_amount', 'remaining_amount', 'delivery_fee']) {
      const normalized = normalizeNumber(invoice[field], 0);
      if (invoice[field] !== normalized) {
        invoice[field] = normalized;
        changed = true;
      }
    }
  }

  const currentDate = new Date();
  const payrollNumberFields = ['daily_wage', 'working_days', 'leave_days', 'advance_amount', 'overtime_amount', 'extra_bonus', 'holiday_bonus', 'tet_bonus'];
  for (const payroll of db.payrolls) {
    if (!payroll.employee_name) { payroll.employee_name = 'Nhân viên'; changed = true; }
    if (payroll.employee_phone === undefined) { payroll.employee_phone = ''; changed = true; }
    if (payroll.note === undefined) { payroll.note = ''; changed = true; }
    for (const field of payrollNumberFields) {
      const normalized = Math.max(0, normalizeNumber(payroll[field], 0));
      if (payroll[field] !== normalized) { payroll[field] = normalized; changed = true; }
    }
    const month = Number.parseInt(payroll.month, 10);
    const safeMonth = month >= 1 && month <= 12 ? month : currentDate.getMonth() + 1;
    if (payroll.month !== safeMonth) { payroll.month = safeMonth; changed = true; }
    const year = Number.parseInt(payroll.year, 10);
    const safeYear = year >= 1900 && year <= 3000 ? year : currentDate.getFullYear();
    if (payroll.year !== safeYear) { payroll.year = safeYear; changed = true; }
    const salaryMonth = payroll.daily_wage * payroll.working_days;
    const totalIncome = salaryMonth + payroll.extra_bonus + payroll.overtime_amount;
    const netSalary = totalIncome - payroll.advance_amount;
    if (payroll.salary_month !== salaryMonth) { payroll.salary_month = salaryMonth; changed = true; }
    if (payroll.total_income !== totalIncome) { payroll.total_income = totalIncome; changed = true; }
    if (payroll.net_salary !== netSalary) { payroll.net_salary = netSalary; changed = true; }
    if (payroll.active === undefined) { payroll.active = 1; changed = true; }
    if (!payroll.created_at) { payroll.created_at = now(); changed = true; }
    if (!payroll.updated_at) { payroll.updated_at = payroll.created_at; changed = true; }
  }

  for (const importLog of db.import_logs) {
    const total = normalizeNumber(importLog.total, 0);
    const rawStatus = String(importLog.status || '').trim().toLowerCase();
    const normalizedStatus = ['draft', 'pending', 'created', 'cho_nhap', 'temporary'].includes(rawStatus)
      ? 'draft'
      : (['cancelled', 'canceled', 'da_huy'].includes(rawStatus) ? 'cancelled' : 'received');
    if (importLog.status !== normalizedStatus) { importLog.status = normalizedStatus; changed = true; }

    const rawPaymentStatus = String(importLog.payment_status || '').trim().toLowerCase();
    const normalizedPaymentStatus = ['paid', 'da_thanh_toan', 'đã thanh toán', 'da thanh toan'].includes(rawPaymentStatus) ? 'paid' : 'unpaid';
    if (importLog.payment_status !== normalizedPaymentStatus) { importLog.payment_status = normalizedPaymentStatus; changed = true; }

    const paidAmount = normalizedPaymentStatus === 'paid' ? total : normalizeNumber(importLog.paid_amount, 0);
    const remainingAmount = normalizedPaymentStatus === 'paid' ? 0 : Math.max(0, total - paidAmount);
    if (importLog.paid_amount !== paidAmount) { importLog.paid_amount = paidAmount; changed = true; }
    if (importLog.remaining_amount !== remainingAmount) { importLog.remaining_amount = remainingAmount; changed = true; }

    if (importLog.stock_applied === undefined) {
      importLog.stock_applied = normalizedStatus === 'received';
      changed = true;
    }
    if (importLog.stock_rolled_back === undefined) {
      importLog.stock_rolled_back = normalizedStatus === 'cancelled' && importLog.stock_applied === true;
      changed = true;
    }
    if (!importLog.stock_status) {
      importLog.stock_status = importLog.stock_applied
        ? (importLog.stock_rolled_back ? 'rolled_back' : 'imported')
        : (normalizedStatus === 'cancelled' ? 'cancelled_no_stock' : 'not_imported');
      changed = true;
    }
    if (!importLog.hasOwnProperty('stock_updated_at')) { importLog.stock_updated_at = importLog.stock_applied ? (importLog.updated_at || importLog.created_at || now()) : null; changed = true; }
    if (!importLog.hasOwnProperty('stock_rolled_back_at')) { importLog.stock_rolled_back_at = importLog.stock_rolled_back ? (importLog.cancelled_at || importLog.updated_at || now()) : null; changed = true; }
    if (!importLog.created_at) { importLog.created_at = now(); changed = true; }
    if (!importLog.updated_at) { importLog.updated_at = importLog.created_at; changed = true; }
  }

  return changed;
}

function migrateDB() {
  let migrated = normalizeDBData();

  // Seed default customer_types if missing
  if (db.customer_types.length === 0) {
    db.customer_types.push(
      { id: nextId.customer_types++, name: 'Khách lẻ', color: '#6b7280', active: 1 },
      { id: nextId.customer_types++, name: 'Khách sỉ', color: '#f59e0b', active: 1 },
      { id: nextId.customer_types++, name: 'VIP', color: '#8b5cf6', active: 1 },
    );
    migrated = true;
  }

  if (seedDefaultProductCategories()) migrated = true;
  if (seedDefaultPrintTemplates()) migrated = true;

  // Ensure minimum base data exists for fresh DBs
  const beforeBase = JSON.stringify({ store_info: db.store_info, customers: db.customers, customer_types: db.customer_types, product_categories: db.product_categories });
  ensureBaseData();
  if (beforeBase !== JSON.stringify({ store_info: db.store_info, customers: db.customers, customer_types: db.customer_types, product_categories: db.product_categories })) migrated = true;

  if (db.products && db.products.length > 0) {
    for (const product of db.products) {
      if (!product.default_category_id && product.category) {
        const matchedCategory = findCategoryByText(product.category);
        if (matchedCategory) {
          product.default_category_id = matchedCategory.id;
          migrated = true;
        }
      }
    }

    const byId = new Map(db.products.map(p => [p.id, p]));
    for (const product of db.products) {
      if (product.parent_id && !product.default_category_id) {
        const parent = byId.get(product.parent_id);
        if (parent && parent.default_category_id) {
          product.default_category_id = parent.default_category_id;
          migrated = true;
        }
      }
    }
  }

  // Migrate old users (with pin/plain password) to new schema and hashed password storage
  if (db.users && db.users.length > 0) {
    const needsMigrate = db.users.some(u => !u.email || !u.password || !isPasswordHash(u.password));
    if (needsMigrate) {
      db.users = db.users.map(u => {
        const rawPassword = u.password || u.pin || '123456';
        return {
          ...u,
          email: u.email || `${(u.name || 'user').toLowerCase().replace(/\s+/g, '')}@example.com`,
          password: isPasswordHash(rawPassword) ? rawPassword : hashPassword(rawPassword),
          role: u.role || 'user',
          approved: 1,
          active: u.active !== undefined ? u.active : 1,
          session_token: null,
        };
      });
      migrated = true;
    } else {
      const normalizedUsers = db.users.map(u => ({
        ...u,
        role: normalizeRoleValue(u.role),
        approved: 1,
        active: u.active !== undefined ? u.active : 1,
        session_token: null,
      }));
      if (JSON.stringify(normalizedUsers) !== JSON.stringify(db.users)) {
        db.users = normalizedUsers;
        migrated = true;
      }
    }
  }

  if (db.partners && db.partners.some(p => p.active === undefined)) {
    db.partners = db.partners.map(p => ({ ...p, active: p.active !== undefined ? p.active : 1 }));
    migrated = true;
  }

  if (db.partners && db.partners.some(p => p.invoice_type === undefined)) {
    db.partners = db.partners.map(p => ({ ...p, invoice_type: p.invoice_type || 'non_electronic' }));
    migrated = true;
  }

  if (db.customers && db.customers.some(c => c.invoice_type === undefined)) {
    db.customers = db.customers.map(c => ({ ...c, invoice_type: c.invoice_type || 'non_electronic' }));
    migrated = true;
  }

  if (db.store_info && db.store_info[0]) {
    const s = db.store_info[0];
    const storeDefaults = {};
    if (!s.hasOwnProperty('invoice_width')) storeDefaults.invoice_width = '80';
    if (!s.hasOwnProperty('invoice_logo')) storeDefaults.invoice_logo = '';
    if (!s.hasOwnProperty('invoice_slogan')) storeDefaults.invoice_slogan = '';
    if (!s.hasOwnProperty('invoice_note')) storeDefaults.invoice_note = '';
    if (!s.hasOwnProperty('invoice_vietqr_logo')) storeDefaults.invoice_vietqr_logo = '';
    if (Object.keys(storeDefaults).length > 0) {
      db.store_info[0] = { ...s, ...storeDefaults };
      migrated = true;
    }
  }

  if (db.products && db.products.some(p => !p.hasOwnProperty('supplier_id'))) {
    db.products = db.products.map(p => ({ ...p, supplier_id: p.supplier_id || null }));
    migrated = true;
  }

  if (db.invoice_details && db.invoice_details.some(d => d.import_price === undefined)) {
    db.invoice_details = db.invoice_details.map(d => ({ ...d, import_price: d.import_price || 0 }));
    migrated = true;
  }

  if (ensureAuthAndSyncSchema()) migrated = true;
  if (ensureSapoMetadataSchema()) migrated = true;

  if (migrated) {
    saveDB();
    console.log('[KHA] DB migrated/normalized');
  }
}

function saveDB() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function getRequestContext() {
  return requestContext.getStore() || {};
}

function runWithRequestContext(context, fn) {
  return requestContext.run(context || {}, fn);
}

function getActiveAccountId() {
  const context = getRequestContext();
  const contextAccountId = Number(context.accountId || context.account_id);
  if (Number.isFinite(contextAccountId) && contextAccountId > 0) return contextAccountId;
  const account = getDefaultAccount();
  return account ? account.id : null;
}

function isAccountScopedTable(table) {
  return ACCOUNT_SCOPED_TABLES.has(table) || table === 'sessions';
}

function touchSyncMetadata(table, accountId) {
  if (!accountId || !SYNC_TRACKED_TABLES.includes(table)) return;
  if (!Array.isArray(db.sync_metadata)) db.sync_metadata = [];
  if (!nextId.sync_metadata) nextId.sync_metadata = 1;

  const rows = Array.isArray(db[table]) ? db[table].filter(row => row && Number(row.account_id) === Number(accountId)) : [];
  const maxVersion = Math.max(1, ...rows.map(row => normalizeNumber(row.sync_version, 1)));
  const time = now();
  let meta = db.sync_metadata.find(row => row && Number(row.account_id) === Number(accountId) && row.table_name === table);
  if (!meta) {
    meta = {
      id: nextId.sync_metadata++,
      account_id: accountId,
      table_name: table,
      version: maxVersion,
      row_count: rows.length,
      created_at: time,
      updated_at: time,
      server_updated_at: time,
      sync_version: maxVersion,
    };
    db.sync_metadata.push(meta);
    return;
  }

  meta.version = Math.max(normalizeNumber(meta.version, 1) + 1, maxVersion);
  meta.row_count = rows.length;
  meta.updated_at = time;
  meta.server_updated_at = time;
  meta.sync_version = Math.max(normalizeNumber(meta.sync_version, 1) + 1, meta.version);
}

function normalizeInsertRow(table, row = {}) {
  const record = { ...row };
  const time = now();

  if (isAccountScopedTable(table)) {
    const context = getRequestContext();
    const contextAccountId = Number(context.accountId || context.account_id);
    const accountId = Number.isFinite(contextAccountId) && contextAccountId > 0
      ? contextAccountId
      : (record.account_id || getActiveAccountId());
    if (accountId) record.account_id = accountId;
  }

  if (isAccountScopedTable(table)) {
    if (!record.created_at) record.created_at = time;
    if (!record.updated_at) record.updated_at = record.created_at;
    if (!record.server_updated_at) record.server_updated_at = record.updated_at;
    if (!record.sync_version) record.sync_version = 1;
  }

  return record;
}

function normalizeUpdateChanges(table, current, changes = {}) {
  const nextChanges = { ...changes };
  if (!isAccountScopedTable(table)) return nextChanges;

  const time = now();
  const nextVersion = normalizeNumber(current && current.sync_version, 0) + 1;
  nextChanges.updated_at = nextChanges.updated_at || time;
  nextChanges.server_updated_at = time;
  nextChanges.sync_version = Math.max(normalizeNumber(nextChanges.sync_version, nextVersion), nextVersion);

  const context = getRequestContext();
  const contextAccountId = Number(context.accountId || context.account_id);
  if (Number.isFinite(contextAccountId) && contextAccountId > 0) {
    nextChanges.account_id = contextAccountId;
  } else if (current && current.account_id !== undefined) {
    nextChanges.account_id = current.account_id;
  }

  return nextChanges;
}

function isRowVisibleForCurrentScope(table, row) {
  if (!isAccountScopedTable(table)) return true;
  const context = getRequestContext();
  if (context.skipAccountScope) return true;
  const accountId = getActiveAccountId();
  if (!accountId) return true;
  return row && (row.account_id === undefined || row.account_id === null || Number(row.account_id) === Number(accountId));
}

function replaceTable(table, rows, options = {}) {
  if (!Array.isArray(rows)) throw new Error(`Rows for table "${table}" must be an array`);
  const accountId = options.accountId || getActiveAccountId();
  const normalizedRows = rows.map(row => {
    const nextRow = normalizeInsertRow(table, row);
    if (isAccountScopedTable(table) && accountId && !nextRow.account_id) nextRow.account_id = accountId;
    return nextRow;
  });

  if (isAccountScopedTable(table) && !options.replaceAllAccounts && accountId) {
    const otherRows = Array.isArray(db[table]) ? db[table].filter(row => Number(row.account_id) !== Number(accountId)) : [];
    db[table] = [...otherRows, ...normalizedRows.map(row => ({ ...row, account_id: row.account_id || accountId }))];
  } else {
    db[table] = normalizedRows;
  }

  recalculateNextIds();
  if (isAccountScopedTable(table)) touchSyncMetadata(table, accountId);
  saveDB();
}

function insert(table, row) {
  if (!db[table]) db[table] = [];
  if (!nextId[table]) nextId[table] = 1;
  const id = nextId[table]++;
  const record = { id, ...normalizeInsertRow(table, row) };
  db[table].push(record);
  if (isAccountScopedTable(table)) touchSyncMetadata(table, record.account_id || getActiveAccountId());
  saveDB();
  return id;
}

function update(table, id, changes) {
  if (!db[table]) db[table] = [];
  const idx = db[table].findIndex(r => r.id === id && isRowVisibleForCurrentScope(table, r));
  if (idx >= 0) {
    const nextChanges = normalizeUpdateChanges(table, db[table][idx], changes);
    db[table][idx] = { ...db[table][idx], ...nextChanges };
    if (isAccountScopedTable(table)) touchSyncMetadata(table, db[table][idx].account_id || getActiveAccountId());
    saveDB();
  }
}

function remove(table, id) {
  if (!db[table]) db[table] = [];
  const removedRows = db[table].filter(r => r.id === id && isRowVisibleForCurrentScope(table, r));
  db[table] = db[table].filter(r => !(r.id === id && isRowVisibleForCurrentScope(table, r)));
  const accountId = removedRows[0]?.account_id || getActiveAccountId();
  if (isAccountScopedTable(table)) touchSyncMetadata(table, accountId);
  saveDB();
}

function getAll(table, filter, options = {}) {
  if (!db[table]) db[table] = [];
  let rows = options.skipAccountScope ? db[table] : db[table].filter(row => isRowVisibleForCurrentScope(table, row));
  if (filter) rows = rows.filter(filter);
  return rows;
}

function getOne(table, filter, options = {}) {
  if (!db[table]) db[table] = [];
  const rows = options.skipAccountScope ? db[table] : db[table].filter(row => isRowVisibleForCurrentScope(table, row));
  return rows.find(filter) || null;
}

function getAccountById(accountId) {
  const id = Number(accountId);
  return (db.accounts || []).find(account => Number(account.id) === id && account.active !== 0) || null;
}

function getRolePermissions(role) {
  const normalizedRole = normalizeRoleValue(role);
  return (db.role_permissions || [])
    .filter(row => row && row.role === normalizedRole && row.active !== 0)
    .map(row => row.permission_key)
    .filter(Boolean);
}

function getUserPermissions(user) {
  if (!user) return [];
  const rolePermissions = getRolePermissions(user.role);
  const directPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  return Array.from(new Set([...rolePermissions, ...directPermissions])).sort();
}

function getSyncVersions(accountId = getActiveAccountId()) {
  return (db.sync_metadata || [])
    .filter(row => row && (!accountId || Number(row.account_id) === Number(accountId)))
    .reduce((acc, row) => {
      acc[row.table_name] = {
        version: normalizeNumber(row.version, 1),
        row_count: normalizeNumber(row.row_count, 0),
        updated_at: row.updated_at || row.server_updated_at || null,
      };
      return acc;
    }, {});
}

function auditLog(action, meta = {}) {
  const context = getRequestContext();
  const time = now();
  return insert('audit_logs', {
    action,
    user_id: meta.user_id || context.userId || context.user_id || null,
    account_id: meta.account_id || context.accountId || getActiveAccountId(),
    ip: meta.ip || context.ip || '',
    user_agent: meta.user_agent || context.userAgent || '',
    meta: meta.meta || {},
    created_at: time,
    updated_at: time,
  });
}

function upsertDailyStats(date, revenue) {
  const accountId = getActiveAccountId();
  const idx = db.daily_stats.findIndex(r => r.stat_date === date && (!accountId || Number(r.account_id) === Number(accountId)));
  const time = now();
  if (idx >= 0) {
    const current = db.daily_stats[idx];
    db.daily_stats[idx] = {
      ...current,
      total_revenue: normalizeNumber(current.total_revenue) + normalizeNumber(revenue),
      total_orders: normalizeNumber(current.total_orders) + 1,
      updated_at: time,
      server_updated_at: time,
      sync_version: normalizeNumber(current.sync_version, 1) + 1,
    };
  } else {
    db.daily_stats.push(normalizeInsertRow('daily_stats', { id: nextId.daily_stats++, stat_date: date, total_revenue: normalizeNumber(revenue), total_orders: 1, total_profit: 0 }));
  }
  touchSyncMetadata('daily_stats', accountId);
  saveDB();
}

function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

function getNextSeq(name) {
  const accountId = getActiveAccountId();
  const idx = db.counters.findIndex(c => c.id === name && (!accountId || Number(c.account_id) === Number(accountId)));
  if (idx >= 0) {
    const current = db.counters[idx];
    db.counters[idx] = {
      ...current,
      value: normalizeNumber(current.value) + 1,
      updated_at: now(),
      server_updated_at: now(),
      sync_version: normalizeNumber(current.sync_version, 1) + 1,
    };
  } else {
    db.counters.push(normalizeInsertRow('counters', { id: name, value: 1 }));
  }
  touchSyncMetadata('counters', accountId);
  saveDB();
  return db.counters.find(c => c.id === name && (!accountId || Number(c.account_id) === Number(accountId))).value;
}

function ensureBaseData() {
  if (!db.store_info || db.store_info.length === 0) {
    db.store_info = [{
      id: nextId.store_info++,
      name: '',
      email: '',
      phone: '',
      tax_code: '',
      bank_account: '',
      bank_name: '',
      address: '',
      invoice_width: '80',
      invoice_logo: '',
      invoice_slogan: '',
      invoice_note: '',
      invoice_vietqr_logo: '',
      updated_at: now(),
    }];
  }

  if (seedDefaultProductCategories()) {
    // no-op: caller detects by comparing base data snapshot
  }

  if (!db.customer_types || db.customer_types.length === 0) {
    db.customer_types = [
      { id: nextId.customer_types++, name: 'Khách lẻ', color: '#6b7280', active: 1 },
      { id: nextId.customer_types++, name: 'Khách sỉ', color: '#f59e0b', active: 1 },
      { id: nextId.customer_types++, name: 'VIP', color: '#8b5cf6', active: 1 },
    ];
  }

  if (!db.customers || db.customers.length === 0) {
    db.customers = [{
      id: nextId.customers++,
      name: 'Khách lẻ',
      phone: '',
      email: '',
      tax_code: '',
      customer_type: 'retail',
      invoice_type: 'non_electronic',
      created_at: now(),
      active: 1,
    }];
  }
}

function seedData() {
  ensureBaseData();
  seedDefaultPrintTemplates();
  ensureAuthAndSyncSchema();
  ensureSapoMetadataSchema();
  console.log('[KHA] Base data inserted');
}

module.exports = {
  loadDB,
  saveDB,
  replaceTable,
  insert,
  update,
  remove,
  getAll,
  getOne,
  upsertDailyStats,
  now,
  today,
  db,
  getNextSeq,
  DB_PATH,
  normalizePaymentMethod,
  getDefaultAccount,
  getAccountById,
  getActiveAccountId,
  getRolePermissions,
  getUserPermissions,
  getSyncVersions,
  runWithRequestContext,
  getRequestContext,
  auditLog,
  touchSyncMetadata,
  ACCOUNT_SCOPED_TABLES,
  SYNC_TRACKED_TABLES,
};
