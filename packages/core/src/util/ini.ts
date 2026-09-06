// INI parse/serialize helpers over `ini` (P-033).
//
// Config files like `git config`, `.npmrc`, and cargo config show up in
// merged repos (P-112/113 merge, P-103 ecosystem detection). `ini@7` is
// the parser; this module is the typed `Result` surface over it (P-011):
//
// - `parseIni<T>(text)` → nested object (dotted sections nest;
//   `key=value` pairs stay flat; `true`/`false`/`null` auto-convert,
//   numbers stay strings per `ini` semantics).
// - `stringifyIni(value)` → INI text.
//
// BEHAVIOR NOTE (spec deviation, documented): `ini` is a TOTAL parser
// over strings — unbalanced brackets (`[oops`) degrade to plain keys
// instead of throwing (verified empirically). So there is no
// "malformed string" err path to map; the only err is non-string input
// (defensive `typeof` guard — TS prevents it, JS callers might not)
// plus genuinely unserializable values for `stringifyIni` (`null`
// top-level throws TypeError). Git-config `[branch "main"]` subsections
// are preserved VERBATIM as flat keys (`branch "main"`) — only dotted
// sections (`[a.b.c]`) nest; P-112/113 post-processes if it needs the
// subsection split.

import { parse, stringify } from 'ini';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/** Plain-object shape of parsed INI (values nest arbitrarily). */
export type IniValue = Record<string, unknown>;

/**
 * Parse INI text into a nested object, typed as `T` by the caller.
 * Comments (`;`/`#` full-line) are stripped. Returns err(INTERNAL)
 * only for non-string input or an internal lib failure — unbalanced
 * syntax degrades gracefully per the behavior note above.
 */
export function parseIni<T = IniValue>(text: string): Result<T, StitchError> {
  try {
    if (typeof text !== 'string') {
      throw new TypeError(`parseIni expects a string, got ${typeof text}`);
    }
    return ok(parse(text) as T);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `parseIni failed: ${detail}` });
  }
}

/**
 * Serialize a plain object to INI text. Returns err(INTERNAL) for
 * unserializable input (`null`/non-object top level throws in `ini`).
 */
export function stringifyIni(value: IniValue): Result<string, StitchError> {
  try {
    return ok(stringify(value));
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({ code: 'INTERNAL', message: `stringifyIni failed: ${detail}` });
  }
}
