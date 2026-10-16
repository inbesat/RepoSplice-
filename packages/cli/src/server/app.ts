// P-193 — the `stitch serve` HTTP/WS app.
//
// Reconciles the P-043 scaffold (`src/serve.ts`): `/health` and the `/ws` echo
// came from there and keep their contract; this file ADDS the REST routes, the
// static serving of the built web UI, the dev CORS, and the hub wiring behind
// `/ws`. `src/serve.ts` now re-exports from here, so the P-043-era import path
// and its test stay green.
//
// TRANSPORT NOTES (why the code looks like this):
//   - Elysia's WebStandard adapter (what vitest/Node runs) has no usable
//     `.listen()`/socket path (the P-043 note in `src/serve.test.ts`), so the
//     tests drive the same route table through `app.handle` and reach the `/ws`
//     handlers through the exported functions the route wires (`echoMessage`,
//     the hub). `stitch serve` itself runs on the Bun runtime (P-043).
//   - CORS is hand-woven from hooks rather than `@elysiajs/cors`, which is not
//     a dependency of this package; the single allowed origin is the dev Vite
//     one (P-208), and same-origin production calls need no CORS at all.
//   - The `/api` payloads are supplied by injectable providers. Until the owning
//     phases wire them (P-185 provenance, P-247 jobs, P-225 settings), the
//     defaults are the only honest claims this server can make: no report, no
//     jobs, no settings — an empty list for a list route, `null` elsewhere.

import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Elysia } from 'elysia';
import { STITCH_VERSION } from '../program.js';
import { createWsHub, echoMessage, type WsHub } from './ws.js';

/** JSON body of GET /health. */
export type HealthBody = {
  ok: true;
  service: 'stitch';
  version: string;
};

/** Bind defaults (`--host` / `--port`, and the phase's default port). */
export const DEFAULT_SERVE_HOST = '127.0.0.1';
export const DEFAULT_SERVE_PORT = 3434;

/** The dev origin (Vite, P-208) that may call the API cross-origin. */
export const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';

/** The `/api` payload providers; the owning phases wire the real data. */
export interface ServeData {
  /** GET /api/provenance — the provenance report plus credits/sbom (P-185). */
  provenance?: () => unknown;
  /** GET /api/jobs — running and past jobs (P-247). */
  jobs?: () => unknown;
  /** GET /api/settings — the web settings surface (P-225). */
  settings?: () => unknown;
}

/** Everything the app needs, all optional with honest defaults. */
export interface CreateAppOptions {
  /** The event hub behind `/ws`. Default: a fresh hub. */
  hub?: WsHub;
  /** Where the built web UI lives (`packages/web/dist`, P-235). `--no-web` omits it. */
  webDist?: string;
  /** The one origin allowed cross-origin; `false` disables CORS outright. */
  corsOrigin?: string | false;
  /** The `/api` payload providers (P-185 / P-247 / P-225). */
  data?: ServeData;
}

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

/** The friendly page shown when no web build exists (or `--no-web` was passed). */
const FALLBACK_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>stitch serve</title></head><body>' +
  '<h1>stitch serve</h1>' +
  '<p>No web UI build found in <code>packages/web/dist</code>.</p>' +
  '<p>Build it with <code>bun --filter @repo-stitcher/web run build</code>, or run ' +
  '<code>bun run dev:web</code> on <code>:5173</code> — its dev server proxies this API.</p>' +
  `<p><code>/health</code>, <code>/api/*</code> and <code>/ws</code> are live on stitch ${STITCH_VERSION}.</p>` +
  '</body></html>';

/**
 * Serve one path out of `webDist`, or `undefined` when this request should fall
 * through to the friendly page.
 *
 * Order: the literal file (traversal-guarded), then the SPA index. No-throw —
 * a decode failure or an unreadable file is a fall-through, not a crash.
 */
async function serveStatic(webDist: string, rawPath: string): Promise<Response | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
  const root = resolve(webDist);
  const file =
    decoded === ''
      ? join(root, 'index.html')
      : (() => {
          const full = resolve(root, decoded);
          // Escape hatch for `..` that URL normalisation missed: anything outside
          // the dist root is refused, never served.
          if (!full.startsWith(root + sep)) return undefined;
          return full;
        })();
  if (file === undefined) return undefined;
  try {
    const bytes = await readFile(file);
    const type = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': type } });
  } catch {
    // Missing asset → SPA index (a client-side route), else fall through.
    try {
      const bytes = await readFile(join(root, 'index.html'));
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': MIME_TYPE_HTML },
      });
    } catch {
      return undefined;
    }
  }
}

const MIME_TYPE_HTML: string = MIME_TYPES['.html'] ?? 'text/html; charset=utf-8';

/**
 * Build the `stitch serve` app.
 *
 * The route table is adapter-independent: the command calls `.listen(port)` on
 * the Bun runtime, and the tests drive the same table through `app.handle`.
 */
export function createApp(options: CreateAppOptions = {}) {
  const hub = options.hub ?? createWsHub();
  const data = options.data ?? {};
  // One unsubscribe per live socket, so `close` can drop exactly its own.
  const unsubscribers = new Map<unknown, () => void>();

  // No explicit return type: Elysia's chained-builder generics are not
  // assignable to a bare `Elysia` annotation under exactOptionalPropertyTypes.
  // Consumers name it via `ReturnType<typeof createApp>`.
  return (
    new Elysia()
      .onBeforeHandle(({ request, set }) => {
        const allow = options.corsOrigin ?? DEFAULT_CORS_ORIGIN;
        if (allow === false) return;
        // Reflect the origin only when it IS the allowed one — a foreign origin
        // gets no CORS header at all, which is what a refusal should look like.
        if (request.headers.get('origin') === allow) {
          set.headers['access-control-allow-origin'] = allow;
        }
      })
      .get('/health', (): HealthBody => ({ ok: true, service: 'stitch', version: STITCH_VERSION }))
      .get('/api/provenance', () => data.provenance?.() ?? null)
      .get('/api/jobs', () => data.jobs?.() ?? [])
      .get('/api/settings', () => data.settings?.() ?? null)
      // Preflight for the Vite dev origin: the web client posts approvals and
      // settings with a JSON content type, which browsers probe first.
      .options('/*', () => {
        const allow = options.corsOrigin ?? DEFAULT_CORS_ORIGIN;
        const headers: Record<string, string> = {
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        };
        if (allow !== false) headers['access-control-allow-origin'] = allow;
        return new Response(null, { status: 204, headers });
      })
      .ws('/ws', {
        open(ws) {
          // Every socket subscribes to EVERY topic: the envelope's `topic` field
          // lets the client filter, instead of a per-socket negotiation.
          unsubscribers.set(ws, hub.subscribe(ws));
        },
        message(ws, message) {
          echoMessage(ws, message);
        },
        close(ws) {
          const unsubscribe = unsubscribers.get(ws);
          unsubscribe?.();
          unsubscribers.delete(ws);
        },
      })
      // Static, last: exact routes above win over the wildcard (Elysia's router
      // prefers literal paths), and everything else is an asset or an SPA route.
      .get('/*', async ({ params }) => {
        const webDist = options.webDist;
        if (webDist !== undefined) {
          const rel = params['*'] ?? '';
          const served = await serveStatic(webDist, rel);
          if (served !== undefined) return served;
        }
        return new Response(FALLBACK_HTML, { headers: { 'content-type': MIME_TYPE_HTML } });
      })
  );
}
