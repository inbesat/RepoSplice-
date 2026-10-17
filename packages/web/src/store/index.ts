// P-215 — the store umbrella: all slices, shared types, and the derived
// selectors re-exported from one entry point, so screens import from
// '../store/index.js' and never wire slices by hand. The slice modules stay
// importable directly (P-210/P-211/P-212 tests and pages still do).
//
// Reconciliation note: the spec names `sources.ts` and `selection.ts` as
// separate slices, but sources+selection have lived in `selection.ts` since
// P-212 (sources.ts is its re-export shim) — the barrel exports selection.js
// once; re-exporting sources.js too would collide on the same names.

export * from './types.js';
export * from './selection.js';
export * from './flow.js';
export * from './run.js';
export * from './deps.js';
export * from './selectors.js';
