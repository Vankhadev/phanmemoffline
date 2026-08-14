/**
 * KHA Data Guardian - Power Loss Recovery
 * 
 * Phát hiện và khôi phục dữ liệu sau:
 * - Tắt máy đột ngột
 * - Mất điện
 * - Treo hệ thống
 * - Crash ứng dụng
 * 
 * Cơ chế: running.lock marker file.
 * Khi startup: nếu lock vẫn tồn tại → crash/mất điện lần trước.
 * → Tự động replay journal, so sánh backup, khôi phục.
 * Không yêu cầu người dùng thao tác.
 */
const fs = require('fs');
const { readBackupData } = require('../utils/backupCodec');
const path = require('path');

const LOCK_FILE_NAME = 'kha-guardian-running.lock';
const RECOVERY_LOG_NAME = 'kha-guardian-recovery.log';

let lockFilePath = null;
let recoveryLogPath = null;
let alertService = null;
let transactionJournal = null;
let backupScheduler = null;
let initialized = false;
let recoveredOnStartup = false;
let lastRecoveryResult = null;

function initialize(options = {}) {
  const dataDir = options.dataDir || process.env.ELECTRON_USER_DATA || path.resolve(__dirname, '..', '..', 'data');
  lockFilePath = path.join(dataDir, LOCK_FILE_NAME);
  recoveryLogPath = path.join(dataDir, RECOVERY_LOG_NAME);
  alertService = options.alertService || null;
  transactionJournal = options.transactionJournal || null;
  backupScheduler = options.backupScheduler || null;

  try {
    fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
  } catch (_) {}

  initialized = true;
  console.log(`[KHA POWER RECOVERY] Initialized. Lock: ${lockFilePath}`);
}

/**
 * Check if previous session crashed (lock file still exists).
 * Call this BEFORE createLock().
 */
function detectCrash() {
  if (!lockFilePath) return { crashed: false };

  try {
    if (fs.existsSync(lockFilePath)) {
      const content = fs.readFileSync(lockFilePath, 'utf8');
      let lockData = {};
      try { lockData = JSON.parse(content); } catch (_) {}
      console.warn(`[KHA POWER RECOVERY] ⚡ Detected abnormal shutdown! Lock from: ${lockData.startedAt || 'unknown'}`);
      return {
        crashed: true,
        lockData,
        lockFile: lockFilePath,
      };
    }
  } catch (_) {}

  return { crashed: false };
}

/**
 * Perform full recovery after detected crash.
 * @param {object} dbModule - The database module
 * @returns {object} Recovery result
 */
