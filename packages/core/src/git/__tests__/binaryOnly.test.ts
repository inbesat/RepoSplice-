// Git Core epic consolidation (P-087): binary-only trees. NUL-bearing
// files must classify binary by every rule (magic bytes, gitattributes,
// extension lists), survive stash round-trips byte-exact, and still trip
// the clean guard with their real paths.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { makeTempRepo, commitFiles, disposeRepo } from '../../../test-utils/gitFixtures.js';
import { isBinary, classifyFiles } from '../binary.js';
import { safeStash, safeStashPop } from '../stash.js';
import { isClean, assertClean } from '../clean.js';

const BYTES_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x20]);
const BYTES_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xfe, 0x11, 0x21]);

describe('binary-only repos (P-087 epic edge)', () => {
  it('classifies by magic, attributes and extensions', async () => {
    const repo = await makeTempRepo('stitch-epic-bin-', {
      seed: {
        'img.bin': BYTES_A,
        'doc.txt': 'plain text\n',
        'data.dat': 'also text\n',
        '.gitattributes': '*.dat binary\n',
      },
    });
    try {
      const magic = await isBinary(repo, 'img.bin');
      expect(magic.isOk() && magic.value).toEqual({ binary: true, reason: 'magic' });
      const attr = await isBinary(repo, 'data.dat');
      expect(attr.isOk() && attr.value).toEqual({ binary: true, reason: 'attr' });
      const ext = await isBinary(repo, 'doc.txt', { binaryExts: ['.txt'] });
      // Extension lists fill the gap between attrs and sniffing.
      expect(ext.isOk() && ext.value).toEqual({ binary: true, reason: 'ext' });
      const text = await isBinary(repo, 'doc.txt');
      expect(text.isOk() && text.value).toEqual({ binary: false, reason: 'text' });
      const partitioned = await classifyFiles(repo, ['img.bin', 'doc.txt', 'data.dat']);
      expect(partitioned.isOk() && partitioned.value).toEqual({
        text: ['doc.txt'],
        binary: ['img.bin', 'data.dat'],
      });
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('stashes binary work byte-exact', async () => {
    const repo = await makeTempRepo('stitch-epic-bin-', {
      seed: { 'img.bin': BYTES_A },
    });
    try {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await writeFile(join(repo, 'img.bin'), BYTES_B);
      const stashed = await safeStash(repo, {});
      expect(stashed.isOk() && stashed.value.stashed).toBe(true);
      expect((await isClean(repo)).unwrapOr(false)).toBe(true);
      const popped = await safeStashPop(repo, {});
      expect(popped.isOk() && popped.value.popped).toBe(true);
      expect(await readFile(join(repo, 'img.bin'))).toEqual(BYTES_B);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('names binary paths in clean refusals', async () => {
    const repo = await makeTempRepo('stitch-epic-bin-', {
      seed: { 'img.bin': BYTES_A },
    });
    try {
      await commitFiles(repo, { 'second.bin': BYTES_B }, 'add second');
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await writeFile(join(repo, 'img.bin'), BYTES_B);
      expect((await isClean(repo)).unwrapOr(true)).toBe(false);
      const refused = await assertClean(repo, 'binary-guard');
      expect(refused.isErr()).toBe(true);
      if (refused.isOk()) return;
      expect(refused.error.code).toBe('GIT_ERROR');
      if (refused.error.code !== 'GIT_ERROR') return;
      expect(refused.error.message).toContain('img.bin');
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);

  it('untracked binaries count unless ignored', async () => {
    const repo = await makeTempRepo('stitch-epic-bin-', {
      seed: { 'img.bin': BYTES_A },
    });
    try {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await writeFile(join(repo, 'loose.bin'), BYTES_A);
      expect((await isClean(repo)).unwrapOr(true)).toBe(false);
      expect((await isClean(repo, { ignoreUntracked: true })).unwrapOr(false)).toBe(true);
    } finally {
      await disposeRepo(repo);
    }
  }, 30_000);
});
