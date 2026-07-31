/**
 * KHA Data Guardian - Backup Scheduler
 * Backup định kỳ mỗi 72 giờ, giữ tối đa 30 bản gần nhất.
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const DATA_PRESERVATION_FOLDER = 'backup_du_lieu_phan_mem_no_del';
const SCHEDULE_CRON = '0 */12 * * *';
const AUTO_BACKUP_INTERVAL_MS = 72 * 60 * 60 * 1000;

let baseBackupDir = null;
let dbModule = null;
let alertService = null;
let diskHealthMonitor = null;
let cronJobs = [];
let initialized = false;

function initialize(options = {}) {
  const dataDir = options.dataDir || process.env.ELECTRON_USER_DATA || path.resolve(__dirname, '..', '..', 'data');
  dbModule = options.dbModule || null;
  alertService = options.alertService || null;
  diskHealthMonitor = options.diskHealthMonitor || null;
  baseBackupDir = options.backupDir || dbModule?.DB_BACKUP_DIR || path.join(dataDir, DATA_PRESERVATION_FOLDER);

  try { fs.mkdirSync(baseBackupDir, { recursive: true }); } catch (_) {}
  initialized = true;
}

function stopSchedules() {
  for (const job of cronJobs) {
    try { job.stop(); } catch (_) {}
  }
  cronJobs = [];
}

function startSchedules() {
  if (!initialized) return;
  stopSchedules();
  cronJobs.push(cron.schedule(SCHEDULE_CRON, () => runScheduledBackup('scheduled-cron')));
}

function getLatestBackup() {
  const backups = listAllBackups(1);
  return backups[0] || null;
}

function shouldRunBackup(nowMs = Date.now()) {
  const latest = getLatestBackup();
  if (!latest) return true;
  return nowMs - latest.mtimeMs >= AUTO_BACKUP_INTERVAL_MS;
}

function runScheduledBackup(reason = 'scheduled') {
  if (!initialized || !dbModule || typeof dbModule.createDbBackup !== 'function') return { ok: false, reason: 'not_initialized' };
  if (!shouldRunBackup()) return { ok: true, skipped: true, reason: 'recent_backup_exists', latest: getLatestBackup() };
  const backup = dbModule.createDbBackup(reason, { retentionCount: 30 });
  if (!backup) {
    if (alertService) alertService.sendWarningAlert('backup-scheduler', 'Không tạo được backup định kỳ.');
    return { ok: false, error: 'backup_failed' };
  }
  return { ok: true, backup };
}

function backupNow(reason = 'manual') {
  return runScheduledBackup(reason);
}

function backupBeforeMaintenance() { return runScheduledBackup('pre-maintenance'); }
function backupBeforeUpdate() { return runScheduledBackup('pre-update'); }
function backupEmergency() { return runScheduledBackup('emergency'); }

function listAllBackups(limit = 50) {
  if (!baseBackupDir) return [];
  try {
    return fs.readdirSync(baseBackupDir)
      .filter(file => file.startsWith('phanmienoffline-db-') && (file.endsWith('.json') || file.endsWith('.json.gz') || file.endsWith('.zip')))
      .map(file => {
        const fullPath = path.join(baseBackupDir, file);
        const stat = fs.statSync(fullPath);
        return { tier: 'scheduled', file, path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs, mtime: new Date(stat.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);
  } catch (_) {
    return [];
  }
}

function findBestBackup() {
  return getLatestBackup();
}

function restoreBackup(backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error('Backup file không tồn tại');
  if (!dbModule || typeof dbModule.restoreDbBackup !== 'function') throw new Error('Safe database restore is unavailable');
  return dbModule.restoreDbBackup(backupPath);
}

function getStatus() {
  const latest = getLatestBackup();
  const nextAt = latest ? new Date(latest.mtimeMs + AUTO_BACKUP_INTERVAL_MS).toISOString() : null;
  return {
    initialized,
    baseBackupDir,
    latestBackup: latest,
    lastBackupAt: latest?.mtime || null,
    nextBackupAt: nextAt,
    totalBackups: listAllBackups(1000).length,
    scheduleRunning: cronJobs.length > 0,
    intervalHours: 72,
  };
}

function shutdown() {
  stopSchedules();
  initialized = false;
}

module.exports = {
  initialize,
  startSchedules,
  stopSchedules,
  backupNow,
  runScheduledBackup,
  backupBeforeMaintenance,
  backupBeforeUpdate,
  backupEmergency,
  listAllBackups,
  findBestBackup,
  restoreBackup,
  getStatus,
  shutdown,
};
