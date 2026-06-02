const { loadEnv } = require('../utils/loadEnv');

const CONFIGURATION_ERROR_CODE = 'PRINT_TEMPLATES_MYSQL_NOT_CONFIGURED';
const MODULE_ERROR_CODE = 'PRINT_TEMPLATES_MYSQL_DRIVER_MISSING';
const CONNECTION_ERROR_CODE = 'PRINT_TEMPLATES_MYSQL_UNAVAILABLE';

const MYSQL_CONFIGURATION_MESSAGE = 'Thiếu cấu hình kết nối MySQL cho module mẫu in hóa đơn. Vui lòng kiểm tra DB_HOST, DB_PORT, DB_USER, DB_PASSWORD và DB_NAME trong backend/.env hoặc cấu hình URL MySQL tương ứng.';
const MYSQL_DATABASE_MISSING_MESSAGE = 'Database MySQL cho module mẫu in hóa đơn chưa tồn tại hoặc tài khoản MySQL không có quyền truy cập database. Hãy tạo database DB_NAME trước; backend sẽ tự tạo bảng print_templates khi kết nối được.';
const MYSQL_ACCESS_DENIED_MESSAGE = 'Tài khoản MySQL cho module mẫu in hóa đơn không thể truy cập database. Vui lòng kiểm tra DB_USER, DB_PASSWORD, DB_NAME và quyền của tài khoản MySQL.';
const MYSQL_UNAVAILABLE_MESSAGE = 'MySQL cho module mẫu in hóa đơn chưa sẵn sàng. Vui lòng kiểm tra cấu hình kết nối và trạng thái MySQL.';

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

function createUnavailableError(message, code = CONFIGURATION_ERROR_CODE, cause = null, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.expose = true;
  if (cause) error.cause = cause;
  if (details && typeof details === 'object') error.details = details;
  return error;
}

