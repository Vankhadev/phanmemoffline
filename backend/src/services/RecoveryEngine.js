/**
 * RecoveryEngine v2.3.9 — Khoi phuc du lieu an toan, CHAY TRONG WORKER THREAD RIENG.
 *
 * Khac biet so voi v2.3.8:
 *   - Tach flow thanh 2 buoc: "Quet file backup" va "Khoi phuc backup".
 *   - Toan bo tac vu nang (scan, parse, merge) chay trong worker_threads,
 *     KHONG bao gio chay tren main thread hoac renderer.
 *   - UI chi nhan progress event qua IPC/API poll.
 *   - Cancel THUC SU hoat dong (gui cancel-request den worker, worker dung sau batch).
 *   - Timeout ngan hon: scan dir 10s, read meta 5s, verify 30s, process 120s, extract 120s.
 *   - Gioi han vung quet: chi quet thu muc uu tien, KHONG quet toan bo o dia mac dinh.
 *   - "Quet sau toan bo o dia" la che do nang cao rieng.
 *   - Log realtime ra file (stream-based, khong doi xong moi ghi).
 *   - Restore lock: chi 1 tien trinh restore chay tai 1 thoi diem.
 *   - Snapshot pre-restore + rollback.
 *   - Orphan-safe import + dedupe an toan (khong mat don).
 *   - Khong replace database hien tai.
 */
"use strict";

const { Worker } = require("worker_threads");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

const VERSION = "2.3.9";
const WORKER_SCRIPT = path.resolve(__dirname, "..", "workers", "RecoveryWorker.js");

let worker = null;
let workerReady = false;
let dbModule = null;
let initialized = false;

// Trang thai
let status = {
  running: false,
  progress: "Chua chay",
  phase: "idle",
  lastReport: null,
  lastLogPath: null,
  foundFiles: [],
  details: {},
  currentStep: null,
  elapsedMs: 0,
};

// Lock: chi cho phep 1 tien trinh restore
let restoreLock = false;
let lockFile = null;

// Snapshot backup pre-restore
let safetyBackup = null;

// ========== HELPERS ==========
function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function getLogDir() { return ensureDir(path.resolve(process.env.KHA_RECOVERY_LOG_DIR || path.join(process.cwd(), "logs", "recovery"))); }
function getTempRoot() { return ensureDir(path.resolve(process.env.KHA_RECOVERY_TEMP_DIR || path.join(os.tmpdir(), "phanmienoffline", "recovery_temp"))); }
function safeClone(v) { return JSON.parse(JSON.stringify(v ?? {})); }
function countTables(db) { const t = ["invoices", "invoice_details", "products", "customers", "partners", "import_logs", "import_details"]; return t.reduce((a, k) => { a[k] = Array.isArray(db[k]) ? db[k].length : 0; return a; }, {}); }

// ========== WORKER MANAGEMENT ==========
function spawnWorker() {
  if (worker) {
    try { worker.postMessage({ type: "shutdown" }); } catch (_) {}
    worker = null;
  }
  workerReady = false;
  worker = new Worker(WORKER_SCRIPT);
  worker.on("message", (msg) => {
    if (msg.type === "ready") { workerReady = true; }
  });
  worker.on("error", (err) => {
    console.error("[RecoveryEngine] Worker error:", err.message);
    workerReady = false;
  });
  worker.on("exit", (code) => {
    if (code !== 0 && status.running) {
      console.error("[RecoveryEngine] Worker exit with code:", code);
      status.running = false;
      status.phase = "error";
      status.progress = "Worker crash, vui long thu lai.";
      restoreLock = false;
    }
    worker = null;
    workerReady = false;
  });
  return new Promise((resolve) => {
    const check = () => { if (workerReady) resolve(true); else setTimeout(check, 50); };
    check();
  });
}

