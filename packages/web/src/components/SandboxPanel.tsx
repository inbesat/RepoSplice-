// Sandbox results panel (P-221): capabilities header, build/tests cards,
// limits line, log viewers, artifacts, and the pass/fail/warn verdict badge.
// Self-fetching like DepsPanel/LicensePanel; emits the approve-gate outcome to
// the sandbox store (a fail blocks, a warn blocks until acknowledged).
import { useEffect, useState } from 'react';
import {
  getSandboxCapabilities,
  getSandboxResult,
  type SandboxBackendKind,
  type SandboxResult,
  type SandboxVerdict,
} from '../api/sandbox.js';
import { useSandboxStore } from '../store/sandbox.js';
import { BuildLog } from './BuildLog.js';

export interface SandboxPanelProps {
  jobId: string;
}

const BACKEND_CLASS: Record<SandboxBackendKind, string> = {
  docker: 'text-success',
  'gh-fallback': 'text-warning',
  unavailable: 'text-danger',
};

const VERDICT_CLASS: Record<SandboxVerdict, string> = {
  pass: 'text-success',
  fail: 'text-danger',
  warn: 'text-warning',
};

export function SandboxPanel({ jobId }: SandboxPanelProps) {
  const setSandboxOutcome = useSandboxStore(s => s.setSandboxOutcome);
  const [caps, setCaps] = useState<SandboxBackendKind | null>(null);
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setResult(null);
    setCaps(null);
    setAcknowledged(false);
    void (async () => {
      try {
        const [capabilities, sandboxResult] = await Promise.all([
          getSandboxCapabilities(),
          getSandboxResult(jobId),
        ]);
        if (cancelled) return;
        setCaps(capabilities.backend);
        setResult(sandboxResult);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const verdict = result?.verdict;
  useEffect(() => {
    if (verdict === undefined) return;
    const blockers: string[] = [];
    if (verdict === 'fail') {
      blockers.push('sandbox failed — the merged C must build and test green before approval');
    } else if (verdict === 'warn' && !acknowledged) {
      blockers.push('sandbox warn — acknowledge the warning to approve');
    }
    setSandboxOutcome({
      sandboxPass: verdict === 'pass' || (verdict === 'warn' && acknowledged),
      blockers,
    });
  }, [verdict, acknowledged, setSandboxOutcome]);

  if (error !== null)
    return (
      <div role="alert" className="text-body text-danger">
        ✘ {error}
      </div>
    );
  if (result === null || caps === null)
    return <p className="text-body text-muted">Loading sandbox results…</p>;

  return (
    <section aria-label="sandbox results">
      <p className="text-body">
        Sandbox:{' '}
        <span data-testid="sandbox-backend" className={BACKEND_CLASS[caps]}>
          {caps}
        </span>
        {caps === 'unavailable' ? ' — merged C was not verified' : ''}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div aria-label="sandbox build" className="border border-border bg-surface p-3">
          <h3 className="text-title">Build</h3>
          <p className="text-body">
            {result.build.status} · exit {result.build.exit} ·{' '}
            {(result.build.durationMs / 1000).toFixed(1)}s
          </p>
        </div>
        <div aria-label="sandbox tests" className="border border-border bg-surface p-3">
          <h3 className="text-title">Tests</h3>
          <p className="text-body">
            {result.tests.passed} passed · {result.tests.failed} failed · {result.tests.skipped}{' '}
            skipped
          </p>
          <ul aria-label="test failures">
            {result.tests.failures.map(failure => (
              <li key={failure.name} className="text-caption text-danger">
                {failure.name} — {failure.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p data-testid="sandbox-limits" className="text-caption text-muted">
        limits: {Math.round(result.limits.timeoutMs / 1000)}s timeout · {result.limits.memoryMb} MB
        memory
      </p>
      {result.logs.map(log => (
        <BuildLog key={log.name} name={log.name} lines={log.lines} />
      ))}
      <div aria-label="sandbox artifacts" className="mt-2">
        <h3 className="text-title">Artifacts</h3>
        {result.artifacts.length === 0 ? (
          <p className="text-caption text-muted">No artifacts produced.</p>
        ) : (
          <ul>
            {result.artifacts.map(artifact => (
              <li key={artifact.path}>
                <a
                  href={`/api/sandbox/artifact/${encodeURIComponent(jobId)}?path=${encodeURIComponent(artifact.path)}`}
                  download
                  className="text-body text-primary underline"
                >
                  {artifact.path}
                </a>
                {artifact.size !== undefined ? (
                  <span className="text-caption text-muted">
                    {' '}
                    ({Math.max(1, Math.round(artifact.size / 1024))} KB)
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {verdict !== undefined && (
        <p data-testid="sandbox-verdict" className={`text-title ${VERDICT_CLASS[verdict]}`}>
          verdict: {verdict}
          {verdict === 'pass' ? ' — verified' : ''}
        </p>
      )}
      {verdict === 'warn' && !acknowledged && (
        <button
          type="button"
          onClick={() => setAcknowledged(true)}
          className="text-body text-warning underline"
        >
          Acknowledge warning
        </button>
      )}
    </section>
  );
}
