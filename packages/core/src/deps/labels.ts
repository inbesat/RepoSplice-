// Positional source labels shared by the deps merge taxonomy (P-108) and
// the peer analysis (P-110). Lived in merge.ts until P-110 needed it from
// peer.ts too — moving it here keeps the merge↔peer import graph acyclic
// (a deliberate cycle would be debt the P-021/P-022 cycle tooling exists
// to catch); merge.ts re-exports the helper so the public barrel surface
// (`export { sourceLabel } from './merge.js'`) is unchanged.
//
// Source labels: dep-merge inputs have no repo names (only file paths), so
// conflicts are keyed by positional labels `repo-a`, `repo-b`, ... in input
// order (spreadsheet-style past `repo-z`: `repo-aa`, ...). Deterministic for
// any input order; P-116/P-219 render these labels directly.

/** Positional source label for input `index`: `repo-a`, `repo-b`, ... */
export function sourceLabel(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(97 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `repo-${letters}`;
}
