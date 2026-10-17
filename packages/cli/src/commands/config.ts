// P-201 — `stitch config`: print the resolved config path + effective JSON
// (P-200 emit), and `--edit`: open `stitch.toml` in the real editor, then
// re-validate through the SAME `loadConfig` every command uses — an invalid
// save loops the user back into the editor (issues printed per attempt) until
// `--no-loop` cuts it at one pass or the cap is hit. Validation is never
// duplicated here: the loop only re-runs `loadConfig`.

import { join } from 'node:path';
import {
  defaultConfig,
  err,
  ok,
  type Config,
  type Result,
  type StitchError,
} from '@repo-stitcher/core';
import {
  configPaths,
  emitConfig,
  loadConfig,
  PROJECT_CONFIG_FILE,
  writeConfig,
} from '../config.js';
import { openInEditor, type EditorOptions } from '../editor.js';

export type ConfigCommandOptions = {
  /** Open stitch.toml in $VISUAL/$EDITOR and loop-validate (P-201). */
  edit?: boolean;
  /** Commander's `--no-loop`: validate once, do not re-open on invalid. */
  loop?: boolean;
  /** Globals: `-c/--config`. */
  config?: string;
  /** Globals: `-C/--cwd`. */
  cwd?: string;
  /** Injectable environment for the loader (P-200 seam, tests). */
  env?: Record<string, string | undefined>;
};

export type ConfigCommandDeps = {
  /** Output surface (defaults to stdout). */
  write?: (line: string) => void;
  /** Error/notice surface (defaults to stderr) — the resolved-path note goes here. */
  writeErr?: (line: string) => void;
  /** Editor seam for tests (the production {@link openInEditor} by default). */
  openInEditor?: (
    path: string,
    editorOpts?: Omit<EditorOptions, 'spawn'>
  ) => Promise<Result<{ saved: boolean; mtime: number }, StitchError>>;
  /** Upper bound on re-open loops (default 10) so an unattended terminal cannot spin forever. */
  maxLoops?: number;
};

/** The edit loop's outcome. */
export type EditConfigResult = {
  path: string;
  config: Config;
  attempts: number;
};

/** How many times `--edit` may re-open the editor on a persistent invalid file. */
const DEFAULT_MAX_LOOPS = 10;

/** The starter file `--edit` scaffolds when no project config exists. */
function starterConfig(): Config {
  const loaded = loadConfig({ env: {} });
  return loaded.isOk() ? loaded.value : defaultConfig;
}

/**
 * configCommand: without `--edit`, the P-200 surface — the resolved config
 * path on stderr (so stdout stays parseable JSON) plus the effective config
 * as pretty JSON. With `--edit`, the editor loop: if no project config exists,
 * a defaults starter is written to the cwd first (editing nothing would be a
 * no-op), then each editor close re-runs `loadConfig({config: path})`;
 * `CONFIG_INVALID` prints every issue with its dotted path and re-opens.
 * A missing editor surfaces from `openInEditor` as `CONFIG_ERROR{field:'editor'}`.
 */
export async function configCommand(
  opts: ConfigCommandOptions,
  deps: ConfigCommandDeps = {}
): Promise<Result<EditConfigResult, StitchError>> {
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const writeErr =
    deps.writeErr ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const loadOpts = {
    ...(opts.config !== undefined ? { config: opts.config } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  };

  if (opts.edit !== true) {
    const found = configPaths(loadOpts);
    if (found.isErr()) return err(found.error);
    writeErr(
      found.value === null
        ? 'resolved config: (none — defaults + environment)'
        : `resolved config: ${found.value}`
    );
    const loaded = loadConfig({
      ...loadOpts,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    });
    const emitted = emitConfig({
      ...loadOpts,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    });
    if (emitted.isErr()) return err(emitted.error);
    if (loaded.isErr()) return err(loaded.error);
    write(emitted.value.trimEnd());
    return ok({ path: found.value ?? '(none)', config: loaded.value, attempts: 0 });
  }

  // --- --edit loop ---
  const found = configPaths(loadOpts);
  if (found.isErr()) return err(found.error);
  let path: string;
  if (found.value === null) {
    const dir = opts.cwd ?? process.cwd();
    const scaffolded = writeConfig(dir, starterConfig());
    if (scaffolded.isErr()) return err(scaffolded.error);
    path = join(dir, PROJECT_CONFIG_FILE);
    writeErr('no stitch.toml found — wrote a defaults starter; edit and save to configure');
  } else {
    path = found.value;
  }

  const maxLoops = deps.maxLoops ?? DEFAULT_MAX_LOOPS;
  for (let attempt = 1; attempt <= maxLoops; attempt++) {
    const opened = await (deps.openInEditor ?? openInEditor)(path);
    if (opened.isErr()) return err(opened.error);

    const validated = loadConfig({
      config: path,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    });
    if (validated.isOk()) {
      return ok({ path, config: validated.value, attempts: attempt });
    }
    if (validated.error.code === 'CONFIG_INVALID') {
      writeErr(`stitch.toml is invalid (attempt ${attempt}):`);
      for (const issue of validated.error.issues) {
        writeErr(`  - ${issue.path === '' ? '(file)' : issue.path}: ${issue.message}`);
      }
      if (opts.loop === false) {
        return err(validated.error);
      }
      continue;
    }
    return err(validated.error);
  }
  return err({
    code: 'CONFIG_ERROR',
    field: 'config',
    message: `stitch.toml stayed invalid after ${maxLoops} edits; run \`stitch config --edit\` again once it is fixed by hand`,
  });
}
