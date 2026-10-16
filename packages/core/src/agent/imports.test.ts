// P-149 — unit tests for the pure import-extraction helpers.
//
// These extractors are lexical and filesystem-free, so every test passes
// source text (and, for path resolution, an in-memory listing) directly. The
// cases that matter are the branches deciding
// package / builtin / relative, the comment handling that must not turn a
// commented-out import into a real dependency, and the path normalisation that
// must refuse to escape the repo root.

import { describe, it, expect } from 'vitest';
import {
  classifyJsSpecifier,
  jsPackageName,
  parseJsImports,
  parsePythonImports,
  pythonPackageName,
  resolveRelativeImport,
} from './imports.js';

describe('jsPackageName', () => {
  it('reduces bare and subpath specifiers to the installable name', () => {
    expect(jsPackageName('lodash')).toBe('lodash');
    expect(jsPackageName('lodash/fp')).toBe('lodash');
    expect(jsPackageName('lodash/fp/curry')).toBe('lodash');
  });

  it('keeps both segments of a scoped package', () => {
    expect(jsPackageName('@scope/pkg')).toBe('@scope/pkg');
    expect(jsPackageName('@scope/pkg/sub/path')).toBe('@scope/pkg');
  });

  it('returns undefined for empty, relative, absolute and imports-map specifiers', () => {
    expect(jsPackageName('')).toBeUndefined();
    expect(jsPackageName('./local')).toBeUndefined();
    expect(jsPackageName('../parent')).toBeUndefined();
    expect(jsPackageName('/abs/path')).toBeUndefined();
    expect(jsPackageName('#internal')).toBeUndefined();
  });

  it('returns undefined for Node builtins, with or without the node: prefix', () => {
    expect(jsPackageName('fs')).toBeUndefined();
    expect(jsPackageName('path')).toBeUndefined();
    expect(jsPackageName('node:fs')).toBeUndefined();
    expect(jsPackageName('node:path')).toBeUndefined();
  });

  it('treats a node: specifier that is not a builtin as a package', () => {
    expect(jsPackageName('node:not-a-builtin')).toBe('node:not-a-builtin');
  });

  it('returns undefined for malformed scoped specifiers', () => {
    expect(jsPackageName('@scope')).toBeUndefined();
    expect(jsPackageName('@scope/')).toBeUndefined();
  });
});

describe('classifyJsSpecifier', () => {
  it('classifies relative, absolute and imports-map specifiers as relative', () => {
    expect(classifyJsSpecifier('./a')).toBe('relative');
    expect(classifyJsSpecifier('../a')).toBe('relative');
    expect(classifyJsSpecifier('/abs/a')).toBe('relative');
    expect(classifyJsSpecifier('#internal')).toBe('relative');
  });

  it('classifies Node builtins, prefixed or bare, as builtin', () => {
    expect(classifyJsSpecifier('fs')).toBe('builtin');
    expect(classifyJsSpecifier('node:fs')).toBe('builtin');
    expect(classifyJsSpecifier('node:worker_threads')).toBe('builtin');
  });

  it('classifies everything else, including the empty string, as package', () => {
    expect(classifyJsSpecifier('lodash')).toBe('package');
    expect(classifyJsSpecifier('@scope/pkg')).toBe('package');
    expect(classifyJsSpecifier('node:not-a-builtin')).toBe('package');
    expect(classifyJsSpecifier('')).toBe('package');
  });
});

describe('parseJsImports', () => {
  it('extracts every supported import form once, de-duplicated', () => {
    const source = [
      "import fs from 'fs';",
      "import type { Foo } from './foo.js';",
      "import { a, b } from 'left-pad';",
      "import * as ns from '@scope/pkg/sub';",
      "import 'polyfill';",
      "export { x } from 'reexported';",
      "export type { T } from './types.js';",
      "export * from 'star-export';",
      "const lazy = await import('dynamic-pkg');",
      "const spaced = import ( 'spaced-pkg' );",
      "const cjs = require('cjs-pkg');",
      'import {',
      '  multi,',
      '  line,',
      "} from 'multi-line-pkg';",
      "import fs from 'fs';",
    ].join('\n');

    expect(parseJsImports(source).sort()).toEqual(
      [
        './foo.js',
        './types.js',
        '@scope/pkg/sub',
        'cjs-pkg',
        'dynamic-pkg',
        'fs',
        'left-pad',
        'multi-line-pkg',
        'polyfill',
        'reexported',
        'spaced-pkg',
        'star-export',
      ].sort()
    );
  });

  it('ignores imports inside line and block comments', () => {
    const source = [
      "// import commented from 'commented-pkg';",
      "/* import blocked from 'blocked-pkg'; */",
      "import real from 'real-pkg'; // import trailing from 'trailing-pkg';",
      '/* multi',
      "   line import block from 'block-pkg'; */",
    ].join('\n');

    expect(parseJsImports(source)).toEqual(['real-pkg']);
  });

  it('leaves a URL alone because the // is preceded by a colon', () => {
    expect(parseJsImports("const url = 'http://example.com/x';")).toEqual([]);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(parseJsImports('')).toEqual([]);
    expect(parseJsImports('   \n\t\n')).toEqual([]);
  });

  it('does not require a semicolon and accepts double quotes', () => {
    expect(parseJsImports('import a from "double-quoted"')).toEqual(['double-quoted']);
  });
});

