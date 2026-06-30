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

const VERSION = "2.4.6";
const WORKER_SCRIPT = path.resolve(__dirname, "..", "workers", "RecoveryWorker.js");

let worker = null;
let workerReady = false;
let dbModule = null;
let initialized = false;

// Trang thai
let status = {
  running: false,
  progress: "Chưa chạy",
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
      status.progress = "Worker crash, vui lòng thử lại.";
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
    if (!worker || !workerReady) { reject(new Error("Worker chưa sẵn sàng")); return; }
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

// ---- Restore Lock with PID check ----
function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function readLockFile(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const obj = JSON.parse(raw);
    return obj;
  } catch (_) { return null; }
}

function isStaleLock(lockPath) {
  const data = readLockFile(lockPath);
  if (!data) return true; // không đọc được -> stale
  const pid = Number(data.pid);
  if (!pid || !isProcessAlive(pid)) return true;
  // Nếu lock quá 10 phút không cập nhật
  const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : new Date(data.startedAt || 0).getTime();
  if (Date.now() - updatedAt > 10 * 60 * 1000) return true;
  return false;
}

function acquireLock(label = "restore-import") {
  if (restoreLock) return false;
  const lockName = label === "scan" ? "restore-scan.lock" : "restore-import.lock";
  const lockPath = path.join(os.tmpdir(), "phanmienoffline", lockName);
  try {
    ensureDir(path.dirname(lockPath));
    // Kiểm tra stale lock và tự dọn
    if (fs.existsSync(lockPath)) {
      if (isStaleLock(lockPath)) {
        console.log("[RESTORE_LOCK] Found stale lock, removing:", lockPath);
        try { fs.unlinkSync(lockPath); } catch (_) {}
      } else {
        console.log("[RESTORE_LOCK] Active lock exists, cannot acquire:", lockPath);
        return false;
      }
    }
    restoreLock = true;
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      type: label,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: VERSION,
      status: "running",
    }, null, 2), "utf8");
    lockFile = lockPath;
    console.log("[RESTORE_LOCK] Lock acquired:", lockPath);
    return true;
  } catch (e) {
    console.error("[RESTORE_LOCK] Lock acquire failed:", e.message);
    restoreLock = false;
    return false;
  }
}

function releaseLock() {
  restoreLock = false;
  if (lockFile) {
    console.log("[RESTORE_LOCK] Lock released:", lockFile);
    try { fs.unlinkSync(lockFile); } catch (_) {}
    lockFile = null;
  }
}


function parseBackupTimestamp(filePath, mtimeMs) {
  const s = path.basename(String(filePath || ''));
  const m = s.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[T _-]?([0-2]\d)?[-_]?([0-5]\d)?[-_]?([0-5]\d)?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    if (Number.isFinite(d.getTime())) return d.getTime();
  }
  return Number(mtimeMs) || 0;
}

function classifyBackupFile(file) {
  const fp = String(file?.path || '');
  const name = path.basename(fp).toLowerCase();
  const full = fp.toLowerCase();
  const isRecoveryPoint = /before-write-recovery-point|recovery-point|autosave|auto-save/.test(name) || full.includes('realtime-snapshots');
  const type = isRecoveryPoint ? 'recovery_point' : 'main_backup';
  const ts = parseBackupTimestamp(fp, file?.mtimeMs);
  return { ...file, type, backupType: type, category: type, timestampMs: ts, timestamp: ts ? new Date(ts).toISOString() : null };
}

function summarizeBackups(files) {
  const annotated = (Array.isArray(files) ? files : []).map(classifyBackupFile).sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  const mainBackups = annotated.filter(f => f.type === 'main_backup');
  const recoveryPoints = annotated.filter(f => f.type === 'recovery_point');
  const latestByDayMap = new Map();
  const latestByHourMap = new Map();
  for (const f of annotated) {
    const d = f.timestampMs ? new Date(f.timestampMs) : null;
    if (!d) continue;
    const day = d.toISOString().slice(0, 10);
    const hour = d.toISOString().slice(0, 13);
    if (!latestByDayMap.has(day)) latestByDayMap.set(day, f);
    if (!latestByHourMap.has(hour)) latestByHourMap.set(hour, f);
  }
  const defaultSelection = (mainBackups.length ? mainBackups.slice(0, 1) : recoveryPoints.slice(0, 1)).map(f => f.path);
  return {
    files: annotated,
    summary: {
      total: annotated.length,
      mainBackupCount: mainBackups.length,
      recoveryPointCount: recoveryPoints.length,
      latestByDayCount: latestByDayMap.size,
      latestByHourCount: latestByHourMap.size,
      defaultSelection,
    },
    filters: {
      all: annotated.map(f => f.path),
      main: mainBackups.map(f => f.path),
      recoveryPoint: recoveryPoints.map(f => f.path),
      latestByDay: Array.from(latestByDayMap.values()).map(f => f.path),
      latestByHour: Array.from(latestByHourMap.values()).map(f => f.path),
    },
  };
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
  if (status.running) return { ok: false, message: "Đang có tiến trình đang chạy. Vui lòng đợi hoặc hủy." };

  if (!acquireLock("scan")) return { ok: false, message: "Đang có tiến trình quét backup khác. Vui lòng đợi hoặc bấm Mở khóa restore." };

  status.running = true;
  status.phase = "scan";
  status.progress = "Đang quét file backup...";
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

    const backupInfo = summarizeBackups(result.files || []);
    status.foundFiles = backupInfo.files;
    status.lastLogPath = logPath;
    status.phase = "scan_done";
    status.progress = "Đã quét xong: tìm thấy " + backupInfo.files.length + " file backup.";

    return {
      ok: true,
      files: backupInfo.files,
      total: backupInfo.files.length,
      summary: backupInfo.summary,
      filters: backupInfo.filters,
      logPath,
      message: "Đã quét xong: tìm thấy " + backupInfo.files.length + " file backup. Hãy chọn file cần khôi phục; mặc định không import toàn bộ recovery point.",
    };
  } catch (error) {
    status.phase = "error";
    status.progress = "Lỗi quét: " + error.message;
    releaseLock();
    return { ok: false, message: "Lỗi quét backup: " + error.message, error: error.message };
  } finally {
    status._startTime = null;
    status.running = false;
    releaseLock();
  }
}

