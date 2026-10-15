// P-177 — deterministic cleanup tests.
//
// The client is a fake that RECORDS every removal, so the assertions are about
// what cleanup actually asked the daemon to remove (and what it deliberately
// left alone). One case drives the real `runVerification` so the `finally`
// guarantee is exercised on the failure path rather than asserted by
// construction.
//
// The six required scenarios from the phase spec:
//
//   it('removes tracked containers')     it('prunes ephemeral images only')
//   it('removes temp dirs')              it('runs in finally on failure')
//   it('degrades errors to warnings')    it('logs summary')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { CleanupTracker, cleanupSandbox, withCleanup, type CleanupClient } from './cleanup.js';
import { runVerification } from './runner.js';

interface FakeCleanupClient extends CleanupClient {
  calls: string[];
  removedImages: string[];
}

function makeFakeClient(
  failures: Partial<Record<'image' | 'volume' | 'network' | 'prune', StitchError>> = {}
): FakeCleanupClient {
  const calls: string[] = [];
  const removedImages: string[] = [];
  return {
    calls,
    removedImages,
    async rm(id: string) {
      calls.push(`rm:${id}`);
    },
    async removeImage(ref: string): Promise<Result<void, StitchError>> {
      calls.push(`image:${ref}`);
      if (failures.image !== undefined) return err(failures.image);
      removedImages.push(ref);
      return ok(undefined);
    },
    async removeVolume(name: string): Promise<Result<void, StitchError>> {
      calls.push(`volume:${name}`);
      return failures.volume !== undefined ? err(failures.volume) : ok(undefined);
    },
    async removeNetwork(id: string): Promise<Result<void, StitchError>> {
      calls.push(`network:${id}`);
      return failures.network !== undefined ? err(failures.network) : ok(undefined);
    },
    async pruneImages(): Promise<Result<number, StitchError>> {
      calls.push('prune');
      return failures.prune !== undefined ? err(failures.prune) : ok(3);
    },
  };
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-cleanup-'));
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('P-177 cleanup', () => {
  it('removes tracked containers', async () => {
    const client = makeFakeClient();
    const tracker = new CleanupTracker();
    expect(tracker.track({ kind: 'container', id: 'c1' })).toBe(true);
    tracker.track({ kind: 'container', id: 'c2' });
    // Tracking the same resource twice is idempotent (a retry must not cause a
    // second removal that fails against a gone container).
    expect(tracker.track({ kind: 'container', id: 'c1' })).toBe(false);
    expect(tracker.size).toBe(2);

    const summary = await cleanupSandbox(client, tracker);
    expect(client.calls).toEqual(['rm:c1', 'rm:c2']);
    expect(summary.removed.map(r => r.id)).toEqual(['c1', 'c2']);
    expect(summary.errors).toEqual([]);

    // Volumes and networks are swept too, after the containers that hold them.
    const second = makeFakeClient();
    const second2 = new CleanupTracker();
    second2.track({ kind: 'container', id: 'c' });
    second2.track({ kind: 'volume', id: 'v' });
    second2.track({ kind: 'network', id: 'n' });
    await cleanupSandbox(second, second2);
    expect(second.calls).toEqual(['rm:c', 'volume:v', 'network:n']);
  });

  it('prunes ephemeral images only', async () => {
    const client = makeFakeClient();
    const tracker = new CleanupTracker();
    tracker.track({ kind: 'image', id: 'stitch-node:stitch-ephemeral-ab12cd34ef56' });
    // A pulled pinned base is reused next run and is NOT ours to delete.
    tracker.track({ kind: 'image', id: 'oven/bun:1.1' });

    const summary = await cleanupSandbox(client, tracker);
    expect(client.calls).toEqual(['image:stitch-node:stitch-ephemeral-ab12cd34ef56']);
    expect(summary.removed).toHaveLength(1);
    expect(summary.preservedImages).toEqual(['oven/bun:1.1']);
    // No daemon-wide prune by default — that is not ours to run.
    expect(client.calls).not.toContain('prune');
    expect(summary.prunedImages).toBe(0);

    // …and the opt-in prune runs only when asked.
    const pruned = makeFakeClient();
    const summary2 = await cleanupSandbox(pruned, new CleanupTracker(), { pruneImages: true });
    expect(pruned.calls).toEqual(['prune']);
    expect(summary2.prunedImages).toBe(3);
  });

  it('removes temp dirs', async () => {
    const workspace = join(root, 'workspace');
    await mkdir(join(workspace, 'nested'), { recursive: true });
    const tracker = new CleanupTracker();
    tracker.track({ kind: 'tempDir', id: workspace });

    const summary = await cleanupSandbox(makeFakeClient(), tracker);
    expect(summary.removed.map(r => r.kind)).toEqual(['tempDir']);
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });

    // A non-existent dir is not an error (force: true), so a double cleanup is
    // harmless.
    const again = await cleanupSandbox(makeFakeClient(), tracker);
    expect(again.errors).toEqual([]);
  });

  it('runs in finally on failure', async () => {
    const workspace = join(root, 'failure-workspace');
    await mkdir(workspace, { recursive: true });
    const tracker = new CleanupTracker();
    tracker.track({ kind: 'tempDir', id: workspace });

    // A body that FAILS its Result: cleanup still runs.
    const failed = await withCleanup(makeFakeClient(), tracker, {}, async () =>
      err({ code: 'SANDBOX_TIMEOUT', timeoutMs: 1, message: 'too slow' })
    );
    expect(failed.isErr() && failed.error.code).toBe('SANDBOX_TIMEOUT');
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });

    // A body that THROWS: cleanup still runs, and the caller still gets a Result.
    const workspace2 = join(root, 'throw-workspace');
    await mkdir(workspace2, { recursive: true });
    const tracker2 = new CleanupTracker();
    tracker2.track({ kind: 'tempDir', id: workspace2 });
    const threw = await withCleanup(makeFakeClient(), tracker2, {}, async () => {
      throw new Error('boom');
    });
    expect(threw.isErr() && threw.error.code).toBe('INTERNAL');
    await expect(stat(workspace2)).rejects.toMatchObject({ code: 'ENOENT' });

    // And through the REAL dispatcher: an unavailable backend still cleans up.
    const workspace3 = join(root, 'dispatcher-workspace');
    await mkdir(workspace3, { recursive: true });
    const tracker3 = new CleanupTracker();
    tracker3.track({ kind: 'tempDir', id: workspace3 });
    const dispatched = await runVerification('build', 'node', '/staged/c', {
      selection: {}, // nothing available → an err
      cleanup: { tracker: tracker3 },
    });
    expect(dispatched.isErr()).toBe(true);
    await expect(stat(workspace3)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('degrades errors to warnings', async () => {
    const client = makeFakeClient({
      image: { code: 'DOCKER_ERROR', message: 'image busy' },
      volume: { code: 'DOCKER_ERROR', message: 'volume in use' },
      network: { code: 'DOCKER_ERROR', message: 'network gone' },
      prune: { code: 'DOCKER_ERROR', message: 'prune refused' },
    });
    const tracker = new CleanupTracker();
    tracker.track({ kind: 'container', id: 'c' });
    tracker.track({ kind: 'image', id: 'stitch-go:stitch-ephemeral-abc' });
    tracker.track({ kind: 'volume', id: 'v' });
    tracker.track({ kind: 'network', id: 'n' });

    const summary = await cleanupSandbox(client, tracker, { pruneImages: true });
    // The container (rm never rejects) succeeded; everything else degraded.
    expect(summary.removed.map(r => r.id)).toEqual(['c']);
    expect(summary.errors.map(e => e.message)).toEqual([
      'image busy',
      'volume in use',
      'network gone',
      'prune refused',
    ]);
    // Nothing threw: the caller still has a summary.
    expect(summary.removed).toHaveLength(1);

    // A client with no capability for a kind reports a warning rather than
    // silently pretending the resource is gone.
    const limited: CleanupClient = { async rm() {} };
    const limitedTracker = new CleanupTracker();
    limitedTracker.track({ kind: 'image', id: 'stitch-x:stitch-ephemeral-1' });
    const limitedSummary = await cleanupSandbox(limited, limitedTracker);
    expect(limitedSummary.removed).toEqual([]);
    expect(limitedSummary.errors[0]?.message).toContain('cannot remove images');

    // No client at all: containers are reported, not silently skipped.
    const noClient = await cleanupSandbox(undefined, tracker);
    expect(noClient.errors.some(e => e.message.includes('no cleanup client'))).toBe(true);
  });

  it('logs summary', async () => {
    const summaries: unknown[] = [];
    const tracker = new CleanupTracker();
    tracker.track({ kind: 'container', id: 'c1' });
    tracker.track({ kind: 'image', id: 'oven/bun:1.1' });

    const summary = await cleanupSandbox(makeFakeClient(), tracker, {
      onSummary: s => summaries.push(s),
    });
    // The summary is handed to the sink exactly once, with the counts the
    // acceptance asks for.
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toBe(summary);
    expect(summary.removed).toHaveLength(1);
    expect(summary.preservedImages).toEqual(['oven/bun:1.1']);
    expect(summary.errors).toHaveLength(0);

    // The dispatcher forwards its own summary sink when a tracker is wired.
    const forwarded: unknown[] = [];
    const tracker2 = new CleanupTracker();
    await runVerification('build', 'node', '/staged/c', {
      selection: {},
      cleanup: { tracker: tracker2, onSummary: s => forwarded.push(s) },
    });
    expect(forwarded).toHaveLength(1);
  });
});
