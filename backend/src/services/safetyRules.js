/**
 * KHA Data Guardian - Safety Rules Engine
 * 
 * Bộ luật an toàn tuyệt đối:
 * - KHÔNG BAO GIỜ xóa: customers, invoices, products, partners, lịch sử giao dịch
 * - Mọi "xóa" → soft delete (set deleted_at)
 * - Backup trước mọi thay đổi quan trọng
 * - Ghi log toàn bộ hoạt động
 */
const PROTECTED_TABLES = new Set([
  'customers',
  'invoices',
  'invoice_details',
  'products',
  'partners',
  'import_logs',
  'import_details',
  'cash_book',
  'accounting_transactions',
]);

// Tables that should NEVER have records hard-deleted
const NEVER_DELETE_TABLES = new Set([
  'customers',
  'invoices',
  'invoice_details',
  'products',
  'partners',
]);

// Tables where soft-delete is acceptable
const SOFT_DELETE_TABLES = new Set([
  'customers',
  'invoices',
  'products',
  'partners',
  'import_logs',
]);

let alertService = null;
let initialized = false;
let violationCount = 0;
let violationLog = [];
const MAX_VIOLATION_LOG = 100;

function initialize(options = {}) {
  alertService = options.alertService || null;
  initialized = true;
  console.log('[KHA SAFETY] Safety rules engine initialized');
}

/**
 * Validate an operation against safety rules.
 * @param {string} operation - 'insert' | 'update' | 'delete'
 * @param {string} table - Table name
 * @param {object} data - Data being modified
 * @returns {object} { allowed: boolean, reason: string, action: string }
 */
function validateOperation(operation, table, data = {}) {
  // INSERT is always allowed
  if (operation === 'insert') {
    return { allowed: true, action: 'allow' };
  }

  // UPDATE is allowed, but log it for protected tables
  if (operation === 'update') {
    if (PROTECTED_TABLES.has(table)) {
      return { allowed: true, action: 'allow_with_log', reason: `Cập nhật ${table} (bảng bảo vệ)` };
    }
    return { allowed: true, action: 'allow' };
  }

  // DELETE on protected tables - BLOCK or convert to soft-delete
  if (operation === 'delete') {
    if (NEVER_DELETE_TABLES.has(table)) {
      const violation = {
        timestamp: new Date().toISOString(),
        operation: 'delete',
        table,
        rowId: data.id || data.rowId || 'unknown',
        blocked: true,
        message: `CHẶN xóa ${table}: quy tắc an toàn không cho phép xóa dữ liệu này`,
      };

      violationCount++;
      violationLog.push(violation);
      if (violationLog.length > MAX_VIOLATION_LOG) {
        violationLog = violationLog.slice(-MAX_VIOLATION_LOG);
      }

      console.warn(`[KHA SAFETY] ⛔ BLOCKED delete on ${table} (id=${violation.rowId})`);

      if (alertService && violationCount % 10 === 1) {
        alertService.sendWarningAlert('safety-rules',
          `Chặn ${violationCount} lần xóa dữ liệu bảo vệ (${table})`,
          { table, violationCount }
        );
      }

      if (SOFT_DELETE_TABLES.has(table)) {
        return {
          allowed: false,
          action: 'soft_delete',
          reason: `Chuyển thành soft-delete cho ${table}`,
          softDeleteFields: { deleted_at: new Date().toISOString(), active: 0 },
        };
      }

      return {
        allowed: false,
        action: 'block',
        reason: `Không cho phép xóa ${table}`,
      };
    }

    // Non-protected tables: allow delete
    return { allowed: true, action: 'allow' };
  }

  return { allowed: true, action: 'allow' };
}

/**
 * Apply safety rules to a remove() call.
 * Returns the action to take instead of hard delete.
 * @param {string} table - Table name
 * @param {number} id - Row ID
 * @param {object} existingRow - The current row data
 * @returns {object} { action: 'block' | 'soft_delete' | 'allow', data: {} }
 */
function applySafetyOnRemove(table, id, existingRow = {}) {
  const validation = validateOperation('delete', table, { id, ...existingRow });

  if (validation.action === 'soft_delete') {
    return {
      action: 'soft_delete',
      data: {
        ...validation.softDeleteFields,
        _safety_note: `Soft-deleted by safety rules at ${new Date().toISOString()}`,
      },
    };
  }

  if (validation.action === 'block') {
    return {
      action: 'block',
      reason: validation.reason,
    };
  }

  return { action: 'allow' };
}

/**
 * Check if a table is protected.
 */
function isProtectedTable(table) {
  return PROTECTED_TABLES.has(table);
}

/**
 * Check if a delete would be blocked.
 */
function wouldBlockDelete(table) {
  return NEVER_DELETE_TABLES.has(table);
}

function getViolationLog(limit = 50) {
  return violationLog.slice(-Math.max(1, Math.min(limit, MAX_VIOLATION_LOG)));
}

function getStatus() {
  return {
    initialized,
    violationCount,
    protectedTables: [...PROTECTED_TABLES],
    neverDeleteTables: [...NEVER_DELETE_TABLES],
    recentViolations: violationLog.slice(-5),
  };
}

module.exports = {
  initialize,
  validateOperation,
  applySafetyOnRemove,
  isProtectedTable,
  wouldBlockDelete,
  getViolationLog,
  getStatus,
  PROTECTED_TABLES,
  NEVER_DELETE_TABLES,
  SOFT_DELETE_TABLES,
};
