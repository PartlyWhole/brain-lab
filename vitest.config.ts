import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/semantics/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'src/**/*.test.ts',
      'content/**/*.test.ts',
    ],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
