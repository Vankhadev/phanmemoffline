import { getPaperDimensions } from '../templateDefaults';

export const EDITOR_SCHEMA_VERSION = 2;
export const PAGE_ZONE_ID = 'page';
export const TABLE_STYLE_ELEMENT_ID = '__itemsTableStyle';
export const TABLE_STYLE_ELEMENT_TYPE = 'rectangle';

export const TABLE_COLUMN_LABELS = Object.freeze({
  no: 'STT',
  name: 'Tên sản phẩm',
  sku: 'Mã SKU',
  unit: 'Đơn vị',
  qty: 'Số lượng',
  quantity: 'Số lượng',
  unitPrice: 'Đơn giá',
  discount: 'Chiết khấu',
  lineTotal: 'Thành tiền',
  note: 'Ghi chú',
});

export const DEFAULT_TABLE_COLUMNS = Object.freeze([
  { key: 'no', label: 'STT', widthMm: 8, align: 'center' },
  { key: 'name', label: 'Tên sản phẩm', widthMm: 48, align: 'left' },
  { key: 'unit', label: 'Đơn vị', widthMm: 11, align: 'center' },
  { key: 'qty', label: 'SL', widthMm: 12, align: 'center' },
  { key: 'unitPrice', label: 'Đơn giá', widthMm: 19, align: 'right' },
  { key: 'discount', label: 'CK', widthMm: 18, align: 'right' },
  { key: 'lineTotal', label: 'Thành tiền', widthMm: 20, align: 'right' },
]);

const TABLE_COLUMN_MIN_WIDTHS = Object.freeze({
  no: 6,
  name: 26,
  sku: 12,
  unit: 9,
  qty: 10,
  quantity: 10,
  unitPrice: 15,
  discount: 14,
  lineTotal: 16,
  note: 14,
});

export function fitTableColumnsToFrame(columns = DEFAULT_TABLE_COLUMNS, frameWidthMm = 100) {
  const available = Math.max(24, Number(frameWidthMm) || 100);
  const source = Array.isArray(columns) && columns.length ? columns : DEFAULT_TABLE_COLUMNS;
  const cloned = source.map((column, index) => {
    const fallback = DEFAULT_TABLE_COLUMNS[index] || DEFAULT_TABLE_COLUMNS[1];
    return {
      ...fallback,
      ...cloneJson(column || fallback),
      widthMm: roundMm(clampNumber(column?.widthMm, 4, 120, fallback.widthMm || 18)),
    };
  });
  const total = cloned.reduce((sum, column) => sum + (Number(column.widthMm) || 0), 0);
  if (!total || total <= available) return cloned;

  const scale = available / total;
  let scaled = cloned.map(column => {
    const minWidth = TABLE_COLUMN_MIN_WIDTHS[column.key] || 8;
    return { ...column, widthMm: roundMm(Math.max(minWidth, (Number(column.widthMm) || minWidth) * scale)) };
  });
  const scaledTotal = scaled.reduce((sum, column) => sum + (Number(column.widthMm) || 0), 0);
  if (scaledTotal <= available) return scaled;

  const forceScale = available / scaledTotal;
  scaled = scaled.map(column => ({ ...column, widthMm: roundMm(Math.max(4, (Number(column.widthMm) || 4) * forceScale)) }));
  return scaled;
}

export const ELEMENT_DEFINITIONS = Object.freeze([
  { type: 'logo', label: 'Logo hóa đơn', group: 'Thương hiệu', zoneId: 'header' },
  { type: 'storeInfo', label: 'Thông tin cửa hàng', group: 'Thương hiệu', zoneId: 'header' },
  { type: 'invoiceTitle', label: 'Tiêu đề hóa đơn', group: 'Đơn hàng', zoneId: 'header' },
  { type: 'customerInfo', label: 'Thông tin khách hàng', group: 'Khách hàng', zoneId: 'header' },
  { type: 'invoiceMeta', label: 'Thông tin đơn hàng', group: 'Đơn hàng', zoneId: 'header' },
  { type: 'totals', label: 'Khu vực tổng tiền', group: 'Thanh toán', zoneId: 'footer' },
  { type: 'note', label: 'Ghi chú hóa đơn', group: 'Footer', zoneId: 'footer' },
  { type: 'footerText', label: 'Footer hóa đơn', group: 'Footer', zoneId: 'footer' },
  { type: 'signatures', label: 'Chữ ký / con dấu', group: 'Footer', zoneId: 'signatures' },
  { type: 'customText', label: 'Text tùy chỉnh', group: 'Tự do', zoneId: 'header' },
  { type: 'image', label: 'Ảnh URL', group: 'Tự do', zoneId: 'header' },
  { type: 'line', label: 'Đường kẻ', group: 'Trang trí', zoneId: 'header' },
  { type: 'rectangle', label: 'Khung viền', group: 'Trang trí', zoneId: 'header' },
]);

const VALID_ELEMENT_TYPES = new Set(ELEMENT_DEFINITIONS.map(item => item.type));
const VALID_TABLE_COLUMN_KEYS = new Set(Object.keys(TABLE_COLUMN_LABELS));
const VALID_ALIGN = new Set(['left', 'center', 'right']);
const VALID_PAPER_SIZES = new Set(['A4', 'A5', 'K80', 'K57', 'K58']);

export function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function roundMm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1000) / 1000;
}

