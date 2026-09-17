// Go `go.mod` parser (P-107): deterministic line-oriented parse for the Go
// ecosystem manifest. P-103's detector routes `go.mod` hits here; the
// `ParsedManifest` this returns feeds the P-108 union logic, which switches
// on `manifest.ecosystem`.
//
// Safety contract (P-011):
// - No throws: empty/missing content becomes `FILE_NOT_FOUND` (with the
//   path); a missing `module` line or structurally wrong directives become
//   `DEPS_PARSE_ERROR` (with the file + line number + reason).
// - Only the file path + module names + line numbers + validation messages
//   reach errors/logs, never file contents.
// - Exotic-but-tolerable directives (`toolchain`, `retract`, unknown
//   top-level words) are recorded with a `logger.warn` carrying file + line,
//   never file contents: one odd directive must not nuke a whole manifest
//   ("graceful" policy, matching P-105's include-skipping rule and P-106's
//   patch-as-warning rule).
//
// Wire-shape quirks owned here (never leaked):
// - CRLF line endings and a leading BOM are stripped before parsing.
// - Both single-line (`require a/b v1.0.0 // indirect`) and block
//   (`require ( ... )`) forms fold into one `require` map; `// indirect`
//   markers land in `indirect` (a `Set`), never in version strings.
// - `replace` (single + block) maps old module path -> new target string;
//   `exclude` (single + block) maps module path -> version.
// - `go 1.21` feeds `goVersion`; `toolchain` is warn-and-ignore;
//   `retract` (single + block) is warn-and-ignore (not merged in MVP).
// - Duplicate `require`/`replace`/`exclude` keys are last-wins with a
//   warning carrying file + line (cross-repo conflicts are P-108's job).
// - Absent `require` normalizes to `{}` for the merge logic; absent
//   `replace`/`exclude`/`indirect` stay absent (no empty maps/sets leak).

import { err, ok, type Result } from 'neverthrow';
import { logger } from '../../logger/index.js';
import type { StitchError } from '../../result/index.js';
import type { GoManifest, ParsedManifest } from '../types.js';

/** Block kinds the line state machine can be inside. */
type BlockKind = 'require' | 'replace' | 'exclude' | 'retract';

/** Split a line into code (before `//`) and comment (after `//`, if any). */
function splitComment(line: string): { code: string; comment: string } {
  const idx = line.indexOf('//');
  if (idx === -1) return { code: line.trim(), comment: '' };
  return { code: line.slice(0, idx).trim(), comment: line.slice(idx + 2).trim() };
}

/** True when a trailing comment marks a dependency as indirect. */
function isIndirectComment(comment: string): boolean {
  return comment.split(/\s+/).includes('indirect');
}

/** Code-unit sort (NOT locale-aware) for deterministic emit. */
function compareCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Strip a trailing `\r` (CRLF) and surrounding whitespace. */
function cleanLine(raw: string): string {
  return raw.endsWith('\r') ? raw.slice(0, -1).trim() : raw.trim();
}

/** Insert or last-wins overwrite a map entry, warning on overwrites. */
function setEntry(
  map: Record<string, string>,
  key: string,
  value: string,
  file: string,
  lineNo: number,
  section: string
): void {
  if (Object.hasOwn(map, key)) {
    logger.warn({ file, line: lineNo, section, package: key }, 'duplicate go.mod entry, last wins');
  }
  map[key] = value;
}

/**
 * Parse a single `require` code part (`<module> <version>`). Returns the
 * pair or undefined when the shape is wrong (caller maps to DEPS_PARSE_ERROR).
 */
function parseRequireCode(code: string): { mod: string; version: string } | undefined {
  const parts = code.split(/\s+/).filter(p => p.length > 0);
  if (parts.length !== 2) return undefined;
  const mod = parts[0];
  const version = parts[1];
  if (mod === undefined || version === undefined) return undefined;
  if (mod.length === 0 || version.length === 0) return undefined;
  return { mod, version };
}

/**
 * Parse a single `exclude` code part (`<module> <version>`). Same shape as
 * `require` without the indirect marker.
 */
