const {
  DEFAULT_TABLE_COLUMNS,
  TABLE_COLUMN_LABELS,
  cleanText,
  cloneJson,
  getPaperDimensions,
  isPlainObject,
  normalizeOrientation,
  normalizePaperSize,
  toBoolean,
} = require('./printTemplateDocumentAdapter');

const VALID_ELEMENT_TYPES = new Set([
  'logo',
  'storeInfo',
  'invoiceTitle',
  'customerInfo',
  'invoiceMeta',
  'totals',
  'signatures',
  'note',
  'footerText',
  'text',
  'image',
  'line',
  'rectangle',
  'separator',
  'customText',
]);

const VALID_ZONE_TYPES = new Set(['absolute', 'flow']);
const VALID_ALIGNS = new Set(['left', 'center', 'right']);
const VALID_TABLE_COLUMN_KEYS = new Set(Object.keys(TABLE_COLUMN_LABELS));
const MAX_ELEMENTS = 200;
const MAX_ZONES = 30;
const MAX_TABLE_COLUMNS = 20;
const MAX_JSON_META_BYTES = 128 * 1024;
const MAX_STYLE_BYTES = 64 * 1024;

function pushError(errors, field, message) {
  errors.push({ field, message });
}

function toNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function roundMm(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function normalizeId(value, fallback, errors, field) {
  const id = cleanText(value, 80) || fallback;
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(id)) {
    pushError(errors, field, 'ID chỉ được chứa chữ, số, dấu gạch ngang, gạch dưới, dấu chấm hoặc dấu hai chấm.');
    return fallback;
  }
  return id;
}

function normalizeFrame(value, errors, field, options = {}) {
  if (!isPlainObject(value)) {
    pushError(errors, field, 'Frame phải là object { x, y, w, h }.');
    return { x: 0, y: 0, w: 1, h: options.allowAutoHeight ? 'auto' : 1 };
  }

  const x = toNumber(value.x, NaN, { min: -1000, max: 1000 });
  const y = toNumber(value.y, NaN, { min: -1000, max: 1000 });
  const w = toNumber(value.w, NaN, { min: 0.1, max: 1000 });
  const rawH = value.h;
  const h = rawH === 'auto' && options.allowAutoHeight
    ? 'auto'
    : toNumber(rawH, NaN, { min: 0.1, max: 1000 });

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || (h !== 'auto' && !Number.isFinite(h))) {
    pushError(errors, field, 'Frame phải có x, y, w, h là số hợp lệ theo đơn vị mm.');
  }

  return {
    x: Number.isFinite(x) ? roundMm(x) : 0,
    y: Number.isFinite(y) ? roundMm(y) : 0,
    w: Number.isFinite(w) ? roundMm(w) : 1,
    h: h === 'auto' ? 'auto' : (Number.isFinite(h) ? roundMm(h) : 1),
  };
}

function frameFitsInside(frame, parentFrame, toleranceMm = 0.25) {
  if (!frame || !parentFrame) return false;
  if (frame.h === 'auto') return frame.x >= -toleranceMm && frame.y >= -toleranceMm && frame.x + frame.w <= parentFrame.w + toleranceMm;
  return frame.x >= -toleranceMm
    && frame.y >= -toleranceMm
    && frame.x + frame.w <= parentFrame.w + toleranceMm
    && frame.y + frame.h <= parentFrame.h + toleranceMm;
}

function frameFitsPage(frame, pageDimensions, toleranceMm = 0.25) {
  if (!frame || !pageDimensions) return false;
  if (frame.h === 'auto') return frame.x >= -toleranceMm && frame.y >= -toleranceMm && frame.x + frame.w <= pageDimensions.width + toleranceMm;
  return frame.x >= -toleranceMm
    && frame.y >= -toleranceMm
    && frame.x + frame.w <= pageDimensions.width + toleranceMm
    && frame.y + frame.h <= pageDimensions.height + toleranceMm;
}

function normalizeColor(value, fallback) {
  const text = cleanText(value, 40);
  if (!text) return fallback;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return fallback;
}

