// P-195 — CLI-side system version checks for `stitch doctor`.
//
// Bun and Node checks live HERE, not in core's `system/doctor.ts`, on purpose:
// that module already owns the git/git-filter-repo/docker/ollama/github checks
// and carries foreign concurrent edits, so extending it is a core-lane move.
// These factories conform to core's `DependencyCheck`/`ProcessRunner` shapes
// (the same seams `makeGitCheck` accepts), so `buildDoctorChecks` keeps its
// rule (probes degrade to `ok({ pass: false, fix })`, never throw) without any
// core change.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { err, ok, type DependencyCheck, type ProcessRunner } from '@repo-stitcher/core';

/** Boundedness for version probes: a hung `--version` exits the probe after 5s. */
const VERSION_PROBE_TIMEOUT_MS = 5_000;

/** The runners hand back whatever the tool prints; stdout it is. */
const execFileAsync = promisify(execFile);

/** Default runner: `bun` on PATH, time-bounded like every probe here. */
const defaultBunRun: ProcessRunner = async args =>
  (await execFileAsync('bun', [...args], { timeout: VERSION_PROBE_TIMEOUT_MS })).stdout;

/** Default runner: `node` on PATH, time-bounded like every probe here. */
const defaultNodeRun: ProcessRunner = async args =>
  (await execFileAsync('node', [...args], { timeout: VERSION_PROBE_TIMEOUT_MS })).stdout;

/** TECH_STACK.md: Bun >= 1.1.0 is the required primary runtime. */
const BUN_FLOOR = [1, 1, 0] as const;

/** TECH_STACK.md: Node >= 22 LTS is a fallback — its floor is informational. */
const NODE_FLOOR = [22, 0, 0] as const;

/**
 * The first `x.y.z` in the tool's output. `bun --version` prints `1.x.y`,
 * `node --version` prints `v22.x.y`; both carry the triple inline.
 */
function parseVersionLine(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(stdout);
  return match?.[1] ?? null;
}

function toTuple(version: string): readonly number[] {
  return version.split('.').map(part => Number(part));
}

function atLeast(version: string, floor: readonly number[]): boolean {
  const tuple = toTuple(version);
  for (let index = 0; index < floor.length; index += 1) {
    const given = tuple[index] ?? 0;
    const want = floor[index] ?? 0;
    if (given !== want) return given > want;
  }
  return true;
}

/**
 * Shared probe body: a missing binary, unparsable output, and a below-floor
 * version are all `ok({ pass: false, fix })` — the exact degradation rule
 * `makeGitCheck` applies upstream. A runner whose transport itself breaks
 * (a whole-codebase exec failure, not an identity problem) is `err`.
 */
function makeVersionCheck(options: {
  id: string;
  label: string;
  floor: readonly number[];
  floorLabel: string;
  critical: boolean;
  fix: string;
  run: ProcessRunner;
}): DependencyCheck {
  const { id, label, floor, floorLabel, critical, fix, run } = options;
  return {
    id,
    label,
    critical,
    check: async () => {
      let stdout: string;
      try {
        stdout = await run(['--version']);
      } catch (cause: unknown) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        // Exit-code failures (ENOENT, a timeout) are normal degradations; only
        // an unexpected runtime break (no errno/code) reports as err.
        if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === undefined) {
          return err({ code: 'INTERNAL', message: `${label} probe failed: ${detail}` });
        }
        return ok({ pass: false, detail: `${id} not runnable: ${detail}`, fix });
      }
      const version = parseVersionLine(stdout);
      if (version === null) {
        return ok({
          pass: false,
          detail: `${id} --version output was unrecognized`,
          fix,
        });
      }
      if (!atLeast(version, floor)) {
        return ok({
          pass: false,
          detail: `${id} ${version} is below the ${floorLabel} floor`,
          fix,
        });
      }
      return ok({ pass: true, detail: `${id} ${version} meets the >= ${floorLabel} floor` });
    },
  };
}

/**
 * Bun >= 1.1.0 (TECH_STACK runtime): critical, because the stack's dev/test/
 * build commands are all Bun-fronted.
 */
export function makeBunCheck(run: ProcessRunner = defaultBunRun): DependencyCheck {
  const floorLabel = BUN_FLOOR.join('.');
  return makeVersionCheck({
    id: 'bun',
    label: `bun >= ${floorLabel}`,
    floor: BUN_FLOOR,
    floorLabel,
    critical: true,
    fix: `Install >= ${floorLabel} (bun.sh; TECH_STACK.md's required runtime)`,
    run,
  });
}

/**
 * Node >= 22 LTS: informational (TECH_STACK names Node a fallback), so an
 * old or missing Node warns rather than failing the doctor report.
 */
export function makeNodeCheck(run: ProcessRunner = defaultNodeRun): DependencyCheck {
  const floorLabel = NODE_FLOOR.join('.');
  return makeVersionCheck({
    id: 'node',
    label: `node >= ${floorLabel} (fallback)`,
    floor: NODE_FLOOR,
    floorLabel,
    critical: false,
    fix: `Install ${floorLabel} LTS (nodejs.org; only legacy tools need it)`,
    run,
  });
}
