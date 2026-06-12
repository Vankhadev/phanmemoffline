/**
 * KHA Data Guardian - Integrity Checker
 * 
 * Kiểm tra toàn vẹn dữ liệu sau bảo trì hoặc cập nhật version.
 * 
 * Ghi snapshot số lượng bản ghi TRƯỚC thay đổi.
 * So sánh SAU thay đổi.
 * Nếu dữ liệu giảm bất thường (>5%) → rollback.
 */
const fs = require('fs');
const path = require('path');

let alertService = null;
let initialized = false;

const CRITICAL_TABLES = ['customers', 'products', 'invoices', 'partners', 'import_logs'];
const ABNORMAL_DECREASE_PERCENT = 5; // 5% giảm = bất thường

function initialize(options = {}) {
  alertService = options.alertService || null;
  initialized = true;
  console.log('[KHA INTEGRITY] Initialized');
}

/**
 * Take a snapshot of record counts for critical tables.
 */
function takeSnapshot(dbModule) {
  const db = dbModule.getDb();
  const snapshot = {
    timestamp: new Date().toISOString(),
    counts: {},
  };

  for (const table of CRITICAL_TABLES) {
    snapshot.counts[table] = Array.isArray(db[table]) ? db[table].length : 0;
  }

  return snapshot;
}

/**
 * Compare two snapshots and detect anomalies.
 * @param {object} before - Snapshot before change
 * @param {object} after - Snapshot after change
 * @returns {object} Comparison result with anomalies
 */
function compareSnapshots(before, after) {
  const anomalies = [];
  const comparison = {};

  for (const table of CRITICAL_TABLES) {
    const beforeCount = before.counts[table] || 0;
    const afterCount = after.counts[table] || 0;
    const diff = afterCount - beforeCount;
    const percentChange = beforeCount > 0 ? ((diff / beforeCount) * 100) : 0;

    comparison[table] = {
      before: beforeCount,
      after: afterCount,
      diff,
      percentChange: Math.round(percentChange * 100) / 100,
    };

    // Check for abnormal decrease
    if (beforeCount > 0 && diff < 0 && Math.abs(percentChange) > ABNORMAL_DECREASE_PERCENT) {
      anomalies.push({
        table,
        before: beforeCount,
        after: afterCount,
        lost: Math.abs(diff),
        percentLost: Math.abs(percentChange).toFixed(2),
        message: `Bảng ${table} giảm ${Math.abs(diff)} bản ghi (${Math.abs(percentChange).toFixed(1)}%)`,
      });
    }
  }

  return {
    hasAnomalies: anomalies.length > 0,
    anomalies,
    comparison,
    before: before.timestamp,
    after: new Date().toISOString(),
  };
}

/**
 * Perform post-change integrity check with automatic rollback.
 * @param {object} dbModule - Database module
 * @param {object} beforeSnapshot - Snapshot taken before the change
 * @param {string} backupPath - Path to pre-change backup for rollback
 * @param {string} context - What triggered the check ('maintenance' | 'update')
 * @returns {object} Check result
 */
function performPostChangeCheck(dbModule, beforeSnapshot, backupPath, context = 'unknown') {
  const afterSnapshot = takeSnapshot(dbModule);
  const comparison = compareSnapshots(beforeSnapshot, afterSnapshot);

  if (!comparison.hasAnomalies) {
    console.log(`[KHA INTEGRITY] Post-${context} check passed. No anomalies.`);
    return {
      ok: true,
      action: 'none',
      comparison,
      context,
    };
  }

  // ANOMALY DETECTED - ROLLBACK
  console.error(`[KHA INTEGRITY] ⚠️ ANOMALY DETECTED after ${context}!`);
  for (const anomaly of comparison.anomalies) {
    console.error(`[KHA INTEGRITY] ${anomaly.message}`);
  }

  const result = {
    ok: false,
    action: 'rollback',
    comparison,
    context,
    rollback: null,
  };

  // Attempt rollback from backup
  if (backupPath && fs.existsSync(backupPath)) {
    try {
      console.log(`[KHA INTEGRITY] Rolling back from backup: ${backupPath}`);
      const backupContent = fs.readFileSync(backupPath, 'utf8');
      const backupData = JSON.parse(backupContent);
      const db = dbModule.getDb();

      // Restore critical tables from backup
      for (const table of CRITICAL_TABLES) {
        if (Array.isArray(backupData[table])) {
          db[table] = backupData[table];
        }
      }

      // Restore related detail tables
      const relatedTables = ['invoice_details', 'import_details', 'combo_items', 'return_logs', 'return_details'];
      for (const table of relatedTables) {
        if (Array.isArray(backupData[table])) {
          db[table] = backupData[table];
        }
      }

      if (backupData.nextId) {
        db.nextId = { ...(db.nextId || {}), ...backupData.nextId };
      }

      dbModule.saveDB();

      result.rollback = {
        ok: true,
        source: backupPath,
        message: `Đã rollback thành công từ backup trước ${context}`,
      };

      console.log(`[KHA INTEGRITY] Rollback successful from ${backupPath}`);
    } catch (error) {
      result.rollback = {
        ok: false,
        error: error.message,
        message: `Lỗi rollback: ${error.message}`,
      };
      console.error(`[KHA INTEGRITY] Rollback error: ${error.message}`);
    }
  } else {
    result.rollback = {
      ok: false,
      message: 'Không tìm thấy backup để rollback',
    };
  }

  // Alert admin
  if (alertService) {
    alertService.sendCriticalAlert('integrity-check',
      `Phát hiện dữ liệu giảm bất thường sau ${context}. ${result.rollback?.ok ? 'Đã rollback thành công.' : 'KHÔNG THỂ ROLLBACK!'}`,
      {
        context,
        anomalies: comparison.anomalies,
        rollback: result.rollback,
        actionsTaken: result.rollback?.ok ? ['Rollback từ backup'] : ['CẢNH BÁO: Cần kiểm tra thủ công'],
      }
    );
  }

  return result;
}

/**
 * Quick health check (no rollback, just report).
 */
function quickHealthCheck(dbModule) {
  const db = dbModule.getDb();
  const counts = {};

  for (const table of CRITICAL_TABLES) {
    counts[table] = Array.isArray(db[table]) ? db[table].length : 0;
  }

  const totalRecords = Object.values(counts).reduce((sum, c) => sum + c, 0);

  return {
    ok: totalRecords > 0,
    counts,
    totalRecords,
    timestamp: new Date().toISOString(),
  };
}

function getStatus() {
  return { initialized };
}

module.exports = {
  initialize,
  takeSnapshot,
  compareSnapshots,
  performPostChangeCheck,
  quickHealthCheck,
  getStatus,
  CRITICAL_TABLES,
};
