// P-252 — the CLI↔Web API contract: ONE zod source for every `/api/*` endpoint.
//
// Why this file exists: the phase names `packages/core/src/api/contract.ts` as
// the single schema source so `stitch serve` (P-193) and the web client
// (P-211-P-230) cannot drift. ADR-176 authorises this one cross-lane file pair
// (contract + openapi); nothing else in `packages/core` changed for P-252.
//
// The zod shapes below mirror `packages/shared/src/index.ts` (P-315, the wire
// type owner) and the web client's own declarations, which the shared package
// itself copied verbatim. Where the server side does not exist yet the schema
// is deliberately open (`z.unknown()` / a JSON object) rather than invented:
// the tighter shape belongs to the phase that implements the route, and the
// contract says so instead of guessing fifty field names.
//
// Errors reuse the unified contract only: `CONFIG_ERROR` with field
// `api.route` (unknown id), `api.request` (a body that failed) or
// `api.response` (a reply that failed). Nothing here throws.

import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { StitchError } from '../result/index.js';

/** Bumped when a schema changes shape; surfaced in the OpenAPI document. */
export const API_CONTRACT_VERSION = '1.0.0';

/** Where the JSON document is mounted by `stitch serve` (P-252 step 2). */
export const API_DOCS_PATH = '/api-docs.json';

/** Where the human-readable page is mounted. */
export const API_DOCS_UI_PATH = '/api-docs';

// ---------------------------------------------------------------------------
// Wire shapes (mirrors packages/shared/src/index.ts + the web client).
// ---------------------------------------------------------------------------

export const sourceKindSchema = z.enum(['github', 'local']);
export const sourceStatusSchema = z.enum(['ready', 'pending', 'error']);

/** One configured source (the A/B slot content, P-215). */
export const sourceRecordSchema = z.object({
  id: z.string().min(1),
  kind: sourceKindSchema,
  repo: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  status: sourceStatusSchema,
});

/** One entry of a source's flat file tree (P-213/P-232). */
export const treeEntrySchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().int().nonnegative(),
  blobSha: z.string().optional(),
});

/** One directory page (P-232). */
export const treePageSchema = z.object({
  entries: z.array(treeEntrySchema),
  nextCursor: z.string().optional(),
});

/** What a merge run reports back (P-192/P-160). */
export const mergeSummarySchema = z.object({
  files: z.number().int().nonnegative(),
  deps: z.array(z.string()),
  licenses: z.array(z.string()),
});

/** Body: the A/B selections (sorted repo-relative paths, ADR-099). */
export const mergeRunRequestSchema = z.object({
  selectionA: z.array(z.string()),
  selectionB: z.array(z.string()),
});

/** Body: approve a proposal and create repo C. */
export const mergeApproveRequestSchema = z.object({
  include: z.array(z.string()),
  exclude: z.array(z.string()),
  note: z.string(),
});

/** Body: reject a proposal with a reason (P-187 audit). */
export const mergeRejectRequestSchema = z.object({ reason: z.string().min(1) });

export const jobKindSchema = z.enum(['merge', 'verify']);
export const jobStatusSchema = z.enum(['running', 'succeeded', 'failed']);

/** One job history row (P-247). */
export const jobSummarySchema = z.object({
  id: z.string().min(1),
  kind: jobKindSchema,
  status: jobStatusSchema,
  started: z.string().min(1),
  finished: z.string().optional(),
  durationMs: z.number().optional(),
  result: z.string().optional(),
});

/** One job's full detail (P-247). `extras` carries provenance/sandbox later. */
export const jobDetailSchema = z.object({
  summary: jobSummarySchema,
  extras: z.record(z.string(), z.unknown()).optional(),
});

/** The exported/importable session bundle (P-230). */
export const sessionBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().min(1),
  sources: z.object({
    A: z.array(sourceRecordSchema),
    B: z.array(sourceRecordSchema),
  }),
  selection: z.object({
    A: z.array(z.string()),
    B: z.array(z.string()),
  }),
  resolutions: z.record(z.string(), z.string()),
  licenseDecisions: z.record(z.string(), z.enum(['allow', 'deny'])),
});

