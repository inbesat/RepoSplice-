import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import Configstore from 'configstore';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import {
  ConfigSchema,
  defaultConfig,
  err,
  ok,
  PROVIDER_ENV_KEYS,
  type Config,
  type Result,
  type StitchError,
} from '@repo-stitcher/core';
import type { SourceSelection } from './commands/add.js';

/** Directory name for stitch state under the user's home (P-200). */
export const STITCH_CONFIG_DIR = '.stitch';
/** Config file name inside the stitch directory. */
export const STITCH_CONFIG_FILE = 'config.json';
/** Placeholder written over secret values in redacted snapshots (P-206). */
export const REDACTED = '[REDACTED]';

/** JSON values the store accepts. Functions, symbols, BigInt, and undefined are rejected. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Case-insensitive key-fragment match for secret material. */
const SECRET_KEY_RE =
  /api[_-]?key|token|secret|password|passwd|pwd|auth|private[_-]?key|credentials?/i;

/** Default store location: `~/.stitch` (P-200). */
export function defaultStoreDir(): string {
  return join(homedir(), STITCH_CONFIG_DIR);
}

function configError(field: string, message: string): StitchError {
  return { code: 'CONFIG_ERROR', field, message };
}

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * redactValue: deep-clone `value`, replacing secret-keyed subtrees with
 * REDACTED. A matching key redacts its whole subtree (so a `credentials`
 * object never leaks nested fields); other objects/arrays recurse and
 * primitives pass through untouched.
 */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redactValue(v);
    }
    return out;
  }
  return value;
}

/** Durable user config (provider keys, prefs, server settings — P-200). */
export type StitchStore = {
  /** Absolute path of the backing config.json file. */
  readonly path: string;
  get(key: string): Result<unknown, StitchError>;
  set(key: string, value: JsonValue): Result<void, StitchError>;
  delete(key: string): Result<void, StitchError>;
  /** Redacted whole-store snapshot, safe to log (P-206 hook to P-010). */
  snapshotRedacted(): Result<Record<string, unknown>, StitchError>;
};

/**
 * assertStorable: configstore silently drops `undefined` and throws late on
 * non-serializables, so validate up front and fail loudly as CONFIG_ERROR.
 */
function assertStorable(key: string, value: JsonValue): StitchError | null {
  if (value === undefined) {
    return configError(key, 'refusing to store undefined (configstore would silently drop it)');
  }
  try {
    JSON.stringify(value);
    return null;
  } catch (e: unknown) {
    return configError(key, `value is not JSON-serializable: ${toMessage(e)}`);
  }
}

/**
 * openStore: open (creating) the JSON config store in `dir`
 * (default `~/.stitch`). All I/O failures surface as CONFIG_ERROR —
 * this function never throws. Note configstore reads lazily: a corrupt
 * file parses as empty and heals on the next write (locked by test).
 */
export function openStore(dir: string = defaultStoreDir()): Result<StitchStore, StitchError> {
  let backing: Configstore;
  try {
    mkdirSync(dir, { recursive: true });
    backing = new Configstore('stitch', {}, { configPath: join(dir, STITCH_CONFIG_FILE) });
  } catch (e: unknown) {
    return err(configError('store', `cannot open config store in ${dir}: ${toMessage(e)}`));
  }
  const filePath = join(dir, STITCH_CONFIG_FILE);
  return ok({
    path: filePath,
    get: (key: string): Result<unknown, StitchError> => {
      try {
        return ok(backing.get(key) as unknown);
      } catch (e: unknown) {
        return err(configError(key, `config get failed: ${toMessage(e)}`));
      }
    },
    set: (key: string, value: JsonValue): Result<void, StitchError> => {
      const rejected = assertStorable(key, value);
      if (rejected !== null) return err(rejected);
      try {
        backing.set(key, value);
        return ok(undefined);
      } catch (e: unknown) {
        return err(configError(key, `config set failed: ${toMessage(e)}`));
      }
    },
    delete: (key: string): Result<void, StitchError> => {
      try {
        backing.delete(key);
        return ok(undefined);
      } catch (e: unknown) {
        return err(configError(key, `config delete failed: ${toMessage(e)}`));
      }
    },
    snapshotRedacted: (): Result<Record<string, unknown>, StitchError> => {
      try {
        return ok(redactValue(backing.all) as Record<string, unknown>);
      } catch (e: unknown) {
        return err(configError('store', `config snapshot failed: ${toMessage(e)}`));
      }
    },
  });
}

