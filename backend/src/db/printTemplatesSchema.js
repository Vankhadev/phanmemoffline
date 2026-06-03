const {
  isPrintTemplatesMySqlConfigured,
  createUnavailableError,
  query,
  normalizePrintTemplatesMySqlError,
  MYSQL_CONFIGURATION_MESSAGE,
} = require('./printTemplatesMySql');
const { DEFAULT_LAYOUT_V2, DEFAULT_SETTINGS_V2 } = require('../services/printTemplateDocumentAdapter');

const CREATE_PRINT_TEMPLATES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS print_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(100) NULL,
  template_name VARCHAR(150) NOT NULL,
  name VARCHAR(255) NULL,
  template_type VARCHAR(50) NOT NULL DEFAULT 'invoice',
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
  template_data LONGTEXT NULL,
  print_scale DECIMAL(6,3) NOT NULL DEFAULT 1.000,
  layout_json JSON NULL,
  settings_json JSON NULL,
  template_schema_version INT UNSIGNED NOT NULL DEFAULT 1,
  draft_layout_json JSON NULL,
  draft_settings_json JSON NULL,
  editor_meta_json JSON NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  last_autosaved_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
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
  ['name', 'VARCHAR(255) NULL'],
  ['template_type', "VARCHAR(50) NOT NULL DEFAULT 'invoice'"],
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
  ['template_data', 'LONGTEXT NULL'],
  ['print_scale', 'DECIMAL(6,3) NOT NULL DEFAULT 1.000'],
  ['layout_json', 'JSON NULL'],
  ['settings_json', 'JSON NULL'],
  ['template_schema_version', 'INT UNSIGNED NOT NULL DEFAULT 1'],
  ['draft_layout_json', 'JSON NULL'],
  ['draft_settings_json', 'JSON NULL'],
  ['editor_meta_json', 'JSON NULL'],
  ['revision', 'INT UNSIGNED NOT NULL DEFAULT 1'],
  ['last_autosaved_at', 'DATETIME(3) NULL'],
  ['published_at', 'DATETIME(3) NULL'],
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

const DEFAULT_TEMPLATE_SEED = Object.freeze({
  accountId: 1,
  code: 'mau-in-hoa-don-mac-dinh',
  templateName: 'Mẫu in hóa đơn mặc định',
  description: 'Mẫu mặc định được backend tự tạo để /api/print-templates luôn có dữ liệu MySQL thật ban đầu.',
  templateType: 'invoice',
  printScale: 1,
  layoutJson: JSON.stringify(DEFAULT_LAYOUT_V2),
  settingsJson: JSON.stringify(DEFAULT_SETTINGS_V2),
  templateSchemaVersion: 2,
  paperSize: DEFAULT_LAYOUT_V2.canvas?.pageSize || 'A5',
  orientation: DEFAULT_LAYOUT_V2.canvas?.orientation || 'portrait',
  status: 'active',
});

let schemaReady = false;
let schemaReadyPromise = null;

const PRINT_TEMPLATES_TABLE_MISSING_ERROR_CODES = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_TABLE_ERROR']);

function getSchemaReadyState() {
  return schemaReady;
}

function resetPrintTemplatesSchemaReady() {
  schemaReady = false;
  schemaReadyPromise = null;
}