/** Effective settings as the web renders them (P-225). Never key VALUES. */
export const settingsDataSchema = z.object({
  model: z.string().optional(),
  maxTokens: z.number().optional(),
  streaming: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'auto']).optional(),
  licensePolicy: z.record(z.enum(['allow', 'warn', 'deny']), z.array(z.string())).optional(),
  timeoutSec: z.number().optional(),
  memory: z.string().optional(),
  offline: z.boolean().optional(),
  keys: z.record(z.string(), z.boolean()).optional(),
  locale: z.string().optional(),
});

/** Deep-partial patch body for PATCH /api/settings (P-225/P-229/P-234). */
export const settingsPatchSchema = z.object({
  openrouter: z.object({ defaultModel: z.string().optional() }).optional(),
  agent: z
    .object({ maxTokens: z.number().optional(), maxCostUsd: z.number().optional() })
    .optional(),
  licensePolicy: z.record(z.enum(['allow', 'warn', 'deny']), z.array(z.string())).optional(),
  sandbox: z
    .object({
      limits: z
        .object({ timeout: z.number().optional(), memory: z.string().optional() })
        .optional(),
    })
    .optional(),
  appearance: z.object({ theme: z.enum(['light', 'dark', 'auto']).optional() }).optional(),
  network: z.object({ offline: z.boolean().optional() }).optional(),
  tour: z.object({ dismissed: z.boolean().optional() }).optional(),
  i18n: z.object({ locale: z.string().optional() }).optional(),
});

/** GET /health (P-193's own contract, kept as it was). */
export const healthSchema = z.object({
  ok: z.literal(true),
  service: z.literal('stitch'),
  version: z.string().min(1),
});

/** A server that has no data to report says `null` (`/api/provenance`). */
const nullableUnknownSchema = z.unknown();

/** The report endpoints the owning phases have not implemented yet: the
 *  server's live default is `[]` or `null`, so the schema accepts any JSON
 *  value and the route summary records who owns the tightening. */
const jsonValueSchema = z.unknown();

/** `[{...}]` or `{jobs:[{...}]}` — the live route answers `[]` by default. */
export const jobListResponseSchema = z.union([
  z.array(jobSummarySchema),
  z.object({ jobs: z.array(jobSummarySchema) }),
]);

/** `{ warnings: [...] }` (P-230 session import). */
export const sessionImportResponseSchema = z.object({ warnings: z.array(z.string()) });

/** The two tree read modes (P-213 flat list, P-232 page). */
export const treeResponseSchema = z.union([z.array(treeEntrySchema), treePageSchema]);

// ---------------------------------------------------------------------------
// The route table: the single source `serve` and the web client both trust.
// ---------------------------------------------------------------------------

export type ApiMethod = 'GET' | 'POST' | 'PATCH';

/** One endpoint: its path template, its schemas and who owns the data. */
export interface ApiRoute {
  readonly id: string;
  readonly method: ApiMethod;
  readonly path: string;
  readonly summary: string;
  /** Absent for a body-less request (GET). */
  readonly request?: z.ZodType;
  readonly response: z.ZodType;
  /** True while `serve` answers a placeholder for this route. */
  readonly placeholderResponse?: boolean;
}

