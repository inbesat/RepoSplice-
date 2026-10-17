import { CORE_NAME } from '@repo-stitcher/core';

export const CLI_NAME = '@repo-stitcher/cli';
export { CORE_NAME };
import { fileURLToPath } from 'node:url';
// Imported (not just re-exported): a `export … from` does not create a local binding,
// and the direct-invocation guard below needs to call it.
import { main } from './cli.js';
export { createProgram, STITCH_VERSION } from './program.js';
// P-194 — the status dashboard (the program.ts scaffold is gone; this is the command).
export { status, RECENT_AUDIT_LIMIT } from './commands/status.js';
export type {
  StatusOptions,
  StatusReport,
  StatusDeps,
  StatusSourceRow,
  ChecksumVerdict,
} from './commands/status.js';

// P-189 — the CLI shell: global options, exit-code convention, error mapping.
export {
  buildCLI,
  classifyCommanderError,
  exitCodeForResult,
  globalOptionsOf,
  main,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
} from './cli.js';
export type { ExitPlan } from './cli.js';
export { parseGlobal } from './globals.js';
export type { GlobalOptions, RawGlobalFlags } from './globals.js';

// P-189 — the executable entrypoint.
//
// `index.ts` is ALSO this package's public barrel, so the run happens ONLY when the
// file IS the entry. An unguarded `parseAsync` at module scope would execute on every
// `import` — breaking this package's own tests and every sibling that imports the
// barrel — so the guard is load-bearing, not decorative.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  void main().then(code => {
    process.exitCode = code;
  });
}
export { QuitOnQ, isQuitInput, renderScreen } from './tui.js';
export { createApp } from './serve.js';
export type { HealthBody } from './serve.js';
export { theme, colorsEnabled } from './theme.js';
export type { ThemeLevel } from './theme.js';
export {
  openStore,
  redactValue,
  defaultStoreDir,
  STITCH_CONFIG_DIR,
  STITCH_CONFIG_FILE,
  REDACTED,
} from './config.js';
export type { JsonValue, StitchStore } from './config.js';
export {
  shouldCheckForUpdates,
  createNotifier,
  toNotice,
  maybeNotify,
  NO_UPDATE_FLAG,
  NO_UPDATE_ENV,
  UPDATE_CHECK_INTERVAL_MS,
} from './update.js';
export type { NotifierPackage, UpdateInfo, UpdateNotice } from './update.js';
