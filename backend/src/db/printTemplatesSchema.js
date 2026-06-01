const {
  isPrintTemplatesMySqlConfigured,
  createUnavailableError,
  query,
  normalizePrintTemplatesMySqlError,
} = require('./printTemplatesMySql');

const CREATE_PRINT_TEMPLATES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS print_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(100) NULL,
  template_name VARCHAR(150) NOT NULL,
  description VARCHAR(255) NULL,
  header_logo VARCHAR(1024) NULL,
  logo_url VARCHAR(1024) NULL,
  logo_path VARCHAR(1024) NULL,
  logo_mime VARCHAR(100) NULL,
  logo_size BIGINT UNSIGNED NULL,
  shop_name VARCHAR(150) NULL,
  shop_address VARCHAR(255) NULL,
  shop_phone VARCHAR(50) NULL,
  css_style MEDIUMTEXT NULL,
  layout_json JSON NULL,
  settings_json JSON NULL,
  paper_size VARCHAR(20) NOT NULL DEFAULT 'A5',
  orientation VARCHAR(20) NOT NULL DEFAULT 'portrait',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_print_templates_account_deleted (account_id, deleted_at),
  KEY idx_print_templates_default (account_id, is_default, deleted_at),
  KEY idx_print_templates_status (account_id, status, deleted_at),
  KEY idx_print_templates_name (account_id, template_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const REQUIRED_COLUMNS = [
  ['account_id', 'BIGINT UNSIGNED NOT NULL DEFAULT 1'],
  ['code', 'VARCHAR(100) NULL'],
  ['template_name', "VARCHAR(150) NOT NULL DEFAULT 'Mẫu in hóa đơn'"],
  ['description', 'VARCHAR(255) NULL'],
  ['header_logo', 'VARCHAR(1024) NULL'],
  ['logo_url', 'VARCHAR(1024) NULL'],
  ['logo_path', 'VARCHAR(1024) NULL'],
  ['logo_mime', 'VARCHAR(100) NULL'],
  ['logo_size', 'BIGINT UNSIGNED NULL'],
  ['shop_name', 'VARCHAR(150) NULL'],
  ['shop_address', 'VARCHAR(255) NULL'],
  ['shop_phone', 'VARCHAR(50) NULL'],
  ['css_style', 'MEDIUMTEXT NULL'],
  ['layout_json', 'JSON NULL'],
  ['settings_json', 'JSON NULL'],
  ['paper_size', "VARCHAR(20) NOT NULL DEFAULT 'A5'"],
  ['orientation', "VARCHAR(20) NOT NULL DEFAULT 'portrait'"],
  ['status', "VARCHAR(20) NOT NULL DEFAULT 'active'"],
  ['is_default', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['created_by', 'BIGINT UNSIGNED NULL'],
  ['updated_by', 'BIGINT UNSIGNED NULL'],
  ['created_at', 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)'],
  ['updated_at', 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'],
  ['deleted_at', 'DATETIME(3) NULL'],
];

const REQUIRED_INDEXES = [
  ['idx_print_templates_account_deleted', 'CREATE INDEX idx_print_templates_account_deleted ON print_templates (account_id, deleted_at)'],
  ['idx_print_templates_default', 'CREATE INDEX idx_print_templates_default ON print_templates (account_id, is_default, deleted_at)'],
  ['idx_print_templates_status', 'CREATE INDEX idx_print_templates_status ON print_templates (account_id, status, deleted_at)'],
  ['idx_print_templates_name', 'CREATE INDEX idx_print_templates_name ON print_templates (account_id, template_name)'],
];

let schemaReady = false;
let schemaReadyPromise = null;

function getSchemaReadyState() {
  return schemaReady;
}

async function getExistingColumns() {
  const rows = await query(
    `SELECT COLUMN_NAME AS column_name
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'print_templates'`
  );
  return new Set((rows || []).map(row => String(row.column_name || row.COLUMN_NAME || '').toLowerCase()).filter(Boolean));
}

async function ensureMissingColumns() {
  const existingColumns = await getExistingColumns();
  for (const [columnName, columnDefinition] of REQUIRED_COLUMNS) {
    if (existingColumns.has(columnName.toLowerCase())) continue;
    await query(`ALTER TABLE print_templates ADD COLUMN ${columnName} ${columnDefinition}`);
    existingColumns.add(columnName.toLowerCase());
  }
}

async function indexExists(indexName) {
  const rows = await query(
    `SELECT COUNT(1) AS count
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'print_templates'
        AND INDEX_NAME = ?`,
    [indexName]
  );
  const count = Number(rows?.[0]?.count ?? rows?.[0]?.COUNT ?? 0);
  return count > 0;
}

async function ensureMissingIndexes() {
  for (const [indexName, createSql] of REQUIRED_INDEXES) {
    if (await indexExists(indexName)) continue;
    await query(createSql);
  }
}

async function runEnsurePrintTemplatesSchema() {
  if (!isPrintTemplatesMySqlConfigured()) {
    throw createUnavailableError('Chưa cấu hình MySQL cho module mẫu in hóa đơn. Backend vẫn chạy, nhưng API /api/print-templates sẽ trả lỗi cấu hình cho tới khi thiết lập env MySQL.');
  }

  await query(CREATE_PRINT_TEMPLATES_TABLE_SQL);
  await ensureMissingColumns();
  await ensureMissingIndexes();
  schemaReady = true;
  return { ok: true, configured: true, table: 'print_templates' };
}

async function ensurePrintTemplatesSchema(options = {}) {
  const failSoft = options.failSoft === true;

  if (schemaReady) return { ok: true, configured: true, table: 'print_templates', cached: true };

  if (!schemaReadyPromise) {
    schemaReadyPromise = runEnsurePrintTemplatesSchema()
      .catch(error => {
        schemaReady = false;
        schemaReadyPromise = null;
        throw normalizePrintTemplatesMySqlError(error);
      });
  }

  try {
    return await schemaReadyPromise;
  } catch (error) {
    const normalized = normalizePrintTemplatesMySqlError(error);
    if (failSoft) {
      return {
        ok: false,
        configured: normalized.code !== 'PRINT_TEMPLATES_MYSQL_NOT_CONFIGURED',
        table: 'print_templates',
        skipped: true,
        code: normalized.code || 'PRINT_TEMPLATES_MYSQL_SCHEMA_ERROR',
        error: normalized.message,
      };
    }
    throw normalized;
  }
}

module.exports = {
  CREATE_PRINT_TEMPLATES_TABLE_SQL,
  ensurePrintTemplatesSchema,
  getSchemaReadyState,
};
