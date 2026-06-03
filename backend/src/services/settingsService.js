const {
  getOne,
  insert,
  update,
  now,
  auditLog,
  getActiveAccountId,
  withAtomicDbWrite,
} = require('../db/database');
const {
  isSettingsMySqlConfigured,
  getSettingsMySqlStatus,
  ensureNegativeStockSettingsInMySql,
  getNegativeStockSettingsRowsFromMySql,
  saveNegativeStockSettingsToMySql,
} = require('../db/settingsMySql');

const SETTINGS_TABLE = 'system_settings';
const FEATURE_TABLE = 'feature_catalog';
const NEGATIVE_STOCK_FEATURE_KEY = 'negative_stock_exports';
const NEGATIVE_STOCK_ENABLED_KEY = 'negative_stock_enabled';
const NEGATIVE_STOCK_LIMIT_KEY = 'negative_stock_limit';
const DEFAULT_NEGATIVE_STOCK_LIMIT = 10;
const NEGATIVE_STOCK_SETTINGS_CACHE_TTL_MS = 30 * 1000;
const negativeStockSettingsCache = new Map();

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toAccountId(value = getActiveAccountId()) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanText(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  const normalized = cleanText(value, 30).toLowerCase();
  if (['true', 'yes', 'y', 'on', 'active', 'enabled', 'bat', 'bật', 'co', 'có'].includes(normalized)) return true;
  if (['false', 'no', 'n', 'off', 'inactive', 'disabled', 'tat', 'tắt', 'khong', 'không'].includes(normalized)) return false;
  return Boolean(fallback);
}

function parseStoredNonNegativeInteger(value, fallback = DEFAULT_NEGATIVE_STOCK_LIMIT) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
  return number;
}

function parseNonNegativeIntegerInput(value, fieldName = NEGATIVE_STOCK_LIMIT_KEY) {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0) return { ok: true, value };
    return { ok: false, error: `${fieldName} phải là số nguyên >= 0.` };
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d+$/.test(text)) {
      const parsed = Number(text);
      if (Number.isSafeInteger(parsed) && parsed >= 0) return { ok: true, value: parsed };
    }
  }

  return { ok: false, error: `${fieldName} phải là số nguyên >= 0, không nhận text hoặc số âm.` };
}

function cloneNegativeStockSettings(settings = {}) {
  return JSON.parse(JSON.stringify(settings || {}));
}

function getNegativeStockSettingsCacheKey(accountId = getActiveAccountId()) {
  return String(toAccountId(accountId) || toAccountId(getActiveAccountId()) || 1);
}

function readNegativeStockSettingsCache(accountId = getActiveAccountId()) {
  const key = getNegativeStockSettingsCacheKey(accountId);
  const entry = negativeStockSettingsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > NEGATIVE_STOCK_SETTINGS_CACHE_TTL_MS) {
    negativeStockSettingsCache.delete(key);
    return null;
  }
  return cloneNegativeStockSettings(entry.value);
}

function writeNegativeStockSettingsCache(accountId = getActiveAccountId(), settings = {}) {
  const key = getNegativeStockSettingsCacheKey(accountId);
  negativeStockSettingsCache.set(key, {
    cachedAt: Date.now(),
    value: cloneNegativeStockSettings(settings),
  });
  return settings;
}

function invalidateNegativeStockSettingsCache(accountId = null) {
  if (accountId === null || accountId === undefined) {
    negativeStockSettingsCache.clear();
    return;
  }
  negativeStockSettingsCache.delete(getNegativeStockSettingsCacheKey(accountId));
}

function rowsToSettingsMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeKey(row?.key || row?.setting_key);
    if (key) map.set(key, row);
  }
  return map;
}