/** Every `/api/*` endpoint the web client calls, plus `/health`. */
export const API_ROUTES: readonly ApiRoute[] = [
  {
    id: 'health',
    method: 'GET',
    path: '/health',
    summary: 'Liveness plus the running version (P-193).',
    response: healthSchema,
  },
  {
    id: 'repos.sources',
    method: 'GET',
    path: '/api/repos/sources',
    summary: 'Every configured A/B source (P-215).',
    response: z.object({ sources: z.array(sourceRecordSchema) }),
    placeholderResponse: true,
  },
  {
    id: 'repos.fromUrl',
    method: 'POST',
    path: '/api/repos/from-url',
    summary: 'Add a GitHub source by owner/repo and optional ref (P-215).',
    request: z.object({ ownerRepo: z.string().min(1), ref: z.string().min(1).optional() }),
    response: sourceRecordSchema,
    placeholderResponse: true,
  },
  {
    id: 'repos.local',
    method: 'POST',
    path: '/api/repos/local',
    summary: 'Add a local filesystem source (P-215).',
    request: z.object({ path: z.string().min(1) }),
    response: sourceRecordSchema,
    placeholderResponse: true,
  },
  {
    id: 'repos.tree',
    method: 'GET',
    path: '/api/repos/:id/tree',
    summary: 'One source tree: flat entries, or a page when `dir` is given (P-213/P-232).',
    response: treeResponseSchema,
    placeholderResponse: true,
  },
  {
    id: 'deps.report',
    method: 'GET',
    path: '/api/deps/report',
    summary: 'The dependency report and its conflicts (P-217). Shape owned by P-217.',
    response: jsonValueSchema,
    placeholderResponse: true,
  },
  {
    id: 'deps.resolve',
    method: 'POST',
    path: '/api/deps/resolve',
    summary: 'Record one dependency resolution (P-217).',
    request: z.object({ pkg: z.string().min(1), resolution: z.string().min(1) }),
    response: z.unknown(),
    placeholderResponse: true,
  },
  {
    id: 'jobs.list',
    method: 'GET',
    path: '/api/jobs',
    summary: 'The job history, newest first (P-247). Answers [] until P-247 wires it.',
    response: jobListResponseSchema,
    placeholderResponse: true,
  },
  {
    id: 'jobs.detail',
    method: 'GET',
    path: '/api/jobs/:jobId',
    summary: 'One job with its provenance/sandbox extras (P-247).',
    response: jobDetailSchema,
    placeholderResponse: true,
  },
  {
    id: 'jobs.rerun',
    method: 'POST',
    path: '/api/jobs/:jobId/rerun',
    summary: 'Re-run a finished job with its saved sources (P-247).',
    request: z.object({ jobId: z.string().min(1) }),
    response: jobSummarySchema,
    placeholderResponse: true,
  },
  {
    id: 'licenses.report',
    method: 'GET',
    path: '/api/licenses/report',
    summary: 'The license report: rows, warnings, dual and unknown sets (P-220).',
    response: jsonValueSchema,
    placeholderResponse: true,
  },
  {
    id: 'licenses.decide',
    method: 'POST',
    path: '/api/licenses/decide',
    summary: 'Record a verdict for one unknown license (P-220).',
    request: z.object({ licenseId: z.string().min(1), verdict: z.enum(['allow', 'deny']) }),
    response: z.unknown(),
    placeholderResponse: true,
  },
  {
    id: 'merge.run',
    method: 'POST',
    path: '/api/merge',
    summary: 'Run the merge for the A/B selections and report the summary (P-192).',
    request: mergeRunRequestSchema,
    response: mergeSummarySchema,
    placeholderResponse: true,
  },
  {
    id: 'merge.approve',
    method: 'POST',
    path: '/api/merge/approve',
    summary: 'Finalize the child repo C from an approved proposal (P-192/P-160).',
    request: mergeApproveRequestSchema,
    response: mergeSummarySchema,
    placeholderResponse: true,
  },
  {
    id: 'merge.reject',
    method: 'POST',
    path: '/api/merge/reject',
    summary: 'Abort the proposal and record the reason (P-187).',
    request: mergeRejectRequestSchema,
    response: z.unknown(),
    placeholderResponse: true,
  },
  {
    id: 'provenance.report',
    method: 'GET',
    path: '/api/provenance',
    summary: 'The provenance report, or null when there is none (P-185). Live route.',
    response: nullableUnknownSchema,
  },
  {
    id: 'provenance.map',
    method: 'GET',
    path: '/api/provenance/map',
    summary: 'The provenance map keyed by path (P-227).',
    response: jsonValueSchema,
    placeholderResponse: true,
  },
  {
    id: 'provenance.credits',
    method: 'GET',
    path: '/api/provenance/credits',
    summary: 'The generated credits document (P-222).',
    response: jsonValueSchema,
    placeholderResponse: true,
  },
  {
    id: 'provenance.sbom',
    method: 'GET',
    path: '/api/provenance/sbom',
    summary: 'The SPDX SBOM (P-119/P-227).',
    response: jsonValueSchema,
    placeholderResponse: true,
  },
  {
    id: 'sandbox.capabilities',
    method: 'GET',
    path: '/api/sandbox/capabilities',
    summary: 'What the sandbox can do on this machine (P-220).',
    response: jsonValueSchema,
    placeholderResponse: true,
  },
  {
    id: 'sandbox.result',
    method: 'GET',
    path: '/api/sandbox/:jobId',
    summary: 'The sandbox result for one job (P-220).',
    response: jsonValueSchema,
    placeholderResponse: true,
  },
  {
    id: 'session.export',
    method: 'GET',
    path: '/api/session/export',
    summary: 'Export the whole session as one bundle (P-230).',
    response: sessionBundleSchema,
    placeholderResponse: true,
  },
  {
    id: 'session.import',
    method: 'POST',
    path: '/api/session/import',
    summary: 'Import a session bundle and report what was dropped (P-230).',
    request: sessionBundleSchema,
    response: sessionImportResponseSchema,
    placeholderResponse: true,
  },
  {
    id: 'settings.get',
    method: 'GET',
    path: '/api/settings',
    summary: 'The effective settings (P-225). Live route; null until P-225 wires it.',
    response: z.union([settingsDataSchema, z.null()]),
  },
  {
    id: 'settings.patch',
    method: 'PATCH',
    path: '/api/settings',
    summary: 'Patch settings through the P-229 funnel.',
    request: settingsPatchSchema,
    response: settingsDataSchema,
    placeholderResponse: true,
  },
];

