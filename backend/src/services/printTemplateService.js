const {
  ensurePrintTemplatesSchema,
  isPrintTemplatesTableMissingError,
  resetPrintTemplatesSchemaReady,
} = require('../db/printTemplatesSchema');
const { getPrintTemplatesPool, normalizePrintTemplatesMySqlError, query } = require('../db/printTemplatesMySql');
const {
  DEFAULT_LAYOUT_V2,
  DEFAULT_SETTINGS_V2,
  buildDefaultV2Settings,
  cloneJson,
  detectTemplateSchemaVersion,
  isPlainObject,
  isV2Layout,
  isV2Settings,
  normalizeOrientation: normalizeDocumentOrientation,
  normalizePaperSize: normalizeDocumentPaperSize,
  toEditorV2Document,
} = require('./printTemplateDocumentAdapter');
const {
  formatValidationErrors,
  validateEditorMetaJson,
  validateLayoutV2,
  validateSettingsV2,
} = require('./printTemplateLayoutValidator');

const DEFAULT_LAYOUT_JSON = Object.freeze({
  page: { size: 'A5', orientation: 'portrait', paddingMm: 8 },
  branding: { showLogo: true, logoWidthMm: 24, storeNameUppercase: true, headerBorder: true },
  content: { showCustomerTaxCode: true, showDeliveryDate: true, showCreator: true, showQr: false, showSignatures: true, showFooter: true },
  table: {
    fontSizePt: 9,
    headerFontSizePt: 9,
    lineClamp: 2,
    columns: ['no', 'name', 'qty', 'unitPrice', 'lineTotal'],
    columnWidthsMm: { no: 9, name: 55, qty: 14, unitPrice: 25, lineTotal: 28 },
  },
  totals: { showVat: true, showDiscount: true, showDeliveryFee: true },
  theme: { primaryColor: '#111827', mutedColor: '#6b7280', borderColor: '#d1d5db' },
  print: { forceWhiteBackground: true, exactColorAdjust: true },
});

const DEFAULT_SETTINGS_JSON = Object.freeze({ schema_version: 1 });
const PAPER_SIZES = new Set(['A5', 'A4', 'K80', 'K57', 'K58']);
const ORIENTATIONS = new Set(['portrait', 'landscape']);
const STATUSES = new Set(['draft', 'active', 'archived']);
const DEFAULT_TEMPLATE_SEED_CODE = 'mau-in-hoa-don-mac-dinh';
const DEFAULT_TEMPLATE_SEED_NAME = 'Mẫu in hóa đơn mặc định';
const DEFAULT_TEMPLATE_SEED_DESCRIPTION = 'Mẫu mặc định được backend tự tạo để API mẫu in hóa đơn luôn có dữ liệu MySQL thật ban đầu.';

let readyPromise = null;

function createHttpError(status, message, code = '', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = status >= 400 && status < 500;
  if (details && typeof details === 'object') error.details = details;
  return error;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function cleanText(value, maxLength = 1000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 1000) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeAccountId(value) {
  const id = parseId(value);
  return id || 1;
}

function normalizeUserId(value) {
  return parseId(value) || null;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseBooleanFlag(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback ? 1 : 0;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  const normalized = cleanText(value, 20).toLowerCase();
  if (['true', 'yes', 'y', 'on', 'default', 'mac_dinh', 'mặc định'].includes(normalized)) return 1;
  if (['false', 'no', 'n', 'off', 'none', 'khong', 'không'].includes(normalized)) return 0;
  return fallback ? 1 : 0;
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseJsonObject(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return cloneJsonValue(fallback);
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : cloneJsonValue(fallback);
    } catch (_error) {
      return cloneJsonValue(fallback);
    }
  }
  return cloneJsonValue(fallback);
}

function parseNullableJsonObject(value) {
  if (value === undefined || value === null || value === '') return null;
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function parseJsonObjectInput(value, fieldLabel, fallback = {}, { allowNull = true } = {}) {
  if (value === undefined) return { provided: false, value: cloneJsonValue(fallback) };
  if (value === null || value === '') {
    if (allowNull) return { provided: true, value: null };
    return { error: `${fieldLabel} phải là JSON object hợp lệ.` };
  }
  if (isPlainObject(value)) return { provided: true, value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isPlainObject(parsed)) return { provided: true, value: parsed };
    } catch (_error) {
      return { error: `${fieldLabel} không phải JSON hợp lệ.` };
    }
  }
  return { error: `${fieldLabel} phải là JSON object hợp lệ.` };
}

function pickBodyValue(body, names) {
  for (const name of names) {
    if (hasOwn(body, name)) return { provided: true, value: body[name], key: name };
  }
  return { provided: false, value: undefined, key: '' };
}

function normalizeCode(value, fallback = '') {
  const raw = cleanText(value || fallback, 100)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return raw || null;
}

function normalizePaperSize(value) {
  const paperSize = cleanText(value || 'A5', 20).toUpperCase();
  if (paperSize === 'K58') return 'K57';
  return PAPER_SIZES.has(paperSize) ? paperSize : 'A5';
}

function normalizeOrientation(value) {
  const orientation = cleanText(value || 'portrait', 20).toLowerCase();
  return ORIENTATIONS.has(orientation) ? orientation : 'portrait';
}

function normalizeStatus(value) {
  const status = cleanText(value || 'active', 20).toLowerCase();
  return STATUSES.has(status) ? status : 'active';
}

function normalizeTemplateType(value) {
  const templateType = cleanText(value || 'invoice', 50)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return templateType || 'invoice';
}

function normalizePrintScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.round(Math.min(5, Math.max(0.1, scale)) * 1000) / 1000;
}

function schemaVersionFromLayout(layout, settings, explicitVersion = null) {
  return detectTemplateSchemaVersion(layout || {}, settings || {}, explicitVersion) >= 2 ? 2 : 1;
}

