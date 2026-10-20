// P-224 — the job-history page (not yet mounted in the router; the specs
// table P-210 built has no history route — ADR-109).
//
// CLIENT CONTRACT: GET /api/jobs and the 'jobs' WS topic don't exist yet
// (P-247/P-192 deferred). Live events arrive as bare JobSummary payloads on
// the 'jobs' topic: unseen ids are prepended, known ones patched in place.
// Tests inject `feed` so they never touch the real WsClient.

import { useEffect, useMemo, useState } from 'react';
import { wsClient } from '../lib/ws.js';
import { getJobs, rerunJob, type JobKind, type JobStatus, type JobSummary } from '../api/jobs.js';
import { JobRow } from '../components/JobRow.js';

// shortcut: render cap instead of virtualization (no direct list-virtualizer
// dep) — upgrade to react-window if real histories exceed a few hundred.
const MAX_RENDER = 300;

export type JobFeed = (handler: (job: JobSummary) => void) => () => void;

export const JOBS_TOPIC = 'jobs';

function defaultFeed(handler: (job: JobSummary) => void): () => void {
  if (typeof WebSocket === 'undefined') return () => undefined;
  wsClient.connect();
  return wsClient.subscribe<JobSummary>(JOBS_TOPIC, handler);
}

export interface HistoryPageProps {
  /** Injectable live feed (tests). Defaults to the shared WsClient. */
  feed?: JobFeed;
}

type KindFilter = 'all' | JobKind;
type StatusFilter = 'all' | JobStatus;

const KIND_OPTIONS: KindFilter[] = ['all', 'merge', 'verify'];
const STATUS_OPTIONS: StatusFilter[] = ['all', 'running', 'succeeded', 'failed'];

export function HistoryPage({ feed }: HistoryPageProps) {
  const [jobs, setJobs] = useState<readonly JobSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJobs()
      .then(list => {
        if (!cancelled) {
          setJobs(list);
          setLoaded(true);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      (feed ?? defaultFeed)(job =>
        setJobs(prev =>
          prev.some(j => j.id === job.id)
            ? prev.map(j => (j.id === job.id ? job : j))
            : [job, ...prev]
        )
      ),
    [feed]
  );

  const visible = useMemo(
    () =>
      jobs.filter(
        j => (kind === 'all' || j.kind === kind) && (status === 'all' || j.status === status)
      ),
    [jobs, kind, status]
  );

  const handleRerun = (job: JobSummary): void => {
    setRerunningId(job.id);
    rerunJob(job.id)
      .then(fresh => setJobs(prev => [fresh, ...prev]))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRerunningId(null));
  };

  return (
    <section aria-label="job history">
      <h2 className="text-title text-text">History</h2>
      {error !== null ? (
        <div role="alert" className="text-body text-danger">
          ✘ {error}
        </div>
      ) : null}
      <div className="mb-3 flex gap-3">
        <select
          aria-label="filter kind"
          value={kind}
          onChange={e => setKind(e.target.value as KindFilter)}
          className="border-border bg-surface text-caption text-text"
        >
          {KIND_OPTIONS.map(k => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          aria-label="filter status"
          value={status}
          onChange={e => setStatus(e.target.value as StatusFilter)}
          className="border-border bg-surface text-caption text-text"
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {!loaded && error === null ? <p className="text-body text-muted">Loading history…</p> : null}
      {loaded && jobs.length === 0 && error === null ? (
        <p className="text-body text-muted">No jobs yet.</p>
      ) : null}
      <ul aria-label="job list">
        {visible.slice(0, MAX_RENDER).map(job => (
          <li key={job.id}>
            <JobRow job={job} rerunning={rerunningId === job.id} onRerun={handleRerun} />
          </li>
        ))}
      </ul>
      {visible.length > MAX_RENDER ? (
        <p className="text-caption text-muted">
          Showing the latest {MAX_RENDER} of {visible.length} jobs.
        </p>
      ) : null}
    </section>
  );
}
