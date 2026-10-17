// P-192 — `stitch merge` tests.
//
// The pipeline is a FAKE port, so these run without git, Docker, AI or a network —
// which is the point of keeping this command a thin orchestrator. What is asserted is
// the command's own behaviour: the options it builds, what it prints, whether it writes,
// and the exit code it maps to.
//
// The six required scenarios from the phase spec:
//
//   it('merges to out dir')  it('dry run no write')   it('surfaces HIL gates')
//   it('offline mode')       it('errors on empty sources')  it('exit codes')

import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { err, ok } from 'neverthrow';
import { EXIT_OK, exitCodeForResult } from '../cli.js';
import type { GlobalOptions } from '../globals.js';
import {
  DEFAULT_OUT_DIR,
  merge,
  type MergeDeps,
  type MergePipelineOptions,
  type MergePipelineResult,
} from './merge.js';
import type { SourceSelection } from './add.js';

const BASE: GlobalOptions = { verbose: false, yes: false, offline: false, color: true };
const SOURCES: SourceSelection[] = [{ source: './a', paths: ['src/a.ts'] }];

/** A completed run whose stages reported the counts the summary renders. */
function completed(): MergePipelineResult {
  return {
    outcome: 'completed',
    records: [
      { stage: 'selection', status: 'passed', meta: { files: 7 } },
      { stage: 'deps', status: 'passed', meta: { merged: 3 } },
      { stage: 'licenses', status: 'passed', meta: { decisions: 2 } },
      { stage: 'provenance', status: 'passed', meta: { credits: 'CREDITS.md', sbom: 'sbom.json' } },
      { stage: 'finalize', status: 'passed', meta: {} },
    ],
  };
}

/** Deps with a fake pipeline; `calls` records every invocation's options. */
function deps(
  over: Partial<MergeDeps> = {},
  sources: SourceSelection[] = SOURCES
): MergeDeps & { lines: string[]; calls: MergePipelineOptions[] } {
  const lines: string[] = [];
  const calls: MergePipelineOptions[] = [];
  return {
    lines,
    calls,
    loadSources: () => ok(sources),
    runPipeline: async options => {
      calls.push(options);
      return ok(completed());
    },
    write: (line: string) => void lines.push(line),
    ...over,
  };
}

