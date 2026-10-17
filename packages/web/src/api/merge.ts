// P-216 — the `/api/merge` client contract (POST starts the merge; P-218
// extends this module with approve/reject). The endpoint does NOT exist yet
// (the P-192 handler-map deferred it) — same posture as api/repos.ts: shapes
// below are the contract the server side must implement, tests mock fetch.

import { describeFailure } from './repos.js';

/** Final merge summary the server returns on success (client contract). */
export interface MergeSummary {
  readonly files: number;
  readonly deps: string[];
  readonly licenses: string[];
}

/** Body: the A/B selections (sorted repo-relative paths, ADR-099). */
export async function runMerge(input: {
  selectionA: readonly string[];
  selectionB: readonly string[];
}): Promise<MergeSummary> {
  const response = await fetch('/api/merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      selectionA: input.selectionA,
      selectionB: input.selectionB,
    }),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as MergeSummary;
}

export { describeFailure };
