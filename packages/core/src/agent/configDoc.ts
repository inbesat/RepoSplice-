// P-152 — config document parsing, serialization, and safe key access.
//
// Every format is parsed into a plain value, mutated, and written back. The
// two hard requirements here are:
//
//  1. PROTOTYPE POLLUTION. `key` comes from a model, and a config file is
//     exactly the shape of input that gets a `__proto__` segment. Every
//     segment is checked against a denylist before it is used to index or
//     assign, and every object created during the walk uses a null prototype
//     so an inherited `Object.prototype` member can never be read as data.
//
//  2. STABLE JSONC COMMENT STRIPPING. P-152's handoff requires the strip to be
//     stable so user files are not corrupted. The stripper below is
//     string-aware: a `//` or `/* */` inside a JSON string literal is left
//     alone, which is the case a naive regex gets wrong.

import { ok, err, type Result } from 'neverthrow';
import { stitchErrorMessage, type StitchError } from '../result/index.js';
import { parseYaml, stringifyYaml } from '../util/yaml.js';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { ConfigFormat } from './types.js';

/** Segments that must never appear in a key path. */
const DANGEROUS_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** Detect the format from a file path's extension. */
export function detectConfigFormat(path: string): ConfigFormat | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return 'env';
  if (base.endsWith('.jsonc')) return 'jsonc';
  if (base.endsWith('.json')) return 'json';
  if (base.endsWith('.toml')) return 'toml';
  if (base.endsWith('.yaml') || base.endsWith('.yml')) return 'yaml';
  if (base.endsWith('.ini')) return 'ini';
  return undefined;
}

/**
 * Strip `//` and block comments from JSONC, preserving string literals.
 *
 * String-aware: a quote toggles in-string mode and `//` inside a string is
 * literal text, not a comment. A `\` escape is honored so `"a\\"` does not
 * leave the scanner in-string.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      // Preserve line count so reported line numbers stay meaningful.
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

/** Parse an INI/env document into a flat string map. */
function parseKeyValue(text: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === '') continue;
    out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Render a flat string map back to INI/env text, preserving comments/order. */
