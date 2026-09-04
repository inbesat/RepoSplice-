import { describe, it, expect } from 'vitest';
import { CLI_NAME, CORE_NAME } from './index';

describe('@repo-stitcher/cli', () => {
  it('exports CLI_NAME', () => {
    expect(CLI_NAME).toBe('@repo-stitcher/cli');
  });

  it('re-exports CORE_NAME from @repo-stitcher/core', () => {
    expect(CORE_NAME).toBe('@repo-stitcher/core');
  });
});
