import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installAuthenticatedFetch } from './utils/apiClient'
import { installCrossTabSyncBridge } from './utils/crossTabSync'
import { installElectronInputFocusGuard } from './utils/electronFocusGuard'
import './index.css'

installAuthenticatedFetch()
installCrossTabSyncBridge()
installElectronInputFocusGuard()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
