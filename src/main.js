const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const { createUpdateManager } = require('./updater');

const BACKEND_PORT = Number(process.env.PORT || 3001);
const WINDOW_FOCUS_CHANNEL = 'kha:window:ensure-input-focus';
let mainWindow = null;
let backendServer = null;
let updateManager = null;

function waitForPort(port, host = '127.0.0.1', timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const socket = net.connect(port, host, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Backend did not start on ${host}:${port}`));
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });
}

async function startBackend() {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'phanmienoffline.db.json');

  process.env.PORT = String(BACKEND_PORT);
  process.env.KHA_DB_PATH = dbPath;
  process.env.ELECTRON_USER_DATA = userData;
  delete process.env.KHA_DB_SEED_PATH;

  const serverModule = require(path.join(__dirname, '..', 'backend', 'src', 'server.js'));
  backendServer = serverModule && serverModule.server ? serverModule.server : null;
  await waitForPort(BACKEND_PORT);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
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

app.whenReady().then(async () => {
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
  if (backendServer && typeof backendServer.close === 'function') backendServer.close();
});
