// Minimal type shim for picomatch v4 (no upstream .d.ts; @types/picomatch
// is for v2 with the stale `ignore` option name). Covers the surface this
// codebase uses: single/array patterns, dot/gitignore flags, and the
// `ignore` exclusion option (all verified empirically against v4.0.7).
declare module 'picomatch' {
  export interface PicomatchOptions {
    dot?: boolean;
    gitignore?: boolean;
    posix?: boolean;
    contains?: boolean;
    nocase?: boolean;
    basename?: boolean;
    debug?: boolean;
    capture?: boolean;
    /** Exclusion pattern(s) applied on top of the main match. */
    ignore?: string | readonly string[];
  }
  export interface Matcher {
    (test: string): boolean;
  }
  function picomatch(glob: string | readonly string[], options?: PicomatchOptions): Matcher;
  export default picomatch;
}