function stringifyKeyValue(original: string, value: Record<string, string>): string {
  const known = new Set(Object.keys(value));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of original.split('\n')) {
    const line = raw.trim();
    const eq =
      line === '' || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')
        ? -1
        : line.indexOf('=');
    if (eq === -1) {
      out.push(raw);
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (key === '' || !known.has(key)) {
      out.push(raw);
      continue;
    }
    seen.add(key);
    out.push(`${key}=${value[key] ?? ''}`);
  }
  // Keys that did not exist before are appended, so `set` on a new key works.
  for (const [key, v] of Object.entries(value)) {
    if (!seen.has(key)) out.push(`${key}=${v}`);
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function parseFailure(path: string, detail: string): StitchError {
  return { code: 'DEPS_PARSE_ERROR', file: path, message: `Cannot parse ${path}: ${detail}` };
}

/** Parse a config document by its format. */
export function parseConfig(
  path: string,
  format: ConfigFormat,
  text: string
): Result<unknown, StitchError> {
  switch (format) {
    case 'json':
    case 'jsonc': {
      try {
        return ok(JSON.parse(stripJsonComments(text)) as unknown);
      } catch (cause: unknown) {
        return err(parseFailure(path, cause instanceof Error ? cause.message : String(cause)));
      }
    }
    case 'toml': {
      try {
        return ok(parseToml(text) as unknown);
      } catch (cause: unknown) {
        return err(parseFailure(path, cause instanceof Error ? cause.message : String(cause)));
      }
    }
    case 'yaml': {
      const parsed = parseYaml<unknown>(text);
      return parsed.isErr() ? err(parseFailure(path, stitchErrorMessage(parsed.error))) : parsed;
    }
    case 'env':
    case 'ini':
      return ok(parseKeyValue(text));
  }
}

/** Serialize a config document back to text. */
export function serializeConfig(
  format: ConfigFormat,
  value: unknown,
  original: string
): Result<string, StitchError> {
  switch (format) {
    case 'json':
    case 'jsonc':
      return ok(`${JSON.stringify(value, null, 2)}\n`);
    case 'toml':
      try {
        return ok(stringifyToml(value as Record<string, unknown>));
      } catch (cause: unknown) {
        return err({
          code: 'DEPS_PARSE_ERROR',
          file: '<toml>',
          message: `Cannot serialize TOML: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    case 'yaml': {
      const text = stringifyYaml(value);
      return text.isErr()
        ? err({ code: 'DEPS_PARSE_ERROR', file: '<yaml>', message: stitchErrorMessage(text.error) })
        : ok(text.value);
    }
    case 'env':
    case 'ini':
      return ok(stringifyKeyValue(original, value as Record<string, string>));
  }
}

/** One `a.b["c.d"].e` step, already unquoted. */
export type KeySegment = string;

function dangerous(segment: string): boolean {
  return DANGEROUS_SEGMENTS.has(segment);
}

/**
 * Split a dot-path into segments, honoring `["quoted key"]` brackets.
 *
 * A segment may be written `a.b["c.d"].e`; the bracket form is how a key that
 * itself contains a dot or slash (e.g. the tsconfig alias `@app/*`) is
 * addressed. Malformed brackets are an error rather than a best-effort guess.
 */
export function parseKeyPath(key: string): Result<KeySegment[], StitchError> {
  if (key.trim() === '') {
    return err({ code: 'CONFIG_ERROR', field: 'key', message: 'Config key must not be empty' });
  }
  const segments: KeySegment[] = [];
  let buffer = '';
  let i = 0;
  const flush = (): void => {
    const trimmed = buffer.trim();
    if (trimmed !== '') segments.push(trimmed);
    buffer = '';
  };
  while (i < key.length) {
    const ch = key[i];
    if (ch === '.') {
      flush();
      i += 1;
      continue;
    }
    if (ch === '[') {
      flush();
      const close = key.indexOf(']', i + 1);
      if (close === -1) {
        return err({
          code: 'CONFIG_ERROR',
          field: 'key',
          message: `Unterminated bracket in config key: ${key}`,
        });
      }
      const inner = key.slice(i + 1, close).trim();
      const unquoted =
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
          ? inner.slice(1, -1)
          : inner;
      if (unquoted === '') {
        return err({
          code: 'CONFIG_ERROR',
          field: 'key',
          message: `Empty bracket segment in config key: ${key}`,
        });
      }
      segments.push(unquoted);
      i = close + 1;
      // Swallow an optional trailing dot: `a["b"].c` and `a["b"].c` variants.
      if (key[i] === '.') i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();
  if (segments.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'key',
      message: `Config key has no segments: ${key}`,
    });
  }
  return ok(segments);
}

/**
 * Reject prototype-polluting key paths.
 *
 * Checked once, up front, so no later code path has to remember to re-check.
 */
export function assertSafeKeyPath(
  segments: readonly KeySegment[],
  key: string
): Result<void, StitchError> {
  for (const segment of segments) {
    if (dangerous(segment)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'key',
        message: `Refusing to edit "${segment}" in config key "${key}": prototype-polluting segment`,
      });
    }
  }
  return ok(undefined);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a value at a key path, or `undefined` when any segment is absent. */
export function getAtPath(root: unknown, segments: readonly KeySegment[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(current)) return undefined;
    // Only own properties count, so an inherited Object.prototype member can
    // never be read back as data.
    if (!Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Return a NEW root with `value` written at `segments`.
 *
 * Non-mutating: every object on the path is rebuilt, so a failure part-way
 * through cannot leave the caller's document half-edited. Intermediate objects
 * use a null prototype so a `__proto__` key elsewhere in the tree is inert.
 */
export function setAtPath(
  root: unknown,
  segments: readonly KeySegment[],
  value: unknown
): Record<string, unknown> {
  const write = (node: unknown, index: number): unknown => {
    const base: Record<string, unknown> = isPlainObject(node)
      ? (Object.assign(Object.create(null) as Record<string, unknown>, node) as Record<
          string,
          unknown
        >)
      : (Object.create(null) as Record<string, unknown>);
    if (index >= segments.length) return value;
    const segment = segments[index];
    if (segment === undefined) return base;
    const child = Object.hasOwn(base, segment) ? base[segment] : undefined;
    base[segment] = write(child, index + 1);
    return base;
  };
  return write(root, 0) as Record<string, unknown>;
}

/** Return a NEW root with `segments` deleted. */
export function removeAtPath(
  root: unknown,
  segments: readonly KeySegment[]
): Record<string, unknown> {
  const write = (node: unknown, index: number): unknown => {
    if (!isPlainObject(node)) return node;
    const base = Object.assign(Object.create(null) as Record<string, unknown>, node) as Record<
      string,
      unknown
    >;
    if (index >= segments.length) return node;
    const segment = segments[index];
    if (segment === undefined) return base;
    if (!Object.hasOwn(base, segment)) return base;
    if (index === segments.length - 1) {
      delete base[segment];
      return base;
    }
    base[segment] = write(base[segment], index + 1);
    return base;
  };
  return write(root, 0) as Record<string, unknown>;
}

/** Deep-merge `patch` into `base` without clobbering untouched siblings. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = isPlainObject(base)
    ? (Object.assign(Object.create(null) as Record<string, unknown>, base) as Record<
        string,
        unknown
      >)
    : (Object.create(null) as Record<string, unknown>);
  for (const [key, value] of Object.entries(patch)) {
    if (dangerous(key)) continue;
    const existing = Object.hasOwn(out, key) ? out[key] : undefined;
    out[key] = isPlainObject(value) && isPlainObject(existing) ? deepMerge(existing, value) : value;
  }
  return out;
}
