import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    // Built JS/CSS go to dist/static/, NOT Vite's default dist/assets/: the
    // app has a client route /assets (the Asset Library), and a static host
    // resolves real files/directories before its SPA fallback to index.html.
    // With dist/assets/ present, refreshing /assets made Vercel serve a
    // vendor chunk from that directory instead of the app. Keep this name
    // clear of every top-level route (src/app/deepLinkRoutes.test.ts).
    assetsDir: 'static',
  },

  optimizeDeps: {
    include: ['tldraw'],
    // ORT ships its own WASM loader; let it be served as emitted assets rather
    // than pre-bundled by esbuild.
    exclude: ['onnxruntime-web'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },

  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
