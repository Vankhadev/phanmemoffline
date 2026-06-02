import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.VITE_BACKEND_PORT || process.env.PHANMEM_PORT || process.env.KHA_BACKEND_PORT || '3001'
const backendHost = process.env.VITE_BACKEND_HOST || process.env.PHANMEM_BACKEND_HOST || process.env.KHA_BACKEND_TARGET_HOST || '127.0.0.1'
const devHost = process.env.VITE_DEV_HOST || process.env.PHANMEM_FRONTEND_HOST || process.env.PHANMEM_HOST || '127.0.0.1'
const devPort = Number(process.env.VITE_DEV_PORT || process.env.PHANMEM_FRONTEND_PORT || '5174')
const strictPort = String(process.env.VITE_STRICT_PORT || 'true').trim().toLowerCase() !== 'false'

export default defineConfig({
  plugins: [react()],
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
