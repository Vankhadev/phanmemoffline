const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { createUpdateManager } = require('./updater');
const { upgradeShortcuts } = require('./shortcutManager');
const electronLogger = require('./electronLogger'); // PHẦN 13.3: log electron vào logs/electron.log

const DEFAULT_BACKEND_PORT = Number(process.env.PORT || process.env.KHA_BACKEND_PORT || process.env.PHANMEM_PORT || 7000);
const BACKEND_HOST = String(process.env.KHA_BACKEND_HOST || process.env.PHANMEM_HOST || process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
const BACKEND_API_BASE_CHANNEL = 'kha:backend:get-api-base';
const BACKEND_INFO_CHANNEL = 'kha:backend:get-info';
const WINDOW_FOCUS_CHANNEL = 'kha:window:ensure-input-focus';
const PRINT_LIST_PRINTERS_CHANNEL = 'kha:print:list-printers';
const PRINT_HTML_CHANNEL = 'kha:print:html';
const OPEN_EXTERNAL_CHANNEL = 'kha:shell:open-external';
const VERIFY_DOWNLOAD_URL_CHANNEL = 'kha:shell:verify-download-url';
const GUARDIAN_ALERT_CHANNEL = 'kha:guardian:alert';
const GUARDIAN_STATUS_CHANNEL = 'kha:guardian:status';
const APP_USER_MODEL_ID = 'com.vankhammo.phanmienoffline';
const MIN_INSTALLER_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const BACKEND_HEALTH_TIMEOUT_MS = Math.max(30000, Number(process.env.KHA_BACKEND_HEALTH_TIMEOUT_MS) || 30000);

let mainWindow = null;
let backendProcess = null;
let backendFileLogStream = null;
let backendStartupWindow = null;
let backendPort = null;
let backendApiBase = '';
let backendHealth = null;
let backendWatchdogTimer = null;
let backendRestarting = false;
let updateManager = null;
let backendIpcRegistered = false;
const backendInstanceId = randomUUID();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeStartPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 7000;
}

function getBackendClientHost(host = BACKEND_HOST) {
  const value = String(host || '').trim();
  return value === '0.0.0.0' || value === '::' ? '127.0.0.1' : (value || '127.0.0.1');
}

function isPortAvailable(port, host = BACKEND_HOST) {
  return new Promise(resolve => {
    const server = net.createServer();
    let settled = false;

    const finish = (available) => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      if (server.listening) {
        server.close(() => resolve(available));
      } else {
        resolve(available);
      }
    };

    server.once('error', () => finish(false));

    try {
      server.listen({ port, host, exclusive: true }, () => finish(true));
    } catch (_) {
      finish(false);
    }
  });
}

async function findAvailablePort(startPort = DEFAULT_BACKEND_PORT, host = BACKEND_HOST, maxAttempts = 80) {
  const firstPort = normalizeStartPort(startPort);
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = firstPort + offset;
    if (candidate > 65535) break;
    if (await isPortAvailable(candidate, host)) return candidate;
  }
  throw new Error(`Cannot find an available backend port from ${firstPort} on ${host}`);
}

function requestJson(url, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

function summarizeHealthResponse(health) {
  if (!health || typeof health !== 'object') return String(health).slice(0, 500);
  return JSON.stringify({
    ok: health.ok,
    service: health.service,
    instanceId: health.instanceId,
    pid: health.pid,
    port: health.port,
    version: health.version,
  });
}

async function waitForBackendHealth({ apiBase, expectedInstanceId, expectedPid, timeoutMs = BACKEND_HEALTH_TIMEOUT_MS }) {
  const healthUrl = `${apiBase}/health`;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt <= timeoutMs) {
    if (backendProcess && backendProcess.exitCode !== null) {
      throw new Error(`Backend process exited before becoming healthy (code=${backendProcess.exitCode}, signal=${backendProcess.signalCode || 'none'})`);
    }

    try {
      const health = await requestJson(healthUrl, 1000);
      const sameService = health?.ok === true && health.service === 'phanmienoffline-backend';
      const sameInstance = !expectedInstanceId || health.instanceId === expectedInstanceId;
      const samePid = !expectedPid || Number(health.pid) === Number(expectedPid);
      if (sameService && sameInstance && samePid) return health;
      lastError = new Error(`Unexpected backend health response at ${healthUrl}: received ${summarizeHealthResponse(health)}`);
    } catch (err) {
      lastError = err;
    }

    await sleep(500);
  }

  throw new Error(`Backend did not become healthy at ${healthUrl}: ${lastError?.message || 'timeout'}`);
}

function getBackendDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');
}

function getBackendEntryPath() {
  return path.join(getBackendDir(), 'src', 'server.js');
}

function getBackendCwd() {
  return app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(__dirname, '..', 'backend');
}

function clearBackendWatchdog() {
  if (backendWatchdogTimer) {
    clearInterval(backendWatchdogTimer);
    backendWatchdogTimer = null;
  }
}

function isBackendHealthySnapshot() {
  return Boolean(backendProcess && backendApiBase && backendHealth && backendHealth.ok === true);
}

async function restartBackendAfterFailure(reason = 'backend-health-failure') {
  if (app.isQuitting || backendRestarting) return;
  backendRestarting = true;
  clearBackendWatchdog();

  const preferredPort = backendPort || DEFAULT_BACKEND_PORT;
  console.warn(`[KHA Electron] Restarting backend after ${reason}...`);

  try {
    stopBackend();
    await sleep(1000);
    await startBackend({ preferredPort });
    console.log(`[KHA Electron] Backend restarted successfully at ${backendApiBase}`);
  } catch (err) {
    console.error('[KHA Electron] Backend restart failed:', err);
    backendPort = null;
    backendApiBase = '';
    backendHealth = null;
    backendWatchdogTimer = setTimeout(() => {
      backendRestarting = false;
      void restartBackendAfterFailure('retry-after-failed-restart');
    }, 5000);
    backendWatchdogTimer.unref?.();
    return;
  } finally {
    backendRestarting = false;
  }
}

function ensureBackendWatchdog() {
  if (backendWatchdogTimer || app.isQuitting) return;
  backendWatchdogTimer = setInterval(() => {
    if (app.isQuitting || backendRestarting) return;
    if (!backendProcess || backendProcess.exitCode !== null) {
      void restartBackendAfterFailure('process-exit');
      return;
    }
    if (!isBackendHealthySnapshot()) {
      void restartBackendAfterFailure('health-failed');
    }
  }, 10000);
  backendWatchdogTimer.unref?.();
}
function pipeBackendLog(stream, logger) {
  stream?.on('data', chunk => {
    const text = String(chunk || '').trimEnd();
    if (text) logger(`[KHA Backend] ${text}`);
  });
}

function stopBackend() {
  if (!backendProcess) return;
  const child = backendProcess;
  backendProcess = null;
  backendHealth = null;
  clearBackendWatchdog();
  backendRestarting = false;
  try {
    if (!child.killed) child.kill();
  } catch (err) {
    console.warn('[KHA Electron] Cannot stop backend process:', err.message);
  }
}

// KHA FIX 2.3.3: ghi log backend production ra file userData/logs/backend.log
// để khi báo "Không thể chạy backend / ECONNREFUSED" người dùng có thể xem lý do thật.
function getBackendLogFile() {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    return path.join(logsDir, 'backend.log');
  } catch (_) {
    return null;
  }
}

function appendBackendLog(line) {
  try {
    const logFile = getBackendLogFile();
    if (!logFile) return;
    const ts = new Date().toISOString();
    fs.appendFileSync(logFile, `[${ts}] ${line}\n`, 'utf8');
  } catch (_) {
    // Best-effort logging only.
  }
}

function openBackendFileLogStream() {
  closeBackendFileLogStream();
  try {
    const logFile = getBackendLogFile();
    if (!logFile) return;
    backendFileLogStream = fs.createWriteStream(logFile, { flags: 'a' });
    backendFileLogStream.on('error', () => { backendFileLogStream = null; });
  } catch (_) {
    backendFileLogStream = null;
  }
}

function closeBackendFileLogStream() {
  if (backendFileLogStream) {
    try { backendFileLogStream.end(); } catch (_) {}
    backendFileLogStream = null;
  }
}

