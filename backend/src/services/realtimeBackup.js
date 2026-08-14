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
const crypto = require('crypto');

const DEBOUNCE_MS = 10 * 1000; // 10 seconds
const MAX_SNAPSHOTS = 50;
const SNAPSHOT_DIR_NAME = 'realtime-snapshots';
const CRITICAL_TABLES = new Set([
  'invoices', 'invoice_details', 'orders', 'order_items', 'payments',
  'customers', 'products', 'partners', 'suppliers',
  'import_logs', 'import_details', 'imports', 'import_items',
  'inventory_transactions', 'inventory_batches', 'cash_book', 'cash_fund',
  'debts', 'debt_payments', 'return_logs', 'return_details', 'audit_logs',
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
  if (!initialized || (table !== 'manual' && !CRITICAL_TABLES.has(table))) return;

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

  let tempPath = null;
  try {
    const db = dbModule.getDb();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tablesChanged = [...new Set(changes.map(c => c.table))].join('+') || 'full';
    const fileName = `snapshot-${stamp}-${tablesChanged}.json`;
    const snapshotPath = path.join(snapshotDir, fileName);
    tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
    const snapshotData = {
      _meta: {
        created_at: new Date().toISOString(),
        changes: changes.length,
        tables: tablesChanged,
        trigger: changes[0]?.operation || 'unknown',
        snapshot_type: 'full_database_recovery_point',
      },
    };

    // This is a complete recovery point. Partial table snapshots can restore a
    // sale without its cash, debt or stock entries and therefore are unsafe.
    for (const table of Object.keys(dbModule.SCHEMA || {})) {
      if (Array.isArray(db[table])) {
        snapshotData[table] = db[table];
      }
    }

    // Also include nextId for recovery
    snapshotData.nextId = db.nextId || {};

    fs.writeFileSync(tempPath, JSON.stringify(snapshotData), 'utf8');
    const fd = fs.openSync(tempPath, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const staged = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
    const validation = dbModule.validateDatabaseData(staged, { allowLegacyOrphans: true });
    if (!validation.ok) throw new Error(`Snapshot integrity failed: ${validation.errors.join('; ')}`);
    fs.renameSync(tempPath, snapshotPath);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(snapshotPath)).digest('hex');
    fs.writeFileSync(`${snapshotPath}.manifest.json`, JSON.stringify({
      file: fileName,
      sha256: hash,
      size: fs.statSync(snapshotPath).size,
      created_at: snapshotData._meta.created_at,
      schema_version: typeof dbModule.getSchemaVersion === 'function' ? dbModule.getSchemaVersion(db) : 'json-schema-v1',
      valid: true,
      counts: validation.counts,
    }), 'utf8');
    lastSnapshotTime = Date.now();
    snapshotCount++;

    console.log(`[KHA REALTIME BACKUP] Snapshot created: ${fileName} (${changes.length} changes)`);

    // Prune old snapshots
    pruneSnapshots();

    return { path: snapshotPath, file: fileName, changes: changes.length, sha256: hash };
  } catch (error) {
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
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
  const resolved = path.resolve(String(snapshotPath || ''));
  const allowedRoot = path.resolve(snapshotDir || '.');
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) throw new Error('Snapshot path is outside the protected snapshot directory');
  if (!fs.existsSync(resolved)) throw new Error(`Snapshot not found: ${resolved}`);
  if (typeof mod.restoreDbBackup !== 'function') throw new Error('Verified full snapshot restore is unavailable');
  const manifestPath = `${resolved}.manifest.json`;
  if (!fs.existsSync(manifestPath)) throw new Error('Snapshot manifest is required for restore');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const stat = fs.statSync(resolved);
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  if (manifest.valid !== true || manifest.size !== stat.size || manifest.sha256 !== checksum) {
    throw new Error('Snapshot checksum verification failed');
  }
  const snapshot = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const result = mod.restoreDbBackup(resolved, { allowLegacyBackup: true });
  return { ...result, snapshotMeta: snapshot._meta || {} };
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
