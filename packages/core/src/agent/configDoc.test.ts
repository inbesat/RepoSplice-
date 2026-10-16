// P-152 — unit tests for config-document parsing, serialization and safe key
// access.
//
// The two properties worth defending are asserted directly rather than
// indirectly: comment stripping is checked to be string-aware (a `//` inside a
// JSON string is data), and every key-path walker is checked to reject
// prototype-polluting segments and to never read an inherited
// `Object.prototype` member back as config data.

import { describe, it, expect } from 'vitest';
import {
  assertSafeKeyPath,
  deepMerge,
  detectConfigFormat,
  getAtPath,
  parseConfig,
  parseKeyPath,
  removeAtPath,
  serializeConfig,
  setAtPath,
  stripJsonComments,
  type KeySegment,
} from './configDoc.js';
import { stitchErrorMessage } from '../result/index.js';

describe('detectConfigFormat', () => {
  it('detects each supported extension, case-insensitively', () => {
    expect(detectConfigFormat('config.json')).toBe('json');
    expect(detectConfigFormat('/a/b/config.jsonc')).toBe('jsonc');
    expect(detectConfigFormat('deep/nested/CONFIG.JSON')).toBe('json');
    expect(detectConfigFormat('config.toml')).toBe('toml');
    expect(detectConfigFormat('config.yaml')).toBe('yaml');
    expect(detectConfigFormat('config.yml')).toBe('yaml');
    expect(detectConfigFormat('config.ini')).toBe('ini');
  });

  it('treats every env-file spelling as env', () => {
    expect(detectConfigFormat('.env')).toBe('env');
    expect(detectConfigFormat('app.env')).toBe('env');
    expect(detectConfigFormat('.env.production')).toBe('env');
    expect(detectConfigFormat('dir/.env.local')).toBe('env');
  });

  it('returns undefined for an unknown extension', () => {
    expect(detectConfigFormat('README.md')).toBeUndefined();
    expect(detectConfigFormat('notes.env.txt')).toBeUndefined();
  });
});

