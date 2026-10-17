// P-201 — editor integration: resolution order, injection-safe argument
// passing, saved detection via mtime, and the typed no-editor error. The
// spawn seam is injected, so no test launches a real process.
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openInEditor, resolveEditor, type EditorSpawn } from './editor.js';

type SpawnCall = {
  command: string;
  args: readonly string[];
  options: { shell: boolean | undefined };
};

/** A spawn fake whose behavior is scriptable per call; records every invocation. */
function fakeSpawn(
  behaviors: Array<(call: SpawnCall) => { error?: Error; code?: number | null }>
): { calls: SpawnCall[]; spawn: EditorSpawn } {
  const calls: SpawnCall[] = [];
  const spawn: EditorSpawn = (command, args, options) => {
    const call: SpawnCall = {
      command,
      args,
      options: { shell: typeof options.shell === 'string' ? true : options.shell },
    };
    calls.push(call);
    const outcome = behaviors[Math.min(calls.length - 1, behaviors.length - 1)]!(call);
    return {
      on: ((event: string, listener: (arg: unknown) => void) => {
        if (event === 'error' && outcome.error !== undefined) {
          setImmediate(() => listener(outcome.error as Error));
        }
        if (event === 'close' && outcome.error === undefined) {
          setImmediate(() => listener(outcome.code ?? 0));
        }
      }) as never,
    };
  };
  return { calls, spawn };
}

describe('P-201 editor integration', () => {
  it('opens and edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-edit-'));
    const file = join(dir, 'stitch.toml');
    writeFileSync(file, '[sandbox]\nbackend = "docker"\n', 'utf8');
    const { calls, spawn } = fakeSpawn([
      call => {
        // the "editor" saves: rewrite the file and bump its mtime
        writeFileSync(call.args[0]!, '[sandbox]\nbackend = "github-actions"\n', 'utf8');
        const later = new Date(Date.now() + 5_000);
        utimesSync(call.args[0]!, later, later);
        return { code: 0 };
      },
    ]);
    const result = await openInEditor(file, { env: { VISUAL: 'code' }, spawn });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.saved).toBe(true);
      expect(result.value.mtime).toBeGreaterThan(0);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('code');
    expect(calls[0]!.args).toEqual([file]);
    expect(calls[0]!.options.shell).toBe(false);
  });

  it('resolves VISUAL then EDITOR then the platform default', () => {
    expect(resolveEditor({ VISUAL: 'emacs', EDITOR: 'vi' })).toBe('emacs');
    expect(resolveEditor({ VISUAL: '', EDITOR: 'nano' })).toBe('nano');
    expect(resolveEditor({})).toBe(process.platform === 'win32' ? 'notepad' : 'vi');
  });

  it('no editor error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-edit-'));
    const file = join(dir, 'stitch.toml');
    writeFileSync(file, '', 'utf8');
    // neither env var set → the platform default is tried, and it is missing (ENOENT)
    const { spawn } = fakeSpawn([() => ({ error: new Error('spawn notepad ENOENT') })]);
    const result = await openInEditor(file, { env: {}, spawn });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('editor');
        expect(result.error.message).toContain('$VISUAL');
      } else {
        expect.fail(`expected CONFIG_ERROR, got ${result.error.code}`);
      }
    }
  });

  it('safe arg quoting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-edit-'));
    // spaces and shell metacharacters in the file name (the classic injection
    // vector; Windows forbids raw quotes in names, so they stay out)
    const subdir = join(dir, 'my & weird ; dir $HOME (bogus)');
    mkdirSync(subdir, { recursive: true });
    const file = join(subdir, 'stitch,;&$ (pl).toml');
    writeFileSync(file, '', 'utf8');
    const { calls, spawn } = fakeSpawn([() => ({ code: 0 })]);
    const result = await openInEditor(file, { env: { EDITOR: 'vim' }, spawn });
    expect(result.isOk()).toBe(true);
    // the path traveled as ONE argument, never through a shell
    expect(calls[0]!.args).toEqual([file]);
    expect(calls[0]!.options.shell).toBe(false);
    if (result.isOk()) expect(result.value.saved).toBe(false);
  });

  it('treats a nonzero exit with an unchanged file as an abort, not an error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-edit-'));
    const file = join(dir, 'stitch.toml');
    writeFileSync(file, '', 'utf8');
    const { spawn } = fakeSpawn([() => ({ code: 1 })]);
    const result = await openInEditor(file, { env: { EDITOR: 'vi' }, spawn });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.saved).toBe(false);
  });
});
