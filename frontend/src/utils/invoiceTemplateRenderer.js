const MM_TO_PX = 3.7795275591;

export const PAPER_SIZE_CONFIG = {
  A4: { label: 'A4', widthMm: 210, minHeightMm: 297, pageSize: 'A4', marginMm: 10 },
  A5: { label: 'A5', widthMm: 148, minHeightMm: 210, pageSize: 'A5', marginMm: 8 },
  K57: { label: 'K57 - 57mm', widthMm: 57, minHeightMm: 160, pageSize: '57mm auto', marginMm: 0 },
  K80: { label: 'K80 - 80mm', widthMm: 80, minHeightMm: 180, pageSize: '80mm auto', marginMm: 0 },
  '80mm': { label: '80mm', widthMm: 80, minHeightMm: 180, pageSize: '80mm auto', marginMm: 0 },
};

const FALLBACK_TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const SAMPLE_LOGO = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80"%3E%3Crect width="160" height="80" rx="12" fill="%232563eb"/%3E%3Ctext x="80" y="47" text-anchor="middle" font-family="Arial" font-size="24" fill="white" font-weight="700"%3E%3C/text%3E%3C/svg%3E';
const SAMPLE_QR = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"%3E%3Crect width="120" height="120" fill="white"/%3E%3Cg fill="%23111"%3E%3Crect x="10" y="10" width="30" height="30"/%3E%3Crect x="17" y="17" width="16" height="16" fill="white"/%3E%3Crect x="80" y="10" width="30" height="30"/%3E%3Crect x="87" y="17" width="16" height="16" fill="white"/%3E%3Crect x="10" y="80" width="30" height="30"/%3E%3Crect x="17" y="87" width="16" height="16" fill="white"/%3E%3Crect x="52" y="14" width="8" height="8"/%3E%3Crect x="64" y="14" width="8" height="8"/%3E%3Crect x="52" y="30" width="20" height="8"/%3E%3Crect x="48" y="48" width="8" height="8"/%3E%3Crect x="60" y="48" width="8" height="8"/%3E%3Crect x="72" y="48" width="8" height="8"/%3E%3Crect x="88" y="52" width="8" height="8"/%3E%3Crect x="100" y="56" width="8" height="8"/%3E%3Crect x="50" y="64" width="18" height="8"/%3E%3Crect x="76" y="68" width="8" height="20"/%3E%3Crect x="92" y="76" width="18" height="8"/%3E%3Crect x="50" y="92" width="8" height="18"/%3E%3Crect x="64" y="96" width="8" height="8"/%3E%3Crect x="82" y="94" width="28" height="16"/%3E%3C/g%3E%3C/svg%3E';
const SAMPLE_PRODUCT_IMAGE = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"%3E%3Crect width="80" height="80" rx="10" fill="%23fef3c7"/%3E%3Ccircle cx="40" cy="30" r="14" fill="%23f59e0b"/%3E%3Cpath d="M18 64c5-16 39-16 44 0" fill="%23d97706"/%3E%3C/svg%3E';

export function formatCurrency(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(number);
}

export function formatNumber(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(number);
}

export function inferPaperWidthMm(paperSize, fallback = 80) {
  const normalized = String(paperSize || '').trim();
  if (PAPER_SIZE_CONFIG[normalized]) return PAPER_SIZE_CONFIG[normalized].widthMm;
  const upper = normalized.toUpperCase();
  if (PAPER_SIZE_CONFIG[upper]) return PAPER_SIZE_CONFIG[upper].widthMm;
  const match = normalized.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return fallback;
  const width = Number(match[1].replace(',', '.'));
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

export function getPaperConfig(paperSize, widthMm) {
  const normalized = String(paperSize || '80mm').trim();
  const upper = normalized.toUpperCase();
  const base = PAPER_SIZE_CONFIG[normalized] || PAPER_SIZE_CONFIG[upper] || PAPER_SIZE_CONFIG['80mm'];
  const inferredWidth = Number(widthMm) > 0 ? Number(widthMm) : inferPaperWidthMm(normalized, base.widthMm);
  if (base === PAPER_SIZE_CONFIG[normalized] || base === PAPER_SIZE_CONFIG[upper]) {
    return { ...base, key: normalized, widthMm: inferredWidth };
  }
  return {
    key: normalized || '80mm',
    label: normalized || '80mm',
    widthMm: inferredWidth,
    minHeightMm: Math.max(140, inferredWidth * 2.2),
    pageSize: `${inferredWidth}mm auto`,
    marginMm: 0,
  };
}

export function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;')
    .replace(/'/g, '\u0026#39;');
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  if (/^javascript:/i.test(compact)) return '';
  return raw;
}

function sanitizeStyleUrl(value) {
  return String(value || '').replace(/url\(([^)]*)\)/gi, (match, inner) => {
    const cleaned = normalizeUrl(inner.replace(/^['"]|['"]$/g, ''));
    return cleaned ? `url("${cleaned.replace(/"/g, '%22')}")` : 'url("")';
  });
}

export function sanitizeCss(css = '') {
  return sanitizeStyleUrl(css)
    .replace(/@import\s+[^;]+;/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

export function sanitizeTemplateHtml(html = '') {
  let output = String(html || '');
  output = output.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  output = output.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
  output = output.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');
  output = output.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '');
  output = output.replace(/(href|src|xlink:href|formaction)\s*=\s*"\s*javascript:[^"]*"/gi, '$1=""');
  output = output.replace(/(href|src|xlink:href|formaction)\s*=\s*'\s*javascript:[^']*'/gi, '$1=""');
  output = output.replace(/(href|src|xlink:href|formaction)\s*=\s*javascript:[^\s>]+/gi, '$1=""');
  output = output.replace(/style\s*=\s*"([^"]*)"/gi, (_, style) => `style="${escapeAttribute(sanitizeCss(style))}"`);
  output = output.replace(/style\s*=\s*'([^']*)'/gi, (_, style) => `style="${escapeAttribute(sanitizeCss(style))}"`);
  return output;
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const result = Array.isArray(base) ? [...base] : { ...base };
  Object.entries(override).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key] && typeof result[key] === 'object' ? result[key] : {}, value);
    } else {
      result[key] = value;
    }
  });
  return result;
}

