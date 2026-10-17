// P-196 — `stitch license` tests.
//
// The five mandated cases from the phase's "Tests Required" section, driven
// against REAL fixture dep trees (the real `scanDeclared` → license-checker)
// and a real user-config store in a temp directory:
//
//   it('renders table + verdict')      it('persists unknown decisions')
//   it('applies allow/deny flags')     it("won't override hard deny")
//   it('json output')
//   + 1 extra: ids that are not SPDX reject before anything is touched.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import {
  license,
  readLicenseDecisions,
  readLicensePolicy,
  type LicenseDeps,
  type LicenseOptions,
  type LicensePromptResult,
} from './license.js';
import { openStore, type JsonValue, type StitchStore } from '../config.js';

// ---------------------------------------------------------------------------
// fixtures — real temp trees + a real store
// ---------------------------------------------------------------------------

let tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(dir);
  return dir;
}

/** A fixture `node_modules` tree: one `package.json` per declared package. */
function makeDepFixture(
  packages: ReadonlyArray<{ pkg: string; version: string; license: string }>
): string {
  const root = tempDir('stitch-lic-fixture');
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  for (const spec of packages) {
    mkdirSync(join(root, 'node_modules', spec.pkg), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', spec.pkg, 'package.json'),
      JSON.stringify({ name: spec.pkg, version: spec.version, license: spec.license })
    );
  }
  return root;
}

function makeStore(): StitchStore {
  const opened = openStore(tempDir('stitch-lic-store'));
  if (opened.isErr()) throw new Error('temp store did not open');
  return opened.value;
}

/** Record one selection pointing at `name`; the resolve port maps it to a dir. */
function recordSelection(store: StitchStore, name: string): void {
  const record = store.set('sources', [{ source: name, paths: ['**/*'] }] as unknown as JsonValue);
  expect(record.isOk()).toBe(true);
}

type ResolveSourceFn = NonNullable<LicenseDeps['resolveSource']>;

function resolveOf(map: Record<string, string>): ResolveSourceFn {
  return async (source: string) => {
    const dir = map[source];
    if (dir === undefined) {
      return err({ code: 'CONFIG_ERROR', field: 'source', message: `no fixture for ${source}` });
    }
    return ok(dir);
  };
}

interface RunOutcome {
  lines: string[];
  result: Result<void, StitchError>;
}

/** Drive `license` with deterministic globals and a captured writer. */
async function runLicense(opts: Partial<LicenseOptions>, deps: LicenseDeps): Promise<RunOutcome> {
  const lines: string[] = [];
  const result = await license(
    { verbose: false, yes: false, offline: false, color: false, ...opts },
    {
      ...deps,
      write: (line: string) => {
        lines.push(line);
      },
    }
  );
  return { lines, result };
}

// ---------------------------------------------------------------------------
// the five mandated cases + the guard extra
// ---------------------------------------------------------------------------

