// P-201 — editor integration: open a real file in $VISUAL/$EDITOR (or the
// platform default), await exit, and report whether the file changed. Used by
// `stitch config --edit` (and future merge --preflight reviews).
//
// Injection safety is by CONSTRUCTION: the editor and its exactly-one path
// argument go to `spawn` as separate strings with `shell: false` — no string
// command line is ever built, so a path with spaces/quotes/metacharacters
// cannot escape the argument (P-205 companion; locked by test).

import { statSync } from 'node:fs';
import { spawn, type SpawnOptions } from 'node:child_process';
import { err, ok, type Result, type StitchError } from '@repo-stitcher/core';

/** What the editor opening produced. */
export type EditorResult = {
  /** The file's mtime changed while the editor was open. */
  saved: boolean;
  /** The file's mtime after the editor closed (epoch ms). */
  mtime: number;
};

/** The spawned process, injected so tests can fake editors without faking processes. */
export type EditorSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => {
  on(event: 'error', listener: (e: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
};

/** The environment the editor name resolves from (injectable for tests). */
export type EditorOptions = {
  env?: Record<string, string | undefined>;
  /** Overrides the resolved editor command entirely (tests/favorites). */
  command?: string;
  /** Spawn seam; production default is `node:child_process`' `spawn`. */
  spawn?: EditorSpawn;
};

/**
 * Platform fallback when neither $VISUAL nor $EDITOR is set: notepad always
 * exists on Windows; vi survives on every minimal unix. (The spec's `code` is
 * not universal — a missing binary would read as "no editor", so the safest
 * platform-resident default wins; ADR-086.)
 */
function platformDefault(): string {
  return process.platform === 'win32' ? 'notepad' : 'vi';
}

/** The editor command for these options: $VISUAL → $EDITOR → platform default (spec order). */
export function resolveEditor(env: Record<string, string | undefined>): string {
  const visual = env['VISUAL'];
  if (visual !== undefined && visual.trim() !== '') return visual.trim();
  const editor = env['EDITOR'];
  if (editor !== undefined && editor.trim() !== '') return editor.trim();
  return platformDefault();
}

/**
 * openInEditor: launch `<editor> <path>` (argument-array spawn, `shell:false`),
 * wait for exit, and report whether the file's mtime moved while open. A
 * non-zero exit with an unchanged file is the user aborting — NOT an error.
 * An editor that cannot start (ENOENT on the platform default, most commonly)
 * is `CONFIG_ERROR{field:'editor'}` hinting at $VISUAL/$EDITOR — the `NO_EDITOR`
 * the phase names does not exist in StitchError (same coordinated-change reason
 * as ADR-072; recorded in ADR-086).
 */
export async function openInEditor(
  path: string,
  opts: EditorOptions = {}
): Promise<Result<EditorResult, StitchError>> {
  const env = opts.env ?? process.env;
  const command = opts.command ?? resolveEditor(env);
  const doSpawn = opts.spawn ?? (spawn as unknown as EditorSpawn);

  const before = statSync(path).mtimeMs;
  const child = doSpawn(command, [path], { stdio: 'inherit', shell: false });
  const outcome = await new Promise<Result<{ code: number | null }, StitchError>>(
    resolvePromise => {
      let settled = false;
      child.on('error', (e: Error) => {
        if (settled) return;
        settled = true;
        resolvePromise(
          err({
            code: 'CONFIG_ERROR',
            field: 'editor',
            message: `could not start the editor "${command}" (${e.message}); set $VISUAL or $EDITOR to an editor on PATH`,
          })
        );
      });
      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        resolvePromise(ok({ code }));
      });
    }
  );
  if (outcome.isErr()) return err(outcome.error);

  const after = statSync(path).mtimeMs;
  return ok({ saved: after !== before, mtime: after });
}
