import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateFixtures,
  cleanFixtures,
  type FixtureSpec,
} from '../../../../scripts/generate-fixtures.js';

const MIT_LICENSE = `MIT License

Copyright (c) 2020 stitch-fixtures

Permission is hereby granted, free of charge, to any person obtaining a copy.
`;

const APACHE_LICENSE = `Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
SPDX-License-Identifier: Apache-2.0
`;

// 1x1 transparent PNG (68 bytes) — fixed binary payload (P-082 shape).
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const ECS: FixtureSpec = {
  name: 'ecs',
  commits: [
    {
      message: 'npm scaffold',
      tag: 'v0.1.0',
      files: [
        {
          path: 'package.json',
          content: { text: '{\n  "name": "fixture-ecs",\n  "version": "0.1.0"\n}\n' },
        },
        { path: 'index.js', content: { text: "'use strict';\n\nmodule.exports = 42;\n" } },
        { path: 'assets/logo.bin', content: { base64: PIXEL_PNG_BASE64 } },
      ],
    },
    {
      message: 'python side',
      files: [
        { path: 'requirements.txt', content: { text: 'requests==2.31.0\n' } },
        { path: 'a/.gitignore', content: { text: 'dist/\n' } },
        { path: 'a/b/.gitignore', content: { text: '*.log\n' } },
      ],
    },
  ],
};

const LICENSES: FixtureSpec = {
  name: 'licenses',
  commits: [
    { message: 'mit', files: [{ path: 'LICENSE', content: { text: MIT_LICENSE } }] },
    {
      message: 'switch to apache',
      files: [{ path: 'LICENSE', content: { text: APACHE_LICENSE } }],
    },
  ],
};

// Empty-repo shape: initialized, one allow-empty commit, no files.
const EMPTY: FixtureSpec = {
  name: 'empty',
  commits: [{ message: 'root', files: [], allowEmpty: true }],
};

const tracked: string[] = [];
afterEach(async () => {
  while (tracked.length > 0) {
    const dir = tracked.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stitch-fix-'));
  tracked.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      else resolvePromise(stdout.trim());
    });
  });
}

function first(dirs: string[]): string | undefined {
  return dirs[0];
}

describe('fixture repos (P-064 generate-fixtures)', () => {
  it('gen ecs', async () => {
    const root = await freshRoot();
    const generated = await generateFixtures([ECS], { root });
    expect(generated.isOk()).toBe(true);
    if (!generated.isOk()) return;
    expect(generated.value).toHaveLength(1);
    const dir = first(generated.value);
    if (dir === undefined) return;

    // Fixed file bytes land exactly (text + binary + nested ignores).
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(
      '{\n  "name": "fixture-ecs",\n  "version": "0.1.0"\n}\n'
    );
    expect(await readFile(join(dir, 'assets', 'logo.bin'))).toEqual(
      Buffer.from(PIXEL_PNG_BASE64, 'base64')
    );
    expect(await readFile(join(dir, 'a', 'b', '.gitignore'), 'utf8')).toBe('*.log\n');

    // Two commits in order, tag on the first, clean worktree.
    expect(await git(dir, 'log', '--format=%s')).toBe('python side\nnpm scaffold');
    expect(await git(dir, 'tag', '--list')).toBe('v0.1.0');
    expect(await git(dir, 'status', '--porcelain')).toBe('');
  });

  it('gen license', async () => {
    const root = await freshRoot();
    const generated = await generateFixtures([LICENSES], { root });
    expect(generated.isOk()).toBe(true);
    if (!generated.isOk()) return;
    const dir = first(generated.value);
    if (dir === undefined) return;

    // Worktree shows the latest license; history keeps the earlier one
    // (the git() helper trims shell output, hence trimEnd on the fixture).
    expect(await readFile(join(dir, 'LICENSE'), 'utf8')).toBe(APACHE_LICENSE);
    expect(await git(dir, 'show', 'HEAD~1:LICENSE')).toBe(MIT_LICENSE.trimEnd());
  });

  // Three full generations plus a dozen git spawns: needs headroom under
  // full-suite parallel load (P-053 precedent for explicit slow budgets).
  it('deterministic', { timeout: 20000 }, async () => {
    const firstRoot = await freshRoot();
    const secondRoot = await freshRoot();
    const firstRun = await generateFixtures([ECS], { root: firstRoot });
    const secondRun = await generateFixtures([ECS], { root: secondRoot });
    expect(firstRun.isOk()).toBe(true);
    expect(secondRun.isOk()).toBe(true);
    if (!firstRun.isOk() || !secondRun.isOk()) return;
    const firstDir = first(firstRun.value);
    const secondDir = first(secondRun.value);
    if (firstDir === undefined || secondDir === undefined) return;

    // Same spec twice: identical objects, trees, tags, and file bytes.
    expect(await git(secondDir, 'rev-parse', 'HEAD')).toBe(
      await git(firstDir, 'rev-parse', 'HEAD')
    );
    expect(await git(secondDir, 'ls-tree', '-r', 'HEAD')).toBe(
      await git(firstDir, 'ls-tree', '-r', 'HEAD')
    );
    expect(await git(secondDir, 'tag', '--list')).toBe(await git(firstDir, 'tag', '--list'));
    expect(await readFile(join(secondDir, 'package.json'), 'utf8')).toBe(
      await readFile(join(firstDir, 'package.json'), 'utf8')
    );
    expect(await readFile(join(secondDir, 'assets', 'logo.bin'))).toEqual(
      await readFile(join(firstDir, 'assets', 'logo.bin'))
    );

    // Empty-repo shape generates too: initialized with one empty commit.
    const emptyRoot = await freshRoot();
    const emptyRun = await generateFixtures([EMPTY], { root: emptyRoot });
    expect(emptyRun.isOk()).toBe(true);
    if (!emptyRun.isOk()) return;
    const emptyDir = first(emptyRun.value);
    if (emptyDir === undefined) return;
    expect(await git(emptyDir, 'rev-parse', '--is-inside-work-tree')).toBe('true');
    expect(await git(emptyDir, 'log', '--format=%s')).toBe('root');
  });

  it('clean', async () => {
    const root = await freshRoot();
    const generated = await generateFixtures([ECS], { root });
    expect(generated.isOk()).toBe(true);
    if (!generated.isOk()) return;
    const dir = first(generated.value);
    if (dir === undefined) return;
    expect(existsSync(dir)).toBe(true);

    // Regenerating over an existing root is refused (never silently mixed).
    const again = await generateFixtures([ECS], { root });
    expect(again.isErr()).toBe(true);

    // --clean removes the whole cache root; afterwards the dir is gone.
    const cleaned = await cleanFixtures(root);
    expect(cleaned.isOk()).toBe(true);
    expect(existsSync(dir)).toBe(false);

    // Cleaning outside the temp dir is refused AND deletes nothing (no throw).
    const cwd = process.cwd();
    const unsafe = await cleanFixtures(cwd);
    expect(unsafe.isErr()).toBe(true);
    if (!unsafe.isErr()) return;
    expect(unsafe.error.code).toBe('UNSAFE_CLEAN');
    expect(existsSync(cwd)).toBe(true);
  });
});
