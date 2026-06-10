import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installAuthenticatedFetch } from './utils/apiClient'
import { installCrossTabSyncBridge } from './utils/crossTabSync'
import { installElectronInputFocusGuard } from './utils/electronFocusGuard'
import { installNativeRuntimeGuards, isNativeAppRuntime } from './utils/mobileAppRuntime'
import './index.css'

const nativeRuntime = isNativeAppRuntime()
installNativeRuntimeGuards()
installAuthenticatedFetch()
installCrossTabSyncBridge()
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
