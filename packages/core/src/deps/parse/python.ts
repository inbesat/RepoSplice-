// Python manifest parsers (P-105): legacy `requirements.txt` (pip) and
// modern `pyproject.toml` (PEP 621 `[project]`, Poetry
// `[tool.poetry.*]`, uv `[tool.uv.*]` + PEP 735 `[dependency-groups]`),
// unified into one `PythonManifest` for the P-108 union logic. P-103's
// detector routes `requirements*.txt` / `pyproject.toml` hits here via
// `parsePythonManifest`, which dispatches on the file basename.
//
// Safety contract (P-011):
// - No throws: TOML syntax failures become `DEPS_PARSE_ERROR` (with file +
//   parser line/column); empty content becomes `FILE_NOT_FOUND`;
//   structurally wrong values in canonical positions (non-string entries
//   in `[project].dependencies`) become `DEPS_PARSE_ERROR` with a field
//   path. Exotic-but-tolerable lines (pip `-r`/`-c`/`-e` options,
//   unparseable requirement lines, unknown Poetry/uv table shapes) are
//   skipped with a `logger.warn` carrying file + line number, never file
//   contents: one odd line must not nuke a whole manifest ("graceful"
//   policy, matching the spec's include-skipping rule).
// - Deduplication is last-wins with a warning (line numbers included).
// - Only paths, package names, line numbers, and counts reach errors and
//   logs, never file contents or requirement bodies.
//
// Wire-shape quirks owned here (never leaked):
// - `#` comments: full-line plus trailing ` #...` (a `#` WITHOUT
//   preceding whitespace is a URL fragment like `#egg=name` and is kept).
// - `;` environment markers stay inside the version-spec string (no data
//   loss: the manifest has no marker field).
// - `name[extra]==spec` extras merge into `extras[name]` (deduped).
// - `name @ url` direct references, Poetry `{ git/url/path = ... }`
//   tables, and uv `{ git/url = ... }` sources record `urls[name]` with
//   the spec normalized to `'*'`.
// - Poetry `python = "..."` feeds `pythonVersion` only when PEP 621
//   `requires-python` is absent (canonical source wins).
// - `[project].optional-dependencies` merge into `dependencies` (they
//   constrain the resolve) with raw strings kept in `extras[group]`;
//   `[dependency-groups]` and Poetry dev groups merge into
//   `devDependencies`.
// - `source` precedence: poetry tables > `[tool.uv]` markers > plain PEP
//   621; requirements basenames containing `dev` (case-insensitive, e.g.
//   `requirements-dev.txt`) fill `devDependencies` instead of
//   `dependencies`.

import { basename } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import { TomlError, parse as parseToml } from 'smol-toml';
import { logger } from '../../logger/index.js';
import type { StitchError } from '../../result/index.js';
import type { ParsedManifest, PythonManifest } from '../types.js';

/** `typeof v === 'object'` minus `null` minus arrays: a TOML/JSON table. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A single classified requirements-file line. */
type ReqLine =
  | { kind: 'blank' }
  | { kind: 'option'; directive: string }
  | { kind: 'req'; name: string; extras: string[]; spec: string; url?: string }
  | { kind: 'unparseable' };

const REQ_NAME = '[A-Za-z0-9_.-]+';
const VERSION_SPEC = new RegExp(`^(${REQ_NAME})(?:\\[([^\\]]+)\\])?\\s*([=<>!~]+.*)?$`);
const DIRECT_REF = new RegExp(`^(${REQ_NAME})\\s*@\\s*(.+)$`);

/**
 * Strip a trailing ` # comment` (whitespace before `#` required, so URL
 * fragments like `#egg=name` survive), then trim. Full-line comments are
 * filtered by the caller before this runs.
 */
