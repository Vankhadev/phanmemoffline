import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installAuthenticatedFetch, probeBackendHealth } from './utils/apiClient'
import { installCrossTabSyncBridge, startAuthenticatedRealtimeSync } from './utils/crossTabSync'
import { installElectronInputFocusGuard } from './utils/electronFocusGuard'
import { installNativeRuntimeGuards, isNativeAppRuntime } from './utils/mobileAppRuntime'
import './index.css'

const nativeRuntime = isNativeAppRuntime()
installNativeRuntimeGuards()
installAuthenticatedFetch()

// KHA: Trong browser dev (khong co Electron apiBase), tu probe /api/health tren cac port
// de tim backend dang chay (co the la 7000/7001/.../7100). Luu vao localStorage kha_backend_base_url.
// Trong Electron thi window.khaDesktop.apiBase da co san -> probe bo qua nhanh.
if (!nativeRuntime && typeof window !== 'undefined' && !(window.khaDesktop?.apiBase || window.electronAPI?.apiBase)) {
  void probeBackendHealth({ host: '127.0.0.1' }).catch(() => {});
}

installCrossTabSyncBridge()
if (typeof window !== 'undefined') {
  window.addEventListener('kha-authenticated', startAuthenticatedRealtimeSync)
}
installElectronInputFocusGuard()

if (!nativeRuntime && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
