// P-252 — the generated web client for the CLI server API.
//
// DERIVED, never hand-invented: every path and type traces to the contract in
// `packages/core/src/api/contract.ts` (ADR-176). The types are the contract's
// own schema types (`z.infer` over the barrel's type-only namespace), so a
// schema change breaks this file at compile time instead of at runtime. The
// paths are literals — what a codegen emits — and `contract.conform.spec.ts`
// asserts each one still exists in `API_ROUTES`, which is the CI drift gate.
//
// Runtime-wise this file imports NOTHING from core: the web bundle must not
// carry zod. Function names and shapes match the hand-rolled wrappers they
// replace (P-211-P-230) so no call site had to change.

import type {
  MergeApproveRequest,
  MergeRejectRequest,
  MergeRunRequest,
  MergeSummary,
  SessionBundle,
  SettingsData,
  SettingsPatch,
  SourceRecord,
  TreeEntry,
  TreePage,
} from '@repo-stitcher/shared';

// --- contract-version marker (asserted equal to the core constant) ---------
export const GENERATED_CLIENT_CONTRACT_VERSION = '1.0.0';

// --- types -----------------------------------------------------------------
// The wire shapes come from `@repo-stitcher/shared` (P-315), the package the
// core schemas in P-252's contract.ts mirror; the web package already depends
// on it, so neither core nor zod reaches the browser bundle.
export type SourceRecordWire = SourceRecord;
export type TreeEntryWire = TreeEntry;
export type TreePageWire = TreePage;
export type MergeSummaryWire = MergeSummary;
export type MergeRunRequestWire = MergeRunRequest;
export type MergeApproveRequestWire = MergeApproveRequest;
export type MergeRejectRequestWire = MergeRejectRequest;
export type SessionBundleWire = SessionBundle;
export type SettingsDataWire = SettingsData;
export type SettingsPatchWire = SettingsPatch;

/** Job shapes are web-local today (packages/web/src/api/jobs.ts) — kept identical. */
export type JobKindWire = 'merge' | 'verify';
export type JobStatusWire = 'running' | 'succeeded' | 'failed';
export interface JobSummaryWire {
  id: string;
  kind: JobKindWire;
  status: JobStatusWire;
  started: string;
  finished?: string;
  durationMs?: number;
  result?: string;
}
export interface JobDetailWire {
  summary: JobSummaryWire;
  extras?: Record<string, unknown>;
}

/** `/health` (P-193). */
export interface HealthWire {
  ok: true;
  service: 'stitch';
  version: string;
}

/** One generated route: the method and path this client calls. */
export interface GeneratedRoute {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
}

/** Every route this client uses, in id order (the drift gate reads this). */
export const GENERATED_CLIENT_ROUTES: readonly GeneratedRoute[] = [
  { id: 'health', method: 'GET', path: '/health' },
  { id: 'repos.sources', method: 'GET', path: '/api/repos/sources' },
  { id: 'repos.fromUrl', method: 'POST', path: '/api/repos/from-url' },
  { id: 'repos.local', method: 'POST', path: '/api/repos/local' },
  { id: 'repos.tree', method: 'GET', path: '/api/repos/{id}/tree' },
  { id: 'deps.report', method: 'GET', path: '/api/deps/report' },
  { id: 'deps.resolve', method: 'POST', path: '/api/deps/resolve' },
  { id: 'jobs.list', method: 'GET', path: '/api/jobs' },
  { id: 'jobs.detail', method: 'GET', path: '/api/jobs/{jobId}' },
  { id: 'jobs.rerun', method: 'POST', path: '/api/jobs/{jobId}/rerun' },
  { id: 'licenses.report', method: 'GET', path: '/api/licenses/report' },
  { id: 'licenses.decide', method: 'POST', path: '/api/licenses/decide' },
  { id: 'merge.run', method: 'POST', path: '/api/merge' },
  { id: 'merge.approve', method: 'POST', path: '/api/merge/approve' },
  { id: 'merge.reject', method: 'POST', path: '/api/merge/reject' },
  { id: 'provenance.report', method: 'GET', path: '/api/provenance' },
  { id: 'provenance.map', method: 'GET', path: '/api/provenance/map' },
  { id: 'provenance.credits', method: 'GET', path: '/api/provenance/credits' },
  { id: 'provenance.sbom', method: 'GET', path: '/api/provenance/sbom' },
  { id: 'sandbox.capabilities', method: 'GET', path: '/api/sandbox/capabilities' },
  { id: 'sandbox.result', method: 'GET', path: '/api/sandbox/{jobId}' },
  { id: 'session.export', method: 'GET', path: '/api/session/export' },
  { id: 'session.import', method: 'POST', path: '/api/session/import' },
  { id: 'settings.get', method: 'GET', path: '/api/settings' },
  { id: 'settings.patch', method: 'PATCH', path: '/api/settings' },
];

// --- the transport ---------------------------------------------------------
/** The server's `message` when it speaks JSON, else the status line. */
export async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message !== undefined) return body.message;
  } catch {
    // Non-JSON body — fall through to the status text.
  }
  return `${response.status} ${response.statusText}`;
}

async function requestJson<T>(
  method: GeneratedRoute['method'],
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { method }
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
  );
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as T;
}