function jsonStringifyOrNull(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function currentMysqlDateTime() {
  return new Date().toISOString().slice(0, 23).replace('T', ' ');
}

function extractPaperSizeFromLayout(layout, fallback = 'A5') {
  if (!isPlainObject(layout)) return normalizePaperSize(fallback);
  if (isV2Layout(layout)) return normalizeDocumentPaperSize(layout.canvas?.pageSize || fallback);
  return normalizePaperSize(layout.page?.size || fallback);
}

function extractOrientationFromLayout(layout, fallback = 'portrait') {
  if (!isPlainObject(layout)) return normalizeOrientation(fallback);
  if (isV2Layout(layout)) return normalizeDocumentOrientation(layout.canvas?.orientation || fallback, extractPaperSizeFromLayout(layout));
  return normalizeOrientation(layout.page?.orientation || fallback);
}

function mergeSettingsPublishState(settings, { revision, hasDraft, sourceSchemaVersion } = {}) {
  const result = isPlainObject(settings) ? cloneJson(settings) : cloneJson(DEFAULT_SETTINGS_V2);
  result.schema_version = 2;
  result.renderMode = result.renderMode || result.render_mode || 'hybrid-dom';
  result.editor = isPlainObject(result.editor) ? result.editor : cloneJson(DEFAULT_SETTINGS_V2.editor || {});
  result.publish = isPlainObject(result.publish) ? result.publish : {};
  result.publish.revision = parsePositiveInteger(revision) || 1;
  result.publish.hasDraft = hasDraft === true;
  result.migration = isPlainObject(result.migration) ? result.migration : {};
  result.migration.sourceSchemaVersion = parsePositiveInteger(result.migration.sourceSchemaVersion) || parsePositiveInteger(sourceSchemaVersion) || 2;
  if (!hasOwn(result.migration, 'migratedAt')) result.migration.migratedAt = null;
  if (!hasOwn(result.migration, 'migratedBy')) result.migration.migratedBy = null;
  return result;
}

function validateV2LayoutOrThrow(layout, fieldLabel = 'layout_json') {
  const result = validateLayoutV2(layout);
  if (!result.ok) {
    throw createHttpError(400, `${fieldLabel} không hợp lệ: ${formatValidationErrors(result.errors)}`, 'PRINT_TEMPLATE_LAYOUT_VALIDATION_ERROR', { errors: result.errors });
  }
  return result.value;
}

function validateV2SettingsOrThrow(settings, fieldLabel = 'settings_json') {
  const result = validateSettingsV2(settings);
  if (!result.ok) {
    throw createHttpError(400, `${fieldLabel} không hợp lệ: ${formatValidationErrors(result.errors)}`, 'PRINT_TEMPLATE_SETTINGS_VALIDATION_ERROR', { errors: result.errors });
  }
  return result.value;
}

function validateEditorMetaOrThrow(meta) {
  const result = validateEditorMetaJson(meta);
  if (!result.ok) {
    throw createHttpError(400, `editor_meta_json không hợp lệ: ${formatValidationErrors(result.errors)}`, 'PRINT_TEMPLATE_EDITOR_META_VALIDATION_ERROR', { errors: result.errors });
  }
  return result.value;
}

async function ensureReady(options = {}) {
  const verify = options.verify !== false;
  if (!readyPromise || verify) {
    readyPromise = ensurePrintTemplatesSchema({ failSoft: false, verify }).catch(error => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

async function runWithSchemaSelfHeal(callback) {
  await ensureReady({ verify: true });
  try {
    return await callback();
  } catch (error) {
    if (!isPrintTemplatesTableMissingError(error)) throw error;
    resetPrintTemplatesSchemaReady();
    readyPromise = null;
    await ensurePrintTemplatesSchema({ failSoft: false, force: true });
    return callback();
  }
}

async function execute(connection, sql, params = []) {
  if (connection) {
    const [rows] = await connection.execute(sql, params);
    return rows;
  }
  return query(sql, params);
}

function buildEditorDocumentPayload(row, publishedLayout, publishedSettings, draftLayout, draftSettings) {
  const revision = parsePositiveInteger(row?.revision) || 1;
  const hasDraft = Boolean(draftLayout);
  const explicitVersion = row?.template_schema_version;
  const publishedDocument = toEditorV2Document({
    layout: publishedLayout,
    settings: publishedSettings,
    template: {
      ...row,
      revision,
      has_draft: hasDraft,
      template_schema_version: schemaVersionFromLayout(publishedLayout, publishedSettings, explicitVersion),
    },
  });
  const draftDocument = draftLayout
    ? toEditorV2Document({
      layout: draftLayout,
      settings: draftSettings || {},
      template: {
        ...row,
        revision,
        has_draft: hasDraft,
        template_schema_version: 2,
      },
    })
    : null;

  return {
    schema_version: 2,
    revision,
    has_draft: hasDraft,
    active: draftDocument ? 'draft' : 'published',
    published: {
      schema_version: 2,
      source_schema_version: publishedDocument.sourceSchemaVersion,
      migrated: publishedDocument.migrated,
      layout_json: publishedDocument.layout,
      settings_json: mergeSettingsPublishState(publishedDocument.settings, { revision, hasDraft, sourceSchemaVersion: publishedDocument.sourceSchemaVersion }),
    },
    draft: draftDocument ? {
      schema_version: 2,
      source_schema_version: draftDocument.sourceSchemaVersion,
      migrated: draftDocument.migrated,
      layout_json: draftDocument.layout,
      settings_json: mergeSettingsPublishState(draftDocument.settings, { revision, hasDraft: true, sourceSchemaVersion: draftDocument.sourceSchemaVersion }),
    } : null,
  };
}

function serializePrintTemplate(row) {
  if (!row) return null;
  const layout = parseJsonObject(row.layout_json, {});
  const settings = parseJsonObject(row.settings_json, {});
  const draftLayout = parseNullableJsonObject(row.draft_layout_json);
  const draftSettings = parseNullableJsonObject(row.draft_settings_json);
  const editorMeta = parseNullableJsonObject(row.editor_meta_json);
  const revision = parsePositiveInteger(row.revision) || 1;
  const templateSchemaVersion = schemaVersionFromLayout(layout, settings, row.template_schema_version);
  const editorDocument = buildEditorDocumentPayload(row, layout, settings, draftLayout, draftSettings);
  const headerLogo = cleanText(row.header_logo || row.logo_url, 1024);

  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    code: cleanText(row.code, 100),
    template_name: cleanText(row.template_name || row.name, 150),
    name: cleanText(row.name || row.template_name, 255),
    template_type: normalizeTemplateType(row.template_type),
    description: cleanText(row.description, 255),
    header_logo: headerLogo,
    logo_url: cleanText(row.logo_url || headerLogo, 1024),
    logo_path: cleanText(row.logo_path, 1024),
    logo_mime: cleanText(row.logo_mime, 100),
    logo_size: Number(row.logo_size) || 0,
    logo: {
      url: cleanText(row.logo_url || headerLogo, 1024),
      path: cleanText(row.logo_path, 1024),
      mime: cleanText(row.logo_mime, 100),
      size: Number(row.logo_size) || 0,
      binding: 'template.logo',
    },
    shop_name: cleanText(row.shop_name, 150),
    shop_address: cleanText(row.shop_address, 255),
    shop_phone: cleanText(row.shop_phone, 50),
    css_style: row.css_style || '',
    template_data: row.template_data || (row.layout_json ? String(row.layout_json) : ''),
    print_scale: normalizePrintScale(row.print_scale ?? settings.print?.scale ?? settings.scale),
    layout_json: layout,
    layout,
    settings_json: settings,
    settings,
    template_schema_version: templateSchemaVersion,
    schema_version: templateSchemaVersion,
    draft_layout_json: draftLayout,
    draft_settings_json: draftSettings,
    editor_meta_json: editorMeta,
    has_draft: Boolean(draftLayout),
    revision,
    last_autosaved_at: row.last_autosaved_at || null,
    published_at: row.published_at || null,
    editor_document: editorDocument,
    published_layout_v2: editorDocument.published.layout_json,
    published_settings_v2: editorDocument.published.settings_json,
    layout_v2: editorDocument.published.layout_json,
    settings_v2: editorDocument.published.settings_json,
    draft_layout_v2: editorDocument.draft?.layout_json || null,
    draft_settings_v2: editorDocument.draft?.settings_json || null,
    active_editor_layout_json: editorDocument.draft?.layout_json || editorDocument.published.layout_json,
    active_editor_settings_json: editorDocument.draft?.settings_json || editorDocument.published.settings_json,
    paper_size: normalizePaperSize(row.paper_size),
    orientation: normalizeOrientation(row.orientation),
    status: normalizeStatus(row.status),
    is_default: Number(row.is_default) === 1,
    created_by: row.created_by == null ? null : Number(row.created_by),
    updated_by: row.updated_by == null ? null : Number(row.updated_by),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    deleted_at: row.deleted_at || null,
  };
}

function serializePrintTemplateForInvoice(row) {
  const item = serializePrintTemplate(row);
  if (!item) return null;
  const publishedDocument = {
    schema_version: 2,
    revision: item.revision,
    has_draft: false,
    active: 'published',
    published: item.editor_document.published,
    draft: null,
  };
  return {
    id: item.id,
    code: item.code,
    name: item.template_name,
    template_name: item.template_name,
    template_type: item.template_type,
    description: item.description,
    template_data: item.template_data,
    print_scale: item.print_scale,
    paper_size: item.paper_size,
    orientation: item.orientation,
    css_style: item.css_style,
    template_schema_version: item.template_schema_version,
    schema_version: item.template_schema_version,
    layout_json: item.layout_json,
    settings_json: item.settings_json,
    layout_v2: item.layout_v2,
    settings_v2: item.settings_v2,
    editor_document: publishedDocument,
    settings: Object.keys(item.settings_json || {}).length > 0 ? item.settings_json : item.layout_json,
    header_logo: item.header_logo,
    logo_url: item.logo_url,
    logo_url_resolved: item.logo_url || item.header_logo,
    logo: item.logo,
    shop_name: item.shop_name,
    shop_address: item.shop_address,
    shop_phone: item.shop_phone,
    is_default: item.is_default,
    revision: item.revision,
    published_at: item.published_at,
    updated_at: item.updated_at,
  };
}

function validateParsedTemplateJsonForPayload(payload, parsedLayout, parsedSettings, { partial } = {}) {
  const hasLayout = parsedLayout !== undefined;
  const hasSettings = parsedSettings !== undefined;
  const layoutValue = parsedLayout === null ? null : parsedLayout;
  const settingsValue = parsedSettings === null ? null : parsedSettings;

  if (layoutValue && schemaVersionFromLayout(layoutValue, settingsValue || {}, null) >= 2) {
    const normalizedLayout = validateV2LayoutOrThrow(layoutValue, 'layout_json');
    const normalizedSettings = settingsValue
      ? validateV2SettingsOrThrow(settingsValue, 'settings_json')
      : buildDefaultV2Settings({ revision: 1, hasDraft: false, sourceSchemaVersion: 2 });
    payload.layout_json = JSON.stringify(normalizedLayout);
    payload.settings_json = JSON.stringify(mergeSettingsPublishState(normalizedSettings, { revision: 1, hasDraft: false, sourceSchemaVersion: 2 }));
    payload.template_schema_version = 2;
    payload.paper_size = extractPaperSizeFromLayout(normalizedLayout, payload.paper_size);
    payload.orientation = extractOrientationFromLayout(normalizedLayout, payload.orientation);
    return;
  }

  if (hasLayout && layoutValue === null) {
    payload.layout_json = null;
    payload.template_schema_version = 1;
  } else if (hasLayout) {
    payload.layout_json = JSON.stringify(layoutValue);
    payload.template_schema_version = 1;
  }

  if (hasSettings && settingsValue === null) {
    payload.settings_json = null;
  } else if (hasSettings) {
    payload.settings_json = JSON.stringify(settingsValue);
  }
}

function buildPrintTemplatePayload(body = {}, options = {}) {
  const partial = options.partial === true;
  const payload = {};
  let parsedLayout;
  let parsedSettings;

  const nameInput = pickBodyValue(body, ['template_name', 'name']);
  const templateName = cleanText(nameInput.value, 150);
  if (!partial && !templateName) return { error: 'Vui lòng nhập tên mẫu in hóa đơn.' };
  if (nameInput.provided) {
    if (!templateName) return { error: 'Tên mẫu in hóa đơn không được để trống.' };
    payload.template_name = templateName;
    payload.name = templateName;
  }

  const codeInput = pickBodyValue(body, ['code', 'template_code']);
  if (codeInput.provided) payload.code = normalizeCode(codeInput.value);
  if (!partial && !payload.code) payload.code = normalizeCode(templateName || 'mau-in-hoa-don');

  const templateTypeInput = pickBodyValue(body, ['template_type', 'templateType', 'type']);
  if (templateTypeInput.provided || !partial) payload.template_type = normalizeTemplateType(templateTypeInput.value);

  const printScaleInput = pickBodyValue(body, ['print_scale', 'printScale', 'scale']);
  if (printScaleInput.provided) payload.print_scale = normalizePrintScale(printScaleInput.value);

  const textFields = [
    ['description', ['description'], 255],
    ['header_logo', ['header_logo', 'logo_url'], 1024],
    ['logo_url', ['logo_url'], 1024],
    ['logo_path', ['logo_path'], 1024],
    ['shop_name', ['shop_name'], 150],
    ['shop_address', ['shop_address'], 255],
    ['shop_phone', ['shop_phone'], 50],
    ['css_style', ['css_style', 'css'], 200000],
  ];

  for (const [column, names, maxLength] of textFields) {
    const input = pickBodyValue(body, names);
    if (input.provided) payload[column] = nullableText(input.value, maxLength);
  }

  const paperSizeInput = pickBodyValue(body, ['paper_size']);
  if (paperSizeInput.provided || !partial) payload.paper_size = normalizePaperSize(paperSizeInput.value);

  const orientationInput = pickBodyValue(body, ['orientation']);
  if (orientationInput.provided || !partial) payload.orientation = normalizeOrientation(orientationInput.value);

  const statusInput = pickBodyValue(body, ['status']);
  if (statusInput.provided || !partial) payload.status = normalizeStatus(statusInput.value);

  const isDefaultInput = pickBodyValue(body, ['is_default', 'default']);
  if (isDefaultInput.provided || !partial) payload.is_default = parseBooleanFlag(isDefaultInput.value, 0);

  const layoutInput = pickBodyValue(body, ['layout_json', 'layout']);
  const templateDataInput = pickBodyValue(body, ['template_data', 'templateData']);
  if (layoutInput.provided) {
    const parsed = parseJsonObjectInput(layoutInput.value, 'layout_json', DEFAULT_LAYOUT_V2);
    if (parsed.error) return { error: parsed.error };
    parsedLayout = parsed.value;
  } else if (templateDataInput.provided) {
    const rawTemplateData = templateDataInput.value;
    if (rawTemplateData === null || rawTemplateData === '') {
      payload.template_data = null;
    } else if (isPlainObject(rawTemplateData)) {
      parsedLayout = rawTemplateData;
      payload.template_data = JSON.stringify(rawTemplateData);
    } else if (typeof rawTemplateData === 'string') {
      const text = rawTemplateData.trim();
      payload.template_data = text || null;
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (isPlainObject(parsed)) parsedLayout = parsed;
        } catch (_error) {
          // Legacy template_data may be HTML/plain text; keep it without using mock data.
        }
      }
    } else {
      return { error: 'template_data phải là chuỗi hoặc JSON object hợp lệ.' };
    }
  } else if (!partial) {
    parsedLayout = cloneJson(DEFAULT_LAYOUT_V2);
  }

  const settingsInput = pickBodyValue(body, ['settings_json', 'settings']);
  if (settingsInput.provided) {
    const parsed = parseJsonObjectInput(settingsInput.value, 'settings_json', DEFAULT_SETTINGS_V2);
    if (parsed.error) return { error: parsed.error };
    parsedSettings = parsed.value;
  } else if (!partial) {
    parsedSettings = cloneJson(DEFAULT_SETTINGS_V2);
  }

  if (!hasOwn(payload, 'print_scale') && isPlainObject(parsedSettings)) {
    const settingsScale = parsedSettings.print?.scale ?? parsedSettings.scale;
    if (settingsScale !== undefined && settingsScale !== null && settingsScale !== '') {
      payload.print_scale = normalizePrintScale(settingsScale);
    }
  }
  if (!partial && !hasOwn(payload, 'print_scale')) payload.print_scale = 1;

  try {
    validateParsedTemplateJsonForPayload(payload, parsedLayout, parsedSettings, { partial });
  } catch (error) {
    return { error: error.message, details: error.details, code: error.code };
  }

  if (payload.layout_json !== undefined && !hasOwn(payload, 'template_data')) {
    payload.template_data = payload.layout_json == null ? null : String(payload.layout_json);
  }

  return { value: payload };
}

async function findDuplicate(accountId, column, value, excludeId = null) {
  if (!value) return null;
  const rows = await query(
    `SELECT id FROM print_templates
      WHERE account_id = ?
        AND deleted_at IS NULL
        AND LOWER(${column}) = LOWER(?)
        AND (? IS NULL OR id <> ?)
      LIMIT 1`,
    [accountId, value, excludeId, excludeId]
  );
  return rows?.[0] || null;
}

async function ensureNoDuplicateTemplate(accountId, payload, excludeId = null) {
  if (payload.template_name) {
    const duplicateName = await findDuplicate(accountId, 'template_name', payload.template_name, excludeId);
    if (duplicateName) throw createHttpError(409, 'Tên mẫu in hóa đơn đã tồn tại.', 'PRINT_TEMPLATE_DUPLICATE_NAME');
  }
  if (payload.code) {
    const duplicateCode = await findDuplicate(accountId, 'code', payload.code, excludeId);
    if (duplicateCode) throw createHttpError(409, 'Mã mẫu in hóa đơn đã tồn tại.', 'PRINT_TEMPLATE_DUPLICATE_CODE');
  }
}

function buildInsertSql(payload) {
  const columns = Object.keys(payload);
  const placeholders = columns.map(() => '?').join(', ');
  return {
    sql: `INSERT INTO print_templates (${columns.join(', ')}) VALUES (${placeholders})`,
    params: columns.map(column => payload[column]),
  };
}

function buildUpdateSql(payload, accountId, id) {
  const columns = Object.keys(payload);
  return {
    sql: `UPDATE print_templates SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = UTC_TIMESTAMP(3) WHERE account_id = ? AND id = ? AND deleted_at IS NULL`,
    params: [...columns.map(column => payload[column]), accountId, id],
  };
}

async function withDefaultTemplateTransaction(accountId, callback) {
  let connection = null;
  let hasLock = false;
  const lockName = `kha_print_templates_default:${accountId}`;

  try {
    connection = await getPrintTemplatesPool().getConnection();
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 10) AS got_lock', [lockName]);
    hasLock = Number(lockRows?.[0]?.got_lock ?? 0) === 1;
    if (!hasLock) {
      throw createHttpError(503, 'Không thể khóa thao tác đặt mẫu in mặc định. Vui lòng thử lại sau.', 'PRINT_TEMPLATE_DEFAULT_LOCK_TIMEOUT');
    }

    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {
        // Keep the original error.
      }
    }
    throw normalizePrintTemplatesMySqlError(error);
  } finally {
    if (connection) {
      if (hasLock) {
        try {
          await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
        } catch (_releaseError) {
          // Releasing the pooled connection is still required even if RELEASE_LOCK fails.
        }
      }
      connection.release();
    }
  }
}

