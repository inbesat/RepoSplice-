// P-190 — `stitch init`: the onboarding door.
//
// Scaffolds a project (config + env example + gitignore) and optionally validates and
// stores a provider API key. Three deliberate properties:
//
//   1. IT REFUSES BEFORE IT WRITES. An existing `stitch.toml` stops the command unless
//      `--force` or a confirmed prompt — checked before any file is touched, so a
//      refusal leaves the directory exactly as it was.
//   2. THE KEY IS STORED, NEVER PRINTED. It goes into the durable store (`StitchStore`,
//      P-200) and the success summary names the provider only. `.env.example` carries
//      NAMES; no scaffolded, committed file ever receives a value.
//   3. `--offline` SKIPS VALIDATION BUT STILL SCAFFOLDS. A local-only run is a
//      first-class outcome, not a degraded one.
//
// No-throw: `init` returns `Result<void, StitchError>`. A refusal is a `CONFIG_ERROR`
// (the caller can fix it by passing --force); a filesystem failure is `INTERNAL`. Every
// interactive edge (prompt, key entry, validation) is INJECTED, so the whole flow is
// testable without a TTY or a network.
//
// On the template keys: the phase's prose mentions `[ai]` and `[licenses]`, neither of
// which exists in core's `ConfigSchema` — the real sections are `[openrouter]`,
// `[sandbox]`, `[licensePolicy]`, `[agent]`, `[paths]`, and that is what the shipped
// templates use (ADR-076).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import type { StitchStore } from '../config.js';
import type { GlobalOptions } from '../globals.js';

/** The files `init` writes, in the order it writes them. */
export const SCAFFOLD_FILES = ['stitch.toml', '.env.example', '.gitignore'] as const;
export type ScaffoldFile = (typeof SCAFFOLD_FILES)[number];

/** The file whose existence makes `init` refuse. */
export const CONFIG_FILE = 'stitch.toml';

/** What the command is given on top of the globals. */
export interface InitOptions extends GlobalOptions {
  /** `--force`: overwrite an existing config without prompting. */
  force?: boolean;
  /** `--provider <name>`: validate + store a key for this provider. */
  provider?: string;
  /** `--no-key-prompt` sets this to `false`, suppressing the interactive key step. */
  keyPrompt?: boolean;
}

/** Everything interactive or environmental, injected so the flow is testable. */
export interface InitDeps {
  /** Ask a yes/no question. Defaults to declining (non-interactive safety). */
  confirm?: (question: string) => Promise<boolean>;
  /** Ask for a secret. `undefined` means "the user supplied nothing". */
  promptKey?: (provider: string) => Promise<string | undefined>;
  /** Validate a key. Defaults to accepting (tests inject the failure case). */
  validateKey?: (provider: string, key: string) => Promise<Result<void, StitchError>>;
  /** Where a validated key is persisted. Absent = do not persist. */
  store?: Pick<StitchStore, 'set'>;
  /** Where the summary goes. Injected so a test can assert it. */
  write?: (line: string) => void;
  /** Template directory override (tests point this at the real assets). */
  templatesDir?: string;
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Does the path exist? */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where the shipped templates live, next to this module at runtime. */
function defaultTemplatesDir(): string {
  return fileURLToPath(new URL('../templates/', import.meta.url));
}

/** The store key a validated provider key is written to. */
export function keyPathFor(provider: string): string {
  return `${provider}.apiKey`;
}

/**
 * The success summary.
 *
 * Deliberately contains the NEXT COMMAND (the phase's "next steps") and never the key.
 */
export function initSummary(targetDir: string, provider?: string): string[] {
  return [
    `Scaffolded ${SCAFFOLD_FILES.join(', ')} in ${targetDir}`,
    'Next steps:',
    `  1. Add your first source:  stitch add <repo-url> <paths>`,
    '  2. Merge into a child repo: stitch merge',
    provider === undefined
      ? '  3. Set a provider key in .env (see .env.example)'
      : `  3. Provider "${provider}" is configured; adjust stitch.toml to change it`,
  ];
}

/**
 * Scaffold a project.
 *
 * Order is load-bearing: refuse → scaffold → key → summary. Refusing first means a
 * declined prompt cannot leave a half-written directory behind.
 */
export async function init(
  opts: InitOptions,
  deps: InitDeps = {}
): Promise<Result<void, StitchError>> {
  const targetDir = resolve(opts.cwd ?? '.');
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const configPath = join(targetDir, CONFIG_FILE);

  try {
    await mkdir(targetDir, { recursive: true });
  } catch (cause: unknown) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'cwd',
      message: `init: cannot create ${targetDir}: ${detailOf(cause)}`,
    });
  }

  // 1. REFUSE FIRST — nothing is written before this decision.
  if (await exists(configPath)) {
    let allowed = opts.force === true;
    if (!allowed) {
      if (opts.yes === true) {
        // `-y` is the non-interactive "assume yes" (P-156).
        allowed = true;
      } else if (deps.confirm !== undefined) {
        allowed = await deps.confirm(`${CONFIG_FILE} exists. Overwrite it?`);
      }
    }
    if (!allowed) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'stitch.toml',
        message: `init: ${CONFIG_FILE} already exists in ${targetDir}; re-run with --force to overwrite`,
      });
    }
  }

  // 2. SCAFFOLD from the shipped templates.
  const templatesDir = deps.templatesDir ?? defaultTemplatesDir();
  for (const file of SCAFFOLD_FILES) {
    let contents: string;
    try {
      contents = await readFile(join(templatesDir, file), 'utf8');
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `init: cannot read template ${file}: ${detailOf(cause)}`,
      });
    }
    try {
      await writeFile(join(targetDir, file), contents, 'utf8');
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `init: cannot write ${file}: ${detailOf(cause)}`,
      });
    }
  }

  // 3. KEY: prompt → validate → store. `--offline` skips the whole step; the scaffold
  // above already happened, so an offline init is complete, not partial.
  if (opts.provider !== undefined && opts.keyPrompt !== false && opts.offline !== true) {
    const provider = opts.provider;
    const key = deps.promptKey === undefined ? undefined : await deps.promptKey(provider);
    if (key !== undefined && key.trim() !== '') {
      const validate =
        deps.validateKey ?? (async (): Promise<Result<void, StitchError>> => ok(undefined));
      const checked = await validate(provider, key);
      if (checked.isErr()) return err(checked.error);
      if (deps.store !== undefined) {
        const stored = deps.store.set(keyPathFor(provider), key);
        if (stored.isErr()) return err(stored.error);
      }
    }
  }

  // 4. SUMMARY — the provider is named; the key never is.
  for (const line of initSummary(targetDir, opts.provider)) write(line);
  return ok(undefined);
}