function writeBackendLogLine(text) {
  const trimmed = String(text || '').replace(/\r?\n$/, '');
  if (!trimmed) return;
  if (backendFileLogStream) {
    try { backendFileLogStream.write(trimmed + '\n'); return; } catch (_) {}
  }
  appendBackendLogLine(trimmed);
}

// KHA FIX 2.3.3: màn hình "Đang khởi động backend..." thay vì trắng màn hình / quit ngay.
function showBackendStartupWindow() {
  if (backendStartupWindow && !backendStartupWindow.isDestroyed()) return;
  try {
    backendStartupWindow = new BrowserWindow({
      width: 480,
      height: 240,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: true,
      alwaysOnTop: false,
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    backendStartupWindow.setMenuBarVisibility(false);
    backendStartupWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>Đang khởi động</title><style>html,body{margin:0;height:100%;font-family:'Segoe UI',Inter,Arial,sans-serif;background:#fff;color:#1f2937;display:flex;align-items:center;justify-content:center} .box{text-align:center;padding:24px} .sp{width:42px;height:42px;border:4px solid #e5e7eb;border-top-color:#2563eb;border-radius:50%;animation:sp 1s linear infinite;margin:0 auto 18px} @keyframes sp{to{transform:rotate(360deg)}} h2{margin:0 0 6px;font-size:18px} p{margin:0;color:#6b7280;font-size:13px}</style></head><body><div class="box"><div class="sp"></div><h2>Đang khởi động backend nội bộ...</h2><p>Vui lòng đợi trong giây lát. Ứng dụng sẽ mở tự động khi sẵn sàng.</p></div></body></html>`));
    backendStartupWindow.on('closed', () => { backendStartupWindow = null; });
  } catch (_) {
    // Best-effort splash window.
  }
}

function closeBackendStartupWindow() {
  if (backendStartupWindow && !backendStartupWindow.isDestroyed()) {
    try { backendStartupWindow.destroy(); } catch (_) {}
  }
  backendStartupWindow = null;
}

async function startBackend(options = {}) {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'phanmienoffline.db.json');
  const preferredPort = normalizeStartPort(options.preferredPort || backendPort || DEFAULT_BACKEND_PORT);
  let port = preferredPort;
  if (!(await isPortAvailable(port, BACKEND_HOST))) {
    port = await findAvailablePort(preferredPort, BACKEND_HOST);
  }
  const apiBase = `http://${getBackendClientHost(BACKEND_HOST)}:${port}/api`;
  const backendDir = getBackendDir();
  const backendEntry = getBackendEntryPath();
  const backendCwd = getBackendCwd();
  const backendDirExists = fs.existsSync(backendDir);
  const backendEntryExists = fs.existsSync(backendEntry);

  // KHA FIX 2.4.5: log đầy đủ để chẩn đoán lỗi production không spawn được backend.
  openBackendFileLogStream();
  const startLine = `[START] appVersion=${app.getVersion()} | packaged=${app.isPackaged} | resourcesPath=${process.resourcesPath || ''} | backendDir=${backendDir} | backendDirExists=${backendDirExists} | backendEntry=${backendEntry} | backendEntryExists=${backendEntryExists} | cwd=${backendCwd} | port=${port} | host=${BACKEND_HOST} | apiBase=${apiBase} | nodeExe=${process.execPath} | dbPath=${dbPath} | userData=${userData}`;
  writeBackendLogLine(startLine);
  writeBackendLogLine(`[SPAWN] command="${process.execPath}" "${backendEntry}" | cwd="${backendCwd}" | env.PORT=${port} | env.DATA_DIR=${userData}`);
  console.log(`[KHA Electron] ${startLine}`);
  if (!backendDirExists) {
    const msg = `Không tìm thấy thư mục backend nội bộ tại: ${backendDir}`;
    writeBackendLogLine(`[ERROR] ${msg}`);
    closeBackendFileLogStream();
    throw new Error(msg);
  }
  if (!backendEntryExists) {
    const msg = `Không tìm thấy file backend nội bộ tại: ${backendEntry}`;
    writeBackendLogLine(`[ERROR] ${msg}`);
    closeBackendFileLogStream();
    throw new Error(msg);
  }

  const env = {
    ...process.env,
    PORT: String(port),
    KHA_BACKEND_PORT: String(port),
    KHA_BACKEND_HOST: BACKEND_HOST,
    PHANMEM_HOST: BACKEND_HOST,
    PHANMEM_PORT: String(port),
    KHA_DB_PATH: dbPath,
    ELECTRON_USER_DATA: userData,
    KHA_BACKEND_INSTANCE_ID: backendInstanceId,
    KHA_BACKEND_PARENT_PID: String(process.pid),
    ELECTRON_RUN_AS_NODE: '1',
  };
  delete env.KHA_DB_SEED_PATH;

  backendPort = port;
  backendApiBase = apiBase;
  backendHealth = null;

  console.log(`[KHA Electron] Starting backend at ${apiBase} (timeout=${BACKEND_HEALTH_TIMEOUT_MS}ms, packaged=${app.isPackaged})`);

  const child = spawn(process.execPath, [backendEntry], {
    cwd: backendCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let healthConfirmed = false;

  backendProcess = child;
  pipeBackendLog(child.stdout, message => { console.log(message); writeBackendLogLine(message); });
  pipeBackendLog(child.stderr, message => { console.error(message); writeBackendLogLine(message); });

  child.once('error', err => {
    const msg = `Backend process error: ${err && err.message ? err.message : err}`;
    console.error('[KHA Electron] ' + msg);
    writeBackendLogLine(`[ERROR] ${msg}`);
  });

  child.once('exit', (code, signal) => {
    if (backendProcess === child) {
      backendProcess = null;
      backendHealth = null;
      backendPort = null;
      backendApiBase = '';
    }
    if (!app.isQuitting) {
      const reason = `Backend process exited (code=${code}, signal=${signal || 'none'})`;
      console.warn(`[KHA Electron] ${reason}`);
      writeBackendLogLine(`[EXIT] ${reason} | healthConfirmed=${healthConfirmed}`);
      if (healthConfirmed) {
        quitAfterBackendFatalError('Backend nội bộ đã dừng bất thường', new Error(reason));
      }
    }
  });

  try {
    backendHealth = await Promise.race([
      waitForBackendHealth({ apiBase, expectedInstanceId: backendInstanceId, expectedPid: child.pid }),
      new Promise((_, reject) => child.once('error', reject)),
    ]);
    healthConfirmed = true;
    console.log(`[KHA Electron] Backend ready at ${backendApiBase} (pid=${child.pid})`);
    writeElectronRuntimePortFile();
  } catch (err) {
    stopBackend();
    backendPort = null;
    backendApiBase = '';
    throw err;
  }
}

// KHA: ghi runtime/backend-port.json de frontend (dev/browser) doc duoc port backend.
function writeElectronRuntimePortFile() {
  try {
    if (!backendPort) return;
    const baseDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
    const runtimeDir = path.join(baseDir, 'runtime');
    if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });
    const runtimeFile = path.join(runtimeDir, 'backend-port.json');
    const payload = {
      host: getBackendClientHost(BACKEND_HOST),
      port: backendPort,
      baseUrl: backendApiBase,
      startedAt: new Date().toISOString(),
      pid: backendProcess?.pid || null,
      instanceId: backendInstanceId,
      source: 'electron',
    };
    fs.writeFileSync(runtimeFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`[KHA Electron] Wrote runtime/backend-port.json -> ${backendApiBase}`);
  } catch (err) {
    console.warn(`[KHA Electron] Cannot write runtime/backend-port.json: ${err.message}`);
  }
}

function getBackendInfo() {
  return {
    apiBase: backendApiBase,
    host: BACKEND_HOST,
    port: backendPort,
    pid: backendProcess?.pid || null,
    instanceId: backendInstanceId,
    health: backendHealth,
    running: Boolean(backendProcess && backendApiBase),
  };
}

function showBackendFatalError(title, err) {
  const detail = err?.stack || err?.message || String(err || 'Unknown backend error');
  console.error(`[KHA Electron] ${title}:`, err);
  let logHint = '';
  try {
    const logFile = getBackendLogFile();
    if (logFile) {
      logHint = `\n\nNhật ký backend:\n${logFile}`;
      writeBackendLogLine(`[FATAL] ${title}: ${detail}`);
    }
  } catch (_) {}
  try {
    dialog.showErrorBox(
      'Không thể chạy backend',
      `${title}.\n\nỨng dụng desktop cần backend nội bộ hoạt động để đọc/ghi dữ liệu. Ứng dụng sẽ dừng thay vì mở giao diện không có kết nối.\n\nChi tiết:\n${detail}${logHint}`
    );
  } catch (_) {
    // Ignore dialog failures in headless/test environments.
  }
}

function quitAfterBackendFatalError(title, err) {
  showBackendFatalError(title, err);
  app.isQuitting = true;
  stopBackend();
  app.quit();
}

function registerBackendIpc() {
  if (backendIpcRegistered) return;
  backendIpcRegistered = true;

  ipcMain.on(BACKEND_API_BASE_CHANNEL, (event) => {
    event.returnValue = backendApiBase || '';
  });
  ipcMain.handle(BACKEND_API_BASE_CHANNEL, () => backendApiBase || '');
  ipcMain.handle(BACKEND_INFO_CHANNEL, () => ({ ok: Boolean(backendApiBase), backend: getBackendInfo() }));
}

function sanitizeFocusDetails(details = {}) {
  const control = details && typeof details === 'object' ? details.control || {} : {};
  return {
    reason: String(details?.reason || 'renderer-input-focus').slice(0, 80),
    tagName: String(control.tagName || '').slice(0, 32),
    type: String(control.type || '').slice(0, 32),
    id: String(control.id || '').slice(0, 80),
    name: String(control.name || '').slice(0, 80),
    placeholder: String(control.placeholder || '').slice(0, 160),
    ariaLabel: String(control.ariaLabel || '').slice(0, 160),
  };
}

function ensureMainWindowInputFocus(details = {}) {
  const focusDetails = sanitizeFocusDetails(details);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'window-not-ready', details: focusDetails };
  }

  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    if (!mainWindow.isFocused()) mainWindow.focus();
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed() && typeof mainWindow.webContents.focus === 'function') {
      mainWindow.webContents.focus();
    }
    return { ok: true, focused: mainWindow.isFocused(), details: focusDetails };
  } catch (err) {
    console.warn('[KHA Electron] Cannot ensure input focus:', err.message, focusDetails);
    return { ok: false, reason: 'focus-failed', error: err.message, details: focusDetails };
  }
}

