/**
 * KHA Data Guardian - Realtime Backup Service
 * 
 * Tự động backup khi có thay đổi dữ liệu quan trọng:
 * - Tạo/sửa đơn hàng
 * - Thêm/sửa khách hàng
 * - Thêm/sửa sản phẩm
 * - Nhập hàng
 * 
 * Debounce 10 giây: gom nhiều thay đổi thành 1 backup.
 */
const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 10 * 1000; // 10 seconds
const MAX_SNAPSHOTS = 50;
const SNAPSHOT_DIR_NAME = 'realtime-snapshots';
const CRITICAL_TABLES = new Set([
  'invoices', 'invoice_details',
  'customers',
  'products',
  'partners',
  'import_logs', 'import_details',
]);

let snapshotDir = null;
let debounceTimer = null;
let pendingChanges = [];
let dbModule = null;
let initialized = false;
let lastSnapshotTime = 0;
let snapshotCount = 0;
let alertService = null;

function initialize(options = {}) {
  const dataDir = options.dataDir || process.env.ELECTRON_USER_DATA || path.resolve(__dirname, '..', '..', 'data');
  snapshotDir = path.join(dataDir, SNAPSHOT_DIR_NAME);
  dbModule = options.dbModule || null;
  alertService = options.alertService || null;

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
  } catch (_) {}

  initialized = true;
  console.log(`[KHA REALTIME BACKUP] Initialized. Dir: ${snapshotDir}`);
}

/**
 * Called by database hooks when a critical table changes.
 */
function onDataChange(table, operation, rowId) {
  if (!initialized || !CRITICAL_TABLES.has(table)) return;

  pendingChanges.push({
    table,
    operation,
    rowId,
    timestamp: Date.now(),
  });

  // Debounce: wait 10 seconds before creating snapshot
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => createSnapshot(), DEBOUNCE_MS);
}

function createSnapshot() {
  if (!initialized || !dbModule) return null;

  debounceTimer = null;
  const changes = pendingChanges.splice(0);
  if (changes.length === 0) return null;

  try {
    const db = dbModule.getDb();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tablesChanged = [...new Set(changes.map(c => c.table))].join('+');
    const fileName = `snapshot-${stamp}-${tablesChanged}.json`;
    const snapshotPath = path.join(snapshotDir, fileName);

    // Write snapshot
    const snapshotData = {
      _meta: {
        created_at: new Date().toISOString(),
        changes: changes.length,
        tables: tablesChanged,
        trigger: changes[0]?.operation || 'unknown',
      },
    };

    // Only include critical tables in snapshot (not full DB)
    for (const table of CRITICAL_TABLES) {
      if (Array.isArray(db[table])) {
        snapshotData[table] = db[table];
      }
    }

    // Also include nextId for recovery
    snapshotData.nextId = db.nextId || {};

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshotData, null, 0), 'utf8');
    lastSnapshotTime = Date.now();
    snapshotCount++;

    console.log(`[KHA REALTIME BACKUP] Snapshot created: ${fileName} (${changes.length} changes)`);

    // Prune old snapshots
    pruneSnapshots();

    return { path: snapshotPath, file: fileName, changes: changes.length };
  } catch (error) {
    console.error(`[KHA REALTIME BACKUP] Snapshot error: ${error.message}`);
    if (alertService) {
      alertService.sendWarningAlert('realtime-backup', `Lỗi tạo snapshot realtime: ${error.message}`);
    }
    return null;
  }
}

function pruneSnapshots() {
  if (!snapshotDir) return;

  try {
    const files = fs.readdirSync(snapshotDir)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .map(f => {
        try {
          const stat = fs.statSync(path.join(snapshotDir, f));
          return { file: f, mtimeMs: stat.mtimeMs };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Keep only MAX_SNAPSHOTS
    for (const file of files.slice(MAX_SNAPSHOTS)) {
      try {
        fs.unlinkSync(path.join(snapshotDir, file.file));
      } catch (_) {}
    }
  } catch (_) {}
}

function listSnapshots(limit = 20) {
  if (!snapshotDir) return [];

  try {
    return fs.readdirSync(snapshotDir)
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .map(f => {
        try {
          const fullPath = path.join(snapshotDir, f);
          const stat = fs.statSync(fullPath);
          return {
            file: f,
            path: fullPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mtime: new Date(stat.mtimeMs).toISOString(),
          };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);
  } catch (_) {
    return [];
  }
}

/**
 * Restore critical tables from a specific snapshot file.
 */
function restoreFromSnapshot(snapshotPath, targetDbModule) {
  const mod = targetDbModule || dbModule;
  if (!mod) throw new Error('Database module not available');
  if (!fs.existsSync(snapshotPath)) throw new Error(`Snapshot not found: ${snapshotPath}`);

  const content = fs.readFileSync(snapshotPath, 'utf8');
  const snapshot = JSON.parse(content);
  const db = mod.getDb();
  const restored = [];

  for (const table of CRITICAL_TABLES) {
    if (Array.isArray(snapshot[table]) && snapshot[table].length > 0) {
      db[table] = snapshot[table];
      restored.push(table);
    }
  }

  if (snapshot.nextId) {
    db.nextId = { ...(db.nextId || {}), ...snapshot.nextId };
  }

  return {
    ok: true,
    restored,
    snapshotMeta: snapshot._meta || {},
  };
}

function getStatus() {
  return {
    initialized,
    snapshotDir,
    lastSnapshotTime: lastSnapshotTime ? new Date(lastSnapshotTime).toISOString() : null,
    snapshotCount,
    pendingChanges: pendingChanges.length,
    totalSnapshots: listSnapshots(1000).length,
  };
}

function forceSnapshot() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (pendingChanges.length === 0 && dbModule) {
    // Force a full snapshot even without pending changes
    pendingChanges.push({
      table: 'manual',
      operation: 'force',
      rowId: null,
      timestamp: Date.now(),
    });
  }

  return createSnapshot();
}

function shutdown() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  // Create final snapshot if there are pending changes
  if (pendingChanges.length > 0) {
    createSnapshot();
  }
  initialized = false;
}

module.exports = {
  initialize,
  onDataChange,
  createSnapshot,
  forceSnapshot,
  listSnapshots,
  restoreFromSnapshot,
  getStatus,
  shutdown,
  CRITICAL_TABLES,
};
