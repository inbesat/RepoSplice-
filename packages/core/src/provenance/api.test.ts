// P-185 — provenance API contract tests.
//
// The "server" is a RECORDING HOST and a fake `getMap`, exactly as the phase's
// test line specifies ("route handler with fake ctx/getMap"): the handlers are
// pure, so nothing here starts an HTTP listener or needs Elysia — which is the
// whole reason the contract is framework-agnostic (ADR-058).
//
// The five required scenarios from the phase spec:
//
//   it('serves full map')          it('serves file origin')
//   it('404s unknown file')        it('serves credits')
//   it('hides email by default')

import { describe, it, expect } from 'vitest';
import { err, ok } from 'neverthrow';
import { ProvenanceMap, type FileOrigin, type ProvenanceWarning } from './map.js';
import {
  PROVENANCE_ROUTES,
  buildProvenanceRoutes,
  provenanceRoutes,
  recordingRouteHost,
  serializeProvenanceMap,
  type RouteDescriptor,
} from './api.js';

const TS = '2026-10-16T00:00:00.000Z';
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function origin(over: Partial<FileOrigin> & { file: string }): FileOrigin {
  const { file, ...rest } = over;
  return {
    repo: 'A',
    sourceCommit: SHA_A,
    sourcePath: file,
    sourceAuthor: 'Ada Lovelace',
    copiedAt: TS,
    stitchedBy: 'manual',
    ...rest,
    file,
  };
}

function map(): ProvenanceMap {
  const warnings: ProvenanceWarning[] = [
    { file: 'orphan.ts', reason: 'no-line-origins', message: 'no line origins' },
  ];
  return ProvenanceMap.from(
    [
      origin({ file: 'lib/util.go' }),
      origin({ file: 'cmd/main.go', repo: 'B', sourceCommit: SHA_A, stitchedBy: 'agent' }),
      {
        file: 'orphan.ts',
        repo: 'unknown',
        sourceCommit: '',
        sourcePath: 'orphan.ts',
        copiedAt: TS,
        stitchedBy: 'manual',
      },
    ],
    warnings
  );
}

/** The routes bound to a recording host, plus a handle to drive a path. */
function setup(includeEmails = false): {
  host: ReturnType<typeof recordingRouteHost>;
  routes: RouteDescriptor[];
  call: (
    path: string,
    query?: Record<string, string | undefined>
  ) => Promise<{ status: number; body: unknown }>;
} {
  const host = recordingRouteHost();
  const routes = provenanceRoutes(host, { getMap: () => map(), includeEmails });
  const call = async (
    path: string,
    query?: Record<string, string | undefined>
  ): Promise<{ status: number; body: unknown }> => {
    const route = routes.find(candidate => candidate.path === path);
    if (route === undefined) throw new Error(`no route ${path}`);
    return await route.handler({ ...(query !== undefined ? { query } : {}) });
  };
  return { host, routes, call };
}