/**
 * readSources: read the stored `sources` array.
 *
 * Validated entry by entry rather than cast: the store is a JSON file a user can
 * edit, so a malformed selection must be dropped rather than trusted into a merge
 * (or a `status` dashboard). Lives beside the store it validates (P-194 moved it
 * out of `cli.ts`, which keeps the status command free of a shell import).
 */
export function readSources(
  stored: Result<unknown, StitchError>
): Result<SourceSelection[], StitchError> {
  if (stored.isErr()) return err(stored.error);
  const value = stored.value;
  if (value === undefined || value === null) return ok([]);
  if (!Array.isArray(value)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'sources',
      message: 'add: the stored "sources" value is not an array',
    });
  }
  const out: SourceSelection[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const source = record['source'];
    const paths = record['paths'];
    const ref = record['ref'];
    if (typeof source !== 'string' || !Array.isArray(paths)) continue;
    out.push({
      source,
      paths: paths.filter((p): p is string => typeof p === 'string'),
      ...(typeof ref === 'string' ? { ref } : {}),
    });
  }
  return ok(out);
}

/**
 * providerNames: which providers have a resolvable credential, WITHOUT reading
 * any value — an env var name from {@link PROVIDER_ENV_KEYS}, or a store key.
 * Configstore nests dotted keys (`openrouter.apiKey` becomes
 * `{ openrouter: { apiKey } }`), so a provider shows up as a top-level object
 * carrying an (already redacted) `apiKey` property.
 *
 * Shared by the status dashboard and doctor's provider-key check (P-195);
 * lives beside the store it reads (the `readSources` precedent).
 */
export function providerNames(store: Result<StitchStore, StitchError> | null): string[] {
  const providers = new Set<string>();
  for (const [provider, envKey] of Object.entries(PROVIDER_ENV_KEYS)) {
    if (envKey !== '' && process.env[envKey] !== undefined) providers.add(provider);
  }
  if (store !== null && store.isOk()) {
    const snapshot = store.value.snapshotRedacted();
    if (snapshot.isOk()) {
      for (const [top, nested] of Object.entries(snapshot.value)) {
        if (
          typeof nested === 'object' &&
          nested !== null &&
          'apiKey' in (nested as Record<string, unknown>)
        ) {
          providers.add(top);
        }
      }
    }
  }
  return [...providers].sort();
}

// ---------------------------------------------------------------------------
// P-200 — PROJECT config: locate/parse/validate `stitch.toml`, merge with
// core's defaults, overlay env vars, resolve relative paths, and write it
// back. Distinct from the user-level store above: the store holds secrets in
// `~/.stitch/config.json`; this reads the per-project `stitch.toml`. smol-toml
// parses AND serializes under both runtimes this package runs on (Bun for the
// CLI binary, Node for vitest — Bun.TOML exists only in Bun).
// ---------------------------------------------------------------------------

/** The per-project config file `configPaths` discovers. */
export const PROJECT_CONFIG_FILE = 'stitch.toml';

/** Options for locating the project config. */
export type ConfigPathOptions = {
  /** Explicit override (the CLI's global `-c/--config`); absolute or cwd-relative. */
  config?: string;
  /** Where the upward walk starts (the CLI's global `-C/--cwd`). */
  cwd?: string;
};

