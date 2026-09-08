import { describe, it, expect } from 'vitest';
import {
  MIN_GIT_VERSION,
  parseGitVersion,
  isGitVersionSupported,
  checkGitVersionOutput,
  localGitVersion,
} from './version.js';

describe('git version gate (P-065)', () => {
  it('flags old git', () => {
    expect(MIN_GIT_VERSION).toBe('2.40.0');

    const old = isGitVersionSupported('2.39.9');
    expect(old.isOk()).toBe(true);
    if (!old.isOk()) return;
    expect(old.value).toBe(false);

    const ancient = isGitVersionSupported('2.9.0');
    expect(ancient.isOk()).toBe(true);
    if (!ancient.isOk()) return;
    expect(ancient.value).toBe(false);
  });

  it('passes supported git', () => {
    const floor = isGitVersionSupported('2.40.0');
    expect(floor.isOk()).toBe(true);
    if (!floor.isOk()) return;
    expect(floor.value).toBe(true);

    const newer = isGitVersionSupported('2.45.1');
    expect(newer.isOk()).toBe(true);
    if (!newer.isOk()) return;
    expect(newer.value).toBe(true);
  });

  it('parses git --version output', () => {
    expect(parseGitVersion('git version 2.45.1.windows.1')).toBe('2.45.1');
    expect(parseGitVersion('git version 2.40.0')).toBe('2.40.0');
    expect(parseGitVersion('git version 2.39.9\n')).toBe('2.39.9');
    expect(parseGitVersion('not git at all')).toBeNull();
    expect(parseGitVersion('')).toBeNull();
  });

  it('errs on garbage versions instead of throwing', () => {
    const garbage = isGitVersionSupported('garbage');
    expect(garbage.isErr()).toBe(true);
    if (!garbage.isErr()) return;
    expect(garbage.error.code).toBe('CONFIG_ERROR');
  });

  it('reads local git through an injected runner', async () => {
    expect(await localGitVersion(async () => 'git version 2.45.1.windows.1')).toBe('2.45.1');
    expect(
      await localGitVersion(async () => {
        throw new Error('git not found');
      })
    ).toBeNull();
    expect(await localGitVersion(async () => 'weird output')).toBeNull();
  });

  it('checks full version output end to end', () => {
    const supported = checkGitVersionOutput('git version 2.45.1.windows.1');
    expect(supported.isOk() && supported.value).toBe(true);

    const old = checkGitVersionOutput('git version 2.39.0');
    expect(old.isOk() && old.value).toBe(false);

    const unparseable = checkGitVersionOutput('nope');
    expect(unparseable.isErr()).toBe(true);
  });
});
