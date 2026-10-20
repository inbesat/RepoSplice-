// P-235 — the static route of `stitch serve`: hashed assets with the right
// cache policy, the SPA fallback for client routes, the API winning over the
// fallback, the build banner, and the friendly page when there is no build.
//
// TRANSPORT NOTE: the tests drive the same route table through `app.handle`
// (Elysia's WebStandard adapter cannot listen under vitest — the P-043 note),
// so what is asserted here is exactly what `stitch serve` answers.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { buildHashOf } from './static.js';

const created: string[] = [];

/** A throwaway build directory holding the given files. */
function makeDist(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-static-'));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('static serving (P-235)', () => {
  it('serves hashed asset cached', async () => {
    const script = 'console.log("stitch");\n';
    const dist = makeDist({
      'assets/index-AbCd1234.js': script,
      'assets/index-AbCd1234.js.gz': gzipSync(Buffer.from(script)),
    });
    const app = createApp({ webDist: dist });

    const plain = await app.handle(new Request('http://localhost:3434/assets/index-AbCd1234.js'));
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    // A hashed name means the bytes never change under it.
    expect(plain.headers.get('cache-control')).toContain('immutable');
    expect(await plain.text()).toBe(script);

    const zipped = await app.handle(
      new Request('http://localhost:3434/assets/index-AbCd1234.js', {
        headers: { 'accept-encoding': 'gzip' },
      })
    );
    expect(zipped.status).toBe(200);
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    expect(zipped.headers.get('vary')).toContain('accept-encoding');
    const bytes = Buffer.from(await zipped.arrayBuffer());
    expect(bytes.equals(gzipSync(Buffer.from(script)))).toBe(true);
  });

  it('spa fallback', async () => {
    const dist = makeDist({
      'index.html':
        '<!doctype html><html><head><title>stitch</title></head><body><div id="root"></div></body></html>',
    });
    const app = createApp({ webDist: dist });

    // A client-side route resolves to the shell on a direct navigation.
    const res = await app.handle(new Request('http://localhost:3434/review'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toContain('<div id="root">');
    expect(body).toContain('stitch-build');
  });

  it('api before fallback', async () => {
    const dist = makeDist({
      'index.html': '<!doctype html><html><body>shell</body></html>',
    });
    const app = createApp({ webDist: dist, data: { settings: () => ({ theme: 'dark' }) } });

    const res = await app.handle(new Request('http://localhost:3434/api/settings'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ theme: 'dark' });

    // An API path no route claimed answers JSON — never the SPA shell.
    const missing = await app.handle(new Request('http://localhost:3434/api/nope'));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    expect(await missing.text()).not.toContain('shell');
  });

  it('build banner', async () => {
    const dist = makeDist({
      'index.html': '<!doctype html><html><head></head><body>shell</body></html>',
    });
    const app = createApp({ webDist: dist });

    const res = await app.handle(new Request('http://localhost:3434/'));
    expect(res.status).toBe(200);
    const banner = res.headers.get('x-stitch-build');
    expect(banner).toBeTruthy();
    expect(banner).toBe(buildHashOf(dist));
    // The banner is in the served shell too, so the page can report it.
    expect(await res.text()).toContain(`content="${banner ?? ''}"`);
  });

  it('missing dist fallback', async () => {
    const dist = join(tmpdir(), 'stitch-build-that-does-not-exist');
    const app = createApp({ webDist: dist });

    const res = await app.handle(new Request('http://localhost:3434/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('stitch serve');
    expect(body).toContain('build');
  });
});
