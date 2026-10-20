#!/usr/bin/env bun
// P-314 — the contract freeze gate.
//
// The wire contract between the core (producer) and the web (consumer) is
// frozen after Wave 0: the shared event/WS types must not change silently.
// This gate compares the frozen files against `contracts.freeze.json` and
// fails the build when a frozen file changed, disappeared, or was dropped
// from the manifest without an ADR that authorizes it.
//
// Authorization: an ADR section in `project-plans/DECISIONS.md` carries a
// line `contract-freeze: <path>`. Only markers inside an `## ADR-` section
// count — a stray marker in prose does not unlock a contract.
//
// The gate NEVER throws: it reports and exits with a code
// (0 = intact, 1 = contract violation, 2 = gate error).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The contract files frozen after Wave 0 — the plan's
 * "`core/src/types` + WS schema" made concrete:
 * - events/topics.ts  — the topic list + the zod event envelope + payloads
 * - events/bus.ts     — the bus envelope + the WS forwarder
 * - events/progress.ts— the progress payload the web renders
 * - jobs/types.ts     — JobStatus transitions + JobEvent
 * - web/lib/ws.ts     — the web-side envelope mirror
 */
export const REQUIRED_CONTRACT_PATHS: readonly string[] = [
  'packages/core/src/events/topics.ts',
  'packages/core/src/events/bus.ts',
  'packages/core/src/events/progress.ts',
  'packages/core/src/jobs/types.ts',
  'packages/web/src/lib/ws.ts',
];

export interface FreezeManifest {
  readonly frozenAt: string;
  readonly adr: string;
  readonly paths: Readonly<Record<string, string>>;
}

export interface FreezeDiff {
  /** Frozen files whose content hash moved. */
  readonly changed: readonly string[];
  /** Frozen files that no longer exist. */
  readonly missing: readonly string[];
  /** Required contract paths that are not in the manifest at all. */
  readonly unfrozen: readonly string[];
  /** The offenders above that no ADR authorized. */
  readonly unauthorized: readonly string[];
}

/** sha256 of a repo-relative file, or undefined when the file is gone. */
export function hashOf(root: string, relPath: string): string | undefined {
  const file = join(root, ...relPath.split('/'));
  if (!existsSync(file)) return undefined;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Read the manifest defensively — a broken file is a gate error, not a pass. */
export function readManifest(file: string): FreezeManifest | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<FreezeManifest>;
    const paths: Record<string, string> = {};
    const raw = parsed.paths;
    if (raw !== null && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') paths[key] = value;
      }
    }
    return {
      frozenAt: typeof parsed.frozenAt === 'string' ? parsed.frozenAt : '',
      adr: typeof parsed.adr === 'string' ? parsed.adr : '',
      paths,
    };
  } catch {
    return undefined;
  }
}

/** Paths authorized by an ADR marker inside an `## ADR-` section. */
export function authorizedPaths(decisions: string): ReadonlySet<string> {
  const authorized = new Set<string>();
  let inAdr = false;
  for (const line of decisions.split(/\r?\n/)) {
    if (/^##\s+ADR-\d+/.test(line)) {
      inAdr = true;
      continue;
    }
    if (/^##\s/.test(line)) {
      inAdr = false;
      continue;
    }
    if (!inAdr) continue;
    const found = /contract-freeze:\s*`?([^`\s]+)`?/.exec(line)?.[1];
    if (found !== undefined) authorized.add(found);
  }
  return authorized;
}

/** Compare the manifest against the working tree, minus ADR authorizations. */
export function diffFreeze(options: {
  readonly manifest: FreezeManifest;
  readonly root: string;
  readonly decisions: string;
}): FreezeDiff {
  const { manifest, root, decisions } = options;
  const authorized = authorizedPaths(decisions);
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [relPath, expected] of Object.entries(manifest.paths)) {
    const actual = hashOf(root, relPath);
    if (actual === undefined) missing.push(relPath);
    else if (actual !== expected) changed.push(relPath);
  }
  const unfrozen = REQUIRED_CONTRACT_PATHS.filter(relPath => !(relPath in manifest.paths));
  const unauthorized = [...changed, ...missing, ...unfrozen].filter(
    relPath => !authorized.has(relPath)
  );
  return { changed, missing, unfrozen, unauthorized };
}

/** Human-readable report for the CI log. */
export function formatReport(diff: FreezeDiff): string {
  const lines = ['contract freeze:'];
  if (diff.changed.length === 0 && diff.missing.length === 0 && diff.unfrozen.length === 0) {
    lines.push('  frozen contract intact');
    return lines.join('\n');
  }
  if (diff.changed.length > 0) lines.push(`  changed: ${diff.changed.join(', ')}`);
  if (diff.missing.length > 0) lines.push(`  missing: ${diff.missing.join(', ')}`);
  if (diff.unfrozen.length > 0) lines.push(`  not frozen: ${diff.unfrozen.join(', ')}`);
  if (diff.unauthorized.length > 0) {
    lines.push(
      '  NOT authorized by an ADR - add `contract-freeze: <path>` to an ADR in project-plans/DECISIONS.md'
    );
    lines.push(`  unauthorized: ${diff.unauthorized.join(', ')}`);
  } else {
    lines.push('  authorized by an ADR - refresh the manifest with --update');
  }
  return lines.join('\n');
}

/**
 * The CLI entry. Returns 0 (intact), 1 (contract violation) or 2 (gate error).
 */
export function main(argv: readonly string[]): number {
  let manifestPath = 'contracts.freeze.json';
  let root = process.cwd();
  let decisionsPath = 'project-plans/DECISIONS.md';
  let update = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--update') {
      update = true;
    } else if (arg === '--manifest') {
      manifestPath = argv[index + 1] ?? manifestPath;
      index += 1;
    } else if (arg === '--root') {
      root = argv[index + 1] ?? root;
      index += 1;
    } else if (arg === '--decisions') {
      decisionsPath = argv[index + 1] ?? decisionsPath;
      index += 1;
    }
  }
  try {
    const manifestFile = join(root, ...manifestPath.split('/'));
    const existing = readManifest(manifestFile);
    if (update) {
      const paths: Record<string, string> = {};
      const wanted = [...REQUIRED_CONTRACT_PATHS, ...Object.keys(existing?.paths ?? {})];
      for (const relPath of [...new Set(wanted)]) {
        const hash = hashOf(root, relPath);
        if (hash !== undefined) paths[relPath] = hash;
      }
      const next = {
        frozenAt: new Date().toISOString().slice(0, 10),
        adr: existing?.adr ?? 'ADR-124',
        paths,
      };
      writeFileSync(manifestFile, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`contract freeze: manifest updated (${Object.keys(paths).length} paths)`);
      return 0;
    }
    if (existing === undefined) {
      console.error(
        'contract freeze: manifest missing or unreadable - run with --update to create it'
      );
      return 2;
    }
    const decisionsFile = join(root, ...decisionsPath.split('/'));
    const decisions = existsSync(decisionsFile) ? readFileSync(decisionsFile, 'utf8') : '';
    const diff = diffFreeze({ manifest: existing, root, decisions });
    console.log(formatReport(diff));
    return diff.unauthorized.length > 0 ? 1 : 0;
  } catch (cause) {
    console.error(
      `contract freeze: gate error - ${cause instanceof Error ? cause.message : String(cause)}`
    );
    return 2;
  }
}

// Direct invocation only (the vitest import must not run the CLI).
if ((process.argv[1] ?? '').includes('contract-freeze')) {
  process.exit(main(process.argv.slice(2)));
}