function getDefaultVisualTitle(type) {
  if (type === 'temporary_bill') return 'PHIẾU TẠM TÍNH';
  if (type === 'return_invoice') return 'PHIẾU TRẢ HÀNG';
  return 'HÓA ĐƠN BÁN HÀNG';
}

function getDefaultVisualTotals(type) {
  if (type === 'temporary_bill') {
    return [
      { key: 'totals.total', label: 'Tổng tạm tính', visible: true, align: 'right', fontSize: 13, bold: true },
      { key: 'invoice.note', label: 'Ghi chú', visible: true, align: 'left', fontSize: 10 },
    ];
  }
  if (type === 'return_invoice') {
    return [
      { key: 'return.total', label: 'Tổng tiền hoàn/trừ', visible: true, align: 'right', fontSize: 13, bold: true },
      { key: 'return.reason', label: 'Lý do', visible: true, align: 'left', fontSize: 10 },
    ];
  }
  return [
    { key: 'totals.subtotal', label: 'Tạm tính', visible: true, align: 'right', fontSize: 11 },
    { key: 'totals.discount', label: 'Giảm giá', visible: true, align: 'right', fontSize: 11 },
    { key: 'totals.delivery_fee', label: 'Phí giao hàng', visible: true, align: 'right', fontSize: 11 },
    { key: 'invoice.payment_method', label: 'Hình thức TT', visible: true, align: 'right', fontSize: 11 },
    { key: 'totals.total', label: 'Tổng tiền', visible: true, align: 'right', fontSize: 13, bold: true },
    { key: 'totals.paid', label: 'Tiền khách đưa', visible: true, align: 'right', fontSize: 11 },
    { key: 'totals.change', label: 'Tiền thừa', visible: true, align: 'right', fontSize: 11 },
    { key: 'totals.remaining', label: 'Còn phải trả', visible: true, align: 'right', fontSize: 11 },
    { key: 'invoice.note', label: 'Ghi chú', visible: true, align: 'left', fontSize: 10 },
  ];
}

function getDefaultVisualInvoiceFields(type) {
  if (type === 'return_invoice') {
    return [
      { key: 'return.code', label: 'Số phiếu', visible: true, align: 'left', fontSize: 11, boldValue: true },
      { key: 'return.created_at', label: 'Ngày giờ', visible: true, align: 'left', fontSize: 11 },
    ];
  }
  return [
    { key: 'invoice.code', label: type === 'temporary_bill' ? 'Mã phiếu' : 'Số hóa đơn', visible: true, align: 'left', fontSize: 11, boldValue: true },
    { key: 'invoice.created_at', label: 'Ngày giờ', visible: true, align: 'left', fontSize: 11 },
    { key: 'invoice.cashier', label: 'Thu ngân', visible: true, align: 'left', fontSize: 11 },
  ];
}

function getDefaultVisualCustomerFields(type) {
  if (type === 'return_invoice') {
    return [
      { key: 'partner.name', label: 'Khách hàng/NCC', visible: true, align: 'left', fontSize: 11 },
      { key: 'partner.phone', label: 'Điện thoại', visible: true, align: 'left', fontSize: 11 },
      { key: 'partner.address', label: 'Địa chỉ', visible: false, align: 'left', fontSize: 11 },
    ];
  }
  return [
    { key: 'customer.name', label: 'Khách hàng', visible: true, align: 'left', fontSize: 11 },
    { key: 'customer.phone', label: 'Điện thoại', visible: true, align: 'left', fontSize: 11 },
    { key: 'customer.address', label: 'Địa chỉ', visible: false, align: 'left', fontSize: 11 },
  ];
}

function getDefaultVisualTableColumns(type) {
  const columns = [
    { key: 'index', label: '#', visible: true, align: 'center', width: '7%' },
    { key: 'name', label: type === 'temporary_bill' ? 'Mặt hàng' : 'Sản phẩm', visible: true, align: 'left', width: '33%' },
    { key: 'unit', label: 'ĐVT', visible: false, align: 'center', width: '10%' },
    { key: 'quantity', label: type === 'return_invoice' ? 'SL trả' : 'SL', visible: true, align: 'center', width: '10%' },
    { key: 'price', label: type === 'temporary_bill' ? 'Giá' : 'Đơn giá', visible: true, align: 'right', width: '18%' },
    { key: 'discount', label: 'Giảm', visible: false, align: 'right', width: '12%' },
    { key: 'line_total', label: type === 'temporary_bill' ? 'Tiền' : 'Thành tiền', visible: true, align: 'right', width: '22%' },
  ];
  if (type === 'return_invoice') columns.push({ key: 'reason', label: 'Lý do', visible: true, align: 'left', width: '20%' });
  return columns;
}

export function cloneInvoiceVisualConfig(config) {
  if (config === undefined || config === null || config === '') return null;
  if (typeof config === 'string') {
    try {
      return cloneInvoiceVisualConfig(JSON.parse(config));
    } catch (_) {
      return null;
    }
  }
  if (typeof config !== 'object' || Array.isArray(config)) return null;
  return JSON.parse(JSON.stringify(config));
}