async function withTemplateTransaction(callback) {
  let connection = null;
  try {
    connection = await getPrintTemplatesPool().getConnection();
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {
        // Keep the original error.
      }
    }
    throw normalizePrintTemplatesMySqlError(error);
  } finally {
    if (connection) connection.release();
  }
}

function buildDefaultTemplatePayload(accountId, userId = null) {
  const revision = 1;
  const layout = validateV2LayoutOrThrow(cloneJson(DEFAULT_LAYOUT_V2), 'layout_json');
  const settings = mergeSettingsPublishState(validateV2SettingsOrThrow(cloneJson(DEFAULT_SETTINGS_V2), 'settings_json'), {
    revision,
    hasDraft: false,
    sourceSchemaVersion: 2,
  });
  return {
    account_id: normalizeAccountId(accountId),
    code: DEFAULT_TEMPLATE_SEED_CODE,
    template_name: DEFAULT_TEMPLATE_SEED_NAME,
    name: DEFAULT_TEMPLATE_SEED_NAME,
    description: DEFAULT_TEMPLATE_SEED_DESCRIPTION,
    template_data: JSON.stringify(layout),
    layout_json: JSON.stringify(layout),
    settings_json: JSON.stringify(settings),
    template_schema_version: 2,
    template_type: 'invoice',
    print_scale: 1,
    paper_size: extractPaperSizeFromLayout(layout, 'A5'),
    orientation: extractOrientationFromLayout(layout, 'portrait'),
    status: 'active',
    is_default: 1,
    revision,
    published_at: currentMysqlDateTime(),
    created_by: normalizeUserId(userId),
    updated_by: normalizeUserId(userId),
  };
}

