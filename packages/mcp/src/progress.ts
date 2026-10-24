// P-361 - the MCP progress channel for long-running merge jobs.
//
// P-241's job stream is the source of truth: every snapshot a job provider
// publishes becomes one `notifications/progress` frame carrying the caller's
// progress token and an integer `progress`/`total` pair, so a host UI can draw
// a live bar without polling `stitch_job_status`. The payload lives here and
// nowhere else, so the merge tool and the status tool cannot drift apart.
//
// The shapes here are the MCP-standard ones: `progress` and `total` are
// numbers and the message is optional. The progress token is what identifies
// the job to the host that asked for it, so no job id is carried in the frame.

import type {
  MergeJobListener,
  MergeJobSnapshot,
  MergeJobStatus,
  MergePorts,
} from './tools/merge.js';

/** The MCP notification method a progress frame is sent under. */
export const PROGRESS_METHOD = 'notifications/progress' as const;

/** An MCP `notifications/progress` frame. */
export interface ProgressNotification {
  readonly jsonrpc: '2.0';
  readonly method: typeof PROGRESS_METHOD;
  readonly params: {
    readonly progressToken: string | number;
    readonly progress: number;
    readonly total: number;
    readonly message?: string;
  };
}

/** The part of a job snapshot a progress frame is built from. */
export interface JobProgress {
  readonly progress: number;
  readonly total: number;
  readonly message?: string;
}

/** A subscription that stops itself once the job reaches a terminal state. */
export interface ProgressBridge {
  readonly listener: MergeJobListener;
  attach(release: () => void): void;
}

const TERMINAL_STATUSES: readonly MergeJobStatus[] = ['succeeded', 'failed', 'cancelled'];

/** Whether a job status can no longer change. */
export function isTerminalStatus(status: MergeJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Build the MCP frame for one progress reading. */
export function toProgressNotification(
  progressToken: string | number,
  progress: number,
  total: number,
  message?: string
): ProgressNotification {
  return {
    jsonrpc: '2.0',
    method: PROGRESS_METHOD,
    params: {
      progressToken,
      progress,
      total,
      ...(message !== undefined ? { message } : {}),
    },
  };
}

/**
 * Read one snapshot as a progress reading.
 *
 * A terminal snapshot reports the whole job as done, so completion always
 * lands on `progress === total` whichever way the job ended.
 */
export function describeJobProgress(snapshot: MergeJobSnapshot): JobProgress {
  const { completed, total } = snapshot.progress;
  const progress = isTerminalStatus(snapshot.status) ? total : completed;
  const message = snapshot.progress.message ?? snapshot.progress.stage;
  return {
    progress,
    total,
    ...(message !== undefined ? { message } : {}),
  };
}

/**
 * Subscribe to a job's snapshots and forward each one as an MCP progress frame.
 *
 * `attach` is separate from the listener because `subscribe` can deliver a
 * snapshot (including a terminal one) before it hands back the function that
 * releases the subscription; when that happens the release runs as soon as it
 * arrives, so a finished job never leaves a live listener behind.
 */
export function createJobProgressBridge(
  ports: MergePorts,
  _jobId: string,
  progressToken: string | number
): ProgressBridge {
  let release: (() => void) | undefined;
  let released = false;

  const stop = (): void => {
    if (released) return;
    released = true;
    if (release !== undefined) release();
  };

  const listener: MergeJobListener = snapshot => {
    const described = describeJobProgress(snapshot);
    ports.notify(
      toProgressNotification(progressToken, described.progress, described.total, described.message)
    );
    if (isTerminalStatus(snapshot.status)) stop();
  };

  return {
    listener,
    attach: (releaseSubscription: () => void): void => {
      release = releaseSubscription;
      if (released) releaseSubscription();
    },
  };
}
