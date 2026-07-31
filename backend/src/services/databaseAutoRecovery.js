/**
 * KHA Data Guardian - Database Auto Recovery
 * 
 * Tự khôi phục database khi phát hiện:
 * - Database hỏng (corrupt JSON)
 * - Database mất (file không tồn tại)
 * - Database rỗng (0 records)
 * - Database sai đường dẫn
 * 
 * Ưu tiên: nhiều đơn hàng > nhiều khách hàng > nhiều sản phẩm.
 * KHÔNG tạo database rỗng mới.
 */
const fs = require('fs');
const path = require('path');

let alertService = null;
let initialized = false;

function initialize(options = {}) {
  alertService = options.alertService || null;
  initialized = true;
  console.log('[KHA DB RECOVERY] Initialized');
}

/**
 * Check database file integrity.
 * @param {string} dbPath - Path to database file
 * @returns {object} Integrity check result
 */
function checkIntegrity(dbPath) {
  const result = {
    path: dbPath,
    exists: false,
    readable: false,
    validJson: false,
    hasSchema: false,
    hasData: false,
    isEmpty: true,
    isCorrupt: false,
    counts: { invoices: 0, customers: 0, products: 0, partners: 0, import_logs: 0 },
    error: null,
  };

  try {
    // Check existence
    if (!dbPath || !fs.existsSync(dbPath)) {
      result.error = 'File không tồn tại';
      return result;
    }
    result.exists = true;

    // Check readable
    const raw = fs.readFileSync(dbPath, 'utf8');
    result.readable = true;

    // Check JSON
    if (!raw.trim()) {
      result.error = 'File rỗng';
      result.isEmpty = true;
      return result;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseError) {
      result.error = `JSON không hợp lệ: ${parseError.message}`;
      result.isCorrupt = true;
      return result;
    }
    result.validJson = true;

    // Check schema
    const hasDbKeys = data.nextId || data.accounts || data.users || data.products || data.customers || data.invoices;
    if (!hasDbKeys) {
      result.error = 'Không phải file database hợp lệ';
      return result;
    }
    result.hasSchema = true;

    // Count records
    result.counts.invoices = Array.isArray(data.invoices) ? data.invoices.length : 0;
    result.counts.customers = Array.isArray(data.customers) ? data.customers.length : 0;
    result.counts.products = Array.isArray(data.products) ? data.products.length : 0;
    result.counts.partners = Array.isArray(data.partners) ? data.partners.length : 0;
    result.counts.import_logs = Array.isArray(data.import_logs) ? data.import_logs.length : 0;

    result.isEmpty = (result.counts.invoices === 0 && result.counts.customers === 0 && result.counts.products === 0);
    result.hasData = !result.isEmpty;

    return result;
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

/**
 * Determine the issue type and severity.
 */
function diagnose(integrityResult) {
  const issues = [];

  if (!integrityResult.exists) {
    issues.push({ type: 'missing', severity: 100, message: 'Database file không tồn tại' });
  } else if (integrityResult.isCorrupt) {
    issues.push({ type: 'corrupt', severity: 90, message: 'Database file bị hỏng (JSON corrupt)' });
  } else if (!integrityResult.validJson) {
    issues.push({ type: 'invalid', severity: 85, message: 'Database file không đọc được' });
  } else if (!integrityResult.hasSchema) {
    issues.push({ type: 'wrong_schema', severity: 80, message: 'File không phải database hợp lệ' });
  } else if (integrityResult.isEmpty) {
    issues.push({ type: 'empty', severity: 70, message: 'Database rỗng (0 dữ liệu)' });
  }

  const overallSeverity = issues.length > 0 ? Math.max(...issues.map(i => i.severity)) : 0;

  return {
    healthy: issues.length === 0,
    issues,
    overallSeverity,
    needsRecovery: overallSeverity >= 70,
    needsAlert: overallSeverity >= 50,
  };
}

/**
 * Diagnose only. Automatic path switching is prohibited: a backup must be
 * explicitly selected and restored through the verified restore pipeline.
 * @param {object} dbModule - The database module
 * @param {object} diagnosis - Result from diagnose()
 * @returns {object} Recovery result
 */
function attemptRecovery(dbModule, diagnosis) {
  if (!diagnosis.needsRecovery) {
    return { ok: true, action: 'none', message: 'Database khỏe mạnh, không cần khôi phục' };
  }

  const result = {
    ok: false,
    action: 'recovery',
    steps: [],
    originalIssues: diagnosis.issues,
    recovered: false,
  };

  console.log(`[KHA DB RECOVERY] Starting recovery. Issues: ${diagnosis.issues.map(i => i.type).join(', ')}`);

  // Step 1: discover candidates for the UI, without changing DB_PATH or files.
  try {
    const scanResults = dbModule.performDeepScan();
    result.steps.push(`Deep scan found ${scanResults.length} database files`);

    if (scanResults.length === 0) {
      result.steps.push('CRITICAL: Không tìm thấy bất kỳ file database nào');
      result.ok = false;
      result.message = 'Không thể khôi phục: không tìm thấy backup nào';

      if (alertService) {
        alertService.sendEmergencyAlert('db-recovery',
          'KHẨN CẤP: Database mất hoàn toàn và không tìm thấy backup nào!',
          { diagnosis, scanResults: [] }
        );
      }
      return result;
    }

    // Step 2: report the best candidate. Do not run or copy it automatically.
    const bestDb = scanResults.find(s => !s.isEmpty);
    if (!bestDb) {
      result.steps.push('WARNING: Tất cả database tìm thấy đều rỗng');
      result.ok = false;
      result.message = 'Tất cả database đều rỗng';

      if (alertService) {
        alertService.sendCriticalAlert('db-recovery',
          'Database rỗng và tất cả backup đều rỗng.',
          { diagnosis, scanCount: scanResults.length }
        );
      }
      return result;
    }

    result.steps.push(`Best database: ${bestDb.path} (${bestDb.invoicesCount} đơn, ${bestDb.customersCount} KH, ${bestDb.productsCount} SP)`);
    result.ok = false;
    result.recovered = false;
    result.action = 'selection_required';
    result.message = 'Database cần khôi phục. Chọn một backup đã xác thực để khôi phục an toàn; DB_PATH không bị thay đổi.';
    result.candidate = {
      path: bestDb.path,
      invoices: bestDb.invoicesCount,
      customers: bestDb.customersCount,
      products: bestDb.productsCount,
    };

    if (alertService) {
      alertService.sendCriticalAlert('db-recovery',
        `Database cần khôi phục thủ công từ backup đã xác thực. Ứng viên: ${bestDb.path}`,
        {
          actionsTaken: result.steps,
          candidate: result.candidate,
        }
      );
    }

    console.warn(`[KHA DB RECOVERY] Recovery selection required: ${bestDb.path}`);
  } catch (error) {
    result.steps.push(`Recovery error: ${error.message}`);
    result.ok = false;
    result.message = `Lỗi trong quá trình khôi phục: ${error.message}`;

    if (alertService) {
      alertService.sendEmergencyAlert('db-recovery',
        `Lỗi nghiêm trọng khi khôi phục database: ${error.message}`,
        { error: error.message, steps: result.steps }
      );
    }
  }

  return result;
}

/**
 * Full startup check: check integrity → diagnose → recover if needed.
 */
function runStartupCheck(dbModule) {
  const dbPath = dbModule.DB_PATH;
  console.log(`[KHA DB RECOVERY] Startup check: ${dbPath}`);

  const integrity = checkIntegrity(dbPath);
  const diagnosis = diagnose(integrity);

  if (diagnosis.healthy) {
    console.log(`[KHA DB RECOVERY] Database healthy: ${integrity.counts.invoices} đơn, ${integrity.counts.customers} KH, ${integrity.counts.products} SP`);
    return { ok: true, action: 'none', integrity, diagnosis };
  }

  console.warn(`[KHA DB RECOVERY] Issues detected: ${diagnosis.issues.map(i => i.message).join('; ')}`);
  const recovery = attemptRecovery(dbModule, diagnosis);
  return { ...recovery, integrity, diagnosis };
}

function getStatus() {
  return {
    initialized,
  };
}

module.exports = {
  initialize,
  checkIntegrity,
  diagnose,
  attemptRecovery,
  runStartupCheck,
  getStatus,
};
