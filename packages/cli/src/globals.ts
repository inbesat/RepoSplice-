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
  /** `--color <mode>` (P-202): auto | dark | light | off (`never` maps to off). */
  colorMode?: 'auto' | 'dark' | 'light' | 'off';
  /** `--trace` (P-203): failure output carries stacks + the error's own JSON. Absent = off. */
  trace?: boolean;
  /** `--log <spec>` (P-206), repeatable: per-module log levels (`deps=debug,sandbox=warn`). */
  log?: string[];
  /** `--log-json` (P-206): structured NDJSON log lines. */
  logJson?: boolean;
  /** `-q, --silent` (P-206): suppress non-error log output (errors still show). */
  quiet?: boolean;
  /** `--quiet-error` (P-206): at the silent threshold, even errors are suppressed. */
  quietError?: boolean;
}

/** The raw shape commander hands back for the same flags. */
export interface RawGlobalFlags {
  verbose?: boolean;
  config?: string;
  yes?: boolean;
  offline?: boolean;
  cwd?: string;
  /** BOTH `--color <mode>` (a string) and `--no-color` (false) land here. */
  color?: boolean | string;
  trace?: boolean;
  /** `--log <spec>` (P-206), repeatable — commander hands an array via `collectFlag`. */
  log?: string[];
  /** `--log-json` (P-206). */
  logJson?: boolean;
  /** `-q, --silent` (P-206). */
  quiet?: boolean;
  /** `--quiet-error` (P-206). */
  quietError?: boolean;
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
  const rawColor = raw.color;
  const colorMode =
    typeof rawColor === 'string'
      ? rawColor === 'never'
        ? 'off'
        : rawColor === 'always'
          ? 'auto'
          : rawColor === 'auto' || rawColor === 'dark' || rawColor === 'light' || rawColor === 'off'
            ? rawColor
            : undefined
      : undefined;
  return {
    verbose: raw.verbose === true,
    ...(config !== undefined ? { configPath: config } : {}),
    yes: raw.yes === true,
    offline: raw.offline === true,
    ...(cwd !== undefined ? { cwd } : {}),
    color: rawColor !== false && rawColor !== 'off' && rawColor !== 'never',
    trace: raw.trace === true,
    // P-206 flags are OMITTED when absent — the shape pins assert only what
    // the flags existed for, exactly like `configPath`/`cwd`.
    ...(raw.log !== undefined ? { log: Array.isArray(raw.log) ? raw.log : [raw.log] } : {}),
    ...(raw.logJson === true ? { logJson: true } : {}),
    ...(raw.quiet === true ? { quiet: true } : {}),
    ...(raw.quietError === true ? { quietError: true } : {}),
    ...(colorMode !== undefined ? { colorMode } : {}),
  };
}