function registerWindowFocusIpc() {
  if (ipcMain.listenerCount(WINDOW_FOCUS_CHANNEL) > 0) return;
  ipcMain.handle(WINDOW_FOCUS_CHANNEL, (_event, details) => ensureMainWindowInputFocus(details));
}

function normalizePrintMargins(value, paperSize = '') {
  const normalized = String(value || 'default').trim().toLowerCase();
  const normalizedPaperSize = String(paperSize || '').trim().toUpperCase();
  if (normalizedPaperSize === 'A5') return 'none';
  if (normalized === 'wide') return 'printableArea';
  if (normalized === 'narrow') return 'none';
  return 'default';
}

function resolveSilentPrintPageSize(paperSize, widthMm, heightMm) {
  const normalized = String(paperSize || '').trim();
  const normalizedWidth = Number(widthMm) || 0;
  const normalizedHeight = Number(heightMm) || 0;
  const mm = (value) => Math.max(1000, Math.round(Number(value) * 1000));
  const knownSizes = {
    A3: { width: mm(297), height: mm(420) },
    A4: { width: mm(210), height: mm(297) },
    A5: { width: mm(148), height: mm(210) },
    A6: { width: mm(105), height: mm(148) },
    B5: { width: mm(176), height: mm(250) },
    Letter: { width: mm(215.9), height: mm(279.4) },
    Legal: { width: mm(215.9), height: mm(355.6) },
  };
  const customMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:mm)?$/i);

  if (knownSizes[normalized]) return knownSizes[normalized];
  if (customMatch) return { width: mm(customMatch[1]), height: mm(customMatch[2]) };
  if (normalized === 'K57') return { width: mm(57), height: mm(3276) };
  if (normalized === 'K80' || normalized === '80mm') return { width: mm(80), height: mm(3276) };
  if (normalizedWidth > 0 && normalizedHeight > 0) return { width: mm(normalizedWidth), height: mm(normalizedHeight) };
  if (normalizedWidth > 0 && normalizedWidth <= 90) return { width: mm(normalizedWidth), height: mm(3276) };
  return null;
}

