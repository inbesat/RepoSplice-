// P-219 — deps conflict API (client contract). `serve` does not expose
// /api/deps yet (P-116/P-197 land the CLI path first); the endpoint is
// P-192 handler-map work. Same fetch pattern as api/repos.ts: plain async
// fns that throw on !ok with the server JSON message.
//
// The wire types mirror core's DependencyReport (packages/core/src/deps/
// types.ts) structurally and are KEPT LOCAL: the web tsconfig's rootDir
// cannot pull the @repo-stitcher/core barrel (P-218 tsc evidence), and the
// client only ever sees the serialized shape anyway (P-197 handoff: keep
// the report shape flat + stable for the API).

export type ConflictStatus = 'auto-resolved' | 'needs-attention' | 'warning';

export interface DepsConflictEntry {
  type: 'version' | 'peer' | 'script' | 'config';
  package: string;
  values: Record<string, string>;
  suggestedResolution?: string;
  dedupeStrategy?: 'hoist' | 'nest' | 'error';
  severity: 'error' | 'warning';
  status: ConflictStatus;
  resolution?: string;
}

export interface DependencyReport {
  generatedAt: string;
  ecosystem: 'npm' | 'python' | 'cargo' | 'go';
  inputSources: { repoName: string; manifestPath: string }[];
  merged: object;
  dependencyCount: { direct: number; dev: number; peer: number; total: number };
  conflicts: DepsConflictEntry[];
  dedupe: object[];
  scripts: { merged: Record<string, string>; collisions: DepsConflictEntry[] };
  lockfile: {
    status: 'generated' | 'failed' | 'skipped';
    path?: string;
    command?: string;
    error?: string;
  } | null;
  summary: { mergeable: boolean; needsHuman: boolean; blockedBy: string[] };
}

export async function getDepsReport(): Promise<DependencyReport> {
  const response = await fetch('/api/deps/report');
  if (!response.ok) {
    throw new Error(await import('./repos.js').then(m => m.describeFailure(response)));
  }
  return (await response.json()) as DependencyReport;
}

export async function resolveDep(pkg: string, resolution: string): Promise<void> {
  const response = await fetch('/api/deps/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: pkg, resolution }),
  });
  if (!response.ok) {
    throw new Error(await import('./repos.js').then(m => m.describeFailure(response)));
  }
}
