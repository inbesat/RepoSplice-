// P-252 — `serve`'s half of the CLI↔Web contract.
//
// Three jobs, all of them thin:
//   1. serve the contract itself (`GET /api-docs.json` plus a plain page at
//      `GET /api-docs` that lists the routes — no CDN, so it works offline);
//   2. validate an inbound body against the route's schema and refuse with 422
//      (P-203's mapping) instead of letting a bad body reach a handler;
//   3. validate what a handler produced while `STITCH_API_DEBUG` is set, so a
//      drift is loud in development and silent in production.
//
// The contract itself lives in core (`packages/core/src/api/contract.ts`,
// ADR-176) and reaches this package through the public barrel only.

import { Elysia } from 'elysia';
import {
  API_DOCS_PATH,
  API_DOCS_UI_PATH,
  buildOpenApiDocument,
  describeIssues,
  findApiRoute,
  listApiRoutes,
  statusForContractError,
  validateApiRequest,
  validateApiResponse,
  type ApiRoute,
} from '@repo-stitcher/core';
import type { StitchError } from '@repo-stitcher/core';

/** A refusal body: the machine code, the field and the human message. */
export interface ApiRefusalBody {
  readonly message: string;
  readonly code: string;
  readonly field?: string;
}

/** Turn a contract failure into the response `serve` answers with. */
export function toRefusalResponse(error: StitchError): Response {
  const body: ApiRefusalBody = {
    message: 'message' in error ? error.message : error.code,
    code: error.code,
    ...('field' in error && error.field !== undefined ? { field: error.field } : {}),
  };
  return Response.json(body, { status: statusForContractError(error) });
}

/**
 * Validate one request body against a route id.
 *
 * Returns `ok(body)` for a valid (or body-less) route and the 422 response for
 * an invalid one, so a handler can do:
 *   const checked = checkRequestBody('merge.run', body);
 *   if (checked instanceof Response) return checked;
 */
export function checkRequestBody(routeId: string, body: unknown): Response | undefined {
  const validated = validateApiRequest(routeId, body);
  return validated.isErr() ? toRefusalResponse(validated.error) : undefined;
}

/** Validate one handler's output; only wired in when debugging is asked for. */
export function checkResponseBody(routeId: string, body: unknown): Response | undefined {
  const validated = validateApiResponse(routeId, body);
  return validated.isErr() ? toRefusalResponse(validated.error) : undefined;
}

/** True when the caller asked for outbound contract checking. */
export function apiDebugEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env['STITCH_API_DEBUG'];
  return raw === '1' || raw === 'true';
}

/** One HTML row: method, path, operation id and its summary. */
function renderRows(routes: readonly ApiRoute[]): string {
  return routes
    .map(
      route =>
        `      <tr><td><code>${route.method}</code></td><td><code>${route.path}</code></td>` +
        `<td>${route.id}</td><td>${route.summary}</td></tr>`
    )
    .join('\n');
}

/**
 * A self-contained page: the repo's docs value is "works offline", and Swagger
 * UI would need a CDN, so this lists the table and points at the JSON document.
 */
export function renderApiDocsPage(routes: readonly ApiRoute[]): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>RepoSplice API contract</title></head>
<body>
  <h1>RepoSplice CLI server API</h1>
  <p>Generated from the zod contract. The machine-readable document is
     <a href="${API_DOCS_PATH}"><code>${API_DOCS_PATH}</code></a>.</p>
  <table border="1" cellspacing="0" cellpadding="4">
    <thead><tr><th>Method</th><th>Path</th><th>Operation</th><th>Summary</th></tr></thead>
    <tbody>
${renderRows(routes)}
    </tbody>
  </table>
</body>
</html>
`;
}

/**
 * The contract's own routes.
 *
 * A schema that cannot be rendered is answered as a 500 naming the field
 * (`api.openapi`), never as a broken document: a gate that did not run is
 * deferred, never passing.
 */
export function createApiDocsApp() {
  return new Elysia()
    .get(API_DOCS_PATH, () => {
      const document = buildOpenApiDocument();
      return document.isErr() ? toRefusalResponse(document.error) : Response.json(document.value);
    })
    .get(
      API_DOCS_UI_PATH,
      () =>
        new Response(renderApiDocsPage(listApiRoutes()), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
    );
}

/**
 * Validate an inbound body for any contracted route before a handler runs.
 *
 * Only the routes that declare a request body are touched, and only when the
 * request carries one, so a GET (or an unrouted path) is untouched and the
 * existing 404 behaviour for unknown `/api/*` paths is preserved.
 */
export function createApiValidationPlugin() {
  return new Elysia().onBeforeHandle({ as: 'global' }, async ({ request, path, set }) => {
    const method = request.method.toUpperCase();
    if (method !== 'POST' && method !== 'PATCH' && method !== 'PUT') return;
    const route = findApiRoute(method, path);
    if (route?.request === undefined) return;
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      set.status = 422;
      return {
        message: `${method} ${route.path} needs a JSON body: it could not be parsed`,
        code: 'CONFIG_ERROR',
        field: 'api.request',
      } satisfies ApiRefusalBody;
    }
    const validated = validateApiRequest(route.id, body);
    if (validated.isOk()) return;
    set.status = statusForContractError(validated.error);
    const failure = validated.error;
    return {
      message: 'message' in failure ? failure.message : failure.code,
      code: failure.code,
      field: 'api.request',
    } satisfies ApiRefusalBody;
  });
}

/** Re-exported so a caller can describe an issue list without importing zod. */
export { describeIssues };