function stripInlineComment(line: string): string {
  const hash = line.search(/\s+#/);
  return (hash === -1 ? line : line.slice(0, hash)).trim();
}

/**
 * Classify one raw requirements line (1-based `lineNo` is for logs only).
 * Never throws; unparseable content is a value, not an exception.
 */
function classifyReqLine(raw: string): ReqLine {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return { kind: 'blank' };
  if (trimmed.startsWith('-')) {
    const space = trimmed.search(/\s/);
    return { kind: 'option', directive: space === -1 ? trimmed : trimmed.slice(0, space) };
  }
  const line = stripInlineComment(trimmed);
  if (line.length === 0) return { kind: 'blank' };

  const direct = DIRECT_REF.exec(line);
  if (direct !== null) {
    const name = direct[1];
    const url = direct[2];
    if (name !== undefined && url !== undefined && url.trim().length > 0) {
      return { kind: 'req', name, extras: [], spec: '*', url: url.trim() };
    }
    return { kind: 'unparseable' };
  }

  const m = VERSION_SPEC.exec(line);
  if (m === null) return { kind: 'unparseable' };
  const name = m[1];
  if (name === undefined) return { kind: 'unparseable' };
  const extrasRaw = m[2];
  const extras =
    extrasRaw !== undefined && extrasRaw.length > 0
      ? extrasRaw
          .split(',')
          .map(e => e.trim())
          .filter(e => e.length > 0)
      : [];
  const specRaw = m[3];
  return { kind: 'req', name, extras, spec: specRaw !== undefined ? specRaw.trim() : '*' };
}

/** Mutable parse accumulator; frozen into a `PythonManifest` at the end. */
interface PythonAcc {
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  extras: Record<string, string[]>;
  urls: Record<string, string>;
  pythonVersion?: string;
}

/** Insert or last-wins overwrite a dependency, warning on overwrites. */
function setDep(
  map: Record<string, string>,
  name: string,
  spec: string,
  file: string,
  lineNo: number
): void {
  if (Object.hasOwn(map, name)) {
    logger.warn({ file, line: lineNo, package: name }, 'duplicate dependency, last wins');
  }
  map[name] = spec;
}

/** Merge extra names into `extras[name]`, deduped, order-preserving. */
function addExtras(acc: PythonAcc, name: string, extras: readonly string[]): void {
  if (extras.length === 0) return;
  const existing = acc.extras[name];
  const merged = existing !== undefined ? [...existing] : [];
  for (const e of extras) {
    if (!merged.includes(e)) merged.push(e);
  }
  acc.extras[name] = merged;
}

/**
 * Fold one PEP 508 requirement string (from either file kind) into the
 * accumulator. `target` selects the dependency map; `lineNo` of 0 means
 * "from pyproject" (no meaningful line number available post-TOML-parse).
 */
function foldRequirement(
  acc: PythonAcc,
  reqText: string,
  target: 'deps' | 'devDeps',
  file: string,
  lineNo: number
): void {
  const parsed = classifyReqLine(reqText);
  if (parsed.kind === 'blank') return;
  if (parsed.kind === 'option') {
    logger.warn(
      { file, line: lineNo, directive: parsed.directive },
      'pip option inside manifest entry, skipped'
    );
    return;
  }
  if (parsed.kind === 'unparseable') {
    logger.warn({ file, line: lineNo }, 'unparseable requirement entry, skipped');
    return;
  }
  const map = target === 'deps' ? acc.deps : acc.devDeps;
  setDep(map, parsed.name, parsed.spec, file, lineNo);
  addExtras(acc, parsed.name, parsed.extras);
  if (parsed.url !== undefined) acc.urls[parsed.name] = parsed.url;
}

/** Freeze an accumulator into the normalized manifest (empty maps dropped). */
function freezeAcc(acc: PythonAcc, source: PythonManifest['source'], dev: boolean): PythonManifest {
  const manifest: PythonManifest = { dependencies: {}, source };
  const primary = dev ? acc.devDeps : acc.deps;
  const secondary = dev ? acc.deps : acc.devDeps;
  for (const [name, spec] of Object.entries(primary)) manifest.dependencies[name] = spec;
  if (Object.keys(secondary).length > 0) {
    manifest.devDependencies = {};
    for (const [name, spec] of Object.entries(secondary)) {
      const devDeps = manifest.devDependencies;
      if (devDeps !== undefined) devDeps[name] = spec;
    }
  }
  if (Object.keys(acc.extras).length > 0) {
    manifest.extras = {};
    for (const [name, list] of Object.entries(acc.extras)) {
      const extras = manifest.extras;
      if (extras !== undefined) extras[name] = [...list];
    }
  }
  if (acc.pythonVersion !== undefined) manifest.pythonVersion = acc.pythonVersion;
  if (Object.keys(acc.urls).length > 0) {
    manifest.urls = {};
    for (const [name, url] of Object.entries(acc.urls)) {
      const urls = manifest.urls;
      if (urls !== undefined) urls[name] = url;
    }
  }
  return manifest;
}

/**
 * Parse `requirements.txt` content (any `requirements*.txt` basename; a
 * basename containing `dev` fills `devDependencies`). Empty content is
 * `FILE_NOT_FOUND` (caller read a missing file); comment-only files are
 * valid and yield empty dependencies.
 */
export function parseRequirementsTxt(
  content: string,
  filePath: string
): Result<PythonManifest, StitchError> {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return err({
      code: 'FILE_NOT_FOUND',
      path: filePath,
      message: `requirements file is missing or empty: ${filePath}`,
    });
  }
  const base = basename(filePath).toLowerCase();
  const acc: PythonAcc = { deps: {}, devDeps: {}, extras: {}, urls: {} };
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const parsed = classifyReqLine(raw);
    if (parsed.kind === 'blank') continue;
    if (parsed.kind === 'option') {
      logger.warn(
        { file: filePath, line: i + 1, directive: parsed.directive },
        'pip include/option skipped'
      );
      continue;
    }
    if (parsed.kind === 'unparseable') {
      logger.warn({ file: filePath, line: i + 1 }, 'unparseable requirement line, skipped');
      continue;
    }
    // Requirements-file entries always target the primary map; `freezeAcc`
    // routes it to deps vs devDeps by basename.
    setDep(acc.deps, parsed.name, parsed.spec, filePath, i + 1);
    addExtras(acc, parsed.name, parsed.extras);
    if (parsed.url !== undefined) acc.urls[parsed.name] = parsed.url;
  }
  return ok(freezeAcc(acc, 'requirements.txt', base.includes('dev')));
}

