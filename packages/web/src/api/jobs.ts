// P-224 — job-history client contracts.
//
// CLIENT CONTRACT: the serve endpoints do not exist yet (P-247 job store and
// the P-192 handler-map are deferred). These shapes mirror what P-247 will
// persist and what `stitch status` (P-194) reads back, per the P-224
// handoff note: keep JobSummary fields stable.
//
// The realtime side is the 'jobs' WS topic (P-223 transport): every job
// event (added or updated) arrives as a bare JobSummary envelope payload;
// HistoryPage prepends unseen ids and patches known ones.

import { describeFailure } from './repos.js';

export type JobKind = 'merge' | 'verify';

export type JobStatus = 'running' | 'succeeded' | 'failed';

export interface JobSummary {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** ISO timestamp of when the job started. */
  started: string;
  /** ISO timestamp of when the job finished (absent while running). */
  finished?: string;
  durationMs?: number;
  /** One-line result summary, e.g. '12 files · 3 deps · 2 licenses'. */
  result?: string;
}

export interface JobDetail {
  summary: JobSummary;
  /** Placeholder for P-181 provenance / P-177 sandbox / P-186 checksums. */
  extras?: Record<string, unknown>;
}

/** GET /api/jobs — the history list (newest first is the server's job). */
export async function getJobs(): Promise<JobSummary[]> {
  const response = await fetch('/api/jobs');
  if (!response.ok) throw new Error(await describeFailure(response));
  const body = (await response.json()) as { jobs?: JobSummary[] } | JobSummary[];
  return Array.isArray(body) ? body : (body.jobs ?? []);
}

/** GET /api/jobs/<id> — full detail (provenance, sandbox, checksums). */
export async function getJob(id: string): Promise<JobDetail> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as JobDetail;
}

/**
 * POST /api/jobs/<id>/rerun — re-POSTs the job (P-192 with saved sources).
 * Returns the fresh JobSummary of the new run.
 */
export async function rerunJob(id: string): Promise<JobSummary> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: id }),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as JobSummary;
}
