// P-204 — perf flag parsing tests.
//
// The five required scenarios from the phase spec:
//
//   it('parses valid flags')   it('rejects out of range')   it('merges defaults')
//   it('enforces caps')        it('timeout zero unlimited')

import { describe, it, expect } from 'vitest';
import { DEFAULT_PERF, parsePerfFlags, checkCaps, type PerfConfig } from './flags.js';

describe('P-204 perf flags', () => {
  it('parses valid flags', () => {
    const parsed = parsePerfFlags({
      jobs: '4',
      memory: '1024',
      timeout: '60',
      maxFiles: '100',
      maxSize: '64',
      concurrency: 2,
    });
    expect(parsed.isOk()).toBe(true);
    if (parsed.isOk()) {
      // Commander hands strings; every value lands in the typed config.
      expect(parsed.value).toEqual({
        jobs: 4,
        memoryMb: 1024,
        timeoutSec: 60,
        maxFiles: 100,
        maxSizeMb: 64,
        concurrency: 2,
      });
    }
  });

  it('rejects out of range', () => {
    // Below the minimum…
    expect(parsePerfFlags({ jobs: '0' }).isErr()).toBe(true);
    expect(parsePerfFlags({ memory: '0' }).isErr()).toBe(true);
    expect(parsePerfFlags({ concurrency: '0' }).isErr()).toBe(true);
    expect(parsePerfFlags({ maxFiles: '0' }).isErr()).toBe(true);
    // …negative, not a number, and fractional, each naming the flag.
    for (const raw of [{ jobs: '-2' }, { memory: 'abc' }, { concurrency: '1.5' }]) {
      const parsed = parsePerfFlags(raw);
      expect(parsed.isErr()).toBe(true);
      if (parsed.isErr() && parsed.error.code === 'CONFIG_ERROR') {
        expect(parsed.error.field).toMatch(/^perf\./);
      }
    }
  });

  it('merges defaults', () => {
    // No flags at all → the pure defaults.
    const all = parsePerfFlags({});
    expect(all.isOk()).toBe(true);
    if (all.isOk()) expect(all.value).toEqual(DEFAULT_PERF);

    // One flag → the rest come from the defaults.
    const merged = parsePerfFlags({ jobs: '2' });
    expect(merged.isOk()).toBe(true);
    if (merged.isOk()) {
      expect(merged.value.jobs).toBe(2);
      expect(merged.value.memoryMb).toBe(DEFAULT_PERF.memoryMb);
      expect(merged.value.timeoutSec).toBe(DEFAULT_PERF.timeoutSec);
    }

    // Callers may layer their own defaults (a future `[perf]` config section),
    // which the raw flags then override.
    const layered = parsePerfFlags({}, { maxFiles: 10 });
    expect(layered.isOk()).toBe(true);
    if (layered.isOk()) {
      expect(layered.value.jobs).toBe(DEFAULT_PERF.jobs);
      expect(layered.value.maxFiles).toBe(10);
    }
    const overridden = parsePerfFlags({ maxFiles: '1' }, { maxFiles: 10 });
    expect(overridden.isOk()).toBe(true);
    if (overridden.isOk()) expect(overridden.value.maxFiles).toBe(1);
  });

  it('enforces caps', () => {
    const tight: PerfConfig = { ...DEFAULT_PERF, maxFiles: 2, maxSizeMb: 8 };
    // File count over the cap names the flag that clears it.
    const files = checkCaps(3, 0, tight);
    expect(files.isErr()).toBe(true);
    if (files.isErr() && files.error.code === 'CONFIG_ERROR') {
      expect(files.error.field).toBe('perf.max-files');
      expect(files.error.message).toContain('--max-files 2');
    }
    // Byte size over the cap names its flag.
    const bytes = checkCaps(1, 9 * 1024 * 1024, tight);
    expect(bytes.isErr()).toBe(true);
    if (bytes.isErr() && bytes.error.code === 'CONFIG_ERROR') {
      expect(bytes.error.field).toBe('perf.max-size');
      expect(bytes.error.message).toContain('--max-size 8');
    }
    // Within the caps → nothing to say.
    expect(checkCaps(2, 8 * 1024 * 1024, tight).isOk()).toBe(true);
  });

  it('timeout zero unlimited', () => {
    const parsed = parsePerfFlags({ timeout: '0' });
    expect(parsed.isOk()).toBe(true);
    if (parsed.isOk()) expect(parsed.value.timeoutSec).toBe(0);
    // 0 is the default too — unlimited until a flag says otherwise.
    expect(DEFAULT_PERF.timeoutSec).toBe(0);
  });
});
