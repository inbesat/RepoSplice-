// P-149 — import extraction, as pure functions.
//
// Deliberately separate from the closure walk in `resolve_deps.ts` so the
// parsing rules are testable without a facade, a context, or a filesystem.
//
// SCOPE NOTE (P-149 step 2 names "madge/dependency-cruiser P-021/P-022 when
// JS"): those tools are rooted at a real filesystem directory and return a
// graph. A tool operating through `ToolContext` deliberately does not know
// its checkout paths (ADR-021), so it cannot hand madge a `root`. Import
// extraction therefore runs over file *content* supplied by
// `GitFacade.readFile`. The alternative — having the orchestrator precompute a
// madge graph and inject it — would move the closure computation out of the
// tool, contradicting the step that says the tool parses imports per file.
//
// These are lexical extractors, not full parsers. They cover the import forms
// that actually appear in real repos and are documented as best-effort in
// `parseJsImports`; anything they miss shows up as a missing package, which
// fails toward "tell the operator" rather than silently claiming closure.

/** Node builtins are never installable packages, so they are never required. */
const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

/** Python 3 top-level stdlib modules — likewise never installable. */
const PYTHON_STDLIB = new Set([
  '__future__',
  '_abc',
  '_ast',
  '_collections_abc',
  '_csv',
  '_thread',
  '_typeshed',
  '_warnings',
  '_weakref',
  'abc',
  'aifc',
  'argparse',
  'array',
  'ast',
  'asynchat',
  'asyncio',
  'asyncore',
  'atexit',
  'audioop',
  'base64',
  'bdb',
  'binascii',
  'bisect',
  'builtins',
  'bz2',
  'cProfile',
  'calendar',
  'cgi',
  'cgitb',
  'chunk',
  'cmath',
  'cmd',
  'code',
  'codecs',
  'codeop',
  'collections',
  'colorsys',
  'compileall',
  'concurrent',
  'configparser',
  'contextlib',
  'contextvars',
  'copy',
  'copyreg',
  'crypt',
  'csv',
  'ctypes',
  'curses',
  'dataclasses',
  'datetime',
  'dbm',
  'decimal',
  'difflib',
  'dis',
  'distutils',
  'doctest',
  'email',
  'encodings',
  'ensurepip',
  'enum',
  'errno',
  'faulthandler',
  'fcntl',
  'filecmp',
  'fileinput',
  'fnmatch',
  'fractions',
  'ftplib',
  'functools',
  'gc',
  'genericpath',
  'getopt',
  'getpass',
  'gettext',
  'glob',
  'graphlib',
  'grp',
  'gzip',
  'hashlib',
  'heapq',
  'hmac',
  'html',
  'http',
  'imaplib',
  'importlib',
  'inspect',
  'io',
  'ipaddress',
  'itertools',
  'json',
  'keyword',
  'lib2to3',
  'linecache',
  'locale',
  'logging',
  'lzma',
  'mailbox',
  'mailcap',
  'marshal',
  'math',
  'mimetypes',
  'mmap',
  'modulefinder',
  'msilib',
  'msvcrt',
  'multiprocessing',
  'netrc',
  'nis',
  'nntplib',
  'numbers',
  'operator',
  'optparse',
  'os',
  'ossaudiodev',
  'pathlib',
  'pdb',
  'pickle',
  'pickletools',
  'pipes',
  'pkgutil',
  'platform',
  'plistlib',
  'poplib',
  'posix',
  'pprint',
  'profile',
  'pstats',
  'pty',
  'pwd',
  'py_compile',
  'pyclbr',
  'pydoc',
  'queue',
  'quopri',
  'random',
  're',
  'readline',
  'reprlib',
  'resource',
  'rlcompleter',
  'runpy',
  'sched',
  'secrets',
  'select',
  'selectors',
  'shelve',
  'shlex',
  'shutil',
  'signal',
  'site',
  'smtplib',
  'socket',
  'socketserver',
  'spwd',
  'sqlite3',
  'ssl',
  'stat',
  'statistics',
  'string',
  'stringprep',
  'struct',
  'subprocess',
  'sunau',
  'symtable',
  'sys',
  'sysconfig',
  'syslog',
  'tabnanny',
  'tarfile',
  'telnetlib',
  'tempfile',
  'termios',
  'textwrap',
  'this',
  'threading',
  'time',
  'timeit',
  'tkinter',
  'token',
  'tokenize',
  'trace',
  'traceback',
  'tracemalloc',
  'tty',
  'turtle',
  'types',
  'typing',
  'unicodedata',
  'unittest',
  'urllib',
  'uu',
  'uuid',
  'venv',
  'warnings',
  'wave',
  'weakref',
  'webbrowser',
  'winreg',
  'winsound',
  'wsgiref',
  'xdrlib',
  'xml',
  'xmlrpc',
  'zipapp',
  'zipfile',
  'zipimport',
  'zlib',
  'zoneinfo',
]);

/** Classify a JS/TS module specifier. */
export type SpecifierKind = 'relative' | 'builtin' | 'package';