async function getFirstActiveTemplateRow(accountId, options = {}) {
  const connection = options.connection || null;
  const rows = await execute(
    connection,
    `SELECT * FROM print_templates
      WHERE account_id = ?
        AND deleted_at IS NULL
      ORDER BY is_default DESC, updated_at DESC, id DESC
      LIMIT 1`,
    [normalizeAccountId(accountId)]
  );
  return rows?.[0] || null;
}

async function ensureDefaultTemplateForAccount(accountId, options = {}) {
  const normalizedAccountId = normalizeAccountId(accountId);
  const connection = options.connection || null;
  const activeRow = await getFirstActiveTemplateRow(normalizedAccountId, { connection });

  if (!activeRow) {
    const payload = buildDefaultTemplatePayload(normalizedAccountId, options.userId);
    const insert = buildInsertSql(payload);
    const result = await execute(connection, insert.sql, insert.params);
    return getTemplateRowById(normalizedAccountId, result.insertId, { connection });
  }

  if (Number(activeRow.is_default) === 1) return activeRow;

  await execute(
    connection,
    'UPDATE print_templates SET is_default = 0, updated_at = UTC_TIMESTAMP(3) WHERE account_id = ? AND deleted_at IS NULL',
    [normalizedAccountId]
  );
  await execute(
    connection,
    'UPDATE print_templates SET is_default = 1, updated_at = UTC_TIMESTAMP(3) WHERE account_id = ? AND id = ? AND deleted_at IS NULL',
    [normalizedAccountId, activeRow.id]
  );
  return getTemplateRowById(normalizedAccountId, activeRow.id, { connection });
}