/** A route whose reply carries nothing the client needs. */
async function requestVoid(
  method: GeneratedRoute['method'],
  path: string,
  body?: unknown
): Promise<void> {
  const response = await fetch(
    path,
    body === undefined
      ? { method }
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
  );
  if (!response.ok) throw new Error(await describeFailure(response));
}

// --- system ----------------------------------------------------------------
export function getHealth(): Promise<HealthWire> {
  return requestJson<HealthWire>('GET', '/health');
}

// --- sources (P-211/P-215) -------------------------------------------------
export async function listSources(): Promise<SourceRecordWire[]> {
  const body = await requestJson<{ sources?: SourceRecordWire[] }>('GET', '/api/repos/sources');
  return body.sources ?? [];
}

export function addSourceUrl(input: {
  ownerRepo: string;
  ref?: string;
}): Promise<SourceRecordWire> {
  return requestJson<SourceRecordWire>('POST', '/api/repos/from-url', input);
}

export function addSourcePath(input: { path: string }): Promise<SourceRecordWire> {
  return requestJson<SourceRecordWire>('POST', '/api/repos/local', input);
}

/** `ref` selects the flat list mode; `dir`/`cursor` the paged one (P-232). */
export function getTree(repoId: string, ref?: string): Promise<TreeEntryWire[]> {
  const query = ref === undefined ? '' : `?ref=${encodeURIComponent(ref)}`;
  return requestJson<TreeEntryWire[]>(
    'GET',
    `/api/repos/${encodeURIComponent(repoId)}/tree${query}`
  );
}

export function getTreePage(repoId: string, dir: string, cursor?: string): Promise<TreePageWire> {
  const params = new URLSearchParams({ dir });
  if (cursor !== undefined) params.set('cursor', cursor);
  return requestJson<TreePageWire>(
    'GET',
    `/api/repos/${encodeURIComponent(repoId)}/tree?${params.toString()}`
  );
}

// --- dependencies (P-217) --------------------------------------------------
export function getDepsReport(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('GET', '/api/deps/report');
}

export function resolveDep(pkg: string, resolution: string): Promise<void> {
  return requestVoid('POST', '/api/deps/resolve', { pkg, resolution });
}

// --- jobs (P-247) ----------------------------------------------------------
export async function getJobs(): Promise<JobSummaryWire[]> {
  const body = await requestJson<JobSummaryWire[] | { jobs?: JobSummaryWire[] }>(
    'GET',
    '/api/jobs'
  );
  return Array.isArray(body) ? body : (body.jobs ?? []);
}

export function getJob(id: string): Promise<JobDetailWire> {
  return requestJson<JobDetailWire>('GET', `/api/jobs/${encodeURIComponent(id)}`);
}

export function rerunJob(id: string): Promise<JobSummaryWire> {
  return requestJson<JobSummaryWire>('POST', `/api/jobs/${encodeURIComponent(id)}/rerun`, {
    jobId: id,
  });
}

// --- licenses (P-220) ------------------------------------------------------
export function fetchLicenseReport(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('GET', '/api/licenses/report');
}

export function decideUnknown(licenseId: string, verdict: 'allow' | 'deny'): Promise<void> {
  return requestVoid('POST', '/api/licenses/decide', { licenseId, verdict });
}

// --- merge (P-192/P-160) ---------------------------------------------------
export function runMerge(input: {
  selectionA: readonly string[];
  selectionB: readonly string[];
}): Promise<MergeSummaryWire> {
  return requestJson<MergeSummaryWire>('POST', '/api/merge', {
    selectionA: input.selectionA,
    selectionB: input.selectionB,
  } satisfies MergeRunRequestWire);
}

export function approveMerge(input: {
  include: readonly string[];
  exclude: readonly string[];
  note: string;
}): Promise<MergeSummaryWire> {
  return requestJson<MergeSummaryWire>('POST', '/api/merge/approve', {
    include: input.include,
    exclude: input.exclude,
    note: input.note,
  } satisfies MergeApproveRequestWire);
}

export function rejectMerge(input: { reason: string }): Promise<void> {
  return requestVoid('POST', '/api/merge/reject', {
    reason: input.reason,
  } satisfies MergeRejectRequestWire);
}

// --- provenance (P-185/P-227) ----------------------------------------------
export function getProvenanceMap(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('GET', '/api/provenance/map');
}

export function getCredits(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('GET', '/api/provenance/credits');
}

export function getSbom(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('GET', '/api/provenance/sbom');
}

// --- sandbox (P-168/P-220) -------------------------------------------------
export function getSandboxCapabilities(): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('GET', '/api/sandbox/capabilities');
}

export function getSandboxResult(jobId: string): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>('GET', `/api/sandbox/${encodeURIComponent(jobId)}`);
}

// --- session (P-230) -------------------------------------------------------
export function exportSession(): Promise<SessionBundleWire> {
  return requestJson<SessionBundleWire>('GET', '/api/session/export');
}

export function importSession(bundle: SessionBundleWire): Promise<{ warnings: string[] }> {
  return requestJson<{ warnings: string[] }>('POST', '/api/session/import', bundle);
}

// --- settings (P-225/P-229/P-234) ------------------------------------------
export function getSettings(): Promise<SettingsDataWire> {
  return requestJson<SettingsDataWire>('GET', '/api/settings');
}

export function patchSettings(patch: SettingsPatchWire): Promise<SettingsDataWire> {
  return requestJson<SettingsDataWire>('PATCH', '/api/settings', patch);
}
