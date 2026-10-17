// Client contracts for the sandbox results view (P-221).
// The serve endpoints (/api/sandbox/result, /api/sandbox/capabilities,
// /api/sandbox/artifact) do NOT exist yet — P-192's handler map is deferred —
// so these are the web-side contracts the server must satisfy (P-177 / P-178
// aggregates). Wire types are LOCAL: web's tsconfig rootDir cannot pull the
// @repo-stitcher/core barrel (TS6059, P-219 precedent). Field semantics mirror
// core's BuildResult {pass, command, exitCode, durationMs, logs} and the
// P-176 verify verdict.
import { describeFailure } from './repos.js';

export type SandboxBackendKind = 'docker' | 'gh-fallback' | 'unavailable';

export interface SandboxCapabilities {
  backend: SandboxBackendKind;
  detail?: string;
}

export interface SandboxBuildInfo {
  status: 'ok' | 'failed';
  exit: number;
  durationMs: number;
  command?: string;
}

export interface SandboxTestFailure {
  name: string;
  message: string;
}

export interface SandboxTestsInfo {
  passed: number;
  failed: number;
  skipped: number;
  failures: SandboxTestFailure[];
}

export interface SandboxLogSection {
  name: string;
  lines: string[];
}

export interface SandboxArtifact {
  path: string;
  size?: number;
}

export interface SandboxLimits {
  timeoutMs: number;
  memoryMb: number;
}

export type SandboxVerdict = 'pass' | 'fail' | 'warn';

export interface SandboxResult {
  jobId: string;
  build: SandboxBuildInfo;
  tests: SandboxTestsInfo;
  logs: SandboxLogSection[];
  artifacts: SandboxArtifact[];
  limits: SandboxLimits;
  verdict: SandboxVerdict;
}

export async function getSandboxResult(jobId: string): Promise<SandboxResult> {
  const response = await fetch(`/api/sandbox/result/${encodeURIComponent(jobId)}`);
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as SandboxResult;
}

export async function getSandboxCapabilities(): Promise<SandboxCapabilities> {
  const response = await fetch('/api/sandbox/capabilities');
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as SandboxCapabilities;
}
