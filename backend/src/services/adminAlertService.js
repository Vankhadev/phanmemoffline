/**
 * KHA Data Guardian - Admin Alert Service
 * 
 * Gửi cảnh báo cho Admin khi có lỗi nghiêm trọng (>50%).
 * Kênh: File log, Electron notification, Email (nếu cấu hình).
 * 
 * Admin: Văn Kha - SĐT: 0904045075
 * Email: [EMAIL_ADDRESS] vankhaqc@gmail.com
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ADMIN_INFO = Object.freeze({
  name: 'Văn Kha',
  phone: '0904045075',
});

const ALERT_SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
  EMERGENCY: 'emergency',
});

const MAX_ALERT_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ALERT_HISTORY = 500;
const ALERT_COOLDOWN_MS = 60 * 1000; // 1 phút cooldown cho cùng loại alert

let alertLogPath = null;
let alertHistory = [];
let lastAlertTimes = new Map();
let electronNotifyCallback = null;
let appVersion = '1.7.0';

function initialize(options = {}) {
  const dataDir = options.dataDir || process.env.ELECTRON_USER_DATA || path.resolve(__dirname, '..', '..', 'data');
  alertLogPath = path.join(dataDir, 'kha-guardian-alerts.log');
  appVersion = options.appVersion || appVersion;

  if (typeof options.electronNotify === 'function') {
    electronNotifyCallback = options.electronNotify;
  }

  try {
    fs.mkdirSync(path.dirname(alertLogPath), { recursive: true });
  } catch (_) { }

  // Load existing alert history
  try {
    if (fs.existsSync(alertLogPath)) {
      const content = fs.readFileSync(alertLogPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      alertHistory = lines.slice(-MAX_ALERT_HISTORY).map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      }).filter(Boolean);
    }
  } catch (_) { }

  console.log(`[KHA GUARDIAN ALERT] Initialized. Log: ${alertLogPath}`);
}

function buildAlertPayload(severity, module, message, details = {}) {
  return {
    timestamp: new Date().toISOString(),
    severity,
    module: String(module || 'unknown').slice(0, 100),
    message: String(message || '').slice(0, 1000),
    version: appVersion,
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    pid: process.pid,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
    admin: ADMIN_INFO,
    details: {
      errorLevel: details.errorLevel || null,
      errorDetail: String(details.errorDetail || '').slice(0, 2000),
      dbStatus: details.dbStatus || null,
      lastBackup: details.lastBackup || null,
      actionsTaken: Array.isArray(details.actionsTaken) ? details.actionsTaken.slice(0, 20) : [],
      ...Object.fromEntries(
        Object.entries(details)
          .filter(([k]) => !['errorLevel', 'errorDetail', 'dbStatus', 'lastBackup', 'actionsTaken'].includes(k))
          .slice(0, 20)
      ),
    },
  };
}

function shouldThrottle(module, severity) {
  const key = `${module}:${severity}`;
  const lastTime = lastAlertTimes.get(key);
  if (lastTime && Date.now() - lastTime < ALERT_COOLDOWN_MS) {
    return true;
  }
  lastAlertTimes.set(key, Date.now());
  return false;
}

function writeToLog(alert) {
  if (!alertLogPath) return;
  try {
    // Rotate if too large
    if (fs.existsSync(alertLogPath)) {
      const stat = fs.statSync(alertLogPath);
      if (stat.size > MAX_ALERT_LOG_SIZE) {
        const rotatedPath = `${alertLogPath}.${Date.now()}.old`;
        fs.renameSync(alertLogPath, rotatedPath);
        // Keep only the last rotated file
        try {
          const dir = path.dirname(alertLogPath);
          const baseName = path.basename(alertLogPath);
          const oldFiles = fs.readdirSync(dir)
            .filter(f => f.startsWith(baseName) && f.endsWith('.old'))
            .sort()
            .slice(0, -1);
          for (const f of oldFiles) {
            try { fs.unlinkSync(path.join(dir, f)); } catch (_) { }
          }
        } catch (_) { }
      }
    }
    fs.appendFileSync(alertLogPath, JSON.stringify(alert) + '\n', 'utf8');
  } catch (error) {
    console.error(`[KHA GUARDIAN ALERT] Cannot write log: ${error.message}`);
  }
}

function notifyElectron(alert) {
  if (typeof electronNotifyCallback === 'function') {
    try {
      electronNotifyCallback(alert);
    } catch (error) {
      console.error(`[KHA GUARDIAN ALERT] Electron notify error: ${error.message}`);
    }
  }
}

/**
 * Send an alert.
 * @param {string} severity - 'info' | 'warning' | 'critical' | 'emergency'
 * @param {string} module - Module name (e.g., 'database', 'backup', 'maintenance')
 * @param {string} message - Human-readable message
 * @param {object} details - Additional details
 * @returns {object} The alert payload
 */
function sendAlert(severity, module, message, details = {}) {
  const alert = buildAlertPayload(severity, module, message, details);

  // Console log
  const logPrefix = `[KHA GUARDIAN ALERT ${severity.toUpperCase()}]`;
  if (severity === ALERT_SEVERITY.EMERGENCY || severity === ALERT_SEVERITY.CRITICAL) {
    console.error(`${logPrefix} [${module}] ${message}`);
  } else if (severity === ALERT_SEVERITY.WARNING) {
    console.warn(`${logPrefix} [${module}] ${message}`);
  } else {
    console.log(`${logPrefix} [${module}] ${message}`);
  }

  // Throttle check (don't throttle emergency)
  if (severity !== ALERT_SEVERITY.EMERGENCY && shouldThrottle(module, severity)) {
    return alert;
  }

  // Write to log file
  writeToLog(alert);

  // Add to in-memory history
  alertHistory.push(alert);
  if (alertHistory.length > MAX_ALERT_HISTORY) {
    alertHistory = alertHistory.slice(-MAX_ALERT_HISTORY);
  }

  // Notify Electron for critical/emergency
  if (severity === ALERT_SEVERITY.CRITICAL || severity === ALERT_SEVERITY.EMERGENCY) {
    notifyElectron(alert);
  }

  return alert;
}

function sendCriticalAlert(module, message, details = {}) {
  return sendAlert(ALERT_SEVERITY.CRITICAL, module, message, details);
}

function sendWarningAlert(module, message, details = {}) {
  return sendAlert(ALERT_SEVERITY.WARNING, module, message, details);
}

function sendInfoAlert(module, message, details = {}) {
  return sendAlert(ALERT_SEVERITY.INFO, module, message, details);
}

function sendEmergencyAlert(module, message, details = {}) {
  return sendAlert(ALERT_SEVERITY.EMERGENCY, module, message, details);
}

function getAlertHistory(limit = 50) {
  return alertHistory.slice(-Math.max(1, Math.min(limit, MAX_ALERT_HISTORY)));
}

function getAlertStats() {
  const counts = { info: 0, warning: 0, critical: 0, emergency: 0 };
  for (const alert of alertHistory) {
    if (counts[alert.severity] !== undefined) counts[alert.severity] += 1;
  }
  return {
    total: alertHistory.length,
    counts,
    lastAlert: alertHistory.length > 0 ? alertHistory[alertHistory.length - 1] : null,
    logPath: alertLogPath,
  };
}

function clearCooldowns() {
  lastAlertTimes.clear();
}

module.exports = {
  initialize,
  sendAlert,
  sendCriticalAlert,
  sendWarningAlert,
  sendInfoAlert,
  sendEmergencyAlert,
  getAlertHistory,
  getAlertStats,
  clearCooldowns,
  ALERT_SEVERITY,
  ADMIN_INFO,
};
