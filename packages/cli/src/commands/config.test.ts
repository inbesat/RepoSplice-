// P-201 — `stitch config`: the --edit loop re-validates through loadConfig
// after every save, `--no-loop` validates exactly once, and the no-editor
// error propagates typed. The editor is the injected seam; each fake "save"
// writes real TOML into the real temp file so the P-200 loader decides.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { err, ok } from '@repo-stitcher/core';
import { configCommand, type ConfigCommandDeps } from './config.js';

const EMPTY_ENV: Record<string, string | undefined> = {};

/** The editor port, without the optionality the indexed access would add. */
type EditorPort = NonNullable<ConfigCommandDeps['openInEditor']>;

function editDeps(): {
  out: string[];
  err: string[];
  deps: ConfigCommandDeps & { setEditor: (behavior: (file: string) => Promise<void>) => void };
} {
  const out: string[] = [];
  const err: string[] = [];
  let behavior: ((file: string) => Promise<void>) | null = null;
  const editor: EditorPort = async (path: string) => {
    if (behavior === null) return ok({ saved: false, mtime: 0 });
    await behavior(path);
    return ok({ saved: true, mtime: 1 });
  };
  const deps: ConfigCommandDeps = {
    write: line => {
      out.push(line);
    },
    writeErr: line => {
      err.push(line);
    },
    openInEditor: editor,
  };
  return {
    out,
    err,
    deps: {
      ...deps,
      setEditor: next => {
        behavior = next;
      },
    },
  };
}

describe('P-201 stitch config', () => {
  it('prints the resolved path note and the effective JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-cfg-cmd-'));
    await writeFile(join(dir, 'stitch.toml'), '[sandbox]\nbackend = "github-actions"\n', 'utf8');
    const { out, err, deps } = editDeps();
    const result = await configCommand({ cwd: dir, env: EMPTY_ENV }, deps);
    expect(result.isOk()).toBe(true);
    expect(err.join('\n')).toContain('resolved config:');
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]!) as { sandbox: { backend: string } };
    expect(parsed.sandbox.backend).toBe('github-actions');
  });

  it('returns the valid config after one save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-cfg-cmd-'));
    await writeFile(join(dir, 'stitch.toml'), '[sandbox]\nbackend = "docker"\n', 'utf8');
    const { deps } = editDeps();
    deps.setEditor(async file => {
      await writeFile(file, '[sandbox]\nbackend = "github-actions"\n', 'utf8');
    });
    const result = await configCommand({ edit: true, cwd: dir, env: EMPTY_ENV }, deps);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.attempts).toBe(1);
      expect(result.value.config.sandbox.backend).toBe('github-actions');
      expect(result.value.path.endsWith('stitch.toml')).toBe(true);
    }
  });

  it('rescues parser restart on invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-cfg-cmd-'));
    await writeFile(join(dir, 'stitch.toml'), '[sandbox]\nbackend = "docker"\n', 'utf8');
    const { err, deps } = editDeps();
    let call = 0;
    deps.setEditor(async file => {
      call++;
      const body =
        call === 1
          ? '[sandbox]\nbackend = 3\n' // broken save: wrong type
          : '[sandbox]\nbackend = "docker"\n'; // fixed save
      await writeFile(file, body, 'utf8');
    });
    const result = await configCommand({ edit: true, cwd: dir, env: EMPTY_ENV }, deps);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.attempts).toBe(2);
    const notices = err.join('\n');
    expect(notices).toContain('stitch.toml is invalid');
    expect(notices).toContain('sandbox.backend');
  });

  it('no loop mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-cfg-cmd-'));
    await writeFile(join(dir, 'stitch.toml'), '[sandbox]\nbackend = "docker"\n', 'utf8');
    const { err, deps } = editDeps();
    deps.setEditor(async file => {
      await writeFile(file, '[sandbox]\nbackend = 3\n', 'utf8');
    });
    const result = await configCommand({ edit: true, loop: false, cwd: dir, env: EMPTY_ENV }, deps);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('CONFIG_INVALID');
    expect(err.join('\n')).toContain('attempt 1');
  });

  it('propagates the no-editor error typed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-cfg-cmd-'));
    await writeFile(join(dir, 'stitch.toml'), '[sandbox]\nbackend = "docker"\n', 'utf8');
    const deps: ConfigCommandDeps = {
      openInEditor: async () =>
        err({
          code: 'CONFIG_ERROR',
          field: 'editor',
          message: 'could not start the editor "notepad"; set $VISUAL or $EDITOR',
        }),
    };
    const result = await configCommand({ edit: true, cwd: dir, env: EMPTY_ENV }, deps);
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

  it('scaffolds a starter when no project config exists, then edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-cfg-cmd-'));
    const { deps } = editDeps();
    deps.setEditor(async file => {
      await writeFile(file, '[sandbox]\nbackend = "github-actions"\n', 'utf8');
    });
    const result = await configCommand({ edit: true, cwd: dir, env: EMPTY_ENV }, deps);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.sandbox.backend).toBe('github-actions');
    }
  });
});
