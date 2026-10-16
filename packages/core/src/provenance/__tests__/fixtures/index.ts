// P-188 — the committed provenance fixtures.
//
// The phase asks for "two committed tiny JS repos A/B". They are committed here as
// CONTENT (a path → file map) and MATERIALIZED at test time, for two reasons:
//
//   1. A literal `.git` directory inside `packages/core/src` would be walked by
//      lint and dep-cruise, and a committed object database bakes in
//      machine-authored commit SHAs.
//   2. Authoring them at test time through `commitFiles` + `FIXTURE_IDENTITY`
//      makes authorship deterministic on every machine — which is exactly the
//      property P-204's CLI integration tests will rely on when they reuse these
//      fixtures.
//
// The CONTENT is shared and reviewed; the GIT METADATA is regenerated. A test that
// needs a stable commit SHA reads it back from `headSha`, never from a literal.

/** Relative path → file content. */
export type FixtureFiles = Readonly<Record<string, string>>;

/** A tiny JS repo whose files are teleported under `repo-a/` when staged into C. */
export const FIXTURE_REPO_A: FixtureFiles = {
  'lib/util.js':
    '// util\nexport const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
  'lib/index.js': "export * from './util.js';\n",
  'README.md': '# Fixture A\n\nA tiny upstream repository used by the provenance suite.\n',
};

/** A second tiny JS repo, teleported under `repo-b/`. */
export const FIXTURE_REPO_B: FixtureFiles = {
  'cmd/main.js': "import { add } from '../lib/util.js';\n\nconsole.log(add(1, 2));\n",
  LICENSE: 'MIT License\n\nCopyright (c) fixture authors\n',
};

/** The teleport prefix each source is staged under (P-070's filter-repo shape). */
export const FIXTURE_PREFIX_A = 'repo-a';
export const FIXTURE_PREFIX_B = 'repo-b';

/** One source repo as a fixture: a label, a prefix, and its files. */
export interface FixtureRepo {
  /** The `BlameSource.name` this repo is registered under. */
  name: string;
  /** The child-tree prefix the repo's files are staged under. */
  prefix: string;
  files: FixtureFiles;
}

/** Both fixtures, in A-then-B order (order decides the `'A'`/`'B'` labels). */
export const FIXTURE_REPOS: readonly FixtureRepo[] = [
  { name: 'repo-a', prefix: FIXTURE_PREFIX_A, files: FIXTURE_REPO_A },
  { name: 'repo-b', prefix: FIXTURE_PREFIX_B, files: FIXTURE_REPO_B },
];
