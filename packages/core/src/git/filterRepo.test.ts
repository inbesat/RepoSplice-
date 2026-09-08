import { describe, it, expect } from 'vitest';
import { checkFilterRepoStatus } from './filterRepo.js';

// Real `--version` output captured from git-filter-repo 2.47.0 (upstream
// reports its own revision hash, not semver — see filterRepo.ts).
const REAL_VERSION_OUTPUT = 'a40bce548d2c\n';

describe('filter-repo presence (P-066)', () => {
  it('present ok', async () => {
    const status = await checkFilterRepoStatus(async () => REAL_VERSION_OUTPUT);
    expect(status.isOk()).toBe(true);
    if (!status.isOk()) return;
    expect(status.value.available).toBe(true);
    expect(status.value.version).toBe('a40bce548d2c');
    expect(status.value.fix).toBeUndefined();
  });

  it('missing hints fix', async () => {
    const status = await checkFilterRepoStatus(async () => {
      throw new Error('spawn git-filter-repo ENOENT');
    });
    expect(status.isOk()).toBe(true);
    if (!status.isOk()) return;
    expect(status.value.available).toBe(false);
    expect(status.value.version).toBeNull();
    expect(status.value.fix).toContain('pip install git-filter-repo');
  });

  it('version check', async () => {
    // Empty output: binary runs but reports nothing usable.
    const empty = await checkFilterRepoStatus(async () => '\n');
    expect(empty.isOk()).toBe(true);
    if (!empty.isOk()) return;
    expect(empty.value.available).toBe(true);
    expect(empty.value.version).toBeNull();

    // Whatever upstream prints is carried through verbatim (opaque).
    const other = await checkFilterRepoStatus(async () => 'v2.47.0-3-gdeadbee\n');
    expect(other.isOk()).toBe(true);
    if (!other.isOk()) return;
    expect(other.value.version).toBe('v2.47.0-3-gdeadbee');
  });
});
