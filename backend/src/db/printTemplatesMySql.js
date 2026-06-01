const fs = require('fs');
const path = require('path');

const CONFIGURATION_ERROR_CODE = 'PRINT_TEMPLATES_MYSQL_NOT_CONFIGURED';
const MODULE_ERROR_CODE = 'PRINT_TEMPLATES_MYSQL_DRIVER_MISSING';
const CONNECTION_ERROR_CODE = 'PRINT_TEMPLATES_MYSQL_UNAVAILABLE';

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
]);

let dotenvLoaded = false;
let mysqlPromise = null;
let pool = null;
let currentPoolFingerprint = '';
let lastConnectionError = null;

function loadDotEnvOnce() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  let dotenv = null;
  try {
    dotenv = require('dotenv');
  } catch (_error) {
    return;
  }

  const candidatePaths = Array.from(new Set([
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
  ]));

  for (const envPath of candidatePaths) {
    try {
      if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
    } catch (_error) {
      // Loading .env is best-effort only. Runtime env variables remain authoritative.
    }
  }
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
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function createUnavailableError(message, code = CONFIGURATION_ERROR_CODE, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
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
      'Backend chưa cài được driver mysql2 cho module mẫu in hóa đơn. Vui lòng chạy npm install trong thư mục backend.',
      MODULE_ERROR_CODE,
      error
    );
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
      options: {
        uri: url,
        waitForConnections: true,
        connectionLimit,
        queueLimit: 0,
        connectTimeout,
        charset: 'utf8mb4',
        dateStrings: true,
      },
    };
  }

  const host = firstEnv(
    'KHA_PRINT_TEMPLATES_MYSQL_HOST',
    'PRINT_TEMPLATES_MYSQL_HOST',
    'MYSQL_HOST'
  );
  const port = readIntegerEnv(
    ['KHA_PRINT_TEMPLATES_MYSQL_PORT', 'PRINT_TEMPLATES_MYSQL_PORT', 'MYSQL_PORT'],
    3306,
    { min: 1, max: 65535 }
  );
  const user = firstEnv(
    'KHA_PRINT_TEMPLATES_MYSQL_USER',
    'KHA_PRINT_TEMPLATES_MYSQL_USERNAME',
    'PRINT_TEMPLATES_MYSQL_USER',
    'PRINT_TEMPLATES_MYSQL_USERNAME',
    'MYSQL_USER'
  );
  const password = firstEnv(
    'KHA_PRINT_TEMPLATES_MYSQL_PASSWORD',
    'PRINT_TEMPLATES_MYSQL_PASSWORD',
    'MYSQL_PASSWORD'
  );
  const database = firstEnv(
    'KHA_PRINT_TEMPLATES_MYSQL_DATABASE',
    'KHA_PRINT_TEMPLATES_MYSQL_DB',
    'PRINT_TEMPLATES_MYSQL_DATABASE',
    'PRINT_TEMPLATES_MYSQL_DB',
    'MYSQL_DATABASE'
  );

  const missing = [];
  if (!host) missing.push('KHA_PRINT_TEMPLATES_MYSQL_HOST');
  if (!user) missing.push('KHA_PRINT_TEMPLATES_MYSQL_USER');
  if (!database) missing.push('KHA_PRINT_TEMPLATES_MYSQL_DATABASE');

  if (missing.length > 0) {
    return {
      configured: false,
      mode: 'env',
      missing,
      message: `Chưa cấu hình MySQL cho mẫu in hóa đơn. Cần KHA_PRINT_TEMPLATES_MYSQL_URL hoặc bộ biến ${missing.join(', ')}.`,
    };
  }

  return {
    configured: true,
    mode: 'env',
    fingerprint: `env:${host}:${port}:${user}:${database}`,
    options: {
      host,
      port,
      user,
      password,
      database,
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
    lastError: lastConnectionError ? {
      code: lastConnectionError.code || '',
      message: lastConnectionError.message || 'Không thể kết nối MySQL cho mẫu in hóa đơn',
    } : null,
  };
}

function normalizePrintTemplatesMySqlError(error) {
  if (!error) return createUnavailableError('Không thể kết nối MySQL cho mẫu in hóa đơn.', CONNECTION_ERROR_CODE);
  if (error.status === 503 || error.code === CONFIGURATION_ERROR_CODE || error.code === MODULE_ERROR_CODE) return error;

  const code = String(error.code || '').toUpperCase();
  if (CONNECTION_ERROR_CODES.has(code)) {
    return createUnavailableError('MySQL cho mẫu in hóa đơn đang không khả dụng. Vui lòng kiểm tra cấu hình và trạng thái MySQL.', CONNECTION_ERROR_CODE, error);
  }

  error.status = error.status || 500;
  return error;
}

function getPrintTemplatesPool() {
  const config = resolvePrintTemplatesMySqlConfig();
  if (!config.configured) {
    throw createUnavailableError(config.message || 'Chưa cấu hình MySQL cho mẫu in hóa đơn.', CONFIGURATION_ERROR_CODE);
  }

  if (pool && currentPoolFingerprint === config.fingerprint) return pool;

  const mysql = loadMysqlDriver();
  pool = mysql.createPool(config.options);
  currentPoolFingerprint = config.fingerprint;
  lastConnectionError = null;
  return pool;
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
  createUnavailableError,
  resolvePrintTemplatesMySqlConfig,
  isPrintTemplatesMySqlConfigured,
  getPrintTemplatesMySqlStatus,
  normalizePrintTemplatesMySqlError,
  getPrintTemplatesPool,
  query,
  withTransaction,
  closePrintTemplatesPool,
};
