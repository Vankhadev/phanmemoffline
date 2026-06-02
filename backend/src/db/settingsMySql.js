const { loadEnv } = require('../utils/loadEnv');

const CONFIGURATION_ERROR_CODE = 'SETTINGS_MYSQL_NOT_CONFIGURED';
const MODULE_ERROR_CODE = 'SETTINGS_MYSQL_DRIVER_MISSING';
const CONNECTION_ERROR_CODE = 'SETTINGS_MYSQL_UNAVAILABLE';

const SETTINGS_TABLE = 'system_settings';
const NEGATIVE_STOCK_ENABLED_KEY = 'negative_stock_enabled';
const NEGATIVE_STOCK_LIMIT_KEY = 'negative_stock_limit';
const DEFAULT_NEGATIVE_STOCK_LIMIT = 10;

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'HANDSHAKE_INACTIVITY_TIMEOUT',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
]);

let dotenvLoaded = false;
let mysqlPromise = null;
let pool = null;
let currentPoolFingerprint = '';
let lastConnectionError = null;
let schemaReady = false;
let schemaReadyFingerprint = '';

function loadDotEnvOnce(options = {}) {
  if (dotenvLoaded && options.force !== true) return;
  dotenvLoaded = true;
  loadEnv(options);
}

function firstEnv(...keys) {
  loadDotEnvOnce();
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function readIntegerEnv(keys, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = firstEnv(...keys);
  if (raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function createUnavailableError(message, code = CONFIGURATION_ERROR_CODE, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.statusCode = 503;
  error.expose = true;
  if (cause) error.cause = cause;
  return error;
}

function loadMysqlDriver() {
  if (mysqlPromise) return mysqlPromise;
  try {
    mysqlPromise = require('mysql2/promise');
    return mysqlPromise;
  } catch (error) {
    throw createUnavailableError(
      'Backend chưa cài được driver mysql2 cho cấu hình settings. Vui lòng chạy npm install trong thư mục backend.',
      MODULE_ERROR_CODE,
      error
    );
  }
}

function redactConnectionUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch (_error) {
    return 'mysql://***';
  }
}

function resolveSettingsMySqlConfig() {
  loadDotEnvOnce();

  const connectionLimit = readIntegerEnv(
    ['KHA_SETTINGS_MYSQL_CONNECTION_LIMIT', 'SETTINGS_MYSQL_CONNECTION_LIMIT', 'MYSQL_CONNECTION_LIMIT'],
    5,
    { min: 1, max: 50 }
  );
  const connectTimeout = readIntegerEnv(
    ['KHA_SETTINGS_MYSQL_CONNECT_TIMEOUT_MS', 'SETTINGS_MYSQL_CONNECT_TIMEOUT_MS', 'MYSQL_CONNECT_TIMEOUT_MS'],
    3000,
    { min: 500, max: 60000 }
  );

  const url = firstEnv(
    'KHA_SETTINGS_MYSQL_URL',
    'SETTINGS_MYSQL_URL',
    'MYSQL_URL'
  );

  if (url) {
    return {
      configured: true,
      mode: 'url',
      fingerprint: `url:${url}`,
      safe: {
        url: redactConnectionUrl(url),
        connectionLimit,
        connectTimeout,
      },
      options: {
        uri: url,
        waitForConnections: true,
        connectionLimit,
        queueLimit: 0,
        connectTimeout,
        charset: 'utf8mb4',
        timezone: 'Z',
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: false,
      },
    };
  }

  const host = firstEnv('KHA_SETTINGS_MYSQL_HOST', 'SETTINGS_MYSQL_HOST', 'DB_HOST', 'MYSQL_HOST');
  const port = readIntegerEnv(['KHA_SETTINGS_MYSQL_PORT', 'SETTINGS_MYSQL_PORT', 'DB_PORT', 'MYSQL_PORT'], 3306, { min: 1, max: 65535 });
  const user = firstEnv(
    'KHA_SETTINGS_MYSQL_USER',
    'KHA_SETTINGS_MYSQL_USERNAME',
    'SETTINGS_MYSQL_USER',
    'SETTINGS_MYSQL_USERNAME',
    'DB_USER',
    'DB_USERNAME',
    'MYSQL_USER'
  );
  const password = firstEnv('KHA_SETTINGS_MYSQL_PASSWORD', 'SETTINGS_MYSQL_PASSWORD', 'DB_PASSWORD', 'MYSQL_PASSWORD');
  const database = firstEnv(
    'KHA_SETTINGS_MYSQL_DATABASE',
    'KHA_SETTINGS_MYSQL_DB',
    'SETTINGS_MYSQL_DATABASE',
    'SETTINGS_MYSQL_DB',
    'DB_NAME',
    'DB_DATABASE',
    'MYSQL_DATABASE'
  );

  const missing = [];
  if (!host) missing.push('DB_HOST/MYSQL_HOST');
  if (!user) missing.push('DB_USER/MYSQL_USER');
  if (!database) missing.push('DB_NAME/MYSQL_DATABASE');

  if (missing.length > 0) {
    return {
      configured: false,
      mode: 'env',
      missing,
      safe: {
        host: host || '',
        port,
        user: user || '',
        database: database || '',
        connectionLimit,
        connectTimeout,
      },
      message: `Chưa cấu hình MySQL cho settings. Cần DB_HOST/DB_USER/DB_PASSWORD/DB_NAME hoặc MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE trong backend/.env; có thể dùng MYSQL_URL/KHA_SETTINGS_MYSQL_URL. Thiếu: ${missing.join(', ')}.`,
    };
  }

  return {
    configured: true,
    mode: 'env',
    fingerprint: `env:${host}:${port}:${user}:${database}`,
    safe: {
      host,
      port,
      user,
      database,
      connectionLimit,
      connectTimeout,
    },
    options: {
      host,
      port,
      user,
      password: password || '',
      database,
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,
      connectTimeout,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
    },
  };
}

function isSettingsMySqlConfigured() {
  return resolveSettingsMySqlConfig().configured === true;
}

function getSettingsMySqlStatus() {
  const config = resolveSettingsMySqlConfig();
  return {
    configured: config.configured === true,
    mode: config.mode,
    missing: config.missing || [],
    connected: Boolean(pool),
    poolReady: Boolean(pool),
    schemaReady: Boolean(schemaReady && schemaReadyFingerprint === config.fingerprint),
    config: config.safe || {},
    lastError: lastConnectionError ? {
      code: lastConnectionError.code || '',
      message: lastConnectionError.message || 'Không thể kết nối MySQL cho settings',
    } : null,
  };
}

function normalizeSettingsMySqlError(error) {
  if (!error) return createUnavailableError('Không thể kết nối MySQL cho settings.', CONNECTION_ERROR_CODE);
  if (error.status === 503 || error.code === CONFIGURATION_ERROR_CODE || error.code === MODULE_ERROR_CODE) return error;

  const code = String(error.code || '').toUpperCase();
  if (CONNECTION_ERROR_CODES.has(code) || error.fatal === true) {
    const detail = error.message ? ` Chi tiết: ${error.message}` : '';
    return createUnavailableError(`MySQL cho settings đang không khả dụng. Vui lòng kiểm tra DB_HOST/DB_USER/DB_PASSWORD/DB_NAME hoặc MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE, KHA_SETTINGS_MYSQL_URL và trạng thái MySQL.${detail}`, CONNECTION_ERROR_CODE, error);
  }

  error.status = error.status || 500;
  error.statusCode = error.statusCode || error.status;
  return error;
}

function getSettingsPool() {
  const config = resolveSettingsMySqlConfig();
  if (!config.configured) {
    throw createUnavailableError(config.message || 'Chưa cấu hình MySQL cho settings.', CONFIGURATION_ERROR_CODE);
  }

  if (pool && currentPoolFingerprint === config.fingerprint) return pool;

  const mysql = loadMysqlDriver();
  pool = mysql.createPool(config.options);
  currentPoolFingerprint = config.fingerprint;
  schemaReady = false;
  schemaReadyFingerprint = '';
  lastConnectionError = null;
  return pool;
}

async function withSettingsConnection(callback) {
  let connection = null;
  try {
    connection = await getSettingsPool().getConnection();
    const result = await callback(connection);
    lastConnectionError = null;
    return result;
  } catch (error) {
    const normalized = normalizeSettingsMySqlError(error);
    if (normalized.status === 503) lastConnectionError = normalized;
    throw normalized;
  } finally {
    if (connection) connection.release();
  }
}

async function withSettingsTransaction(callback) {
  let connection = null;
  try {
    connection = await getSettingsPool().getConnection();
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    lastConnectionError = null;
    return result;
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {
        // Keep original error.
      }
    }
    const normalized = normalizeSettingsMySqlError(error);
    if (normalized.status === 503) lastConnectionError = normalized;
    throw normalized;
  } finally {
    if (connection) connection.release();
  }
}

async function ensureSettingsSchema(options = {}) {
  if (!isSettingsMySqlConfigured()) {
    if (options.failSoft === true) return { ok: false, skipped: true, error: resolveSettingsMySqlConfig().message || 'Chưa cấu hình MySQL cho settings.' };
    throw createUnavailableError(resolveSettingsMySqlConfig().message || 'Chưa cấu hình MySQL cho settings.', CONFIGURATION_ERROR_CODE);
  }

  const config = resolveSettingsMySqlConfig();
  if (schemaReady && schemaReadyFingerprint === config.fingerprint) return { ok: true, migrated: false, alreadyReady: true };

  try {
    const result = await withSettingsConnection(async (connection) => {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`${SETTINGS_TABLE}\` (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          account_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
          setting_key VARCHAR(191) NOT NULL,
          value TEXT NULL,
          value_type VARCHAR(40) NOT NULL DEFAULT 'string',
          category VARCHAR(100) NOT NULL DEFAULT 'general',
          description TEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          deleted_at DATETIME NULL,
          PRIMARY KEY (id),
          KEY idx_system_settings_account_key (account_id, setting_key),
          KEY idx_system_settings_deleted (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      const [columns] = await connection.query(`SHOW COLUMNS FROM \`${SETTINGS_TABLE}\``);
      const columnNames = new Set((columns || []).map(column => String(column.Field || '').toLowerCase()));
      const migrations = [];
      if (!columnNames.has('account_id')) migrations.push(`ADD COLUMN account_id BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER id`);
      if (!columnNames.has('setting_key')) migrations.push(`ADD COLUMN setting_key VARCHAR(191) NOT NULL DEFAULT '' AFTER account_id`);
      if (!columnNames.has('value')) migrations.push(`ADD COLUMN value TEXT NULL AFTER setting_key`);
      if (!columnNames.has('value_type')) migrations.push(`ADD COLUMN value_type VARCHAR(40) NOT NULL DEFAULT 'string' AFTER value`);
      if (!columnNames.has('category')) migrations.push(`ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'general' AFTER value_type`);
      if (!columnNames.has('description')) migrations.push(`ADD COLUMN description TEXT NULL AFTER category`);
      if (!columnNames.has('created_at')) migrations.push(`ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER description`);
      if (!columnNames.has('updated_at')) migrations.push(`ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`);
      if (!columnNames.has('deleted_at')) migrations.push(`ADD COLUMN deleted_at DATETIME NULL AFTER updated_at`);

      if (migrations.length > 0) {
        await connection.query(`ALTER TABLE \`${SETTINGS_TABLE}\` ${migrations.join(', ')}`);
      }

      return { ok: true, migrated: migrations.length > 0, migrations };
    });

    schemaReady = true;
    schemaReadyFingerprint = config.fingerprint;
    return result;
  } catch (error) {
    if (options.failSoft === true) return { ok: false, error: error.message, code: error.code || 'SETTINGS_SCHEMA_ERROR' };
    throw error;
  }
}

