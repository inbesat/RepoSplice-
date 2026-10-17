// P-199 — progress.test.ts: the five mandated cases (renders step states,
// emits lines off tty, finishes cleanly, silent mode, throttles bursts) plus
// a verbose-mode extra, all driven through a fake event pump shaped as the
// `ProgressStream` the commands will wire to core's P-162 spine later.
//
// The clock is injected, so elapsed `m:ss` values are deterministic; the
// surfaces are the ADR-083 fake-stdout pattern, parameterized by isTTY
// (an isTTY:false fake exercises the non-TTY line paths without touching
// process streams at all).

import { describe, expect, it } from 'vitest';
import { type ProgressEvent, type ProgressStream, fmtElapsed, startProgress } from './progress.js';

function fakeStdout(isTTY = true): { out: NodeJS.WriteStream; chunks: string[] } {
  const chunks: string[] = [];
  const noop = (): void => undefined;
  const out = {
    isTTY,
    columns: 80,
    write: (text: string): boolean => {
      chunks.push(String(text));
      return true;
    },
    on: noop,
    off: noop,
    removeListener: noop,
  } as unknown as NodeJS.WriteStream;
  return { out, chunks };
}

/** A fake event pump shaped as the P-162 subscription the commands wire up. */
function fakePump(): { stream: ProgressStream; emit: (event: ProgressEvent) => void } {
  const handlers = new Set<(event: ProgressEvent) => void>();
  return {
    stream: {
      subscribe(handler: (event: ProgressEvent) => void): () => void {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    },
    emit: (event: ProgressEvent): void => {
      for (const handler of handlers) handler(event);
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('startProgress (P-199)', () => {
  it('renders step states', async () => {
    let tickMs = 10_000;
    const clock = (): number => tickMs;
    const { out, chunks } = fakeStdout();
    const pump = fakePump();
    const run = startProgress(pump.stream, { stdout: out, now: clock, throttleMs: 1 });

    // Declare four steps: one completes, one fails with detail, one stays
    // declared-but-unstarted, and one is STILL RUNNING at close. Each
    // transition sleeps apart so the ink render throttle emits a frame per
    // real-world step (the injected clock keeps the elapsed values exact).
    pump.emit({ type: 'step', id: 'fetch', label: 'fetching packages' });
    pump.emit({ type: 'status', id: 'fetch', status: 'active' });
    await sleep(60);
    tickMs = 17_000;
    pump.emit({ type: 'status', id: 'fetch', status: 'done' });
    pump.emit({ type: 'step', id: 'lint', label: 'linting sources' });
    pump.emit({ type: 'status', id: 'lint', status: 'active' });
    await sleep(60);
    tickMs = 19_000;
    pump.emit({ type: 'status', id: 'lint', status: 'failed', detail: '2 issues' });
    pump.emit({ type: 'step', id: 'bar', label: 'provenance bar' });
    pump.emit({ type: 'log', level: 'info', msg: '3 advisories' });
    tickMs = 21_000;
    // The spinner must live in the FINAL frame: a mid-flight frame can
    // legitimately vanish under ink's coalescing (the ADR-084 burst lesson),
    // which is what flaked this scan under full-suite parallel load.
    pump.emit({ type: 'step', id: 'serve', label: 'serving result' });
    pump.emit({ type: 'status', id: 'serve', status: 'active' });
    await sleep(120);

    const rendered = chunks.join('');
    // Active row in the final frame: spinner braille + live elapsed.
    const hasBraille = [...rendered].some(char => {
      const point = char.codePointAt(0) ?? 0;
      return point >= 0x2800 && point <= 0x28ff;
    });
    expect(hasBraille).toBe(true);
    expect(rendered).toContain('serving result (0:00)');
    // Finished rows: elapsed finalized at their transition time.
    expect(rendered).toContain('+ fetching packages (0:07)');
    expect(rendered).toContain('x linting sources (0:02) — 2 issues');
    // Declared-but-unstarted row.
    expect(rendered).toContain('· provenance bar');
    // Log tail and total — 0:11 because the still-active serve transition
    // moved the model's as-of time to 21_000.
    expect(rendered).toContain('[info] 3 advisories');
    expect(rendered).toContain('total 0:11');

    await run.finish('stitched 3 packages');
    expect(chunks[chunks.length - 1]).toBe('stitched 3 packages\n');
  });

  it('emits lines off tty', () => {
    let tickMs = 10_000;
    const clock = (): number => tickMs;
    const { out, chunks } = fakeStdout(false);
    const pump = fakePump();
    startProgress(pump.stream, { stdout: out, now: clock });

    pump.emit({ type: 'step', id: 'fetch', label: 'fetching packages' });
    pump.emit({ type: 'status', id: 'fetch', status: 'active' });
    pump.emit({ type: 'log', level: 'info', msg: '3 advisories' });
    tickMs = 17_000;
    pump.emit({ type: 'status', id: 'fetch', status: 'done' });
    pump.emit({ type: 'step', id: 'lint', label: 'linting sources' });
    pump.emit({ type: 'status', id: 'lint', status: 'active' });
    tickMs = 19_000;
    pump.emit({ type: 'status', id: 'lint', status: 'failed', detail: '2 issues' });
    pump.emit({ type: 'log', level: 'warn', msg: 'watch out' });
    pump.emit({ type: 'done', summary: 'run stitched' });

    // One discrete line per transition, in order, no redraw noise. Declared
    // steps print nothing until a status transition lands.
    expect(chunks).toEqual([
      '> fetching packages\n',
      '[info] 3 advisories\n',
      '+ fetching packages (0:07)\n',
      '> linting sources\n',
      'x linting sources (0:02) — 2 issues\n',
      '[warn] watch out\n',
      'run stitched\n',
    ]);
  });

  it('does not re-print a done summary off tty', async () => {
    const pump = fakePump();

    // finish() with no argument sees an already-printed summary: no rewrite.
    const first = fakeStdout(false);
    const runA = startProgress(pump.stream, { stdout: first.out });
    pump.emit({ type: 'done', summary: 'run stitched' });
    const afterDone = first.chunks.length;
    await runA.finish();
    expect(first.chunks.length).toBe(afterDone);

    // An explicit summary identical to the printed one is also skipped.
    const second = fakeStdout(false);
    const runB = startProgress(pump.stream, { stdout: second.out });
    pump.emit({ type: 'done', summary: 'run stitched' });
    await runB.finish('run stitched');
    expect(second.chunks).toEqual(['run stitched\n']);

    // A DIFFERENT explicit summary is a real final line and still prints.
    const third = fakeStdout(false);
    const runC = startProgress(pump.stream, { stdout: third.out });
    pump.emit({ type: 'done', summary: 'run stitched' });
    await runC.finish('stitched 3 packages');
    expect(third.chunks).toEqual(['run stitched\n', 'stitched 3 packages\n']);
  });

  it('finishes cleanly', async () => {
    const { out, chunks } = fakeStdout(false);
    const pump = fakePump();
    const run = startProgress(pump.stream, { stdout: out });

    pump.emit({ type: 'step', id: 'fetch', label: 'fetching packages' });
    pump.emit({ type: 'status', id: 'fetch', status: 'active' });

    await run.finish('stitched 3 packages');
    const afterFirst = chunks.length;
    expect(chunks[chunks.length - 1]).toBe('stitched 3 packages\n');

    // finish is idempotent, and a wired stream stops driving the controller.
    pump.emit({ type: 'status', id: 'fetch', status: 'done' });
    pump.emit({ type: 'log', level: 'error', msg: 'late event' });
    await run.finish();
    expect(chunks.length).toBe(afterFirst); // late pump events are dropped
  });

  it('silent mode', async () => {
    // Off-TTY: log lines suppressed entirely; steps and the summary remain.
    const { out, chunks } = fakeStdout(false);
    const pump = fakePump();
    const off = startProgress(pump.stream, { stdout: out, silent: true });
    pump.emit({ type: 'step', id: 'fetch', label: 'fetching packages' });
    pump.emit({ type: 'status', id: 'fetch', status: 'active' });
    pump.emit({ type: 'log', level: 'info', msg: 'noisy lines' });
    pump.emit({ type: 'log', level: 'error', msg: 'still noisy' });
    pump.emit({ type: 'status', id: 'fetch', status: 'done' });
    pump.emit({ type: 'done', summary: 'done quietly' });
    expect(chunks.filter(line => line.includes('noisy') || line.includes('still'))).toEqual([]);
    expect(chunks.some(line => line.startsWith('> fetch'))).toBe(true);
    expect(chunks.some(line => line.startsWith('+ fetching packages'))).toBe(true);
    expect(chunks).toContain('done quietly\n');
    await off.finish();

    // On TTY: the in-frame log rows disappear, step rows stay.
    const { out: ttyOut, chunks: ttyChunks } = fakeStdout();
    const on = startProgress(undefined, {
      stdout: ttyOut,
      silent: true,
      now: (): number => 1000,
      throttleMs: 1,
    });
    on.update({ type: 'step', id: 'fetch', label: 'fetching packages' });
    on.update({ type: 'status', id: 'fetch', status: 'active' });
    await sleep(60); // ink's write throttle lands the frame with the active row
    on.update({ type: 'log', level: 'info', msg: 'in-frame noise' });
    await sleep(80);
    const rendered = ttyChunks.join('');
    expect(rendered).toContain('fetching packages');
    expect(rendered).not.toContain('in-frame noise');
    await on.finish();
  });

  it('throttles bursts', async () => {
    const { out, chunks } = fakeStdout();
    const pump = fakePump();
    const run = startProgress(pump.stream, {
      stdout: out,
      now: (): number => 1000,
      throttleMs: 33,
      tail: 4,
    });

    pump.emit({ type: 'step', id: 'run', label: 'running' });
    pump.emit({ type: 'status', id: 'run', status: 'active' });
    // A burst of 40 logs inside one tick: the redraw must coalesce, not
    // render 40 frames.
    for (let index = 0; index < 40; index += 1) {
      pump.emit({ type: 'log', level: 'info', msg: `burst-${index}` });
    }
    await sleep(120);

    expect(chunks.length).toBeLessThanOrEqual(12);
    const rendered = chunks.join('');
    expect(rendered).toContain('burst-39'); // tail keeps the freshest logs
    expect(rendered).toContain('[36 earlier log lines hidden]');
    await run.finish();
  });

  it('verbose shows all', async () => {
    const { out, chunks } = fakeStdout();
    const pump = fakePump();
    const run = startProgress(pump.stream, {
      stdout: out,
      now: (): number => 1000,
      throttleMs: 1,
      verbose: true,
    });

    for (let index = 0; index < 2; index += 1) {
      pump.emit({ type: 'log', level: 'info', msg: `burst-${index}` });
    }
    await sleep(60); // let ink's write throttle land the first frames
    for (let index = 2; index < 6; index += 1) {
      pump.emit({ type: 'log', level: 'info', msg: `burst-${index}` });
    }
    await sleep(60);

    const rendered = chunks.join('');
    expect(rendered).toContain('burst-0'); // nothing trimmed away
    expect(rendered).not.toContain('earlier log lines hidden');
    await run.finish();
  });

  it('formats elapsed minutes and seconds', () => {
    expect(fmtElapsed(0)).toBe('0:00');
    expect(fmtElapsed(7_000)).toBe('0:07');
    expect(fmtElapsed(70_000)).toBe('1:10');
    expect(fmtElapsed(3_725_000)).toBe('62:05');
  });
});
