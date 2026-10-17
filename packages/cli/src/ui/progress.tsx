// P-199 — the run-progress renderer: `ProgressView` (the ink tree) and
// `startProgress` (the controller a run command mounts; it only renders the
// event stream — pipeline logic stays out, per the handoff note).
//
// The event contract (fed through update(), derived from core's P-162 spine
// by the caller):
//
//   {type:'step',   id, label}          declare a row (pending)
//   {type:'status', id, status, detail?}  active | done | failed
//   {type:'log',    level, msg}         info | warn | error
//   {type:'done',   summary}            the run's closing line
//
// TTY: ink render — spinner on the active row, elapsed `m:ss` per step, a
// total line, and a log tail; snapshots flush at most every `throttleMs`
// (default ≈30fps) so log bursts cannot jank the redraw.
// Non-TTY: one plain line per transition — `> a`, `+ a (0:07)`,
// `x a (0:02) — detail`, `[warn] msg` — printed as each event lands, no
// redraw.
//
// `--silent` suppresses LOG lines only (steps and the summary remain);
// `--verbose` shows every log line instead of the tail (the tail row shows an
// "[N earlier log lines hidden]" marker). Glyphs are plain ASCII so
// colors-off stays readable (ADR-083); painted strings always live inside
// <Text>.
//
// Mount defenses are the ADR-083 set: `interactive: true` (ink's is-in-ci
// detection would silently strip the redraw in CI), `patchConsole: false`,
// `exitOnCtrlC: false`.

import { Box, Text, render, type Instance } from 'ink';
import { createElement as h, type ReactNode } from 'react';
import { Spinner } from '@inkjs/ui';
import { theme } from '../theme.js';

/** The four kinds a caller may pump through {@link ProgressController.update}. */
export type ProgressEvent =
  | { type: 'step'; id: string; label: string }
  | { type: 'status'; id: string; status: 'active' | 'done' | 'failed'; detail?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string }
  | { type: 'done'; summary: string };

/** A step's rendered row. `pending` = declared, not yet active. */
export interface ProgressStepView {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}

