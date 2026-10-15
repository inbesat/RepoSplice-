// P-177 â€” Sandbox: deterministic cleanup.
//
// Every container, image, volume, network and temp dir a run creates must be
// removed, on EVERY exit path â€” success, failure, and abort. Leaks accumulate
// and, worse, widen the attack surface (a container still holding a mount is a
// live process). This module makes that a structural guarantee rather than a
// convention:
//
//   - `CleanupTracker` records what a run created (`track`), so cleanup is a
//     sweep over known resources instead of a daemon-wide prune;
//   - `cleanupSandbox` removes them in dependency order, and any single failure
//     degrades to a WARNING in the summary â€” cleanup must never be the thing
//     that fails a stitch;
//   - the runner wraps its dispatch in `try/finally`, so the sweep happens even
//     when the body throws.
//
// Two deliberate conservatisms (the phase's own words: "kept conservative to
// avoid nuking cached dev images"):
//   1. an IMAGE is removed only when its ref carries P-169's
//      `stitch-ephemeral-` marker â€” a pulled pinned base is reused by the next
//      run and is NOT ours to delete;
//   2. a daemon-wide `pruneImages()` runs only when `config.sandbox.pruneImages`
//      opts in, because it deletes images repo-stitcher never created.
//
// Host temp dirs are removed with `fs.rm(..., {recursive: true})`, and only the
// paths the tracker was given: `artifactTarget`/`buildoutDir` (P-171/P-173) are
// CALLER-owned, so destroying them would delete the caller's artifacts â€” the
// tracker is how a caller says "this one is mine to remove".

import { err, type Result } from 'neverthrow';
import { rm } from 'node:fs/promises';
import { type StitchError } from '../result/index.js';
import { isEphemeralTag } from './images.js';
import type { ContainerLike } from './client.js';

/** What a run may create and must therefore remove. */
export type ResourceKind = 'container' | 'image' | 'volume' | 'network' | 'tempDir';

/** One tracked resource. */
export interface TrackedResource {
  kind: ResourceKind;
  id: string;
}

/** What cleanup reports: what went, and what could not. */
export interface CleanupSummary {
  removed: TrackedResource[];
  /** Failures, as warnings â€” never a thrown error (acceptance criterion 5). */
  errors: { resource: TrackedResource; message: string }[];
  /** Tracked images kept because they are not ephemeral. */
  preservedImages: string[];
  /** Reclaimed images from an opt-in daemon-wide prune, when requested. */
  prunedImages: number;
}

/** What `cleanupSandbox` needs from a container client (P-168 `SandboxClient`). */
export interface CleanupClient {
  rm(containerOrId: string | ContainerLike): Promise<void>;
  removeImage?(ref: string, force?: boolean): Promise<Result<void, StitchError>>;
  removeVolume?(name: string, force?: boolean): Promise<Result<void, StitchError>>;
  removeNetwork?(id: string): Promise<Result<void, StitchError>>;
  pruneImages?(): Promise<Result<number, StitchError>>;
}

/** Options for {@link cleanupSandbox}. */
export interface CleanupOptions {
  /** `config.sandbox.pruneImages` (default false) â€” a daemon-wide prune. */
  pruneImages?: boolean;
  /** Called once with the summary, for P-145-style logging and P-248 tracing. */
  onSummary?: (summary: CleanupSummary) => void;
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A `StitchError`'s message.
 *
 * Not every variant carries one (`SANDBOX_FAILED` has `step`/`logs`), so the
 * union is narrowed before reading it rather than assuming the property exists.
 */
function errorText(error: StitchError): string {
  return 'message' in error && typeof error.message === 'string' ? error.message : error.code;
}

/**
 * Records the resources one run created.
 *
 * Tracking is append-only and idempotent per `(kind, id)`: a caller that
 * registers the same container twice (a retry, say) must not cause two removal
 * attempts, because the second would fail against a gone resource and be
 * reported as noise.
 */
export class CleanupTracker {
  readonly #resources: TrackedResource[] = [];
  readonly #seen = new Set<string>();