describe('parsePythonImports', () => {
  it('extracts import and from-import top-level modules, including aliases', () => {
    const source = [
      'import os',
      'import sys, json',
      'import numpy as np',
      'from pandas import DataFrame',
      'from django.db import models',
      'import requests  # inline comment',
      '# import commented',
      'from foo.bar import (',
      '    baz,',
      ')',
      'x = "a # literal hash"',
    ].join('\n');

    expect(parsePythonImports(source).sort()).toEqual(
      ['os', 'sys', 'json', 'numpy', 'pandas', 'django.db', 'requests', 'foo.bar'].sort()
    );
  });

  it('skips relative imports and blank or malformed lines', () => {
    const source = ['from . import local', 'from .mod import thing', '', '   ', 'import'].join(
      '\n'
    );
    expect(parsePythonImports(source)).toEqual([]);
  });

  it('skips empty clauses in a comma list', () => {
    expect(parsePythonImports('import a,,b')).toEqual(['a', 'b']);
  });

  it('returns nothing for empty input', () => {
    expect(parsePythonImports('')).toEqual([]);
  });
});

describe('pythonPackageName', () => {
  it('keeps only the top-level segment of a dotted module', () => {
    expect(pythonPackageName('a.b.c')).toBe('a');
    expect(pythonPackageName('requests')).toBe('requests');
  });

  it('returns undefined for stdlib, relative and empty modules', () => {
    expect(pythonPackageName('os')).toBeUndefined();
    expect(pythonPackageName('json')).toBeUndefined();
    expect(pythonPackageName('.mod')).toBeUndefined();
    expect(pythonPackageName('')).toBeUndefined();
  });
});

describe('resolveRelativeImport', () => {
  const listing = new Set([
    'src/agent/util.ts',
    'src/agent/util.mjs',
    'src/index.ts',
    'src/index.js',
    'src/agent/index.tsx',
    'root.ts',
  ]);

  it('resolves a relative import to a listed file, probing extensions', () => {
    expect(resolveRelativeImport('src/agent/imports.ts', './util', listing)).toBe(
      'src/agent/util.ts'
    );
    expect(resolveRelativeImport('src/agent/imports.ts', './util.mjs', listing)).toBe(
      'src/agent/util.mjs'
    );
    expect(resolveRelativeImport('src/agent/imports.ts', './index', listing)).toBe(
      'src/agent/index.tsx'
    );
    expect(resolveRelativeImport('src/agent/imports.ts', '../index', listing)).toBe('src/index.ts');
  });

  it('resolves from the root when the importer has no directory', () => {
    expect(resolveRelativeImport('other.ts', './root', listing)).toBe('root.ts');
  });

  it('resolves an absolute specifier against the repo root', () => {
    expect(resolveRelativeImport('src/agent/imports.ts', '/src/index.js', listing)).toBe(
      'src/index.js'
    );
  });

  it('returns undefined when no listed file matches', () => {
    expect(resolveRelativeImport('src/agent/imports.ts', './missing', listing)).toBeUndefined();
  });

  it('returns undefined when the path normalises to the repo root', () => {
    expect(resolveRelativeImport('root.ts', '..', listing)).toBeUndefined();
    expect(resolveRelativeImport('root.ts', './..', listing)).toBeUndefined();
  });

  it('collapses redundant segments before matching', () => {
    expect(resolveRelativeImport('src/agent/imports.ts', './deep/../util', listing)).toBe(
      'src/agent/util.ts'
    );
  });
});
