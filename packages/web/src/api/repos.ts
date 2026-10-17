// P-211 — the `/api/repos/*` client contract.
//
// THE HANDOFF NOTE: "The `/api/repos/*` contract is set here." The CLI server
// (P-193) serves /health, /api/provenance|jobs|settings — the repos endpoints
// do NOT exist yet (checked); the shapes below are the contract the server
// side must implement. Until then every call 404s in a live `stitch serve`
// — harmless (the error surfaces), and the tests mock fetch.
//
// Plain async functions that THROW on non-ok: the picker catches and renders
// the message (P-228 surfaces it; no neverthrow on the web side — fetch
// rejection IS the error path).

export interface SourceRecord {
  readonly id: string;
  readonly kind: 'github' | 'local';
  /** `owner/repo` (github kind). */
  readonly repo?: string;
  /** Filesystem path (local kind). */
  readonly path?: string;
  /** Optional ref (branch/tag/sha) for github sources. */
  readonly ref?: string;
  /** P-215's status field, seeded `ready` on success. */
  readonly status: 'ready' | 'pending' | 'error';
}

/** GET /api/repos/sources — every source the CLI knows about. */
export async function listSources(): Promise<SourceRecord[]> {
  const response = await fetch('/api/repos/sources');
  if (!response.ok) throw new Error(`listSources failed: ${response.status}`);
  const body = (await response.json()) as { sources?: SourceRecord[] };
  return body.sources ?? [];
}

/** POST /api/repos/from-url — add a GitHub source (owner/repo + ref). */
export async function addSourceUrl(input: {
  ownerRepo: string;
  ref?: string;
}): Promise<SourceRecord> {
  const response = await fetch('/api/repos/from-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as SourceRecord;
}

/** POST /api/repos/local — add a local filesystem source. */
export async function addSourcePath(input: { path: string }): Promise<SourceRecord> {
  const response = await fetch('/api/repos/local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as SourceRecord;
}

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