function performRecovery(dbModule) {
  if (!dbModule) return { ok: false, reason: 'no_db_module' };

  const result = {
    ok: true,
    timestamp: new Date().toISOString(),
    steps: [],
    journalReplay: null,
    backupRestore: null,
    dataIntegrity: null,
  };

  console.log('[KHA POWER RECOVERY] Starting recovery process...');

  // Step 1: Replay transaction journal
  if (transactionJournal && transactionJournal.hasUncommittedEntries()) {
    try {
      result.journalReplay = transactionJournal.replayUncommittedEntries(dbModule);
      result.steps.push(`Journal replay: ${result.journalReplay.replayed} entries recovered`);
      console.log(`[KHA POWER RECOVERY] Journal replay: ${result.journalReplay.replayed} entries`);
    } catch (error) {
      result.steps.push(`Journal replay error: ${error.message}`);
      console.error(`[KHA POWER RECOVERY] Journal replay error: ${error.message}`);
    }
  } else {
    result.steps.push('Journal: no uncommitted entries');
  }

  // Step 2: Verify database integrity
  try {
    const db = dbModule.getDb();
    const validation = typeof dbModule.validateDatabaseData === 'function'
      ? dbModule.validateDatabaseData(db, { allowLegacyOrphans: false })
      : { ok: false, errors: ['Không có database validator'] };
    const integrityCheck = {
      invoices: Array.isArray(db.invoices) ? db.invoices.length : -1,
      customers: Array.isArray(db.customers) ? db.customers.length : -1,
      products: Array.isArray(db.products) ? db.products.length : -1,
      partners: Array.isArray(db.partners) ? db.partners.length : -1,
      import_logs: Array.isArray(db.import_logs) ? db.import_logs.length : -1,
      hasNextId: Boolean(db.nextId && typeof db.nextId === 'object'),
    };

    const hasData = validation.ok
      && integrityCheck.invoices >= 0
      && integrityCheck.customers >= 0
      && integrityCheck.products >= 0
      && integrityCheck.hasNextId;
    result.dataIntegrity = { ...integrityCheck, hasData, errors: validation.errors || [], foreign_key_errors: validation.foreign_key_errors || [] };
    result.steps.push(`Integrity: ${hasData ? 'OK' : 'FAILED'} - ${integrityCheck.invoices} invoices, ${integrityCheck.customers} customers, ${integrityCheck.products} products`);
  } catch (error) {
    result.steps.push(`Integrity check error: ${error.message}`);
  }

  // Step 3: If DB is empty/corrupt, try restoring from backup
  // An automatic restore can select a stale or unrelated database. It is only
  // permitted for an explicitly controlled repair session.
  if (process.env.KHA_ALLOW_AUTOMATIC_CRASH_RESTORE === '1' && result.dataIntegrity && !result.dataIntegrity.hasData) {
    try {
      result.steps.push('Database empty/corrupt - attempting backup restore...');

      // Try performDeepScan from database module
      if (typeof dbModule.performDeepScan === 'function') {
        const scanResults = dbModule.performDeepScan();
        if (scanResults.length > 0 && !scanResults[0].isEmpty) {
          const best = scanResults[0];
          dbModule.setDBPath(best.path);
          dbModule.writeDatabaseConfig(best.path);
          dbModule.loadDB({ forceReload: true });
          result.backupRestore = { source: 'deep-scan', path: best.path, ...best };
          result.steps.push(`Restored from deep scan: ${best.path}`);
        }
      }

      // If still no data, try backup scheduler
      if (!result.backupRestore && backupScheduler) {
        const bestBackup = backupScheduler.findBestBackup();
        if (bestBackup) {
          const backupData = readBackupData(bestBackup.path, 'utf8');
          const db = dbModule.getDb();

          // Merge backup data into current DB
          for (const table of Object.keys(backupData)) {
            if (table === 'nextId' || table === '_meta') continue;
            if (Array.isArray(backupData[table]) && backupData[table].length > 0) {
              db[table] = backupData[table];
            }
          }
          if (backupData.nextId) {
            db.nextId = { ...(db.nextId || {}), ...backupData.nextId };
          }

          result.backupRestore = { source: 'backup-scheduler', ...bestBackup };
          result.steps.push(`Restored from backup: ${bestBackup.file}`);
        }
      }
    } catch (error) {
      result.steps.push(`Backup restore error: ${error.message}`);
      console.error(`[KHA POWER RECOVERY] Backup restore error: ${error.message}`);
    }
  }

  // Step 4: Save recovered state
  try {
    if (typeof dbModule.saveDB === 'function') {
      dbModule.saveDB();
      result.steps.push('Saved recovered database state');
    }
  } catch (error) {
    result.steps.push(`Save error: ${error.message}`);
  }

  // Log recovery result
  logRecovery(result);

  // Alert admin if recovery happened
  if (alertService) {
    const severity = result.backupRestore ? 'critical' : 'warning';
    const message = result.backupRestore
      ? `Phát hiện mất điện/crash. Đã khôi phục dữ liệu từ backup: ${result.backupRestore.source}`
      : `Phát hiện mất điện/crash. Dữ liệu đã được kiểm tra và đồng bộ.`;

    if (severity === 'critical') {
      alertService.sendCriticalAlert('power-recovery', message, { recovery: result });
    } else {
      alertService.sendWarningAlert('power-recovery', message, { recovery: result });
    }
  }

  recoveredOnStartup = true;
  lastRecoveryResult = result;

  console.log(`[KHA POWER RECOVERY] Recovery complete. Steps: ${result.steps.length}`);
  return result;
}

function logRecovery(result) {
  if (!recoveryLogPath) return;
  try {
    fs.appendFileSync(recoveryLogPath, JSON.stringify(result) + '\n', 'utf8');
  } catch (_) {}
}

/**
 * Create lock file (call after startup is complete).
 */
function createLock() {
  if (!lockFilePath) return;

  try {
    const lockData = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: require('os').hostname(),
      nodeVersion: process.version,
    };
    fs.writeFileSync(lockFilePath, JSON.stringify(lockData), 'utf8');
  } catch (error) {
    console.error(`[KHA POWER RECOVERY] Cannot create lock: ${error.message}`);
  }
}

/**
 * Remove lock file (call during clean shutdown).
 */
function removeLock() {
  if (!lockFilePath) return;

  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch (_) {}
}

function getStatus() {
  return {
    initialized,
    lockExists: lockFilePath ? fs.existsSync(lockFilePath) : false,
    recoveredOnStartup,
    lastRecoveryResult,
  };
}

function shutdown() {
  removeLock();
  initialized = false;
}

module.exports = {
  initialize,
  detectCrash,
  performRecovery,
  createLock,
  removeLock,
  getStatus,
  shutdown,
};
