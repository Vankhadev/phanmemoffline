const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { createUpdateManager } = require('./updater');

const DEFAULT_BACKEND_PORT = Number(process.env.PORT || process.env.KHA_BACKEND_PORT || process.env.PHANMEM_PORT || 3001);
const BACKEND_HOST = String(process.env.KHA_BACKEND_HOST || process.env.PHANMEM_HOST || process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
const BACKEND_API_BASE_CHANNEL = 'kha:backend:get-api-base';
const BACKEND_INFO_CHANNEL = 'kha:backend:get-info';
const WINDOW_FOCUS_CHANNEL = 'kha:window:ensure-input-focus';
const APP_USER_MODEL_ID = 'com.vankhammo.phanmienoffline';

let mainWindow = null;
let backendProcess = null;
let backendPort = null;
let backendApiBase = '';
let backendHealth = null;
let updateManager = null;
let backendIpcRegistered = false;
const backendInstanceId = randomUUID();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeStartPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 3001;
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

async function waitForBackendHealth({ apiBase, expectedInstanceId, expectedPid, timeoutMs = 15000 }) {
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
      lastError = new Error(`Unexpected backend health response at ${healthUrl}`);
    } catch (err) {
      lastError = err;
    }

    await sleep(250);
  }

  throw new Error(`Backend did not become healthy at ${healthUrl}: ${lastError?.message || 'timeout'}`);
}

function getBackendEntryPath() {
  return path.join(__dirname, '..', 'backend', 'src', 'server.js');
}

function getBackendCwd() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
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
  try {
    if (!child.killed) child.kill();
  } catch (err) {
    console.warn('[KHA Electron] Cannot stop backend process:', err.message);
  }
}

async function startBackend() {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'phanmienoffline.db.json');
  const port = await findAvailablePort(DEFAULT_BACKEND_PORT, BACKEND_HOST);
  const apiBase = `http://${getBackendClientHost(BACKEND_HOST)}:${port}/api`;
  const backendEntry = getBackendEntryPath();

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

  const child = spawn(process.execPath, [backendEntry], {
    cwd: getBackendCwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess = child;
  pipeBackendLog(child.stdout, message => console.log(message));
  pipeBackendLog(child.stderr, message => console.error(message));

  child.once('error', err => {
    console.error('[KHA Electron] Backend process error:', err);
  });

  child.once('exit', (code, signal) => {
    if (backendProcess === child) {
      backendProcess = null;
      backendHealth = null;
    }
    if (!app.isQuitting) {
      console.warn(`[KHA Electron] Backend process exited (code=${code}, signal=${signal || 'none'})`);
    }
  });

  try {
    backendHealth = await Promise.race([
      waitForBackendHealth({ apiBase, expectedInstanceId: backendInstanceId, expectedPid: child.pid }),
      new Promise((_, reject) => child.once('error', reject)),
    ]);
    console.log(`[KHA Electron] Backend ready at ${backendApiBase} (pid=${child.pid})`);
  } catch (err) {
    stopBackend();
    backendPort = null;
    backendApiBase = '';
    throw err;
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

function getAppIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons', 'app-icon.png');
  }
  return path.join(__dirname, '..', 'build', 'icon.png');
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

  if (!app.isPackaged && process.env.ELECTRON_DEV_URL) {
    mainWindow.loadURL(process.env.ELECTRON_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

app.whenReady().then(async () => {
  registerBackendIpc();
  registerWindowFocusIpc();
  updateManager = createUpdateManager({ app, getMainWindow: () => mainWindow });
  updateManager.registerIpc(ipcMain);

  try {
    await startBackend();
  } catch (err) {
    console.error('[KHA Electron] Cannot start backend:', err);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopBackend();
});
