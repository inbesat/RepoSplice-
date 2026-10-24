// P-252 — the contract conformance spec: the CLI server, the contract and the
// generated web client must all describe the SAME API.
//
// The four mandated ids are the phase's own: health conforms, jobs conforms,
// merge propose conforms, invalid body 422. The first, second and fourth drive
// a REAL server through `app.handle` (the P-193 test transport) and validate
// what it actually answered; the third exercises the documented merge route,
// which `serve` does not implement yet — it is asserted against the contract
// and the OpenAPI document, and the missing REST surface is recorded as such
// rather than faked with an invented endpoint.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Elysia } from 'elysia';
import { describe, expect, it } from 'vitest';
import {
  API_CONTRACT_VERSION,
  API_ROUTES,
  buildOpenApiDocument,
  documentedRouteIds,
  listApiRoutes,
  validateApiRequest,
  validateApiResponse,
} from '@repo-stitcher/core';
import { createApiValidationPlugin, renderApiDocsPage } from './openapi.serve.js';
import { createApp } from '../server/app.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const GENERATED_CLIENT = join(REPO_ROOT, 'packages', 'web', 'src', 'api', 'client.generated.ts');

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

/** The route ids a request would be validated against, as the spec sees them. */
function routeIdFor(method: string, path: string): string {
  const route = API_ROUTES.find(
    candidate =>
      candidate.method === method &&
      candidate.path
        .split('/')
        .filter(segment => segment !== '')
        .map(segment => (segment.startsWith(':') ? segment : segment)).length ===
        path.split('/').filter(segment => segment !== '').length &&
      candidate.path
        .split('/')
        .filter(segment => segment !== '')
        .every((segment, index) => {
          const actual = path.split('/').filter(part => part !== '')[index] ?? '';
          return segment.startsWith(':') ? actual.length > 0 : segment === actual;
        })
  );
  return route?.id ?? '(unrouted)';
}