function sendToWorker(msg) {
  return new Promise((resolve, reject) => {
    if (!worker || !workerReady) { reject(new Error("Worker chua san sang")); return; }
    const handler = (m) => {
      if (m.type === "progress") {
        // Update status but keep waiting
        updateStatusFromProgress(m.data);
        return;
      }
      if (m.type === "result") {
        worker.removeListener("message", handler);
        resolve(m.data);
      } else if (m.type === "error") {
        worker.removeListener("message", handler);
        reject(new Error(m.data?.message || "Worker error"));
      }
    };
    worker.on("message", handler);
    worker.postMessage(msg);
  });
}

function updateStatusFromProgress(data) {
  if (data.phase) status.phase = data.phase;
  if (data.scanningDrive) status.details.scanningDrive = data.scanningDrive;
  if (data.filesFound != null) status.details.filesFound = data.filesFound;
  if (data.dirsScanned != null) status.details.dirsScanned = data.dirsScanned;
  if (data.processed != null) status.details.processed = data.processed;
  if (data.total != null) status.details.total = data.total;
  if (data.percent != null) status.details.percent = data.percent;
  if (data.file) status.details.file = data.file;
  if (data.fileName) status.details.fileName = data.fileName;
  if (data.table) status.details.table = data.table;
  if (data.batch) status.details.batch = data.batch;
  if (data.totalBatches) status.details.totalBatches = data.totalBatches;
  if (data.restored) status.details.restored = data.restored;
  if (data.skipped) status.details.skipped = data.skipped;
  if (data.message) status.progress = data.message;

  // Cap nhat elapsed time
  if (status._startTime) {
    status.elapsedMs = Date.now() - status._startTime;
  }

  // Cap nhat step hien thi
  switch (data.phase) {
    case "scan": status.currentStep = "Quet thu muc"; break;
    case "extract": status.currentStep = "Giai nen"; break;
    case "verify": status.currentStep = "Kiem tra file"; break;
    case "snapshot": status.currentStep = "Tao snapshot"; break;
    case "process": status.currentStep = "Doc file"; break;
    case "merge": status.currentStep = "Import " + (data.table || ""); break;
  }
}

// ========== RESTORE LOCK ==========
function acquireLock() {
  if (restoreLock) return false;
  restoreLock = true;
  const lockPath = path.join(os.tmpdir(), "phanmienoffline", "restore.lock");
  try {
    ensureDir(path.dirname(lockPath));
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
    lockFile = lockPath;
    return true;
  } catch (_) {
    restoreLock = false;
    return false;
  }
}

function releaseLock() {
  restoreLock = false;
  if (lockFile) {
    try { fs.unlinkSync(lockFile); } catch (_) {}
    lockFile = null;
  }
}

// ========== INIT ==========
function initialize(options = {}) {
  if (initialized) return;
  dbModule = options.dbModule || require("../db/database");
  initialized = true;
}

