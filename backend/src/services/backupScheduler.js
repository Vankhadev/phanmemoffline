/**
 * KHA Data Guardian - Multi-Tier Backup Scheduler
 * 
 * Lịch backup đa tầng:
 * - 5 phút/lần (incremental, giữ 12 bản = 1 giờ)
 * - 1 giờ/lần (full, giữ 24 bản = 1 ngày)
 * - 17:30 hằng ngày (end-of-day, giữ 30 bản = 1 tháng)
 * - Trước bảo trì (on demand)
 * - Trước cập nhật (on demand)
 * 
 * Tất cả backup mirror sang đa ổ đĩa (C:\, D:\, E:\, USB).
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const BACKUP_TIERS = Object.freeze({
  FIVE_MIN: { name: '5min', retention: 12, subDir: 'tier-5min' },
  HOURLY: { name: 'hourly', retention: 24, subDir: 'tier-hourly' },
  END_OF_DAY: { name: 'end-of-day', retention: 30, subDir: 'tier-daily' },
  PRE_MAINTENANCE: { name: 'pre-maintenance', retention: 5, subDir: 'tier-pre-maintenance' },
  PRE_UPDATE: { name: 'pre-update', retention: 5, subDir: 'tier-pre-update' },
  EMERGENCY: { name: 'emergency', retention: 10, subDir: 'tier-emergency' },
});

const DATA_PRESERVATION_FOLDER = 'backup_du_lieu_phan_mem_no_del';
const MIRROR_ROOTS = (process.env.KHA_DATA_PRESERVATION_BACKUP_ROOTS || 'C:\\,D:\\,E:\\,F:\\')
  .split(',').map(r => r.trim()).filter(Boolean);

let baseBackupDir = null;
let dbModule = null;
let alertService = null;
let diskHealthMonitor = null;
let cronJobs = [];
let initialized = false;
let lastBackupTimes = {};
let backupStats = { total: 0, errors: 0, lastError: null };

function initialize(options = {}) {
  const dataDir = options.dataDir || process.env.ELECTRON_USER_DATA || path.resolve(__dirname, '..', '..', 'data');
  baseBackupDir = path.join(dataDir, DATA_PRESERVATION_FOLDER);
  dbModule = options.dbModule || null;
  alertService = options.alertService || null;
  diskHealthMonitor = options.diskHealthMonitor || null;

  // Create tier directories
  for (const tier of Object.values(BACKUP_TIERS)) {
    try {
      fs.mkdirSync(path.join(baseBackupDir, tier.subDir), { recursive: true });
    } catch (_) {}
  }

  initialized = true;
  console.log(`[KHA BACKUP SCHEDULER] Initialized. Dir: ${baseBackupDir}`);
}

function startSchedules() {
  if (!initialized) return;

  // Stop existing jobs
  stopSchedules();

  // 5 minutes - incremental backup
  cronJobs.push(cron.schedule('*/5 * * * *', () => {
    runTieredBackup(BACKUP_TIERS.FIVE_MIN);
  }));

  // 1 hour - full backup
  cronJobs.push(cron.schedule('0 * * * *', () => {
    runTieredBackup(BACKUP_TIERS.HOURLY);
  }));

  // 17:30 daily - end of day backup
  cronJobs.push(cron.schedule('30 17 * * *', () => {
    runTieredBackup(BACKUP_TIERS.END_OF_DAY);
  }));

  console.log('[KHA BACKUP SCHEDULER] Cron schedules started (5min, hourly, 17:30 daily)');
}

function stopSchedules() {
  for (const job of cronJobs) {
    try { job.stop(); } catch (_) {}
  }
  cronJobs = [];
}

/**
 * Create a backup for a specific tier, with retention and mirroring.
 */
