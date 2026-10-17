// P-198 — the imperative prompt wrappers: `askSelect`, `askMulti`,
// `askConfirm`, `promptText`. Any command that needs an answer routes
// through HERE so keyboard behavior (and `--yes` semantics) stay identical
// across merge/license/deps and HIL.
//
// Contracts (one table for every ask):
//
//   interactive (TTY, `--yes` absent)   the picker mounts; up/down move,
//                                       space toggles, enter submits, and
//                                       esc REJECTS a typed `USER_CANCELLED`
//                                       (P-163's rule: fatal, abort).
//   non-TTY or `--yes`                  the DEFAULT resolves immediately
//                                       (`confirm`: `--yes` wins over the
//                                       default; select/text resolve the
//                                       supplied default; multi resolves
//                                       the supplied defaults). With
//                                       `require: true` a missing default
//                                       rejects the same typed error —
//                                       "abort" per P-198 step 3 — because
//                                       silently fabricating an answer no
//                                       human gave is a hole, not a choice.
//
// Tests inject `stdout`/`stdin` fakes (the tui.test.tsx stream pattern); the
// TTY gate consults an injected stdout first, so the interactive paths are
// testable without touching the real streams. The real path gates on
// `process.stdout.isTTY` exactly like every other command.

import { render } from 'ink';
import { createElement as h, type ReactNode } from 'react';
import type { StitchError } from '@repo-stitcher/core';
import { Confirm, MultiSelect, Select, TextInput, type PickerOption } from './picker.js';

/** The typed cancellation every refuse path reuses (P-163 / P-198 step 4). */
export function cancelledError(reason: string): StitchError {
  return { code: 'USER_CANCELLED', reason };
}

/** Flags shared by every ask; `yes` models the global `--yes`. */
export interface AskOptions {
  /** Treat the ask as non-interactive (the P-189 `--yes` semantics). */
  yes?: boolean;
  /** Refuse a fabricated answer off-TTY: missing default → typed rejection. */
  require?: boolean;
  /** Injectable test surface; defaults to the process streams. */
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
}

/** What a picker calls back with: either a value or a cancellation. */
interface Outcome<T> {
  cancelled?: boolean;
  value?: T;
}

/** The TTY gate: an injected surface is consulted first (the test seam). */
function interactive(opts: AskOptions): boolean {
  const isTTY = opts.stdout === undefined ? process.stdout.isTTY : opts.stdout.isTTY;
  return isTTY === true && opts.yes !== true;
}

/**
 * resolve-or-reject defaults shared by every non-interactive branch:
 * `require` without a default must NOT be answered by invention.
 */
function typeOfNonInteractive<T>(
  opts: AskOptions & { defaultValue?: T },
  reason: string
): T | undefined {
  if (opts.defaultValue === undefined) {
    if (opts.require === true) throw cancelledError(reason);
    return undefined;
  }
  return opts.defaultValue;
}

/** Mount one picker, resolve/reject on its callback, always unmount. */
function runPicker<T>(
  spawn: (track: (outcome: Outcome<T>) => void) => ReactNode,
  opts: AskOptions
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const instance = render(
      spawn(outcome => {
        try {
          instance.unmount();
        } finally {
          if (outcome.cancelled === true) reject(cancelledError('cancelled'));
          else resolve(outcome.value as T);
        }
      }),
      {
        ...(opts.stdout !== undefined ? { stdout: opts.stdout } : {}),
        ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
        // The pickers never console.log, and ink's patch-console requires
        // the real Console constructor test runners wrap away.
        patchConsole: false,
        exitOnCtrlC: false,
        // The TTY gate above is the decision; ink's own detection would
        // also flip off under CI (is-in-ci), which would silently disable
        // input handling and strand the pickers waiting for keys.
        interactive: true,
      }
    );
  });
}

/**
 * askSelect: one value from a list. Arrows move with wrap-around, enter
 * picks. Non-interactive: the default (or null, or the `require` rejection).
 */
export async function askSelect(
  message: string,
  options: readonly PickerOption[],
  opts: AskOptions & { defaultValue?: string } = {}
): Promise<string | null> {
  if (!interactive(opts)) {
    const fallback = typeOfNonInteractive(
      opts,
      'a selection is required but stdin is not interactive — pass a default or answer on a TTY'
    );
    return fallback ?? null;
  }
  return runPicker<string>(
    track =>
      h(Select, {
        message,
        options,
        onSelect: (value: string) => track({ value }),
        onEscape: () => track({ cancelled: true }),
      }),
    opts
  );
}

/**
 * askMulti: many values (toggle with space, submit with enter). Returns
 * them in OPTION order. Non-interactive: the defaults (or an empty list),
 * or the `require` rejection when none are known.
 */
export async function askMulti(
  message: string,
  options: readonly PickerOption[],
  opts: AskOptions & { defaultValue?: readonly string[] } = {}
): Promise<string[]> {
  if (!interactive(opts)) {
    if (
      opts.require === true &&
      (opts.defaultValue === undefined || opts.defaultValue.length === 0)
    ) {
      throw cancelledError(
        'a multi-selection is required but stdin is not interactive — pass defaults or answer on a TTY'
      );
    }
    return [...(opts.defaultValue ?? [])];
  }
  return runPicker<string[]>(
    track =>
      h(MultiSelect, {
        message,
        options,
        ...(opts.defaultValue !== undefined ? { defaultValue: opts.defaultValue } : {}),
        onDone: (values: string[]) => track({ value: values }),
        onEscape: () => track({ cancelled: true }),
      }),
    opts
  );
}

/**
 * askConfirm: yes/no. Interactive: y/n keys, enter = the default. Non-
 * interactive: `--yes` → true; `require` → reject without a default;
 * otherwise the default (`false` when none was supplied — the P-189
 * convention of never assuming a yes the user did not give).
 */
export async function askConfirm(
  message: string,
  opts: AskOptions & { defaultChoice?: boolean } = {}
): Promise<boolean> {
  if (!interactive(opts)) {
    if (opts.yes === true) return true;
    if (opts.require === true && opts.defaultChoice === undefined) {
      throw cancelledError(
        'a confirmation is required but stdin is not interactive — pass a default, use --yes, or answer on a TTY'
      );
    }
    return opts.defaultChoice ?? false;
  }
  return runPicker<boolean>(
    track =>
      h(Confirm, {
        message,
        defaultChoice: opts.defaultChoice ?? false,
        onResolve: (choice: boolean) => track({ value: choice }),
        onEscape: () => track({ cancelled: true }),
      }),
    opts
  );
}

/**
 * promptText: free text; `secret: true` masks the rendered value (the typed
 * key is never echoed). Non-interactive: the default (or null), or the
 * `require` rejection — an API key prompt that resolves `${''}` is worse
 * than one that stops.
 */
export async function promptText(
  message: string,
  opts: AskOptions & { secret?: boolean; placeholder?: string; defaultValue?: string } = {}
): Promise<string | null> {
  if (!interactive(opts)) {
    const fallback = typeOfNonInteractive(
      opts,
      'an answer is required but stdin is not interactive — pass a default or answer on a TTY'
    );
    return fallback ?? null;
  }
  return runPicker<string>(
    track =>
      h(TextInput, {
        message,
        ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
        ...(opts.secret === true ? { secret: true } : {}),
        ...(opts.defaultValue !== undefined ? { defaultValue: opts.defaultValue } : {}),
        onSubmit: (value: string) => track({ value }),
        onEscape: () => track({ cancelled: true }),
      }),
    opts
  );
}