describe('stripJsonComments', () => {
  it('removes a line comment while preserving the newline', () => {
    const out = stripJsonComments('{"a": 1 // trailing\n}');
    expect(out).not.toContain('trailing');
    expect(out).toContain('\n');
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it('removes a block comment and leaves the rest parseable', () => {
    const out = stripJsonComments('{"a": 1 /* block */ , "b": 2}');
    expect(out).not.toContain('block');
    expect(JSON.parse(out)).toEqual({ a: 1, b: 2 });
  });

  it('does not treat a // inside a string literal as a comment', () => {
    const input = '{"url": "http://example.com//x"}';
    expect(stripJsonComments(input)).toBe(input);
  });

  it('honors an escaped quote so the scanner stays in-string', () => {
    const input = '{"s": "a\\"b"}';
    expect(stripJsonComments(input)).toBe(input);
    expect(JSON.parse(stripJsonComments(input))).toEqual({ s: 'a"b' });
  });

  it('does not throw on an unterminated block comment', () => {
    const out = stripJsonComments('{"a": 1} /* unterminated');
    expect(out.startsWith('{"a": 1}')).toBe(true);
    expect(out).not.toContain('unterminated');
  });

  it('returns empty input unchanged', () => {
    expect(stripJsonComments('')).toBe('');
  });
});

describe('parseConfig', () => {
  it('parses JSON and JSONC, including a comment in a .json file', () => {
    expect(parseConfig('a.json', 'json', '{"a": 1}')._unsafeUnwrap()).toEqual({ a: 1 });
    expect(parseConfig('a.jsonc', 'jsonc', '{ "a": 1 }')._unsafeUnwrap()).toEqual({ a: 1 });
    expect(parseConfig('a.json', 'json', '{ // c\n "a": 1 }')._unsafeUnwrap()).toEqual({ a: 1 });
  });

  it('returns a typed error for malformed JSON and JSONC', () => {
    const json = parseConfig('bad.json', 'json', 'not json');
    expect(json.isErr()).toBe(true);
    expect(json._unsafeUnwrapErr().code).toBe('DEPS_PARSE_ERROR');
    expect(stitchErrorMessage(json._unsafeUnwrapErr())).toContain('Cannot parse bad.json');

    expect(parseConfig('bad.jsonc', 'jsonc', '{ bad').isErr()).toBe(true);
  });

  it('parses TOML and returns an error for malformed TOML', () => {
    expect(parseConfig('a.toml', 'toml', 'a = 1\n')._unsafeUnwrap()).toEqual({ a: 1 });
    const bad = parseConfig('bad.toml', 'toml', 'a = ');
    expect(bad.isErr()).toBe(true);
    expect(bad._unsafeUnwrapErr().code).toBe('DEPS_PARSE_ERROR');
  });

  it('parses YAML and returns an error for malformed YAML', () => {
    expect(parseConfig('a.yaml', 'yaml', 'a: 1\n')._unsafeUnwrap()).toEqual({ a: 1 });
    const bad = parseConfig('bad.yaml', 'yaml', 'a: [');
    expect(bad.isErr()).toBe(true);
    expect(stitchErrorMessage(bad._unsafeUnwrapErr())).toContain('Cannot parse bad.yaml');
  });

  it('parses env/ini into a flat string map, skipping comments and bad lines', () => {
    const text = [
      '# comment',
      '; comment',
      '[section]',
      'A=1',
      'B = two',
      'NOEQUALS',
      '=empty',
    ].join('\n');
    expect(parseConfig('a.env', 'env', text)._unsafeUnwrap()).toEqual({ A: '1', B: 'two' });
    expect(parseConfig('a.ini', 'ini', 'C=\n')._unsafeUnwrap()).toEqual({ C: '' });
    expect(parseConfig('empty.env', 'env', '')._unsafeUnwrap()).toEqual({});
  });
});

describe('serializeConfig', () => {
  it('serializes JSON and JSONC as pretty JSON with a trailing newline', () => {
    const expected = '{\n  "a": 1\n}\n';
    expect(serializeConfig('json', { a: 1 }, '')._unsafeUnwrap()).toBe(expected);
    expect(serializeConfig('jsonc', { a: 1 }, '')._unsafeUnwrap()).toBe(expected);
  });

  it('serializes TOML and returns an error for unserializable input', () => {
    expect(serializeConfig('toml', { a: 1 }, '')._unsafeUnwrap()).toBe('a = 1\n');
    const bad = serializeConfig('toml', { f: (): void => {} }, '');
    expect(bad.isErr()).toBe(true);
    const tomlErr = bad._unsafeUnwrapErr();
    expect(tomlErr.code === 'DEPS_PARSE_ERROR' && tomlErr.file).toBe('<toml>');
  });

  it('serializes YAML and returns an error for unserializable input', () => {
    expect(serializeConfig('yaml', { a: 1 }, '')._unsafeUnwrap()).toBe('a: 1\n');
    const bad = serializeConfig('yaml', { f: (): void => {} }, '');
    expect(bad.isErr()).toBe(true);
    const yamlErr = bad._unsafeUnwrapErr();
    expect(yamlErr.code === 'DEPS_PARSE_ERROR' && yamlErr.file).toBe('<yaml>');
  });

  it('rewrites known env keys in place, preserves the rest, and appends new keys', () => {
    const out = serializeConfig(
      'env',
      { A: '99', C: '3' },
      '# header\nA=1\nB=2\n;note\n'
    )._unsafeUnwrap();
    expect(out).toBe('# header\nA=99\nB=2\n;note\n\nC=3\n');
  });

  it('preserves a line with an empty key and collapses trailing blank lines', () => {
    expect(serializeConfig('ini', { A: '2' }, '=x\nA=1\n')._unsafeUnwrap()).toBe('=x\nA=2\n');
  });

  it('appends every key when the original document is empty', () => {
    expect(serializeConfig('ini', { A: '1' }, '')._unsafeUnwrap()).toBe('\nA=1\n');
  });
});

describe('parseKeyPath', () => {
  it('splits a dot path and trims each segment', () => {
    expect(parseKeyPath('a.b.c')._unsafeUnwrap()).toEqual(['a', 'b', 'c']);
    expect(parseKeyPath(' a . b ')._unsafeUnwrap()).toEqual(['a', 'b']);
    expect(parseKeyPath('.a')._unsafeUnwrap()).toEqual(['a']);
  });

  it('honors a quoted bracket segment that contains dots and slashes', () => {
    expect(parseKeyPath('a["b.c"].d')._unsafeUnwrap()).toEqual(['a', 'b.c', 'd']);
    expect(parseKeyPath("a['@app/*']")._unsafeUnwrap()).toEqual(['a', '@app/*']);
    expect(parseKeyPath('["a.b"]')._unsafeUnwrap()).toEqual(['a.b']);
  });

  it('accepts an unquoted bracket segment and swallows a trailing dot', () => {
    expect(parseKeyPath('a[b]')._unsafeUnwrap()).toEqual(['a', 'b']);
    expect(parseKeyPath('a["b"].')._unsafeUnwrap()).toEqual(['a', 'b']);
    expect(parseKeyPath('a["b"]c')._unsafeUnwrap()).toEqual(['a', 'b', 'c']);
  });

  it('rejects empty, unterminated and segmentless keys', () => {
    expect(parseKeyPath('').isErr()).toBe(true);
    expect(parseKeyPath('   ').isErr()).toBe(true);
    const unterminated = parseKeyPath('a["b');
    expect(unterminated.isErr()).toBe(true);
    expect(stitchErrorMessage(unterminated._unsafeUnwrapErr())).toContain('Unterminated bracket');

    const empty = parseKeyPath('a[]');
    expect(empty.isErr()).toBe(true);
    expect(stitchErrorMessage(empty._unsafeUnwrapErr())).toContain('Empty bracket');

    expect(parseKeyPath('a[""]').isErr()).toBe(true);
    const noSegments = parseKeyPath('.');
    expect(noSegments.isErr()).toBe(true);
    expect(stitchErrorMessage(noSegments._unsafeUnwrapErr())).toContain('no segments');
  });
});

describe('assertSafeKeyPath', () => {
  it('accepts a safe path and an empty path', () => {
    expect(assertSafeKeyPath(['a', 'b'], 'a.b').isOk()).toBe(true);
    expect(assertSafeKeyPath([], '').isOk()).toBe(true);
  });

  it('rejects every prototype-polluting segment', () => {
    for (const segment of ['__proto__', 'prototype', 'constructor']) {
      const result = assertSafeKeyPath([segment], segment);
      expect(result.isErr()).toBe(true);
      expect(stitchErrorMessage(result._unsafeUnwrapErr())).toContain('prototype-polluting');
    }
  });
});

describe('getAtPath', () => {
  it('reads a nested value and the root for an empty path', () => {
    const root = { a: { b: 1 } };
    expect(getAtPath(root, ['a', 'b'])).toBe(1);
    expect(getAtPath(root, [])).toBe(root);
  });

  it('returns undefined when a segment is missing or not a plain object', () => {
    expect(getAtPath({}, ['x'])).toBeUndefined();
    expect(getAtPath({ a: 1 }, ['a', 'b'])).toBeUndefined();
    expect(getAtPath({ a: [1, 2] }, ['a', '0'])).toBeUndefined();
    expect(getAtPath(null, ['a'])).toBeUndefined();
  });

  it('does not read an inherited Object.prototype member', () => {
    const root = Object.create({ inherited: 'nope' }) as Record<string, unknown>;
    expect(getAtPath(root, ['inherited'])).toBeUndefined();
  });
});

describe('setAtPath', () => {
  it('creates nested objects and overwrites without mutating the input', () => {
    const root = { a: { b: 1 } };
    const out = setAtPath(root, ['a', 'b'], 2);
    expect(out).toEqual({ a: { b: 2 } });
    expect(root).toEqual({ a: { b: 1 } });
    expect(setAtPath({}, ['x', 'y'], 1)).toEqual({ x: { y: 1 } });
  });

  it('replaces a non-object intermediate value and a non-object root', () => {
    expect(setAtPath({ a: 1 }, ['a', 'b'], 2)).toEqual({ a: { b: 2 } });
    expect(setAtPath(null, ['a'], 1)).toEqual({ a: 1 });
  });

  it('returns a null-prototype object so an inherited member cannot leak in', () => {
    expect(Object.getPrototypeOf(setAtPath({}, ['a'], 1))).toBeNull();
  });

  it('returns the value directly for an empty segment path', () => {
    expect(setAtPath({ a: 1 }, [], 5)).toBe(5);
  });

  it('stops safely on a hole in the segment list', () => {
    expect(setAtPath({ a: 1 }, new Array<string>(1), 2)).toEqual({ a: 1 });
  });
});

describe('removeAtPath', () => {
  it('removes a leaf without mutating the input', () => {
    const root = { a: { b: 1, c: 2 } };
    const out = removeAtPath(root, ['a', 'b']);
    expect(out).toEqual({ a: { c: 2 } });
    expect(root).toEqual({ a: { b: 1, c: 2 } });
    expect(Object.getPrototypeOf(out)).toBeNull();
  });

  it('returns an equivalent copy when the key is absent', () => {
    expect(removeAtPath({ a: 1 }, ['b'])).toEqual({ a: 1 });
  });

  it('returns a non-object node unchanged', () => {
    expect(removeAtPath(5, ['a'])).toBe(5);
  });

  it('returns the original node for an empty segment path', () => {
    const root = { a: 1 };
    expect(removeAtPath(root, [])).toBe(root);
  });

  it('stops at a non-object node and at a hole in the segment list', () => {
    expect(removeAtPath({ a: 1 }, ['a', 'b'])).toEqual({ a: 1 });
    expect(removeAtPath({ a: 1 }, new Array<string>(1))).toEqual({ a: 1 });
  });
});

describe('deepMerge', () => {
  it('returns the patch unchanged when it is not a plain object', () => {
    expect(deepMerge({ a: 1 }, 5)).toBe(5);
    expect(deepMerge({ a: 1 }, null)).toBeNull();
    const arr = [1, 2];
    expect(deepMerge({ a: 1 }, arr)).toBe(arr);
    expect(deepMerge({ a: 1 }, 'x')).toBe('x');
  });

  it('merges into a null-prototype base when the base is not an object', () => {
    const out = deepMerge(null, { a: 1 }) as Record<string, unknown>;
    expect(out).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(out)).toBeNull();
  });

  it('deep-merges nested objects and keeps untouched siblings', () => {
    expect(deepMerge({ a: { b: 1, d: 2 } }, { a: { b: 9, c: 3 } })).toEqual({
      a: { b: 9, c: 3, d: 2 },
    });
  });

  it('overrides when only one side is a plain object', () => {
    expect(deepMerge({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
    expect(deepMerge({ a: { b: 1 } }, { a: 5 })).toEqual({ a: 5 });
    expect(deepMerge({ a: [1] }, { a: [2] })).toEqual({ a: [2] });
  });

  it('returns an equivalent copy for an empty patch', () => {
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
  });

  it('skips prototype-polluting keys without touching Object.prototype', () => {
    const patch = JSON.parse(
      '{"__proto__":{"polluted":1},"constructor":{"x":1},"prototype":{"y":1},"safe":2}'
    ) as Record<string, unknown>;
    const out = deepMerge({}, patch) as Record<string, unknown>;
    expect(out.safe).toBe(2);
    expect(Object.hasOwn(out, '__proto__')).toBe(false);
    expect(Object.hasOwn(out, 'constructor')).toBe(false);
    expect(Object.hasOwn(out, 'prototype')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('round-trip through the key-path helpers', () => {
  it('parses a key, sets a value, reads it back, then removes it', () => {
    const segments = parseKeyPath('a["b.c"]')._unsafeUnwrap() as KeySegment[];
    expect(assertSafeKeyPath(segments, 'a["b.c"]').isOk()).toBe(true);
    const withValue = setAtPath({}, segments, 'v');
    expect(getAtPath(withValue, segments)).toBe('v');
    expect(removeAtPath(withValue, segments)).toEqual({ a: {} });
  });
});
