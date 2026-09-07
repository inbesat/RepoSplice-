import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@repo-stitcher/core': resolve(root, '../core/src'),
      '@repo-stitcher/web': resolve(root, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // P-193 `stitch serve` backend; /ws upgrades to the WS event stream (P-241).
    proxy: {
      '/api': 'http://localhost:3434',
      '/ws': { target: 'ws://localhost:3434', ws: true },
    },
  },
  build: {
    // P-235 serves this dir from the CLI; keep the default `dist` name.
    outDir: 'dist',
    sourcemap: true,
  },
});
