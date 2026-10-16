// P-190 — `stitch init` tests, against a real temp dir and the REAL templates.
//
// Every interactive edge is injected, so the whole flow runs without a TTY, a network
// or a real store — and the two claims that matter are asserted directly: a refusal
// leaves the directory BYTE-IDENTICAL, and the key is stored but NEVER printed.
//
// The five required scenarios from the phase spec:
//
//   it('scaffolds files')  it('refuses without force on existing')
//   it('validates and stores key')  it('offline skips validate')  it('prints summary')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, ok } from 'neverthrow';
import type { GlobalOptions } from '../globals.js';
import {
  CONFIG_FILE,
  SCAFFOLD_FILES,
  init,
  initSummary,
  keyPathFor,
  type InitDeps,
} from './init.js';

/** The real shipped assets, so the test exercises what ships. */
const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

const BASE: GlobalOptions = { verbose: false, yes: false, offline: false, color: true };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stitch-init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Deps with the template dir wired and the summary captured. */
function deps(over: Partial<InitDeps> = {}): InitDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    templatesDir: TEMPLATES,
    write: (line: string) => void lines.push(line),
    ...over,
  };
}

describe('P-190 stitch init', () => {
  it('scaffolds files', async () => {
    const d = deps();
    const result = await init({ ...BASE, cwd: dir }, d);
    expect(result.isOk()).toBe(true);

    for (const file of SCAFFOLD_FILES) {
      expect(existsSync(join(dir, file)), `expected ${file}`).toBe(true);
    }

    // The config carries the schema's REAL sections — not the `[ai]`/`[licenses]`
    // names the phase's prose uses, which `ConfigSchema` does not have.
    const toml = await readFile(join(dir, CONFIG_FILE), 'utf8');
    expect(toml).toContain('[openrouter]');
    expect(toml).toContain('[sandbox]');
    expect(toml).toContain('[licensePolicy]');
    expect(toml).toContain('[agent]');
    // The template's prose may MENTION those names; what must not exist is a SECTION.
    expect(toml).not.toMatch(/^\[ai\]/m);
    expect(toml).not.toMatch(/^\[licenses\]/m);

    // …and NO SECRET reaches a scaffolded, committed file: the env example carries
    // names with empty values only.
    const env = await readFile(join(dir, '.env.example'), 'utf8');
    expect(env).toContain('OPENROUTER_API_KEY=');
    expect(/^OPENROUTER_API_KEY=.+$/m.test(env)).toBe(false);

    const ignore = await readFile(join(dir, '.gitignore'), 'utf8');
    for (const entry of ['node_modules/', '.env', 'dist/']) expect(ignore).toContain(entry);
  });

  it('refuses without force on existing', async () => {
    await writeFile(join(dir, CONFIG_FILE), 'original\n');

    // Declined prompt → typed refusal, and the existing file is BYTE-IDENTICAL.
    const declined = await init({ ...BASE, cwd: dir }, deps({ confirm: async () => false }));
    expect(declined.isErr()).toBe(true);
    if (declined.isErr()) expect(declined.error.code).toBe('CONFIG_ERROR');
    expect(await readFile(join(dir, CONFIG_FILE), 'utf8')).toBe('original\n');
    expect(existsSync(join(dir, '.env.example'))).toBe(false);

    // `--force` overwrites WITHOUT asking.
    let asked = false;
    const forced = await init(
      { ...BASE, cwd: dir, force: true },
      deps({
        confirm: async () => {
          asked = true;
          return false;
        },
      })
    );
    expect(forced.isOk()).toBe(true);
    expect(asked).toBe(false);
    expect(await readFile(join(dir, CONFIG_FILE), 'utf8')).toContain('[openrouter]');

    // `-y` is the non-interactive "assume yes" (P-156), so it also overwrites.
    await writeFile(join(dir, CONFIG_FILE), 'original\n');
    const assumed = await init(
      { ...BASE, cwd: dir, yes: true },
      deps({ confirm: async () => false })
    );
    expect(assumed.isOk()).toBe(true);
    expect(await readFile(join(dir, CONFIG_FILE), 'utf8')).toContain('[openrouter]');
  });

  it('validates and stores key', async () => {
    const validated: string[] = [];
    const stored: Array<[string, string]> = [];
    const d = deps({
      promptKey: async () => 'sk-secret-value',
      validateKey: async (provider, key) => {
        validated.push(`${provider}:${key}`);
        return ok(undefined);
      },
      store: {
        set: (key, value) => {
          stored.push([key, String(value)]);
          return ok(undefined);
        },
      },
    });

    const result = await init({ ...BASE, cwd: dir, provider: 'openrouter' }, d);
    expect(result.isOk()).toBe(true);

    // Validated, then persisted under the provider's key path…
    expect(validated).toEqual(['openrouter:sk-secret-value']);
    expect(stored).toEqual([[keyPathFor('openrouter'), 'sk-secret-value']]);
    expect(keyPathFor('openrouter')).toBe('openrouter.apiKey');

    // …and never echoed: the summary names the provider, not the secret.
    expect(d.lines.join('\n')).toContain('openrouter');
    expect(d.lines.join('\n')).not.toContain('sk-secret-value');

    // A FAILING validation stops before anything is stored.
    const failing = deps({
      promptKey: async () => 'sk-rejected',
      validateKey: async () => err({ code: 'CONFIG_ERROR', field: 'key', message: 'invalid key' }),
      store: {
        set: (key, value) => {
          stored.push([key, String(value)]);
          return ok(undefined);
        },
      },
    });
    const rejected = await init({ ...BASE, cwd: dir, provider: 'openrouter' }, failing);
    expect(rejected.isErr()).toBe(true);
    expect(stored).toEqual([[keyPathFor('openrouter'), 'sk-secret-value']]);

    // No prompt at all (`--no-key-prompt`) is not a validation.
    const skipped = await init(
      { ...BASE, cwd: dir, provider: 'openrouter', keyPrompt: false, force: true },
      deps({ promptKey: async () => 'sk-unused' })
    );
    expect(skipped.isOk()).toBe(true);
  });

  it('offline skips validate', async () => {
    let called = false;
    const d = deps({
      promptKey: async () => 'sk-offline',
      validateKey: async () => {
        called = true;
        return ok(undefined);
      },
    });

    const result = await init({ ...BASE, cwd: dir, offline: true, provider: 'openrouter' }, d);
    expect(result.isOk()).toBe(true);

    // Local-only: no network validation…
    expect(called).toBe(false);
    // …but the scaffold is COMPLETE, not partial.
    for (const file of SCAFFOLD_FILES) expect(existsSync(join(dir, file)), file).toBe(true);

    // A rejected validation never happens offline, so it cannot fail the run either.
    const failing = deps({
      validateKey: async () => err({ code: 'INTERNAL', message: 'no network' }),
    });
    expect(
      (await init({ ...BASE, cwd: dir, offline: true, provider: 'x', force: true }, failing)).isOk()
    ).toBe(true);
  });

  it('prints summary', async () => {
    const d = deps();
    const result = await init({ ...BASE, cwd: dir, provider: 'openrouter' }, d);
    expect(result.isOk()).toBe(true);

    const text = d.lines.join('\n');
    expect(text).toContain('Scaffolded');
    expect(text).toContain(CONFIG_FILE);
    // The phase's "next steps" must name the following command.
    expect(text).toContain('Next steps:');
    expect(text).toContain('stitch add');
    expect(text).toContain('stitch merge');
    // No key was supplied in this run, so the provider line is the .env pointer.
    expect(text).toContain('.env');

    // The summary helper itself is deterministic and names the provider when given one.
    expect(initSummary('/tmp/x', 'openrouter').join('\n')).toContain('"openrouter"');
  });
});