  /** Register one resource. Returns false when it was already tracked. */
  track(resource: TrackedResource): boolean {
    const key = `${resource.kind}\u0000${resource.id}`;
    if (this.#seen.has(key)) return false;
    this.#seen.add(key);
    this.#resources.push(resource);
    return true;
  }

  /** Everything tracked so far, oldest first. */
  entries(): TrackedResource[] {
    return [...this.#resources];
  }

  /** How many resources are tracked. */
  get size(): number {
    return this.#resources.length;
  }

  /** Drop everything (test-only; a tracker is per-run). */
  clear(): void {
    this.#resources.length = 0;
    this.#seen.clear();
  }
}

/**
 * Remove everything the tracker recorded.
 *
 * Order matters: containers first (they hold volumes and networks open), then
 * ephemeral images, then volumes, then networks, then host temp dirs. Each
 * failure is collected; nothing throws.
 */
export async function cleanupSandbox(
  client: CleanupClient | undefined,
  tracker: CleanupTracker,
  opts: CleanupOptions = {}
): Promise<CleanupSummary> {
  const summary: CleanupSummary = {
    removed: [],
    errors: [],
    preservedImages: [],
    prunedImages: 0,
  };
  const entries = tracker.entries();
  const byKind = (kind: ResourceKind): TrackedResource[] =>
    entries.filter(resource => resource.kind === kind);

  // 1. Containers (force) â€” they pin the volumes/networks removed below.
  for (const resource of byKind('container')) {
    if (client === undefined) {
      summary.errors.push({
        resource,
        message: 'no cleanup client supplied; container left in place',
      });
      continue;
    }
    try {
      await client.rm(resource.id);
      summary.removed.push(resource);
    } catch (cause: unknown) {
      summary.errors.push({ resource, message: detailOf(cause) });
    }
  }

  // 2. Images â€” ONLY the ephemeral-tagged ones this run built (P-169).
  for (const resource of byKind('image')) {
    if (!isEphemeralTag(resource.id)) {
      // A pulled pinned base is reused next run and is not ours to delete.
      summary.preservedImages.push(resource.id);
      continue;
    }
    if (client?.removeImage === undefined) {
      summary.errors.push({ resource, message: 'client cannot remove images' });
      continue;
    }
    const removed = await client.removeImage(resource.id, true);
    if (removed.isErr()) summary.errors.push({ resource, message: errorText(removed.error) });
    else summary.removed.push(resource);
  }

  // 3. Volumes, then networks (same guard shape).
  for (const resource of byKind('volume')) {
    if (client?.removeVolume === undefined) {
      summary.errors.push({ resource, message: 'client cannot remove volumes' });
      continue;
    }
    const removed = await client.removeVolume(resource.id, true);
    if (removed.isErr()) summary.errors.push({ resource, message: errorText(removed.error) });
    else summary.removed.push(resource);
  }
  for (const resource of byKind('network')) {
    if (client?.removeNetwork === undefined) {
      summary.errors.push({ resource, message: 'client cannot remove networks' });
      continue;
    }
    const removed = await client.removeNetwork(resource.id);
    if (removed.isErr()) summary.errors.push({ resource, message: errorText(removed.error) });
    else summary.removed.push(resource);
  }

  // 4. Host temp dirs the tracker was told about (recursive, best-effort).
  for (const resource of byKind('tempDir')) {
    try {
      await rm(resource.id, { recursive: true, force: true });
      summary.removed.push(resource);
    } catch (cause: unknown) {
      summary.errors.push({ resource, message: detailOf(cause) });
    }
  }

  // 5. Opt-in daemon-wide prune â€” never by default (it is not ours to prune).
  if (opts.pruneImages === true && client?.pruneImages !== undefined) {
    const pruned = await client.pruneImages();
    if (pruned.isErr()) {
      summary.errors.push({
        resource: { kind: 'image', id: '(prune)' },
        message: errorText(pruned.error),
      });
    } else {
      summary.prunedImages = pruned.value;
    }
  }

  opts.onSummary?.(summary);
  return summary;
}

/**
 * Run `body`, then clean up â€” on success, failure, AND throw.
 *
 * This is the `finally` guarantee the phase calls non-negotiable: a body that
 * rejects still sweeps. Cleanup failures never replace the body's outcome.
 */
export async function withCleanup<T>(
  client: CleanupClient | undefined,
  tracker: CleanupTracker,
  opts: CleanupOptions,
  body: () => Promise<Result<T, StitchError>>
): Promise<Result<T, StitchError>> {
  try {
    const result = await body();
    await cleanupSandbox(client, tracker, opts);
    return result;
  } catch (cause: unknown) {
    await cleanupSandbox(client, tracker, opts);
    // A throwing body is a bug in the operator; it becomes a typed error so the
    // caller still receives a Result rather than an exception.
    return err({
      code: 'INTERNAL',
      message: `sandbox body threw: ${detailOf(cause)}`,
    });
  }
}
