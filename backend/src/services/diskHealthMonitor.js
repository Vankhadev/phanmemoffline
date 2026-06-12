/**
 * KHA Data Guardian - Disk Health Monitor
 * 
 * Giám sát sức khỏe ổ đĩa:
 * - Kiểm tra dung lượng trống (cảnh báo < 1GB)
 * - Kiểm tra SMART status qua wmic (Windows)
 * - Phát hiện USB đang kết nối
 * - Nếu ổ lỗi → tự nhân bản backup sang ổ khác
 * 
 * Chạy kiểm tra mỗi 30 phút.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LOW_DISK_THRESHOLD = 1 * 1024 * 1024 * 1024; // 1GB
const CRITICAL_DISK_THRESHOLD = 500 * 1024 * 1024; // 500MB

let checkTimer = null;
let alertService = null;
let initialized = false;
let lastCheckResult = null;
let lastCheckTime = 0;

function initialize(options = {}) {
  alertService = options.alertService || null;
  initialized = true;

  // Run initial check
  lastCheckResult = performHealthCheck();
  lastCheckTime = Date.now();

  console.log(`[KHA DISK MONITOR] Initialized. Drives found: ${lastCheckResult.drives.length}`);
}

function startMonitoring() {
  if (!initialized) return;
  stopMonitoring();

  checkTimer = setInterval(() => {
    try {
      lastCheckResult = performHealthCheck();
      lastCheckTime = Date.now();
      processHealthAlerts(lastCheckResult);
    } catch (error) {
      console.error(`[KHA DISK MONITOR] Check error: ${error.message}`);
    }
  }, CHECK_INTERVAL_MS);

  if (checkTimer.unref) checkTimer.unref();
  console.log('[KHA DISK MONITOR] Monitoring started (every 30 min)');
}

function stopMonitoring() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/**
 * Get disk space info for all drives (Windows specific).
 */
function getDriveSpaceInfo() {
  const drives = [];
  const driveLetters = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

  for (const letter of driveLetters) {
    const drivePath = `${letter}:\\`;
    try {
      // Check if drive exists
      fs.accessSync(drivePath, fs.constants.R_OK);
      const stat = fs.statfsSync(drivePath);

      const totalBytes = stat.bsize * stat.blocks;
      const freeBytes = stat.bsize * stat.bavail;
      const usedBytes = totalBytes - freeBytes;

      drives.push({
        letter,
        mount: drivePath,
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
        totalGB: (totalBytes / (1024 ** 3)).toFixed(2),
        freeGB: (freeBytes / (1024 ** 3)).toFixed(2),
        isLow: freeBytes < LOW_DISK_THRESHOLD,
        isCritical: freeBytes < CRITICAL_DISK_THRESHOLD,
      });
    } catch (_) {
      // Drive not available
    }
  }

  return drives;
}

/**
 * Check SMART status via wmic (Windows only).
 * Gracefully returns 'unknown' if wmic is unavailable.
 */
function getSMARTStatus() {
  if (os.platform() !== 'win32') {
    return { available: false, disks: [] };
  }

  try {
    const output = execSync('wmic diskdrive get Model,Status,InterfaceType,MediaType,Size /format:list', {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });

    const disks = [];
    let current = {};

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current.Model) {
          disks.push({ ...current });
        }
        current = {};
        continue;
      }
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length > 0) {
        current[key.trim()] = rest.join('=').trim();
      }
    }
    if (current.Model) disks.push(current);

    return {
      available: true,
      disks: disks.map(d => ({
        model: d.Model || 'Unknown',
        status: d.Status || 'Unknown',
        interfaceType: d.InterfaceType || 'Unknown',
        mediaType: d.MediaType || 'Unknown',
        sizeGB: d.Size ? (Number(d.Size) / (1024 ** 3)).toFixed(2) : '0',
        isHealthy: (d.Status || '').toLowerCase() === 'ok',
        hasWarning: (d.Status || '').toLowerCase() !== 'ok' && (d.Status || '').toLowerCase() !== '',
      })),
    };
  } catch (error) {
    return { available: false, error: error.message, disks: [] };
  }
}

