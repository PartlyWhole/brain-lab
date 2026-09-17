import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `VITE_BASE` sets the deployment base path. A GitHub *project* site lives at
 * https://OWNER.github.io/REPOSITORY/, so every asset, worker and runtime URL
 * has to be prefixed. A user/organisation site uses '/'. The Pages workflow
 * sets this from the repository name; local dev and preview default to '/'.
 */
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  worker: {
    // The Python worker uses dynamic import for the self-hosted runtime.
    format: 'es',
  },
  build: {
    // Two independent pages: the lesson app, and the one-screen sandbox.
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        sandbox: fileURLToPath(new URL('./sandbox.html', import.meta.url)),
      },
    },
    target: 'es2022',
    sourcemap: true,
    // The Pyodide wasm/stdlib are copied as-is from public/; only app code is
    // chunked here.
    chunkSizeWarningLimit: 900,
  },
  define: {
    __APP_BUILD__: JSON.stringify({
      commit: process.env.GITHUB_SHA?.slice(0, 7) ?? 'local',
      builtAt: new Date().toISOString(),
    }),
  },
})