describe('P-196 stitch license', () => {
  it('renders table + verdict', async () => {
    const root = makeDepFixture([
      { pkg: 'alpha', version: '1.0.0', license: 'MIT' },
      { pkg: 'beta', version: '2.1.0', license: 'GPL-3.0-only' },
    ]);
    const store = makeStore();
    recordSelection(store, 'fixture');

    const { lines, result } = await runLicense(
      {},
      { store, resolveSource: resolveOf({ fixture: root }) }
    );

    expect(result.isOk()).toBe(true);
    expect(lines.find(line => line.startsWith('package '))).toBeDefined();
    const alphaRow = lines.find(line => line.startsWith('alpha'));
    expect(alphaRow).toBeDefined();
    expect(alphaRow).toContain('MIT');
    expect(alphaRow).toContain('permissive');
    const betaRow = lines.find(line => line.startsWith('beta'));
    expect(betaRow).toBeDefined();
    expect(betaRow).toContain('strong-copyleft');
    // Strong copyleft vs a permissive target is a matrix REVIEW (P-120), plus
    // the GPL warning — the verdict is review and it blocks.
    expect(betaRow).toContain('review');
    expect(lines.some(line => line.includes('verdict:') && line.includes('review'))).toBe(true);
  });

  it('persists unknown decisions', async () => {
    const root = makeDepFixture([
      { pkg: 'alpha', version: '1.0.0', license: 'MIT' },
      { pkg: 'mystery', version: '0.0.1', license: 'SEE LICENSE IN README' },
    ]);
    const store = makeStore();
    recordSelection(store, 'fixture');
    const asked: string[] = [];

    const { lines, result } = await runLicense(
      {},
      {
        store,
        resolveSource: resolveOf({ fixture: root }),
        prompt: async ctx => {
          asked.push(`${ctx.package}@${ctx.version}`);
          return 'allow' as const;
        },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(asked).toEqual(['mystery@0.0.1']);
    expect(readLicenseDecisions(store)).toEqual([
      { package: 'mystery', version: '0.0.1', decision: 'allow' },
    ]);
    // The row resolves to allow (decision column) and the policy engine's
    // reason names the override; the pending queue empties.
    expect(lines.find(line => line.startsWith('mystery'))).toContain('allow');
    expect(lines.some(line => line.includes('unknown-resolved:'))).toBe(true);
    expect(lines.find(line => line.includes('unknown licenses ('))).toContain('(0 pending)');
    expect(lines.some(line => line.startsWith('decisions recorded: 1'))).toBe(true);
  });

  it('applies allow/deny flags', async () => {
    const root = makeDepFixture([{ pkg: 'alpha', version: '1.0.0', license: 'MIT' }]);
    const store = makeStore();
    recordSelection(store, 'fixture');

    const { result } = await runLicense(
      { allow: [' Apache-2 '], deny: ['GPL-3.0-only'] },
      { store, resolveSource: resolveOf({ fixture: root }) }
    );

    expect(result.isOk()).toBe(true);
    const policy = readLicensePolicy(store);
    expect(policy.allow).toEqual(['Apache-2.0']);
    expect(policy.deny).toEqual(['GPL-3.0-only']);
  });

  it("won't override hard deny", async () => {
    const root = makeDepFixture([
      { pkg: 'alpha', version: '1.0.0', license: 'MIT' },
      // AGPL = network copyleft: denied outright against a permissive target.
      { pkg: 'beta', version: '2.1.0', license: 'AGPL-3.0-only' },
      { pkg: 'mystery', version: '0.0.1', license: 'SEE LICENSE IN README' },
    ]);
    const store = makeStore();
    recordSelection(store, 'fixture');

    const { lines, result } = await runLicense(
      { allow: ['AGPL-3.0-only'] },
      {
        store,
        resolveSource: resolveOf({ fixture: root }),
        prompt: async () => 'allow' as LicensePromptResult,
      }
    );

    expect(result.isOk()).toBe(true);
    // The human allowances WERE recorded: the id in the policy lists, the
    // unknown resolved in its row and named by the engine's reason...
    expect(lines.find(line => line.startsWith('mystery'))).toContain('allow');
    expect(lines.some(line => line.includes('unknown-resolved:'))).toBe(true);
    expect(
      lines.some(line => line.startsWith('policy lists: ') && line.includes('[AGPL-3.0-only]'))
    ).toBe(true);
    // ...but the network-copyleft package stays matrix-denied (P-120/P-163) —
    // no recorded override passes a hard deny.
    expect(lines.some(line => line.includes('verdict:') && line.includes('deny'))).toBe(true);
  });

  it('json output', async () => {
    const root = makeDepFixture([
      { pkg: 'alpha', version: '1.0.0', license: 'MIT' },
      { pkg: 'mystery', version: '0.0.1', license: 'SEE LICENSE IN README' },
    ]);
    const store = makeStore();
    recordSelection(store, 'fixture');

    const { lines, result } = await runLicense(
      { json: true },
      { store, resolveSource: resolveOf({ fixture: root }) }
    );

    expect(result.isOk()).toBe(true);
    const data = JSON.parse(lines.join('\n')) as {
      reportVersion: number;
      verdict: string;
      rows: Array<{ package: string; category: string; decision: string }>;
      summary: { total: number; unknown: number; gplWarnings: number };
      unknown: Array<{ package: string; decision: string }>;
    };
    expect(data.reportVersion).toBe(1);
    expect(data.summary.total).toBe(2);
    // No prompt port was given, so the unknown stays pending in the data; with
    // the default policy (denyUnknown: true) the unknown id hard-denies.
    expect(data.summary.unknown).toBe(1);
    expect(data.verdict).toBe('deny');
    expect(data.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ package: 'alpha', category: 'permissive' }),
        expect.objectContaining({ package: 'mystery', category: 'unknown', decision: 'review' }),
      ])
    );
    expect(data.unknown).toEqual([
      expect.objectContaining({ package: 'mystery', decision: 'pending' }),
    ]);
  });

  it('rejects license ids that are not SPDX before touching anything', async () => {
    const root = makeDepFixture([{ pkg: 'alpha', version: '1.0.0', license: 'MIT' }]);
    const store = makeStore();
    recordSelection(store, 'fixture');

    const { result } = await runLicense(
      { allow: ['NOT A SPDX ID'] },
      { store, resolveSource: resolveOf({ fixture: root }) }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.message).toContain('NOT A SPDX ID');
      }
    }
    expect(readLicensePolicy(store).allow).toEqual([]);
  });
});