function cleanText(value, maxLength = 1000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

function uniqueId(prefix = 'element') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function normalizePaperSize(value, fallback = 'A5') {
  const requested = cleanText(value || fallback, 20).toUpperCase();
  const paperSize = requested === 'K58' ? 'K57' : requested;
  return VALID_PAPER_SIZES.has(paperSize) ? paperSize : fallback;
}

export function normalizeOrientation(value, paperSize = 'A5') {
  if (String(paperSize || '').toUpperCase().startsWith('K')) return 'portrait';
  return cleanText(value, 20).toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
}

export function getEditorPaperDimensions(documentOrCanvas = {}) {
  const canvas = documentOrCanvas?.canvas || documentOrCanvas || {};
  const paperSize = normalizePaperSize(canvas.pageSize || canvas.paperSize || 'A5');
  const orientation = normalizeOrientation(canvas.orientation || 'portrait', paperSize);
  return getPaperDimensions(paperSize, orientation);
}

function normalizeFrame(input, fallback = {}, options = {}) {
  const allowAutoHeight = options.allowAutoHeight === true;
  const value = isPlainObject(input) ? input : {};
  const x = clampNumber(value.x, options.minX ?? -1000, options.maxX ?? 1000, fallback.x ?? 0);
  const y = clampNumber(value.y, options.minY ?? -1000, options.maxY ?? 1000, fallback.y ?? 0);
  const w = clampNumber(value.w, options.minW ?? 0.1, options.maxW ?? 1000, fallback.w ?? 10);
  const h = value.h === 'auto' && allowAutoHeight
    ? 'auto'
    : clampNumber(value.h, options.minH ?? 0.1, options.maxH ?? 1000, fallback.h ?? 10);
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: h === 'auto' ? 'auto' : roundMm(h) };
}

export function clampFrameToZone(frame = {}, zone = {}, options = {}) {
  const zoneFrame = zone?.frame || { w: 1, h: 1 };
  const minW = options.minW ?? 2;
  const minH = options.minH ?? 2;
  const w = Math.min(Math.max(Number(frame.w) || minW, minW), Math.max(minW, Number(zoneFrame.w) || minW));
  const h = frame.h === 'auto'
    ? 'auto'
    : Math.min(Math.max(Number(frame.h) || minH, minH), Math.max(minH, Number(zoneFrame.h) || minH));
  const maxX = Math.max(0, (Number(zoneFrame.w) || 0) - w);
  const maxY = h === 'auto' ? Math.max(0, Number(zoneFrame.h) || 0) : Math.max(0, (Number(zoneFrame.h) || 0) - h);
  return {
    x: roundMm(Math.min(maxX, Math.max(0, Number(frame.x) || 0))),
    y: roundMm(Math.min(maxY, Math.max(0, Number(frame.y) || 0))),
    w: roundMm(w),
    h: h === 'auto' ? 'auto' : roundMm(h),
  };
}

function defaultStyleForType(type) {
  const commonText = {
    fontSizePt: 8.5,
    lineHeight: 1.25,
    color: '#111827',
    align: 'left',
    fontFamily: 'system',
    opacity: 1,
    paddingMm: 0,
    spacingMm: 0.6,
  };

  switch (type) {
    case 'logo':
      return {
        objectFit: 'contain',
        align: 'center',
        borderRadiusMm: 2,
        opacity: 1,
        paddingMm: 0,
        borderWidthMm: 0.2,
        borderColor: '#111827',
        backgroundColor: '#ffffff',
      };
    case 'storeInfo':
      return {
        ...commonText,
        fontSizePt: 8.3,
        bold: true,
        uppercase: true,
        showStoreName: true,
        showStoreAddress: true,
        showStorePhone: true,
        showStoreEmail: true,
        showStoreTaxCode: true,
        storePhoneLabel: 'ĐT',
      };
    case 'invoiceTitle':
      return { ...commonText, fontSizePt: 12.5, bold: true, align: 'right', color: '#111827', titleText: 'HÓA ĐƠN', subtitleText: 'BÁN HÀNG', showTitle: true, showSubtitle: true, showInvoiceCode: true };
    case 'customerInfo':
      return {
        ...commonText,
        fontSizePt: 7.8,
        lineHeight: 1.2,
        labelWidthMm: 18,
        bold: false,
        showCustomerName: true,
        showCustomerPhone: true,
        showCustomerAddress: true,
        showCustomerTaxCode: true,
        showCustomerType: false,
        customerNameLabel: 'Khách',
        customerPhoneLabel: 'SĐT',
        customerAddressLabel: 'Địa chỉ',
        customerTaxCodeLabel: 'MST',
        customerTypeLabel: 'Loại khách',
      };
    case 'invoiceMeta':
      return {
        ...commonText,
        fontSizePt: 7.8,
        lineHeight: 1.2,
        labelWidthMm: 18,
        align: 'right',
        showOrderCode: true,
        showOrderDate: true,
        showPaymentMethod: false,
        showSeller: true,
        showOrderSource: false,
        orderCodeLabel: 'Mã đơn',
        orderDateLabel: 'Ngày',
        paymentMethodLabel: 'Thanh toán',
        sellerLabelShort: 'NV',
        orderSourceLabel: 'Nguồn',
      };
    case 'totals':
      return {
        ...commonText,
        fontSizePt: 8,
        autoBelowItems: true,
        autoGapMm: 3,
        highlightColor: '#ffffff',
        paddingMm: 1,
        borderWidthMm: 0.2,
        borderColor: '#111827',
        borderRadiusMm: 0,
      };
    case 'note':
      return { ...commonText, fontSizePt: 7.8, color: '#111827', backgroundColor: '#ffffff', paddingMm: 1, borderWidthMm: 0.2, borderColor: '#111827', borderRadiusMm: 0 };
    case 'signatures':
      return { ...commonText, fontSizePt: 8, align: 'center', signatureGapMm: 10, blankHeightMm: 12, buyerLabel: 'Khách hàng', sellerLabel: 'Người bán', buyerHint: '(Ký và ghi rõ họ tên)', sellerHint: '(Ký và ghi rõ họ tên)' };
    case 'footerText':
      return { ...commonText, text: 'Cảm ơn quý khách! · Hẹn gặp lại', fontSizePt: 7.2, align: 'center', color: '#64748b' };
    case 'line':
    case 'separator':
      return { color: '#cbd5e1', borderWidthMm: 0.25, opacity: 1 };
    case 'rectangle':
      return { borderWidthMm: 0.25, borderColor: '#cbd5e1', borderRadiusMm: 1, backgroundColor: 'transparent', opacity: 1 };
    case 'image':
      return { objectFit: 'contain', src: '', borderRadiusMm: 1, opacity: 1 };
    case 'customText':
    case 'text':
    default:
      return { ...commonText, text: 'Nhập nội dung...', fontSizePt: 9, bold: false };
  }
}