/** Split a path into its non-empty segments. */
function segments(path: string): readonly string[] {
  return path.split('/').filter(segment => segment !== '');
}

/** Resolve a concrete path against a template (`/api/jobs/:jobId`). */
export function pathMatches(template: string, path: string): boolean {
  const templateParts = segments(template);
  const pathParts = segments(path);
  if (templateParts.length !== pathParts.length) return false;
  return templateParts.every((part, index) => {
    if (part.startsWith(':')) return (pathParts[index] ?? '').length > 0;
    return part === pathParts[index];
  });
}

/** Extract the `:param` values a concrete path carries. */
export function pathParams(template: string, path: string): Record<string, string> {
  const templateParts = segments(template);
  const pathParts = segments(path);
  const params: Record<string, string> = {};
  templateParts.forEach((part, index) => {
    if (!part.startsWith(':')) return;
    const value = pathParts[index];
    if (value !== undefined) params[part.slice(1)] = value;
  });
  return params;
}

/** Find the route a request addresses, or undefined when nothing matches. */
export function findApiRoute(method: string, path: string): ApiRoute | undefined {
  const wanted = method.toUpperCase();
  return API_ROUTES.find(route => route.method === wanted && pathMatches(route.path, path));
}

/** Every route, in table order (the OpenAPI document uses this). */
export function listApiRoutes(): readonly ApiRoute[] {
  return API_ROUTES;
}

/** Look a route up by id (`jobs.list`). */
export function findApiRouteById(id: string): ApiRoute | undefined {
  return API_ROUTES.find(route => route.id === id);
}

function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

/** One readable line per zod issue, so a 422 can say what was wrong. */
export function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(body)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Validate an inbound body against a route's request schema.
 *
 * A route without a request body accepts anything (GET) — that is not a
 * failure, and a body sent to it is ignored rather than refused.
 */
export function validateApiRequest(routeId: string, body: unknown): Result<unknown, StitchError> {
  const route = findApiRouteById(routeId);
  if (route === undefined) {
    return err(configError('api.route', `no API route is registered as ${routeId}`));
  }
  if (route.request === undefined) return ok(body);
  const parsed = route.request.safeParse(body);
  if (parsed.success) return ok(parsed.data);
  return err(
    configError(
      'api.request',
      `${route.method} ${route.path} was sent a body that does not match its schema: ${describeIssues(parsed.error.issues)}`
    )
  );
}

/** Validate an outbound body against a route's response schema. */
export function validateApiResponse(routeId: string, body: unknown): Result<unknown, StitchError> {
  const route = findApiRouteById(routeId);
  if (route === undefined) {
    return err(configError('api.route', `no API route is registered as ${routeId}`));
  }
  const parsed = route.response.safeParse(body);
  if (parsed.success) return ok(parsed.data);
  return err(
    configError(
      'api.response',
      `${route.method} ${route.path} answered with a body that does not match its schema: ${describeIssues(parsed.error.issues)}`
    )
  );
}

/** The routes `serve` does not implement yet (its honest placeholder list). */
export function placeholderRoutes(): readonly ApiRoute[] {
  return API_ROUTES.filter(route => route.placeholderResponse === true);
}
