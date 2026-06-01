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
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'react-vendor'
          if (id.includes('xlsx')) return 'xlsx-vendor'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts-vendor'
          if (id.includes('lucide-react')) return 'icons-vendor'
          return 'vendor'
        },
      },
    },
  },
})
