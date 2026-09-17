import { defineConfig, devices } from '@playwright/test'

/**
 * Browser journeys run against the PRODUCTION build served at a repository
 * subpath, not against the dev server. The things that break in practice —
 * base-path assets, the worker, the wasm runtime, deep links — only break in
 * that configuration, so that is the one the journeys use.
 */
const BASE = process.env.VITE_BASE ?? '/robot-brain-lab/'
const PORT = 4179

export default defineConfig({
  testDir: './tests/browser',
  // Booting a Python runtime per journey is genuinely slow; these are not
  // flaky-timeout numbers, they are the real cost of running CPython in wasm.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && node scripts/serve-subpath.mjs --base ${BASE} --port ${PORT}`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_BASE: BASE },
  },
})
