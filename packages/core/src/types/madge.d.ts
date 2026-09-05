// Minimal type shim for `madge` v8 (no upstream .d.ts; the lib ships JS
// only — `@types/madge` is not on npm). We use the same subset of the
// public API as `src/analysis/circular.ts`.
declare module 'madge' {
  export interface MadgeConfig {
    baseDir?: string | null;
    fileExtensions?: string[];
    includeNpm?: boolean;
    requireConfig?: string | null;
    webpackConfig?: string | null;
    tsConfig?: string | null;
    excludeRegExp?: string | boolean;
  }

  // The `madge` default export is a *factory function* (not a class):
  //   const instance = await madge(root, config);
  // It returns a Promise<MadgeInstance> on the path/branches and
  // synchronously returns a pre-populated instance when given a tree
  // object. We model the union via overloads.
  export interface MadgeInstance {
    obj(): Record<string, string[]>;
    circular(): string[][];
    warnings(): { skipped: string[] };
  }

  export default function madge(
    path: string | string[] | object,
    config?: MadgeConfig
  ): Promise<MadgeInstance> | MadgeInstance;
}