/** Options for loading the merged effective config. */
export type LoadConfigOptions = ConfigPathOptions & {
  /** Injectable for tests; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
};

/**
 * configPaths: the project config file's absolute path, or `null` when no
 * per-project `stitch.toml` exists (commands then run on defaults + env).
 * An explicit `opts.config` is returned resolved-against-cwd even if missing —
 * `loadConfig` reports that as an error, because the user named the file.
 * Discovery walks up from `opts.cwd` (default cwd), stopping at the filesystem
 * root or the first `.git` boundary, so a parent workspace's config can never
 * capture an inner repo.
 */
export function configPaths(opts: ConfigPathOptions = {}): Result<string | null, StitchError> {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.config !== undefined && opts.config !== '') {
    return ok(isAbsolute(opts.config) ? opts.config : resolve(cwd, opts.config));
  }
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, PROJECT_CONFIG_FILE))) return ok(join(dir, PROJECT_CONFIG_FILE));
    if (existsSync(join(dir, '.git'))) return ok(null);
    const parent = dirname(dir);
    if (parent === dir) return ok(null);
    dir = parent;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * mergeDefaults: deep-merge `override` over `base` (the defaults). TOML gives
 * whole sub-objects but sparse sections, so `[paths] cacheDir=…` must keep the
 * default `worktreeDir`. Arrays replace wholesale (TOML has no array merge).
 */
function mergeDefaults(base: unknown, override: unknown): unknown {
  if (base === null || base === undefined) return override;
  if (override === null || override === undefined) return base;
  const baseIsObj = typeof base === 'object' && !Array.isArray(base);
  const overrideIsObj = typeof override === 'object' && !Array.isArray(override);
  if (baseIsObj && overrideIsObj) {
    const out: Record<string, unknown> = { ...asRecord(base) };
    for (const [key, value] of Object.entries(asRecord(override))) {
      out[key] = mergeDefaults(asRecord(base)[key], value);
    }
    return out;
  }
  return override;
}

/**
 * Env-overlay routes derived from the defaults' own shape, so an env name can
 * never drift from the schema: every `SECTION_FIELD` pair that exists gets a
 * `STITCH_SECTION_FIELD` name. Field segments are joined UPPER — `appId`
 * becomes `APPID` — and multi-word names are matched exactly because this map
 * is generated, not parsed.
 */
const ENV_OVERRIDES: ReadonlyMap<string, [section: string, field: string]> = (() => {
  const map = new Map<string, [string, string]>();
  for (const [section, fields] of Object.entries(defaultConfig)) {
    for (const field of Object.keys(asRecord(fields))) {
      map.set(`STITCH_${section}_${field}`.toUpperCase(), [section, field]);
    }
  }
  return map;
})();

