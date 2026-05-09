const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const { createUpdateManager } = require('./updater');

const BACKEND_PORT = Number(process.env.PORT || 3001);
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
