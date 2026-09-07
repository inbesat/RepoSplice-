import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Configstore from 'configstore';
import { err, ok, type Result, type StitchError } from '@repo-stitcher/core';

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
