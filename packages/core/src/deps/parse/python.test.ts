// P-105 tests: requirements.txt + pyproject.toml parsing. Covers the five
// spec fixtures (requirements-simple, requirements-with-extras,
// pyproject-poetry, pyproject-pep621, pyproject-uv) plus the spec edges
// (empty file, comment-only, package @ URL, duplicate last-wins) and the
// dispatcher, dev-requirements routing, and TOML validation failures.
import { describe, expect, it } from 'vitest';
import { parsePyprojectToml, parsePythonManifest, parseRequirementsTxt } from './python.js';

const REQUIREMENTS_SIMPLE = [
  'requests>=2.28.1',
  'django==4.2',
  'numpy~=1.26.0',
  '',
  '# a comment',
].join('\n');

const REQUIREMENTS_WITH_EXTRAS = [
  'requests[socks]>=2.28.1',
  'django[argon2]==4.2 # web comment',
  '-r base.txt',
  '-c constraints.txt',
].join('\n');

const PYPROJECT_POETRY = [
  '[tool.poetry]',
  'name = "api"',
  'version = "0.1.0"',
  '',
  '[tool.poetry.dependencies]',
  'python = ">=3.9,<4.0"',
  'requests = ">=2.28.1"',
  'django = { version = "==4.2", extras = ["argon2"] }',
  '',
  '[tool.poetry.group.dev.dependencies]',
  'pytest = "^7.4.0"',
].join('\n');

const PYPROJECT_PEP621 = [
  '[project]',
  'name = "api"',
  'version = "0.1.0"',
  'requires-python = ">=3.11"',
  'dependencies = [',
  '  "requests>=2.28.1",',
  '  "django[argon2]==4.2",',
  ']',
  '',
  '[project.optional-dependencies]',
  'test = ["pytest>=7.0"]',
].join('\n');

const PYPROJECT_UV = [
  '[project]',
  'name = "tool"',
  'version = "0.2.0"',
  'requires-python = ">=3.12"',
  'dependencies = ["requests>=2.28.1", "internal-lib"]',
  '',
  '[tool.uv.sources]',
  'internal-lib = { git = "https://example.com/org/internal-lib.git", rev = "main" }',
  '',
  '[dependency-groups]',
  'dev = ["ruff>=0.4.0"]',
].join('\n');

describe('P-105 python: requirements-simple.txt', () => {
  it('parses name/spec pairs, skipping blanks and comments', () => {
    const r = parseRequirementsTxt(REQUIREMENTS_SIMPLE, 'requirements.txt');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.source).toBe('requirements.txt');
      expect(r.value.dependencies).toEqual({
        requests: '>=2.28.1',
        django: '==4.2',
        numpy: '~=1.26.0',
      });
      expect(r.value.devDependencies).toBeUndefined();
    }
  });
});

describe('P-105 python: requirements-with-extras.txt', () => {
  it('captures extras, strips inline comments, skips includes gracefully', () => {
    const r = parseRequirementsTxt(REQUIREMENTS_WITH_EXTRAS, 'requirements.txt');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.dependencies).toEqual({
        requests: '>=2.28.1',
        django: '==4.2',
      });
      expect(r.value.extras).toEqual({ requests: ['socks'], django: ['argon2'] });
    }
  });
});

describe('P-105 python: pyproject-poetry.toml', () => {
  it('returns poetry source with deps, dev group, and python version', () => {
    const r = parsePyprojectToml(PYPROJECT_POETRY, 'pyproject.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.source).toBe('poetry');
      expect(r.value.dependencies).toEqual({ requests: '>=2.28.1', django: '==4.2' });
      expect(r.value.devDependencies).toEqual({ pytest: '^7.4.0' });
      expect(r.value.extras).toEqual({ django: ['argon2'] });
      expect(r.value.pythonVersion).toBe('>=3.9,<4.0');
    }
  });
});

describe('P-105 python: pyproject-pep621.toml', () => {
  it('returns pyproject.toml source with deps, extras, and python version', () => {
    const r = parsePyprojectToml(PYPROJECT_PEP621, 'pyproject.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.source).toBe('pyproject.toml');
      expect(r.value.dependencies).toEqual({
        requests: '>=2.28.1',
        django: '==4.2',
        pytest: '>=7.0',
      });
      expect(r.value.extras).toEqual({ django: ['argon2'], test: ['pytest>=7.0'] });
      expect(r.value.pythonVersion).toBe('>=3.11');
    }
  });
});