// ========== BUOC 2: KHOI PHUC BACKUP (import) ==========
async function restoreBackups(options = {}) {
  if (!initialized) initialize();
  if (status.running) return { ok: false, message: "Đang có tiến trình đang chạy. Vui lòng đợi hoặc hủy." };

  startupCleanupLocks();
  if (!acquireLock("restore-import")) return { ok: false, message: "Không thể khóa tiến trình restore. Thử nhấn Mở khóa restore." };

  status.running = true;
  status.phase = "snapshot";
  status.progress = "Đang tạo snapshot database hiện tại...";
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
      throw new Error("Không tạo được backup database hiện tại trước khi khôi phục: " + e.message);
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
        return { ok: false, message: "Khoi phuc bi huy do bang " + t + " bi giam du lieu. Đã rollback về bản trước restore.", report, logPath };
      }
    }

    report.rollbackStatus = "not_needed";
    status.lastReport = report;
    status.lastLogPath = logPath;
    status.phase = result.ok ? "done" : "cancelled";
    status.progress = result.message || (result.ok ? "Hoàn tất khôi phục." : "Đã hủy khôi phục.");

    return {
      ok: result.ok,
      message: result.message,
      report,
      logPath,
      files: options.files || [],
    };
  } catch (error) {
    status.phase = "error";
    status.progress = "Lỗi khôi phục: " + error.message;

    // Rollback neu co snapshot
    if (safetyBackup) {
      try {
        rollbackToPreRestore(safetyBackup.path);
        console.log("[RecoveryEngine] Da rollback ve snapshot pre-restore.");
      } catch (rbErr) {
        console.error("[RecoveryEngine] Rollback that bai:", rbErr.message);
      }
    }

    return { ok: false, message: "Lỗi khôi phục: " + error.message, error: error.message };
  } finally {
    releaseLock();
    status._startTime = null;
    status.running = false;
  }
}

// ========== CANCEL ==========
function cancelRecovery() {
  if (!status.running) return { ok: false, message: "Không có tiến trình nào đang chạy." };
  try {
    if (worker && workerReady) {
      worker.postMessage({ type: "cancel-request" });
    }
    return { ok: true, message: "Đã yêu cầu hủy. Tiến trình sẽ dừng sau batch hiện tại (an toàn)." };
  } catch (_) {
    // Fallback: dat flag
    releaseLock();
    status.running = false;
    status.phase = "cancelled";
    status.progress = "Đã hủy (fallback).";
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
    return { ok: false, message: "Lỗi kiểm tra backup: " + error.message };
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
  if (!fs.existsSync(backupPath)) throw new Error("File backup rollback không tồn tại: " + backupPath);
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
  if (status.running) return { ok: false, running: true, message: "Đang có tiến trình khôi phục đang chạy." };
  setTimeout(() => runRecovery(options).catch(e => console.error("[RecoveryEngine] background error:", e)), Math.max(100, Number(options.delayMs) || 300));
  return { ok: true, started: true, message: "Đã khởi động khôi phục nền." };
}


function startupCleanupLocks() {
  const lockPaths = [
    path.join(os.tmpdir(), "phanmienoffline", "restore-import.lock"),
    path.join(os.tmpdir(), "phanmienoffline", "restore.lock"),
    path.join(os.tmpdir(), "phanmienoffline", "restore-scan.lock"),
  ];
  for (const lp of lockPaths) {
    if (fs.existsSync(lp) && isStaleLock(lp)) {
      console.log("[RESTORE_LOCK] Startup: removing stale lock:", lp);
      try { fs.unlinkSync(lp); } catch (_) {}
    }
  }
}

function forceUnlock() {
  const lockPaths = [
    path.join(os.tmpdir(), "phanmienoffline", "restore.lock"),
    path.join(os.tmpdir(), "phanmienoffline", "restore-scan.lock"),
  ];
  const results = [];
  for (const lp of lockPaths) {
    if (!fs.existsSync(lp)) { results.push({ path: lp, status: 'not_found' }); continue; }
    if (isStaleLock(lp)) {
      try { fs.unlinkSync(lp); results.push({ path: lp, status: 'removed_stale', message: 'Đã mở khóa stale lock.' }); } catch (e) { results.push({ path: lp, status: 'error', message: e.message }); }
    } else {
      results.push({ path: lp, status: 'active', message: 'Lock đang được tiến trình thật giữ, không thể mở khóa.' });
    }
  }
  restoreLock = false;
  lockFile = null;
  return results;
}
module.exports = {
  initialize,
  startupCleanupLocks,
  forceUnlock,
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




