import { getPaperDimensions } from '../templateDefaults';

export const EDITOR_SCHEMA_VERSION = 2;
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
  { key: 'name', label: 'Tên sản phẩm', widthMm: 54, align: 'left' },
  { key: 'unit', label: 'Đơn vị', widthMm: 13, align: 'center' },
  { key: 'qty', label: 'Số lượng', widthMm: 13, align: 'center' },
  { key: 'unitPrice', label: 'Đơn giá', widthMm: 21, align: 'right' },
  { key: 'discount', label: 'Chiết khấu', widthMm: 21, align: 'right' },
  { key: 'lineTotal', label: 'Thành tiền', widthMm: 22, align: 'right' },
]);

export const ELEMENT_DEFINITIONS = Object.freeze([
  { type: 'logo', label: 'Logo hóa đơn', group: 'Thương hiệu', zoneId: 'header' },
  { type: 'storeInfo', label: 'Thông tin cửa hàng', group: 'Thương hiệu', zoneId: 'header' },
  { type: 'invoiceTitle', label: 'Tiêu đề hóa đơn', group: 'Đơn hàng', zoneId: 'header' },
  { type: 'customerInfo', label: 'Thông tin khách hàng', group: 'Khách hàng', zoneId: 'header' },
  { type: 'invoiceMeta', label: 'Thông tin đơn hàng', group: 'Đơn hàng', zoneId: 'header' },
  { type: 'paymentQr', label: 'Hình thức thanh toán / QR', group: 'Thanh toán', zoneId: 'footer' },
  { type: 'totals', label: 'Khu vực thanh toán', group: 'Thanh toán', zoneId: 'footer' },
  { type: 'note', label: 'Ghi chú', group: 'Footer', zoneId: 'footer' },
  { type: 'signatures', label: 'Chữ ký / con dấu', group: 'Footer', zoneId: 'footer' },
  { type: 'footerText', label: 'Footer cảm ơn', group: 'Footer', zoneId: 'footer' },
  { type: 'customText', label: 'Text tùy chỉnh', group: 'Tự do', zoneId: 'header' },
  { type: 'image', label: 'Ảnh URL', group: 'Tự do', zoneId: 'header' },
  { type: 'line', label: 'Đường kẻ', group: 'Trang trí', zoneId: 'header' },
  { type: 'rectangle', label: 'Khung viền', group: 'Trang trí', zoneId: 'header' },
]);

const VALID_ELEMENT_TYPES = new Set(ELEMENT_DEFINITIONS.map(item => item.type));
const VALID_TABLE_COLUMN_KEYS = new Set(Object.keys(TABLE_COLUMN_LABELS));
const VALID_ALIGN = new Set(['left', 'center', 'right']);
const VALID_PAPER_SIZES = new Set(['A4', 'A5', 'K80', 'K58']);

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
  const paperSize = cleanText(value || fallback, 20).toUpperCase();
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
        borderColor: '#bfdbfe',
        backgroundColor: '#eff6ff',
      };
    case 'storeInfo':
      return { ...commonText, fontSizePt: 8.3, bold: true, uppercase: true };
    case 'invoiceTitle':
      return { ...commonText, fontSizePt: 13, bold: true, align: 'right', color: '#0f172a' };
    case 'customerInfo':
      return { ...commonText, fontSizePt: 7.8, lineHeight: 1.2, labelWidthMm: 18, bold: false };
    case 'invoiceMeta':
      return { ...commonText, fontSizePt: 7.8, lineHeight: 1.2, labelWidthMm: 18, align: 'right' };
    case 'paymentQr':
      return {
        ...commonText,
        fontSizePt: 7.5,
        qrSizeMm: 17,
        showIcon: true,
        icon: 'qr',
        paddingMm: 1.2,
        borderWidthMm: 0.2,
        borderColor: '#e2e8f0',
        borderRadiusMm: 2,
        backgroundColor: '#ffffff',
      };
    case 'totals':
      return {
        ...commonText,
        fontSizePt: 8,
        highlightColor: '#eff6ff',
        paddingMm: 1.4,
        borderWidthMm: 0.2,
        borderColor: '#e2e8f0',
        borderRadiusMm: 2,
      };
    case 'note':
      return { ...commonText, fontSizePt: 7.8, color: '#78350f', backgroundColor: '#fffbeb', paddingMm: 1.4, borderRadiusMm: 2 };
    case 'signatures':
      return { ...commonText, fontSizePt: 8, align: 'center', signatureGapMm: 10, blankHeightMm: 10 };
    case 'footerText':
      return { ...commonText, fontSizePt: 7.2, align: 'center', color: '#64748b' };
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
      borderColor: '#cbd5e1',
      headerBackgroundColor: '#e2e8f0',
      headerColor: '#0f172a',
      paddingMm: 1.35,
      rowGapMm: 0,
      fontSizePt: 8.2,
      headerFontSizePt: 7.6,
      lineHeight: 1.18,
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

  if (!zones.some(zone => zone.id === 'header')) zones.unshift({ id: 'header', type: 'absolute', frame: { x: safe, y: safe, w: contentWidth, h: 34 } });
  if (!zones.some(zone => zone.id === 'body')) zones.push({ id: 'body', type: 'flow', frame: { x: safe, y: safe + 38, w: contentWidth, h: Math.max(24, page.height - safe * 2 - 76) } });
  if (!zones.some(zone => zone.id === 'footer')) zones.push({ id: 'footer', type: 'absolute', frame: { x: safe, y: Math.max(safe + 80, page.height - safe - 34), w: contentWidth, h: 34 } });
  return zones;
}

