// P-224 — one history row: status icon, kind, timestamp, duration,
// expand-to-detail, and a re-run button.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import type { JobStatus, JobSummary } from '../api/jobs.js';

const STATUS_ICON: Record<JobStatus, ReactNode> = {
  running: <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none text-primary" />,
  succeeded: <Check className="h-4 w-4 text-success" />,
  failed: <X className="h-4 w-4 text-danger" />,
};

/** Compact human duration (ms → '900 ms' / '3.2s' / '1m 30s'). */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export interface JobRowProps {
  job: JobSummary;
  /** A re-run POST is in flight for this row. */
  rerunning: boolean;
  onRerun: (job: JobSummary) => void;
}

export function JobRow({ job, rerunning, onRerun }: JobRowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-testid={`job-${job.id}`} className="border-b border-border py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`toggle ${job.id}`}
          onClick={() => setExpanded(e => !e)}
          className="flex items-center text-muted"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {STATUS_ICON[job.status]}
        <span className="text-body text-text">
          {job.kind} · <span data-testid={`job-id-${job.id}`}>{job.id}</span>
        </span>
        <span data-status={job.status} className="text-caption text-muted">
          {job.status}
        </span>
        <span className="text-caption text-muted">{new Date(job.started).toLocaleString()}</span>
        <span className="ml-auto text-caption text-muted">
          {job.durationMs !== undefined
            ? fmtDuration(job.durationMs)
            : job.status === 'running'
              ? 'running…'
              : '—'}
        </span>
        <button
          type="button"
          aria-label={`rerun ${job.id}`}
          disabled={rerunning}
          onClick={() => onRerun(job)}
          className="text-caption text-primary underline disabled:opacity-50"
        >
          Re-run
        </button>
      </div>
      {expanded ? (
        <div data-testid={`detail-${job.id}`} className="mt-2 pl-10">
          <p className="text-body text-text">{job.result ?? 'No result summary yet.'}</p>
          {job.result !== undefined ? (
            <p className="mt-1 flex gap-3 text-caption">
              <a href="/results" className="text-primary underline">
                Sandbox result
              </a>
              <a href="/results" className="text-primary underline">
                CREDITS
              </a>
              <a href="/review" className="text-primary underline">
                Proposed diff
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