function loadMysqlDriver() {
  if (mysqlPromise) return mysqlPromise;
  try {
    mysqlPromise = require('mysql2/promise');
    return mysqlPromise;
  } catch (error) {
    throw createUnavailableError(
      'Backend chưa cài được driver mysql2 cho module mẫu in hóa đơn. Vui lòng chạy npm install trong thư mục backend.',
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

function resolvePrintTemplatesMySqlConfig() {
  loadDotEnvOnce();

  const connectionLimit = readIntegerEnv(
    ['KHA_PRINT_TEMPLATES_MYSQL_CONNECTION_LIMIT', 'PRINT_TEMPLATES_MYSQL_CONNECTION_LIMIT'],
    5,
    { min: 1, max: 50 }
  );
  const connectTimeout = readIntegerEnv(
    ['KHA_PRINT_TEMPLATES_MYSQL_CONNECT_TIMEOUT_MS', 'PRINT_TEMPLATES_MYSQL_CONNECT_TIMEOUT_MS', 'MYSQL_CONNECT_TIMEOUT_MS'],
    3000,
    { min: 500, max: 60000 }
  );

  const url = firstEnv(
    'KHA_PRINT_TEMPLATES_MYSQL_URL',
    'PRINT_TEMPLATES_MYSQL_URL',
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
      },
    };
  }

  const host = firstEnv(
    'DB_HOST',
    'MYSQL_HOST',
    'KHA_PRINT_TEMPLATES_MYSQL_HOST',
    'PRINT_TEMPLATES_MYSQL_HOST'
  );
  const port = readIntegerEnv(
    ['DB_PORT', 'MYSQL_PORT', 'KHA_PRINT_TEMPLATES_MYSQL_PORT', 'PRINT_TEMPLATES_MYSQL_PORT'],
    3306,
    { min: 1, max: 65535 }
  );
  const user = firstEnv(
    'DB_USER',
    'DB_USERNAME',
    'MYSQL_USER',
    'KHA_PRINT_TEMPLATES_MYSQL_USER',
    'KHA_PRINT_TEMPLATES_MYSQL_USERNAME',
    'PRINT_TEMPLATES_MYSQL_USER',
    'PRINT_TEMPLATES_MYSQL_USERNAME'
  );
  const password = firstEnv(
    'DB_PASSWORD',
    'MYSQL_PASSWORD',
    'KHA_PRINT_TEMPLATES_MYSQL_PASSWORD',
    'PRINT_TEMPLATES_MYSQL_PASSWORD'
  );
  const database = firstEnv(
    'DB_NAME',
    'DB_DATABASE',
    'MYSQL_DATABASE',
    'KHA_PRINT_TEMPLATES_MYSQL_DATABASE',
    'KHA_PRINT_TEMPLATES_MYSQL_DB',
    'PRINT_TEMPLATES_MYSQL_DATABASE',
    'PRINT_TEMPLATES_MYSQL_DB'
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
      message: `${MYSQL_CONFIGURATION_MESSAGE} Thiếu: ${missing.join(', ')}.`,
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

function isPrintTemplatesMySqlConfigured() {
  return resolvePrintTemplatesMySqlConfig().configured === true;
}

function getPrintTemplatesMySqlStatus() {
  const config = resolvePrintTemplatesMySqlConfig();
  return {
    configured: config.configured === true,
    mode: config.mode,
    missing: config.missing || [],
    connected: Boolean(pool),
    poolReady: Boolean(pool),
    config: config.safe || {},
    lastError: lastConnectionError ? {
      code: lastConnectionError.code || '',
      message: lastConnectionError.message || 'Không thể kết nối MySQL cho mẫu in hóa đơn',
    } : null,
  };
}

function toSafeMysqlErrorDetails(error) {
  const details = {};
  const code = String(error?.code || '').toUpperCase();
  if (code) details.mysqlCode = code;
  if (error?.errno !== undefined) details.errno = error.errno;
  if (error?.sqlState) details.sqlState = error.sqlState;
  return details;
}

function normalizePrintTemplatesMySqlError(error) {
  if (!error) return createUnavailableError(MYSQL_UNAVAILABLE_MESSAGE, CONNECTION_ERROR_CODE);
  if (error.status === 503 || error.code === CONFIGURATION_ERROR_CODE || error.code === MODULE_ERROR_CODE) return error;

  const code = String(error.code || '').toUpperCase();
  if (CONNECTION_ERROR_CODES.has(code) || error.fatal === true) {
    const message = code === 'ER_BAD_DB_ERROR'
      ? MYSQL_DATABASE_MISSING_MESSAGE
      : (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_DBACCESS_DENIED_ERROR' ? MYSQL_ACCESS_DENIED_MESSAGE : MYSQL_UNAVAILABLE_MESSAGE);
    return createUnavailableError(message, CONNECTION_ERROR_CODE, error, toSafeMysqlErrorDetails(error));
  }

  error.status = error.status || 500;
  return error;
}

function getPrintTemplatesPool() {
  const config = resolvePrintTemplatesMySqlConfig();
  if (!config.configured) {
    throw createUnavailableError(config.message || MYSQL_CONFIGURATION_MESSAGE, CONFIGURATION_ERROR_CODE);
  }

  if (pool && currentPoolFingerprint === config.fingerprint) return pool;
  if (pool && currentPoolFingerprint !== config.fingerprint) {
    const stalePool = pool;
    pool = null;
    currentPoolFingerprint = '';
    Promise.resolve(stalePool.end()).catch(error => {
      console.warn(`[KHA PRINT TEMPLATES MYSQL] Không thể đóng pool cũ: ${error.message}`);
    });
  }

  const mysql = loadMysqlDriver();
  pool = mysql.createPool(config.options);
  currentPoolFingerprint = config.fingerprint;
  lastConnectionError = null;
  return pool;
}

async function testPrintTemplatesMySqlConnection() {
  let connection = null;
  try {
    const config = resolvePrintTemplatesMySqlConfig();
    if (!config.configured) {
      throw createUnavailableError(config.message || MYSQL_CONFIGURATION_MESSAGE, CONFIGURATION_ERROR_CODE);
    }

    connection = await getPrintTemplatesPool().getConnection();
    await connection.ping();
    const [rows] = await connection.query('SELECT DATABASE() AS database_name, VERSION() AS mysql_version');
    lastConnectionError = null;
    return {
      ok: true,
      configured: true,
      mode: config.mode,
      config: config.safe || {},
      database: rows?.[0]?.database_name || rows?.[0]?.DATABASE || '',
      mysqlVersion: rows?.[0]?.mysql_version || rows?.[0]?.VERSION || '',
    };
  } catch (error) {
    const normalized = normalizePrintTemplatesMySqlError(error);
    if (normalized.status === 503) lastConnectionError = normalized;
    throw normalized;
  } finally {
    if (connection) connection.release();
  }
}

async function query(sql, params = []) {
  try {
    const [rows] = await getPrintTemplatesPool().execute(sql, params);
    lastConnectionError = null;
    return rows;
  } catch (error) {
    const normalized = normalizePrintTemplatesMySqlError(error);
    if (normalized.status === 503) lastConnectionError = normalized;
    throw normalized;
  }
}

async function withTransaction(callback) {
  let connection = null;
  try {
    connection = await getPrintTemplatesPool().getConnection();
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
        // Keep the original error.
      }
    }
    const normalized = normalizePrintTemplatesMySqlError(error);
    if (normalized.status === 503) lastConnectionError = normalized;
    throw normalized;
  } finally {
    if (connection) connection.release();
  }
}

async function closePrintTemplatesPool() {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  currentPoolFingerprint = '';
  await currentPool.end();
}

module.exports = {
  CONFIGURATION_ERROR_CODE,
  MODULE_ERROR_CODE,
  CONNECTION_ERROR_CODE,
  MYSQL_CONFIGURATION_MESSAGE,
  MYSQL_DATABASE_MISSING_MESSAGE,
  MYSQL_ACCESS_DENIED_MESSAGE,
  MYSQL_UNAVAILABLE_MESSAGE,
  createUnavailableError,
  loadPrintTemplatesEnv: loadDotEnvOnce,
  resolvePrintTemplatesMySqlConfig,
  isPrintTemplatesMySqlConfigured,
  getPrintTemplatesMySqlStatus,
  normalizePrintTemplatesMySqlError,
  getPrintTemplatesPool,
  testPrintTemplatesMySqlConnection,
  query,
  withTransaction,
  closePrintTemplatesPool,
};