export function getTableStyleElement(document = {}) {
  const elements = Array.isArray(document.elements) ? document.elements : [];
  return elements.find(element => element.id === TABLE_STYLE_ELEMENT_ID) || null;
}

export function isAutoBelowItemsElement(element = {}) {
  return element?.type === 'totals' && element?.style?.autoBelowItems !== false;
}

export function getAutoBelowItemsGapMm(element = {}) {
  const value = Number(element?.style?.autoGapMm);
  return Number.isFinite(value) ? Math.max(0, value) : 3;
}

export function estimateItemsTableHeightMm(document = {}, itemCount = 0) {
  const style = getTableStyleElement(document)?.style || {};
  const padding = Number(style.paddingMm ?? 1.35);
  const lineHeight = Number(style.lineHeight) || 1.18;
  const bodyFont = Number(style.fontSizePt) || 8.2;
  const headerFont = Number(style.headerFontSizePt) || bodyFont;
  const headerMm = Math.max(5.2, headerFont * 0.48 * lineHeight + padding * 2);
  const rowMm = Math.max(4.8, bodyFont * 0.48 * lineHeight + padding * 2);
  return roundMm(headerMm + Math.max(1, Number(itemCount) || 0) * rowMm);
}

export function getItemsTablePageMetrics(document = {}, itemCount = 0) {
  const table = document.table || {};
  const zones = Array.isArray(document.zones) ? document.zones : [];
  const zone = zones.find(item => item.id === table.zoneId) || zones[0] || { frame: { x: 0, y: 0, w: 100, h: 30 } };
  const frame = table.frame || { x: 0, y: 0, w: zone.frame?.w || 100, h: 'auto' };
  const estimatedHeight = estimateItemsTableHeightMm(document, itemCount);
  const configuredHeight = frame.h === 'auto'
    ? estimatedHeight
    : Math.max(Number(frame.h) || 0, estimatedHeight);
  const x = roundMm(Number(zone.frame?.x || 0) + Number(frame.x || 0));
  const y = roundMm(Number(zone.frame?.y || 0) + Number(frame.y || 0));
  const w = roundMm(Number(frame.w || zone.frame?.w || 100));
  const h = roundMm(configuredHeight);
  return {
    x,
    y,
    w,
    h,
    bottom: roundMm(y + h),
  };
}

function defaultTableStyleElement(bodyZone, tableFrame) {
  const styleFrame = {
    x: Number(tableFrame?.x) || 0,
    y: Number(tableFrame?.y) || 0,
    w: Number(tableFrame?.w) || bodyZone?.frame?.w || 100,
    h: Number(tableFrame?.h) || 10,
  };
  return {
    id: TABLE_STYLE_ELEMENT_ID,
    type: TABLE_STYLE_ELEMENT_TYPE,
    zoneId: bodyZone?.id || 'body',
    frame: normalizeFrame(styleFrame, { x: 0, y: 0, w: bodyZone?.frame?.w || 100, h: 10 }),
    visible: false,
    locked: true,
    zIndex: -100,
    style: {
      tableBorder: true,
      borderWidthMm: 0.22,
      borderColor: '#111827',
      headerBackgroundColor: '#f5f5f5',
      headerColor: '#111827',
      paddingMm: 0.95,
      rowGapMm: 0,
      fontSizePt: 7.8,
      headerFontSizePt: 7.2,
      fontWeight: 400,
      headerFontWeight: 900,
      lineHeight: 1.15,
      widthPercent: 100,
    },
  };
}

