// P-314 — the contract freeze gate's own tests.
//
// The gate is repo tooling, so it is tested with its own vitest project
// (scripts/vitest.config.ts) instead of touching the frozen root config.
// No jest-dom here — this is a node-environment suite.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authorizedPaths,
  diffFreeze,
  formatReport,
  hashOf,
  main,
  readManifest,
  REQUIRED_CONTRACT_PATHS,
  type FreezeManifest,
} from './contract-freeze.js';

const CONTRACT_PATH = 'packages/core/src/events/topics.ts';

const roots: string[] = [];

function writeContract(root: string, relPath: string, body: string): void {
  const target = join(root, ...relPath.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, body);
}

/** A temp root that mirrors the whole required contract set. */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'stitch-freeze-'));
  roots.push(root);
  for (const relPath of REQUIRED_CONTRACT_PATHS) {
    writeContract(
      root,
      relPath,
      `export const ${relPath.split('/').pop()?.replace('.ts', '')} = 1;\n`
    );
  }
  writeContract(root, CONTRACT_PATH, 'export const TOPICS = ["merge"];\n');
  return root;
}

function manifestFor(root: string): FreezeManifest {
  const paths: Record<string, string> = {};
  for (const relPath of REQUIRED_CONTRACT_PATHS) {
    const hash = hashOf(root, relPath);
    if (hash !== undefined) paths[relPath] = hash;
  }
  return { frozenAt: '2026-10-20', adr: 'ADR-124', paths };
}

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('contract freeze gate (P-314)', () => {
  it('passes when the frozen files are unchanged', () => {
    const root = makeRoot();
    const diff = diffFreeze({ manifest: manifestFor(root), root, decisions: '' });
    expect(diff.changed).toEqual([]);
    expect(diff.unauthorized).toEqual([]);
    expect(formatReport(diff)).toContain('frozen contract intact');
  });

  it('fails when a frozen file changed', () => {
    const root = makeRoot();
    const manifest = manifestFor(root);
    writeFileSync(join(root, ...CONTRACT_PATH.split('/')), 'export const TOPICS = ["other"];\n');
    const diff = diffFreeze({ manifest, root, decisions: '' });
    expect(diff.changed).toContain(CONTRACT_PATH);
    expect(diff.unauthorized).toContain(CONTRACT_PATH);
    expect(formatReport(diff)).toContain('NOT authorized by an ADR');
  });

  it('allows a change authorized by an ADR', () => {
    const root = makeRoot();
    const manifest = manifestFor(root);
    writeFileSync(join(root, ...CONTRACT_PATH.split('/')), 'export const TOPICS = ["other"];\n');
    const decisions = `## ADR-999: Widen the topic list\n\n- contract-freeze: ${CONTRACT_PATH}\n`;
    const diff = diffFreeze({ manifest, root, decisions });
    expect(diff.changed).toContain(CONTRACT_PATH);
    expect(diff.unauthorized).toEqual([]);
    expect(formatReport(diff)).toContain('authorized by an ADR');
  });

  it('fails when a frozen file is missing', () => {
    const root = makeRoot();
    const manifest = manifestFor(root);
    rmSync(join(root, ...CONTRACT_PATH.split('/')));
    const diff = diffFreeze({ manifest, root, decisions: '' });
    expect(diff.missing).toContain(CONTRACT_PATH);
    expect(diff.unauthorized).toContain(CONTRACT_PATH);
  });

  it('fails when a required contract path is not frozen', () => {
    const root = makeRoot();
    const diff = diffFreeze({
      manifest: { frozenAt: '2026-10-20', adr: 'ADR-124', paths: {} },
      root,
      decisions: '',
    });
    expect(diff.unfrozen.length).toBeGreaterThan(0);
    expect(diff.unauthorized).toEqual(diff.unfrozen);
  });

  it('ignores a freeze marker outside an ADR section', () => {
    const authorized = authorizedPaths(
      `Some prose mentioning contract-freeze: ${CONTRACT_PATH}\n\n## ADR-1: Real ADR\n\n- contract-freeze: other/path.ts\n`
    );
    expect(authorized.has(CONTRACT_PATH)).toBe(false);
    expect(authorized.has('other/path.ts')).toBe(true);
  });

  it('reports a broken manifest as a gate error', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'contracts.freeze.json'), '{ not json');
    expect(readManifest(join(root, 'contracts.freeze.json'))).toBeUndefined();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = main(['--root', root]);
    expect(code).toBe(2);
  });

  it('exits non-zero on an unauthorized contract change', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'contracts.freeze.json'), JSON.stringify(manifestFor(root), null, 2));
    writeFileSync(join(root, ...CONTRACT_PATH.split('/')), 'export const TOPICS = ["other"];\n');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = main(['--root', root]);
    expect(code).toBe(1);
  });
});
