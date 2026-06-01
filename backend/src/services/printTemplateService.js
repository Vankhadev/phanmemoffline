const { ensurePrintTemplatesSchema } = require('../db/printTemplatesSchema');
const { getPrintTemplatesPool, normalizePrintTemplatesMySqlError, query } = require('../db/printTemplatesMySql');

const DEFAULT_LAYOUT_JSON = Object.freeze({
  page: { size: 'A5', orientation: 'portrait', paddingMm: 8 },
  branding: { showLogo: true, logoWidthMm: 24, storeNameUppercase: true, headerBorder: true },
  content: { showCustomerTaxCode: true, showDeliveryDate: true, showCreator: true, showQr: true, showSignatures: true, showFooter: true },
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
const PAPER_SIZES = new Set(['A5', 'A4', 'K80', 'K58']);
const ORIENTATIONS = new Set(['portrait', 'landscape']);
const STATUSES = new Set(['draft', 'active', 'archived']);

let readyPromise = null;

function createHttpError(status, message, code = '') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = status >= 400 && status < 500;
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

function parseBooleanFlag(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback ? 1 : 0;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  const normalized = cleanText(value, 20).toLowerCase();
  if (['true', 'yes', 'y', 'on', 'default', 'mac_dinh', 'mặc định'].includes(normalized)) return 1;
  if (['false', 'no', 'n', 'off', 'none', 'khong', 'không'].includes(normalized)) return 0;
  return fallback ? 1 : 0;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseJsonObject(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return cloneJson(fallback);
  if (isPlainObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : cloneJson(fallback);
    } catch (_error) {
      return cloneJson(fallback);
    }
  }
  return cloneJson(fallback);
}

function parseJsonObjectInput(value, fieldLabel, fallback = {}, { allowNull = true } = {}) {
  if (value === undefined) return { provided: false, value: cloneJson(fallback) };
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

async function ensureReady() {
  if (!readyPromise) {
    readyPromise = ensurePrintTemplatesSchema({ failSoft: false }).catch(error => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

async function execute(connection, sql, params = []) {
  if (connection) {
    const [rows] = await connection.execute(sql, params);
    return rows;
  }
  return query(sql, params);
}

function serializePrintTemplate(row) {
  if (!row) return null;
  const layout = parseJsonObject(row.layout_json, {});
  const settings = parseJsonObject(row.settings_json, {});
  const headerLogo = cleanText(row.header_logo || row.logo_url, 1024);
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    code: cleanText(row.code, 100),
    template_name: cleanText(row.template_name, 150),
    name: cleanText(row.template_name, 150),
    description: cleanText(row.description, 255),
    header_logo: headerLogo,
    logo_url: cleanText(row.logo_url || headerLogo, 1024),
    logo_path: cleanText(row.logo_path, 1024),
    logo_mime: cleanText(row.logo_mime, 100),
    logo_size: Number(row.logo_size) || 0,
    shop_name: cleanText(row.shop_name, 150),
    shop_address: cleanText(row.shop_address, 255),
    shop_phone: cleanText(row.shop_phone, 50),
    css_style: row.css_style || '',
    layout_json: layout,
    layout,
    settings_json: settings,
    settings,
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
  return {
    id: item.id,
    code: item.code,
    name: item.template_name,
    template_name: item.template_name,
    description: item.description,
    paper_size: item.paper_size,
    orientation: item.orientation,
    css_style: item.css_style,
    layout_json: item.layout_json,
    settings_json: item.settings_json,
    settings: Object.keys(item.settings_json || {}).length > 0 ? item.settings_json : item.layout_json,
    header_logo: item.header_logo,
    logo_url: item.logo_url,
    logo_url_resolved: item.logo_url || item.header_logo,
    shop_name: item.shop_name,
    shop_address: item.shop_address,
    shop_phone: item.shop_phone,
    is_default: item.is_default,
    updated_at: item.updated_at,
  };
}

function buildPrintTemplatePayload(body = {}, options = {}) {
  const partial = options.partial === true;
  const payload = {};

  const nameInput = pickBodyValue(body, ['template_name', 'name']);
  const templateName = cleanText(nameInput.value, 150);
  if (!partial && !templateName) return { error: 'Vui lòng nhập tên mẫu in hóa đơn.' };
  if (nameInput.provided) {
    if (!templateName) return { error: 'Tên mẫu in hóa đơn không được để trống.' };
    payload.template_name = templateName;
  }

  const codeInput = pickBodyValue(body, ['code', 'template_code']);
  if (codeInput.provided) payload.code = normalizeCode(codeInput.value);
  if (!partial && !payload.code) payload.code = normalizeCode(templateName || 'mau-in-hoa-don');

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
  if (layoutInput.provided) {
    const parsed = parseJsonObjectInput(layoutInput.value, 'layout_json', DEFAULT_LAYOUT_JSON);
    if (parsed.error) return { error: parsed.error };
    payload.layout_json = parsed.value === null ? null : JSON.stringify(parsed.value);
  } else if (!partial) {
    payload.layout_json = JSON.stringify(DEFAULT_LAYOUT_JSON);
  }

  const settingsInput = pickBodyValue(body, ['settings_json', 'settings']);
  if (settingsInput.provided) {
    const parsed = parseJsonObjectInput(settingsInput.value, 'settings_json', DEFAULT_SETTINGS_JSON);
    if (parsed.error) return { error: parsed.error };
    payload.settings_json = parsed.value === null ? null : JSON.stringify(parsed.value);
  } else if (!partial) {
    payload.settings_json = JSON.stringify(DEFAULT_SETTINGS_JSON);
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
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
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

async function createPrintTemplate(options = {}) {
  await ensureReady();
  const accountId = normalizeAccountId(options.accountId);
  const userId = normalizeUserId(options.userId);
  const parsed = buildPrintTemplatePayload(options.body || {}, { partial: false });
  if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');

  const payload = {
    account_id: accountId,
    ...parsed.value,
    created_by: userId,
    updated_by: userId,
  };
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
  if (parsed.error) throw createHttpError(400, parsed.error, 'PRINT_TEMPLATE_VALIDATION_ERROR');
  const payload = { ...parsed.value };
  if (Object.keys(payload).length === 0) throw createHttpError(400, 'Không có dữ liệu cập nhật mẫu in hóa đơn.', 'PRINT_TEMPLATE_EMPTY_UPDATE');
  payload.updated_by = userId;

  const existing = await getTemplateRowById(accountId, id);
  if (!existing) throw createHttpError(404, 'Không tìm thấy mẫu in hóa đơn.', 'PRINT_TEMPLATE_NOT_FOUND');
  await ensureNoDuplicateTemplate(accountId, payload, id);

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

  const payload = {
    header_logo: nullableText(options.headerLogo, 1024),
    logo_url: nullableText(options.logoUrl || options.headerLogo, 1024),
    logo_path: nullableText(options.logoPath, 1024),
    logo_mime: nullableText(options.logoMime, 100),
    logo_size: Number(options.logoSize) || null,
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

  const payload = {
    header_logo: null,
    logo_url: null,
    logo_path: null,
    logo_mime: null,
    logo_size: null,
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
  if (!defaultTemplate) return null;
  return serializePrintTemplateForInvoice(defaultTemplate);
}

module.exports = {
  DEFAULT_LAYOUT_JSON,
  DEFAULT_SETTINGS_JSON,
  createHttpError,
  parseId,
  parseBooleanFlag,
  serializePrintTemplate,
  serializePrintTemplateForInvoice,
  buildPrintTemplatePayload,
  listPrintTemplates,
  getPrintTemplateById,
  getDefaultPrintTemplate,
  createPrintTemplate,
  updatePrintTemplate,
  setDefaultPrintTemplate,
  softDeletePrintTemplate,
  attachLogoToPrintTemplate,
  removeLogoFromPrintTemplate,
  countTemplatesUsingLogoPath,
  resolveInvoicePrintTemplate,
};