function normalizeElement(input, zonesById, fallbackIndex = 0) {
  const raw = isPlainObject(input) ? input : {};
  const type = VALID_ELEMENT_TYPES.has(raw.type) ? raw.type : 'customText';
  const zoneId = zonesById.has(raw.zoneId) ? raw.zoneId : (zonesById.has('header') ? 'header' : Array.from(zonesById.keys())[0]);
  const zone = zonesById.get(zoneId);
  const frame = clampFrameToZone(
    normalizeFrame(raw.frame, defaultFrameForType(type, zone), { allowAutoHeight: false }),
    zone,
    { minW: type === 'line' ? 2 : 3, minH: type === 'line' ? 0.5 : 3 },
  );
  return {
    id: cleanText(raw.id, 80) || `${type}-${fallbackIndex + 1}`,
    type,
    zoneId,
    frame,
    visible: raw.visible !== false,
    locked: raw.locked === true,
    zIndex: Number.isFinite(Number(raw.zIndex)) ? Math.trunc(Number(raw.zIndex)) : fallbackIndex * 10,
    ...(isPlainObject(raw.bindings) ? { bindings: cloneJson(raw.bindings) } : {}),
    style: { ...defaultStyleForType(type), ...(isPlainObject(raw.style) ? cloneJson(raw.style) : {}) },
  };
}

function normalizeColumn(input, index = 0) {
  const raw = isPlainObject(input) ? input : {};
  const key = raw.key === 'quantity' ? 'qty' : cleanText(raw.key, 50);
  const fallback = DEFAULT_TABLE_COLUMNS[index] || DEFAULT_TABLE_COLUMNS[1];
  const normalizedKey = VALID_TABLE_COLUMN_KEYS.has(key) ? key : fallback.key;
  const align = cleanText(raw.align, 20).toLowerCase();
  return {
    key: normalizedKey,
    label: cleanText(raw.label, 80) || TABLE_COLUMN_LABELS[normalizedKey] || fallback.label,
    widthMm: roundMm(clampNumber(raw.widthMm, 4, 120, fallback.widthMm || 18)),
    align: VALID_ALIGN.has(align) ? align : (fallback.align || 'left'),
  };
}

function normalizeZones(input, canvas) {
  const page = getPaperDimensions(canvas.pageSize, canvas.orientation);
  const contentWidth = Math.max(20, page.width - canvas.safePaddingMm * 2);
  const safe = canvas.safePaddingMm;
  const defaults = defaultZonesForCanvas(canvas);
  const source = Array.isArray(input) && input.length ? input : defaults;
  const seen = new Set();
  const zones = source.map((zone, index) => {
    const raw = isPlainObject(zone) ? zone : {};
    const fallback = defaults[index] || defaults[defaults.length - 1];
    const id = cleanText(raw.id, 80) || fallback.id;
    const uniqueZoneId = seen.has(id) ? `${id}-${index + 1}` : id;
    seen.add(uniqueZoneId);
    const type = raw.type === 'flow' ? 'flow' : 'absolute';
    const frame = normalizeFrame(raw.frame, fallback.frame, {
      minX: 0,
      minY: 0,
      maxX: page.width,
      maxY: page.height,
      minW: 8,
      minH: 8,
      maxW: page.width,
      maxH: page.height,
    });
    return {
      id: uniqueZoneId,
      type,
      frame: {
        x: roundMm(Math.min(Math.max(0, frame.x), page.width - 1)),
        y: roundMm(Math.min(Math.max(0, frame.y), page.height - 1)),
        w: roundMm(Math.min(frame.w, Math.max(1, page.width - frame.x))),
        h: roundMm(Math.min(frame.h, Math.max(1, page.height - frame.y))),
      },
    };
  });

  const pageZone = { id: PAGE_ZONE_ID, type: 'absolute', frame: { x: 0, y: 0, w: page.width, h: page.height } };
  const nonPageZones = zones.filter(zone => zone.id !== PAGE_ZONE_ID);

  if (!nonPageZones.some(zone => zone.id === 'header')) nonPageZones.unshift({ id: 'header', type: 'absolute', frame: { x: safe, y: safe, w: contentWidth, h: 34 } });
  if (!nonPageZones.some(zone => zone.id === 'body')) nonPageZones.push({ id: 'body', type: 'flow', frame: { x: safe, y: safe + 38, w: contentWidth, h: Math.max(24, page.height - safe * 2 - 76) } });
  if (!nonPageZones.some(zone => zone.id === 'footer')) nonPageZones.push({ id: 'footer', type: 'absolute', frame: { x: safe, y: Math.max(safe + 80, page.height - safe - 54), w: contentWidth, h: 34 } });
  if (!nonPageZones.some(zone => zone.id === 'signatures')) nonPageZones.push({ id: 'signatures', type: 'absolute', frame: { x: safe, y: Math.max(safe + 100, page.height - safe - 18), w: contentWidth, h: 18 } });
  return [pageZone, ...nonPageZones];
}

function normalizeCanvas(input = {}, template = {}) {
  const raw = isPlainObject(input) ? input : {};
  const pageSize = normalizePaperSize(raw.pageSize || raw.paperSize || template.paper_size || 'A5');
  const orientation = normalizeOrientation(raw.orientation || template.orientation || 'portrait', pageSize);
  return {
    pageSize,
    orientation,
    unit: 'mm',
    safePaddingMm: roundMm(clampNumber(raw.safePaddingMm, 0, 30, pageSize.startsWith('K') ? 3 : 5)),
    snapGridMm: roundMm(clampNumber(raw.snapGridMm, 0.1, 10, 1)),
  };
}

