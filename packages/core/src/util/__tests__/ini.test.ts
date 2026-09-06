// P-033 tests: parseIni parses fixtures (.npmrc flat, git-config,
// dotted nesting), round-trips preserve shape, graceful degradation
// on unbalanced input, and typed err on non-string input.
import { describe, it, expect } from 'vitest';
import { parseIni, stringifyIni } from '../ini.js';

const NPMRC = 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=abc123\n';

const GIT_CONFIG = '[core]\n\trepositoryformatversion = 0\n[branch "main"]\n\tremote = origin\n';

describe('P-033 parseIni: parses ini (spec smoke test)', () => {
  it('parses an .npmrc fixture into flat keys', () => {
    const r = parseIni<Record<string, string>>(NPMRC);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value['registry']).toBe('https://registry.npmjs.org/');
      expect(r.value['//registry.npmjs.org/:_authToken']).toBe('abc123');
    }
  });

  it('parses sections; dotted sections nest', () => {
    const r = parseIni<{ a: { b: { c: { d: string } } } }>('[a.b.c]\nd=e\n');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.a.b.c.d).toBe('e');
    }
  });

  it('auto-converts true/false/null, keeps numbers as strings', () => {
    const r = parseIni<{ a: boolean; b: string }>('a=true\nb=42\n');
    if (r.isErr()) throw r.error;
    expect(r.value).toEqual({ a: true, b: '42' });
  });

  it('strips full-line comments', () => {
    const r = parseIni<Record<string, string>>('; comment\n# another\nk = v\n');
    if (r.isErr()) throw r.error;
    expect(r.value).toEqual({ k: 'v' });
  });

  it('empty input parses to an empty object', () => {
    const r = parseIni('');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual({});
    }
  });
});

describe('P-033 parseIni: nested sections (spec smoke test)', () => {
  it('parses a git-config fixture; quoted subsection stays verbatim', () => {
    const r = parseIni<{ core: { repositoryformatversion: string }; [k: string]: unknown }>(
      GIT_CONFIG
    );
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.core.repositoryformatversion).toBe('0');
      // `ini` does NOT split git `[branch "main"]` subsections — the
      // quoted key is preserved flat for P-112/113 to post-process.
      expect(r.value['branch "main"']).toEqual({ remote: 'origin' });
    }
  });
});

describe('P-033 parseIni: graceful degradation + typed err', () => {
  it('unbalanced section degrades to a key (ini is total over strings)', () => {
    const r = parseIni<Record<string, unknown>>('[oops\nk=v\n');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value['k']).toBe('v');
    }
  });

  it('non-string input maps to err(INTERNAL)', () => {
    const r = parseIni(42 as unknown as string);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
    }
  });
});

describe('P-033 stringifyIni: round trip', () => {
  it('parse -> stringify -> parse preserves shape', () => {
    const first = parseIni<Record<string, unknown>>(NPMRC);
    if (first.isErr()) throw first.error;
    const text = stringifyIni(first.value);
    if (text.isErr()) throw text.error;
    const second = parseIni<Record<string, unknown>>(text.value);
    if (second.isErr()) throw second.error;
    expect(second.value).toEqual(first.value);
  });

  it('serializes nested objects to dotted sections', () => {
    const r = stringifyIni({ a: { b: 'c' } });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toContain('[a]');
      expect(r.value).toContain('b=c');
    }
  });

  it('null top-level maps to err(INTERNAL)', () => {
    const r = stringifyIni(null as unknown as Record<string, unknown>);
    expect(r.isErr()).toBe(true);
  });
});
