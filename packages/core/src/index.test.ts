import { describe, it, expect } from 'vitest';
import { CORE_NAME } from './index';

describe('@repo-stitcher/core', () => {
  it('exports CORE_NAME', () => {
    expect(CORE_NAME).toBe('@repo-stitcher/core');
  });
});
