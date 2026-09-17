// P-107 tests: go.mod parsing + serialization. Covers the four spec
// fixtures (go.simple, go.block, go.replace, go.indirect) plus the spec
// edges (single vs block require with // indirect, module/goVersion/replace/
// exclude capture, toolchain warn-no-error, missing module -> DEPS_PARSE_ERROR,
// empty -> FILE_NOT_FOUND) and the serialize snapshot (sorted go fmt style)
// plus round-trip fixed-point and robustness edges (retract ignored, unknown
// directives skipped, duplicate last-wins, unclosed block, CRLF/BOM).
import { describe, expect, it } from 'vitest';
import { parseGoMod, serializeGoMod } from './go.js';

const GO_SIMPLE = [
  'module example.com/simple',
  '',
  'go 1.21',
  '',
  'require github.com/spf13/cobra v1.8.0',
].join('\n');

const GO_BLOCK = [
  'module example.com/block',
  '',
  'go 1.22',
  '',
  'require (',
  '\tgithub.com/spf13/cobra v1.8.0',
  '\tgithub.com/stretchr/testify v1.9.0',
  ')',
].join('\n');

const GO_REPLACE = [
  'module example.com/with-replace',
  '',
  'go 1.21',
  '',
  'require example.com/app v1.0.0',
  '',
  'replace example.com/old => example.com/new v1.0.0',
  '',
  'replace (',
  '\texample.com/a v1.0.0 => example.com/b v2.0.0',
  ')',
].join('\n');

const GO_INDIRECT = [
  'module example.com/indirect',
  '',
  'go 1.21',
  '',
  'require (',
  '\tgithub.com/spf13/cobra v1.8.0',
  '\tgithub.com/inconshreveable/mousetrap v1.1.0 // indirect',
  '\tgithub.com/spf13/pflag v1.0.5 // indirect',
  ')',
  '',
  'require github.com/stretchr/testify v1.9.0 // indirect',
].join('\n');

describe('P-107 go: go.simple.mod', () => {
  it('parses module, goVersion, and single-line require', () => {
    const r = parseGoMod(GO_SIMPLE, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.ecosystem).toBe('go');
      expect(r.value.path).toBe('go.mod');
      expect(r.value.manifest.module).toBe('example.com/simple');
      expect(r.value.manifest.goVersion).toBe('1.21');
      expect(r.value.manifest.require).toEqual({
        'github.com/spf13/cobra': 'v1.8.0',
      });
      expect(r.value.manifest.indirect).toBeUndefined();
      expect(r.value.manifest.replace).toBeUndefined();
      expect(r.value.manifest.exclude).toBeUndefined();
    }
  });
});

describe('P-107 go: go.block.mod', () => {
  it('parses block require entries into one map', () => {
    const r = parseGoMod(GO_BLOCK, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.module).toBe('example.com/block');
      expect(r.value.manifest.goVersion).toBe('1.22');
      expect(r.value.manifest.require).toEqual({
        'github.com/spf13/cobra': 'v1.8.0',
        'github.com/stretchr/testify': 'v1.9.0',
      });
      expect(r.value.manifest.indirect).toBeUndefined();
    }
  });
});

describe('P-107 go: go.replace.mod', () => {
  it('captures single and block replace directives', () => {
    const r = parseGoMod(GO_REPLACE, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.module).toBe('example.com/with-replace');
      expect(r.value.manifest.require).toEqual({
        'example.com/app': 'v1.0.0',
      });
      expect(r.value.manifest.replace).toEqual({
        'example.com/old': 'example.com/new v1.0.0',
        'example.com/a': 'example.com/b v2.0.0',
      });
    }
  });
});

describe('P-107 go: go.indirect.mod', () => {
  it('collects // indirect markers from block and single lines', () => {
    const r = parseGoMod(GO_INDIRECT, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.require).toEqual({
        'github.com/spf13/cobra': 'v1.8.0',
        'github.com/inconshreveable/mousetrap': 'v1.1.0',
        'github.com/spf13/pflag': 'v1.0.5',
        'github.com/stretchr/testify': 'v1.9.0',
      });
      expect(r.value.manifest.indirect).toEqual(
        new Set([
          'github.com/inconshreveable/mousetrap',
          'github.com/spf13/pflag',
          'github.com/stretchr/testify',
        ])
      );
    }
  });
});