export function createDefaultInvoiceVisualConfig(type = 'sale_invoice', paperSize = '80mm', widthMm = 80) {
  const paper = getPaperConfig(paperSize, widthMm);
  return {
    version: 1,
    layout: {
      paperSize,
      widthMm: paper.widthMm,
      fontFamily: 'Arial, Helvetica, sans-serif',
      baseFontSize: paper.widthMm <= 90 ? 11 : 12,
      paddingMm: paper.widthMm <= 90 ? 4 : 0,
      borderStyle: paper.widthMm <= 90 ? 'dashed' : 'solid',
    },
    header: {
      visible: true,
      align: 'center',
      showLogo: true,
      logoWidthMm: paper.widthMm <= 90 ? 24 : 28,
      title: getDefaultVisualTitle(type),
      subtitle: '',
      titleFontSize: paper.widthMm <= 90 ? 15 : 18,
      subtitleFontSize: paper.widthMm <= 90 ? 11 : 12,
      fields: [
        { key: 'store.name', label: '', visible: true, align: 'center', fontSize: paper.widthMm <= 90 ? 15 : 18, bold: true, uppercase: true },
        { key: 'store.address', label: 'Địa chỉ', visible: true, align: 'center', fontSize: paper.widthMm <= 90 ? 10 : 11 },
        { key: 'store.phone', label: 'ĐT', visible: true, align: 'center', fontSize: paper.widthMm <= 90 ? 10 : 11 },
        { key: 'store.tax_code', label: 'MST', visible: true, align: 'center', fontSize: paper.widthMm <= 90 ? 10 : 11 },
      ],
    },
    invoiceInfo: {
      visible: true,
      title: '',
      columns: paper.widthMm <= 90 ? 1 : 2,
      fontSize: paper.widthMm <= 90 ? 11 : 12,
      fields: getDefaultVisualInvoiceFields(type),
    },
    customerInfo: {
      visible: true,
      title: '',
      columns: paper.widthMm <= 90 ? 1 : 2,
      fontSize: paper.widthMm <= 90 ? 11 : 12,
      fields: getDefaultVisualCustomerFields(type),
    },
    table: {
      visible: true,
      fontSize: paper.widthMm <= 90 ? 10 : 12,
      headerFontSize: paper.widthMm <= 90 ? 10 : 12,
      showSku: true,
      columns: getDefaultVisualTableColumns(type),
    },
    totals: {
      visible: true,
      align: 'right',
      fontSize: paper.widthMm <= 90 ? 11 : 12,
      fields: getDefaultVisualTotals(type),
    },
    payment: {
      visible: type !== 'return_invoice',
      showQr: true,
      showQrLogo: true,
      qrSizeMm: paper.widthMm <= 90 ? 28 : 34,
      label: 'Quét mã để thanh toán',
      fontSize: 10,
      align: 'center',
    },
    footer: {
      visible: true,
      align: 'center',
      fontSize: paper.widthMm <= 90 ? 10 : 11,
      lines: type === 'temporary_bill'
        ? [{ text: 'Phiếu chưa phải hóa đơn thanh toán', visible: true, fontSize: 10, bold: false }]
        : [
          { text: '{{store.invoice_note}}', visible: true, fontSize: 10, bold: false },
          { text: '{{store.invoice_slogan}}', visible: true, fontSize: 10, bold: false },
          { text: 'Cảm ơn quý khách và hẹn gặp lại!', visible: true, fontSize: 10, bold: true },
        ],
    },
  };
}

function mergeConfigArrayByKey(defaultItems = [], overrideItems = []) {
  if (!Array.isArray(overrideItems)) return defaultItems.map(item => ({ ...item }));
  const defaultsByKey = new Map(defaultItems.map(item => [item.key, item]));
  const usedKeys = new Set();
  const merged = overrideItems
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const base = defaultsByKey.get(item.key) || {};
      if (item.key) usedKeys.add(item.key);
      return { ...base, ...item };
    });
  defaultItems.forEach(item => {
    if (!usedKeys.has(item.key)) merged.push({ ...item });
  });
  return merged;
}

export function normalizeInvoiceVisualConfig(config, type = 'sale_invoice', paperSize = '80mm', widthMm = 80) {
  const cloned = cloneInvoiceVisualConfig(config);
  if (!cloned) return null;
  const base = createDefaultInvoiceVisualConfig(type, paperSize, widthMm);
  const merged = deepMerge(base, cloned);
  merged.version = Number(merged.version) || 1;
  merged.layout = {
    ...base.layout,
    ...(merged.layout || {}),
    paperSize: merged.layout?.paperSize || paperSize,
    widthMm: Number(merged.layout?.widthMm || widthMm) || inferPaperWidthMm(paperSize, 80),
  };
  merged.header = { ...base.header, ...(merged.header || {}) };
  merged.header.fields = mergeConfigArrayByKey(base.header.fields, cloned.header?.fields);
  merged.invoiceInfo = { ...base.invoiceInfo, ...(merged.invoiceInfo || {}) };
  merged.invoiceInfo.fields = mergeConfigArrayByKey(base.invoiceInfo.fields, cloned.invoiceInfo?.fields);
  merged.customerInfo = { ...base.customerInfo, ...(merged.customerInfo || {}) };
  merged.customerInfo.fields = mergeConfigArrayByKey(base.customerInfo.fields, cloned.customerInfo?.fields);
  merged.table = { ...base.table, ...(merged.table || {}) };
  merged.table.columns = mergeConfigArrayByKey(base.table.columns, cloned.table?.columns);
  merged.totals = { ...base.totals, ...(merged.totals || {}) };
  merged.totals.fields = mergeConfigArrayByKey(base.totals.fields, cloned.totals?.fields);
  merged.payment = { ...base.payment, ...(merged.payment || {}) };
  merged.footer = { ...base.footer, ...(merged.footer || {}) };
  merged.footer.lines = Array.isArray(cloned.footer?.lines) ? cloned.footer.lines.map(line => ({ ...line })) : base.footer.lines.map(line => ({ ...line }));
  return merged;
}

function getVisualConfigCandidate(template = {}) {
  return cloneInvoiceVisualConfig(template.config ?? template.visual_config ?? template.visualConfig);
}