async function getTemplateRowById(accountId, id, options = {}) {
  const includeDeleted = options.includeDeleted === true;
  const connection = options.connection || null;
  const forUpdate = options.forUpdate === true ? ' FOR UPDATE' : '';
  const rows = await execute(
    connection,
    `SELECT * FROM print_templates WHERE account_id = ? AND id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} LIMIT 1${forUpdate}`,
    [accountId, id]
  );
  return rows?.[0] || null;
}

async function listPrintTemplates(options = {}) {
  return runWithSchemaSelfHeal(async () => {
    const accountId = normalizeAccountId(options.accountId);
    await ensureDefaultTemplateForAccount(accountId, { userId: options.userId });
    const includeDeleted = options.includeDeleted === true;
    const status = cleanText(options.status, 20).toLowerCase();
    const q = cleanText(options.q, 120);
    const params = [accountId];
    const conditions = ['account_id = ?'];

    if (!includeDeleted) conditions.push('deleted_at IS NULL');
    if (status && STATUSES.has(status)) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (q) {
      conditions.push('(template_name LIKE ? OR code LIKE ? OR shop_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const rows = await query(
      `SELECT * FROM print_templates WHERE ${conditions.join(' AND ')} ORDER BY is_default DESC, updated_at DESC, id DESC`,
      params
    );
    return rows.map(serializePrintTemplate);
  });
}

async function getPrintTemplateById(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');
  const row = await getTemplateRowById(accountId, id);
  if (!row) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
  return serializePrintTemplate(row);
}

async function getDefaultPrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const ensured = await ensureDefaultTemplateForAccount(accountId, { userId: options.userId });
  if (ensured && Number(ensured.is_default) === 1) return serializePrintTemplate(ensured);
  const rows = await query(
    `SELECT * FROM print_templates
      WHERE account_id = ?
        AND deleted_at IS NULL
        AND is_default = 1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [accountId]
  );
  return serializePrintTemplate(rows?.[0] || null);
}

async function getCurrentPrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const requestedId = parseId(options.templateId || options.id);
  if (requestedId) return getPrintTemplateById({ accountId, id: requestedId });
  const defaultTemplate = await getDefaultPrintTemplate({ accountId });
  if (defaultTemplate) return defaultTemplate;
  const rows = await query(
    `SELECT * FROM print_templates
      WHERE account_id = ?
        AND deleted_at IS NULL
        AND status = 'active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [accountId]
  );
  return serializePrintTemplate(rows?.[0] || null);
}

async function createPrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const parsed = buildPrintTemplatePayload(options.body || {}, { partial: false });
  if (parsed.error) throw createHttpError(400, parsed.error, parsed.code || 'PRINT_TEMPLATE_VALIDATION_ERROR', parsed.details || null);

  const payload = {
    account_id: accountId,
    ...parsed.value,
    revision: 1,
    created_by: userId,
    updated_by: userId,
  };
  if (Number(payload.template_schema_version) >= 2 && !payload.published_at) payload.published_at = currentMysqlDateTime();
  if (payload.is_default !== 1) {
    const existing = await getFirstActiveTemplateRow(accountId);
    if (!existing) payload.is_default = 1;
  }
  await ensureNoDuplicateTemplate(accountId, payload);

  const insertAndFetch = async (connection = null) => {
    const insert = buildInsertSql(payload);
    const result = await execute(connection, insert.sql, insert.params);
    return getTemplateRowById(accountId, result.insertId, { connection });
  };

  const row = payload.is_default === 1
    ? await withDefaultTemplateTransaction(accountId, async connection => {
      await connection.execute('UPDATE print_templates SET is_default = 0, updated_at = UTC_TIMESTAMP(3) WHERE account_id = ? AND deleted_at IS NULL', [accountId]);
      return insertAndFetch(connection);
    })
    : await insertAndFetch();

  return serializePrintTemplate(row);
}