function normalizeAccountId(accountId) {
  const id = Number(accountId);
  return Number.isInteger(id) && id > 0 ? id : 1;
}

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}

function serializeMySqlSetting(row) {
  if (!row) return null;
  return {
    id: row.id,
    account_id: row.account_id || null,
    key: normalizeKey(row.setting_key || row.key),
    value: row.value,
    value_type: row.value_type || 'string',
    category: row.category || 'general',
    description: row.description || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    deleted_at: row.deleted_at || null,
    source: 'mysql',
  };
}

async function findSettingRowForUpdate(connection, key, accountId = 1) {
  const [rows] = await connection.execute(
    `SELECT * FROM \`${SETTINGS_TABLE}\` WHERE account_id = ? AND setting_key = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1 FOR UPDATE`,
    [normalizeAccountId(accountId), normalizeKey(key)]
  );
  return rows?.[0] || null;
}

async function findSettingRow(key, accountId = 1) {
  await ensureSettingsSchema();
  return withSettingsConnection(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT * FROM \`${SETTINGS_TABLE}\` WHERE account_id = ? AND setting_key = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
      [normalizeAccountId(accountId), normalizeKey(key)]
    );
    return serializeMySqlSetting(rows?.[0] || null);
  });
}

async function upsertSettingRow(connection, { key, value, valueType = 'string', category = 'general', description = '', accountId = 1 }) {
  const normalizedAccountId = normalizeAccountId(accountId);
  const normalizedKey = normalizeKey(key);
  const existing = await findSettingRowForUpdate(connection, normalizedKey, normalizedAccountId);
  if (existing) {
    await connection.execute(
      `UPDATE \`${SETTINGS_TABLE}\` SET value = ?, value_type = ?, category = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [String(value ?? ''), valueType, category, description, existing.id]
    );
    return { ...existing, value: String(value ?? ''), value_type: valueType, category, description };
  }

  const [result] = await connection.execute(
    `INSERT INTO \`${SETTINGS_TABLE}\` (account_id, setting_key, value, value_type, category, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [normalizedAccountId, normalizedKey, String(value ?? ''), valueType, category, description]
  );
  return {
    id: result.insertId,
    account_id: normalizedAccountId,
    setting_key: normalizedKey,
    value: String(value ?? ''),
    value_type: valueType,
    category,
    description,
  };
}

async function ensureNegativeStockSettingsInMySql({ accountId = 1, enabled = false, limit = DEFAULT_NEGATIVE_STOCK_LIMIT } = {}) {
  await ensureSettingsSchema();
  const normalizedAccountId = normalizeAccountId(accountId);
  const normalizedLimit = Number.isInteger(Number(limit)) && Number(limit) >= 0 ? Math.trunc(Number(limit)) : DEFAULT_NEGATIVE_STOCK_LIMIT;
  const normalizedEnabled = enabled ? '1' : '0';

  return withSettingsTransaction(async (connection) => {
    const enabledRow = await findSettingRowForUpdate(connection, NEGATIVE_STOCK_ENABLED_KEY, normalizedAccountId);
    if (!enabledRow) {
      await upsertSettingRow(connection, {
        accountId: normalizedAccountId,
        key: NEGATIVE_STOCK_ENABLED_KEY,
        value: normalizedEnabled,
        valueType: 'boolean',
        category: 'inventory',
        description: 'Bật/tắt chức năng xuất âm tồn kho.',
      });
    }

    const limitRow = await findSettingRowForUpdate(connection, NEGATIVE_STOCK_LIMIT_KEY, normalizedAccountId);
    if (!limitRow) {
      await upsertSettingRow(connection, {
        accountId: normalizedAccountId,
        key: NEGATIVE_STOCK_LIMIT_KEY,
        value: String(normalizedLimit),
        valueType: 'integer',
        category: 'inventory',
        description: 'Admin có thể chỉnh số lượng tồn âm tối đa trực tiếp từ giao diện.',
      });
    }

    const [rows] = await connection.execute(
      `SELECT * FROM \`${SETTINGS_TABLE}\` WHERE account_id = ? AND setting_key IN (?, ?) AND deleted_at IS NULL ORDER BY setting_key ASC`,
      [normalizedAccountId, NEGATIVE_STOCK_ENABLED_KEY, NEGATIVE_STOCK_LIMIT_KEY]
    );
    return (rows || []).map(serializeMySqlSetting);
  });
}