// ========== BUOC 1: QUET FILE BACKUP (scan only, no import) ==========
async function scanBackupFiles(options = {}) {
  if (!initialized) initialize();
  if (status.running) return { ok: false, message: "Dang co tien trinh dang chay. Vui long doi hoac huy." };

  if (!acquireLock()) return { ok: false, message: "Khong the khoa tien trinh restore. Co the da co tien trinh khac." };

  status.running = true;
  status.phase = "scan";
  status.progress = "Dang quet file backup...";
  status.details = {};
  status.foundFiles = [];
  status._startTime = Date.now();
  status.elapsedMs = 0;

  const logPath = path.join(getLogDir(), "restore-log-" + stamp() + ".txt");

  try {
    await spawnWorker();
    const initData = {
      DB_PATH: dbModule.DB_PATH,
      SCHEMA: dbModule.SCHEMA,
      DB_BACKUP_DIR: dbModule.DB_BACKUP_DIR,
    };
    await sendToWorker({ type: "init", data: initData });

    const scanOptions = {
      roots: options.roots || null,
      maxFiles: options.maxFiles || 50000,
      deepScan: options.deepScan === true,
      maxFileBytes: options.maxFileBytes || 256 * 1024 * 1024,
      logPath,
      tempDir: getTempRoot(),
    };

    const result = await sendToWorker({ type: "scan-request", data: scanOptions });

    status.foundFiles = result.files || [];
    status.lastLogPath = logPath;
    status.phase = "scan_done";
    status.progress = "Da quet xong: tim thay " + (result.files?.length || 0) + " file backup.";

    return {
      ok: true,
      files: result.files || [],
      total: (result.files || []).length,
      logPath,
      message: "Da quet xong: tim thay " + (result.files?.length || 0) + " file backup. Chon file de khoi phuc hoac bam 'Bat dau khoi phuc' de xu ly tat ca.",
    };
  } catch (error) {
    status.phase = "error";
    status.progress = "Loi quet: " + error.message;
    releaseLock();
    return { ok: false, message: "Loi quet backup: " + error.message, error: error.message };
  } finally {
    status._startTime = null;
    status.running = false;
  }
}

// ========== BUOC 2: KHOI PHUC BACKUP (import) ==========
async function restoreBackups(options = {}) {
  if (!initialized) initialize();
  if (status.running) return { ok: false, message: "Dang co tien trinh dang chay. Vui long doi hoac huy." };

  if (!acquireLock()) return { ok: false, message: "Khong the khoa tien trinh restore." };

  status.running = true;
  status.phase = "snapshot";
  status.progress = "Dang tao snapshot database hien tai...";
  status.details = {};
  status.lastReport = null;
  status._startTime = Date.now();
  status.elapsedMs = 0;

  const logPath = path.join(getLogDir(), "restore-log-" + stamp() + ".txt");

  try {
    // Tao snapshot pre-restore
    const snapshot = safeClone(dbModule.getDb());
    const beforeCounts = countTables(snapshot);

    // Tao backup truoc khi restore
    let safetyBackup = null;
    try {
      safetyBackup = dbModule.createDbBackup("recovery_pre_restore_" + stamp(), { skipRetention: true });
      if (!safetyBackup) {
        const fallbackPath = path.join(getLogDir(), "pre-restore-" + stamp() + ".json");
        fs.writeFileSync(fallbackPath, JSON.stringify(snapshot, null, 2), "utf8");
        safetyBackup = { path: fallbackPath, file: path.basename(fallbackPath), reason: "recovery_pre_restore_fallback", isJsonSnapshot: true, created_at: new Date().toISOString() };
      }
    } catch (e) {
      throw new Error("Khong tao duoc backup database hien tai truoc khi khoi phuc: " + e.message);
    }

    await spawnWorker();
    const initData = {
      DB_PATH: dbModule.DB_PATH,
      SCHEMA: dbModule.SCHEMA,
      DB_BACKUP_DIR: dbModule.DB_BACKUP_DIR,
    };
    await sendToWorker({ type: "init", data: initData });

    const restoreOptions = {
      files: options.files || [],
      deepScan: options.deepScan === true,
      dbPath: dbModule.DB_PATH,
      logPath,
      tempDir: getTempRoot(),
      batchSize: options.batchSize || 150,
      maxFileBytes: options.maxFileBytes || 256 * 1024 * 1024,
      currentDb: safeClone(dbModule.getDb()),
    };

    const result = await sendToWorker({ type: "restore-request", data: restoreOptions });

    // Merge result back to DB
    if (result.current) {
      const db = dbModule.getDb();
      for (const table of Object.keys(dbModule.SCHEMA || {})) {
        if (Array.isArray(result.current[table])) {
          db[table] = result.current[table];
        }
      }
      if (result.current.nextId) {
        db.nextId = { ...db.nextId, ...result.current.nextId };
      }
      dbModule.saveDB();
    }

    const report = result.report || {};
    report.beforeCounts = beforeCounts;
    report.afterCounts = countTables(dbModule.getDb());
    report.safetyBackup = safetyBackup;

    // Validate: kiem tra cac bang quan trong khong bi giam
    for (const t of ["invoices", "invoice_details", "products", "customers", "import_logs", "import_details"]) {
      if ((report.afterCounts[t] || 0) < (report.beforeCounts[t] || 0)) {
        console.warn("[RecoveryEngine] Bang " + t + " bi giam sau restore, dang rollback...");
        // Rollback
        const db = dbModule.getDb();
        for (const key of Object.keys(db)) { if (Array.isArray(db[key])) db[key] = []; }
        for (const table of Object.keys(dbModule.SCHEMA || {})) {
          if (Array.isArray(snapshot[table])) db[table] = [...snapshot[table]];
        }
        db.nextId = { ...snapshot.nextId };
        dbModule.saveDB();
        report.rollbackStatus = "rolled_back";
        status.lastReport = report;
        status.phase = "rolled_back";
        status.progress = "Da rollback ve ban truoc restore do bang " + t + " bi giam.";
        releaseLock();
        return { ok: false, message: "Khoi phuc bi huy do bang " + t + " bi giam du lieu. Da rollback ve ban truoc restore.", report, logPath };
      }
    }

    report.rollbackStatus = "not_needed";
    status.lastReport = report;
    status.lastLogPath = logPath;
    status.phase = result.ok ? "done" : "cancelled";
    status.progress = result.message || (result.ok ? "Hoan tat khoi phuc." : "Da huy khoi phuc.");

    return {
      ok: result.ok,
      message: result.message,
      report,
      logPath,
      files: options.files || [],
    };
  } catch (error) {
    status.phase = "error";
    status.progress = "Loi khoi phuc: " + error.message;

    // Rollback neu co snapshot
    if (safetyBackup) {
      try {
        rollbackToPreRestore(safetyBackup.path);
        console.log("[RecoveryEngine] Da rollback ve snapshot pre-restore.");
      } catch (rbErr) {
        console.error("[RecoveryEngine] Rollback that bai:", rbErr.message);
      }
    }

    return { ok: false, message: "Loi khoi phuc: " + error.message, error: error.message };
  } finally {
    releaseLock();
    status._startTime = null;
    status.running = false;
  }
}