async function updatePrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');

  const parsed = buildPrintTemplatePayload(options.body || {}, { partial: true });
  if (parsed.error) throw createHttpError(400, parsed.error, parsed.code || 'PRINT_TEMPLATE_VALIDATION_ERROR', parsed.details || null);
  const payload = { ...parsed.value };
  if (Object.keys(payload).length === 0) throw createHttpError(400, 'Không có dữ liệu cập nhật mẫu in hóa đơn.', 'PRINT_TEMPLATE_EMPTY_UPDATE');
  payload.updated_by = userId;

  const existing = await getTemplateRowById(accountId, id);
  if (!existing) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
  if (Number(existing.is_default) === 1 && hasOwn(payload, 'is_default') && payload.is_default !== 1) {
    delete payload.is_default;
  }
  await ensureNoDuplicateTemplate(accountId, payload, id);

  const layoutTouched = hasOwn(payload, 'layout_json')
    || hasOwn(payload, 'settings_json')
    || hasOwn(payload, 'template_schema_version')
    || hasOwn(payload, 'template_data')
    || hasOwn(payload, 'print_scale');
  if (layoutTouched) {
    payload.revision = (parsePositiveInteger(existing.revision) || 1) + 1;
    if (Number(payload.template_schema_version) >= 2) {
      payload.published_at = currentMysqlDateTime();
      payload.draft_layout_json = null;
      payload.draft_settings_json = null;
    }
  }

  const makeUpdatePayload = () => ({ ...payload });
  const wantsDefault = payload.is_default === 1;

  const row = wantsDefault
    ? await withDefaultTemplateTransaction(accountId, async connection => {
      const locked = await getTemplateRowById(accountId, id, { connection, forUpdate: true });
      if (!locked) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
      await connection.execute('UPDATE print_templates SET is_default = 0, updated_at = UTC_TIMESTAMP(3) WHERE account_id = ? AND deleted_at IS NULL', [accountId]);
      const update = buildUpdateSql(makeUpdatePayload(), accountId, id);
      await connection.execute(update.sql, update.params);
      return getTemplateRowById(accountId, id, { connection });
    })
    : await (async () => {
      const update = buildUpdateSql(makeUpdatePayload(), accountId, id);
      await query(update.sql, update.params);
      return getTemplateRowById(accountId, id);
    })();

  return serializePrintTemplate(row);
}

function parseExpectedRevision(body = {}) {
  const revisionInput = pickBodyValue(body, ['revision', 'expected_revision', 'expectedRevision', 'current_revision', 'currentRevision']);
  return revisionInput.provided ? parsePositiveInteger(revisionInput.value) : null;
}

function requireExpectedRevision(expectedRevision, actionLabel = 'lưu mẫu in') {
  if (expectedRevision) return expectedRevision;
  throw createHttpError(
    400,
    `Thiếu revision hiện tại khi ${actionLabel}. Vui lòng tải chi tiết template trước khi thao tác.`,
    'PRINT_TEMPLATE_REVISION_REQUIRED'
  );
}

function assertRevisionMatches(row, expectedRevision) {
  const requiredRevision = requireExpectedRevision(expectedRevision);
  const currentRevision = parsePositiveInteger(row?.revision) || 1;
  if (currentRevision !== requiredRevision) {
    throw createHttpError(
      409,
      'Mẫu in hóa đơn đã được cập nhật ở phiên khác. Vui lòng tải lại trước khi lưu.',
      'PRINT_TEMPLATE_REVISION_CONFLICT',
      { expected_revision: requiredRevision, current_revision: currentRevision }
    );
  }
}

