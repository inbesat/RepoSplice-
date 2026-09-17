// P-103 tests: ecosystem detection via marker files in real temp dirs
// (fs stays real per P-074 precedent). Covers the six spec-required cases
// (node, python, rust, go, multi, ignores) plus edge cases: blank path,
// missing root, empty repo, lockfile-without-manifest, and caller ignores.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyManifest, detectEcosystems, DEFAULT_ECOSYSTEM_IGNORE } from './ecosystem.js';

const createdDirs: string[] = [];

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop() as string;
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stitch-eco-'));
  createdDirs.push(dir);
  return dir;
}

async function writeMarker(repo: string, rel: string, content = '{}'): Promise<void> {
  const abs = join(repo, rel);
  const slash = rel.lastIndexOf('/');
  if (slash !== -1) {
    await mkdir(join(repo, rel.slice(0, slash)), { recursive: true });
  }
  await writeFile(abs, content, 'utf8');
}

describe('P-103 ecosystem: classifyManifest', () => {
  it('routes known markers to the owning parser', () => {
    expect(classifyManifest('package.json')).toEqual({ ecosystem: 'node', parser: 'npm' });
    expect(classifyManifest('pyproject.toml')).toEqual({
      ecosystem: 'python',
      parser: 'python',
    });
    expect(classifyManifest('Cargo.toml')).toEqual({ ecosystem: 'rust', parser: 'cargo' });
    expect(classifyManifest('go.mod')).toEqual({ ecosystem: 'go', parser: 'gomod' });
  });

  it('treats requirements variants as python', () => {
    expect(classifyManifest('requirements.txt')).toEqual({
      ecosystem: 'python',
      parser: 'python',
    });
    expect(classifyManifest('requirements-dev.txt')).toEqual({
      ecosystem: 'python',
      parser: 'python',
    });
  });

  it('rejects lockfiles-without-manifest and unknown names', () => {
    expect(classifyManifest('go.sum')).toBeUndefined();
    expect(classifyManifest('Cargo.lock')).toBeUndefined();
    expect(classifyManifest('package-lock.json')).toBeUndefined();
    expect(classifyManifest('README.md')).toBeUndefined();
  });
});

describe('P-103 ecosystem: detectEcosystems', () => {
  it('node', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'package.json', '{"name":"a","version":"1.0.0"}');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(1);
      const first = r.value[0] as { ecosystem: string; parser: string; manifestPath: string };
      expect(first.ecosystem).toBe('node');
      expect(first.parser).toBe('npm');
      expect(first.manifestPath.endsWith('/package.json')).toBe(true);
    }
  });

  it('python', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'requirements.txt', 'requests>=2.28.1\n');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(1);
      const first = r.value[0] as { ecosystem: string; parser: string };
      expect(first.ecosystem).toBe('python');
      expect(first.parser).toBe('python');
    }
  });

  it('rust', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'Cargo.toml', '[package]\nname = "a"\n');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(1);
      const first = r.value[0] as { ecosystem: string; parser: string };
      expect(first.ecosystem).toBe('rust');
      expect(first.parser).toBe('cargo');
    }
  });

  it('go', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'go.mod', 'module example.com/a\n\ngo 1.22\n');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(1);
      const first = r.value[0] as { ecosystem: string; parser: string };
      expect(first.ecosystem).toBe('go');
      expect(first.parser).toBe('gomod');
    }
  });

  it('multi', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'frontend/package.json', '{}');
    await writeMarker(repo, 'api/pyproject.toml', '[project]\nname = "api"\n');
    await writeMarker(repo, 'core/Cargo.toml', '[package]\nname = "core"\n');
    await writeMarker(repo, 'tool/go.mod', 'module example.com/tool\n');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(4);
      const ecosystems = r.value.map(d => d.ecosystem).sort();
      expect(ecosystems).toEqual(['go', 'node', 'python', 'rust']);
      // Deterministic ordering: manifest paths sorted by code unit (P-282).
      const paths = r.value.map(d => d.manifestPath);
      expect([...paths].sort()).toEqual(paths);
    }
  });

  it('ignores', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'package.json', '{}');
    await writeMarker(repo, 'node_modules/foo/package.json', '{}');
    await writeMarker(repo, '.git/objects/package.json', '{}');
    await writeMarker(repo, 'ignored/package.json', '{}');
    await writeFile(join(repo, '.gitignore'), 'ignored/\n', 'utf8');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      // Only the root marker survives: vendored (.git, node_modules) and
      // gitignored (ignored/) markers are dropped.
      expect(r.value).toHaveLength(1);
      const first = r.value[0] as { manifestPath: string };
      expect(first.manifestPath.endsWith('/package.json')).toBe(true);
      expect(first.manifestPath.includes('node_modules')).toBe(false);
      expect(first.manifestPath.includes('ignored')).toBe(false);
    }
  });

  it('honours caller-provided ignore patterns', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'keep/package.json', '{}');
    await writeMarker(repo, 'skip/package.json', '{}');
    const r = await detectEcosystems(repo, { ignore: ['**/skip/**'] });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toHaveLength(1);
      const first = r.value[0] as { manifestPath: string };
      expect(first.manifestPath.includes('/keep/')).toBe(true);
    }
  });

  it('returns ok([]) for empty repos and unknown files', async () => {
    const repo = await makeRepo();
    await writeFile(join(repo, 'README.md'), '# hi\n', 'utf8');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toEqual([]);
  });

  it('does not count lockfiles without their manifest', async () => {
    const repo = await makeRepo();
    await writeMarker(repo, 'go.sum', 'example.com/a v1.0.0 h1:abc=\n');
    await writeMarker(repo, 'Cargo.lock', '[[package]]\nname = "a"\n');
    const r = await detectEcosystems(repo);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toEqual([]);
  });

  it('rejects a blank repoPath with CONFIG_ERROR', async () => {
    const r = await detectEcosystems('   ');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') expect(r.error.field).toBe('repoPath');
    }
  });

  it('rejects a missing root with CONFIG_ERROR', async () => {
    const r = await detectEcosystems(join(tmpdir(), 'stitch-eco-does-not-exist-xyz'));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') expect(r.error.field).toBe('repoPath');
    }
  });

  it('exposes the default subtree ignores', () => {
    expect([...DEFAULT_ECOSYSTEM_IGNORE]).toEqual(['**/.git/**', '**/node_modules/**']);
  });
});
