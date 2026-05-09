const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_STATUS_CHANNEL = 'kha:update:status';

contextBridge.exposeInMainWorld('khaDesktop', {
  platform: process.platform,
  isElectron: true,
  apiBase: 'http://localhost:3001/api',
  getAppInfo: () => ipcRenderer.invoke('kha:app:get-info'),
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
});
