// P-032 tests: parseYaml parses fixtures, round-trips preserve keys,
// malformed input maps to typed err; Document preserves comments;
// stringifyYaml serializes and maps unserializable input to err.
import { describe, it, expect } from 'vitest';
import { parseYaml, parseYamlDocument, stringifyYaml, Document } from '../yaml.js';

const WORKFLOW = `name: ci
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bun run build
`;

describe('P-032 parseYaml: parses yaml (spec smoke test)', () => {
  it('parses a workflows fixture into typed structure', () => {
    const r = parseYaml<{
      name: string;
      jobs: { build: { 'runs-on': string; steps: unknown[] } };
    }>(WORKFLOW);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.name).toBe('ci');
      expect(r.value.jobs.build['runs-on']).toBe('ubuntu-latest');
      expect(r.value.jobs.build.steps).toHaveLength(2);
    }
  });

  it('parses scalars, sequences, and nested maps', () => {
    const r = parseYaml<{ a: number; b: string[]; c: { d: boolean } }>(
      'a: 1\nb: [x, y]\nc:\n  d: true\n'
    );
    if (r.isErr()) throw r.error;
    expect(r.value).toEqual({ a: 1, b: ['x', 'y'], c: { d: true } });
  });

  it('empty input parses to null (yaml semantics)', () => {
    const r = parseYaml('   \n');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBeNull();
    }
  });
});

describe('P-032 round trip (spec smoke test)', () => {
  it('parse -> stringify -> parse preserves keys', () => {
    const first = parseYaml<Record<string, unknown>>(WORKFLOW);
    if (first.isErr()) throw first.error;
    const text = stringifyYaml(first.value);
    if (text.isErr()) throw text.error;
    const second = parseYaml<Record<string, unknown>>(text.value);
    if (second.isErr()) throw second.error;
    expect(Object.keys(second.value).sort()).toEqual(['jobs', 'name', 'on']);
    expect(second.value).toEqual(first.value);
  });
});

describe('P-032 malformed errors (spec smoke test)', () => {
  it('tab indentation maps to err(INTERNAL) with line detail', () => {
    const r = parseYaml('a:\n\tb: 1\n');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
      if (r.error.code === 'INTERNAL') {
        expect(r.error.message).toContain('parseYaml failed');
      }
    }
  });

  it('unbalanced flow maps to err(INTERNAL)', () => {
    const r = parseYaml('a: [1,\nb: 2');
    expect(r.isErr()).toBe(true);
  });

  it('parseYamlDocument maps syntax errors to err(INTERNAL)', () => {
    const r = parseYamlDocument('a: [1,\nb: 2');
    expect(r.isErr()).toBe(true);
  });
});

describe('P-032 parseYamlDocument: comment-preserving round trip', () => {
  it('keeps top-level and inline comments through toString', () => {
    const r = parseYamlDocument('# top comment\nkey: value # inline\n');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBeInstanceOf(Document);
      expect(r.value.get('key')).toBe('value');
      const rendered = r.value.toString();
      expect(rendered).toContain('# top comment');
      expect(rendered).toContain('# inline');
    }
  });

  it('supports set() edits without dropping comments', () => {
    const r = parseYamlDocument('# keep me\nkey: value\n');
    if (r.isErr()) throw r.error;
    r.value.set('other', 1);
    const rendered = r.value.toString();
    expect(rendered).toContain('# keep me');
    expect(rendered).toContain('other: 1');
  });
});

describe('P-032 stringifyYaml', () => {
  it('serializes a plain value', () => {
    const r = stringifyYaml({ name: 'ci', count: 2 });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toContain('name: ci');
      expect(r.value).toContain('count: 2');
    }
  });

  it('unserializable input (function value) maps to err(INTERNAL)', () => {
    const r = stringifyYaml({ f: () => 1 });
    expect(r.isErr()).toBe(true);
  });
});