export function hasInvoiceVisualConfig(template = {}) {
  return Boolean(getVisualConfigCandidate(template));
}

export function createSampleInvoiceData(type = 'sale_invoice', overrides = {}) {
  const now = new Date();
  const createdAt = now.toLocaleString('vi-VN', { hour12: false });
  const items = [
    {
      id: 1,
      sku: 'SP001',
      name: 'Vòng led trang trí cao cấp',
      unit: 'cái',
      quantity: 2,
      price_raw: 125000,
      price: formatCurrency(125000),
      discount: formatCurrency(10000),
      line_total_raw: 240000,
      line_total: formatCurrency(240000),
      image_url: SAMPLE_PRODUCT_IMAGE,
      reason: 'Khách đổi mẫu',
    },
    {
      id: 2,
      sku: 'SP002',
      name: 'Nến thơm hộp quà',
      unit: 'hộp',
      quantity: 1,
      price_raw: 89000,
      price: formatCurrency(89000),
      discount: formatCurrency(0),
      line_total_raw: 89000,
      line_total: formatCurrency(89000),
      image_url: SAMPLE_PRODUCT_IMAGE,
      reason: 'Hàng còn nguyên',
    },
    {
      id: 3,
      sku: 'SP003',
      name: 'Combo phụ kiện sinh nhật',
      unit: 'bộ',
      quantity: 3,
      price_raw: 45000,
      price: formatCurrency(45000),
      discount: formatCurrency(0),
      line_total_raw: 135000,
      line_total: formatCurrency(135000),
      image_url: '',
      reason: 'Sai số lượng',
    },
  ];

  const subtotal = items.reduce((sum, item) => sum + (Number(item.line_total_raw) || 0), 0);
  const discount = 14000;
  const total = subtotal - discount;

  const base = {
    store: {
      name: 'Shop',
      address: '123 Đường Hoa Mai, Quận 1, TP.HCM',
      phone: '0901 234 567',
      email: 'shop@example.local',
      tax_code: '0312345678',
      bank_account: '0123456789',
      bank_name: 'Ngân hàng Demo',
      invoice_logo: SAMPLE_LOGO,
      invoice_vietqr_logo: SAMPLE_LOGO,
      invoice_note: 'Hàng mua rồi vui lòng kiểm tra trước khi rời cửa hàng.',
      invoice_slogan: 'Cảm ơn quý khách và hẹn gặp lại!',
    },
    customer: {
      name: type === 'return_invoice' ? 'Nguyễn Văn An / NCC Hoa Mai' : 'Nguyễn Văn An',
      phone: '0987 654 321',
      address: '45 Lê Lợi, TP.HCM',
      email: 'khachhang@example.local',
    },
    partner: {
      name: 'Nguyễn Văn An / NCC Hoa Mai',
      phone: '0987 654 321',
      address: '45 Lê Lợi, TP.HCM',
    },
    invoice: {
      code: type === 'temporary_bill' ? 'TT-000245' : 'HD-000245',
      invoice_code: type === 'temporary_bill' ? 'TT-000245' : 'HD-000245',
      created_at: createdAt,
      cashier: 'Thu ngân Demo',
      payment_method: 'Tiền mặt',
      subtotal: formatCurrency(subtotal),
      discount: formatCurrency(discount),
      total: formatCurrency(total),
      paid: formatCurrency(total),
      change: formatCurrency(0),
      qr_url: SAMPLE_QR,
      note: 'Dữ liệu xem trước',
    },
    return: {
      code: 'TH-000087',
      return_code: 'TH-000087',
      created_at: createdAt,
      total: formatCurrency(total),
      reason: 'Khách trả hàng theo chính sách cửa hàng',
    },
    totals: {
      subtotal: formatCurrency(subtotal),
      discount: formatCurrency(discount),
      total: formatCurrency(total),
      paid: formatCurrency(total),
      change: formatCurrency(0),
    },
    images: {
      logo: SAMPLE_LOGO,
      qr: SAMPLE_QR,
      product: SAMPLE_PRODUCT_IMAGE,
      placeholder: FALLBACK_TRANSPARENT_PIXEL,
    },
    items,
  };

  return deepMerge(base, overrides);
}

function getByPath(source, path) {
  if (!path) return '';
  return String(path).split('.').reduce((current, key) => {
    if (current === undefined || current === null) return '';
    return current[key];
  }, source);
}

function buildLegacyPlaceholderMap(data) {
  return {
    store_name: data.store?.name,
    store_address: data.store?.address,
    store_phone: data.store?.phone,
    store_email: data.store?.email,
    store_tax_code: data.store?.tax_code,
    store_logo: data.store?.invoice_logo || data.images?.logo,
    customer_name: data.customer?.name,
    customer_phone: data.customer?.phone,
    customer_address: data.customer?.address,
    invoice_code: data.invoice?.invoice_code || data.invoice?.code,
    invoice_date: data.invoice?.created_at,
    invoice_created_at: data.invoice?.created_at,
    cashier_name: data.invoice?.cashier,
    payment_method: data.invoice?.payment_method,
    subtotal: data.totals?.subtotal || data.invoice?.subtotal,
    discount: data.totals?.discount || data.invoice?.discount,
    total: data.totals?.total || data.invoice?.total,
    paid: data.totals?.paid || data.invoice?.paid,
    change: data.totals?.change || data.invoice?.change,
    remaining: data.totals?.remaining || data.invoice?.remaining,
    delivery_fee: data.totals?.delivery_fee || data.invoice?.delivery_fee,
    qr_url: data.invoice?.qr_url || data.images?.qr,
    return_code: data.return?.return_code || data.return?.code,
    return_total: data.return?.total,
    partner_name: data.partner?.name,
    partner_phone: data.partner?.phone,
    items_rows: '__ITEMS_ROWS__',
  };
}