/**
 * Reduce a bare specifier to its installable package name.
 *
 * - `@scope/pkg/sub/path` -> `@scope/pkg` (scoped packages keep both segments)
 * - `pkg/sub/path`        -> `pkg`
 * - `pkg`                 -> `pkg`
 *
 * Relative (`./`, `../`, `/`) and builtin (`node:fs`, `fs`) specifiers are not
 * packages and return `undefined`.
 */
export function jsPackageName(specifier: string): string | undefined {
  if (specifier === '') return undefined;
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined;
  if (specifier.startsWith('#')) return undefined; // package `imports` map
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  if (NODE_BUILTINS.has(bare)) return undefined;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    const scope = parts[0];
    const name = parts[1];
    if (scope === undefined || name === undefined || name === '') return undefined;
    return `${scope}/${name}`;
  }
  const name = specifier.split('/')[0];
  return name === undefined || name === '' ? undefined : name;
}

/** Classify a JS/TS specifier into relative / builtin / package. */
export function classifyJsSpecifier(specifier: string): SpecifierKind {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) {
    return 'relative';
  }
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return NODE_BUILTINS.has(bare) ? 'builtin' : 'package';
}

/** Strip `//` and block comments so a commented-out import is not extracted. */
function stripJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Extract every module specifier from JS/TS source.
 *
 * Covers: static `import` (default, named, namespace, bare side-effect),
 * `export ... from`, `import type` (TS), dynamic `import()`, and CommonJS
 * `require()`. Multi-line specifier clauses are handled.
 *
 * Best-effort by design: a string literal that happens to contain the word
 * `import(` is not distinguished from a real dynamic import. That errs toward
 * reporting a package that may not be needed, which the operator can dismiss —
 * the safe direction for a tool whose purpose is to prevent broken stitches.
 */
export function parseJsImports(source: string): string[] {
  const text = stripJsComments(source);
  const found = new Set<string>();
  const push = (m: RegExpExecArray): void => {
    const spec = m[1];
    if (spec !== undefined) found.add(spec);
  };
  const patterns: RegExp[] = [
    // import ... from 'x'  /  import type ... from 'x'  (multi-line safe)
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g,
    // bare side-effect import
    /\bimport\s*['"]([^'"]+)['"]/g,
    // export ... from 'x'
    /\bexport\s+(?:type\s+)?(?:[\s\S]*?)\bfrom\s*['"]([^'"]+)['"]/g,
    // dynamic import('x')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // require('x')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) push(m);
  }
  return [...found];
}

/**
 * Extract top-level module names from Python source.
 *
 * `import a.b as c` -> `a`; `from a.b import c` -> `a`; relative forms
 * (`from . import x`, `from .mod import y`) are internal and return nothing.
 * Stdlib names are filtered out by the caller via `pythonPackageName`.
 */
export function parsePythonImports(source: string): string[] {
  const found = new Set<string>();
  for (const rawLine of stripPythonComments(source).split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    let m = /^import\s+(.+)$/.exec(line);
    if (m?.[1] !== undefined) {
      for (const clause of m[1].split(',')) {
        const name = clause
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name !== undefined && name !== '') found.add(name);
      }
      continue;
    }
    m = /^from\s+([A-Za-z_][\w.]*)\s+import\s+/.exec(line);
    if (m?.[1] !== undefined) found.add(m[1]);
  }
  return [...found];
}

function stripPythonComments(source: string): string {
  return source
    .split('\n')
    .map(line => {
      // A '#' inside a string is not a comment; only strip when the line has
      // no quote before it, which covers the overwhelming majority of real
      // import lines without needing a tokenizer.
      const hash = line.indexOf('#');
      if (hash === -1) return line;
      const before = line.slice(0, hash);
      return before.includes("'") || before.includes('"') ? line : before;
    })
    .join('\n');
}

/**
 * Reduce a Python import name to an installable distribution name.
 *
 * Only the top-level segment matters (`a.b.c` -> `a`), stdlib is filtered,
 * and relative imports (`.mod`) return `undefined`.
 */
export function pythonPackageName(module: string): string | undefined {
  if (module.startsWith('.')) return undefined;
  const top = module.split('.')[0];
  if (top === undefined || top === '') return undefined;
  if (PYTHON_STDLIB.has(top)) return undefined;
  return top;
}

/** Strip a leading `./` and collapse `//`, without touching the filesystem. */
function normalizeRelPath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join('/');
}

/** Extensions probed when an import omits one (`./util` -> `util.ts`). */
const RESOLVE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
];

/**
 * Resolve a relative import to a repo-relative path present in `listing`.
 *
 * Returns `undefined` when the import escapes the repo root or matches no
 * listed file — the caller then reports it as a missing internal file rather
 * than guessing.
 */
export function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  listing: ReadonlySet<string>
): string | undefined {
  const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const raw = specifier.startsWith('/') ? specifier.slice(1) : `${fromDir}/${specifier}`;
  const joined = normalizeRelPath(raw);
  if (joined === '') return undefined;
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `${joined}${ext}`;
    if (listing.has(candidate)) return candidate;
  }
  return undefined;
}
