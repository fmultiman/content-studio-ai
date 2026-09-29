import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'components/**/*.test.tsx'],
    environment: 'node',
    // Route tests import server modules lazily (MCP SDK, storage); the first import can exceed the 5 s
    // default on a loaded machine without indicating a real failure.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
