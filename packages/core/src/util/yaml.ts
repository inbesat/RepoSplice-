// YAML parse/serialize helpers over `yaml` (P-032).
//
// Manifests are YAML everywhere here: `docker-compose.yml`,
// `.github/workflows/*.yml`, stitch manifests (P-200), structured AI
// output. `yaml@2` is the parser; this module is the typed `Result`
// surface over it (P-011):
//
// - `parseYaml<T>(text)` → plain-JS value (syntax errors → err).
// - `parseYamlDocument(text)` → comment-preserving `Document` for
//   round-trips that must keep comments/formatting (P-112/113 merge).
// - `stringifyYaml(value)` → YAML text (unserializable → err).
//
// Malformed input maps to err(INTERNAL) with the parser's line/col
// detail — same convention as P-024 `parseExpr` for syntax failures.

import {
  parse,
  parseDocument,
  stringify,
  Document,
  YAMLError,
  type ParseOptions,
  type DocumentOptions,
  type ToStringOptions,
} from 'yaml';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/** Map a `yaml` throw to a typed err with line/col detail when present. */
function yamlError(cause: unknown, context: string): StitchError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { code: 'INTERNAL', message: `${context}: ${detail}` };
}

/**
 * Parse YAML text into a plain-JS value, typed as `T` by the caller.
 * Returns err(INTERNAL) on syntax errors (message carries the
 * parser's line/column detail). Empty/blank input parses to `null`
 * (matching `yaml` semantics) — callers wanting an object should
 * narrow with a Zod schema (P-009) afterwards.
 */
export function parseYaml<T = unknown>(
  text: string,
  options?: ParseOptions & DocumentOptions
): Result<T, StitchError> {
  try {
    return ok(parse(text, options) as T);
  } catch (cause: unknown) {
    return err(yamlError(cause, 'parseYaml failed'));
  }
}

/**
 * Parse YAML text into a `Document` — the comment- and style-preserving
 * representation. Edit via `doc.set()`/`doc.get()`, render with
 * `doc.toString()`. Used by the P-112/113 config merge that must not
 * strip user comments.
 *
 * NOTE: unlike `parse`, `parseDocument` never throws for syntax errors
 * — it attaches them to `doc.errors`. This wrapper promotes a
 * non-empty `errors` list to err(INTERNAL) (first error's message), so
 * callers get the same fail-fast contract as `parseYaml`.
 */
export function parseYamlDocument(
  text: string,
  options?: ParseOptions & DocumentOptions
): Result<Document, StitchError> {
  try {
    const doc = parseDocument(text, options);
    const first = doc.errors[0];
    if (first !== undefined) {
      return err(yamlError(first, 'parseYamlDocument failed'));
    }
    return ok(doc);
  } catch (cause: unknown) {
    return err(yamlError(cause, 'parseYamlDocument failed'));
  }
}

/**
 * Serialize a plain-JS value to YAML text. Returns err(INTERNAL) for
 * unserializable input (circular refs, functions-as-values, BigInt
 * without a custom tag, …).
 */
export function stringifyYaml(
  value: unknown,
  options?: ToStringOptions
): Result<string, StitchError> {
  try {
    return ok(stringify(value, options));
  } catch (cause: unknown) {
    return err(yamlError(cause, 'stringifyYaml failed'));
  }
}

// Re-export the `Document` class + error types P-112/113 need for
// `instanceof` checks and typed signatures (AGENTS import rule: depend
// on the core barrel, not the vendor package).
export { Document, YAMLError };
export type { ParseOptions, DocumentOptions, ToStringOptions };
