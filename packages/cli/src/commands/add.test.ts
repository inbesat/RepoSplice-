// P-191 — `stitch add` tests.
//
// The ports are injected, so these run without git, a network, a home directory or a
// config file. The glob matcher is a small TEST DOUBLE standing in for P-036 (the
// canonical matcher): the point here is that `add` DELEGATES matching and records
// exactly what the matcher returned, not that this file re-implements globbing.
//
// The six required scenarios from the phase spec:
//
//   it('adds local paths')  it('resolves globs')  it('errors on no match')
//   it('dedupes re-add')    it('pins branch')     it('offline local only')

import { describe, it, expect } from 'vitest';
import { ok } from 'neverthrow';
import type { GlobalOptions } from '../globals.js';
import { add, looksRemote, type AddDeps, type SourceSelection } from './add.js';

const BASE: GlobalOptions = { verbose: false, yes: false, offline: false, color: true };

const FILES = ['src/a.ts', 'src/b.ts', 'README.md'];

/** A tiny glob double for P-036: `**` crosses separators, `*` does not. */
function globMatch(patterns: readonly string[], files: readonly string[]): string[] {
  const toRegExp = (pattern: string): RegExp =>
    new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '@@DS@@')
        .replace(/\*/g, '[^/]*')
        .replace(/@@DS@@/g, '.*')}$`
    );
  const regexps = patterns.map(toRegExp);
  return files.filter(file => regexps.some(re => re.test(file)));
}

/** Deps with every port stubbed; `saved` records each persist call. */
function deps(
  over: Partial<AddDeps> = {},
  initial: SourceSelection[] = []
): AddDeps & { lines: string[]; saved: SourceSelection[][] } {
  const lines: string[] = [];
  const saved: SourceSelection[][] = [];
  return {
    lines,
    saved,
    resolveSource: async () => ok('/work/source'),
    listFiles: async () => ok([...FILES]),
    match: globMatch,
    loadSources: () => ok(initial),
    saveSources: sources => {
      saved.push(sources);
      return ok(undefined);
    },
    write: (line: string) => void lines.push(line),
    ...over,
  };
}

describe('P-191 stitch add', () => {
  it('adds local paths', async () => {
    const d = deps();
    const result = await add({ ...BASE }, { source: './local', paths: ['src/a.ts'] }, d);
    expect(result.isOk()).toBe(true);

    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toEqual([{ source: './local', paths: ['src/a.ts'] }]);

    // The summary names the source, the count, and the next step.
    const text = d.lines.join('\n');
    expect(text).toContain('./local');
    expect(text).toContain('1 file');
    expect(text).toContain('stitch merge');

    // A missing source or an empty pattern list is refused before any work.
    expect((await add({ ...BASE }, { source: '  ', paths: ['a'] }, deps())).isErr()).toBe(true);
    expect((await add({ ...BASE }, { source: './local', paths: [] }, deps())).isErr()).toBe(true);
  });

  it('resolves globs', async () => {
    const glob = deps();
    await add({ ...BASE }, { source: './local', paths: ['src/**'] }, glob);
    expect(glob.saved[0]?.[0]?.paths).toEqual(['src/a.ts', 'src/b.ts']);

    // Mixed patterns union, then dedupe and sort.
    const mixed = deps();
    await add({ ...BASE }, { source: './local', paths: ['src/*.ts', 'README.md'] }, mixed);
    expect(mixed.saved[0]?.[0]?.paths).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);

    // A path listed twice is recorded once.
    const dupe = deps();
    await add({ ...BASE }, { source: './local', paths: ['src/a.ts', 'src/a.ts'] }, dupe);
    expect(dupe.saved[0]?.[0]?.paths).toEqual(['src/a.ts']);
  });

  it('errors on no match', async () => {
    const d = deps();
    const result = await add({ ...BASE }, { source: './local', paths: ['nope/**'] }, d);

    // The phase names `err('NO_PATHS_MATCH')`; that code does NOT exist in StitchError,
    // so the refusal is a CONFIG_ERROR the caller can fix by naming other paths.
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('paths');
        expect(result.error.message).toContain('no files matched');
        // The refusal SUGGESTS candidates rather than only complaining.
        expect(result.error.message).toContain('did you mean');
      }
    }
    // Refusing is a pure read: nothing was persisted.
    expect(d.saved).toEqual([]);

    // `--allow-empty` records the selection deliberately.
    const allowed = deps();
    const withEmpty = await add(
      { ...BASE, allowEmpty: true },
      { source: './local', paths: ['nope/**'] },
      allowed
    );
    expect(withEmpty.isOk()).toBe(true);
    expect(allowed.saved[0]?.[0]?.paths).toEqual([]);
  });

  it('dedupes re-add', async () => {
    const existing: SourceSelection[] = [{ source: './local', paths: ['src/a.ts'] }];

    // Re-adding exactly what is recorded is a NO-OP WARNING, not an error, and does
    // not write the store again.
    const same = deps({}, existing);
    const result = await add({ ...BASE }, { source: './local', paths: ['src/a.ts'] }, same);
    expect(result.isOk()).toBe(true);
    expect(same.saved).toEqual([]);
    expect(same.lines.join('\n')).toContain('Already recorded');

    // A genuinely new path for the same source is appended, keeping the old one.
    const grown = deps({}, existing);
    await add({ ...BASE }, { source: './local', paths: ['src/b.ts'] }, grown);
    expect(grown.saved[0]).toHaveLength(2);
    expect(grown.saved[0]?.[1]?.paths).toEqual(['src/b.ts']);

    // A different REF is a different selection, so it is not deduped away.
    const refd = deps({}, [{ source: './local', paths: ['src/a.ts'], ref: 'v1' }]);
    await add({ ...BASE }, { source: './local', paths: ['src/a.ts'] }, refd);
    expect(refd.saved).toHaveLength(1);
  });

  it('pins branch', async () => {
    const refs: Array<string | undefined> = [];
    const d = deps({
      resolveSource: async (_source, options) => {
        refs.push(options.ref);
        return ok('/work/clone');
      },
    });

    const result = await add(
      { ...BASE, branch: 'v1.2.3' },
      { source: 'acme/lib', paths: ['src/a.ts'] },
      d
    );
    expect(result.isOk()).toBe(true);

    // The ref reaches the resolver (so the clone is pinned)…
    expect(refs).toEqual(['v1.2.3']);
    // …and is recorded, which is what P-181's provenance reads back.
    expect(d.saved[0]?.[0]).toEqual({
      source: 'acme/lib',
      paths: ['src/a.ts'],
      ref: 'v1.2.3',
    });
    expect(d.lines.join('\n')).toContain('@ v1.2.3');

    // Without --branch a remote source records no ref at all (not `undefined`).
    const unpinned = deps();
    await add({ ...BASE }, { source: 'acme/lib', paths: ['src/a.ts'] }, unpinned);
    expect(unpinned.saved[0]?.[0]).toEqual({ source: 'acme/lib', paths: ['src/a.ts'] });
  });

  it('offline local only', async () => {
    // A remote source needs the network by definition.
    const offlineRemote = deps();
    const refused = await add(
      { ...BASE, offline: true },
      { source: 'acme/lib', paths: ['src/a.ts'] },
      offlineRemote
    );
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) expect(refused.error.code).toBe('CONFIG_ERROR');
    expect(offlineRemote.saved).toEqual([]);

    // …while a local source works offline.
    const localOffline = deps();
    expect(
      (
        await add(
          { ...BASE, offline: true },
          { source: './local', paths: ['src/a.ts'] },
          localOffline
        )
      ).isOk()
    ).toBe(true);
    expect(localOffline.saved).toHaveLength(1);

    // The remote/local decision is a predicate, so it is asserted directly too.
    expect(looksRemote('acme/lib')).toBe(true);
    expect(looksRemote('./local')).toBe(false);
    expect(looksRemote('/abs/path')).toBe(false);
    expect(looksRemote('deep/nested/path')).toBe(false);
    expect(looksRemote('C:\\repo\\x')).toBe(false);
  });
});