function defaultZonesForCanvas(canvas) {
  const page = getPaperDimensions(canvas.pageSize, canvas.orientation);
  const safe = canvas.safePaddingMm;
  const contentWidth = Math.max(20, page.width - safe * 2);
  const gap = canvas.pageSize.startsWith('K') ? 2.5 : 3;
  const headerHeight = Math.min(page.height * 0.22, canvas.pageSize.startsWith('K') ? 38 : 28);
  const footerHeight = Math.min(page.height * 0.22, canvas.pageSize.startsWith('K') ? 38 : 28);
  const signatureHeight = Math.min(page.height * 0.14, canvas.pageSize.startsWith('K') ? 20 : 15);
  const headerY = safe;
  const bodyY = headerY + headerHeight + gap;
  const signatureY = Math.max(bodyY + 28, page.height - safe - signatureHeight);
  const footerY = Math.max(bodyY + 20, signatureY - gap - footerHeight);
  const bodyHeight = Math.max(24, footerY - bodyY - gap);
  return [
    { id: 'header', type: 'absolute', frame: { x: safe, y: headerY, w: contentWidth, h: headerHeight } },
    { id: 'body', type: 'flow', frame: { x: safe, y: bodyY, w: contentWidth, h: bodyHeight } },
    { id: 'footer', type: 'absolute', frame: { x: safe, y: footerY, w: contentWidth, h: footerHeight } },
    { id: 'signatures', type: 'absolute', frame: { x: safe, y: signatureY, w: contentWidth, h: signatureHeight } },
  ].map(zone => ({ ...zone, frame: normalizeFrame(zone.frame, zone.frame) }));
}

function defaultFrameForType(type, zone = {}) {
  const zw = Number(zone?.frame?.w) || 100;
  const zh = Number(zone?.frame?.h) || 30;
  switch (type) {
    case 'logo': return { x: 0, y: 0, w: Math.min(22, zw), h: Math.min(22, zh) };
    case 'storeInfo': return { x: Math.min(24, zw * 0.35), y: 0, w: Math.max(18, Math.min(48, zw * 0.4)), h: Math.min(24, zh) };
    case 'invoiceTitle': return { x: Math.max(0, zw - Math.min(44, zw * 0.38)), y: 0, w: Math.min(44, zw), h: Math.min(18, zh) };
    case 'customerInfo': return { x: 0, y: Math.max(0, zh - 11), w: Math.max(24, Math.min(76, zw * 0.58)), h: Math.min(11, zh) };
    case 'invoiceMeta': return { x: Math.max(0, zw - Math.max(24, zw * 0.36)), y: Math.max(0, zh - 11), w: Math.max(24, zw * 0.36), h: Math.min(11, zh) };
    case 'totals': return { x: Math.max(0, zw - Math.min(54, zw * 0.42)), y: 0, w: Math.min(54, zw), h: Math.min(25, zh) };
    case 'note': return { x: Math.min(34, zw * 0.34), y: 0, w: Math.max(22, Math.min(42, zw * 0.32)), h: Math.min(18, zh) };
    case 'signatures': return { x: 0, y: 0, w: zw, h: Math.min(18, zh) };
    case 'footerText': return { x: 0, y: Math.max(0, zh - 8), w: zw, h: Math.min(8, zh) };
    case 'line': return { x: 0, y: Math.min(6, zh / 2), w: Math.min(40, zw), h: 1 };
    case 'rectangle': return { x: 0, y: 0, w: Math.min(35, zw), h: Math.min(14, zh) };
    case 'image': return { x: 0, y: 0, w: Math.min(24, zw), h: Math.min(24, zh) };
    case 'customText':
    case 'text':
    default: return { x: 0, y: 0, w: Math.min(46, zw), h: Math.min(12, zh) };
  }
}

function makeElement(id, type, zoneId, frame, options = {}) {
  return {
    id,
    type,
    zoneId,
    frame,
    visible: options.visible !== false,
    locked: options.locked === true,
    zIndex: Number.isInteger(options.zIndex) ? options.zIndex : 0,
    ...(options.bindings ? { bindings: options.bindings } : {}),
    style: { ...defaultStyleForType(type), ...(options.style || {}) },
  };
}