function parseExcludeCode(code: string): { mod: string; version: string } | undefined {
  return parseRequireCode(code);
}

/**
 * Parse a `replace` code part (`<old> [<oldVer>] => <new> [<newVer>]`).
 * Returns the old module path (key) plus the new target string (value), or
 * undefined when the shape is wrong.
 */
function parseReplaceCode(code: string): { oldPath: string; newTarget: string } | undefined {
  const arrow = code.indexOf('=>');
  if (arrow === -1) return undefined;
  const left = code.slice(0, arrow).trim();
  const right = code.slice(arrow + 2).trim();
  if (left.length === 0 || right.length === 0) return undefined;
  const leftParts = left.split(/\s+/).filter(p => p.length > 0);
  const rightParts = right.split(/\s+/).filter(p => p.length > 0);
  const oldPath = leftParts[0];
  if (oldPath === undefined || oldPath.length === 0) return undefined;
  if (leftParts.length > 2 || rightParts.length === 0 || rightParts.length > 2) return undefined;
  const firstRight = rightParts[0];
  if (firstRight === undefined || firstRight.length === 0) return undefined;
  return { oldPath, newTarget: rightParts.join(' ') };
}

/** Mutable parse accumulator; frozen into a `GoManifest` at the end. */
interface GoAcc {
  module?: string;
  goVersion?: string;
  require: Record<string, string>;
  replace: Record<string, string>;
  exclude: Record<string, string>;
  indirect: Set<string>;
}

/**
 * Parse `go.mod` text into a normalized `ParsedManifest`.
 *
 * - Empty/whitespace-only `content` (caller read a missing file) ->
 *   `err(FILE_NOT_FOUND)` with `path`.
 * - Missing `module` directive, malformed directive shapes, or unclosed
 *   blocks -> `err(DEPS_PARSE_ERROR)` with `file` + 1-based line number.
 */