function normalizeCanvas(input = {}, template = {}) {
  const raw = isPlainObject(input) ? input : {};
  const pageSize = normalizePaperSize(raw.pageSize || raw.paperSize || template.paper_size || 'A5');
  const orientation = normalizeOrientation(raw.orientation || template.orientation || 'portrait', pageSize);
  return {
    pageSize,
    orientation,
    unit: 'mm',
    safePaddingMm: roundMm(clampNumber(raw.safePaddingMm, 0, 30, pageSize.startsWith('K') ? 4 : 8)),
    snapGridMm: roundMm(clampNumber(raw.snapGridMm, 0.1, 10, 1)),
  };
}

function defaultZonesForCanvas(canvas) {
  const page = getPaperDimensions(canvas.pageSize, canvas.orientation);
  const safe = canvas.safePaddingMm;
  const contentWidth = Math.max(20, page.width - safe * 2);
  const gap = canvas.pageSize.startsWith('K') ? 3 : 4;
  const headerHeight = Math.min(page.height * 0.25, canvas.pageSize.startsWith('K') ? 42 : 34);
  const footerHeight = Math.min(page.height * 0.25, canvas.pageSize.startsWith('K') ? 48 : 34);
  const headerY = safe;
  const bodyY = headerY + headerHeight + gap;
  const footerY = Math.max(bodyY + 20, page.height - safe - footerHeight);
  const bodyHeight = Math.max(24, footerY - bodyY - gap);
  return [
    { id: 'header', type: 'absolute', frame: { x: safe, y: headerY, w: contentWidth, h: headerHeight } },
    { id: 'body', type: 'flow', frame: { x: safe, y: bodyY, w: contentWidth, h: bodyHeight } },
    { id: 'footer', type: 'absolute', frame: { x: safe, y: footerY, w: contentWidth, h: footerHeight } },
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
    case 'paymentQr': return { x: 0, y: 0, w: Math.min(32, zw * 0.36), h: Math.min(30, zh) };
    case 'totals': return { x: Math.max(0, zw - Math.min(54, zw * 0.42)), y: 0, w: Math.min(54, zw), h: Math.min(25, zh) };
    case 'note': return { x: Math.min(34, zw * 0.34), y: 0, w: Math.max(22, Math.min(42, zw * 0.32)), h: Math.min(22, zh) };
    case 'signatures': return { x: 0, y: Math.max(0, zh - Math.min(18, zh)), w: zw, h: Math.min(18, zh) };
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
  const headerW = header.frame.w;
  const footerW = footer.frame.w;
  const logoSize = Math.min(22, header.frame.h - 2, headerW * 0.24);
  const tableFrame = { x: 0, y: 0, w: body.frame.w, h: 'auto' };

  const elements = [
    makeElement('logo', 'logo', 'header', { x: 0, y: 0, w: logoSize, h: logoSize }, { bindings: { source: 'template.logo' }, zIndex: 10 }),
    makeElement('storeInfo', 'storeInfo', 'header', { x: logoSize + 2, y: 0, w: Math.max(28, Math.min(52, headerW * 0.42)), h: Math.min(24, header.frame.h) }, { zIndex: 20 }),
    makeElement('invoiceTitle', 'invoiceTitle', 'header', { x: Math.max(0, headerW - Math.max(38, headerW * 0.34)), y: 0, w: Math.max(38, headerW * 0.34), h: Math.min(18, header.frame.h) }, { zIndex: 30 }),
    makeElement('customerInfo', 'customerInfo', 'header', { x: 0, y: Math.max(0, header.frame.h - 11), w: Math.max(42, headerW * 0.58), h: 10 }, { zIndex: 40 }),
    makeElement('invoiceMeta', 'invoiceMeta', 'header', { x: Math.max(0, headerW * 0.62), y: Math.max(0, header.frame.h - 11), w: Math.max(32, headerW * 0.38), h: 10 }, { zIndex: 45 }),
    makeElement('paymentQr', 'paymentQr', 'footer', { x: 0, y: 0, w: Math.min(32, footerW * 0.36), h: Math.min(30, footer.frame.h) }, { zIndex: 10 }),
    makeElement('totals', 'totals', 'footer', { x: Math.max(0, footerW - Math.max(44, footerW * 0.42)), y: 0, w: Math.max(44, footerW * 0.42), h: Math.min(25, footer.frame.h) }, { zIndex: 20 }),
    makeElement('note', 'note', 'footer', { x: Math.min(34, footerW * 0.33), y: 0, w: Math.max(24, footerW * 0.28), h: Math.min(22, footer.frame.h) }, { zIndex: 15 }),
    makeElement('signatures', 'signatures', 'footer', { x: 0, y: Math.max(0, footer.frame.h - 18), w: footerW, h: Math.min(14, footer.frame.h) }, { zIndex: 30 }),
    makeElement('footerText', 'footerText', 'footer', { x: 0, y: Math.max(0, footer.frame.h - 5), w: footerW, h: Math.min(5, footer.frame.h) }, { zIndex: 35 }),
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
      columns: cloneJson(DEFAULT_TABLE_COLUMNS),
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

export function normalizeEditorDocument(input = {}, template = {}) {
  if (!isPlainObject(input) || Number(input.schema_version || input.schemaVersion) !== EDITOR_SCHEMA_VERSION) {
    return createDefaultEditorDocument({ paperSize: template.paper_size, orientation: template.orientation, template });
  }

  const canvas = normalizeCanvas(input.canvas, template);
  const zones = normalizeZones(input.zones, canvas);
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  const elementsSource = Array.isArray(input.elements) ? input.elements : [];
  const normalizedElements = elementsSource.map((element, index) => normalizeElement(element, zonesById, index));
  const bodyZone = zonesById.get('body') || zones[0];
  const tableSource = isPlainObject(input.table) ? input.table : {};
  const tableFrame = normalizeFrame(tableSource.frame, { x: 0, y: 0, w: bodyZone?.frame?.w || 100, h: 'auto' }, { allowAutoHeight: true });
  const table = {
    id: cleanText(tableSource.id, 80) || 'itemsTable',
    zoneId: zonesById.has(tableSource.zoneId) ? tableSource.zoneId : (bodyZone?.id || 'body'),
    frame: clampFrameToZone(tableFrame, zonesById.get(tableSource.zoneId) || bodyZone, { minW: 12, minH: 8 }),
    headerRepeat: tableSource.headerRepeat !== false,
    allowPageBreak: tableSource.allowPageBreak !== false,
    columns: (Array.isArray(tableSource.columns) && tableSource.columns.length ? tableSource.columns : DEFAULT_TABLE_COLUMNS).map(normalizeColumn),
  };

  const existingTableStyle = normalizedElements.find(element => element.id === TABLE_STYLE_ELEMENT_ID);
  const elements = existingTableStyle
    ? normalizedElements.map(element => (element.id === TABLE_STYLE_ELEMENT_ID
      ? { ...defaultTableStyleElement(bodyZone, table.frame), ...element, visible: false, locked: true, type: TABLE_STYLE_ELEMENT_TYPE, zoneId: table.zoneId, frame: defaultTableStyleElement(bodyZone, table.frame).frame, style: { ...defaultTableStyleElement(bodyZone, table.frame).style, ...element.style } }
      : element))
    : [...normalizedElements, defaultTableStyleElement(bodyZone, table.frame)];

  return {
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