function buildNegativeStockSettingsFromRows({ rows = [], feature = null, accountId = getActiveAccountId(), source = 'json' } = {}) {
  const rowMap = rowsToSettingsMap(rows);
  const enabledRow = rowMap.get(NEGATIVE_STOCK_ENABLED_KEY) || null;
  const limitRow = rowMap.get(NEGATIVE_STOCK_LIMIT_KEY) || null;
  const enabled = parseBooleanFlag(enabledRow?.value, feature && feature.active !== 0);
  const limit = parseStoredNonNegativeInteger(limitRow?.value, DEFAULT_NEGATIVE_STOCK_LIMIT);
  const minimumAllowedStock = enabled ? -limit : 0;

  return {
    negative_stock_enabled: enabled,
    negativeStockEnabled: enabled,
    negative_stock_limit: limit,
    negativeStockLimit: limit,
    minimum_allowed_stock: minimumAllowedStock,
    minimumAllowedStock,
    runtime_minimum_stock: minimumAllowedStock,
    source,
    mysql: getSettingsMySqlStatus(),
    feature_key: NEGATIVE_STOCK_FEATURE_KEY,
    feature: feature ? {
      id: feature.id,
      feature_key: feature.feature_key || feature.key || feature.code || NEGATIVE_STOCK_FEATURE_KEY,
      active: feature.active !== 0,
      name: feature.name || 'Xuất âm tồn kho',
      category: feature.category || 'Kho hàng',
    } : null,
    settings: {
      [NEGATIVE_STOCK_ENABLED_KEY]: enabledRow,
      [NEGATIVE_STOCK_LIMIT_KEY]: limitRow,
    },
    account_id: toAccountId(accountId) || null,
  };
}

function serializeSettingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    account_id: row.account_id || null,
    key: normalizeKey(row.key || row.setting_key),
    value: row.value,
    value_type: row.value_type || 'string',
    category: row.category || 'general',
    description: row.description || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    deleted_at: row.deleted_at || null,
    source: row.source || 'json',
  };
}

function findFeatureByKey(featureKey = NEGATIVE_STOCK_FEATURE_KEY) {
  const key = normalizeKey(featureKey);
  return getOne(
    FEATURE_TABLE,
    row => row && !row.deleted_at && normalizeKey(row.feature_key || row.key || row.code) === key,
    { skipAccountScope: true }
  );
}

function findSettingRow(key, accountId = getActiveAccountId()) {
  const normalizedKey = normalizeKey(key);
  const normalizedAccountId = toAccountId(accountId);
  return getOne(
    SETTINGS_TABLE,
    row => row
      && !row.deleted_at
      && normalizeKey(row.key || row.setting_key) === normalizedKey
      && (normalizedAccountId == null || row.account_id == null || Number(row.account_id) === Number(normalizedAccountId)),
    { skipAccountScope: normalizedAccountId == null }
  );
}

function upsertSettingRow({ key, value, valueType = 'string', category = 'general', description = '', accountId = getActiveAccountId() }, options = {}) {
  const normalizedKey = normalizeKey(key);
  const normalizedAccountId = toAccountId(accountId) || toAccountId(getActiveAccountId()) || 1;
  const existing = findSettingRow(normalizedKey, normalizedAccountId);
  const payload = {
    account_id: normalizedAccountId,
    key: normalizedKey,
    value: String(value ?? ''),
    value_type: valueType,
    category,
    description,
    updated_at: now(),
  };

  if (existing) {
    return update(SETTINGS_TABLE, existing.id, payload, { skipSave: options.skipSave === true });
  }

  const id = insert(SETTINGS_TABLE, {
    ...payload,
    created_at: now(),
  }, { skipSave: options.skipSave === true, accountId: normalizedAccountId });
  return findSettingRow(normalizedKey, normalizedAccountId) || { id, ...payload };
}

