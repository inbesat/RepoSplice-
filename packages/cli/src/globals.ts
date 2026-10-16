// P-189 — the global options every `stitch` subcommand inherits.
//
// Kept separate from `cli.ts` so the SHAPE is testable without building a program:
// `parseGlobal` is a pure function of the raw commander options object.

/** What every command receives from the root program. */
export interface GlobalOptions {
  /** `-V, --verbose`: raise log verbosity. */
  verbose: boolean;
  /** `-c, --config <path>`: override the config file (P-200). Absent = use the default. */
  configPath?: string;
  /** `-y, --yes`: assume yes for prompts (P-156 / HIL non-interactive). */
  yes: boolean;
  /** `--offline`: no network; sandbox (P-146) and dep install respect it. */
  offline: boolean;
  /** `-C, --cwd <dir>`: working-directory override (P-205). Absent = `process.cwd()`. */
  cwd?: string;
  /** `--no-color`: commander sets this to `false`; colour is ON unless disabled. */
  color: boolean;
}

/** The raw shape commander hands back for the same flags. */
export interface RawGlobalFlags {
  verbose?: boolean;
  config?: string;
  yes?: boolean;
  offline?: boolean;
  cwd?: string;
  color?: boolean;
}

/** A blank string is "not supplied" — `-c ''` must not shadow the default config. */
function orAbsent(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Turn commander's loose options object into a typed {@link GlobalOptions}.
 *
 * Absent optional fields are OMITTED rather than set to `undefined`, because the repo
 * compiles with `exactOptionalPropertyTypes` — a `configPath: undefined` is a different
 * (and illegal) thing from "no config override".
 */
export function parseGlobal(raw: RawGlobalFlags): GlobalOptions {
  const config = orAbsent(raw.config);
  const cwd = orAbsent(raw.cwd);
  return {
    verbose: raw.verbose === true,
    ...(config !== undefined ? { configPath: config } : {}),
    yes: raw.yes === true,
    offline: raw.offline === true,
    ...(cwd !== undefined ? { cwd } : {}),
    color: raw.color !== false,
  };
}