function cloneBoundedObject(value, errors, field, maxBytes = MAX_STYLE_BYTES) {
  if (!isPlainObject(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, 'utf8') > maxBytes) {
      pushError(errors, field, `JSON vượt quá dung lượng cho phép ${maxBytes} bytes.`);
      return {};
    }
    return JSON.parse(json);
  } catch (_error) {
    pushError(errors, field, 'JSON object không hợp lệ.');
    return {};
  }
}

function normalizeCanvas(input, errors) {
  const canvas = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) pushError(errors, 'canvas', 'canvas là bắt buộc và phải là object.');
  const pageSize = normalizePaperSize(canvas.pageSize || canvas.paperSize || 'A5');
  const orientation = normalizeOrientation(canvas.orientation || 'portrait', pageSize);
  return {
    pageSize,
    orientation,
    unit: 'mm',
    safePaddingMm: roundMm(toNumber(canvas.safePaddingMm, pageSize.startsWith('K') ? 4 : 8, { min: 0, max: 30 })),
    snapGridMm: roundMm(toNumber(canvas.snapGridMm, 1, { min: 0.1, max: 10 })),
  };
}

function normalizeZones(input, errors, pageDimensions) {
  if (!Array.isArray(input) || input.length === 0) {
    pushError(errors, 'zones', 'layout v2 phải có ít nhất một zone.');
    return [];
  }
  if (input.length > MAX_ZONES) pushError(errors, 'zones', `Không được vượt quá ${MAX_ZONES} zones.`);

  const seen = new Set();
  const zones = [];
  input.slice(0, MAX_ZONES).forEach((zone, index) => {
    if (!isPlainObject(zone)) {
      pushError(errors, `zones[${index}]`, 'Zone phải là object.');
      return;
    }
    const id = normalizeId(zone.id, `zone-${index + 1}`, errors, `zones[${index}].id`);
    if (seen.has(id)) pushError(errors, `zones[${index}].id`, 'ID zone bị trùng.');
    seen.add(id);
    const type = VALID_ZONE_TYPES.has(cleanText(zone.type, 20)) ? cleanText(zone.type, 20) : 'absolute';
    const frame = normalizeFrame(zone.frame, errors, `zones[${index}].frame`);
    if (!frameFitsPage(frame, pageDimensions)) pushError(errors, `zones[${index}].frame`, 'Frame của zone vượt khỏi kích thước trang in.');
    zones.push({ id, type, frame });
  });
  return zones;
}

function normalizeBindings(input, errors, field) {
  if (!isPlainObject(input)) return undefined;
  const result = cloneBoundedObject(input, errors, field, 16 * 1024);
  if (result.source !== undefined) result.source = cleanText(result.source, 120);
  if (result.field !== undefined) result.field = cleanText(result.field, 120);
  if (result.format !== undefined) result.format = cleanText(result.format, 80);
  return result;
}

function normalizeElements(input, errors, zonesById) {
  if (!Array.isArray(input)) {
    pushError(errors, 'elements', 'elements phải là mảng.');
    return [];
  }
  if (input.length > MAX_ELEMENTS) pushError(errors, 'elements', `Không được vượt quá ${MAX_ELEMENTS} components trong một template.`);

  const seen = new Set();
  const elements = [];
  input.slice(0, MAX_ELEMENTS).forEach((element, index) => {
    if (!isPlainObject(element)) {
      pushError(errors, `elements[${index}]`, 'Element phải là object.');
      return;
    }
    const id = normalizeId(element.id, `element-${index + 1}`, errors, `elements[${index}].id`);
    if (seen.has(id)) pushError(errors, `elements[${index}].id`, 'ID element bị trùng.');
    seen.add(id);

    const type = cleanText(element.type, 40);
    if (type === 'paymentQr') return;
    if (!VALID_ELEMENT_TYPES.has(type)) pushError(errors, `elements[${index}].type`, `Loại component không được hỗ trợ: ${type || '(trống)'}.`);

    const zoneId = cleanText(element.zoneId || element.zone_id, 80);
    const zone = zonesById.get(zoneId);
    if (!zone) pushError(errors, `elements[${index}].zoneId`, 'Element tham chiếu zone không tồn tại.');

    const frame = normalizeFrame(element.frame, errors, `elements[${index}].frame`);
    if (zone && zone.type === 'absolute' && !frameFitsInside(frame, zone.frame)) {
      pushError(errors, `elements[${index}].frame`, 'Frame của component vượt khỏi zone chứa nó.');
    }

    const bindings = normalizeBindings(element.bindings, errors, `elements[${index}].bindings`);
    const style = cloneBoundedObject(element.style, errors, `elements[${index}].style`);
    const normalized = {
      id,
      type: VALID_ELEMENT_TYPES.has(type) ? type : 'text',
      zoneId,
      frame,
      visible: element.visible !== false,
      locked: element.locked === true,
      zIndex: Math.trunc(toNumber(element.zIndex, 0, { min: -10000, max: 10000 })),
    };
    if (bindings && Object.keys(bindings).length > 0) normalized.bindings = bindings;
    if (Object.keys(style).length > 0) normalized.style = style;
    elements.push(normalized);
  });
  return elements;
}

