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
    // 127.0.0.1 pinned (P-208): `serve` binds IPv4 loopback, and `localhost`
    // can resolve to ::1 first — a proxy that connects nowhere on such hosts.
    proxy: {
      '/api': 'http://127.0.0.1:3434',
      '/ws': { target: 'ws://127.0.0.1:3434', ws: true },
    },
  },
  build: {
    // P-235 serves this dir from the CLI; keep the default `dist` name.
    outDir: 'dist',
    sourcemap: true,
  },
});
