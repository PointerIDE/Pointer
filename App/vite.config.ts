import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// API configuration from environment variables
const API_PORT = process.env.VITE_API_URL?.match(/:(\d+)$/)?.[1] || '23816'
const API_HOST = process.env.VITE_API_URL ? new URL(process.env.VITE_API_URL).host : 'http://127.0.0.1:23816'
const DEV_PORT = parseInt(process.env.VITE_DEV_SERVER_PORT || '3000', 10)

// Dynamic chunk strategy: AGGRESSIVE splitting to avoid >2MB chunks
function generateManualChunks(id: string) {
  // Monaco editor: split EVERY worker separately + core + languages
  if (id.includes('monaco-editor')) {
    // Workers - load on demand only
    if (id.includes('json.worker')) return 'monaco-json-worker';
    if (id.includes('css.worker')) return 'monaco-css-worker';
    if (id.includes('html.worker')) return 'monaco-html-worker';
    if (id.includes('typescript')) return 'monaco-ts-worker';
    if (id.includes('editor.worker') || id.includes('editor/editor.main')) return 'monaco-editor-main';
    
    // Language support modules (split to avoid huge main)
    if (id.match(/monaco.*language|language.*json|language.*css|language.*html|language.*typescript/)) {
      return 'monaco-languages';
    }
    
    // Core Monaco lib
    return 'monaco-core-lib';
  }

  // Separate vendor chunks by functional domain
  if (id.includes('node_modules')) {
    // React core ecosystem - split base from DOM
    if (id.includes('node_modules/react') && !id.includes('react-')) {
      return 'vendor-react-core';
    }
    if (id.includes('node_modules/react-dom')) {
      return 'vendor-react-dom';
    }
    
    // Heavy markdown/documentation libraries 
    if (/remark|rehype|markdown|micromark/.test(id)) {
      return 'vendor-markdown';
    }
    
    // Terminal emulation - very heavy, needs its own chunk
    if (/@xterm|xterm\/lib/.test(id)) {
      return 'vendor-xterm';
    }
    
    // Syntax highlighting
    if (/syntax-highlighter|highlight\.js|prism/.test(id)) {
      return 'vendor-highlight';
    }
    
    // Math/KaTeX rendering
    if (/katex|mathjax|math/.test(id)) {
      return 'vendor-math';
    }
    
    // Emoji support
    if (/emoji|remark-emoji/.test(id)) {
      return 'vendor-emoji';
    }
    
    // OpenAI & API clients
    if (/openai|ai\//.test(id)) {
      return 'vendor-openai';
    }
    
    // Discord Rich Presence
    if (/discord/.test(id)) {
      return 'vendor-discord';
    }
    
    // Small utilities bundle (commonly needed)
    if (/zustand|uuid|chalk/.test(id)) {
      return 'vendor-utils-core';
    }
    
    // Diff utilities
    if (/diff\//.test(id)) {
      return 'vendor-diff';
    }
    
    // TinyColor
    if (/tinycolor/.test(id)) {
      return 'vendor-color';
    }
    
    // Catch remaining vendors
    return 'vendor-common';
  }

  return undefined;
}

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? './' : '/',
  ssr: {
    noExternal: ['monaco-editor']
  },
  define: {
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || 'http://localhost:23816'),
    __DEV_PORT__: JSON.stringify(DEV_PORT),
  },
  server: {
    port: DEV_PORT,
    strictPort: false,
    host: true, // needed for Electron
    fs: {
      strict: false,
      allow: ['..']
    },
    proxy: {
      '/execute-command': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/read-file': {
        target: `http://127.0.0.1:${API_PORT}`,
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
        target: `http://127.0.0.1:${API_PORT}`,
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
    sourcemap: process.env.NODE_ENV === 'production' ? false : 'inline',
    // Rollup configuration for better code splitting
    rollupOptions: {
      output: {
        // Aggressive manual chunk splitting
        manualChunks: generateManualChunks,
        // Optimize chunk file names for caching
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop() : 'chunk';
          return 'js/[name]-[hash].js';
        },
        entryFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          if (/png|jpe?g|gif|svg|webp|ico|woff2?|eot|ttf|otf/.test(ext)) {
            return `assets/[name]-[hash][extname]`;
          } else if (ext === 'css') {
            return `css/[name]-[hash].css`;
          }
          return `assets/[name]-[hash][extname]`;
        }
      },
    },
    // Chunk size threshold: warn if > 3MB (before optimization we had 4.7MB TS worker)
    chunkSizeWarningLimit: 3072,
    // Enable minification for production with aggressive compression
    minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
    // Terser minification options for maximum compression
    terserOptions: process.env.NODE_ENV === 'production' ? {
      compress: {
        drop_console: false,  // Keep console for debugging in production
        drop_debugger: true,
        passes: 2,  // Multiple optimization passes
        pure_funcs: null
      },
      mangle: {
        properties: false
      },
      format: {
        comments: false
      }
    } : undefined,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})