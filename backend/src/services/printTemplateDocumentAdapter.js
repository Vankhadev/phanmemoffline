const PAPER_DIMENSIONS_MM = Object.freeze({
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  K80: { width: 80, height: 220 },
  K58: { width: 58, height: 220 },
});

const TABLE_COLUMN_LABELS = Object.freeze({
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

const DEFAULT_TABLE_COLUMN_WIDTHS_MM = Object.freeze({
  no: 8,
  name: 54,
  sku: 18,
  unit: 13,
  qty: 13,
  quantity: 13,
  unitPrice: 21,
  discount: 21,
  lineTotal: 22,
  note: 24,
});

const DEFAULT_TABLE_COLUMNS = Object.freeze([
  { key: 'no', label: 'STT', widthMm: 8, align: 'center' },
  { key: 'name', label: 'Tên sản phẩm', widthMm: 54, align: 'left' },
  { key: 'unit', label: 'Đơn vị', widthMm: 13, align: 'center' },
  { key: 'qty', label: 'Số lượng', widthMm: 13, align: 'center' },
  { key: 'unitPrice', label: 'Đơn giá', widthMm: 21, align: 'right' },
  { key: 'discount', label: 'Chiết khấu', widthMm: 21, align: 'right' },
  { key: 'lineTotal', label: 'Thành tiền', widthMm: 22, align: 'right' },
]);

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, maxLength = 1000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  const normalized = cleanText(value, 20).toLowerCase();
  if (['true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function toNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function roundMm(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function normalizePaperSize(value) {
  const paperSize = cleanText(value || 'A5', 20).toUpperCase();
  return PAPER_DIMENSIONS_MM[paperSize] ? paperSize : 'A5';
}

function normalizeOrientation(value, paperSize = 'A5') {
  if (String(paperSize || '').toUpperCase().startsWith('K')) return 'portrait';
  return cleanText(value || 'portrait', 20).toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
}

function getPaperDimensions(paperSize = 'A5', orientation = 'portrait') {
  const normalizedPaperSize = normalizePaperSize(paperSize);
  const base = PAPER_DIMENSIONS_MM[normalizedPaperSize] || PAPER_DIMENSIONS_MM.A5;
  const normalizedOrientation = normalizeOrientation(orientation, normalizedPaperSize);
  if (!normalizedPaperSize.startsWith('K') && normalizedOrientation === 'landscape') {
    return { width: base.height, height: base.width, paperSize: normalizedPaperSize, orientation: normalizedOrientation };
  }
  return { ...base, paperSize: normalizedPaperSize, orientation: normalizedOrientation };
}

function detectTemplateSchemaVersion(layout = {}, settings = {}, explicitVersion = null) {
  const explicit = Number(explicitVersion);
  if (Number.isInteger(explicit) && explicit >= 1) return explicit >= 2 ? 2 : 1;
  const layoutVersion = Number(layout?.schema_version || layout?.schemaVersion);
  if (Number.isInteger(layoutVersion) && layoutVersion >= 2) return 2;
  const settingsVersion = Number(settings?.schema_version || settings?.schemaVersion);
  if (Number.isInteger(settingsVersion) && settingsVersion >= 2) return 2;
  return 1;
}

function isV2Layout(layout) {
  return isPlainObject(layout) && Number(layout.schema_version || layout.schemaVersion) === 2;
}

function isV2Settings(settings) {
  return isPlainObject(settings) && Number(settings.schema_version || settings.schemaVersion) === 2;
}

function normalizeColumnKey(value) {
  const key = cleanText(value, 50);
  if (key === 'quantity') return 'qty';
  return TABLE_COLUMN_LABELS[key] ? key : '';
}

function normalizeColumnAlign(value, fallback = 'left') {
  const align = cleanText(value, 20).toLowerCase();
  return ['left', 'center', 'right'].includes(align) ? align : fallback;
}

function defaultAlignForColumn(key) {
  if (['no', 'unit', 'qty', 'quantity'].includes(key)) return 'center';
  if (['unitPrice', 'discount', 'lineTotal'].includes(key)) return 'right';
  return 'left';
}

function normalizeLegacyColumns(table = {}) {
  const inputColumns = Array.isArray(table.columns) ? table.columns : [];
  const widths = isPlainObject(table.columnWidthsMm) ? table.columnWidthsMm : {};
  const result = [];
  const seen = new Set();

  for (const column of inputColumns) {
    const rawKey = typeof column === 'string' ? column : column?.key;
    const key = normalizeColumnKey(rawKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fallbackWidth = DEFAULT_TABLE_COLUMN_WIDTHS_MM[key] || 18;
    result.push({
      key,
      label: cleanText(typeof column === 'object' ? column.label : '', 80) || TABLE_COLUMN_LABELS[key] || key,
      widthMm: toNumber(typeof column === 'object' ? column.widthMm : widths[key], fallbackWidth, { min: 4, max: 120 }),
      align: normalizeColumnAlign(typeof column === 'object' ? column.align : '', defaultAlignForColumn(key)),
    });
  }

  return result.length > 0 ? result : cloneJson(DEFAULT_TABLE_COLUMNS);
}

function makeFrame(x, y, w, h) {
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: h === 'auto' ? 'auto' : roundMm(h) };
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
    ...(options.style ? { style: options.style } : {}),
  };
}

function buildDefaultV2Layout(options = {}) {
  const sourceLayout = isPlainObject(options.sourceLayout) ? options.sourceLayout : {};
  const sourceSettings = isPlainObject(options.sourceSettings) ? options.sourceSettings : {};
  const page = isPlainObject(sourceLayout.page) ? sourceLayout.page : {};
  const canvas = isPlainObject(sourceLayout.canvas) ? sourceLayout.canvas : {};
  const branding = isPlainObject(sourceLayout.branding) ? sourceLayout.branding : {};
  const content = isPlainObject(sourceLayout.content) ? sourceLayout.content : {};
  const table = isPlainObject(sourceLayout.table) ? sourceLayout.table : {};
  const flags = isPlainObject(sourceSettings.flags) ? sourceSettings.flags : {};
  const spacing = isPlainObject(sourceSettings.spacing) ? sourceSettings.spacing : {};
  const theme = isPlainObject(sourceLayout.theme) ? sourceLayout.theme : {};
  const print = isPlainObject(sourceLayout.print) ? sourceLayout.print : {};

  const paperSize = normalizePaperSize(pickFirst(options.paperSize, canvas.pageSize, sourceSettings.paperSize, sourceSettings.paper_size, page.size, 'A5'));
  const orientation = normalizeOrientation(pickFirst(options.orientation, canvas.orientation, sourceSettings.orientation, page.orientation, 'portrait'), paperSize);
  const dimensions = getPaperDimensions(paperSize, orientation);
  const safePaddingMm = toNumber(pickFirst(canvas.safePaddingMm, sourceSettings.paddingMm, sourceSettings.padding_mm, spacing.paddingMm, page.paddingMm), paperSize.startsWith('K') ? 4 : 8, { min: 0, max: 30 });
  const snapGridMm = toNumber(pickFirst(canvas.snapGridMm, sourceSettings.snapGridMm), 1, { min: 0.1, max: 10 });
  const contentWidth = Math.max(20, dimensions.width - safePaddingMm * 2);
  const pageHeight = Math.max(120, dimensions.height);
  const gap = paperSize.startsWith('K') ? 3 : 4;
  const headerHeight = Math.min(pageHeight * 0.25, paperSize.startsWith('K') ? 42 : 34);
  const footerHeight = Math.min(pageHeight * 0.25, paperSize.startsWith('K') ? 48 : 34);
  const headerY = safePaddingMm;
  const bodyY = headerY + headerHeight + gap;
  const footerY = Math.max(bodyY + 20, pageHeight - safePaddingMm - footerHeight);
  const bodyHeight = Math.max(24, footerY - bodyY - gap);
  const logoSize = Math.min(
    toNumber(pickFirst(branding.logoWidthMm, sourceSettings.headerLogoWidthMm, sourceSettings.header_logo_width_mm), paperSize.startsWith('K') ? 16 : 22, { min: 8, max: 45 }),
    Math.max(8, headerHeight - 4),
    Math.max(8, contentWidth * 0.35)
  );
  const showLogo = toBoolean(pickFirst(sourceSettings.showLogo, sourceSettings.show_logo, flags.showLogo, branding.showLogo), true);
  const showQr = toBoolean(pickFirst(sourceSettings.showQr, sourceSettings.show_qr, flags.showQr, content.showQr), true);
  const showSignatures = toBoolean(pickFirst(sourceSettings.showSignature, sourceSettings.show_signature, flags.showSignature, content.showSignatures), true);
  const showNote = toBoolean(pickFirst(sourceSettings.showNote, sourceSettings.show_note, flags.showNote, content.showNote), true);
  const showDebt = toBoolean(pickFirst(sourceSettings.showDebt, sourceSettings.show_debt, flags.showDebt, content.showDebt), true);
  const storeWidth = Math.max(18, Math.min(contentWidth - logoSize - 4, contentWidth * 0.42));
  const titleWidth = Math.max(18, contentWidth - logoSize - storeWidth - 6);
  const footerLeftWidth = Math.max(18, Math.min(32, contentWidth * 0.35));
  const totalsWidth = Math.max(20, Math.min(54, contentWidth * 0.42));

  return {
    schema_version: 2,
    canvas: {
      pageSize: paperSize,
      orientation,
      unit: 'mm',
      safePaddingMm: roundMm(safePaddingMm),
      snapGridMm: roundMm(snapGridMm),
    },
    zones: [
      { id: 'header', type: 'absolute', frame: makeFrame(safePaddingMm, headerY, contentWidth, headerHeight) },
      { id: 'body', type: 'flow', frame: makeFrame(safePaddingMm, bodyY, contentWidth, bodyHeight) },
      { id: 'footer', type: 'absolute', frame: makeFrame(safePaddingMm, footerY, contentWidth, footerHeight) },
    ],
    elements: [
      makeElement('logo', 'logo', 'header', makeFrame(0, 0, logoSize, logoSize), { visible: showLogo, bindings: { source: 'template.logo' }, zIndex: 10 }),
      makeElement('storeInfo', 'storeInfo', 'header', makeFrame(showLogo ? logoSize + 2 : 0, 0, storeWidth, Math.min(headerHeight, 24)), { zIndex: 20 }),
      makeElement('invoiceTitle', 'invoiceTitle', 'header', makeFrame(Math.max(0, contentWidth - titleWidth), 0, titleWidth, Math.min(headerHeight, 18)), { zIndex: 30 }),
      makeElement('customerInfo', 'customerInfo', 'header', makeFrame(0, Math.min(headerHeight - 10, Math.max(18, logoSize + 2)), Math.min(contentWidth, Math.max(30, contentWidth * 0.6)), 10), { zIndex: 40 }),
      makeElement('invoiceMeta', 'invoiceMeta', 'header', makeFrame(Math.max(0, contentWidth * 0.62), Math.min(headerHeight - 10, Math.max(18, logoSize + 2)), Math.max(20, contentWidth * 0.38), 10), { zIndex: 45 }),
      makeElement('paymentQr', 'paymentQr', 'footer', makeFrame(0, 0, footerLeftWidth, Math.min(footerHeight, footerLeftWidth)), { visible: showQr, zIndex: 10 }),
      makeElement('totals', 'totals', 'footer', makeFrame(Math.max(0, contentWidth - totalsWidth), 0, totalsWidth, Math.min(footerHeight, 24)), { visible: showDebt, zIndex: 20 }),
      makeElement('note', 'note', 'footer', makeFrame(Math.min(contentWidth - 18, footerLeftWidth + 2), 0, Math.max(18, contentWidth - footerLeftWidth - totalsWidth - 6), Math.min(footerHeight, 22)), { visible: showNote, zIndex: 15 }),
      makeElement('signatures', 'signatures', 'footer', makeFrame(0, Math.max(0, footerHeight - 18), contentWidth, Math.min(18, footerHeight)), { visible: showSignatures, zIndex: 30 }),
    ],
    table: {
      id: 'itemsTable',
      zoneId: 'body',
      frame: makeFrame(0, 0, contentWidth, 'auto'),
      headerRepeat: true,
      allowPageBreak: true,
      columns: normalizeLegacyColumns(table),
    },
    theme: {
      primaryColor: cleanText(theme.primaryColor, 40) || '#111827',
      mutedColor: cleanText(theme.mutedColor, 40) || '#64748b',
      borderColor: cleanText(theme.borderColor, 40) || '#cbd5e1',
    },
    print: {
      forceWhiteBackground: sourceLayout.print?.forceWhiteBackground !== false,
      exactColorAdjust: sourceLayout.print?.exactColorAdjust !== false,
    },
  };
}

function buildDefaultV2Settings(options = {}) {
  const revision = Number.isInteger(Number(options.revision)) && Number(options.revision) > 0 ? Number(options.revision) : 1;
  const sourceSchemaVersion = Number.isInteger(Number(options.sourceSchemaVersion)) ? Number(options.sourceSchemaVersion) : 2;
  return {
    schema_version: 2,
    renderMode: 'hybrid-dom',
    editor: {
      showGrid: true,
      showSafeArea: true,
      zoom: 1,
      snapEnabled: true,
      snapGridMm: 1,
    },
    publish: {
      revision,
      hasDraft: options.hasDraft === true,
    },
    migration: {
      sourceSchemaVersion,
      migratedAt: options.migratedAt || null,
      migratedBy: options.migratedBy || null,
    },
  };
}

function toEditorV2Document(options = {}) {
  const layout = isPlainObject(options.layout) ? options.layout : {};
  const settings = isPlainObject(options.settings) ? options.settings : {};
  const template = isPlainObject(options.template) ? options.template : {};
  const explicitVersion = options.templateSchemaVersion ?? template.template_schema_version;
  const schemaVersion = detectTemplateSchemaVersion(layout, settings, explicitVersion);
  const revision = Number(template.revision) || Number(options.revision) || 1;
  const hasDraft = options.hasDraft === true || template.has_draft === true;

  if (schemaVersion >= 2 && isV2Layout(layout)) {
    return {
      schemaVersion: 2,
      sourceSchemaVersion: 2,
      migrated: false,
      layout: cloneJson(layout),
      settings: isV2Settings(settings)
        ? cloneJson(settings)
        : buildDefaultV2Settings({ revision, hasDraft, sourceSchemaVersion: 2 }),
    };
  }

  return {
    schemaVersion: 2,
    sourceSchemaVersion: schemaVersion || 1,
    migrated: true,
    layout: buildDefaultV2Layout({
      sourceLayout: layout,
      sourceSettings: settings,
      paperSize: template.paper_size,
      orientation: template.orientation,
    }),
    settings: buildDefaultV2Settings({
      revision,
      hasDraft,
      sourceSchemaVersion: schemaVersion || 1,
      migratedAt: null,
      migratedBy: null,
    }),
  };
}

const DEFAULT_LAYOUT_V2 = Object.freeze(buildDefaultV2Layout());
const DEFAULT_SETTINGS_V2 = Object.freeze(buildDefaultV2Settings());

module.exports = {
  PAPER_DIMENSIONS_MM,
  DEFAULT_TABLE_COLUMNS,
  DEFAULT_TABLE_COLUMN_WIDTHS_MM,
  TABLE_COLUMN_LABELS,
  DEFAULT_LAYOUT_V2,
  DEFAULT_SETTINGS_V2,
  buildDefaultV2Layout,
  buildDefaultV2Settings,
  cleanText,
  cloneJson,
  detectTemplateSchemaVersion,
  getPaperDimensions,
  isPlainObject,
  isV2Layout,
  isV2Settings,
  normalizeOrientation,
  normalizePaperSize,
  toBoolean,
  toEditorV2Document,
};
