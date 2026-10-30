import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@overscan/types': path.resolve(__dirname, '../types/src/index.ts'),
      '@overscan/core/browser': path.resolve(__dirname, '../core/src/browser.ts'),
      '@overscan/nodes/browser': path.resolve(__dirname, '../nodes/src/browser.ts'),
      '@overscan/sequencer': path.resolve(__dirname, '../sequencer/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
