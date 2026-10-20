// P-213 — the `/api/repos/:id/tree` client contract.
//
// NOTE: the endpoint does NOT exist yet — the CLI server (P-193) serves only
// /health, /api/provenance|jobs|settings. The shape below is the contract the
// server side must implement: core's P-103 `listFiles` produces the flattened
// entries. Until then a live `stitch serve` 404s here — harmless (the error
// surfaces inline in the tree), and the tests mock fetch.
//
// Plain async function that THROWS on non-ok (mirror of api/repos.ts — no
// neverthrow on the web side; fetch rejection IS the error path).

export interface TreeEntry {
  /** Repo-relative POSIX path (`src/index.ts`). */
  readonly path: string;
  readonly type: 'file' | 'dir';
  /** Files: byte size. Directories: 0 (or the server's aggregate). */
  readonly size: number;
  /** Content hash, when the server has one (P-103's blobHash). */
  readonly blobSha?: string;
}

/** GET /api/repos/:id/tree?ref= — the FLAT entry list of one source. */
export async function getTree(repoId: string, ref?: string): Promise<TreeEntry[]> {
  const params = new URLSearchParams();
  if (ref !== undefined) params.set('ref', ref);
  const qs = params.toString();
  const response = await fetch(
    `/api/repos/${encodeURIComponent(repoId)}/tree${qs ? `?${qs}` : ''}`
  );
  if (!response.ok) throw new Error(await describeFailure(response));
  const body = (await response.json()) as { entries?: TreeEntry[] };
  return body.entries ?? [];
}

// P-232 — one directory page. The endpoint does not exist yet either (same
// client-contract situation); the server lane implements it from core's
// P-103 `listFiles` with paging so huge dirs hydrate on demand.
export interface TreePage {
  readonly entries: readonly TreeEntry[];
  readonly nextCursor?: string;
}

/** GET /api/repos/:id/tree?dir=&cursor= — the children of one directory. */
export async function getTreePage(repoId: string, dir: string, cursor?: string): Promise<TreePage> {
  const params = new URLSearchParams({ dir });
  if (cursor !== undefined) params.set('cursor', cursor);
  const response = await fetch(
    `/api/repos/${encodeURIComponent(repoId)}/tree?${params.toString()}`
  );
  if (!response.ok) throw new Error(await describeFailure(response));
  const body = (await response.json()) as {
    entries?: TreeEntry[];
    nextCursor?: string;
  };
  return {
    entries: body.entries ?? [],
    ...(body.nextCursor !== undefined ? { nextCursor: body.nextCursor } : {}),
  };
}

/** The server's `message` when it speaks JSON, else the status line. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message !== undefined) return body.message;
  } catch {
    // Non-JSON body — fall through to the status text.
  }
  return `${response.status} ${response.statusText}`;
}
