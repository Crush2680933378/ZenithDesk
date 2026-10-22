import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' —— Electron 用 file:// 载入 dist/index.html，绝对路径会 404
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
})