export function createDefaultEditorDocument(options = {}) {
  const canvas = normalizeCanvas({
    pageSize: options.paperSize || options.paper_size || 'A5',
    orientation: options.orientation || 'portrait',
    safePaddingMm: options.safePaddingMm,
    snapGridMm: options.snapGridMm,
  }, options.template || {});
  const zones = defaultZonesForCanvas(canvas);
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  const header = zonesById.get('header');
  const body = zonesById.get('body');
  const footer = zonesById.get('footer');
  const signatures = zonesById.get('signatures');
  const headerW = header.frame.w;
  const footerW = footer.frame.w;
  const signatureW = signatures.frame.w;
  const logoSize = Math.min(18, header.frame.h - 2, headerW * 0.2);
  const tableFrame = { x: 0, y: 0, w: body.frame.w, h: 'auto' };

  const elements = [
    makeElement('logo', 'logo', 'header', { x: 0, y: 0, w: logoSize, h: logoSize }, { bindings: { source: 'template.logo' }, zIndex: 10, visible: false }),
    makeElement('storeInfo', 'storeInfo', 'header', { x: 0, y: 0, w: Math.max(58, headerW * 0.5), h: Math.min(18, header.frame.h) }, { zIndex: 20 }),
    makeElement('invoiceTitle', 'invoiceTitle', 'header', { x: Math.max(0, headerW - Math.max(42, headerW * 0.32)), y: 0, w: Math.max(42, headerW * 0.32), h: Math.min(12, header.frame.h) }, { zIndex: 30, style: { titleText: 'HÓA ĐƠN BÁN HÀNG', showSubtitle: false, showInvoiceCode: false, align: 'right', fontSizePt: 12.5 } }),
    makeElement('customerInfo', 'customerInfo', 'header', { x: 0, y: Math.max(0, header.frame.h - 9), w: Math.max(52, headerW * 0.62), h: 8.5 }, { zIndex: 40 }),
    makeElement('invoiceMeta', 'invoiceMeta', 'header', { x: Math.max(0, headerW * 0.64), y: Math.max(0, header.frame.h - 9), w: Math.max(32, headerW * 0.36), h: 8.5 }, { zIndex: 45, style: { showPaymentMethod: false, showSeller: false } }),
    makeElement('totals', 'totals', 'footer', { x: Math.max(0, footerW - Math.max(44, footerW * 0.4)), y: 0, w: Math.max(44, footerW * 0.4), h: Math.min(20, footer.frame.h) }, { zIndex: 20 }),
    makeElement('note', 'note', 'footer', { x: 0, y: 0, w: Math.max(28, footerW * 0.38), h: Math.min(14, footer.frame.h) }, { zIndex: 15 }),
    makeElement('footerText', 'footerText', 'footer', { x: 0, y: Math.max(0, footer.frame.h - 5), w: footerW, h: Math.min(5, footer.frame.h) }, { zIndex: 35 }),
    makeElement('signatures', 'signatures', 'signatures', { x: 0, y: 0, w: signatureW, h: Math.min(14, signatures.frame.h) }, { zIndex: 30 }),
    defaultTableStyleElement(body, tableFrame),
  ];

  return {
    schema_version: EDITOR_SCHEMA_VERSION,
    canvas,
    zones,
    elements,
    table: {
      id: 'itemsTable',
      zoneId: 'body',
      frame: tableFrame,
      headerRepeat: true,
      allowPageBreak: true,
      columns: fitTableColumnsToFrame(DEFAULT_TABLE_COLUMNS, body.frame.w),
    },
    theme: {
      primaryColor: '#111827',
      mutedColor: '#64748b',
      borderColor: '#cbd5e1',
    },
    print: {
      forceWhiteBackground: true,
      exactColorAdjust: true,
    },
  };
}

export function createDefaultEditorSettings(options = {}) {
  const revision = Math.max(1, Math.trunc(Number(options.revision) || 1));
  return {
    schema_version: EDITOR_SCHEMA_VERSION,
    renderMode: 'hybrid-dom',
    editor: {
      showGrid: options.showGrid !== false,
      showRuler: options.showRuler !== false,
      showSafeArea: options.showSafeArea !== false,
      zoom: clampNumber(options.zoom, 0.2, 4, 1),
      snapEnabled: options.snapEnabled !== false,
      snapGridMm: clampNumber(options.snapGridMm, 0.1, 10, 1),
    },
    publish: {
      revision,
      hasDraft: options.hasDraft === true,
    },
    migration: {
      sourceSchemaVersion: Math.max(1, Math.trunc(Number(options.sourceSchemaVersion) || 2)),
      migratedAt: options.migratedAt || null,
      migratedBy: options.migratedBy || null,
    },
  };
}

export function normalizeEditorSettings(input = {}, options = {}) {
  const raw = isPlainObject(input) ? input : {};
  const defaults = createDefaultEditorSettings(options);
  const editor = isPlainObject(raw.editor) ? raw.editor : {};
  const publish = isPlainObject(raw.publish) ? raw.publish : {};
  const migration = isPlainObject(raw.migration) ? raw.migration : {};
  return {
    ...defaults,
    renderMode: cleanText(raw.renderMode || raw.render_mode, 40) || defaults.renderMode,
    editor: {
      ...defaults.editor,
      showGrid: editor.showGrid !== false,
      showRuler: editor.showRuler !== false,
      showSafeArea: editor.showSafeArea !== false,
      zoom: clampNumber(editor.zoom, 0.2, 4, defaults.editor.zoom),
      snapEnabled: editor.snapEnabled !== false,
      snapGridMm: clampNumber(editor.snapGridMm, 0.1, 10, defaults.editor.snapGridMm),
    },
    publish: {
      revision: Math.max(1, Math.trunc(Number(publish.revision) || options.revision || defaults.publish.revision)),
      hasDraft: publish.hasDraft === true || options.hasDraft === true,
    },
    migration: {
      sourceSchemaVersion: Math.max(1, Math.trunc(Number(migration.sourceSchemaVersion) || options.sourceSchemaVersion || defaults.migration.sourceSchemaVersion)),
      migratedAt: migration.migratedAt || null,
      migratedBy: migration.migratedBy || null,
    },
  };
}

function toPageFrame(frame = {}, zone = {}) {
  return {
    ...frame,
    x: roundMm(Number(zone?.frame?.x || 0) + Number(frame.x || 0)),
    y: roundMm(Number(zone?.frame?.y || 0) + Number(frame.y || 0)),
  };
}