function ensureNegativeStockSettings(accountId = getActiveAccountId(), options = {}) {
  const normalizedAccountId = toAccountId(accountId) || toAccountId(getActiveAccountId()) || 1;
  const feature = findFeatureByKey(NEGATIVE_STOCK_FEATURE_KEY);
  const enabledRow = findSettingRow(NEGATIVE_STOCK_ENABLED_KEY, normalizedAccountId);
  const limitRow = findSettingRow(NEGATIVE_STOCK_LIMIT_KEY, normalizedAccountId);

  if (!enabledRow) {
    upsertSettingRow({
      key: NEGATIVE_STOCK_ENABLED_KEY,
      value: feature && feature.active !== 0 ? '1' : '0',
      valueType: 'boolean',
      category: 'inventory',
      description: 'Bật/tắt chức năng xuất âm tồn kho.',
      accountId: normalizedAccountId,
    }, options);
  }

  if (!limitRow) {
    upsertSettingRow({
      key: NEGATIVE_STOCK_LIMIT_KEY,
      value: String(DEFAULT_NEGATIVE_STOCK_LIMIT),
      valueType: 'integer',
      category: 'inventory',
      description: 'Admin có thể chỉnh số lượng tồn âm tối đa trực tiếp từ giao diện.',
      accountId: normalizedAccountId,
    }, options);
  }
}

function mirrorNegativeStockSettingsToJson(settings = {}, context = {}) {
  const accountId = toAccountId(context.accountId || context.account_id || settings.account_id) || toAccountId(getActiveAccountId()) || 1;
  const enabled = parseBooleanFlag(settings.negative_stock_enabled ?? settings.enabled, false);
  const limit = parseStoredNonNegativeInteger(settings.negative_stock_limit ?? settings.limit, DEFAULT_NEGATIVE_STOCK_LIMIT);

  invalidateNegativeStockSettingsCache(accountId);
  return withAtomicDbWrite(() => {
    upsertSettingRow({
      key: NEGATIVE_STOCK_ENABLED_KEY,
      value: enabled ? '1' : '0',
      valueType: 'boolean',
      category: 'inventory',
      description: 'Bật/tắt chức năng xuất âm tồn kho.',
      accountId,
    }, { skipSave: true });

    upsertSettingRow({
      key: NEGATIVE_STOCK_LIMIT_KEY,
      value: String(limit),
      valueType: 'integer',
      category: 'inventory',
      description: 'Admin có thể chỉnh số lượng tồn âm tối đa trực tiếp từ giao diện.',
      accountId,
    }, { skipSave: true });

    syncNegativeStockFeature(enabled, { ...context, account_id: accountId }, { skipSave: true });
    const mirrored = getNegativeStockSettings({ accountId, skipSave: true, skipCache: true });
    writeNegativeStockSettingsCache(accountId, mirrored);
    return mirrored;
  });
}

function getNegativeStockSettings(options = {}) {
  const accountId = toAccountId(options.accountId) || toAccountId(getActiveAccountId()) || 1;
  if (options.skipCache !== true && options.forceRefresh !== true) {
    const cached = readNegativeStockSettingsCache(accountId);
    if (cached) return cached;
  }

  ensureNegativeStockSettings(accountId, { skipSave: options.skipSave === true });
  const enabledRow = serializeSettingRow(findSettingRow(NEGATIVE_STOCK_ENABLED_KEY, accountId));
  const limitRow = serializeSettingRow(findSettingRow(NEGATIVE_STOCK_LIMIT_KEY, accountId));
  const feature = findFeatureByKey(NEGATIVE_STOCK_FEATURE_KEY);
  const settings = buildNegativeStockSettingsFromRows({ rows: [enabledRow, limitRow].filter(Boolean), feature, accountId, source: 'json' });
  if (options.skipCache !== true) writeNegativeStockSettingsCache(accountId, settings);
  return settings;
}

