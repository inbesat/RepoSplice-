// P-186 — checksum manifest tests, against a REAL temp tree.
//
// The tree is written to disk and hashed for real: the manifest's whole purpose is
// to detect that bytes CHANGED, which a mocked hasher cannot demonstrate. The
// tamper case rewrites a file and asserts the drift is caught.
//
// The six required scenarios from the phase spec:
//
//   it('builds sorted manifest')     it('stable manifest sha')
//   it('writes file')                it('verifies clean')
//   it('detects tampered file')      it('respects ignore globs')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProvenanceMap } from './map.js';
import {
  CHECKSUM_MANIFEST_FILENAME,
  DEFAULT_CHECKSUM_IGNORES,
  buildChecksumManifest,
  renderChecksumFile,
  verifyChecksums,
} from './checksums.js';

const FIXED_TS = '2026-10-16T00:00:00.000Z';

/** Write a tree of relative-path → content files. */
async function seed(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-checksums-'));
  await seed(root, {
    'z.txt': 'last\n',
    'a.txt': 'first\n',
    'lib/util.go': 'package lib\n',
    'node_modules/dep/index.js': 'module.exports = 1;\n',
    'dist/bundle.js': 'bundled\n',
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('P-186 checksums', () => {
  it('builds sorted manifest', async () => {
    const built = await buildChecksumManifest(root, { now: () => FIXED_TS });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    const manifest = built.value;

    expect(manifest.algorithm).toBe('sha256');
    expect(manifest.generatedAt).toBe(FIXED_TS);
    expect(manifest.manifestSha256).toMatch(/^[0-9a-f]{64}$/);

    // Only the three tracked files; node_modules and dist are ignored by default.
    expect(manifest.entries.map(entry => entry.path)).toEqual(['a.txt', 'lib/util.go', 'z.txt']);
    for (const entry of manifest.entries) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sizeBytes).toBeGreaterThan(0);
    }
    // Sizes are actual byte counts.
    expect(manifest.entries.find(entry => entry.path === 'a.txt')?.sizeBytes).toBe(6);

    // Sorted by path — the ordering a stable export depends on.
    const paths = manifest.entries.map(entry => entry.path);
    expect([...paths].sort()).toEqual(paths);

    // …and the hashes are the real digests of the real bytes.
    const expected = await readFile(join(root, 'a.txt'));
    const { createHash } = await import('node:crypto');
    const awaited = createHash('sha256').update(expected).digest('hex');
    expect(manifest.entries.find(entry => entry.path === 'a.txt')?.sha256).toBe(awaited);

    // A binary file is hashed as BYTES, not as decoded text.
    await writeFile(join(root, 'blob.bin'), Buffer.from([0x00, 0xff, 0x10, 0x80]));
    const withBinary = await buildChecksumManifest(root);
    expect(withBinary.isOk()).toBe(true);
    if (withBinary.isOk()) {
      const binary = withBinary.value.entries.find(entry => entry.path === 'blob.bin');
      expect(binary?.sizeBytes).toBe(4);
      expect(binary?.sha256).toBe(
        createHash('sha256')
          .update(Buffer.from([0x00, 0xff, 0x10, 0x80]))
          .digest('hex')
      );
    }

    // A blank repo is a typed config error.
    const blank = await buildChecksumManifest('   ');
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('stable manifest sha', async () => {
    const first = await buildChecksumManifest(root, { now: () => FIXED_TS });
    const second = await buildChecksumManifest(root, { now: () => FIXED_TS });
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isErr() || second.isErr()) return;

    expect(second.value.manifestSha256).toBe(first.value.manifestSha256);

    // THE POINT: the manifest hash does NOT depend on the timestamp, so a rebuild
    // of an unchanged tree is recognisably the same tree.
    const laterStamp = await buildChecksumManifest(root, { now: () => '2030-01-01T00:00:00.000Z' });
    expect(laterStamp.isOk()).toBe(true);
    if (laterStamp.isOk()) {
      expect(laterStamp.value.generatedAt).not.toBe(first.value.generatedAt);
      expect(laterStamp.value.manifestSha256).toBe(first.value.manifestSha256);
    }

    // A changed byte DOES move the manifest hash.
    await writeFile(join(root, 'a.txt'), 'changed\n');
    const changed = await buildChecksumManifest(root);
    if (changed.isOk()) expect(changed.value.manifestSha256).not.toBe(first.value.manifestSha256);
  });

  it('writes file', async () => {
    // Render-only when no target is given.
    const rendered = await buildChecksumManifest(root, { now: () => FIXED_TS });
    expect(rendered.isOk()).toBe(true);

    const written = await buildChecksumManifest(root, { repoC: root, now: () => FIXED_TS });
    expect(written.isOk()).toBe(true);
    if (written.isErr()) return;

    const target = join(root, CHECKSUM_MANIFEST_FILENAME);
    await expect(stat(target)).resolves.toBeTruthy();
    const onDisk = await readFile(target, 'utf8');

    // `sha256sum`-compatible: `<hash>  <path>` with TWO spaces, sorted, trailing NL.
    const lines = onDisk.split('\n').filter(line => line !== '');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{64} {2}\S/);
    expect(lines[0]?.endsWith('  a.txt')).toBe(true);
    expect(onDisk).toBe(renderChecksumFile(written.value.entries));

    // A blank target is a typed config error, not a silent skip.
    const blank = await buildChecksumManifest(root, { repoC: '  ' });
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('verifies clean', async () => {
    const built = await buildChecksumManifest(root);
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;

    const verified = await verifyChecksums(root, built.value);
    expect(verified.isOk()).toBe(true);
    if (verified.isOk()) {
      expect(verified.value.valid).toBe(true);
      expect(verified.value.mismatches).toEqual([]);
    }

    // A blank repo is a typed config error.
    const blank = await verifyChecksums('   ', built.value);
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');

    // An EMPTY manifest verifies trivially rather than failing.
    const empty = await verifyChecksums(root, { ...built.value, entries: [] });
    expect(empty.isOk()).toBe(true);
    if (empty.isOk()) expect(empty.value.valid).toBe(true);
  });

  it('detects tampered file', async () => {
    const built = await buildChecksumManifest(root);
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;

    // Drift: same name, different bytes.
    await writeFile(join(root, 'a.txt'), 'tampered\n');
    const drifted = await verifyChecksums(root, built.value);
    expect(drifted.isOk()).toBe(true);
    if (drifted.isOk()) {
      expect(drifted.value.valid).toBe(false);
      expect(drifted.value.mismatches).toEqual(['a.txt']);
    }

    // Absence is ALSO a mismatch — "C is not what was recorded" — not an error.
    await rm(join(root, 'a.txt'));
    const missing = await verifyChecksums(root, built.value);
    expect(missing.isOk()).toBe(true);
    if (missing.isOk()) {
      expect(missing.value.valid).toBe(false);
      expect(missing.value.mismatches).toEqual(['a.txt']);
    }

    // A size change on an otherwise-identical prefix is still caught.
    await writeFile(join(root, 'z.txt'), 'last\nlonger\n');
    const grown = await verifyChecksums(root, built.value);
    if (grown.isOk()) expect(grown.value.mismatches).toContain('z.txt');

    // …and a reconstructed map carrying the manifest path keeps it queryable.
    const map = ProvenanceMap.from([], [], join(root, CHECKSUM_MANIFEST_FILENAME));
    expect(map.checksumManifestPath).toBe(join(root, CHECKSUM_MANIFEST_FILENAME));
    expect(ProvenanceMap.from([]).checksumManifestPath).toBeUndefined();
  });

  it('respects ignore globs', async () => {
    // Defaults exclude vcs/deps/build output, and the manifest itself.
    const defaults = await buildChecksumManifest(root);
    expect(defaults.isOk()).toBe(true);
    if (defaults.isOk()) {
      const paths = defaults.value.entries.map(entry => entry.path);
      expect(paths).not.toContain('node_modules/dep/index.js');
      expect(paths).not.toContain('dist/bundle.js');
    }

    // Extra globs are honoured on top of the defaults.
    const extra = await buildChecksumManifest(root, { ignore: ['**/lib/**'] });
    expect(extra.isOk()).toBe(true);
    if (extra.isOk()) {
      const paths = extra.value.entries.map(entry => entry.path);
      expect(paths).toEqual(['a.txt', 'z.txt']);
    }

    // A caller can narrow the walk to a single subtree via patterns? No — the
    // walk is whole-tree by design; assert the ignore list is what is exported.
    expect(DEFAULT_CHECKSUM_IGNORES).toContain('**/.git/**');
    expect(DEFAULT_CHECKSUM_IGNORES).toContain(CHECKSUM_MANIFEST_FILENAME);

    // Writing the manifest does not make it hash itself on a second run.
    await buildChecksumManifest(root, { repoC: root });
    const afterWrite = await buildChecksumManifest(root);
    if (afterWrite.isOk() && defaults.isOk()) {
      expect(afterWrite.value.entries.map(entry => entry.path)).toEqual(
        defaults.value.entries.map(entry => entry.path)
      );
    }
  });
});