function promoteDocumentToPageZone(document = {}) {
  const zones = Array.isArray(document.zones) ? document.zones : [];
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  const pageZone = zonesById.get(PAGE_ZONE_ID) || zones[0] || { id: PAGE_ZONE_ID, frame: { x: 0, y: 0, w: 80, h: 120 } };
  const table = document.table || {};
  const tableZone = zonesById.get(table.zoneId) || pageZone;
  const tablePageFrame = table.zoneId === PAGE_ZONE_ID
    ? (table.frame || {})
    : toPageFrame(table.frame || {}, tableZone);
  const nextTable = {
    ...table,
    zoneId: PAGE_ZONE_ID,
    frame: clampFrameToZone(tablePageFrame, pageZone, { minW: 12, minH: 8 }),
  };
  const defaultTableStyle = defaultTableStyleElement(pageZone, nextTable.frame);
  const elements = (document.elements || []).map(element => {
    if (element.id === TABLE_STYLE_ELEMENT_ID) {
      return {
        ...defaultTableStyle,
        ...element,
        id: TABLE_STYLE_ELEMENT_ID,
        type: TABLE_STYLE_ELEMENT_TYPE,
        zoneId: PAGE_ZONE_ID,
        frame: defaultTableStyle.frame,
        visible: false,
        locked: true,
        style: { ...defaultTableStyle.style, ...(element.style || {}) },
      };
    }

    const zone = zonesById.get(element.zoneId) || pageZone;
    const pageFrame = element.zoneId === PAGE_ZONE_ID
      ? (element.frame || {})
      : toPageFrame(element.frame || {}, zone);

    return {
      ...element,
      zoneId: PAGE_ZONE_ID,
      frame: clampFrameToZone(pageFrame, pageZone, { minW: element.type === 'line' ? 2 : 3, minH: element.type === 'line' ? 0.5 : 3 }),
    };
  });

  if (!elements.some(element => element.id === TABLE_STYLE_ELEMENT_ID)) {
    elements.push(defaultTableStyle);
  }

  return {
    ...document,
    zones,
    elements,
    table: nextTable,
  };
}

export function normalizeEditorDocument(input = {}, template = {}) {
  if (!isPlainObject(input) || Number(input.schema_version || input.schemaVersion) !== EDITOR_SCHEMA_VERSION) {
    return normalizeEditorDocument(createDefaultEditorDocument({ paperSize: template.paper_size, orientation: template.orientation, template }), template);
  }

  const canvas = normalizeCanvas(input.canvas, template);
  const zones = normalizeZones(input.zones, canvas);
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  const elementsSource = Array.isArray(input.elements) ? input.elements.filter(element => element?.type !== 'paymentQr') : [];
  const normalizedElements = elementsSource.map((element, index) => normalizeElement(element, zonesById, index));
  const bodyZone = zonesById.get('body') || zones[0];
  const tableSource = isPlainObject(input.table) ? input.table : {};
  const tableFrame = normalizeFrame(tableSource.frame, { x: 0, y: 0, w: bodyZone?.frame?.w || 100, h: 'auto' }, { allowAutoHeight: true });
  const normalizedTableFrame = clampFrameToZone(tableFrame, zonesById.get(tableSource.zoneId) || bodyZone, { minW: 12, minH: 8 });
  const table = {
    id: cleanText(tableSource.id, 80) || 'itemsTable',
    zoneId: zonesById.has(tableSource.zoneId) ? tableSource.zoneId : (bodyZone?.id || 'body'),
    frame: normalizedTableFrame,
    headerRepeat: tableSource.headerRepeat !== false,
    allowPageBreak: tableSource.allowPageBreak !== false,
    columns: fitTableColumnsToFrame((Array.isArray(tableSource.columns) && tableSource.columns.length ? tableSource.columns : DEFAULT_TABLE_COLUMNS).map(normalizeColumn), normalizedTableFrame.w),
  };

  const existingTableStyle = normalizedElements.find(element => element.id === TABLE_STYLE_ELEMENT_ID);
  const elements = existingTableStyle
    ? normalizedElements.map(element => (element.id === TABLE_STYLE_ELEMENT_ID
      ? { ...defaultTableStyleElement(bodyZone, table.frame), ...element, visible: false, locked: true, type: TABLE_STYLE_ELEMENT_TYPE, zoneId: table.zoneId, frame: defaultTableStyleElement(bodyZone, table.frame).frame, style: { ...defaultTableStyleElement(bodyZone, table.frame).style, ...element.style } }
      : element))
    : [...normalizedElements, defaultTableStyleElement(bodyZone, table.frame)];

  const normalizedDocument = {
    schema_version: EDITOR_SCHEMA_VERSION,
    canvas,
    zones,
    elements,
    table,
    theme: {
      primaryColor: cleanText(input.theme?.primaryColor, 40) || '#111827',
      mutedColor: cleanText(input.theme?.mutedColor, 40) || '#64748b',
      borderColor: cleanText(input.theme?.borderColor, 40) || '#cbd5e1',
    },
    print: {
      forceWhiteBackground: input.print?.forceWhiteBackground !== false,
      exactColorAdjust: input.print?.exactColorAdjust !== false,
    },
  };

  return promoteDocumentToPageZone(normalizedDocument);
}