async function getNegativeStockSettingsAsync(options = {}) {
  const accountId = toAccountId(options.accountId) || toAccountId(getActiveAccountId()) || 1;
  if (options.skipCache !== true && options.forceRefresh !== true) {
    const cached = readNegativeStockSettingsCache(accountId);
    if (cached) return cached;
  }

  const feature = findFeatureByKey(NEGATIVE_STOCK_FEATURE_KEY);
  const fallback = getNegativeStockSettings({ accountId, skipSave: options.skipSave === true, skipCache: true });

  if (!isSettingsMySqlConfigured()) {
    const result = { ...fallback, mysql: getSettingsMySqlStatus(), source: 'json_fallback' };
    if (options.skipCache !== true) writeNegativeStockSettingsCache(accountId, result);
    return result;
  }

  try {
    await ensureNegativeStockSettingsInMySql({
      accountId,
      enabled: fallback.negative_stock_enabled,
      limit: fallback.negative_stock_limit,
    });
    const rows = await getNegativeStockSettingsRowsFromMySql({ accountId });
    const mysqlSettings = buildNegativeStockSettingsFromRows({ rows, feature, accountId, source: 'mysql' });
    mirrorNegativeStockSettingsToJson(mysqlSettings, { accountId, source: 'settings_mysql_read' });
    if (options.skipCache !== true) writeNegativeStockSettingsCache(accountId, mysqlSettings);
    return mysqlSettings;
  } catch (error) {
    console.warn('[KHA SETTINGS MYSQL] Không thể đọc negative_stock_limit từ MySQL, dùng JSON fallback:', error.message);
    const result = {
      ...fallback,
      source: 'json_fallback',
      mysql: {
        ...getSettingsMySqlStatus(),
        lastError: {
          code: error.code || 'SETTINGS_MYSQL_READ_ERROR',
          message: error.message,
        },
      },
    };
    if (options.skipCache !== true) writeNegativeStockSettingsCache(accountId, result);
    return result;
  }
}

function syncNegativeStockFeature(enabled, context = {}, options = {}) {
  const active = parseBooleanFlag(enabled, false) ? 1 : 0;
  const feature = findFeatureByKey(NEGATIVE_STOCK_FEATURE_KEY);
  if (feature) {
    return update(FEATURE_TABLE, feature.id, {
      active,
      updated_at: now(),
      metadata: feature.metadata && typeof feature.metadata === 'object' ? feature.metadata : {},
    }, { skipSave: options.skipSave === true, skipAccountScope: true });
  }

  const id = insert(FEATURE_TABLE, {
    account_id: context.account_id || context.accountId || getActiveAccountId() || 1,
    feature_key: NEGATIVE_STOCK_FEATURE_KEY,
    name: 'Xuất âm tồn kho',
    description: 'Bật để cho phép xuất vượt tồn kho theo giới hạn cấu hình trong thiết lập hệ thống.',
    category: 'Kho hàng',
    active,
    metadata: {},
    created_at: now(),
    updated_at: now(),
  }, { skipSave: options.skipSave === true, skipAccountScope: true });
  return findFeatureByKey(NEGATIVE_STOCK_FEATURE_KEY) || { id, active };
}

function buildNegativeStockSettingsPayload(input = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const payload = {};
  const errors = [];

  const enabledProvided = Object.prototype.hasOwnProperty.call(body, NEGATIVE_STOCK_ENABLED_KEY)
    || Object.prototype.hasOwnProperty.call(body, 'negativeStockEnabled')
    || Object.prototype.hasOwnProperty.call(body, 'allow_negative_stock')
    || Object.prototype.hasOwnProperty.call(body, 'enabled');

  if (enabledProvided) {
    payload.negative_stock_enabled = parseBooleanFlag(
      body[NEGATIVE_STOCK_ENABLED_KEY] ?? body.negativeStockEnabled ?? body.allow_negative_stock ?? body.enabled,
      false
    );
  }

  const limitProvided = Object.prototype.hasOwnProperty.call(body, NEGATIVE_STOCK_LIMIT_KEY)
    || Object.prototype.hasOwnProperty.call(body, 'negativeStockLimit');

  if (limitProvided) {
    const parsed = parseNonNegativeIntegerInput(body[NEGATIVE_STOCK_LIMIT_KEY] ?? body.negativeStockLimit, NEGATIVE_STOCK_LIMIT_KEY);
    if (!parsed.ok) errors.push({ field: NEGATIVE_STOCK_LIMIT_KEY, message: parsed.error });
    else payload.negative_stock_limit = parsed.value;
  }

  if (!enabledProvided && !limitProvided) {
    errors.push({ field: 'settings', message: 'Không có thiết lập xuất âm tồn kho để cập nhật.' });
  }

  return { payload, errors };
}

