// P-198 — prompt.test.ts: the six mandated cases (rendered pickers,
// multi-toggle, confirm y/n, non-TTY --yes/defaults, secret masking, typed
// cancellation) plus coverage for wrap-around, an untoggle, and the prefilled
// default submitting on enter.
//
// The interactive cases drive the wrappers through the injectable surface the
// house tui.test.tsx pattern established: fake `{isTTY, columns, write, ...}`
// stdout collecting frames, fake EventEmitter stdin replayed byte chunks —
// one keypress per chunk, awaited apart so each render settles (verified
// against ink 7: bare ESC parses to `key.escape`, `\r` to `key.return`, and
// kitty-keyboard detection is opt-in, so nothing buffers these chunks).

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { PickerOption } from './picker.js';
import { askConfirm, askMulti, askSelect, promptText } from './prompt.js';

/** The fake, viewed through the seat ink plugs into in render options. */
type FakeStdinAsStream = NodeJS.ReadStream & { press: (chunk: string) => void };

/**
 * FakeStdin implements the readable contract ink 7 drives (App attaches a
 * 'readable' listener and drains chunks via `stdin.read()` — a 'data' emitter
 * alone is dead input). `press()` replays one keypress chunk, the ink≤6
 * `emit('data')` equivalent.
 */
class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  isRaw = false;

  private readonly queue: string[] = [];

  setEncoding(): void {
    // No-op: chunks are already strings.
  }

  setRawMode(enabled: boolean): void {
    this.isRaw = enabled;
  }

  ref(): void {
    // No-op: nothing holds the event loop.
  }

  unref(): void {
    // No-op.
  }

  pause(): void {
    // No-op.
  }

  resume(): void {
    // No-op.
  }

  read(): string | null {
    return this.queue.shift() ?? null;
  }

  press(chunk: string): void {
    this.queue.push(chunk);
    this.emit('readable');
  }
}

/** Every instantiation rides into render as the ReadStream ink expects. */
function fakeStdin(): FakeStdinAsStream {
  return new FakeStdin() as unknown as FakeStdinAsStream;
}

interface FakeSurface {
  out: NodeJS.WriteStream;
  chunks: string[];
}

