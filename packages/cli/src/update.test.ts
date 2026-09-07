import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  shouldCheckForUpdates,
  createNotifier,
  toNotice,
  maybeNotify,
  NO_UPDATE_FLAG,
  NO_UPDATE_ENV,
  UPDATE_CHECK_INTERVAL_MS,
  type NotifierPackage,
} from './update.js';

/** Deliberately unresolvable: keeps every test offline and hermetic. */
const FAKE_PKG: NotifierPackage = { name: 'stitch-test-nonexistent-pkg', version: '0.0.0' };

describe('update notifier (P-046)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('notifier gated', () => {
    // Every opt-out returns null without reaching the registry: flag,
    // env var, and CI. The enabled path with an unresolvable package also
    // stays silent offline (nothing cached, background child fails quietly).
    expect(maybeNotify(FAKE_PKG, [NO_UPDATE_FLAG], {})).toBeNull();
    expect(maybeNotify(FAKE_PKG, [], { [NO_UPDATE_ENV]: '1' })).toBeNull();
    expect(maybeNotify(FAKE_PKG, [], { CI: 'true' })).toBeNull();
    expect(maybeNotify(FAKE_PKG, [], {})).toBeNull();
  });

  it('gate truth table', () => {
    expect(shouldCheckForUpdates([], {})).toBe(true);
    expect(shouldCheckForUpdates(['status'], {})).toBe(true);
    expect(shouldCheckForUpdates(['status', NO_UPDATE_FLAG], {})).toBe(false);
    expect(shouldCheckForUpdates([], { [NO_UPDATE_ENV]: '1' })).toBe(false);
    // Presence opts out; the value itself is irrelevant.
    expect(shouldCheckForUpdates([], { [NO_UPDATE_ENV]: '' })).toBe(false);
    expect(shouldCheckForUpdates([], { CI: 'true' })).toBe(false);
    expect(shouldCheckForUpdates([], { CI: '' })).toBe(false);
    expect(shouldCheckForUpdates([NO_UPDATE_FLAG], { CI: 'true', [NO_UPDATE_ENV]: '1' })).toBe(
      false
    );
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(86_400_000);
  });

  it('constructs with a fake package.json and exposes notify', () => {
    // Spec step 4 smoke: pinned fake identity, no network asserted.
    const notifier = createNotifier(FAKE_PKG);
    expect(typeof notifier.notify).toBe('function');
    expect(notifier.update).toBeUndefined();
    expect(() => notifier.notify()).not.toThrow();
  });

  it('maps cached updates to notices', () => {
    expect(toNotice(undefined)).toBeNull();
    expect(toNotice({ current: '0.0.0', latest: '9.9.9' })).toEqual({
      current: '0.0.0',
      latest: '9.9.9',
    });
  });
});
