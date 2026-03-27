import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? './' : '/',
  server: {
    port: parseInt(process.env.VITE_PORT || '3000', 10),
    strictPort: false,
    host: true, // needed for Electron
    fs: {
      strict: false,
      allow: ['..']
    },
    proxy: {
      '/execute-command': {
        target: 'http://127.0.0.1:23816',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/read-file': {
        target: 'http://127.0.0.1:23816',
        changeOrigin: true,
        secure: false,
      },
      '/read-settings-files': {
        target: 'http://127.0.0.1:23816',
        changeOrigin: true,
        secure: false,
      },
      '/save-settings-files': {
        target: 'http://127.0.0.1:23816',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://127.0.0.1:23816',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'http://127.0.0.1:23816',
        changeOrigin: true,
        secure: false,
        ws: true,
      }
    }
  },
  optimizeDeps: {
    include: ['monaco-editor'],
    exclude: ['electron']
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          jsonWorker: ['monaco-editor/esm/vs/language/json/json.worker'],
          cssWorker: ['monaco-editor/esm/vs/language/css/css.worker'],
          htmlWorker: ['monaco-editor/esm/vs/language/html/html.worker'],
          tsWorker: ['monaco-editor/esm/vs/language/typescript/ts.worker'],
          editorWorker: ['monaco-editor/esm/vs/editor/editor.worker'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
}) 