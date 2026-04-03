import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: path.resolve(__dirname),
  resolve: {
    alias: {
      '@overscan/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@overscan/text': path.resolve(__dirname, '../../packages/text/src/index.ts'),
      '@overscan/core/browser': path.resolve(__dirname, '../../packages/core/src/browser.ts'),
      '@overscan/nodes/generators/plasma': path.resolve(__dirname, '../../packages/nodes/src/generators/plasma/index.ts'),
      '@overscan/nodes/browser': path.resolve(__dirname, '../../packages/nodes/src/browser.ts'),
      '@overscan/sink-browser': path.resolve(__dirname, '../../packages/sink-browser/src/index.ts'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  optimizeDeps: {
    exclude: ['@overscan/core/browser', '@overscan/nodes/generators/plasma', '@overscan/nodes/browser'],
  },
})