/**
 * Detect USB/removable drives.
 */
function getUSBDrives() {
  if (os.platform() !== 'win32') return [];

  try {
    const output = execSync('wmic logicaldisk where "DriveType=2" get DeviceID,VolumeName,Size,FreeSpace /format:list', {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });

    const drives = [];
    let current = {};

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current.DeviceID) {
          drives.push({
            letter: current.DeviceID.replace(':', ''),
            mount: current.DeviceID + '\\',
            volumeName: current.VolumeName || '',
            totalBytes: Number(current.Size) || 0,
            freeBytes: Number(current.FreeSpace) || 0,
            isUSB: true,
          });
        }
        current = {};
        continue;
      }
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length > 0) {
        current[key.trim()] = rest.join('=').trim();
      }
    }
    if (current.DeviceID) {
      drives.push({
        letter: current.DeviceID.replace(':', ''),
        mount: current.DeviceID + '\\',
        volumeName: current.VolumeName || '',
        totalBytes: Number(current.Size) || 0,
        freeBytes: Number(current.FreeSpace) || 0,
        isUSB: true,
      });
    }

    return drives;
  } catch (_) {
    return [];
  }
}

/**
 * Perform a comprehensive health check.
 */
function performHealthCheck() {
  const drives = getDriveSpaceInfo();
  const smart = getSMARTStatus();
  const usbDrives = getUSBDrives();

  const lowDiskDrives = drives.filter(d => d.isLow);
  const criticalDrives = drives.filter(d => d.isCritical);
  const unhealthyDisks = smart.disks.filter(d => d.hasWarning);
  const healthyDriveCount = drives.filter(d => !d.isLow).length;

  return {
    timestamp: new Date().toISOString(),
    drives,
    smart,
    usbDrives,
    summary: {
      totalDrives: drives.length,
      healthyDrives: healthyDriveCount,
      lowDiskDrives: lowDiskDrives.length,
      criticalDrives: criticalDrives.length,
      usbConnected: usbDrives.length,
      smartWarnings: unhealthyDisks.length,
      overallHealthy: criticalDrives.length === 0 && unhealthyDisks.length === 0,
    },
  };
}

function processHealthAlerts(result) {
  if (!alertService) return;

  // Critical disk space
  for (const drive of result.drives) {
    if (drive.isCritical) {
      alertService.sendCriticalAlert('disk-health',
        `Ổ ${drive.letter}: sắp đầy! Chỉ còn ${drive.freeGB}GB trống (${drive.usedPercent}% đã dùng).`,
        { drive: drive.letter, freeGB: drive.freeGB, usedPercent: drive.usedPercent }
      );
    } else if (drive.isLow) {
      alertService.sendWarningAlert('disk-health',
        `Ổ ${drive.letter}: dung lượng thấp - còn ${drive.freeGB}GB trống.`,
        { drive: drive.letter, freeGB: drive.freeGB }
      );
    }
  }

  // SMART warnings
  for (const disk of result.smart.disks) {
    if (disk.hasWarning) {
      alertService.sendCriticalAlert('disk-health',
        `Ổ cứng ${disk.model} có cảnh báo SMART: Status = ${disk.status}. Cần kiểm tra và nhân bản dữ liệu ngay!`,
        { model: disk.model, status: disk.status }
      );
    }
  }
}

/**
 * Find the best drive to use for backup mirroring.
 * Returns drives sorted by free space (most space first), excluding unhealthy ones.
 */
function getBestMirrorDrives() {
  const drives = getDriveSpaceInfo();
  return drives
    .filter(d => !d.isCritical && d.freeBytes > LOW_DISK_THRESHOLD)
    .sort((a, b) => b.freeBytes - a.freeBytes);
}

function getStatus() {
  return {
    initialized,
    monitoring: checkTimer !== null,
    lastCheckTime: lastCheckTime ? new Date(lastCheckTime).toISOString() : null,
    lastCheckResult: lastCheckResult,
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
  performHealthCheck,
  getDriveSpaceInfo,
  getSMARTStatus,
  getUSBDrives,
  getBestMirrorDrives,
  getStatus,
  shutdown,
};