describe('P-192 stitch merge', () => {
  it('merges to out dir', async () => {
    const d = deps();
    const result = await merge({ ...BASE, cwd: '/work' }, d);
    expect(result.isOk()).toBe(true);

    // The pipeline ran once, with the default out dir under the cwd.
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.outDir).toBe(resolve(join('/work', DEFAULT_OUT_DIR)));
    expect(d.calls[0]?.sources).toEqual(SOURCES);

    const text = d.lines.join('\n');
    expect(text).toContain('Child repo written to');
    // The counts come from the STAGES' own reports.
    expect(text).toContain('files:');
    expect(text).toContain('7');
    expect(text).toContain('deps:');
    expect(text).toContain('licenses:');
    // …and the artifacts the provenance stage claimed.
    expect(text).toContain('CREDITS.md');
    expect(text).toContain('sbom.json');

    // `--out` overrides the default.
    const custom = deps();
    await merge({ ...BASE, cwd: '/work', out: '/tmp/custom-c' }, custom);
    expect(custom.calls[0]?.outDir).toBe(resolve('/tmp/custom-c'));
  });

  it('dry run no write', async () => {
    const dry: MergePipelineResult = {
      outcome: 'completed',
      // A dry run's finalize is skipped by core (P-244).
      records: [{ stage: 'finalize', status: 'skipped', meta: { reason: 'dry-run' } }],
    };
    const calls: MergePipelineOptions[] = [];
    const d = deps({
      runPipeline: async options => {
        calls.push(options);
        return ok(dry);
      },
    });

    const result = await merge({ ...BASE, cwd: '/work', dryRun: true }, d);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(calls[0]?.dryRun).toBe(true);
    const text = d.lines.join('\n');
    expect(text).toContain('Dry run — no child repo written.');
    // The summary must NOT claim a written child repo.
    expect(text).not.toContain('Child repo written to');
    expect(result.value.dryRun).toBe(true);
  });

  it('surfaces HIL gates', async () => {
    const paused: MergePipelineResult = { outcome: 'paused', stoppedAt: 'licenses', records: [] };

    // A pause is NOT a failure — the run is waiting for a decision (P-160).
    const d = deps({ runPipeline: async () => ok(paused) });
    const result = await merge({ ...BASE }, d);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.outcome).toBe('paused');
    expect(result.value.stoppedAt).toBe('licenses');
    expect(d.lines.join('\n')).toContain('Awaiting approval at stage "licenses"');

    // `--yes` auto-handles the MECHANICAL tools only; a deny-incompatible gate still
    // needs a human, and the message says exactly that rather than implying otherwise.
    const assumed = deps({ runPipeline: async () => ok(paused) });
    await merge({ ...BASE, yes: true }, assumed);
    expect(assumed.lines.join('\n')).toContain('--yes only auto-approves the mechanical tools');
  });

  it('offline mode', async () => {
    const offline = deps();
    await merge({ ...BASE, offline: true }, offline);
    expect(offline.calls[0]?.offline).toBe(true);

    const online = deps();
    await merge({ ...BASE }, online);
    expect(online.calls[0]?.offline).toBe(false);

    // `--jobs` and `--yes` reach the pipeline, and `jobs` is OMITTED when unset.
    const tuned = deps();
    await merge({ ...BASE, jobs: 4, yes: true }, tuned);
    expect(tuned.calls[0]?.jobs).toBe(4);
    expect(tuned.calls[0]?.yes).toBe(true);
    expect('jobs' in (online.calls[0] ?? {})).toBe(false);
  });

  // P-204: perf flags parse, thread into the pipeline options, and the caps
  // are enforced pre-run (exceeding one is refused BEFORE the pipeline runs).
  it('threads perf flags and enforces caps', async () => {
    const d = deps();
    const result = await merge(
      { ...BASE, cwd: '/work', memory: '1024', timeout: '0', maxFiles: '10' },
      d
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(d.calls[0]?.perf).toMatchObject({
        memoryMb: 1024,
        timeoutSec: 0,
        maxFiles: 10,
        maxSizeMb: 512,
        concurrency: 8,
      });
      // The effective values are surfaced.
      expect(d.lines.join('\n')).toContain('perf: jobs=');
      // With NO perf flag, the pipeline still decides (and no line is added).
      const plain = deps();
      await merge({ ...BASE }, plain);
      expect(plain.calls[0]?.perf).toBeUndefined();
      expect(plain.lines.join('\n')).not.toContain('perf:');
    }

    // A cap exceeded pre-run is a CONFIG_ERROR naming the flag — the pipeline
    // is never invoked.
    const two = deps({ statFile: async () => 0 }, [{ source: './a', paths: ['x.ts', 'y.ts'] }]);
    const guarded = await merge({ ...BASE, maxFiles: '1' }, two);
    expect(guarded.isErr()).toBe(true);
    if (guarded.isErr() && guarded.error.code === 'CONFIG_ERROR') {
      expect(guarded.error.field).toBe('perf.max-files');
    }
    expect(two.calls).toEqual([]);
  });

  it('errors on empty sources', async () => {
    const d = deps({}, []);
    const result = await merge({ ...BASE }, d);

    // The phase names `err('NOTHING_TO_STITCH')`; that code does NOT exist in
    // StitchError, so it is a CONFIG_ERROR naming the command that fixes it.
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('sources');
        expect(result.error.message).toContain('stitch add');
      }
    }
    // Refused BEFORE the pipeline is invoked — a misconfigured project costs nothing.
    expect(d.calls).toEqual([]);
  });

  it('exit codes', async () => {
    // Success maps to 0.
    expect(exitCodeForResult(ok(undefined), () => undefined)).toBe(EXIT_OK);

    // A failed pipeline is a 1, and the stage is named in the message.
    const failing = deps({
      runPipeline: async () => ok({ outcome: 'failed', stoppedAt: 'sandbox', records: [] }),
    });
    const result = await merge({ ...BASE }, failing);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('INTERNAL');
      // Narrowed by code: `StitchError` is a union, and not every member has `message`.
      if (result.error.code === 'INTERNAL') expect(result.error.message).toContain('sandbox');
      const lines: string[] = [];
      // P-203: INTERNAL exits 70 (the internal class), rendered with the hint.
      expect(exitCodeForResult(err(result.error), line => void lines.push(line))).toBe(70);
      expect(lines.join('')).toContain('✘ INTERNAL');
      expect(lines.join('')).not.toBe('');
    }

    // A successful merge maps to 0 through the same helper.
    expect(
      exitCodeForResult(
        (await merge({ ...BASE }, deps())).map(() => undefined),
        () => undefined
      )
    ).toBe(EXIT_OK);
  });
});