function normalizeTableColumns(input, errors) {
  const source = Array.isArray(input) && input.length > 0 ? input : DEFAULT_TABLE_COLUMNS;
  if (source.length > MAX_TABLE_COLUMNS) pushError(errors, 'table.columns', `Không được vượt quá ${MAX_TABLE_COLUMNS} cột bảng.`);
  const seen = new Set();
  const columns = [];

  source.slice(0, MAX_TABLE_COLUMNS).forEach((column, index) => {
    if (!isPlainObject(column)) {
      pushError(errors, `table.columns[${index}]`, 'Cột bảng phải là object.');
      return;
    }
    const key = cleanText(column.key, 50) === 'quantity' ? 'qty' : cleanText(column.key, 50);
    if (!VALID_TABLE_COLUMN_KEYS.has(key)) pushError(errors, `table.columns[${index}].key`, `Cột bảng không hợp lệ: ${key || '(trống)'}.`);
    if (seen.has(key)) pushError(errors, `table.columns[${index}].key`, 'Cột bảng bị trùng key.');
    seen.add(key);
    const align = cleanText(column.align, 20).toLowerCase();
    columns.push({
      key: VALID_TABLE_COLUMN_KEYS.has(key) ? key : 'name',
      label: cleanText(column.label, 80) || TABLE_COLUMN_LABELS[key] || key || 'Cột',
      widthMm: roundMm(toNumber(column.widthMm, 18, { min: 4, max: 120 })),
      align: VALID_ALIGNS.has(align) ? align : 'left',
    });
  });

  if (columns.length === 0) pushError(errors, 'table.columns', 'Bảng hàng hóa phải có ít nhất một cột hợp lệ.');
  return columns.length > 0 ? columns : cloneJson(DEFAULT_TABLE_COLUMNS);
}

function normalizeTable(input, errors, zonesById) {
  if (!isPlainObject(input)) {
    pushError(errors, 'table', 'layout v2 phải có table itemsTable.');
    return null;
  }
  const id = normalizeId(input.id, 'itemsTable', errors, 'table.id');
  const zoneId = cleanText(input.zoneId || input.zone_id || 'body', 80);
  const zone = zonesById.get(zoneId);
  if (!zone) pushError(errors, 'table.zoneId', 'Table tham chiếu zone không tồn tại.');
  const frame = normalizeFrame(input.frame, errors, 'table.frame', { allowAutoHeight: true });
  if (zone && !frameFitsInside(frame, zone.frame)) pushError(errors, 'table.frame', 'Frame của table vượt khỏi zone chứa nó.');

  return {
    id,
    zoneId,
    frame,
    headerRepeat: input.headerRepeat !== false,
    allowPageBreak: input.allowPageBreak !== false,
    columns: normalizeTableColumns(input.columns, errors),
  };
}

