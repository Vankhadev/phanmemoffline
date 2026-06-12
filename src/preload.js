const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_STATUS_CHANNEL = 'kha:update:status';
const WINDOW_FOCUS_CHANNEL = 'kha:window:ensure-input-focus';
const BACKEND_API_BASE_CHANNEL = 'kha:backend:get-api-base';
const BACKEND_INFO_CHANNEL = 'kha:backend:get-info';
const PRINT_LIST_PRINTERS_CHANNEL = 'kha:print:list-printers';
const PRINT_HTML_CHANNEL = 'kha:print:html';
const OPEN_EXTERNAL_CHANNEL = 'kha:shell:open-external';
const VERIFY_DOWNLOAD_URL_CHANNEL = 'kha:shell:verify-download-url';

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function readRuntimeApiBase() {
  try {
    return stripTrailingSlash(ipcRenderer.sendSync(BACKEND_API_BASE_CHANNEL));
  } catch (err) {
    console.warn('[KHA Preload] Cannot read backend API base from main process:', err.message);
    return '';
  }
}

const runtimeApiBase = readRuntimeApiBase();

const desktopApi = {
  platform: process.platform,
  arch: process.arch,
  isElectron: true,
  apiBase: runtimeApiBase,
  getApiBase: () => ipcRenderer.invoke(BACKEND_API_BASE_CHANNEL).then(stripTrailingSlash),
  getBackendInfo: () => ipcRenderer.invoke(BACKEND_INFO_CHANNEL),
  getAppInfo: () => ipcRenderer.invoke('kha:app:get-info'),
  openExternal: (url) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  verifyDownloadUrl: (url) => ipcRenderer.invoke(VERIFY_DOWNLOAD_URL_CHANNEL, url),
  window: {
    ensureInputFocus: (details = {}) => ipcRenderer.invoke(WINDOW_FOCUS_CHANNEL, details),
  },
  print: {
    listPrinters: () => ipcRenderer.invoke(PRINT_LIST_PRINTERS_CHANNEL),
    printHtml: (payload = {}) => ipcRenderer.invoke(PRINT_HTML_CHANNEL, payload),
  },
  updates: {
    getState: () => ipcRenderer.invoke('kha:update:get-state'),
    check: (options = {}) => ipcRenderer.invoke('kha:update:check', {
      silent: Boolean(options.silent),
      manual: options.manual !== false,
    }),
    download: () => ipcRenderer.invoke('kha:update:download'),
    cancel: () => ipcRenderer.invoke('kha:update:cancel'),
    install: () => ipcRenderer.invoke('kha:update:install'),
    onStatus: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(UPDATE_STATUS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(UPDATE_STATUS_CHANNEL, listener);
    },
  },
  onShortcutUpdated: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('kha-shortcut-updated-toast', listener);
    return () => ipcRenderer.removeListener('kha-shortcut-updated-toast', listener);
  },
};

contextBridge.exposeInMainWorld('khaDesktop', desktopApi);
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  apiBase: runtimeApiBase,
  getApiBase: desktopApi.getApiBase,
  getBackendInfo: desktopApi.getBackendInfo,
  print: desktopApi.print,
});