describe('P-105 python: pyproject-uv.toml', () => {
  it('returns uv source with git urls and dependency groups', () => {
    const r = parsePyprojectToml(PYPROJECT_UV, 'pyproject.toml');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.source).toBe('uv');
      expect(r.value.dependencies['requests']).toBe('>=2.28.1');
      expect(r.value.dependencies['internal-lib']).toBe('*');
      expect(r.value.urls).toEqual({
        'internal-lib': 'https://example.com/org/internal-lib.git',
      });
      expect(r.value.devDependencies).toEqual({ ruff: '>=0.4.0' });
      expect(r.value.pythonVersion).toBe('>=3.12');
    }
  });
});

describe('P-105 python: edge cases', () => {
  it('empty file maps to FILE_NOT_FOUND', () => {
    for (const content of ['', '  \n  ']) {
      const req = parseRequirementsTxt(content, 'requirements.txt');
      expect(req.isErr()).toBe(true);
      if (req.isErr()) expect(req.error.code).toBe('FILE_NOT_FOUND');
      const toml = parsePyprojectToml(content, 'pyproject.toml');
      expect(toml.isErr()).toBe(true);
      if (toml.isErr()) expect(toml.error.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('comment-only requirements file is valid with empty dependencies', () => {
    const r = parseRequirementsTxt('# just a comment\n# another\n', 'requirements.txt');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.dependencies).toEqual({});
      expect(r.value.source).toBe('requirements.txt');
    }
  });

  it('package @ URL stores wildcard spec plus the url', () => {
    const r = parseRequirementsTxt(
      'mylib @ git+https://example.com/org/mylib.git@main\n',
      'requirements.txt'
    );
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.dependencies).toEqual({ mylib: '*' });
      expect(r.value.urls).toEqual({ mylib: 'git+https://example.com/org/mylib.git@main' });
    }
  });

  it('duplicate package entries resolve last-wins', () => {
    const r = parseRequirementsTxt('requests>=2.0\nrequests>=2.28.1\n', 'requirements.txt');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.dependencies).toEqual({ requests: '>=2.28.1' });
  });

  it('URL fragments survive comment stripping', () => {
    const r = parseRequirementsTxt(
      'mylib @ git+https://example.com/r.git#egg=mylib\n',
      'requirements.txt'
    );
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.urls).toEqual({ mylib: 'git+https://example.com/r.git#egg=mylib' });
    }
  });

  it('environment markers stay inside the spec string', () => {
    const r = parseRequirementsTxt(
      'requests>=2.28.1; python_version > "3.8"\n',
      'requirements.txt'
    );
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.dependencies).toEqual({
        requests: '>=2.28.1; python_version > "3.8"',
      });
    }
  });

  it('dev requirements basenames fill devDependencies', () => {
    const r = parseRequirementsTxt('pytest>=7.0\n', 'requirements-dev.txt');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.dependencies).toEqual({});
      expect(r.value.devDependencies).toEqual({ pytest: '>=7.0' });
    }
  });

  it('malformed TOML maps to DEPS_PARSE_ERROR with a line number', () => {
    const r = parsePyprojectToml('[project\nname = "broken"\n', 'pyproject.toml');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.file).toBe('pyproject.toml');
        expect(r.error.message).toMatch(/line \d+/);
      }
    }
  });

  it('wrong structural types map to DEPS_PARSE_ERROR with a field path', () => {
    const r = parsePyprojectToml('[project]\ndependencies = "requests>=2"\n', 'pyproject.toml');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('DEPS_PARSE_ERROR');
      if (r.error.code === 'DEPS_PARSE_ERROR') {
        expect(r.error.message).toContain('[project].dependencies');
      }
    }
  });
});

describe('P-105 python: parsePythonManifest dispatcher', () => {
  it('routes pyproject.toml by basename', () => {
    const r = parsePythonManifest('api/pyproject.toml', PYPROJECT_PEP621);
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'python') {
      expect(r.value.ecosystem).toBe('python');
      expect(r.value.path).toBe('api/pyproject.toml');
      expect(r.value.manifest.source).toBe('pyproject.toml');
    }
  });

  it('routes requirements variants by basename', () => {
    const r = parsePythonManifest('api/requirements-dev.txt', 'pytest>=7.0\n');
    expect(r.isOk()).toBe(true);
    if (r.isOk() && r.value.ecosystem === 'python') {
      expect(r.value.ecosystem).toBe('python');
      expect(r.value.manifest.devDependencies).toEqual({ pytest: '>=7.0' });
    }
  });

  it('rejects non-python manifests with DEPS_PARSE_ERROR', () => {
    const r = parsePythonManifest('package.json', '{}');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.code).toBe('DEPS_PARSE_ERROR');
  });
});
