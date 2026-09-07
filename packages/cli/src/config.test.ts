import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openStore,
  redactValue,
  defaultStoreDir,
  type JsonValue,
  type StitchStore,
} from './config.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'stitch-config-'));
}

function mustOpen(dir: string): StitchStore {
  const r = openStore(dir);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error('openStore failed in test setup');
  return r.value;
}

describe('configstore (P-045)', () => {
  it('config roundtrip', () => {
    const dir = freshDir();
    try {
      const s = mustOpen(dir);
      expect(s.path).toBe(join(dir, 'config.json'));

      const missing = s.get('service.port');
      expect(missing.isOk()).toBe(true);
      if (missing.isOk()) expect(missing.value).toBeUndefined();

      expect(s.set('service.host', '127.0.0.1').isOk()).toBe(true);
      expect(s.set('service.port', 3434).isOk()).toBe(true);
      const port = s.get('service.port');
      expect(port.isOk()).toBe(true);
      if (port.isOk()) expect(port.value).toBe(3434);

      expect(s.delete('service.port').isOk()).toBe(true);
      const gone = s.get('service.port');
      expect(gone.isOk()).toBe(true);
      if (gone.isOk()) expect(gone.value).toBeUndefined();
      // Deleting a missing key is a no-op, not an error.
      expect(s.delete('service.port').isOk()).toBe(true);
      const host = s.get('service.host');
      expect(host.isOk()).toBe(true);
      if (host.isOk()) expect(host.value).toBe('127.0.0.1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists across instances', () => {
    const dir = freshDir();
    try {
      const first = mustOpen(dir);
      expect(first.set('prefs.theme', 'dark').isOk()).toBe(true);

      const second = mustOpen(dir);
      const back = second.get('prefs.theme');
      expect(back.isOk()).toBe(true);
      if (back.isOk()) expect(back.value).toBe('dark');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redacts secrets in snapshots but keeps stored values', () => {
    const dir = freshDir();
    try {
      const s = mustOpen(dir);
      expect(s.set('openrouter.apiKey', 'sk-or-SECRET').isOk()).toBe(true);
      expect(s.set('github.token', 'ghp_SECRET').isOk()).toBe(true);
      expect(s.set('server.port', 3434).isOk()).toBe(true);
      expect(s.set('nested', { password: 'hunter2', user: 'ada' } as JsonValue).isOk()).toBe(true);

      const snap = s.snapshotRedacted();
      expect(snap.isOk()).toBe(true);
      if (snap.isErr()) return;
      expect(snap.value['openrouter']).toEqual({ apiKey: '[REDACTED]' });
      expect(snap.value['github']).toEqual({ token: '[REDACTED]' });
      expect(snap.value['server']).toEqual({ port: 3434 });
      expect(snap.value['nested']).toEqual({ password: '[REDACTED]', user: 'ada' });
      const dumped = JSON.stringify(snap.value);
      expect(dumped).not.toContain('sk-or-SECRET');
      expect(dumped).not.toContain('hunter2');

      // Originals are intact behind the redaction.
      const raw = s.get('openrouter.apiKey');
      expect(raw.isOk()).toBe(true);
      if (raw.isOk()) expect(raw.value).toBe('sk-or-SECRET');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects non-storable values loudly', () => {
    const dir = freshDir();
    try {
      const s = mustOpen(dir);
      const big = s.set('k', 10n as unknown as JsonValue);
      expect(big.isErr()).toBe(true);
      if (big.isErr()) expect(big.error.code).toBe('CONFIG_ERROR');

      const undef = s.set('u', undefined as unknown as JsonValue);
      expect(undef.isErr()).toBe(true);

      const cyclic: Record<string, unknown> = {};
      cyclic['self'] = cyclic;
      const cyc = s.set('c', cyclic as unknown as JsonValue);
      expect(cyc.isErr()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads corrupt files as empty and heals on write', () => {
    // configstore parses lazily and treats an unparseable file as empty
    // (probed P-045) — lock that contract in, including the heal.
    const dir = freshDir();
    try {
      const s = mustOpen(dir);
      expect(s.set('a', 1).isOk()).toBe(true);
      writeFileSync(join(dir, 'config.json'), '{oops');

      const reopened = mustOpen(dir);
      const snap = reopened.snapshotRedacted();
      expect(snap.isOk()).toBe(true);
      if (snap.isOk()) expect(snap.value).toEqual({});
      expect(reopened.set('b', 2).isOk()).toBe(true);
      const back = reopened.get('b');
      expect(back.isOk()).toBe(true);
      if (back.isOk()) expect(back.value).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors when the config path is occupied by a directory', () => {
    // Probed P-045: every operation throws EISDIR on a directory-occupied
    // path (no read cache masks it), and even reopening fails. One fixture
    // covers all four catch branches plus the openStore catch.
    const dir = freshDir();
    try {
      const s = mustOpen(dir);
      expect(s.set('a', 1).isOk()).toBe(true);
      rmSync(join(dir, 'config.json'));
      mkdirSync(join(dir, 'config.json'));
      const results = [s.set('b', 2), s.delete('a'), s.get('a'), s.snapshotRedacted()];
      for (const r of results) {
        expect(r.isErr()).toBe(true);
        if (r.isErr()) expect(r.error.code).toBe('CONFIG_ERROR');
      }
      expect(openStore(dir).isErr()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redactValue handles arrays, nesting, and non-secrets', () => {
    expect(redactValue('plain')).toBe('plain');
    expect(redactValue(7)).toBe(7);
    expect(redactValue(null)).toBeNull();
    expect(redactValue([{ token: 't' }, 'x'])).toEqual([{ token: '[REDACTED]' }, 'x']);
    expect(redactValue({ deep: { credentials: { user: 'u' } } })).toEqual({
      deep: { credentials: '[REDACTED]' },
    });
    expect(defaultStoreDir().endsWith('.stitch')).toBe(true);
  });
});
