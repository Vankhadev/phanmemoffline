import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function hasUnresolvedEnvToken(value) {
  return /(%[A-Z0-9_]+%|\$\{?[A-Z0-9_]+\}?)/i.test(String(value || ''))
}

function readEnvText(value, fallback = '') {
  const text = String(value || '').trim()
  if (!text || hasUnresolvedEnvToken(text)) return fallback
  return text
}

function readPortValue(value, fallback = '') {
  const text = readEnvText(value)
  if (!/^\d+$/.test(text)) return fallback
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback
  return String(port)
}

const backendPort = readPortValue(process.env.VITE_BACKEND_PORT)
  || readPortValue(process.env.PHANMEM_PORT)
  || readPortValue(process.env.KHA_BACKEND_PORT)
  || '3001'
const backendHost = readEnvText(process.env.VITE_BACKEND_HOST)
  || readEnvText(process.env.PHANMEM_BACKEND_HOST)
  || readEnvText(process.env.KHA_BACKEND_TARGET_HOST)
  || '127.0.0.1'
const devHost = readEnvText(process.env.VITE_DEV_HOST)
  || readEnvText(process.env.PHANMEM_FRONTEND_HOST)
  || readEnvText(process.env.PHANMEM_HOST)
  || '127.0.0.1'
const devPort = Number(readPortValue(process.env.VITE_DEV_PORT) || readPortValue(process.env.PHANMEM_FRONTEND_PORT) || '5174')
const strictPort = String(process.env.VITE_STRICT_PORT || 'true').trim().toLowerCase() !== 'false'
const configDir = path.dirname(fileURLToPath(import.meta.url))

function apkDownloadHeaders(fileName) {
  return {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
}

function serveApkDownloads() {
  return {
    name: 'serve-apk-downloads',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (!url.pathname.endsWith('.apk')) return next()

        const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
        const downloadsDir = path.resolve(configDir, 'public', 'downloads')
        const apkPath = path.resolve(configDir, 'public', requestedPath)

        if (!apkPath.startsWith(`${downloadsDir}${path.sep}`) || !fs.existsSync(apkPath)) {
          return next()
        }

        const stat = fs.statSync(apkPath)
        Object.entries(apkDownloadHeaders(path.basename(apkPath))).forEach(([key, value]) => res.setHeader(key, value))
        res.setHeader('Content-Length', stat.size)
        if (req.method === 'HEAD') return res.end()
        fs.createReadStream(apkPath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [serveApkDownloads(), react()],
  base: './',
  server: {
    host: devHost,
    port: devPort,
    strictPort,
    proxy: {
      '/api': {
        target: `http://${backendHost}:${backendPort}`,
        changeOrigin: true,
      },
      '/static': {
        target: `http://${backendHost}:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules[\\/](react|react-dom|react-router-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
          if (/node_modules[\\/]xlsx[\\/]/.test(id)) return 'xlsx-vendor'
          if (/node_modules[\\/](recharts|d3-[^\\/]+)[\\/]/.test(id)) return 'charts-vendor'
          if (/node_modules[\\/]lucide-react[\\/]/.test(id)) return 'icons-vendor'
          return undefined
        },
      },
    },
  },
})