function updateNegativeStockSettings(input = {}, context = {}) {
  return withAtomicDbWrite(() => {
    const accountId = toAccountId(context.accountId || context.account_id) || toAccountId(getActiveAccountId()) || 1;
    const parsed = buildNegativeStockSettingsPayload(input);
    if (parsed.errors.length > 0) {
      const error = new Error(parsed.errors.map(item => item.message).join(' '));
      error.status = 400;
      error.statusCode = 400;
      error.code = 'INVALID_NEGATIVE_STOCK_SETTINGS';
      error.details = parsed.errors;
      throw error;
    }

    invalidateNegativeStockSettingsCache(accountId);
    const before = getNegativeStockSettings({ accountId, skipSave: true, skipCache: true });
    const changes = {};

    if (Object.prototype.hasOwnProperty.call(parsed.payload, 'negative_stock_enabled')) {
      const nextEnabled = Boolean(parsed.payload.negative_stock_enabled);
      if (nextEnabled !== before.negative_stock_enabled) {
        changes.negative_stock_enabled = { before: before.negative_stock_enabled, after: nextEnabled };
      }
      upsertSettingRow({
        key: NEGATIVE_STOCK_ENABLED_KEY,
        value: nextEnabled ? '1' : '0',
        valueType: 'boolean',
        category: 'inventory',
        description: 'Bật/tắt chức năng xuất âm tồn kho.',
        accountId,
      }, { skipSave: true });
      syncNegativeStockFeature(nextEnabled, { ...context, account_id: accountId }, { skipSave: true });
    }

    if (Object.prototype.hasOwnProperty.call(parsed.payload, 'negative_stock_limit')) {
      const nextLimit = parsed.payload.negative_stock_limit;
      if (nextLimit !== before.negative_stock_limit) {
        changes.negative_stock_limit = { before: before.negative_stock_limit, after: nextLimit };
      }
      upsertSettingRow({
        key: NEGATIVE_STOCK_LIMIT_KEY,
        value: String(nextLimit),
        valueType: 'integer',
        category: 'inventory',
        description: 'Admin có thể chỉnh số lượng tồn âm tối đa trực tiếp từ giao diện.',
        accountId,
      }, { skipSave: true });
    }

    invalidateNegativeStockSettingsCache(accountId);
    const after = getNegativeStockSettings({ accountId, skipSave: true, skipCache: true });
    writeNegativeStockSettingsCache(accountId, after);
    if (changes.negative_stock_limit) {
      console.info('[KHA SETTINGS] negative_stock_limit updated', {
        account_id: accountId,
        user_id: context.userId || context.user_id || null,
        old_value: changes.negative_stock_limit.before,
        new_value: changes.negative_stock_limit.after,
        old_minimum_allowed_stock: before.minimum_allowed_stock,
        new_minimum_allowed_stock: after.minimum_allowed_stock,
        source: context.source || 'settings_api',
      });
    }
    if (Object.keys(changes).length > 0) {
      auditLog('settings.negative_stock_updated', {
        account_id: accountId,
        user_id: context.userId || context.user_id || null,
        source: context.source || 'settings_api',
        changes,
        before: {
          negative_stock_enabled: before.negative_stock_enabled,
          negative_stock_limit: before.negative_stock_limit,
          minimum_allowed_stock: before.minimum_allowed_stock,
        },
        after: {
          negative_stock_enabled: after.negative_stock_enabled,
          negative_stock_limit: after.negative_stock_limit,
          minimum_allowed_stock: after.minimum_allowed_stock,
        },
      }, { skipSave: true });
    }

    return { before, after, changes };
  });
}