function sanitizePrintPayload(payload = {}) {
  return {
    html: String(payload?.html || ''),
    jobTitle: String(payload?.jobTitle || 'In tài liệu').trim() || 'In tài liệu',
    deviceName: String(payload?.deviceName || '').trim(),
    copies: Math.max(1, Math.min(99, Number(payload?.copies) || 1)),
    layout: String(payload?.layout || 'portrait').trim().toLowerCase() === 'landscape' ? 'landscape' : 'portrait',
    margins: normalizePrintMargins(payload?.margins, payload?.paperSize),
    printBackground: payload?.printBackground !== false,
    showHeadersFooters: Boolean(payload?.showHeadersFooters),
    pageMode: String(payload?.pageMode || 'all').trim().toLowerCase() || 'all',
    paperSize: String(payload?.paperSize || '').trim(),
    widthMm: Number(payload?.widthMm) || 0,
    heightMm: Number(payload?.heightMm) || 0,
  };
}

async function listSystemPrinters() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
    return [];
  }

  const printers = await mainWindow.webContents.getPrintersAsync();
  return (Array.isArray(printers) ? printers : []).map(printer => ({
    name: String(printer?.name || '').trim(),
    displayName: String(printer?.displayName || printer?.description || printer?.name || '').trim(),
    description: String(printer?.description || '').trim(),
    isDefault: Boolean(printer?.isDefault),
    status: Number(printer?.status) || 0,
  })).filter(printer => printer.name);
}

