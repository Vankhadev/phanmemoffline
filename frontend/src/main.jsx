import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { installAuthenticatedFetch } from './utils/apiClient'
import { installElectronInputFocusGuard } from './utils/electronFocusGuard'
import './index.css'

installAuthenticatedFetch()
installElectronInputFocusGuard()

function isAppShellApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function collectCurrentAppShellUrls() {
  const urls = new Set()
  const addUrl = (value) => {
    try {
      const url = new URL(value, window.location.href)
      if (url.origin !== window.location.origin || isAppShellApiPath(url.pathname)) return
      url.hash = ''
      urls.add(url.toString())
    } catch (_) {
      // Bỏ qua URL không hợp lệ.
    }
  }

  addUrl(window.location.href)
  addUrl(import.meta.env.BASE_URL || './')
  addUrl('index.html')
  addUrl('manifest.webmanifest')

  const performanceEntries = typeof performance?.getEntriesByType === 'function'
    ? performance.getEntriesByType('resource')
    : []
  performanceEntries.forEach(entry => addUrl(entry.name))
  document.querySelectorAll('link[href], script[src], img[src]').forEach(element => {
    addUrl(element.href || element.src)
  })

  return Array.from(urls)
}

function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  if (!window.location.protocol.startsWith('http')) return

  window.addEventListener('load', () => {
    const baseUrl = import.meta.env.BASE_URL || './'
    const swUrl = new URL('sw.js', new URL(baseUrl, window.location.href)).toString()

    navigator.serviceWorker.register(swUrl).then((registration) => {
      navigator.serviceWorker.ready.then(() => {
        const worker = registration.active || navigator.serviceWorker.controller
        worker?.postMessage({
          type: 'KHA_PWA_CACHE_URLS',
          urls: collectCurrentAppShellUrls(),
        })
      }).catch(() => {})
    }).catch((error) => {
      console.warn('Không thể đăng ký service worker PWA:', error)
    })
  })
}

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