export function parseGoMod(content: string, filePath: string): Result<ParsedManifest, StitchError> {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return err({
      code: 'FILE_NOT_FOUND',
      path: filePath,
      message: `go.mod is missing or empty: ${filePath}`,
    });
  }

  const text = content.startsWith('﻿') ? content.slice(1) : content;
  const lines = text.split('\n');

  const acc: GoAcc = { require: {}, replace: {}, exclude: {}, indirect: new Set<string>() };
  let block: BlockKind | undefined;
  let blockStartLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const lineNo = i + 1;
    const line = cleanLine(rawLine);
    if (line.length === 0) continue;
    if (line.startsWith('//')) continue;

    // Inside a block: look for the closing paren first.
    if (block !== undefined) {
      const { code, comment } = splitComment(line);
      if (code === ')') {
        block = undefined;
        continue;
      }
      if (code.startsWith(')')) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `go.mod in ${filePath} at line ${lineNo}: unexpected content after ')'`,
        });
      }
      if (block === 'require') {
        const parsed = parseRequireCode(code);
        if (parsed === undefined) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `go.mod in ${filePath} at line ${lineNo}: malformed require entry, expected '<module> <version>'`,
          });
        }
        setEntry(acc.require, parsed.mod, parsed.version, filePath, lineNo, 'require');
        if (isIndirectComment(comment)) acc.indirect.add(parsed.mod);
        continue;
      }
      if (block === 'replace') {
        const parsed = parseReplaceCode(code);
        if (parsed === undefined) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `go.mod in ${filePath} at line ${lineNo}: malformed replace entry, expected '<old> => <new>'`,
          });
        }
        setEntry(acc.replace, parsed.oldPath, parsed.newTarget, filePath, lineNo, 'replace');
        continue;
      }
      if (block === 'exclude') {
        const parsed = parseExcludeCode(code);
        if (parsed === undefined) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `go.mod in ${filePath} at line ${lineNo}: malformed exclude entry, expected '<module> <version>'`,
          });
        }
        setEntry(acc.exclude, parsed.mod, parsed.version, filePath, lineNo, 'exclude');
        continue;
      }
      // Retract block: warn-and-ignore every entry (still validates closure).
      continue;
    }

    // Top-level: split off any trailing comment for indirect detection.
    const { code, comment } = splitComment(line);
    if (code.length === 0) continue;
    const firstSpace = code.search(/\s/);
    const directive = firstSpace === -1 ? code : code.slice(0, firstSpace);
    const rest = firstSpace === -1 ? '' : code.slice(firstSpace).trim();

    if (directive === 'module') {
      const parts = rest.split(/\s+/).filter(p => p.length > 0);
      if (parts.length !== 1 || parts[0] === undefined || parts[0].length === 0) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `go.mod in ${filePath} at line ${lineNo}: malformed module directive, expected 'module <path>'`,
        });
      }
      if (acc.module !== undefined) {
        logger.warn({ file: filePath, line: lineNo }, 'duplicate module directive, last wins');
      }
      acc.module = parts[0];
      continue;
    }

    if (directive === 'go') {
      const parts = rest.split(/\s+/).filter(p => p.length > 0);
      if (parts.length !== 1 || parts[0] === undefined || parts[0].length === 0) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `go.mod in ${filePath} at line ${lineNo}: malformed go directive, expected 'go <version>'`,
        });
      }
      if (acc.goVersion !== undefined) {
        logger.warn({ file: filePath, line: lineNo }, 'duplicate go directive, last wins');
      }
      acc.goVersion = parts[0];
      continue;
    }

    if (directive === 'toolchain') {
      logger.warn({ file: filePath, line: lineNo }, 'toolchain directive ignored in MVP');
      continue;
    }

    if (directive === 'retract') {
      if (rest === '(' || rest.startsWith('(')) {
        const after = rest.slice(1).trim();
        if (after.length !== 0) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `go.mod in ${filePath} at line ${lineNo}: unexpected content after 'retract ('`,
          });
        }
        block = 'retract';
        blockStartLine = lineNo;
        logger.warn({ file: filePath, line: lineNo }, 'retract block ignored in MVP');
      } else {
        logger.warn({ file: filePath, line: lineNo }, 'retract directive ignored in MVP');
      }
      continue;
    }

    if (directive === 'require') {
      if (rest === '(' || rest.startsWith('(')) {
        const after = rest.slice(1).trim();
        if (after.length !== 0) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `go.mod in ${filePath} at line ${lineNo}: unexpected content after 'require ('`,
          });
        }
        block = 'require';
        blockStartLine = lineNo;
        continue;
      }
      const parsed = parseRequireCode(rest);
      if (parsed === undefined) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `go.mod in ${filePath} at line ${lineNo}: malformed require directive, expected 'require <module> <version>'`,
        });
      }
      setEntry(acc.require, parsed.mod, parsed.version, filePath, lineNo, 'require');
      if (isIndirectComment(comment)) acc.indirect.add(parsed.mod);
      continue;
    }

    if (directive === 'replace') {
      if (rest === '(' || rest.startsWith('(')) {
        const after = rest.slice(1).trim();
        if (after.length !== 0) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `go.mod in ${filePath} at line ${lineNo}: unexpected content after 'replace ('`,
          });
        }
        block = 'replace';
        blockStartLine = lineNo;
        continue;
      }
      const parsed = parseReplaceCode(rest);
      if (parsed === undefined) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `go.mod in ${filePath} at line ${lineNo}: malformed replace directive, expected '<old> => <new>'`,
        });
      }
      setEntry(acc.replace, parsed.oldPath, parsed.newTarget, filePath, lineNo, 'replace');
      continue;
    }

    if (directive === 'exclude') {
      if (rest === '(' || rest.startsWith('(')) {
        const after = rest.slice(1).trim();
        if (after.length !== 0) {
          return err({
            code: 'DEPS_PARSE_ERROR',
            file: filePath,
            message: `go.mod in ${filePath} at line ${lineNo}: unexpected content after 'exclude ('`,
          });
        }
        block = 'exclude';
        blockStartLine = lineNo;
        continue;
      }
      const parsed = parseExcludeCode(rest);
      if (parsed === undefined) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: filePath,
          message: `go.mod in ${filePath} at line ${lineNo}: malformed exclude directive, expected 'exclude <module> <version>'`,
        });
      }
      setEntry(acc.exclude, parsed.mod, parsed.version, filePath, lineNo, 'exclude');
      continue;
    }

    logger.warn({ file: filePath, line: lineNo, directive }, 'unknown go.mod directive, skipped');
  }

  if (block !== undefined) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `go.mod in ${filePath} at line ${blockStartLine}: unclosed '${block}' block, expected ')'`,
    });
  }

  if (acc.module === undefined) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: filePath,
      message: `go.mod in ${filePath} is missing the required 'module' directive`,
    });
  }

  const manifest: GoManifest = { module: acc.module, require: { ...acc.require } };
  if (acc.goVersion !== undefined) manifest.goVersion = acc.goVersion;
  if (Object.keys(acc.replace).length > 0) manifest.replace = { ...acc.replace };
  if (Object.keys(acc.exclude).length > 0) manifest.exclude = { ...acc.exclude };
  if (acc.indirect.size > 0) manifest.indirect = new Set(acc.indirect);
  return ok({ ecosystem: 'go', manifest, path: filePath });
}