function parseDraftPayload(body = {}) {
  const result = {
    expectedRevision: parseExpectedRevision(body),
    layoutProvided: false,
    settingsProvided: false,
    editorMetaProvided: false,
    layout: null,
    settings: null,
    editorMeta: undefined,
  };

  const layoutInput = pickBodyValue(body, ['draft_layout_json', 'layout_json', 'layout', 'draftLayout', 'layoutJson']);
  if (layoutInput.provided) {
    const parsed = parseJsonObjectInput(layoutInput.value, 'draft_layout_json', DEFAULT_LAYOUT_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.layoutProvided = true;
    result.layout = validateV2LayoutOrThrow(parsed.value, 'draft_layout_json');
  }

  const settingsInput = pickBodyValue(body, ['draft_settings_json', 'settings_json', 'settings', 'draftSettings', 'settingsJson']);
  if (settingsInput.provided) {
    const parsed = parseJsonObjectInput(settingsInput.value, 'draft_settings_json', DEFAULT_SETTINGS_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.settingsProvided = true;
    result.settings = validateV2SettingsOrThrow(parsed.value, 'draft_settings_json');
  }

  const editorMetaInput = pickBodyValue(body, ['editor_meta_json', 'editor_meta', 'editorMeta', 'meta']);
  if (editorMetaInput.provided) {
    result.editorMetaProvided = true;
    if (editorMetaInput.value === null || editorMetaInput.value === '') {
      result.editorMeta = null;
    } else {
      const parsed = parseJsonObjectInput(editorMetaInput.value, 'editor_meta_json', {}, { allowNull: true });
      if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
      result.editorMeta = validateEditorMetaOrThrow(parsed.value);
    }
  }

  if (!result.layoutProvided && !result.settingsProvided && !result.editorMetaProvided) {
    throw createHttpError(400, 'Không có dữ liệu draft để autosave.', 'PRINT_TEMPLATE_EMPTY_AUTOSAVE');
  }

  return result;
}

function buildDynamicUpdateSql(payload, accountId, id, options = {}) {
  const assignments = [];
  const params = [];
  for (const [column, value] of Object.entries(payload)) {
    assignments.push(`${column} = ?`);
    params.push(value);
  }
  if (options.lastAutosavedAt === true) assignments.push('last_autosaved_at = UTC_TIMESTAMP(3)');
  if (options.publishedAt === true) assignments.push('published_at = UTC_TIMESTAMP(3)');
  assignments.push('updated_at = UTC_TIMESTAMP(3)');
  return {
    sql: `UPDATE print_templates SET ${assignments.join(', ')} WHERE account_id = ? AND id = ? AND deleted_at IS NULL`,
    params: [...params, accountId, id],
  };
}

async function autosavePrintTemplateDraft(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');
  const parsed = parseDraftPayload(options.body || {});

  const row = await withTemplateTransaction(async connection => {
    const locked = await getTemplateRowById(accountId, id, { connection, forUpdate: true });
    if (!locked) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
    requireExpectedRevision(parsed.expectedRevision, 'autosave draft mẫu in hóa đơn');
    assertRevisionMatches(locked, parsed.expectedRevision);

    const currentRevision = parsePositiveInteger(locked.revision) || 1;
    const nextRevision = currentRevision + 1;
    const publishedLayout = parseJsonObject(locked.layout_json, {});
    const publishedSettings = parseJsonObject(locked.settings_json, {});
    const existingDraftLayout = parseNullableJsonObject(locked.draft_layout_json);
    const existingDraftSettings = parseNullableJsonObject(locked.draft_settings_json);
    const publishedDocument = toEditorV2Document({
      layout: publishedLayout,
      settings: publishedSettings,
      template: { ...locked, revision: currentRevision, has_draft: Boolean(existingDraftLayout) },
    });

    const nextDraftLayout = parsed.layoutProvided
      ? parsed.layout
      : (existingDraftLayout || publishedDocument.layout);
    const nextDraftSettingsSource = parsed.settingsProvided
      ? parsed.settings
      : (existingDraftSettings || publishedDocument.settings || buildDefaultV2Settings({ revision: nextRevision, hasDraft: true, sourceSchemaVersion: 2 }));
    const nextDraftSettings = mergeSettingsPublishState(nextDraftSettingsSource, { revision: nextRevision, hasDraft: true, sourceSchemaVersion: 2 });
    const normalizedSettings = validateV2SettingsOrThrow(nextDraftSettings, 'draft_settings_json');

    const payload = {
      draft_layout_json: JSON.stringify(nextDraftLayout),
      draft_settings_json: JSON.stringify(mergeSettingsPublishState(normalizedSettings, { revision: nextRevision, hasDraft: true, sourceSchemaVersion: 2 })),
      revision: nextRevision,
      updated_by: userId,
    };
    if (parsed.editorMetaProvided) payload.editor_meta_json = jsonStringifyOrNull(parsed.editorMeta);

    const update = buildDynamicUpdateSql(payload, accountId, id, { lastAutosavedAt: true });
    await connection.execute(update.sql, update.params);
    return getTemplateRowById(accountId, id, { connection });
  });

  return serializePrintTemplate(row);
}

function parsePublishPayloadSafe(body = {}) {
  const result = {
    expectedRevision: parseExpectedRevision(body),
    layoutProvided: false,
    settingsProvided: false,
    editorMetaProvided: false,
    layout: null,
    settings: null,
    editorMeta: undefined,
    statusProvided: false,
    status: '',
  };

  const layoutInput = pickBodyValue(body, ['draft_layout_json', 'layout_json', 'layout', 'draftLayout', 'layoutJson']);
  if (layoutInput.provided) {
    const parsed = parseJsonObjectInput(layoutInput.value, 'layout_json', DEFAULT_LAYOUT_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.layoutProvided = true;
    result.layout = validateV2LayoutOrThrow(parsed.value, 'layout_json');
  }

  const settingsInput = pickBodyValue(body, ['draft_settings_json', 'settings_json', 'settings', 'draftSettings', 'settingsJson']);
  if (settingsInput.provided) {
    const parsed = parseJsonObjectInput(settingsInput.value, 'settings_json', DEFAULT_SETTINGS_V2, { allowNull: false });
    if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
    result.settingsProvided = true;
    result.settings = validateV2SettingsOrThrow(parsed.value, 'settings_json');
  }

  const editorMetaInput = pickBodyValue(body, ['editor_meta_json', 'editor_meta', 'editorMeta', 'meta']);
  if (editorMetaInput.provided) {
    result.editorMetaProvided = true;
    if (editorMetaInput.value === null || editorMetaInput.value === '') {
      result.editorMeta = null;
    } else {
      const parsed = parseJsonObjectInput(editorMetaInput.value, 'editor_meta_json', {}, { allowNull: true });
      if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
      result.editorMeta = validateEditorMetaOrThrow(parsed.value);
    }
  }

  const statusInput = pickBodyValue(body, ['status']);
  if (statusInput.provided) {
    result.statusProvided = true;
    result.status = normalizeStatus(statusInput.value);
  }

  return result;
}

async function publishPrintTemplateDraft(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');
  const parsed = parsePublishPayloadSafe(options.body || {});

  const row = await withTemplateTransaction(async connection => {
    const locked = await getTemplateRowById(accountId, id, { connection, forUpdate: true });
    if (!locked) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
    requireExpectedRevision(parsed.expectedRevision, 'publish mẫu in hóa đơn');
    assertRevisionMatches(locked, parsed.expectedRevision);

    const currentRevision = parsePositiveInteger(locked.revision) || 1;
    const nextRevision = currentRevision + 1;
    const draftLayout = parseNullableJsonObject(locked.draft_layout_json);
    const draftSettings = parseNullableJsonObject(locked.draft_settings_json);
    const layoutToPublish = parsed.layoutProvided ? parsed.layout : draftLayout;
    if (!layoutToPublish) throw createHttpError(400, 'Không có draft layout để publish.', 'PRINT_TEMPLATE_NO_DRAFT_TO_PUBLISH');
    const normalizedLayout = validateV2LayoutOrThrow(layoutToPublish, 'layout_json');
    const settingsToPublish = parsed.settingsProvided
      ? parsed.settings
      : (draftSettings || buildDefaultV2Settings({ revision: nextRevision, hasDraft: false, sourceSchemaVersion: 2 }));
    const normalizedSettings = mergeSettingsPublishState(validateV2SettingsOrThrow(settingsToPublish, 'settings_json'), {
      revision: nextRevision,
      hasDraft: false,
      sourceSchemaVersion: 2,
    });

    const payload = {
      layout_json: JSON.stringify(normalizedLayout),
      template_data: JSON.stringify(normalizedLayout),
      settings_json: JSON.stringify(normalizedSettings),
      template_schema_version: 2,
      print_scale: normalizePrintScale(normalizedSettings.print?.scale ?? normalizedSettings.scale),
      draft_layout_json: null,
      draft_settings_json: null,
      revision: nextRevision,
      paper_size: extractPaperSizeFromLayout(normalizedLayout, locked.paper_size),
      orientation: extractOrientationFromLayout(normalizedLayout, locked.orientation),
      status: parsed.statusProvided ? parsed.status : (normalizeStatus(locked.status) === 'draft' ? 'active' : normalizeStatus(locked.status)),
      updated_by: userId,
    };
    if (parsed.editorMetaProvided) payload.editor_meta_json = jsonStringifyOrNull(parsed.editorMeta);

    const update = buildDynamicUpdateSql(payload, accountId, id, { publishedAt: true });
    await connection.execute(update.sql, update.params);
    return getTemplateRowById(accountId, id, { connection });
  });

  return serializePrintTemplate(row);
}

async function discardPrintTemplateDraft(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');
  const expectedRevision = parseExpectedRevision(options.body || {});

  const row = await withTemplateTransaction(async connection => {
    const locked = await getTemplateRowById(accountId, id, { connection, forUpdate: true });
    if (!locked) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
    requireExpectedRevision(expectedRevision, 'hủy draft mẫu in hóa đơn');
    assertRevisionMatches(locked, expectedRevision);
    const nextRevision = (parsePositiveInteger(locked.revision) || 1) + 1;
    const payload = {
      draft_layout_json: null,
      draft_settings_json: null,
      revision: nextRevision,
      updated_by: userId,
    };
    const update = buildDynamicUpdateSql(payload, accountId, id);
    await connection.execute(update.sql, update.params);
    return getTemplateRowById(accountId, id, { connection });
  });

  return serializePrintTemplate(row);
}

async function setDefaultPrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');

  const row = await withDefaultTemplateTransaction(accountId, async connection => {
    const existing = await getTemplateRowById(accountId, id, { connection, forUpdate: true });
    if (!existing) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
    await connection.execute('UPDATE print_templates SET is_default = 0, updated_at = UTC_TIMESTAMP(3) WHERE account_id = ? AND deleted_at IS NULL', [accountId]);
    await connection.execute(
      'UPDATE print_templates SET is_default = 1, updated_by = ?, updated_at = UTC_TIMESTAMP(3) WHERE account_id = ? AND id = ? AND deleted_at IS NULL',
      [userId, accountId, id]
    );
    return getTemplateRowById(accountId, id, { connection });
  });

  return serializePrintTemplate(row);
}

async function softDeletePrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');

  const existing = await getTemplateRowById(accountId, id);
  if (!existing) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');

  await query(
    `UPDATE print_templates
        SET deleted_at = UTC_TIMESTAMP(3), is_default = 0, updated_by = ?, updated_at = UTC_TIMESTAMP(3)
      WHERE account_id = ? AND id = ? AND deleted_at IS NULL`,
    [userId, accountId, id]
  );
  await ensureDefaultTemplateForAccount(accountId, { userId });

  return {
    item: serializePrintTemplate({ ...existing, deleted_at: new Date().toISOString(), is_default: 0, updated_by: userId }),
    previousLogoPath: cleanText(existing.logo_path, 1024),
  };
}

async function attachLogoToPrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');

  const existing = await getTemplateRowById(accountId, id);
  if (!existing) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
  const nextRevision = (parsePositiveInteger(existing.revision) || 1) + 1;

  const payload = {
    header_logo: nullableText(options.headerLogo, 1024),
    logo_url: nullableText(options.logoUrl || options.headerLogo, 1024),
    logo_path: nullableText(options.logoPath, 1024),
    logo_mime: nullableText(options.logoMime, 100),
    logo_size: Number(options.logoSize) || null,
    revision: nextRevision,
    updated_by: userId,
  };
  const update = buildUpdateSql(payload, accountId, id);
  await query(update.sql, update.params);
  const row = await getTemplateRowById(accountId, id);
  return {
    item: serializePrintTemplate(row),
    previousLogoPath: cleanText(existing.logo_path, 1024),
  };
}