function runTieredBackup(tier) {
  if (!initialized || !dbModule) return null;

  const tierDir = path.join(baseBackupDir, tier.subDir);
  try {
    fs.mkdirSync(tierDir, { recursive: true });
  } catch (_) {}

  try {
    const dbPath = dbModule.DB_PATH;
    if (!dbPath || !fs.existsSync(dbPath)) {
      return { ok: false, reason: 'db_file_missing' };
    }

    // Check if data has changed since last backup of this tier
    const lastTime = lastBackupTimes[tier.name] || 0;
    const dbStat = fs.statSync(dbPath);
    if (tier.name === '5min' && lastTime > 0 && dbStat.mtimeMs <= lastTime) {
      return { ok: true, skipped: true, reason: 'no_changes' };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `kha-backup-${tier.name}-${stamp}.json`;
    const backupPath = path.join(tierDir, fileName);

    // Copy database file
    fs.copyFileSync(dbPath, backupPath);
    lastBackupTimes[tier.name] = Date.now();
    backupStats.total++;

    // Mirror to other drives
    mirrorBackup(backupPath, fileName, tier);

    // Mirror to USB if available
    mirrorToUSB(backupPath, fileName, tier);

    // Prune old backups
    pruneBackupsForTier(tierDir, tier.retention);

    const stat = fs.statSync(backupPath);
    console.log(`[KHA BACKUP SCHEDULER] ${tier.name}: ${fileName} (${(stat.size / 1024).toFixed(1)}KB)`);

    return {
      ok: true,
      tier: tier.name,
      file: fileName,
      path: backupPath,
      size: stat.size,
      created_at: new Date().toISOString(),
    };
  } catch (error) {
    backupStats.errors++;
    backupStats.lastError = { message: error.message, time: new Date().toISOString(), tier: tier.name };
    console.error(`[KHA BACKUP SCHEDULER] ${tier.name} error: ${error.message}`);
    if (alertService) {
      alertService.sendWarningAlert('backup-scheduler', `Lỗi backup ${tier.name}: ${error.message}`);
    }
    return { ok: false, error: error.message };
  }
}

function mirrorBackup(sourcePath, fileName, tier) {
  for (const root of MIRROR_ROOTS) {
    try {
      const mirrorDir = path.join(root, DATA_PRESERVATION_FOLDER, 'guardian', tier.subDir);
      fs.mkdirSync(mirrorDir, { recursive: true });
      fs.copyFileSync(sourcePath, path.join(mirrorDir, fileName));
      // Prune mirrors too
      pruneBackupsForTier(mirrorDir, tier.retention);
    } catch (_) {
      // Best-effort mirror: unavailable drives must not block
    }
  }
}

function mirrorToUSB(sourcePath, fileName, tier) {
  if (!diskHealthMonitor) return;

  try {
    const usbDrives = diskHealthMonitor.getUSBDrives();
    for (const drive of usbDrives) {
      try {
        const usbDir = path.join(drive.mount, DATA_PRESERVATION_FOLDER, 'guardian', tier.subDir);
        fs.mkdirSync(usbDir, { recursive: true });
        fs.copyFileSync(sourcePath, path.join(usbDir, fileName));
        console.log(`[KHA BACKUP SCHEDULER] Mirrored to USB: ${drive.mount}`);
      } catch (_) {}
    }
  } catch (_) {}
}

function pruneBackupsForTier(tierDir, retention) {
  try {
    const files = fs.readdirSync(tierDir)
      .filter(f => f.startsWith('kha-backup-') && f.endsWith('.json'))
      .map(f => {
        try {
          const stat = fs.statSync(path.join(tierDir, f));
          return { file: f, mtimeMs: stat.mtimeMs };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const file of files.slice(retention)) {
      try {
        fs.unlinkSync(path.join(tierDir, file.file));
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Trigger a pre-maintenance backup.
 */
function backupBeforeMaintenance() {
  console.log('[KHA BACKUP SCHEDULER] Creating pre-maintenance backup...');
  return runTieredBackup(BACKUP_TIERS.PRE_MAINTENANCE);
}

/**
 * Trigger a pre-update backup.
 */
function backupBeforeUpdate() {
  console.log('[KHA BACKUP SCHEDULER] Creating pre-update backup...');
  return runTieredBackup(BACKUP_TIERS.PRE_UPDATE);
}

/**
 * Trigger an emergency backup.
 */
function backupEmergency() {
  console.log('[KHA BACKUP SCHEDULER] Creating emergency backup...');
  return runTieredBackup(BACKUP_TIERS.EMERGENCY);
}

/**
 * List all backups across all tiers.
 */
function listAllBackups(limit = 50) {
  if (!baseBackupDir) return [];

  const allBackups = [];
  for (const tier of Object.values(BACKUP_TIERS)) {
    const tierDir = path.join(baseBackupDir, tier.subDir);
    try {
      if (!fs.existsSync(tierDir)) continue;
      const files = fs.readdirSync(tierDir)
        .filter(f => f.startsWith('kha-backup-') && f.endsWith('.json'))
        .map(f => {
          try {
            const fullPath = path.join(tierDir, f);
            const stat = fs.statSync(fullPath);
            return {
              tier: tier.name,
              file: f,
              path: fullPath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              mtime: new Date(stat.mtimeMs).toISOString(),
            };
          } catch (_) { return null; }
        })
        .filter(Boolean);
      allBackups.push(...files);
    } catch (_) {}
  }

  return allBackups
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

/**
 * Find the best backup for recovery.
 */
function findBestBackup() {
  const allBackups = listAllBackups(200);
  if (allBackups.length === 0) return null;

  // Prefer: end-of-day > hourly > pre-maintenance > 5min > emergency
  const priority = ['end-of-day', 'pre-maintenance', 'pre-update', 'hourly', '5min', 'emergency'];
  for (const tierName of priority) {
    const backup = allBackups.find(b => b.tier === tierName);
    if (backup && backup.size > 100) return backup;
  }

  return allBackups[0]; // fallback to most recent
}

function getStatus() {
  return {
    initialized,
    baseBackupDir,
    lastBackupTimes: Object.fromEntries(
      Object.entries(lastBackupTimes).map(([k, v]) => [k, new Date(v).toISOString()])
    ),
    stats: backupStats,
    totalBackups: listAllBackups(1000).length,
    scheduleRunning: cronJobs.length > 0,
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
  runTieredBackup,
  backupBeforeMaintenance,
  backupBeforeUpdate,
  backupEmergency,
  listAllBackups,
  findBestBackup,
  getStatus,
  shutdown,
  BACKUP_TIERS,
};
