import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@overscan/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@overscan/core/browser': path.resolve(__dirname, '../../packages/core/src/browser.ts'),
      '@overscan/nodes/browser': path.resolve(__dirname, '../../packages/nodes/src/browser.ts'),
      '@overscan/sink-browser': path.resolve(__dirname, '../../packages/sink-browser/src/index.ts'),
      '@overscan/sink-terminal': path.resolve(__dirname, '../../packages/sink-terminal/src/index.ts'),
      '@overscan/terminal-renderers': path.resolve(__dirname, '../../packages/sink-terminal/src/renderers/index.ts'),
      // Pure cell sampler shared with the terminal player (the package index pulls in Node-only sixel output).
      '@overscan/terminal-cells': path.resolve(__dirname, '../../packages/sink-terminal/src/ascii-cell.ts'),
      '@overscan/sequencer': path.resolve(__dirname, '../../packages/sequencer/src/index.ts'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  optimizeDeps: {
    exclude: [
      '@overscan/core/browser',
      '@overscan/nodes/browser',
      '@overscan/terminal-renderers',
      '@overscan/sequencer',
    ],
  },
})
