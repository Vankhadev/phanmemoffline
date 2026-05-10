import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.VITE_BACKEND_PORT || process.env.PHANMEM_PORT || process.env.KHA_BACKEND_PORT || '3001'
const backendHost = process.env.VITE_BACKEND_HOST || process.env.PHANMEM_BACKEND_HOST || process.env.KHA_BACKEND_TARGET_HOST || '127.0.0.1'
const devHost = process.env.VITE_DEV_HOST || process.env.PHANMEM_FRONTEND_HOST || process.env.PHANMEM_HOST || undefined

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: devHost,
    port: Number(process.env.VITE_DEV_PORT || 5173),
    proxy: {
      '/api': {
        target: `http://${backendHost}:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
