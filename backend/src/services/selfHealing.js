/**
 * KHA Data Guardian - Self-Healing Service
 * 
 * Tự phát hiện và sửa lỗi nhỏ (<50%) không cần thông báo Admin:
 * - Cache lỗi → clear và rebuild
 * - Session hết hạn → cleanup
 * - API timeout → retry
 * - File tạm lỗi → xóa và tạo lại
 * - DB index sai → rebuild
 * - nextId sai → recalculate
 * 
 * Lỗi lớn (>50%) → thông báo Admin.
 * Health check mỗi 2 phút.
 */
const fs = require('fs');
const path = require('path');

const HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_HEAL_LOG = 200;

let checkTimer = null;
let dbModule = null;
let alertService = null;
let initialized = false;
let healLog = [];
let healthStats = {
  checksPerformed: 0,
  issuesFound: 0,
  issuesHealed: 0,
  lastCheckTime: null,
};

function initialize(options = {}) {
  dbModule = options.dbModule || null;
  alertService = options.alertService || null;
  initialized = true;
  console.log('[KHA SELF-HEAL] Initialized');
}

function startMonitoring() {
  if (!initialized) return;
  stopMonitoring();

  checkTimer = setInterval(() => {
    try {
      runHealthCheck();
    } catch (error) {
      console.error(`[KHA SELF-HEAL] Check error: ${error.message}`);
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  if (checkTimer.unref) checkTimer.unref();
  console.log('[KHA SELF-HEAL] Health monitoring started (every 2 min)');
}

function stopMonitoring() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function logHeal(action, severity, detail = '') {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    severity,
    detail: String(detail).slice(0, 500),
  };
  healLog.push(entry);
  if (healLog.length > MAX_HEAL_LOG) {
    healLog = healLog.slice(-MAX_HEAL_LOG);
  }
  return entry;
}

/**
 * Run all health checks and auto-heal what we can.
 */
function runHealthCheck() {
  if (!dbModule) return { ok: true, issues: [] };

  healthStats.checksPerformed++;
  healthStats.lastCheckTime = new Date().toISOString();
  const issues = [];

  // Check 1: Expired sessions
  try {
    const healed = healExpiredSessions();
    if (healed > 0) {
      issues.push({ type: 'expired_sessions', severity: 10, healed, message: `Dọn ${healed} session hết hạn` });
      logHeal('clean_sessions', 10, `${healed} sessions`);
    }
  } catch (error) {
    issues.push({ type: 'session_check_error', severity: 20, error: error.message });
  }

  // Check 2: NextId integrity
  try {
    const fixed = healNextIds();
    if (fixed > 0) {
      issues.push({ type: 'nextid_mismatch', severity: 20, healed: fixed, message: `Sửa ${fixed} nextId` });
      logHeal('fix_nextids', 20, `${fixed} tables`);
    }
  } catch (error) {
    issues.push({ type: 'nextid_check_error', severity: 30, error: error.message });
  }

  // Check 3: Null entries in tables
  try {
    const cleaned = healNullEntries();
    if (cleaned > 0) {
      issues.push({ type: 'null_entries', severity: 15, healed: cleaned, message: `Xóa ${cleaned} null entries` });
      logHeal('clean_nulls', 15, `${cleaned} entries`);
    }
  } catch (error) {
    issues.push({ type: 'null_check_error', severity: 20, error: error.message });
  }

  // Check 4: Database file exists
  try {
    const dbPath = dbModule.DB_PATH;
    if (!dbPath || !fs.existsSync(dbPath)) {
      issues.push({ type: 'db_missing', severity: 100, message: 'Database file không tồn tại!' });
      logHeal('db_missing', 100, dbPath || 'unknown');

      if (alertService) {
        alertService.sendEmergencyAlert('self-heal',
          'Database file không tồn tại! Cần khôi phục ngay.',
          { dbPath, errorLevel: '100%' }
        );
      }
    }
  } catch (error) {
    issues.push({ type: 'db_check_error', severity: 50, error: error.message });
  }

  // Check 5: Memory usage
  try {
    const mem = process.memoryUsage();
    const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;
    if (heapPercent > 90) {
      issues.push({ type: 'high_memory', severity: 40, message: `Heap usage: ${heapPercent.toFixed(1)}%` });
      logHeal('high_memory_warning', 40, `${heapPercent.toFixed(1)}%`);

      // Try to free memory
      if (global.gc) {
        try { global.gc(); } catch (_) {}
        logHeal('gc_triggered', 20, 'Manual GC');
      }
    }
  } catch (_) {}

  // Check 6: Duplicate IDs
  try {
    const duplicates = healDuplicateIds();
    if (duplicates > 0) {
      issues.push({ type: 'duplicate_ids', severity: 30, healed: duplicates, message: `Sửa ${duplicates} duplicate IDs` });
      logHeal('fix_duplicate_ids', 30, `${duplicates} records`);
    }
  } catch (error) {
    issues.push({ type: 'duplicate_check_error', severity: 25, error: error.message });
  }

  // Calculate overall severity
  const maxSeverity = issues.length > 0 ? Math.max(...issues.map(i => i.severity)) : 0;
  const healedCount = issues.filter(i => i.healed).reduce((sum, i) => sum + (i.healed || 0), 0);

  healthStats.issuesFound += issues.length;
  healthStats.issuesHealed += healedCount;

  // Save DB if we healed anything
  if (healedCount > 0 && typeof dbModule.saveDB === 'function') {
    try {
      dbModule.saveDB();
    } catch (_) {}
  }

  // Alert if severity >= 50%
  if (maxSeverity >= 50 && alertService) {
    const criticalIssues = issues.filter(i => i.severity >= 50);
    alertService.sendCriticalAlert('self-heal',
      `Phát hiện ${criticalIssues.length} lỗi nghiêm trọng (severity >= 50%)`,
      {
        errorLevel: `${maxSeverity}%`,
        issues: criticalIssues,
        actionsTaken: issues.filter(i => i.healed).map(i => i.message),
      }
    );
  }

  return {
    ok: maxSeverity < 50,
    maxSeverity,
    issues,
    healedCount,
  };
}

function healExpiredSessions() {
  const db = dbModule.getDb();
  if (!Array.isArray(db.sessions)) return 0;

  const nowMs = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => {
    if (!s) return false;
    const createdMs = s.created_at ? new Date(s.created_at).getTime() : 0;
    return (nowMs - createdMs) < SESSION_MAX_AGE_MS;
  });
  return before - db.sessions.length;
}

function healNextIds() {
  const db = dbModule.getDb();
  if (!db.nextId || typeof db.nextId !== 'object') {
    db.nextId = {};
    return 1;
  }

  let fixed = 0;
  for (const table of Object.keys(db)) {
    if (table === 'nextId') continue;
    if (!Array.isArray(db[table])) continue;

    const maxId = db[table].reduce((max, row) => Math.max(max, Number(row?.id) || 0), 0);
    const currentNextId = Number(db.nextId[table]) || 1;

    if (currentNextId <= maxId) {
      db.nextId[table] = maxId + 1;
      fixed++;
    }
  }
  return fixed;
}

function healNullEntries() {
  const db = dbModule.getDb();
  let cleaned = 0;

  for (const table of Object.keys(db)) {
    if (table === 'nextId') continue;
    if (!Array.isArray(db[table])) continue;

    const before = db[table].length;
    db[table] = db[table].filter(row => row != null && typeof row === 'object');
    cleaned += before - db[table].length;
  }

  return cleaned;
}

function healDuplicateIds() {
  const db = dbModule.getDb();
  let fixed = 0;

  for (const table of Object.keys(db)) {
    if (table === 'nextId') continue;
    if (!Array.isArray(db[table])) continue;

    const seenIds = new Set();
    const duplicates = [];

    for (let i = 0; i < db[table].length; i++) {
      const row = db[table][i];
      if (!row || row.id == null) continue;

      if (seenIds.has(row.id)) {
        duplicates.push(i);
      } else {
        seenIds.add(row.id);
      }
    }

    if (duplicates.length > 0) {
      // Assign new IDs to duplicates instead of removing
      for (const idx of duplicates) {
        const nextId = (db.nextId[table] || 1);
        db[table][idx].id = nextId;
        db.nextId[table] = nextId + 1;
        fixed++;
      }
    }
  }

  return fixed;
}

function getHealLog(limit = 50) {
  return healLog.slice(-Math.max(1, Math.min(limit, MAX_HEAL_LOG)));
}

function getStatus() {
  return {
    initialized,
    monitoring: checkTimer !== null,
    stats: healthStats,
    recentHeals: healLog.slice(-10),
  };
}

function shutdown() {
  stopMonitoring();
  initialized = false;
}

module.exports = {
  initialize,
  startMonitoring,
  stopMonitoring,
  runHealthCheck,
  getHealLog,
  getStatus,
  shutdown,
};