async function updateNegativeStockSettingsAsync(input = {}, context = {}) {
  const result = updateNegativeStockSettings(input, context);
  if (!isSettingsMySqlConfigured()) {
    return {
      ...result,
      after: { ...result.after, mysql: getSettingsMySqlStatus(), source: 'json' },
    };
  }

  try {
    const rows = await saveNegativeStockSettingsToMySql({
      accountId: context.accountId || context.account_id || result.after.account_id || 1,
      enabled: result.after.negative_stock_enabled,
      limit: result.after.negative_stock_limit,
    });
    const mysqlAfter = buildNegativeStockSettingsFromRows({
      rows,
      feature: findFeatureByKey(NEGATIVE_STOCK_FEATURE_KEY),
      accountId: context.accountId || context.account_id || result.after.account_id || 1,
      source: 'mysql',
    });
    writeNegativeStockSettingsCache(context.accountId || context.account_id || result.after.account_id || 1, mysqlAfter);
    return { ...result, after: mysqlAfter };
  } catch (error) {
    console.warn('[KHA SETTINGS MYSQL] Không thể ghi negative_stock_limit vào MySQL; JSON đã được cập nhật:', error.message);
    throw error;
  }
}

function syncNegativeStockSettingFromFeature(active, context = {}, options = {}) {
  const accountId = toAccountId(context.accountId || context.account_id) || toAccountId(getActiveAccountId()) || 1;
  invalidateNegativeStockSettingsCache(accountId);
  const before = getNegativeStockSettings({ accountId, skipSave: true, skipCache: true });
  const nextEnabled = parseBooleanFlag(active, false);
  upsertSettingRow({
    key: NEGATIVE_STOCK_ENABLED_KEY,
    value: nextEnabled ? '1' : '0',
    valueType: 'boolean',
    category: 'inventory',
    description: 'Bật/tắt chức năng xuất âm tồn kho.',
    accountId,
  }, { skipSave: options.skipSave === true });
  invalidateNegativeStockSettingsCache(accountId);
  const after = getNegativeStockSettings({ accountId, skipSave: true, skipCache: true });
  writeNegativeStockSettingsCache(accountId, after);

  if (before.negative_stock_enabled !== after.negative_stock_enabled) {
    auditLog('settings.negative_stock_updated', {
      account_id: accountId,
      user_id: context.userId || context.user_id || null,
      source: context.source || 'features_api',
      changes: {
        negative_stock_enabled: { before: before.negative_stock_enabled, after: after.negative_stock_enabled },
      },
      before: {
        negative_stock_enabled: before.negative_stock_enabled,
        negative_stock_limit: before.negative_stock_limit,
        minimum_allowed_stock: before.minimum_allowed_stock,
      },
      after: {
        negative_stock_enabled: after.negative_stock_enabled,
        negative_stock_limit: after.negative_stock_limit,
        minimum_allowed_stock: after.minimum_allowed_stock,
      },
    }, { skipSave: options.skipSave === true });
  }

  return after;
}

module.exports = {
  SETTINGS_TABLE,
  FEATURE_TABLE,
  NEGATIVE_STOCK_FEATURE_KEY,
  NEGATIVE_STOCK_ENABLED_KEY,
  NEGATIVE_STOCK_LIMIT_KEY,
  DEFAULT_NEGATIVE_STOCK_LIMIT,
  NEGATIVE_STOCK_SETTINGS_CACHE_TTL_MS,
  normalizeKey,
  parseBooleanFlag,
  parseNonNegativeIntegerInput,
  invalidateNegativeStockSettingsCache,
  findFeatureByKey,
  findSettingRow,
  upsertSettingRow,
  ensureNegativeStockSettings,
  mirrorNegativeStockSettingsToJson,
  getNegativeStockSettings,
  getNegativeStockSettingsAsync,
  buildNegativeStockSettingsPayload,
  updateNegativeStockSettings,
  updateNegativeStockSettingsAsync,
  syncNegativeStockSettingFromFeature,
};
