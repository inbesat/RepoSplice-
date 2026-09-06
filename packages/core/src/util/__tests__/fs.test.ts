// P-035 tests: staging helpers over real tmp dirs — copy/move,
// ensure/empty/remove/exists, overwrite semantics, and traversal
// rejection (no fs call happens on escape). Hermetic (tmpdir only).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDir, emptyDir, removePath, pathExists, copyTree, movePath } from '../fs.js';

let root: string;
let staging: string;

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function read(rel: string, base: string = root): string {
  return readFileSync(join(base, rel), 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stitch-fs-src-'));
  staging = mkdtempSync(join(tmpdir(), 'stitch-fs-stage-'));
  write(join('pkg', 'index.ts'), 'export const x = 1;');
  write(join('pkg', 'sub', 'data.json'), '{"a":1}');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
});

describe('P-035 copyTree: copy tree (spec smoke test)', () => {
  it('copies a tree with contents intact and returns the dest', async () => {
    const r = await copyTree(root, 'pkg', staging, 'pkg');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(read(join('pkg', 'index.ts'), staging)).toBe('export const x = 1;');
      expect(read(join('pkg', 'sub', 'data.json'), staging)).toBe('{"a":1}');
    }
  });

  it('copies a single file', async () => {
    const r = await copyTree(root, join('pkg', 'index.ts'), staging, 'copied.ts');
    if (r.isErr()) throw r.error;
    expect(read('copied.ts', staging)).toBe('export const x = 1;');
  });

  it('missing source maps to err (no partial dest)', async () => {
    const r = await copyTree(root, 'nope-missing', staging, 'out');
    expect(r.isErr()).toBe(true);
  });

  it('overwrite:false on an existing dest maps to err', async () => {
    const first = await copyTree(root, 'pkg', staging, 'pkg');
    if (first.isErr()) throw first.error;
    const second = await copyTree(root, 'pkg', staging, 'pkg', { overwrite: false });
    expect(second.isErr()).toBe(true);
  });
});

describe('P-035 ensureDir + emptyDir (spec smoke test)', () => {
  it('ensureDir creates nested dirs and returns the path', async () => {
    const r = await ensureDir(staging, 'a', 'b', 'c');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const exists = await pathExists(staging, 'a', 'b', 'c');
      if (exists.isErr()) throw exists.error;
      expect(exists.value).toBe(true);
    }
  });

  it('emptyDir creates a missing dir', async () => {
    const r = await emptyDir(staging, 'fresh');
    if (r.isErr()) throw r.error;
    const exists = await pathExists(staging, 'fresh');
    if (exists.isErr()) throw exists.error;
    expect(exists.value).toBe(true);
  });

  it('emptyDir clears an existing dir but keeps it', async () => {
    const setup = await copyTree(root, 'pkg', staging, 'work');
    if (setup.isErr()) throw setup.error;
    const r = await emptyDir(staging, 'work');
    if (r.isErr()) throw r.error;
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(join(staging, 'work'))).toEqual([]);
    const stillThere = await pathExists(staging, 'work');
    if (stillThere.isErr()) throw stillThere.error;
    expect(stillThere.value).toBe(true);
  });
});

describe('P-035 movePath + removePath + pathExists', () => {
  it('movePath relocates and removes the source', async () => {
    const r = await movePath(root, 'pkg', staging, 'moved');
    if (r.isErr()) throw r.error;
    expect(read(join('moved', 'index.ts'), staging)).toBe('export const x = 1;');
    const gone = await pathExists(root, 'pkg');
    if (gone.isErr()) throw gone.error;
    expect(gone.value).toBe(false);
  });

  it('removePath deletes a tree and is a no-op success when missing', async () => {
    const r = await removePath(root, 'pkg');
    if (r.isErr()) throw r.error;
    const gone = await pathExists(root, 'pkg');
    if (gone.isErr()) throw gone.error;
    expect(gone.value).toBe(false);
    const again = await removePath(root, 'pkg');
    expect(again.isOk()).toBe(true);
  });

  it('pathExists reports true/false', async () => {
    const yes = await pathExists(root, 'pkg', 'index.ts');
    const no = await pathExists(root, 'pkg', 'missing.ts');
    if (yes.isErr() || no.isErr()) throw new Error('unexpected err');
    expect(yes.value).toBe(true);
    expect(no.value).toBe(false);
  });
});

describe('P-035 traversal reject (spec smoke test)', () => {
  it('ensureDir rejects .. escape with err (no fs call)', async () => {
    const r = await ensureDir(root, '..', 'escape-p035');
    expect(r.isErr()).toBe(true);
  });

  it('copyTree rejects dest escape', async () => {
    const r = await copyTree(root, 'pkg', staging, join('..', 'escape-p035'));
    expect(r.isErr()).toBe(true);
  });

  it('copyTree rejects source escape', async () => {
    const r = await copyTree(root, join('..', 'escape-p035'), staging, 'out');
    expect(r.isErr()).toBe(true);
  });

  it('pathExists rejects escape with err (not false)', async () => {
    const r = await pathExists(root, '..', 'escape-p035');
    expect(r.isErr()).toBe(true);
  });

  it('absolute path outside root is rejected', async () => {
    const r = await removePath(root, tmpdir());
    expect(r.isErr()).toBe(true);
  });
});