function getDocumentSource(template = {}, preferDraft = true) {
  const editorDocument = isPlainObject(template.editor_document) ? template.editor_document : null;
  if (editorDocument) {
    if (preferDraft && isPlainObject(editorDocument.draft)) {
      return { source: 'draft', payload: editorDocument.draft, hasDraft: true };
    }
    if (isPlainObject(editorDocument.published)) {
      return { source: 'published', payload: editorDocument.published, hasDraft: editorDocument.has_draft === true };
    }
  }

  if (preferDraft && isPlainObject(template.draft_layout_v2)) {
    return { source: 'draft', payload: { layout_json: template.draft_layout_v2, settings_json: template.draft_settings_v2 }, hasDraft: true };
  }
  if (isPlainObject(template.layout_v2)) {
    return { source: 'published', payload: { layout_json: template.layout_v2, settings_json: template.settings_v2 }, hasDraft: Boolean(template.has_draft) };
  }
  return { source: 'published', payload: { layout_json: template.layout_json || template.layout, settings_json: template.settings_json || template.settings }, hasDraft: Boolean(template.has_draft) };
}

export function getActiveEditorDocument(template = {}, options = {}) {
  const preferDraft = options.preferDraft !== false;
  const { source, payload, hasDraft } = getDocumentSource(template, preferDraft);
  const revision = Math.max(1, Math.trunc(Number(template.revision || template.editor_document?.revision || payload?.settings_json?.publish?.revision || 1)));
  const document = normalizeEditorDocument(payload?.layout_json || payload?.layout || {}, template);
  const settings = normalizeEditorSettings(payload?.settings_json || payload?.settings || {}, {
    revision,
    hasDraft,
    sourceSchemaVersion: payload?.source_schema_version || template.template_schema_version || template.schema_version || 2,
  });
  return { document, settings, source, revision, hasDraft };
}

export function serializeEditorDocument(document = {}) {
  return normalizeEditorDocument(document);
}

export function buildTemplatePayloadFromDocument(template = {}, document = {}, settings = {}) {
  const normalizedDocument = normalizeEditorDocument(document, template);
  const normalizedSettings = normalizeEditorSettings(settings, {
    revision: template.revision,
    hasDraft: template.has_draft,
    sourceSchemaVersion: 2,
  });
  return {
    layout_json: normalizedDocument,
    settings_json: normalizedSettings,
    paper_size: normalizedDocument.canvas.pageSize,
    orientation: normalizedDocument.canvas.orientation,
  };
}

export function createEditorElement(type, document = {}, options = {}) {
  const normalizedType = VALID_ELEMENT_TYPES.has(type) ? type : 'customText';
  const zones = Array.isArray(document.zones) ? document.zones : [];
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  const definition = ELEMENT_DEFINITIONS.find(item => item.type === normalizedType) || ELEMENT_DEFINITIONS[ELEMENT_DEFINITIONS.length - 1];
  const zoneId = zonesById.has(options.zoneId) ? options.zoneId : (zonesById.has(definition.zoneId) ? definition.zoneId : zones[0]?.id || 'header');
  const zone = zonesById.get(zoneId) || zones[0] || { id: zoneId, frame: { w: 80, h: 30 } };
  const frame = clampFrameToZone(normalizeFrame(options.frame, defaultFrameForType(normalizedType, zone)), zone, { minW: normalizedType === 'line' ? 2 : 3, minH: normalizedType === 'line' ? 0.5 : 3 });
  const maxZIndex = Math.max(0, ...(Array.isArray(document.elements) ? document.elements.map(element => Number(element.zIndex) || 0) : [0]));
  return makeElement(uniqueId(normalizedType), normalizedType, zoneId, frame, {
    zIndex: maxZIndex + 10,
    bindings: normalizedType === 'logo' ? { source: 'template.logo' } : undefined,
    style: options.style || {},
  });
}

export function updateDocumentElement(document = {}, elementId, updater) {
  return {
    ...document,
    elements: (document.elements || []).map(element => {
      if (element.id !== elementId) return element;
      const next = typeof updater === 'function' ? updater(element) : { ...element, ...updater };
      return { ...element, ...next };
    }),
  };
}

export function updateDocumentTable(document = {}, updater) {
  const nextTable = typeof updater === 'function' ? updater(document.table || {}) : { ...(document.table || {}), ...updater };
  return { ...document, table: nextTable };
}

export function getElementLabel(element = {}) {
  if (element.id === TABLE_STYLE_ELEMENT_ID) return 'Cấu hình bảng sản phẩm';
  if (element.id === 'itemsTable' || element.type === 'itemsTable') return 'Khung sản phẩm';
  const definition = ELEMENT_DEFINITIONS.find(item => item.type === element.type);
  return definition?.label || element.type || 'Component';
}

export function buildEditorMeta(settings = {}, extra = {}) {
  const editor = settings?.editor || {};
  return {
    editor: {
      showGrid: editor.showGrid !== false,
      showRuler: editor.showRuler !== false,
      showSafeArea: editor.showSafeArea !== false,
      zoom: clampNumber(editor.zoom, 0.2, 4, 1),
      snapEnabled: editor.snapEnabled !== false,
      snapGridMm: clampNumber(editor.snapGridMm, 0.1, 10, 1),
    },
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}