function isPrintTemplatesTableMissingError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (PRINT_TEMPLATES_TABLE_MISSING_ERROR_CODES.has(code)) return true;
  const message = String(error?.message || '');
  return /print_templates/i.test(message) && /(doesn'?t exist|unknown table|no such table|table .* not found)/i.test(message);
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

async function ensureSoftMigrationDefaults() {
  await query(`
    UPDATE print_templates
       SET revision = 1
     WHERE revision IS NULL OR revision < 1
  `);
  await query(`
    UPDATE print_templates
       SET template_schema_version = CASE
             WHEN JSON_EXTRACT(layout_json, '$.schema_version') = 2 THEN 2
             WHEN JSON_EXTRACT(settings_json, '$.schema_version') = 2 THEN 2
             ELSE 1
           END
     WHERE template_schema_version IS NULL OR template_schema_version < 1
  `);
  await query(`
    UPDATE print_templates
       SET paper_size = 'A5'
     WHERE paper_size IS NULL OR paper_size = ''
  `);
  await query(`
    UPDATE print_templates
       SET orientation = 'portrait'
     WHERE orientation IS NULL OR orientation = ''
  `);
  await query(`
    UPDATE print_templates
       SET status = 'active'
     WHERE status IS NULL OR status = ''
  `);
  await query(`
    UPDATE print_templates
       SET is_default = 0
     WHERE is_default IS NULL
  `);
  await query(`
    UPDATE print_templates
       SET published_at = COALESCE(updated_at, created_at, UTC_TIMESTAMP(3))
     WHERE published_at IS NULL
       AND deleted_at IS NULL
       AND layout_json IS NOT NULL
  `);
  await query(`
    UPDATE print_templates
       SET name = template_name
     WHERE (name IS NULL OR name = '')
       AND template_name IS NOT NULL
       AND template_name <> ''
  `);
  await query(`
    UPDATE print_templates
       SET template_name = name
     WHERE (template_name IS NULL OR template_name = '' OR template_name = 'Mẫu in hóa đơn')
       AND name IS NOT NULL
       AND name <> ''
  `);
  await query(`
    UPDATE print_templates
       SET template_type = 'invoice'
     WHERE template_type IS NULL OR template_type = ''
  `);
  await query(`
    UPDATE print_templates
       SET print_scale = 1.000
     WHERE print_scale IS NULL OR print_scale <= 0
  `);
  await query(`
    UPDATE print_templates
       SET layout_json = template_data
     WHERE layout_json IS NULL
       AND template_data IS NOT NULL
       AND template_data <> ''
       AND JSON_VALID(template_data)
  `);
  await query(`
    UPDATE print_templates
       SET settings_json = ?
     WHERE settings_json IS NULL
  `, [JSON.stringify(DEFAULT_SETTINGS_V2)]);
  await query(`
    UPDATE print_templates
       SET template_data = CAST(layout_json AS CHAR)
     WHERE (template_data IS NULL OR template_data = '')
       AND layout_json IS NOT NULL
  `);
}

async function ensureDefaultTemplateSeed() {
  const activeRows = await query(
    `SELECT id, is_default
       FROM print_templates
      WHERE account_id = ?
        AND deleted_at IS NULL
      ORDER BY is_default DESC, updated_at DESC, id DESC
      LIMIT 1`,
    [DEFAULT_TEMPLATE_SEED.accountId]
  );

  if (!activeRows || activeRows.length === 0) {
    await query(
      `INSERT INTO print_templates (
         account_id, code, template_name, name, template_type, description,
         template_data, print_scale, layout_json, settings_json, template_schema_version,
         paper_size, orientation, status, is_default, revision,
         published_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [
        DEFAULT_TEMPLATE_SEED.accountId,
        DEFAULT_TEMPLATE_SEED.code,
        DEFAULT_TEMPLATE_SEED.templateName,
        DEFAULT_TEMPLATE_SEED.templateName,
        DEFAULT_TEMPLATE_SEED.templateType,
        DEFAULT_TEMPLATE_SEED.description,
        DEFAULT_TEMPLATE_SEED.layoutJson,
        DEFAULT_TEMPLATE_SEED.printScale,
        DEFAULT_TEMPLATE_SEED.layoutJson,
        DEFAULT_TEMPLATE_SEED.settingsJson,
        DEFAULT_TEMPLATE_SEED.templateSchemaVersion,
        DEFAULT_TEMPLATE_SEED.paperSize,
        DEFAULT_TEMPLATE_SEED.orientation,
        DEFAULT_TEMPLATE_SEED.status,
      ]
    );
    return { seeded: true, defaulted: true };
  }

  if (Number(activeRows[0].is_default) !== 1) {
    await query(
      `UPDATE print_templates
          SET is_default = 1, updated_at = UTC_TIMESTAMP(3)
        WHERE account_id = ?
          AND id = ?
          AND deleted_at IS NULL`,
      [DEFAULT_TEMPLATE_SEED.accountId, activeRows[0].id]
    );
    return { seeded: false, defaulted: true };
  }

  return { seeded: false, defaulted: false };
}

async function runEnsurePrintTemplatesSchema() {
  if (!isPrintTemplatesMySqlConfigured()) {
    throw createUnavailableError(MYSQL_CONFIGURATION_MESSAGE);
  }

  await query(CREATE_PRINT_TEMPLATES_TABLE_SQL);
  await ensureMissingColumns();
  await ensureMissingIndexes();
  await ensureSoftMigrationDefaults();
  const seed = await ensureDefaultTemplateSeed();
  schemaReady = true;
  return { ok: true, configured: true, table: 'print_templates', seed };
}

async function ensurePrintTemplatesSchema(options = {}) {
  const failSoft = options.failSoft === true;
  const force = options.force === true;
  const verify = options.verify === true;

  if (force) resetPrintTemplatesSchemaReady();
  if (schemaReady && !verify) return { ok: true, configured: true, table: 'print_templates', cached: true };

  if (!schemaReadyPromise || verify) {
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
  DEFAULT_TEMPLATE_SEED,
  ensurePrintTemplatesSchema,
  getSchemaReadyState,
  resetPrintTemplatesSchemaReady,
  isPrintTemplatesTableMissingError,
};