/**
 * Serialize a `GoManifest` back to `go.mod` text in `go fmt` style: `module`
 * first, `go` second, then a sorted `require` block (one entry per line,
 * `// indirect` suffix where applicable), then sorted `replace`/`exclude`
 * sections (single line when one entry, block when several). The output
 * ends with a trailing newline; `parse(serialize(parse(x)))` is a fixed
 * point modulo comment placement and blank lines.
 */
export function serializeGoMod(manifest: GoManifest): string {
  const out: string[] = [];
  out.push(`module ${manifest.module}`);
  out.push('');
  if (manifest.goVersion !== undefined) {
    out.push(`go ${manifest.goVersion}`);
    out.push('');
  }
  const requireKeys = Object.keys(manifest.require).sort(compareCodeUnit);
  const singleRequire = requireKeys[0];
  if (requireKeys.length === 1 && singleRequire !== undefined) {
    const mod: string = singleRequire;
    const version = manifest.require[mod];
    if (version !== undefined) {
      const suffix =
        manifest.indirect !== undefined && manifest.indirect.has(mod) ? ' // indirect' : '';
      out.push(`require ${mod} ${version}${suffix}`);
      out.push('');
    }
  } else if (requireKeys.length > 1) {
    out.push('require (');
    for (const mod of requireKeys) {
      const version = manifest.require[mod];
      if (version === undefined) continue;
      const suffix =
        manifest.indirect !== undefined && manifest.indirect.has(mod) ? ' // indirect' : '';
      out.push(`\t${mod} ${version}${suffix}`);
    }
    out.push(')');
    out.push('');
  }
  const replaceKeys =
    manifest.replace !== undefined ? Object.keys(manifest.replace).sort(compareCodeUnit) : [];
  if (replaceKeys.length === 1) {
    const oldPath = replaceKeys[0];
    if (oldPath !== undefined) {
      const target = manifest.replace?.[oldPath];
      if (target !== undefined) {
        out.push(`replace ${oldPath} => ${target}`);
        out.push('');
      }
    }
  } else if (replaceKeys.length > 1) {
    out.push('replace (');
    for (const oldPath of replaceKeys) {
      const target = manifest.replace?.[oldPath];
      if (target === undefined) continue;
      out.push(`\t${oldPath} => ${target}`);
    }
    out.push(')');
    out.push('');
  }
  const excludeKeys =
    manifest.exclude !== undefined ? Object.keys(manifest.exclude).sort(compareCodeUnit) : [];
  if (excludeKeys.length === 1) {
    const mod = excludeKeys[0];
    if (mod !== undefined) {
      const version = manifest.exclude?.[mod];
      if (version !== undefined) {
        out.push(`exclude ${mod} ${version}`);
        out.push('');
      }
    }
  } else if (excludeKeys.length > 1) {
    out.push('exclude (');
    for (const mod of excludeKeys) {
      const version = manifest.exclude?.[mod];
      if (version === undefined) continue;
      out.push(`\t${mod} ${version}`);
    }
    out.push(')');
    out.push('');
  }
  // Drop the trailing blank line, keep exactly one trailing newline.
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return `${out.join('\n')}\n`;
}