async function removeLogoFromPrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const id = parseId(options.id);
  if (!id) throw createHttpError(400, 'ID mẫu in hóa đơn không hợp lệ.', 'PRINT_TEMPLATE_INVALID_ID');

  const existing = await getTemplateRowById(accountId, id);
  if (!existing) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
  const nextRevision = (parsePositiveInteger(existing.revision) || 1) + 1;

  const payload = {
    header_logo: null,
    logo_url: null,
    logo_path: null,
    logo_mime: null,
    logo_size: null,
    revision: nextRevision,
    updated_by: userId,
  };
  const update = buildUpdateSql(payload, accountId, id);
  await query(update.sql, update.params);
  const row = await getTemplateRowById(accountId, id);
  return {
    item: serializePrintTemplate(row),
    previousLogoPath: cleanText(existing.logo_path, 1024),
  };
}

async function countTemplatesUsingLogoPath(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const logoPath = cleanText(options.logoPath, 1024);
  if (!logoPath) return 0;
  const excludeId = parseId(options.excludeId);
  const rows = await query(
    `SELECT COUNT(1) AS count
       FROM print_templates
      WHERE account_id = ?
        AND deleted_at IS NULL
        AND logo_path = ?
        AND (? IS NULL OR id <> ?)`,
    [accountId, logoPath, excludeId, excludeId]
  );
  return Number(rows?.[0]?.count ?? rows?.[0]?.COUNT ?? 0) || 0;
}

async function resolveInvoicePrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const requestedId = parseId(options.templateId);
  if (requestedId) {
    const byId = await getTemplateRowById(accountId, requestedId);
    return serializePrintTemplateForInvoice(byId);
  }
  const defaultTemplate = await getDefaultPrintTemplate({ accountId });
  if (defaultTemplate) {
    const row = await getTemplateRowById(accountId, defaultTemplate.id);
    return serializePrintTemplateForInvoice(row);
  }
  const rows = await query(
    `SELECT * FROM print_templates
      WHERE account_id = ?
        AND deleted_at IS NULL
        AND status = 'active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [accountId]
  );
  return serializePrintTemplateForInvoice(rows?.[0] || null);
}

module.exports = {
  DEFAULT_LAYOUT_JSON,
  DEFAULT_SETTINGS_JSON,
  DEFAULT_LAYOUT_V2,
  DEFAULT_SETTINGS_V2,
  createHttpError,
  parseId,
  parseBooleanFlag,
  serializePrintTemplate,
  serializePrintTemplateForInvoice,
  buildPrintTemplatePayload,
  ensureDefaultTemplateForAccount,
  listPrintTemplates,
  getPrintTemplateById,
  getDefaultPrintTemplate,
  getCurrentPrintTemplate,
  createPrintTemplate,
  updatePrintTemplate,
  autosavePrintTemplateDraft,
  publishPrintTemplateDraft,
  discardPrintTemplateDraft,
  setDefaultPrintTemplate,
  softDeletePrintTemplate,
  attachLogoToPrintTemplate,
  removeLogoFromPrintTemplate,
  countTemplatesUsingLogoPath,
  resolveInvoicePrintTemplate,
};
