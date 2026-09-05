// Minimal type shim for picomatch v4 (no upstream .d.ts; @types/picomatch
// is for v2 with the stale `ignore` option name). We only use a small
// subset of options in this codebase.
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
  }
  export interface Matcher {
    (test: string): boolean;
  }
  function picomatch(glob: string, options?: PicomatchOptions): Matcher;
  export default picomatch;
}