function validateLayoutV2(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: 'layout_json', message: 'layout_json phải là JSON object.' }], value: null };
  }
  if (Number(input.schema_version || input.schemaVersion) !== 2) {
    pushError(errors, 'schema_version', 'layout_json phải có schema_version = 2.');
  }

  const canvas = normalizeCanvas(input.canvas, errors);
  const pageDimensions = getPaperDimensions(canvas.pageSize, canvas.orientation);
  const zones = normalizeZones(input.zones, errors, pageDimensions);
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  const elements = normalizeElements(input.elements, errors, zonesById);
  const table = normalizeTable(input.table, errors, zonesById);
  const theme = isPlainObject(input.theme) ? input.theme : {};
  const print = isPlainObject(input.print) ? input.print : {};

  return {
    ok: errors.length === 0,
    errors,
    value: {
      schema_version: 2,
      canvas,
      zones,
      elements,
      table: table || {
        id: 'itemsTable',
        zoneId: zones[0]?.id || 'body',
        frame: { x: 0, y: 0, w: Math.max(1, pageDimensions.width - canvas.safePaddingMm * 2), h: 'auto' },
        headerRepeat: true,
        allowPageBreak: true,
        columns: cloneJson(DEFAULT_TABLE_COLUMNS),
      },
      theme: {
        primaryColor: normalizeColor(theme.primaryColor, '#111827'),
        mutedColor: normalizeColor(theme.mutedColor, '#64748b'),
        borderColor: normalizeColor(theme.borderColor, '#cbd5e1'),
      },
      print: {
        forceWhiteBackground: print.forceWhiteBackground !== false,
        exactColorAdjust: print.exactColorAdjust !== false,
      },
    },
  };
}

function validateSettingsV2(input = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: 'settings_json', message: 'settings_json phải là JSON object.' }], value: null };
  }
  const schemaVersion = Number(input.schema_version || input.schemaVersion || 2);
  if (schemaVersion !== 2) pushError(errors, 'settings_json.schema_version', 'settings_json v2 phải có schema_version = 2.');
  const editor = isPlainObject(input.editor) ? input.editor : {};
  const publish = isPlainObject(input.publish) ? input.publish : {};
  const migration = isPlainObject(input.migration) ? input.migration : {};

  return {
    ok: errors.length === 0,
    errors,
    value: {
      schema_version: 2,
      renderMode: cleanText(input.renderMode || input.render_mode, 40) || 'hybrid-dom',
      editor: {
        showGrid: toBoolean(editor.showGrid, true),
        showSafeArea: toBoolean(editor.showSafeArea, true),
        zoom: toNumber(editor.zoom, 1, { min: 0.2, max: 4 }),
        snapEnabled: toBoolean(editor.snapEnabled, true),
        snapGridMm: toNumber(editor.snapGridMm, 1, { min: 0.1, max: 10 }),
      },
      publish: {
        revision: Math.max(1, Math.trunc(toNumber(publish.revision, 1, { min: 1, max: Number.MAX_SAFE_INTEGER }))),
        hasDraft: toBoolean(publish.hasDraft, false),
      },
      migration: {
        sourceSchemaVersion: Math.max(1, Math.trunc(toNumber(migration.sourceSchemaVersion, 2, { min: 1, max: 2 }))),
        migratedAt: migration.migratedAt || null,
        migratedBy: migration.migratedBy || null,
      },
    },
  };
}

function validateEditorMetaJson(input = {}) {
  if (input === null) return { ok: true, errors: [], value: null };
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: 'editor_meta_json', message: 'editor_meta_json phải là JSON object.' }], value: null };
  }
  const value = cloneBoundedObject(input, errors, 'editor_meta_json', MAX_JSON_META_BYTES);
  return { ok: errors.length === 0, errors, value };
}

function formatValidationErrors(errors = []) {
  return (errors || [])
    .map(error => `${error.field}: ${error.message}`)
    .join('; ');
}

module.exports = {
  VALID_ELEMENT_TYPES,
  VALID_TABLE_COLUMN_KEYS,
  validateLayoutV2,
  validateSettingsV2,
  validateEditorMetaJson,
  formatValidationErrors,
};
