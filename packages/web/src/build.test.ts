import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

describe('vite build (P-048)', () => {
  it('builds', async () => {
    // Drive the real packages/web/vite.config.ts (root resolution) through
    // vite's Node API: proves the React plugin, entry, and outDir end to
    // end. dist/ is gitignored; removed afterwards to keep the tree clean.
    const root = resolve(import.meta.dirname, '..');
    await build({ root, logLevel: 'warn' });
    try {
      const htmlPath = resolve(root, 'dist', 'index.html');
      expect(existsSync(htmlPath)).toBe(true);
      const html = readFileSync(htmlPath, 'utf8');
      expect(html).toContain('<div id="root">');
      expect(html).toContain('/assets/');
    } finally {
      rmSync(resolve(root, 'dist'), { recursive: true, force: true });
    }
  }, 120000);
});