// ========== CANCEL ==========
function cancelRecovery() {
  if (!status.running) return { ok: false, message: "Khong co tien trinh nao dang chay." };
  try {
    if (worker && workerReady) {
      worker.postMessage({ type: "cancel-request" });
    }
    return { ok: true, message: "Da yeu cau huy. Tien trinh se dung sau batch hien tai (an toan)." };
  } catch (_) {
    // Fallback: dat flag
    releaseLock();
    status.running = false;
    status.phase = "cancelled";
    status.progress = "Da huy (fallback).";
    return { ok: true, message: "Da huy tien trinh." };
  }
}

// ========== STATUS ==========
function getStatus() {
  return {
    initialized,
    version: VERSION,
    running: status.running,
    progress: status.progress,
    phase: status.phase,
    lastReport: status.lastReport,
    lastLogPath: status.lastLogPath,
    foundFiles: status.foundFiles,
    details: { ...status.details },
    currentStep: status.currentStep,
    elapsedMs: status.elapsedMs,
  };
}

// ========== VERIFY FILES (kiem tra xem backup hop le khong) ==========
async function verifyBackupFiles(files = [], options = {}) {
  if (!initialized) initialize();
  if (!files.length) return { ok: true, verified: [], total: 0 };

  const logPath = path.join(getLogDir(), "verify-log-" + stamp() + ".txt");

  try {
    await spawnWorker();
    const initData = {
      DB_PATH: dbModule.DB_PATH,
      SCHEMA: dbModule.SCHEMA,
      DB_BACKUP_DIR: dbModule.DB_BACKUP_DIR,
    };
    await sendToWorker({ type: "init", data: initData });

    const result = await sendToWorker({
      type: "verify-request",
      data: { files, logPath, tempDir: getTempRoot() },
    });

    return {
      ok: true,
      verified: result.results || [],
      total: (result.results || []).length,
      validCount: (result.results || []).filter(r => r.ok).length,
      invalidCount: (result.results || []).filter(r => !r.ok).length,
      logPath,
    };
  } catch (error) {
    return { ok: false, message: "Loi kiem tra backup: " + error.message };
  }
}

