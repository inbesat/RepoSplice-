// P-235 — static hosting of the built web app (packages/web/dist, built by
// vite in P-208) plus the SPA fallback, the cache rules, and the build
// banner.
//
// WHY A SEPARATE MODULE: `stitch serve` must answer three kinds of request
// on ONE origin — the API (`/api/*`), the websocket (`/ws`), and the web
// app itself (assets + client-side routes). The API/WS routes are registered
// first (see app.ts), so this module only ever sees what fell through:
//   1. an API path  -> 404 JSON (never the SPA shell — a missing API route
//      must not look like a successful HTML page),
//   2. a real file  -> the file, with its MIME type, cache policy, the
//      build banner, and a precompressed variant when one exists,
//   3. anything else -> index.html (the SPA fallback: a client route such
//      as /review resolves on a direct navigation).
// When there is no build at all, the friendly build-first page is served.
//
// TRANSPORT NOTE: the handler is written against a tiny structural context
// (not Elysia's own generics) so it stays a leaf module — Elysia's
// chained-builder generics are not assignable to a bare annotation in this
// repo (the same constraint app.ts documents). app.ts wires it in with a
// one-line adapter.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { STITCH_VERSION } from '../program.js';

/** The friendly page shown when no web build exists (or `--no-web` was passed). */
export const FALLBACK_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>stitch serve</title></head><body>' +
  '<h1>stitch serve</h1>' +
  '<p>No web UI build found in <code>packages/web/dist</code>.</p>' +
  '<p>Build it with <code>bun --filter @repo-stitcher/web run build</code>, or run ' +
  '<code>bun run dev:web</code> on <code>:5173</code> — its dev server proxies this API.</p>' +
  `<p><code>/health</code>, <code>/api/*</code> and <code>/ws</code> are live on stitch ${STITCH_VERSION}.</p>` +
  '</body></html>';

/** Minimal MIME table for the static route; unknown extensions stay opaque. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** The content type for a path, by extension. */
export function mimeFor(relPath: string): string {
  return MIME_TYPES[extname(relPath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * The cache policy for a served path.
 * - `index.html` must revalidate (it points at the hashed assets),
 * - hashed assets are immutable (their name changes when the bytes change),
 * - everything else is cached for an hour.
 */
export function cacheControlFor(relPath: string): string {
  const name = relPath.split('/').at(-1) ?? relPath;
  if (name === 'index.html') return 'no-cache';
  if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(name)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

/** Every file under `dir`, relative to it, sorted. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The identity of a build: a short hash over the build's file list and sizes.
 * A missing build hashes to `none` — the server still runs, it just has no
 * web app to serve.
 */
export function buildHashOf(distDir: string): string {
  const files = listFiles(distDir);
  if (files.length === 0) return 'none';
  const hash = createHash('sha256');
  for (const rel of files) {
    let size: number;
    try {
      size = statSync(join(distDir, rel)).size;
    } catch {
      size = 0;
    }
    hash.update(`${rel}:${size}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

/** The part of the request context this module needs. */
export interface StaticContext {
  readonly params: Record<string, string>;
  readonly request: Request;
  readonly set: { headers: Record<string, string | number> };
}

/** The minimal router surface `mountStatic` needs. */
export interface StaticHost {
  get(path: string, handler: (ctx: StaticContext) => Promise<Response>): unknown;
}

/** How the static route is configured. */
export interface StaticOptions {
  /** The built web app's directory (`packages/web/dist`). */
  readonly distDir: string;
  /** The build identity shown in the banner; defaults to the build hash. */
  readonly indexBanner?: string;
}

/** Read a file, or `undefined` when it is not there. */
async function tryRead(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch {
    return undefined;
  }
}

/** Inject the build banner into the served shell. */
function withBanner(html: string, banner: string): string {
  const meta = `<meta name="stitch-build" content="${banner}">`;
  const comment = `<!-- stitch build ${banner} -->`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${meta}${comment}</head>`);
  }
  return `${meta}${comment}${html}`;
}

interface Variant {
  readonly bytes: Buffer;
  readonly encoding: string;
}

/** A precompressed sibling, when the client accepts one. */
async function pickVariant(file: string, acceptEncoding: string): Promise<Variant | undefined> {
  const accepts = (token: string): boolean => acceptEncoding.includes(token);
  for (const [suffix, encoding] of [
    ['.br', 'br'],
    ['.gz', 'gzip'],
  ] as const) {
    if (!accepts(encoding)) continue;
    const bytes = await tryRead(`${file}${suffix}`);
    if (bytes !== undefined) return { bytes, encoding };
  }
  return undefined;
}

/**
 * The static + SPA handler.
 *
 * No-throw: every filesystem read degrades to the next step (file -> SPA
 * index -> friendly page), and a path that tries to escape the build
 * directory is refused the same way.
 */
export function createStaticHandler(
  options: StaticOptions
): (ctx: StaticContext) => Promise<Response> {
  const root = resolve(options.distDir);
  const banner = options.indexBanner ?? buildHashOf(root);

  const serveIndex = async (): Promise<Response> => {
    const bytes = await tryRead(join(root, 'index.html'));
    if (bytes === undefined) {
      return new Response(FALLBACK_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(withBanner(bytes.toString('utf8'), banner), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'x-stitch-build': banner,
      },
    });
  };

  return async (ctx: StaticContext): Promise<Response> => {
    const rel = ctx.params['*'] ?? '';
    // An API path that no route claimed must answer with JSON, never with
    // the SPA shell — a 200 HTML page would hide the mistake.
    if (rel === 'api' || rel.startsWith('api/')) {
      return new Response(JSON.stringify({ message: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      decoded = rel;
    }

    // The shell is always served through the banner path.
    if (decoded === '' || decoded === 'index.html' || decoded.endsWith('/index.html')) {
      return serveIndex();
    }

    const full = resolve(root, decoded);
    // Escape hatch for `..` that URL normalisation missed: anything outside
    // the build root is refused, never served.
    if (!full.startsWith(root + sep)) {
      return serveIndex();
    }

    const bytes = await tryRead(full);
    if (bytes === undefined) {
      // A client-side route (or a missing asset) resolves to the shell.
      return serveIndex();
    }

    const headers: Record<string, string> = {
      'content-type': mimeFor(full),
      'cache-control': cacheControlFor(decoded),
      'x-stitch-build': banner,
      vary: 'accept-encoding',
    };
    const acceptEncoding = ctx.request.headers.get('accept-encoding') ?? '';
    const variant = await pickVariant(full, acceptEncoding);
    if (variant !== undefined) {
      headers['content-encoding'] = variant.encoding;
      return new Response(new Uint8Array(variant.bytes), { headers });
    }
    return new Response(new Uint8Array(bytes), { headers });
  };
}

/**
 * Mount the static route on the app.
 *
 * The API and websocket routes are registered BEFORE this call, so they
 * always win; the wildcard is the last resort (Elysia's router prefers the
 * literal paths regardless).
 */
export function mountStatic(host: StaticHost, options: StaticOptions): void {
  host.get('/*', createStaticHandler(options));
}