function normalizeItem(item) {
  const quantity = Number(item.quantity ?? item.qty ?? 0) || 0;
  const rawPrice = Number(item.price_raw ?? item.unit_price ?? item.price ?? 0) || 0;
  const lineTotal = Number(item.line_total_raw ?? item.line_total ?? rawPrice * quantity) || 0;
  return {
    ...item,
    sku: item.sku || item.code || '',
    name: item.name || item.product_name || 'Sản phẩm',
    unit: item.unit || '',
    quantity: item.quantity_text || formatNumber(quantity),
    price: typeof item.price === 'string' && item.price.includes('₫') ? item.price : formatCurrency(rawPrice),
    discount: typeof item.discount === 'string' && item.discount.includes('₫')
      ? item.discount
      : formatCurrency(Number(item.discount_raw ?? item.line_discount ?? item.discount ?? 0) || 0),
    line_total: typeof item.line_total === 'string' && item.line_total.includes('₫') ? item.line_total : formatCurrency(lineTotal),
    image_url: normalizeUrl(item.image_url || item.image || item.thumbnail || ''),
    reason: item.reason || '',
  };
}

export function renderItemsRows(items = [], options = {}) {
  const normalizedItems = Array.isArray(items) ? items.map(normalizeItem) : [];
  const includeImageColumn = options.includeImageColumn !== false && normalizedItems.some(item => item.image_url);
  const includeReason = options.includeReason === true;

  if (normalizedItems.length === 0) {
    const colSpan = 5 + (includeImageColumn ? 1 : 0) + (includeReason ? 1 : 0);
    return `<tr><td colspan="${colSpan}" class="text-center empty-items">Chưa có sản phẩm</td></tr>`;
  }

  return normalizedItems.map((item, index) => {
    const imageCell = includeImageColumn
      ? `<td class="text-center image-cell">${item.image_url ? `<img class="product-image" src="${escapeAttribute(item.image_url)}" alt="${escapeAttribute(item.name)}" />` : ''}</td>`
      : '';
    const reasonCell = includeReason ? `<td>${escapeHtml(item.reason)}</td>` : '';
    return `
      <tr>
        <td class="text-center item-index">${index + 1}</td>
        ${imageCell}
        <td class="product-cell"><span class="product-name">${escapeHtml(item.name)}</span><span class="product-sku">${escapeHtml(item.sku)}</span></td>
        <td class="text-center">${escapeHtml(item.quantity)}</td>
        <td class="text-right">${escapeHtml(item.price)}</td>
        <td class="text-right">${escapeHtml(item.line_total)}</td>
        ${reasonCell}
      </tr>`;
  }).join('');
}