describe('P-107 go: directives', () => {
  it('captures module, goVersion, replace, and exclude', () => {
    const content = [
      'module example.com/full',
      '',
      'go 1.21',
      '',
      'require example.com/app v1.0.0',
      '',
      'replace example.com/old => ../local/old',
      '',
      'exclude example.com/bad v1.0.0',
    ].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.module).toBe('example.com/full');
      expect(r.value.manifest.goVersion).toBe('1.21');
      expect(r.value.manifest.replace).toEqual({
        'example.com/old': '../local/old',
      });
      expect(r.value.manifest.exclude).toEqual({
        'example.com/bad': 'v1.0.0',
      });
    }
  });

  it('parses exclude blocks', () => {
    const content = [
      'module example.com/ex',
      '',
      'go 1.21',
      '',
      'exclude (',
      '\texample.com/a v1.0.0',
      '\texample.com/b v2.0.0',
      ')',
    ].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.exclude).toEqual({
        'example.com/a': 'v1.0.0',
        'example.com/b': 'v2.0.0',
      });
    }
  });

  it('toolchain directive does not error', () => {
    const content = ['module example.com/tool', '', 'go 1.21', '', 'toolchain go1.21.5'].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.module).toBe('example.com/tool');
      expect(r.value.manifest.goVersion).toBe('1.21');
    }
  });

  it('retract directives are ignored without error', () => {
    const content = [
      'module example.com/ret',
      '',
      'go 1.21',
      '',
      'retract v1.0.0 // broken release',
      '',
      'retract (',
      '\tv1.1.0 // also broken',
      ')',
    ].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.module).toBe('example.com/ret');
      expect(r.value.manifest.require).toEqual({});
    }
  });

  it('unknown directives are skipped without error', () => {
    const content = ['module example.com/unk', '', 'go 1.21', '', 'frobnicator smiles'].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.module).toBe('example.com/unk');
    }
  });

  it('handles CRLF line endings and a leading BOM', () => {
    const content = '﻿module example.com/bom\r\ngo 1.21\r\nrequire a/b v1.0.0\r\n';
    const r = parseGoMod(content, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.module).toBe('example.com/bom');
      expect(r.value.manifest.require).toEqual({ 'a/b': 'v1.0.0' });
    }
  });

  it('duplicate require entries resolve last-wins', () => {
    const content = [
      'module example.com/dup',
      '',
      'go 1.21',
      '',
      'require example.com/a v1.0.0',
      'require example.com/a v2.0.0',
    ].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(r.value.manifest.require).toEqual({ 'example.com/a': 'v2.0.0' });
    }
  });
});

describe('P-107 go: validation failures', () => {
  it('empty or whitespace content maps to FILE_NOT_FOUND', () => {
    for (const content of ['', '  \n  ']) {
      const r = parseGoMod(content, 'go.mod');
      expect(r.isErr()).toBe(true);
      if (r.isErr()) expect(r.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('missing module line returns DEPS_PARSE_ERROR', () => {
    const r = parseGoMod('go 1.21\nrequire a/b v1.0.0\n', 'go.mod');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.file).toBe('go.mod');
        expect(r.error.message).toContain('module');
      }
    }
  });

  it('malformed single require returns DEPS_PARSE_ERROR with a line number', () => {
    const r = parseGoMod('module example.com/x\nrequire just-one-token\n', 'go.mod');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toMatch(/line 2/);
      }
    }
  });

  it('malformed block entry returns DEPS_PARSE_ERROR with a line number', () => {
    const content = ['module example.com/x', '', 'require (', '\tjust-one-token'].join('\n');
    const close: string[] = [')'];
    const full = [content, ...close].join('\n');
    const r = parseGoMod(full, 'go.mod');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toMatch(/line 4/);
      }
    }
  });

  it('malformed replace without => returns DEPS_PARSE_ERROR', () => {
    const content = ['module example.com/x', '', 'replace example.com/a'].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });

  it('unclosed block returns DEPS_PARSE_ERROR', () => {
    const content = ['module example.com/x', '', 'require (', '\ta/b v1.0.0'].join('\n');
    const r = parseGoMod(content, 'go.mod');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('unclosed');
      }
    }
  });

  it('malformed module directive returns DEPS_PARSE_ERROR', () => {
    const r = parseGoMod('module\n', 'go.mod');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });
});

describe('P-107 go: serializeGoMod', () => {
  it('emits go fmt style with sorted require block and indirect suffix', () => {
    const r = parseGoMod(GO_INDIRECT, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      const text = serializeGoMod(r.value.manifest);
      expect(text).toBe(
        [
          'module example.com/indirect',
          '',
          'go 1.21',
          '',
          'require (',
          '\tgithub.com/inconshreveable/mousetrap v1.1.0 // indirect',
          '\tgithub.com/spf13/cobra v1.8.0',
          '\tgithub.com/spf13/pflag v1.0.5 // indirect',
          '\tgithub.com/stretchr/testify v1.9.0 // indirect',
          ')',
          '',
        ].join('\n')
      );
    }
  });

  it('emits single require without a block when only one entry', () => {
    const r = parseGoMod(GO_SIMPLE, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      expect(serializeGoMod(r.value.manifest)).toBe(
        [
          'module example.com/simple',
          '',
          'go 1.21',
          '',
          'require github.com/spf13/cobra v1.8.0',
          '',
        ].join('\n')
      );
    }
  });

  it('preserves replace sections on serialize', () => {
    const r = parseGoMod(GO_REPLACE, 'go.mod');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'go') {
      const text = serializeGoMod(r.value.manifest);
      expect(text).toContain('replace (');
      expect(text).toContain('example.com/old => example.com/new v1.0.0');
      expect(text).toContain('example.com/a => example.com/b v2.0.0');
    }
  });

  it('parse -> serialize -> parse is a fixed point', () => {
    const first = parseGoMod(GO_INDIRECT, 'go.mod');
    expect(first.isOk()).toBe(true);
    if (first.isOk() && first.value.ecosystem === 'go') {
      const text = serializeGoMod(first.value.manifest);
      const second = parseGoMod(text, 'go.mod');
      expect(second.isOk()).toBe(true);
      if (second.isOk() && second.value.ecosystem === 'go') {
        expect(second.value.manifest).toEqual(first.value.manifest);
      }
    }
  });
});
