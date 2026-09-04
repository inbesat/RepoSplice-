import { describe, it, expect } from 'vitest';
import { WEB_NAME } from './index';

describe('@repo-stitcher/web', () => {
  it('exports WEB_NAME', () => {
    expect(WEB_NAME).toBe('@repo-stitcher/web');
  });
});