function renderMustacheSections(template, data) {
  return template.replace(/{{#items}}([\s\S]*?){{\/items}}/gi, (_, rowTemplate) => {
    const items = Array.isArray(data.items) ? data.items.map(normalizeItem) : [];
    return items.map(item => renderTemplateString(rowTemplate, { ...data, ...item }, { allowItemsRows: false })).join('');
  });
}

function renderTemplateString(template, data, options = {}) {
  const legacyMap = buildLegacyPlaceholderMap(data);
  const itemRowOptions = {
    includeImageColumn: true,
    includeReason: options.includeReason === true || options.type === 'return_invoice',
  };
  let output = String(template || '');
  if (options.allowSections !== false) output = renderMustacheSections(output, data);

  output = output.replace(/{{\s*items_rows\s*}}/gi, () => renderItemsRows(data.items, itemRowOptions));
  output = output.replace(/__ITEMS_ROWS__/g, () => renderItemsRows(data.items, itemRowOptions));

  output = output.replace(/{{\s*([^#\/][^{}]*?)\s*}}/g, (_, key) => {
    const trimmedKey = String(key || '').trim();
    const value = getByPath(data, trimmedKey);
    if (trimmedKey === 'items_rows') return renderItemsRows(data.items, itemRowOptions);
    if (value === undefined || value === null || value === '') return '';
    return escapeHtml(value);
  });

  output = output.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(legacyMap, key)) {
      const value = legacyMap[key];
      if (value === '__ITEMS_ROWS__') return renderItemsRows(data.items, itemRowOptions);
      return escapeHtml(value);
    }
    const value = getByPath(data, key.replace(/_/g, '.'));
    return value === undefined || value === null || value === '' ? match : escapeHtml(value);
  });

  return output;
}

function safeAlign(value, fallback = 'left') {
  return ['left', 'center', 'right'].includes(value) ? value : fallback;
}

function safeNumber(value, fallback, min = 0, max = 1000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function safeFontSize(value, fallback = 11) {
  return safeNumber(value, fallback, 7, 48);
}

function safeMm(value, fallback = 4, min = 0, max = 80) {
  return safeNumber(value, fallback, min, max);
}

function safeWidth(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d+(?:\.\d+)?\s*(%|mm|px)$/i.test(raw)) return raw.replace(/\s+/g, '');
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? `${Math.min(number, 100)}%` : '';
}

function safeBorderStyle(value) {
  return ['dashed', 'solid', 'dotted', 'none'].includes(value) ? value : 'dashed';
}

function safeFontFamily(value) {
  const cleaned = String(value || 'Arial, Helvetica, sans-serif').replace(/[^a-zA-Z0-9\s,"'\-]/g, '').trim();
  return cleaned || 'Arial, Helvetica, sans-serif';
}

function styleAttr(styles = {}) {
  const css = Object.entries(styles)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  return css ? ` style="${escapeAttribute(sanitizeCss(css))}"` : '';
}

function renderPlainTextTemplate(template, data) {
  const legacyMap = buildLegacyPlaceholderMap(data);
  let output = String(template || '');
  output = output.replace(/{{\s*([^#\/][^{}]*?)\s*}}/g, (_, key) => {
    const value = getByPath(data, String(key || '').trim());
    return value === undefined || value === null ? '' : String(value);
  });
  output = output.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(legacyMap, key)) {
      const value = legacyMap[key];
      return value === undefined || value === null || value === '__ITEMS_ROWS__' ? '' : String(value);
    }
    const value = getByPath(data, key.replace(/_/g, '.'));
    return value === undefined || value === null || value === '' ? match : String(value);
  });
  return output;
}

function renderVisualField(field = {}, data, options = {}) {
  if (field.visible === false) return '';
  const value = getByPath(data, field.key);
  if ((value === undefined || value === null || value === '') && field.showWhenEmpty !== true) return '';
  const label = field.label === undefined || field.label === null ? '' : String(field.label).trim();
  const align = safeAlign(field.align, options.align || 'left');
  const fontSize = safeFontSize(field.fontSize, options.fontSize || 11);
  const wrapperStyle = styleAttr({
    'text-align': align,
    'font-size': `${fontSize}px`,
    'font-weight': field.bold ? 700 : undefined,
    'text-transform': field.uppercase ? 'uppercase' : undefined,
  });
  const valueTag = field.boldValue || field.bold ? 'strong' : 'span';
  const labelHtml = label ? `<span class="visual-label">${escapeHtml(label)}:</span> ` : '';
  return `<div class="visual-field"${wrapperStyle}>${labelHtml}<${valueTag} class="visual-value">${escapeHtml(value)}</${valueTag}></div>`;
}

function renderVisualInfoSection(section = {}, data, className) {
  if (section.visible === false) return '';
  const fieldsHtml = (Array.isArray(section.fields) ? section.fields : [])
    .map(field => renderVisualField(field, data, { fontSize: section.fontSize || 11 }))
    .filter(Boolean)
    .join('');
  if (!fieldsHtml && !section.title) return '';
  const columns = Number(section.columns) === 2 ? 2 : 1;
  const titleHtml = section.title ? `<div class="visual-section-title">${escapeHtml(section.title)}</div>` : '';
  return `<section class="visual-info-section ${className || ''} visual-columns-${columns}">${titleHtml}${fieldsHtml}</section>`;
}

function renderVisualHeader(config = {}, data) {
  const header = config.header || {};
  if (header.visible === false) return '';
  const align = safeAlign(header.align, 'center');
  const logoUrl = normalizeUrl(data.store?.invoice_logo || data.images?.logo || '');
  const logoWidth = safeMm(header.logoWidthMm, 24, 8, 80);
  const logoHtml = header.showLogo !== false && logoUrl
    ? `<img class="visual-store-logo" src="${escapeAttribute(logoUrl)}" alt="Logo cửa hàng" style="width:${logoWidth}mm" />`
    : '';
  const fieldsHtml = (Array.isArray(header.fields) ? header.fields : [])
    .map(field => renderVisualField(field, data, { align, fontSize: 10 }))
    .filter(Boolean)
    .join('');
  const titleFontSize = safeFontSize(header.titleFontSize, 15);
  const subtitleFontSize = safeFontSize(header.subtitleFontSize, 11);
  const titleHtml = header.title
    ? `<h1 class="visual-invoice-title"${styleAttr({ 'font-size': `${titleFontSize}px`, 'text-align': align })}>${escapeHtml(header.title)}</h1>`
    : '';
  const subtitleHtml = header.subtitle
    ? `<div class="visual-invoice-subtitle"${styleAttr({ 'font-size': `${subtitleFontSize}px`, 'text-align': align })}>${escapeHtml(header.subtitle)}</div>`
    : '';
  return `<header class="visual-store-header"${styleAttr({ 'text-align': align })}>${logoHtml}${fieldsHtml}${titleHtml}${subtitleHtml}</header>`;
}

function getVisualItemValue(item, column, index) {
  switch (column.key) {
    case 'index': return String(index + 1);
    case 'image': return item.image_url;
    case 'name': return item.name;
    case 'sku': return item.sku;
    case 'unit': return item.unit;
    case 'quantity': return item.quantity;
    case 'price': return item.price;
    case 'discount': return item.discount;
    case 'line_total': return item.line_total;
    case 'reason': return item.reason;
    default: return getByPath(item, column.key);
  }
}

function renderVisualItemsTable(config = {}, data, type) {
  const table = config.table || {};
  if (table.visible === false) return '';
  const columns = (Array.isArray(table.columns) ? table.columns : [])
    .filter(column => column && column.visible !== false);
  if (columns.length === 0) return '';
  const headerFontSize = safeFontSize(table.headerFontSize, 10);
  const bodyFontSize = safeFontSize(table.fontSize, 10);
  const colgroup = columns.map(column => {
    const width = safeWidth(column.width);
    return width ? `<col style="width:${escapeAttribute(width)}" />` : '<col />';
  }).join('');
  const headerHtml = columns.map(column => {
    const align = safeAlign(column.align, 'left');
    return `<th${styleAttr({ 'text-align': align, 'font-size': `${headerFontSize}px` })}>${escapeHtml(column.label || column.key)}</th>`;
  }).join('');
  const normalizedItems = Array.isArray(data.items) ? data.items.map(normalizeItem) : [];
  const bodyHtml = normalizedItems.length === 0
    ? `<tr><td colspan="${columns.length}" class="text-center empty-items">Chưa có sản phẩm</td></tr>`
    : normalizedItems.map((item, index) => {
      const cells = columns.map(column => {
        const align = safeAlign(column.align, 'left');
        const rawValue = getVisualItemValue(item, column, index);
        let content = '';
        if (column.key === 'image') {
          const imageUrl = normalizeUrl(rawValue || item.image_url || '');
          content = imageUrl ? `<img class="product-image" src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(item.name)}" />` : '';
        } else if (column.key === 'name') {
          const skuHtml = table.showSku !== false && item.sku ? `<span class="product-sku">${escapeHtml(item.sku)}</span>` : '';
          content = `<span class="product-name">${escapeHtml(rawValue || '')}</span>${skuHtml}`;
        } else {
          content = escapeHtml(rawValue || '');
        }
        return `<td${styleAttr({ 'text-align': align, 'font-size': `${bodyFontSize}px` })}>${content}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
  return `<table class="visual-items-table items-table ${escapeAttribute(type || '')}"><colgroup>${colgroup}</colgroup><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function renderVisualTotals(config = {}, data) {
  const totals = config.totals || {};
  if (totals.visible === false) return '';
  const rows = (Array.isArray(totals.fields) ? totals.fields : [])
    .filter(field => field && field.visible !== false)
    .map(field => {
      const value = getByPath(data, field.key);
      if ((value === undefined || value === null || value === '') && field.showWhenEmpty !== true) return '';
      const label = field.label === undefined || field.label === null ? '' : String(field.label).trim();
      const align = safeAlign(field.align, totals.align || 'right');
      const fontSize = safeFontSize(field.fontSize, totals.fontSize || 11);
      return `<div class="visual-total-row ${field.bold ? 'visual-grand-total' : ''}"${styleAttr({ 'font-size': `${fontSize}px`, 'text-align': align, 'font-weight': field.bold ? 700 : undefined })}><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    })
    .filter(Boolean)
    .join('');
  return rows ? `<section class="visual-totals">${rows}</section>` : '';
}

function renderVisualPayment(config = {}, data) {
  const payment = config.payment || {};
  if (payment.visible === false || payment.showQr === false) return '';
  const qrUrl = normalizeUrl(data.invoice?.qr_url || data.images?.qr || '');
  if (!qrUrl) return '';
  const qrSize = safeMm(payment.qrSizeMm, 28, 12, 80);
  const align = safeAlign(payment.align, 'center');
  const labelHtml = payment.label ? `<div class="visual-payment-label"${styleAttr({ 'font-size': `${safeFontSize(payment.fontSize, 10)}px` })}>${escapeHtml(payment.label)}</div>` : '';
  const qrLogoUrl = normalizeUrl(data.store?.invoice_vietqr_logo || '');
  const qrLogoHtml = payment.showQrLogo !== false && qrLogoUrl ? `<img class="visual-qr-logo" src="${escapeAttribute(qrLogoUrl)}" alt="VietQR logo" />` : '';
  return `<section class="visual-payment"${styleAttr({ 'text-align': align })}>${labelHtml}<img class="visual-qr-image" src="${escapeAttribute(qrUrl)}" alt="QR thanh toán" style="width:${qrSize}mm;height:${qrSize}mm" />${qrLogoHtml}</section>`;
}

function renderVisualFooter(config = {}, data) {
  const footer = config.footer || {};
  if (footer.visible === false) return '';
  const align = safeAlign(footer.align, 'center');
  const lines = (Array.isArray(footer.lines) ? footer.lines : [])
    .filter(line => line && line.visible !== false)
    .map(line => {
      const text = renderPlainTextTemplate(line.text || '', data).trim();
      if (!text && line.showWhenEmpty !== true) return '';
      const fontSize = safeFontSize(line.fontSize, footer.fontSize || 10);
      return `<div class="visual-footer-line"${styleAttr({ 'font-size': `${fontSize}px`, 'font-weight': line.bold ? 700 : undefined })}>${escapeHtml(text)}</div>`;
    })
    .filter(Boolean)
    .join('');
  return lines ? `<footer class="visual-footer"${styleAttr({ 'text-align': align })}>${lines}</footer>` : '';
}

function renderVisualTemplateCss(config = {}, paper = {}) {
  const layout = config.layout || {};
  const baseFontSize = safeFontSize(layout.baseFontSize, paper.widthMm <= 90 ? 11 : 12);
  const paddingMm = safeMm(layout.paddingMm, paper.widthMm <= 90 ? 4 : 0, 0, 30);
  const borderStyle = safeBorderStyle(layout.borderStyle);
  const borderRule = borderStyle === 'none' ? '0' : `1px ${borderStyle} #9ca3af`;
  const fontFamily = safeFontFamily(layout.fontFamily);
  return `
.visual-invoice-template { width: 100%; color: #111; font-family: ${fontFamily}; font-size: ${baseFontSize}px; line-height: 1.38; padding: ${paddingMm}mm; }
.visual-store-header { border-bottom: ${borderRule}; padding-bottom: 6px; margin-bottom: 8px; }
.visual-store-logo { max-width: 100%; max-height: 18mm; object-fit: contain; display: block; margin: 0 auto 4px; }
.visual-field { margin: 1px 0; word-break: break-word; }
.visual-label { font-weight: 500; }
.visual-invoice-title { margin: 8px 0 4px; font-weight: 700; line-height: 1.2; }
.visual-invoice-subtitle { margin: 0 0 4px; color: #374151; }
.visual-info-section { margin-bottom: 6px; }
.visual-info-section.visual-columns-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
.visual-section-title { font-weight: 700; margin: 4px 0; }
.visual-items-table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
.visual-items-table th, .visual-items-table td { border-bottom: 1px ${borderStyle === 'none' ? 'solid' : borderStyle} #d1d5db; padding: 4px 2px; vertical-align: top; word-break: break-word; }
.visual-items-table th { font-weight: 700; }
.visual-totals { margin-top: 8px; border-top: ${borderRule}; padding-top: 6px; }
.visual-total-row { display: flex; justify-content: space-between; gap: 10px; margin: 2px 0; }
.visual-total-row span { flex: 1; }
.visual-total-row strong { text-align: right; }
.visual-grand-total { font-weight: 700; }
.visual-payment { margin: 8px 0; }
.visual-payment-label { margin-bottom: 4px; color: #374151; }
.visual-qr-image { object-fit: contain; display: block; margin: 0 auto; }
.visual-qr-logo { max-width: 32mm; max-height: 8mm; object-fit: contain; display: block; margin: 2px auto 0; }
.visual-footer { margin-top: 6px; }
.visual-footer-line { margin-top: 2px; }
`;
}

function renderVisualInvoiceTemplate(config, data, options = {}) {
  const type = options.type || 'sale_invoice';
  const paperSize = options.paperSize || config.layout?.paperSize || '80mm';
  const widthMm = Number(options.widthMm || config.layout?.widthMm) || inferPaperWidthMm(paperSize, 80);
  const paper = getPaperConfig(paperSize, widthMm);
  const normalizedConfig = normalizeInvoiceVisualConfig(config, type, paperSize, paper.widthMm) || createDefaultInvoiceVisualConfig(type, paperSize, paper.widthMm);
  const html = `
<div class="visual-invoice-template ${escapeAttribute(type)}">
  ${renderVisualHeader(normalizedConfig, data)}
  ${renderVisualInfoSection(normalizedConfig.invoiceInfo, data, 'visual-invoice-info')}
  ${renderVisualInfoSection(normalizedConfig.customerInfo, data, 'visual-customer-info')}
  ${renderVisualItemsTable(normalizedConfig, data, type)}
  ${renderVisualTotals(normalizedConfig, data)}
  ${renderVisualPayment(normalizedConfig, data)}
  ${renderVisualFooter(normalizedConfig, data)}
</div>`;
  return {
    html,
    css: renderVisualTemplateCss(normalizedConfig, paper),
    config: normalizedConfig,
  };
}

export function buildPaperCss(paperSize = '80mm', widthMm = 80) {
  const paper = getPaperConfig(paperSize, widthMm);
  const minHeightRule = paper.minHeightMm ? `min-height: ${paper.minHeightMm}mm;` : '';
  const receiptPadding = paper.widthMm <= 90 ? '4mm' : '0';
  const previewPadding = paper.widthMm <= 90 ? '0' : '0';
  const pageMargin = Number(paper.marginMm) || 0;

  return `
@page { size: ${paper.pageSize}; margin: ${pageMargin}mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #f3f4f6; color: #111827; font-family: Arial, Helvetica, sans-serif; }
body { width: 100%; }
.invoice-preview-root { width: ${paper.widthMm}mm; ${minHeightRule} margin: 0 auto; background: #fff; color: #111; padding: ${previewPadding}; overflow: hidden; }
.invoice-preview-root.receipt-paper { padding: ${receiptPadding}; }
.items-table { width: 100%; border-collapse: collapse; table-layout: auto; }
.items-table th, .items-table td { vertical-align: top; }
.product-image { max-width: 14mm; max-height: 14mm; object-fit: cover; border-radius: 3px; }
.product-cell { word-break: break-word; }
.product-name { display: block; font-weight: 600; }
.product-sku { display: block; color: #6b7280; font-size: 0.85em; margin-top: 1px; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.empty-items { color: #6b7280; padding: 10px; font-style: italic; }
img { max-width: 100%; }
@media screen {
  body { padding: 16px; }
  .invoice-preview-root { box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18); border: 1px solid rgba(148, 163, 184, 0.5); }
}
@media print {
  html, body { background: #fff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  body { padding: 0 !important; }
  .invoice-preview-root { box-shadow: none !important; border: 0 !important; margin: 0 !important; }
}`;
}

export function buildInvoiceDocument({ html, css, paperSize, widthMm, title = 'Xem trước mẫu in' }) {
  const paper = getPaperConfig(paperSize, widthMm);
  const bodyClass = paper.widthMm <= 90 ? 'invoice-preview-root receipt-paper' : 'invoice-preview-root';
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${buildPaperCss(paperSize, paper.widthMm)}</style>
  <style>${sanitizeCss(css || '')}</style>
</head>
<body>
  <main class="${bodyClass}">${sanitizeTemplateHtml(html || '')}</main>
</body>
</html>`;
}

export function getPreviewFrameSize(paperSize = '80mm', widthMm = 80) {
  const paper = getPaperConfig(paperSize, widthMm);
  const widthPx = Math.ceil(paper.widthMm * MM_TO_PX) + 44;
  const heightPx = Math.ceil((paper.minHeightMm || paper.widthMm * 2.2) * MM_TO_PX) + 44;
  return {
    width: Math.min(Math.max(widthPx, 300), 920),
    minHeight: Math.min(Math.max(heightPx, 420), 980),
    paperWidthMm: paper.widthMm,
  };
}

export function renderInvoiceTemplate(template = {}, options = {}) {
  const paperSize = options.paperSize || template.paper_size || template.paperSize || '80mm';
  const widthMm = Number(options.widthMm || template.width_mm || template.widthMm) || inferPaperWidthMm(paperSize, 80);
  const templateType = template.type || options.type || 'sale_invoice';
  const data = options.sampleData || createSampleInvoiceData(templateType);
  const cssSource = template.css || '';
  const visualConfig = getVisualConfigCandidate(template);
  const visualRender = visualConfig ? renderVisualInvoiceTemplate(visualConfig, data, { type: templateType, paperSize, widthMm }) : null;
  const htmlSource = visualRender ? visualRender.html : (template.html || '');
  const cssFromSource = visualRender ? `${visualRender.css}\n${cssSource || ''}` : cssSource;
  const renderedHtml = sanitizeTemplateHtml(visualRender ? htmlSource : renderTemplateString(htmlSource, data, { allowSections: true, type: templateType }));
  const renderedCss = sanitizeCss(cssFromSource);
  const documentHtml = buildInvoiceDocument({
    html: renderedHtml,
    css: renderedCss,
    paperSize,
    widthMm,
    title: template.name || 'Xem trước mẫu in hóa đơn',
  });

  return {
    html: renderedHtml,
    css: renderedCss,
    documentHtml,
    paperSize,
    widthMm,
    data,
    config: visualRender?.config || null,
  };
}
