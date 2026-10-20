// P-315 — the shared package's runtime surface. The types carry no
// runtime cost; the tuples and predicates are the parts a consumer (the
// future server lane, the web client) can actually use.

import { describe, expect, it } from 'vitest';
import {
  SOURCE_KINDS,
  SOURCE_STATUSES,
  isSourceKind,
  isSourceStatus,
  type SessionBundle,
  type SourceRecord,
} from './index.js';

describe('@repo-stitcher/shared (P-315)', () => {
  it('lists the source kinds', () => {
    expect(SOURCE_KINDS).toEqual(['github', 'local']);
  });

  it('lists the source statuses', () => {
    expect(SOURCE_STATUSES).toEqual(['ready', 'pending', 'error']);
  });

  it('narrows a source kind', () => {
    expect(isSourceKind('github')).toBeTruthy();
    expect(isSourceKind('local')).toBeTruthy();
    expect(isSourceKind('ftp')).toBeFalsy();
    expect(isSourceKind(undefined)).toBeFalsy();
  });

  it('narrows a source status', () => {
    expect(isSourceStatus('ready')).toBeTruthy();
    expect(isSourceStatus('error')).toBeTruthy();
    expect(isSourceStatus('done')).toBeFalsy();
    expect(isSourceStatus(7)).toBeFalsy();
  });

  it('keeps the source record shape', () => {
    const record: SourceRecord = {
      id: 'r1',
      kind: 'local',
      path: '/tmp/rA',
      status: 'ready',
    };
    expect(record.kind).toBe('local');
    expect(record.repo).toBeUndefined();
  });

  it('keeps the session bundle shape', () => {
    const bundle: SessionBundle = {
      version: 1,
      exportedAt: '2026-10-20T00:00:00.000Z',
      sources: { A: [], B: [] },
      selection: { A: [], B: [] },
      resolutions: {},
      licenseDecisions: {},
    };
    expect(bundle.version).toBe(1);
    expect(bundle.sources.A).toEqual([]);
  });
});