/** Read an optional string field off a TOML table. */
function strField(table: Record<string, unknown>, key: string): string | undefined {
  const v = table[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Parse one Poetry `{ version, extras, git, url, path }` inline table (or a
 * bare version string) into spec + extras + url. Non-conforming values are
 * skipped with a warning; the return is undefined only for `undefined`
 * input (absent key), never for present-but-odd input.
 */
function parsePoetryEntry(
  value: unknown,
  name: string,
  file: string
): { spec: string; extras: string[]; url?: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return { spec: value, extras: [] };
  if (!isRecord(value)) {
    logger.warn({ file, package: name }, 'poetry entry has unexpected shape, skipped');
    return { spec: '*', extras: [] };
  }
  const version = strField(value, 'version');
  const extrasRaw = value['extras'];
  const extras =
    Array.isArray(extrasRaw) && extrasRaw.every(e => typeof e === 'string') ? [...extrasRaw] : [];
  const git = strField(value, 'git');
  const url = strField(value, 'url');
  const remote = git ?? url;
  // `{ path = ... }` (and anything else unrecognized): local/unknown
  // provenance, dependency still counts with a wildcard spec.
  return { spec: version ?? '*', extras, ...(remote !== undefined ? { url: remote } : {}) };
}

/** Fold a Poetry dependencies table into the target map. */
function foldPoetryTable(
  acc: PythonAcc,
  table: Record<string, unknown>,
  target: 'deps' | 'devDeps',
  file: string
): void {
  for (const [name, value] of Object.entries(table)) {
    if (name === 'python') {
      if (typeof value === 'string' && acc.pythonVersion === undefined) {
        acc.pythonVersion = value;
      }
      continue;
    }
    const entry = parsePoetryEntry(value, name, file);
    if (entry === undefined) continue;
    const map = target === 'deps' ? acc.deps : acc.devDeps;
    setDep(map, name, entry.spec, file, 0);
    addExtras(acc, name, entry.extras);
    if (entry.url !== undefined) acc.urls[name] = entry.url;
  }
}

/**
 * Parse `pyproject.toml` content: PEP 621 `[project]`, Poetry
 * `[tool.poetry.*]`, PEP 735 `[dependency-groups]`, and uv
 * `[tool.uv.sources]` markers. Malformed TOML is `DEPS_PARSE_ERROR` with
 * the parser's line/column; structurally wrong values in canonical
 * positions are `DEPS_PARSE_ERROR` with a field path.
 */
export function parsePyprojectToml(
  content: string,
  filePath: string
): Result<PythonManifest, StitchError> {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return err({
      code: 'FILE_NOT_FOUND',
      path: filePath,
      message: `pyproject.toml is missing or empty: ${filePath}`,
    });
  }

  let root: Record<string, unknown>;
  try {
    root = parseToml(content) as Record<string, unknown>;
  } catch (cause: unknown) {
    if (cause instanceof TomlError) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `invalid TOML in ${filePath} at line ${cause.line}, column ${cause.column}: ${cause.message}`,
      });
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `invalid TOML in ${filePath}: ${detail}`,
    });
  }
  if (!isRecord(root)) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `pyproject.toml in ${filePath} must be a TOML table`,
    });
  }

  const acc: PythonAcc = { deps: {}, devDeps: {}, extras: {}, urls: {} };
  let source: PythonManifest['source'] = 'pyproject.toml';

  const project = root['project'];
  if (project !== undefined) {
    if (!isRecord(project)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `pyproject.toml in ${filePath}: [project] must be a table`,
      });
    }
    const requiresPython = strField(project, 'requires-python');
    if (requiresPython !== undefined) acc.pythonVersion = requiresPython;

    const deps = project['dependencies'];
    if (deps !== undefined) {
      if (!Array.isArray(deps) || !deps.every(d => typeof d === 'string')) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `pyproject.toml in ${filePath}: [project].dependencies must be an array of strings`,
        });
      }
      for (const req of deps) foldRequirement(acc, req, 'deps', filePath, 0);
    }

    const optional = project['optional-dependencies'];
    if (optional !== undefined) {
      if (!isRecord(optional)) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `pyproject.toml in ${filePath}: [project.optional-dependencies] must be a table`,
        });
      }
      for (const [group, reqs] of Object.entries(optional)) {
        if (!Array.isArray(reqs) || !reqs.every(r => typeof r === 'string')) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `pyproject.toml in ${filePath}: optional-dependencies group '${group}' must be an array of strings`,
          });
        }
        for (const req of reqs) foldRequirement(acc, req, 'deps', filePath, 0);
        const raw: string[] = [...reqs];
        const existing = acc.extras[group];
        acc.extras[group] = existing !== undefined ? [...existing, ...raw] : raw;
      }
    }
  }

  const depGroups = root['dependency-groups'];
  if (depGroups !== undefined) {
    if (!isRecord(depGroups)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `pyproject.toml in ${filePath}: [dependency-groups] must be a table`,
      });
    }
    for (const [group, reqs] of Object.entries(depGroups)) {
      if (!Array.isArray(reqs) || !reqs.every(r => typeof r === 'string')) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `pyproject.toml in ${filePath}: dependency group '${group}' must be an array of strings`,
        });
      }
      for (const req of reqs) foldRequirement(acc, req, 'devDeps', filePath, 0);
    }
  }

  const tool = root['tool'];
  const toolRecord = isRecord(tool) ? tool : undefined;

  const poetry = toolRecord !== undefined ? toolRecord['poetry'] : undefined;
  if (poetry !== undefined) {
    if (!isRecord(poetry)) {
      return err({
        code: 'DEPS_PARSE_ERROR',
        file: filePath,
        message: `pyproject.toml in ${filePath}: [tool.poetry] must be a table`,
      });
    }
    source = 'poetry';
    const deps = poetry['dependencies'];
    if (deps !== undefined) {
      if (!isRecord(deps)) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `pyproject.toml in ${filePath}: [tool.poetry.dependencies] must be a table`,
        });
      }
      foldPoetryTable(acc, deps, 'deps', filePath);
    }
    const group = poetry['group'];
    if (group !== undefined) {
      if (!isRecord(group)) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `pyproject.toml in ${filePath}: [tool.poetry.group] must be a table`,
        });
      }
      for (const [groupName, groupTable] of Object.entries(group)) {
        if (!isRecord(groupTable)) {
          logger.warn(
            { file: filePath, group: groupName },
            'poetry group has unexpected shape, skipped'
          );
          continue;
        }
        const groupDeps = groupTable['dependencies'];
        if (groupDeps === undefined) continue;
        if (!isRecord(groupDeps)) {
          logger.warn(
            { file: filePath, group: groupName },
            'poetry group dependencies not a table, skipped'
          );
          continue;
        }
        // The main group holds runtime deps; every other group is dev.
        foldPoetryTable(acc, groupDeps, groupName === 'main' ? 'deps' : 'devDeps', filePath);
      }
    }
    const poetryExtras = poetry['extras'];
    if (poetryExtras !== undefined) {
      if (!isRecord(poetryExtras)) {
        logger.warn({ file: filePath }, '[tool.poetry.extras] not a table, skipped');
      } else {
        for (const [group, members] of Object.entries(poetryExtras)) {
          if (Array.isArray(members) && members.every(m => typeof m === 'string')) {
            const existing = acc.extras[group];
            const fresh: string[] = [...members];
            acc.extras[group] = existing !== undefined ? [...existing, ...fresh] : fresh;
          } else {
            logger.warn({ file: filePath, group }, 'poetry extras group malformed, skipped');
          }
        }
      }
    }
  }

  const uv = toolRecord !== undefined ? toolRecord['uv'] : undefined;
  if (uv !== undefined) {
    if (source === 'pyproject.toml') source = 'uv';
    if (isRecord(uv)) {
      const sources = uv['sources'];
      if (sources !== undefined) {
        if (!isRecord(sources)) {
          logger.warn({ file: filePath }, '[tool.uv.sources] not a table, skipped');
        } else {
          for (const [name, entry] of Object.entries(sources)) {
            if (!isRecord(entry)) continue;
            const remote = strField(entry, 'git') ?? strField(entry, 'url');
            if (remote !== undefined && acc.urls[name] === undefined) {
              acc.urls[name] = remote;
              if (!Object.hasOwn(acc.deps, name) && !Object.hasOwn(acc.devDeps, name)) {
                acc.deps[name] = '*';
              }
            }
          }
        }
      }
    }
  }

  return ok(freezeAcc(acc, source, false));
}

/**
 * Dispatcher: route Python manifest text by file basename
 * (`requirements*.txt` -> requirements parser, `pyproject.toml` ->
 * pyproject parser). Anything else is a caller routing bug ->
 * `DEPS_PARSE_ERROR`. Mirrors P-103's `classifyManifest` so the detector
 * and the parser never disagree on which files are Python manifests.
 */
export function parsePythonManifest(
  filePath: string,
  content: string
): Result<ParsedManifest, StitchError> {
  const base = basename(filePath);
  if (base === 'pyproject.toml') {
    const r = parsePyprojectToml(content, filePath);
    if (r.isErr()) return err(r.error);
    return ok({ ecosystem: 'python', manifest: r.value, path: filePath });
  }
  if (base.startsWith('requirements') && base.endsWith('.txt')) {
    const r = parseRequirementsTxt(content, filePath);
    if (r.isErr()) return err(r.error);
    return ok({ ecosystem: 'python', manifest: r.value, path: filePath });
  }
  return err({
    code: 'DEPS_PARSE_ERROR',
    file: filePath,
    message: `unsupported python manifest: ${base}`,
  });
}