function createSilentPrintWindow() {
  return new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
}

async function printHtmlSilently(payload = {}) {
  const printRequest = sanitizePrintPayload(payload);
  if (!printRequest.html.trim()) throw new Error('Thiếu nội dung HTML để in.');

  const printWindow = createSilentPrintWindow();
  const cleanup = () => {
    if (!printWindow || printWindow.isDestroyed()) return;
    setTimeout(() => {
      try {
        if (!printWindow.isDestroyed()) printWindow.destroy();
      } catch (_) {
        // Ignore cleanup failures.
      }
    }, 150);
  };

  const loadPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    printWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      finishReject(new Error(`Không thể tải nội dung in: ${errorDescription || errorCode || 'unknown'}`));
    });

    printWindow.webContents.once('render-process-gone', (_event, details) => {
      finishReject(new Error(`Tiến trình in đã dừng: ${details?.reason || 'unknown'}`));
    });

    printWindow.webContents.once('did-finish-load', () => {
      try {
        printWindow.webContents.setZoomFactor(1);
      } catch (_) {
        // Ignore zoom reset failures before printing.
      }

      const isA5Paper = String(printRequest.paperSize || '').trim().toUpperCase() === 'A5';
      const printOptions = {
        silent: true,
        printBackground: printRequest.printBackground,
        deviceName: printRequest.deviceName || undefined,
        copies: printRequest.copies,
        landscape: printRequest.layout === 'landscape',
        margins: {
          marginType: isA5Paper ? 'none' : printRequest.margins,
        },
        scaleFactor: 100,
      };

      const pageSize = resolveSilentPrintPageSize(printRequest.paperSize, printRequest.widthMm, printRequest.heightMm);
      if (isA5Paper) {
        printOptions.pageSize = printRequest.layout === 'landscape'
          ? { width: 210000, height: 148000 }
          : { width: 148000, height: 210000 };
      } else if (pageSize) {
        printOptions.pageSize = pageSize;
      }

      printWindow.webContents.print(printOptions, (success, failureReason) => {
        if (!success) {
          finishReject(new Error(failureReason || 'Lệnh in bị từ chối bởi hệ điều hành hoặc máy in.'));
          return;
        }

        finishResolve({
          ok: true,
          silent: true,
          deviceName: printRequest.deviceName || '',
          copies: printRequest.copies,
          paperSize: printRequest.paperSize,
          widthMm: printRequest.widthMm,
          heightMm: printRequest.heightMm,
          pageMode: printRequest.pageMode,
          showHeadersFooters: printRequest.showHeadersFooters,
          jobTitle: printRequest.jobTitle,
        });
      });
    });
  });

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printRequest.html)}`);
  return loadPromise;
}

function registerPrintIpc() {
  if (ipcMain.listenerCount(PRINT_LIST_PRINTERS_CHANNEL) > 0) return;
  ipcMain.handle(PRINT_LIST_PRINTERS_CHANNEL, () => listSystemPrinters());
  ipcMain.handle(PRINT_HTML_CHANNEL, (_event, payload) => printHtmlSilently(payload || {}));
}

function sanitizeExternalUrl(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Thiếu URL cần mở.');
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw new Error('URL không hợp lệ.');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Chỉ cho phép mở link http/https.');
  }
  return parsed.toString();
}

function requestHeadWithRedirects(url, redirectCount = 0) {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(parsed, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'kha-installer-download-check',
        Accept: 'application/octet-stream,*/*;q=0.8',
      },
      timeout: 30000,
    }, (res) => {
      const statusCode = Number(res.statusCode) || 0;
      const location = String(res.headers.location || '').trim();

      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        res.resume();
        if (redirectCount >= 5) {
          reject(new Error('URL tải chuyển hướng quá nhiều lần.'));
          return;
        }
        const nextUrl = new URL(location, parsed).toString();
        requestHeadWithRedirects(nextUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      res.resume();
      resolve({
        statusCode,
        finalUrl: parsed.toString(),
        contentType: String(res.headers['content-type'] || ''),
        contentLength: Number(res.headers['content-length'] || 0) || 0,
      });
    });

    req.on('timeout', () => req.destroy(new Error('Kiểm tra link tải quá thời gian chờ.')));
    req.on('error', reject);
    req.end();
  });
}

async function verifyInstallerDownloadUrl(url) {
  const safeUrl = sanitizeExternalUrl(url);
  const parsed = new URL(safeUrl);
  const expectedFileName = path.basename(parsed.pathname || '');
  if (!/^banhangoffline-setup-v\d+\.\d+\.\d+-(x64|ia32)\.exe$/i.test(expectedFileName)) {
    throw new Error(`Tên file tải không đúng định dạng kiến trúc x64/ia32: ${expectedFileName || safeUrl}`);
  }

  const head = await requestHeadWithRedirects(safeUrl);
  if (head.statusCode < 200 || head.statusCode >= 300) {
    throw new Error(`Link tải trả HTTP ${head.statusCode}.`);
  }
  if (/text\/html|application\/xhtml\+xml/i.test(head.contentType)) {
    throw new Error(`Link tải trả Content-Type HTML (${head.contentType}), có thể đang tải nhầm trang web thay vì installer.`);
  }
  if (head.contentLength > 0 && head.contentLength < MIN_INSTALLER_DOWNLOAD_BYTES) {
    throw new Error(`File tải quá nhỏ (${head.contentLength} bytes), có thể bị rỗng hoặc bị truncate.`);
  }

  return {
    ok: true,
    url: safeUrl,
    finalUrl: head.finalUrl,
    fileName: expectedFileName,
    statusCode: head.statusCode,
    contentType: head.contentType,
    contentLength: head.contentLength,
  };
}

function registerShellIpc() {
  if (ipcMain.listenerCount(OPEN_EXTERNAL_CHANNEL) > 0 || ipcMain.listenerCount(VERIFY_DOWNLOAD_URL_CHANNEL) > 0) return;
  ipcMain.handle(VERIFY_DOWNLOAD_URL_CHANNEL, async (_event, url) => verifyInstallerDownloadUrl(url));
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, url) => {
    const verified = await verifyInstallerDownloadUrl(url);
    await shell.openExternal(verified.url);
    return { ok: true, ...verified };
  });
}

function registerGuardianIpc() {
  if (ipcMain.listenerCount(GUARDIAN_ALERT_CHANNEL) > 0) return;

  // Handle guardian alerts from renderer or backend
  ipcMain.handle(GUARDIAN_ALERT_CHANNEL, (_event, alert) => {
    if (!alert || !mainWindow || mainWindow.isDestroyed()) return { ok: false };
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: `⚠️ KHA Guardian - ${String(alert.severity || 'alert').toUpperCase()}`,
          body: String(alert.message || 'Có cảnh báo từ hệ thống bảo vệ dữ liệu').slice(0, 256),
          icon: getAppIconPath(),
          urgency: alert.severity === 'emergency' ? 'critical' : 'normal',
        });
        notification.show();
      }

      // Show dialog for emergency alerts
      if (alert.severity === 'emergency' || alert.severity === 'critical') {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'KHA Data Guardian - Cảnh báo',
          message: String(alert.message || 'Cảnh báo hệ thống').slice(0, 500),
          detail: [
            `Mức độ: ${alert.severity}`,
            `Module: ${alert.module || 'unknown'}`,
            `Thời gian: ${alert.timestamp || new Date().toISOString()}`,
            `Admin: Văn Kha - 0904045075`,
          ].join('\n'),
          buttons: ['Đã hiểu'],
        }).catch(() => {});
      }

      return { ok: true };
    } catch (err) {
      console.error('[KHA Electron] Guardian alert error:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // Handle guardian status queries
  ipcMain.handle(GUARDIAN_STATUS_CHANNEL, async () => {
    if (!backendApiBase) return { ok: false, reason: 'backend-not-ready' };
    try {
      const status = await requestJson(`${backendApiBase}/data-guardian/status`, 5000);
      return { ok: true, ...status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

function getAppIconPath() {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(__dirname, '..', 'build', 'icons');
  if (process.platform === 'win32') {
    return path.join(base, 'app-icon.ico');
  }
  return path.join(base, 'app-icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    updateManager?.scheduleStartupCheck();
  });

  // === FIX: Chặn mở cửa sổ Electron mới khi frontend gọi window.open() ===
  // Trước đây thiếu handler nên mỗi window.open() tạo một BrowserWindow mới.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }
    try {
      const parsed = new URL(url, 'file://');
      const routePath = (parsed.pathname || '') + (parsed.search || '');
      const safeRoute = routePath.replace(/\\/g, '/').replace(/'/g, "\\'");
      mainWindow.webContents.executeJavaScript(
        "window.location.hash = '#" + safeRoute + "';"
      ).catch(() => {});
    } catch (_) {}
    return { action: 'deny' };
  });

  // Chặn điều hướng ra ngoài app; link ngoài mở bằng trình duyệt hệ thống.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    const appOrigin = current.split('#')[0];
    if (url.split('#')[0] === appOrigin) return; // điều hướng hash nội bộ -> cho phép
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  });

  if (!app.isPackaged && process.env.ELECTRON_DEV_URL) {
    mainWindow.loadURL(process.env.ELECTRON_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// === FIX: Ch? cho ph?p 1 instance app ch?y; m? l?n 2 s? focus c?a s? c? ===
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  registerBackendIpc();
  registerWindowFocusIpc();
  registerPrintIpc();
  registerShellIpc();
  registerGuardianIpc();
  updateManager = createUpdateManager({ app, getMainWindow: () => mainWindow });
  updateManager.registerIpc(ipcMain);

  // KHA FIX 2.3.3: hiển thị màn hình "Đang khởi động backend..." ngay lập tức thay vì trắng màn hình.
  let mainReady = false;
  showBackendStartupWindow();
  try {
    await startBackend();
  } catch (err) {
    closeBackendStartupWindow();
    quitAfterBackendFatalError('Không thể khởi động backend nội bộ', err);
    return;
  }
  // Tạo cửa sổ chính TRƯỚC khi đóng splash, tránh window-all-closed -> app.quit() race.
  createWindow();
  mainReady = true;
  closeBackendStartupWindow();
  void upgradeShortcuts(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// PHẦN 13: log lỗi electron main process, không crash trắng màn đỏ
process.on('unhandledRejection', (reason) => { electronLogger.error('unhandledRejection', { message: reason && reason.message ? reason.message : String(reason) }); });
process.on('uncaughtException', (err) => { electronLogger.error('uncaughtException', { message: err && err.message, stack: err && err.stack }); });
electronLogger.info('Electron main logger initialized', { logFile: electronLogger.LOG_FILE });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  closeBackendStartupWindow();
  stopBackend();
  closeBackendFileLogStream();
});