// ========== QUET SAU TOAN BO O DIA (che do nang cao) ==========
async function deepScanAllDrives(options = {}) {
  return scanBackupFiles({ ...options, deepScan: true });
}

// ========== LOGS ==========
function getLogs(limit = 20) {
  try {
    return fs.readdirSync(getLogDir())
      .filter(f => /^restore-log-.*\.txt$/i.test(f) || /^recovery_.*\.json$/i.test(f))
      .sort().reverse().slice(0, limit)
      .map(f => ({ file: f, path: path.join(getLogDir(), f) }));
  } catch (_) { return []; }
}
function readLog(filePath) {
  const target = path.isAbsolute(String(filePath || "")) ? filePath : path.join(getLogDir(), path.basename(String(filePath || "")));
  const lower = String(target).toLowerCase();
  if (lower.endsWith(".txt")) return { type: "text", content: fs.readFileSync(target, "utf8") };
  return { type: "json", content: JSON.parse(fs.readFileSync(target, "utf8")) };
}

// ========== ROLLBACK ==========
function rollbackToPreRestore(backupPath) {
  if (!backupPath) throw new Error("Thieu duong dan backup rollback");
  if (!fs.existsSync(backupPath)) throw new Error("File backup rollback khong ton tai: " + backupPath);
  const { readBackupData } = require("../utils/backupCodec");
  const data = readBackupData(backupPath);

  // Fallback: read raw data and restore
  const db = dbModule.getDb();
  for (const key of Object.keys(db)) { if (Array.isArray(db[key])) db[key] = []; }

  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    if (Array.isArray(data[table])) db[table] = [...data[table]];
    else if (data.database && Array.isArray(data.database[table])) db[table] = [...data.database[table]];
  }
  if (data.nextId) db.nextId = { ...db.nextId, ...data.nextId };
  else if (data.database?.nextId) db.nextId = { ...db.nextId, ...data.database.nextId };

  // Ensure nextIds
  for (const table of Object.keys(dbModule.SCHEMA || {})) {
    const maxId = Array.isArray(db[table]) ? db[table].reduce((m, r) => Math.max(m, Number(r && r.id) || 0), 0) : 0;
    db.nextId[table] = Math.max(Number(db.nextId[table]) || 1, maxId + 1);
  }

  dbModule.saveDB();
  return { ok: true };
}

// ========== EXPORT ==========
async function runRecovery(options = {}) {
  const scan = await scanBackupFiles(options);
  if (!scan.ok) return scan;
  return restoreBackups({ ...options, files: scan.files || [] });
}

function startBackgroundRecovery(options = {}) {
  if (status.running) return { ok: false, running: true, message: "Dang co tien trinh khoi phuc dang chay." };
  setTimeout(() => runRecovery(options).catch(e => console.error("[RecoveryEngine] background error:", e)), Math.max(100, Number(options.delayMs) || 300));
  return { ok: true, started: true, message: "Da khoi dong khoi phuc nen." };
}

module.exports = {
  initialize,
  scanBackupFiles,
  restoreBackups,
  verifyBackupFiles,
  deepScanAllDrives,
  runRecovery,
  startBackgroundRecovery,
  cancelRecovery,
  getStatus,
  getLogs,
  readLog,
  rollbackToPreRestore,
  VERSION,
};