function fakeStdout(): FakeSurface {
  const chunks: string[] = [];
  const noop = (): void => undefined;
  const out = {
    isTTY: true,
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

const sleep = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Replay keypresses one chunk per key, letting each render settle. */
async function feed(stdin: FakeStdinAsStream, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    stdin.press(key);
    await sleep(40);
  }
}

const DOWN = '\u001B[B';
const UP = '\u001B[A';
const ENTER = '\u000D';
const ESCAPE = '\u001B';
const SPACE = ' ';

const COLORS: readonly PickerOption[] = [
  { label: 'red', value: 'red' },
  { label: 'green', value: 'green' },
  { label: 'blue', value: 'blue' },
];

// The wrappers gate on `process.stdout.isTTY` when no surface is injected;
// the non-TTY cases stub it and restore the original descriptor.
const savedTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

afterEach(() => {
  if (savedTTY === undefined) {
    Reflect.deleteProperty(process.stdout, 'isTTY');
  } else {
    Object.defineProperty(process.stdout, 'isTTY', savedTTY);
  }
});

function stubProcessTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

describe('ink picker prompts (P-198)', () => {
  it('select navigates: arrows move focus with wrap-around, enter picks', async () => {
    const { out } = fakeStdout();
    const stdin = fakeStdin();
    const promise = askSelect('pick a color', COLORS, { stdout: out, stdin });
    await sleep(60);
    await feed(stdin, [DOWN]);
    await feed(stdin, [DOWN]);
    await feed(stdin, [ENTER]);
    await expect(promise).resolves.toBe('blue');

    // Up from the FIRST entry wraps around to the last.
    const { out: out2 } = fakeStdout();
    const stdin2 = fakeStdin();
    const wrap = askSelect('pick a color', COLORS, { stdout: out2, stdin: stdin2 });
    await sleep(60);
    await feed(stdin2, [UP]);
    await feed(stdin2, [ENTER]);
    await expect(wrap).resolves.toBe('blue');
  });

  it('multiselect toggles with space and confirms in option order', async () => {
    const { out } = fakeStdout();
    const stdin = fakeStdin();
    const promise = askMulti('pick colors', COLORS, { stdout: out, stdin });
    await sleep(60);
    await feed(stdin, [SPACE]); // red
    await feed(stdin, [DOWN]);
    await feed(stdin, [SPACE]); // green
    await feed(stdin, [ENTER]);
    await expect(promise).resolves.toEqual(['red', 'green']);

    // An untoggle: green ships pre-checked, space clears it.
    const { out: out2 } = fakeStdout();
    const stdin2 = fakeStdin();
    const withDefault = askMulti('pick colors', COLORS, {
      stdout: out2,
      stdin: stdin2,
      defaultValue: ['green'],
    });
    await sleep(60);
    await feed(stdin2, [DOWN]);
    await feed(stdin2, [SPACE]); // clear green
    await feed(stdin2, [ENTER]);
    await expect(withDefault).resolves.toEqual([]);
  });

  it('confirm resolves y/n and enter for the default choice', async () => {
    const { out } = fakeStdout();
    const stdin = fakeStdin();
    const yes = askConfirm('deploy now?', { stdout: out, stdin, defaultChoice: false });
    await sleep(60);
    await feed(stdin, ['y']);
    await expect(yes).resolves.toBe(true);

    const { out: out2 } = fakeStdout();
    const stdin2 = fakeStdin();
    const no = askConfirm('deploy now?', { stdout: out2, stdin: stdin2 });
    await sleep(60);
    await feed(stdin2, ['n']);
    await expect(no).resolves.toBe(false);

    const { out: out3 } = fakeStdout();
    const stdin3 = fakeStdin();
    const defaulted = askConfirm('deploy now?', {
      stdout: out3,
      stdin: stdin3,
      defaultChoice: true,
    });
    await sleep(60);
    await feed(stdin3, [ENTER]);
    await expect(defaulted).resolves.toBe(true);
  });

  it('non-TTY resolves --yes/defaults and rejects unanswered requires', async () => {
    stubProcessTTY(false);

    // A plain non-TTY confirm honors `--yes` first, then the default, then
    // the conservative "no" (never assumes a yes nobody gave).
    await expect(askConfirm('deploy now?', { yes: true })).resolves.toBe(true);
    await expect(askConfirm('deploy now?', { defaultChoice: true })).resolves.toBe(true);
    await expect(askConfirm('deploy now?')).resolves.toBe(false);

    // require without a default is an abort, not a fabricated answer.
    await expect(askConfirm('deploy now?', { require: true })).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });
    await expect(askSelect('pick', COLORS, { require: true })).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });

    // Defaults resolve without any human.
    await expect(askSelect('pick', COLORS, { defaultValue: 'green' })).resolves.toBe('green');
    await expect(promptText('api key?', { defaultValue: 'sk-1' })).resolves.toBe('sk-1');
    await expect(promptText('api key?')).resolves.toBeNull();
  });

  it('secret text is masked in every rendered frame', async () => {
    const { out, chunks } = fakeStdout();
    const stdin = fakeStdin();
    const promise = promptText('api key?', { stdout: out, stdin, secret: true });
    await sleep(60);
    await feed(stdin, ['z', 'q', ENTER]);
    const value = await promise;

    expect(value).toBe('zq');
    const rendered = chunks.join('');
    expect(rendered).not.toContain('zq'); // the key never echoes
    expect(rendered).toContain('**'); // but its length does
  });

  it('esc rejects with a typed USER_CANCELLED', async () => {
    // NOTE: the .rejects assertions attach BEFORE the escape lands so the
    // rejection is always handled (vitest reports a promise nobody has
    // attached to yet, even when a later expect consumes it).
    const { out } = fakeStdout();
    const stdin = fakeStdin();
    const selection = expect(
      askSelect('pick a color', COLORS, { stdout: out, stdin })
    ).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });
    await sleep(60);
    await feed(stdin, [ESCAPE]);
    await selection;

    const { out: out2 } = fakeStdout();
    const stdin2 = fakeStdin();
    const confirmation = expect(
      askConfirm('deploy now?', { stdout: out2, stdin: stdin2 })
    ).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });
    await sleep(60);
    await feed(stdin2, [ESCAPE]);
    await confirmation;

    const { out: out3 } = fakeStdout();
    const stdin3 = fakeStdin();
    const answer = expect(
      promptText('api key?', { stdout: out3, stdin: stdin3, secret: true })
    ).rejects.toMatchObject({
      code: 'USER_CANCELLED',
    });
    await sleep(60);
    await feed(stdin3, [ESCAPE]);
    await answer;
  });

  it('text submits on enter: typed input and prefilled defaults', async () => {
    const { out } = fakeStdout();
    const stdin = fakeStdin();
    const typed = promptText('project name?', { stdout: out, stdin, placeholder: 'plain text' });
    await sleep(60);
    await feed(stdin, ['a', 'b', ENTER]);
    await expect(typed).resolves.toBe('ab');

    // An unfilled default submits unchanged on a bare enter.
    const { out: out2 } = fakeStdout();
    const stdin2 = fakeStdin();
    const prefilled = promptText('project name?', {
      stdout: out2,
      stdin: stdin2,
      defaultValue: 'stitch',
    });
    await sleep(60);
    await feed(stdin2, [ENTER]);
    await expect(prefilled).resolves.toBe('stitch');
  });
});