describe('P-185 provenance api', () => {
  it('serves full map', async () => {
    const { host, routes, call } = setup();

    // The host is genuinely USED (registration is the point of `ctx`), and the
    // descriptors come back so a caller need not go through a host at all.
    expect(host.routes).toHaveLength(3);
    expect(routes.map(route => route.path)).toEqual([
      PROVENANCE_ROUTES.map,
      PROVENANCE_ROUTES.file,
      PROVENANCE_ROUTES.credits,
    ]);
    for (const route of routes) expect(route.method).toBe('GET');

    const response = await call(PROVENANCE_ROUTES.map);
    expect(response.status).toBe(200);
    const body = response.body as ReturnType<typeof serializeProvenanceMap>;
    expect(body.files).toHaveLength(3);
    // Sorted by path (P-282), so two responses are diffable.
    expect(body.files.map(file => file.file)).toEqual(['cmd/main.go', 'lib/util.go', 'orphan.ts']);
    // Stats use P-182's own predicates, so the panel cannot disagree with the doc.
    expect(body.stats).toEqual({
      total: 3,
      byRepo: { A: 1, B: 1, unknown: 1 },
      agentEdited: 1,
      unattributed: 1,
    });

    // The serializer is usable on its own (no route, no host).
    const direct = serializeProvenanceMap(map());
    expect(direct.stats.total).toBe(3);
  });

  it('serves file origin', async () => {
    const { call } = setup();

    const found = await call(PROVENANCE_ROUTES.file, { path: 'lib/util.go' });
    expect(found.status).toBe(200);
    const body = found.body as { file: FileOrigin };
    expect(body.file.file).toBe('lib/util.go');
    expect(body.file.repo).toBe('A');
    expect(body.file.sourceCommit).toBe(SHA_A);
    // The PRE-teleport path travels, because that is what attribution is for.
    expect(body.file.sourcePath).toBe('lib/util.go');
    expect(body.file.stitchedBy).toBe('manual');

    // `getOrigin` normalises separators, so a Windows-style query resolves too —
    // the handler does not re-implement lookup.
    const backslash = await call(PROVENANCE_ROUTES.file, { path: 'lib\\util.go' });
    expect(backslash.status).toBe(200);

    // An unattributed file is still SERVED (with repo 'unknown'), never hidden.
    const orphan = await call(PROVENANCE_ROUTES.file, { path: 'orphan.ts' });
    expect(orphan.status).toBe(200);
    expect((orphan.body as { file: FileOrigin }).file.repo).toBe('unknown');
  });

  it('404s unknown file', async () => {
    const { call } = setup();

    // An unknown path is a normal 404…
    const missing = await call(PROVENANCE_ROUTES.file, { path: 'nope.txt' });
    expect(missing.status).toBe(404);
    expect((missing.body as { message: string }).message).toContain('nope.txt');

    // …while a MISSING parameter is the caller's mistake, and says so.
    const noParam = await call(PROVENANCE_ROUTES.file, {});
    expect(noParam.status).toBe(400);
    const blank = await call(PROVENANCE_ROUTES.file, { path: '   ' });
    expect(blank.status).toBe(400);

    // A genuine store failure is a 500, distinguished from both.
    const failing = buildProvenanceRoutes({
      getMap: () => {
        throw new Error('map unavailable');
      },
    });
    const file = failing.find(route => route.path === PROVENANCE_ROUTES.file);
    await expect(file?.handler({ query: { path: 'x' } }) ?? Promise.resolve(null)).rejects.toThrow(
      'map unavailable'
    );
  });

  it('serves credits', async () => {
    const { call } = setup();

    const response = await call(PROVENANCE_ROUTES.credits);
    expect(response.status).toBe(200);
    const markdown = response.body as string;
    // The CREDITS content itself (P-182), not a file path.
    expect(markdown).toContain('# Credits');
    expect(markdown).toContain('| File in C | Source Commit | Author |');
    expect(markdown).toContain('`lib/util.go`');
    expect(markdown).toContain('## Unattributed');

    // A renderer that fails is a 500 carrying the reason, not an empty document.
    const broken = buildProvenanceRoutes({
      getMap: () => map(),
      getCredits: () => Promise.resolve(err({ code: 'INTERNAL', message: 'renderer exploded' })),
    });
    const route = broken.find(candidate => candidate.path === PROVENANCE_ROUTES.credits);
    const failed = await route?.handler({});
    expect(failed?.status).toBe(500);
    expect((failed?.body as { message: string }).message).toBe('renderer exploded');

    // …and a successful injected renderer is used as given.
    const custom = buildProvenanceRoutes({
      getMap: () => map(),
      getCredits: () => Promise.resolve(ok('# custom credits\n')),
    });
    const okRoute = custom.find(candidate => candidate.path === PROVENANCE_ROUTES.credits);
    const served = await okRoute?.handler({});
    expect(served?.status).toBe(200);
    expect(served?.body).toBe('# custom credits\n');
  });

  it('hides email by default', async () => {
    const withEmail = ProvenanceMap.from([
      origin({ file: 'lib/util.go', sourceEmail: 'ada@example.test' }),
    ]);

    // Default: the address is NOT transported — the third default-closed gate
    // over contributor PII (P-181 stores, P-182 renders, P-185 transports).
    const hidden = serializeProvenanceMap(withEmail);
    expect(hidden.files[0]?.sourceEmail).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain('ada@example.test');

    // …and ONLY when asked for does it travel.
    const shown = serializeProvenanceMap(withEmail, { includeEmails: true });
    expect(shown.files[0]?.sourceEmail).toBe('ada@example.test');

    // The route honours the same flag, so the gate cannot be bypassed by HTTP.
    const host = recordingRouteHost();
    const routes = provenanceRoutes(host, { getMap: () => withEmail });
    const mapRoute = routes.find(route => route.path === PROVENANCE_ROUTES.map);
    const publicMap = await mapRoute?.handler({});
    expect(JSON.stringify(publicMap?.body)).not.toContain('ada@example.test');

    const openHost = recordingRouteHost();
    const openRoutes = provenanceRoutes(openHost, { getMap: () => withEmail, includeEmails: true });
    const openMap = openRoutes.find(route => route.path === PROVENANCE_ROUTES.map);
    const servedWithEmail = await openMap?.handler({});
    expect(JSON.stringify(servedWithEmail?.body)).toContain('ada@example.test');

    // The file route applies the same rule.
    const fileRoute = routes.find(route => route.path === PROVENANCE_ROUTES.file);
    const fileResponse = await fileRoute?.handler({ query: { path: 'lib/util.go' } });
    expect(JSON.stringify(fileResponse?.body)).not.toContain('ada@example.test');
  });
});