describe('CLI↔Web contract conformance (P-252)', () => {
  it('health conforms', async () => {
    const app = createApp();
    const response = await app.handle(request('/health'));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const checked = validateApiResponse('health', body);
    expect(checked.isOk()).toBe(true);
    expect(body).toMatchObject({ ok: true, service: 'stitch' });

    // The contract itself is served, and it lists every documented route.
    const docs = await app.handle(request('/api-docs.json'));
    expect(docs.status).toBe(200);
    const document = (await docs.json()) as {
      openapi?: string;
      'x-contract-version'?: string;
      paths?: Record<string, Record<string, unknown>>;
    };
    expect(document.openapi).toBe('3.0.3');
    expect(document['x-contract-version']).toBe(API_CONTRACT_VERSION);
    expect(Object.keys(document.paths ?? {})).toContain('/health');
    expect(document.paths?.['/health']).toHaveProperty('get');

    // The human page is served too (no CDN: it renders from the route table).
    const page = await app.handle(request('/api-docs'));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('/api-docs.json');
    expect(renderApiDocsPage(listApiRoutes())).toContain('merge.run');

    // No two routes may share an id, and the document covers them all.
    expect(new Set(API_ROUTES.map(route => route.id)).size).toBe(API_ROUTES.length);
    expect(documentedRouteIds().length).toBe(API_ROUTES.length);
  });

  it('jobs conforms', async () => {
    // The live default: an empty history is a conforming answer.
    const bare = createApp();
    const empty = await bare.handle(request('/api/jobs'));
    expect(empty.status).toBe(200);
    const emptyBody: unknown = await empty.json();
    expect(emptyBody).toEqual([]);
    expect(validateApiResponse('jobs.list', emptyBody).isOk()).toBe(true);

    // A real provider payload (P-247's shape) conforms in both envelopes.
    const summary = {
      id: 'job-1',
      kind: 'merge',
      status: 'succeeded',
      started: '2026-10-24T10:00:00.000Z',
      finished: '2026-10-24T10:00:05.000Z',
      durationMs: 5000,
      result: '12 files · 3 deps · 2 licenses',
    };
    const wired = createApp({ data: { jobs: () => [summary] } });
    const response = await wired.handle(request('/api/jobs'));
    const body: unknown = await response.json();
    expect(body).toEqual([summary]);
    expect(validateApiResponse('jobs.list', body).isOk()).toBe(true);
    expect(validateApiResponse('jobs.list', { jobs: [summary] }).isOk()).toBe(true);
    expect(validateApiResponse('jobs.detail', { summary }).isOk()).toBe(true);

    // A drifted reply is refused, naming the route and the field.
    const drifted = validateApiResponse('jobs.list', [{ id: 'job-1' }]);
    expect(drifted.isErr()).toBe(true);
    if (drifted.isErr()) {
      expect(drifted.error.code).toBe('CONFIG_ERROR');
      expect('field' in drifted.error && drifted.error.field).toBe('api.response');
    }
  });

  it('merge propose conforms', async () => {
    // The documented request/response pair, exactly as the generated client sends it.
    const proposal = { selectionA: ['src/a.ts'], selectionB: ['src/b.ts'] };
    const accepted = validateApiRequest('merge.run', proposal);
    expect(accepted.isOk()).toBe(true);
    expect(validateApiResponse('merge.run', { files: 2, deps: [], licenses: ['MIT'] }).isOk()).toBe(
      true
    );

    // A proposal missing a selection is refused on the request field.
    const refused = validateApiRequest('merge.run', { selectionA: ['src/a.ts'] });
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) {
      expect('field' in refused.error && refused.error.field).toBe('api.request');
    }

    // The document advertises it, and it says the route is a placeholder until
    // P-192's REST surface exists — the honest record, not an invented handler.
    const document = buildOpenApiDocument();
    expect(document.isOk()).toBe(true);
    if (document.isOk()) {
      const merge = document.value.paths['/api/merge'];
      expect(merge).toBeDefined();
      expect(merge?.['post']).toHaveProperty('operationId', 'merge.run');
      expect(merge?.['post']).toHaveProperty('requestBody');
    }
    const route = API_ROUTES.find(candidate => candidate.id === 'merge.run');
    expect(route?.placeholderResponse).toBe(true);
    expect(routeIdFor('POST', '/api/merge')).toBe('merge.run');

    // `serve` answers the unknown-path 404 for it today: no invented handler.
    const app = createApp();
    const live = await app.handle(
      request('/api/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proposal),
      })
    );
    expect([404, 405, 422]).toContain(live.status);
  });

  it('invalid body 422', async () => {
    // The gate the phase asks for, exercised through a real HTTP request: the
    // validation plugin runs before the handler and refuses a bad body.
    const app = new Elysia()
      .use(createApiValidationPlugin())
      .post('/api/merge', () => ({ files: 0, deps: [], licenses: [] }));

    const bad = await app.handle(
      request('/api/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectionA: 'not-an-array' }),
      })
    );
    expect(bad.status).toBe(422);
    const body = (await bad.json()) as { code?: string; field?: string; message?: string };
    expect(body.code).toBe('CONFIG_ERROR');
    expect(body.field).toBe('api.request');
    expect(body.message).toContain('does not match its schema');

    // A conforming body reaches the handler untouched.
    const good = await app.handle(
      request('/api/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectionA: ['src/a.ts'], selectionB: [] }),
      })
    );
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ files: 0, deps: [], licenses: [] });

    // A body that is not JSON at all is refused on the same field.
    const unparseable = await app.handle(
      request('/api/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      })
    );
    expect(unparseable.status).toBe(422);
    const unparseableBody = (await unparseable.json()) as { field?: string };
    expect(unparseableBody.field).toBe('api.request');

    // The generated client is not allowed to invent a route of its own.
    const generated = readFileSync(GENERATED_CLIENT, 'utf8');
    const known = new Set(API_ROUTES.map(route => route.id));
    const declared = [...generated.matchAll(/id: '([a-zA-Z.]+)', method:/g)].map(match => match[1]);
    expect(declared.length).toBe(known.size);
    for (const id of declared) expect(known.has(id ?? '')).toBe(true);
    expect(new Set(declared)).toEqual(known);
  });
});