/** Coerce an env string to the leaf's template type; uncoercible stays a string so zod reports it. */
function coerceEnvValue(value: string, template: unknown): unknown {
  if (typeof template === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (typeof template === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

/**
 * overlayEnv: fold environment values over the raw TOML data BEFORE schema
 * validation, so an invalid env value is reported by the same CONFIG_INVALID
 * path as a bad file key. Two sources: provider keys via core's
 * `PROVIDER_ENV_KEYS` (only into sections the schema actually has), and
 * `STITCH_<SECTION>_<FIELD>` names generated from the defaults.
 */
function overlayEnv(raw: Record<string, unknown>, env: Record<string, string | undefined>): void {
  for (const [provider, envKey] of Object.entries(PROVIDER_ENV_KEYS)) {
    const value = env[envKey];
    if (envKey === '' || value === undefined) continue;
    if (!(provider in defaultConfig)) continue;
    raw[provider] = { ...asRecord(raw[provider]), apiKey: value };
  }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('STITCH_')) continue;
    const route = ENV_OVERRIDES.get(name);
    if (route === undefined) continue;
    const [section, field] = route;
    if (value === undefined) continue;
    const template = asRecord(asRecord(defaultConfig)[section])[field];
    raw[section] = { ...asRecord(raw[section]), [field]: coerceEnvValue(value, template) };
  }
}

/**
 * Per-process cache, memoized by (explicit config, cwd) so repeated loads in
 * one run (status sections, command composition) pay for the I/O once. Env is
 * deliberately excluded from the key: within a process the environment is
 * read-only in the house model. Tests reset via {@link resetConfigCache}.
 */
const configCache = new Map<string, Result<Config, StitchError>>();

/** Empty the per-process config cache (test seam; commands never need it). */
export function resetConfigCache(): void {
  configCache.clear();
}

/**
 * loadConfig: THE single config surface every CLI command composes over —
 * locate (`configPaths`), parse TOML, overlay env, merge defaults, validate
 * against core's P-009 schema, resolve the `paths.*` fields relative to the
 * config file's directory. Never throws: an invalid file (or env value) fails
 * as `CONFIG_INVALID` carrying every zod issue with its dotted path; a missing
 * explicitly-named file is `CONFIG_ERROR`; "no project config" is NOT an error
 * — the defaults + env run.
 */
export function loadConfig(opts: LoadConfigOptions = {}): Result<Config, StitchError> {
  const cwd = opts.cwd ?? process.cwd();
  const cacheKey = JSON.stringify([opts.config ?? null, cwd]);
  const hit = configCache.get(cacheKey);
  if (hit !== undefined) return hit;

  const found = configPaths(opts);
  if (found.isErr()) return err(found.error);
  const configPath = found.value;

  let raw: Record<string, unknown> = {};
  let configDir: string | null = null;
  if (configPath !== null) {
    if (!existsSync(configPath)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'config',
        message: `the named config file does not exist: ${configPath}`,
      });
    }
    try {
      configDir = dirname(configPath);
      raw = parseToml(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch (e: unknown) {
      return err({
        code: 'CONFIG_INVALID',
        issues: [{ path: '', message: toMessage(e) }],
        message: `could not parse ${configPath} as TOML`,
      });
    }
  }

  overlayEnv(raw, opts.env ?? process.env);
  const merged = mergeDefaults(defaultConfig, raw);
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return err({
      code: 'CONFIG_INVALID',
      issues: parsed.error.issues.map(issue => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
      message: `project config${configPath === null ? '' : ` ${configPath}`} failed validation`,
    });
  }

  // Path fields resolve against the config file's directory, so a project
  // config means the same thing no matter where `stitch` was invoked. Only the
  // `paths.*` fields are path-typed; everything else is name/enum/tag material.
  if (configDir !== null) {
    for (const field of Object.keys(parsed.data.paths)) {
      const value = parsed.data.paths[field as keyof typeof parsed.data.paths];
      if (typeof value === 'string' && value !== '' && !isAbsolute(value)) {
        parsed.data.paths[field as keyof typeof parsed.data.paths] = resolve(configDir, value);
      }
    }
  }

  configCache.set(cacheKey, ok(parsed.data));
  return configCache.get(cacheKey) as Result<Config, StitchError>;
}

/**
 * writeConfig: serialize the effective config to `<dir>/stitch.toml` — the
 * persistence used by `init` (P-190) and license/deps decision recording
 * (P-196/P-197). Round-trips through {@link loadConfig} (locked by test):
 * written `paths.*` stay absolute so re-discovery cannot depend on cwd.
 * smol-toml raises on values no config-field carries (functions, arrays of
 * tables), so the whole serialization failure surfaces as `CONFIG_ERROR`.
 */
export function writeConfig(dir: string, cfg: Config): Result<void, StitchError> {
  try {
    const serialized = stringifyToml(cfg as unknown as Record<string, unknown>);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PROJECT_CONFIG_FILE), serialized, 'utf8');
    return ok(undefined);
  } catch (e: unknown) {
    return err(configError('config', `cannot write stitch.toml in ${dir}: ${toMessage(e)}`));
  }
}

/** emitConfig: the effective (defaults + file + env) config as pretty JSON — the `stitch config` output. */
export function emitConfig(opts: LoadConfigOptions = {}): Result<string, StitchError> {
  return loadConfig(opts).map(cfg => `${JSON.stringify(cfg, null, 2)}\n`);
}