async function getNegativeStockSettingsRowsFromMySql({ accountId = 1 } = {}) {
  await ensureSettingsSchema();
  const normalizedAccountId = normalizeAccountId(accountId);
  return withSettingsConnection(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT * FROM \`${SETTINGS_TABLE}\` WHERE account_id = ? AND setting_key IN (?, ?) AND deleted_at IS NULL ORDER BY setting_key ASC`,
      [normalizedAccountId, NEGATIVE_STOCK_ENABLED_KEY, NEGATIVE_STOCK_LIMIT_KEY]
    );
    return (rows || []).map(serializeMySqlSetting);
  });
}

async function saveNegativeStockSettingsToMySql({ accountId = 1, enabled, limit }) {
  await ensureSettingsSchema();
  const normalizedAccountId = normalizeAccountId(accountId);
  const normalizedLimit = Number.isInteger(Number(limit)) && Number(limit) >= 0 ? Math.trunc(Number(limit)) : DEFAULT_NEGATIVE_STOCK_LIMIT;
  const normalizedEnabled = enabled ? '1' : '0';

  return withSettingsTransaction(async (connection) => {
    await upsertSettingRow(connection, {
      accountId: normalizedAccountId,
      key: NEGATIVE_STOCK_ENABLED_KEY,
      value: normalizedEnabled,
      valueType: 'boolean',
      category: 'inventory',
      description: 'Bật/tắt chức năng xuất âm tồn kho.',
    });
    await upsertSettingRow(connection, {
      accountId: normalizedAccountId,
      key: NEGATIVE_STOCK_LIMIT_KEY,
      value: String(normalizedLimit),
      valueType: 'integer',
      category: 'inventory',
      description: 'Admin có thể chỉnh số lượng tồn âm tối đa trực tiếp từ giao diện.',
    });

    const [rows] = await connection.execute(
      `SELECT * FROM \`${SETTINGS_TABLE}\` WHERE account_id = ? AND setting_key IN (?, ?) AND deleted_at IS NULL ORDER BY setting_key ASC`,
      [normalizedAccountId, NEGATIVE_STOCK_ENABLED_KEY, NEGATIVE_STOCK_LIMIT_KEY]
    );
    return (rows || []).map(serializeMySqlSetting);
  });
}

async function closeSettingsPool() {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  currentPoolFingerprint = '';
  schemaReady = false;
  schemaReadyFingerprint = '';
  await currentPool.end();
}

module.exports = {
  CONFIGURATION_ERROR_CODE,
  MODULE_ERROR_CODE,
  CONNECTION_ERROR_CODE,
  SETTINGS_TABLE,
  NEGATIVE_STOCK_ENABLED_KEY,
  NEGATIVE_STOCK_LIMIT_KEY,
  DEFAULT_NEGATIVE_STOCK_LIMIT,
  createUnavailableError,
  loadSettingsEnv: loadDotEnvOnce,
  resolveSettingsMySqlConfig,
  isSettingsMySqlConfigured,
  getSettingsMySqlStatus,
  normalizeSettingsMySqlError,
  getSettingsPool,
  withSettingsConnection,
  withSettingsTransaction,
  ensureSettingsSchema,
  findSettingRow,
  ensureNegativeStockSettingsInMySql,
  getNegativeStockSettingsRowsFromMySql,
  saveNegativeStockSettingsToMySql,
  closeSettingsPool,
};
