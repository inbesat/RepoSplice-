/** P-361 — the MCP progress payload, its snapshot mapping and its bridge. */

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import { describe, expect, it } from 'vitest';

import {
  PROGRESS_METHOD,
  createJobProgressBridge,
  describeJobProgress,
  isTerminalStatus,
  toProgressNotification,
  type ProgressNotification,
} from './progress.js';
import type { MergeJobSnapshot, MergeJobStatus, MergePorts } from './tools/merge.js';

const TOTAL = 100;

function snapshot(status: MergeJobStatus, completed: number, stage?: string): MergeJobSnapshot {
  return {
    jobId: 'job-1',
    status,
    progress: {
      completed,
      total: TOTAL,
      ...(stage !== undefined ? { stage } : {}),
    },
  };
}

interface Fake {
  readonly ports: MergePorts;
  readonly notifications: ProgressNotification[];
  releaseCount(): number;
}

/** A job provider whose only live member is the notification sink. */
function createFake(): Fake {
  const notifications: ProgressNotification[] = [];
  let releases = 0;
  const notUsed = async (): Promise<Result<never, StitchError>> =>
    err({ code: 'INTERNAL', message: 'the progress bridge does not use this port' });
  const ports: MergePorts = {
    createJob: notUsed,
    getJob: notUsed,
    cancelJob: notUsed,
    subscribe: async () =>
      ok(() => {
        releases += 1;
      }),
    notify: notification => {
      notifications.push(notification);
    },
  };
  return { ports, notifications, releaseCount: () => releases };
}

describe('toProgressNotification (P-361)', () => {
  it('builds the standard MCP frame without a message', () => {
    const frame = toProgressNotification('tok-1', 1, TOTAL);
    expect(frame).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 1, total: TOTAL },
    });
    expect(PROGRESS_METHOD).toBe('notifications/progress');
    expect('message' in frame.params).toBe(false);
  });

  it('carries the optional message and accepts a numeric token', () => {
    expect(toProgressNotification(7, TOTAL, TOTAL, 'deps')).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 7, progress: TOTAL, total: TOTAL, message: 'deps' },
    });
  });
});

describe('describeJobProgress (P-361)', () => {
  it('reports the completed count while the job runs', () => {
    expect(describeJobProgress(snapshot('running', 40))).toEqual({
      progress: 40,
      total: TOTAL,
    });
  });

  it('clamps a terminal snapshot to the total', () => {
    expect(describeJobProgress(snapshot('succeeded', 40)).progress).toBe(TOTAL);
    expect(describeJobProgress(snapshot('failed', 10)).progress).toBe(TOTAL);
    expect(describeJobProgress(snapshot('cancelled', 0)).progress).toBe(TOTAL);
  });

  it('turns the stage into the message, and an explicit message wins', () => {
    expect(describeJobProgress(snapshot('running', 1, 'deps')).message).toBe('deps');
    const explicit = describeJobProgress({
      jobId: 'job-1',
      status: 'running',
      progress: { completed: 1, total: TOTAL, stage: 'deps', message: 'resolving deps' },
    });
    expect(explicit.message).toBe('resolving deps');
  });
});

describe('isTerminalStatus (P-361)', () => {
  it('classifies every status', () => {
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });
});

describe('createJobProgressBridge (P-361)', () => {
  it('forwards every snapshot and releases on the first terminal one', () => {
    const fake = createFake();
    const bridge = createJobProgressBridge(fake.ports, 'job-1', 'tok-1');
    let released = 0;
    bridge.attach(() => {
      released += 1;
    });

    bridge.listener(snapshot('running', 40));
    bridge.listener(snapshot('succeeded', TOTAL));

    expect(fake.notifications.map(item => item.method)).toEqual([PROGRESS_METHOD, PROGRESS_METHOD]);
    expect(fake.notifications.map(item => item.params.progress)).toEqual([40, TOTAL]);
    expect(fake.notifications.map(item => item.params.total)).toEqual([TOTAL, TOTAL]);
    expect(fake.notifications.map(item => item.params.progressToken)).toEqual(['tok-1', 'tok-1']);
    expect(released).toBe(1);
  });

  it('releases once even after several terminal snapshots', () => {
    const fake = createFake();
    const bridge = createJobProgressBridge(fake.ports, 'job-1', 'tok-1');
    let released = 0;
    bridge.attach(() => {
      released += 1;
    });

    bridge.listener(snapshot('succeeded', TOTAL));
    bridge.listener(snapshot('failed', TOTAL));

    expect(released).toBe(1);
  });

  it('releases a subscription that only arrives after the job settled', () => {
    const fake = createFake();
    const bridge = createJobProgressBridge(fake.ports, 'job-1', 42);
    bridge.listener(snapshot('cancelled', 0));

    let released = 0;
    bridge.attach(() => {
      released += 1;
    });

    expect(released).toBe(1);
    expect(fake.notifications.map(item => item.params.progress)).toEqual([TOTAL]);
  });

  it('never carries a job id in the frame', () => {
    const fake = createFake();
    const bridge = createJobProgressBridge(fake.ports, 'job-1', 'tok-1');
    bridge.listener(snapshot('running', 5));

    expect(Object.keys(fake.notifications[0]?.params ?? {}).sort()).toEqual([
      'progress',
      'progressToken',
      'total',
    ]);
    expect(fake.releaseCount()).toBe(0);
  });
});