/** One log line, sequenced so the view can key it. */
export interface ProgressLogView {
  seq: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

/** The model the controller owns and the view renders. */
export interface ProgressSnapshot {
  steps: ProgressStepView[];
  logs: ProgressLogView[];
  /** Elapsed-clock origin (first update). */
  mountAt: number;
  /** As-of time for elapsed math (injected in tests). */
  ts: number;
  /** The `done` line once pumped as an event. */
  summary?: string;
}

/** What `startProgress` consumes; a manual test pumps the controller directly. */
export interface ProgressStream {
  /** Subscribe to the run's event stream; return the detach function. */
  subscribe(handler: (event: ProgressEvent) => void): () => void;
}

export interface ProgressOptions {
  /** P-206 `--silent`: suppress log lines, keep steps and the summary. */
  silent?: boolean;
  /** P-206 `--verbose`: show every log line instead of the tail. */
  verbose?: boolean;
  /** Injectable surface (tests + P-193 serve plumbing); defaults to the process. */
  stdout?: NodeJS.WriteStream;
  /** Redraw cadence on TTY; default 33 (≈30fps). Off-TTY prints immediately. */
  throttleMs?: number;
  /** Log tail length when not verbose; default 4. */
  tail?: number;
  /** Elapsed clock; injectable for deterministic `m:ss` assertions. */
  now?: () => number;
}

export interface ProgressController {
  /** Feed one event (direct pumping; a wired stream auto-updates). */
  update(event: ProgressEvent): void;
  /** Tear the render down and print the summary line (skipping one already
   * printed verbatim off-TTY). Idempotent. */
  finish(summary?: string): Promise<void>;
}

/** `1:07`-style formatting: minutes, colon, zero-padded seconds. */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Plain-ASCII row glyphs — readable with colors off (ADR-083 principle). */
function rowGlyph(status: ProgressStepView['status']): string {
  if (status === 'active') return '>';
  if (status === 'done') return '+';
  if (status === 'failed') return 'x';
  return '·';
}

/** Apply one event to the model, in place. */
function applyEvent(
  model: ProgressSnapshot,
  event: ProgressEvent,
  nowMs: number,
  seq: number
): void {
  model.ts = nowMs;
  if (event.type === 'step') {
    const existing = model.steps.find(step => step.id === event.id);
    if (existing === undefined) {
      model.steps.push({ id: event.id, label: event.label, status: 'pending' });
    } else {
      existing.label = event.label;
    }
    return;
  }
  if (event.type === 'status') {
    let step = model.steps.find(candidate => candidate.id === event.id);
    if (step === undefined) {
      // A degraded stream may mark a step nobody declared: track it verbatim.
      step = { id: event.id, label: event.id, status: 'pending' };
      model.steps.push(step);
    }
    if (event.status === 'active') {
      if (step.startedAt === undefined) step.startedAt = nowMs;
      // A done/failed step stays finished; only unstarted ones open.
      if (step.status === 'pending') step.status = 'active';
    } else {
      step.endedAt = nowMs;
      step.status = event.status;
    }
    if (event.detail !== undefined) step.detail = event.detail;
    return;
  }
  if (event.type === 'log') {
    model.logs.push({ seq, level: event.level, msg: event.msg });
    return;
  }
  model.summary = event.summary;
}

/** One step row, composed directly (no hooks — safe to call from a map). */
function stepNode(step: ProgressStepView, nowMs: number): ReactNode {
  const elapsed =
    step.startedAt === undefined ? undefined : fmtElapsed((step.endedAt ?? nowMs) - step.startedAt);
  const elapsedText = elapsed === undefined ? '' : ` (${elapsed})`;
  if (step.status === 'active') {
    return (
      <Box key={step.id}>
        <Spinner />
        <Text>{` ${step.label}${elapsedText}`}</Text>
      </Box>
    );
  }
  const detail = step.detail === undefined || step.detail.length === 0 ? '' : ` — ${step.detail}`;
  const line = `${rowGlyph(step.status)} ${step.label}${elapsedText}${detail}`;
  if (step.status === 'done') {
    return <Text key={step.id}>{theme('ok', line)}</Text>;
  }
  if (step.status === 'failed') {
    return <Text key={step.id}>{theme('err', line)}</Text>;
  }
  return <Text key={step.id}>{line}</Text>;
}

/** One log row: `[level] msg`, warn/error painted through theme(). */
function logNode(log: ProgressLogView): ReactNode {
  if (log.level === 'info') {
    return <Text key={`log-${log.seq}`}>{`[info] ${log.msg}`}</Text>;
  }
  const painted = `[${log.level}] ${log.msg}`;
  return (
    <Text key={`log-${log.seq}`}>{theme(log.level === 'warn' ? 'warn' : 'err', painted)}</Text>
  );
}

/** The ink tree for one snapshot. */
export function ProgressView({
  model,
  silent,
  verbose,
  tail = 4,
}: {
  model: ProgressSnapshot;
  silent?: boolean;
  verbose?: boolean;
  tail?: number;
}): ReactNode {
  const shown = silent === true ? [] : verbose === true ? model.logs : model.logs.slice(-tail);
  const hidden = model.logs.length - shown.length;
  return (
    <Box flexDirection="column">
      {model.steps.map(step => stepNode(step, model.ts))}
      {hidden > 0 ? <Text>{`[${hidden} earlier log lines hidden]`}</Text> : null}
      {shown.map(log => logNode(log))}
      {model.summary === undefined ? null : (
        <Box marginTop={1}>
          <Text>{theme('ok', model.summary)}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text>{`total ${fmtElapsed(model.ts - model.mountAt)}`}</Text>
      </Box>
    </Box>
  );
}

/**
 * Start rendering a run. TTY: the ink view mounts once and refreshes at the
 * throttle; updates feed the model. Off-TTY: plain ordered lines, one per
 * transition, printed the moment an event lands. The returned controller
 * exposes `update(ev)` for direct pumping and an idempotent `finish()`
 * that unsubscribes, unmounts/clears, and prints the summary line.
 */
export function startProgress(
  stream: ProgressStream | undefined,
  opts: ProgressOptions = {}
): ProgressController {
  const now = opts.now ?? ((): number => Date.now());
  const throttleMs = opts.throttleMs ?? 33;
  const tailLen = opts.tail ?? 4;
  const surface = opts.stdout;
  const write = (line: string): void => {
    (surface ?? process.stdout).write(`${line}\n`);
  };

  let finished = false;
  let seq = 0;
  let unsubscribe: (() => void) | undefined;
  let lastFlush = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  /** The closing line already printed (off-TTY `done` events); guards against
   * `finish()` printing the same line twice (ADR-084 decision 7). */
  let printedSummary: string | undefined;

  const model: ProgressSnapshot = { steps: [], logs: [], mountAt: now(), ts: now() };

  const snapshot = (): ProgressSnapshot => ({
    ...model,
    steps: model.steps.map(step => ({ ...step })),
    logs: [...model.logs],
  });

  const isTTY = surface === undefined ? process.stdout.isTTY : surface.isTTY;
  const interactive = isTTY === true;

  const viewProps = (): {
    model: ProgressSnapshot;
    silent?: boolean;
    verbose?: boolean;
    tail: number;
  } => ({
    model: snapshot(),
    // exactOptionalPropertyTypes: only pass the toggles that were set.
    ...(opts.silent !== undefined ? { silent: opts.silent } : {}),
    ...(opts.verbose !== undefined ? { verbose: opts.verbose } : {}),
    tail: tailLen,
  });

  const instance: Instance | undefined = interactive
    ? render(h(ProgressView, viewProps()), {
        ...(surface !== undefined ? { stdout: surface } : {}),
        patchConsole: false,
        exitOnCtrlC: false,
        interactive: true,
      })
    : undefined;

  /** Re-render one brand-new snapshot (ink's native rerender — no setState bridge,
   * which would never redraw from outside React). */
  const refresh = (): void => {
    instance?.rerender(h(ProgressView, viewProps()));
  };

  const flush = (): void => {
    if (finished) return;
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    lastFlush = now();
    refresh();
  };

  const schedule = (): void => {
    const since = now() - lastFlush;
    if (since >= throttleMs) {
      flush();
      return;
    }
    if (pendingTimer === undefined) {
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined;
        flush();
      }, throttleMs - since);
    }
  };

  /** One plain line per transition, off-TTY only, after the model applied. */
  const printEvent = (event: ProgressEvent): void => {
    if (event.type === 'status') {
      const step = model.steps.find(candidate => candidate.id === event.id);
      const label = step?.label ?? event.id;
      const detail =
        step?.detail === undefined || step.detail.length === 0 ? '' : ` — ${step.detail}`;
      if (event.status === 'active') {
        write(`> ${label}${detail}`);
        return;
      }
      const elapsed =
        step?.startedAt === undefined
          ? undefined
          : fmtElapsed((step.endedAt ?? model.ts) - step.startedAt);
      const elapsedText = elapsed === undefined ? '' : ` (${elapsed})`;
      write(`${rowGlyph(event.status)} ${label}${elapsedText}${detail}`);
      return;
    }
    if (event.type === 'log') {
      if (opts.silent === true) return;
      write(`[${event.level}] ${event.msg}`);
      return;
    }
    if (event.type === 'done') {
      printedSummary = event.summary;
      write(event.summary);
    }
    // 'step' declarations produce no line off-TTY — transitions do.
  };

  const controller: ProgressController = {
    update(event: ProgressEvent): void {
      if (finished) return;
      seq += 1;
      applyEvent(model, event, now(), seq);
      if (!interactive) {
        printEvent(event);
        return;
      }
      schedule();
    },
    async finish(finalSummary?: string): Promise<void> {
      if (finished) return;
      finished = true;
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
      unsubscribe?.();
      unsubscribe = undefined;
      const summary = finalSummary ?? model.summary;
      if (interactive) {
        flush();
        instance?.unmount();
      }
      // Off-TTY, a pumped `done` printed its summary already; re-printing the
      // same line would duplicate it (an explicit different summary still
      // prints). On TTY the frame is erased by unmount, so it always prints.
      if (summary !== undefined && summary !== printedSummary) write(summary);
    },
  };

  if (stream !== undefined) {
    unsubscribe = stream.subscribe(event => controller.update(event));
  }

  return controller;
}
