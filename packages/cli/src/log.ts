// P-206 — `log.ts`: the CLI's single logging entrypoint.
//
// ONE place owns levels (`silent|error|warn|info|debug|trace`), per-module
// filters (`--log deps=debug,sandbox=warn`), secret redaction (every emitted
// line, text or NDJSON), and the JSON mode (`--log-json`). Commands route
// through `createLogger` so filtering + redaction ALWAYS apply — the phase's
// own handoff note forbids ad-hoc `console.log`.
//
// ON THE SINK: default `process.stderr`, so stdout stays machine-parseable
// (the house rule the `stitch config` P-201 established). Tests inject a
// capturing sink instead of touching process streams.
//
// ON CORE WIRING: the phase's "core modules (P-010) log through the CLI
// filter" and "P-162 events render above threshold" are CORE-side consumers —
// inbesat owns that lane (the ADR-090 boundary note). This module IS the sink
// they are meant to adopt; nothing CLI-owned had a logger to migrate.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

/** The ordered log levels. `silent` is a THRESHOLD (only errors pass). */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** Priority order — a level emits when its priority is <= the threshold's. */
export const LOG_LEVELS: readonly LogLevel[] = [
  'silent',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
];

const PRIORITY: Readonly<Record<LogLevel, number>> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/** A parsed `--log` spec: the global default plus per-module overrides. */
export interface LogFilter {
  default: LogLevel;
  modules: Record<string, LogLevel>;
}

/**
 * Parse `deps=debug,sandbox=warn` (per-module) and/or a bare `debug`
 * (the global default). Unknown levels are `CONFIG_ERROR` on `field: 'log'`.
 */
export function parseLogFilter(
  input: string,
  defaultLevel: LogLevel = 'info'
): Result<LogFilter, StitchError> {
  const filter: LogFilter = { default: defaultLevel, modules: {} };
  for (const rawEntry of input.split(',')) {
    const entry = rawEntry.trim();
    if (entry === '') continue;
    const eq = entry.indexOf('=');
    const name = eq === -1 ? undefined : entry.slice(0, eq).trim();
    const level = (eq === -1 ? entry : entry.slice(eq + 1)).trim() as LogLevel;
    if (!LOG_LEVELS.includes(level)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'log',
        message: `--log: unknown level "${entry}" (levels: ${LOG_LEVELS.join('|')})`,
      });
    }
    if (name === undefined || name === '') filter.default = level;
    else filter.modules[name] = level;
  }
  return ok(filter);
}

/** Key names whose VALUES never reach a log line. */
const REDACT_DEFAULT: readonly string[] = [
  'api[_-]?key',
  'token',
  'secret',
  'password',
  'authorization',
  'bearer',
];

/** Escape a caller-supplied key for the alternation regex. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the redactor: `KEY=serdecret` → `KEY=***` (the phase's `***`). */
function makeRedact(keys: readonly string[] | undefined): (text: string) => string {
  const names = [...REDACT_DEFAULT, ...(keys ?? []).map(escapeRe)].filter(Boolean);
  const keysAlt = names.join('|');
  // No PREFIX boundary: SNAKE_CASE keys (`OPENROUTER_API_KEY`) must match via
  // their `api_key` tail — the TRAILING guard (?![a-zA-Z0-9]) is what keeps
  // `tokens`/`passwordless` from counting as keys. The separator absorbs a
  // chained `bearer` so `Authorization: Bearer tok_999` redacts the TOKEN,
  // and the value is ONE token, so prose after `KEY=***` survives.
  const re = new RegExp(
    `(${keysAlt})(?![a-zA-Z0-9])((?:["'\\s:=]+|bearer\\s+)+)([^\\s'"\`,}]+)`,
    'gi'
  );
  return (text: string): string =>
    text.replace(re, (_whole: string, key: string, sep: string) => `${key}${sep}***`);
}

/** Where the lines go (injected; tests capture). */
export interface LogSink {
  write(line: string): void;
}

/** Everything the logger needs; every field has a working default. */
export interface LoggerOptions {
  /** The global threshold (`levelFor` maps the `-q`/`-V` globals onto it). */
  level?: LogLevel;
  /** Per-module thresholds (from `parseLogFilter`). */
  moduleFilter?: Record<string, LogLevel>;
  /** `--quiet-error`: even errors are suppressed (at the `silent` threshold). */
  quietError?: boolean;
  /** `--log-json`: NDJSON lines instead of text. */
  json?: boolean;
  /** Where lines go. Default: `process.stderr`. */
  sink?: LogSink;
  /** Colour (P-202 decision lives OUTSIDE: pass `theme`'s paint or none). */
  paint?: (level: Exclude<LogLevel, 'silent'>, line: string) => string;
  /** Extra verbatim key names to redact (e.g. the P-200 config key list). */
  redactKeys?: readonly string[];
}

/** What a command holds: the five emit verbs plus `child`. */
export interface Logger {
  readonly module?: string;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  trace(message: string): void;
  /** A namespaced logger: `root.child('deps')` → `[deps] …`, nested → `[deps.cache] …`. */
  child(module: string): Logger;
}

/** Map the CLI globals onto the level: `-q` wins over `-V` (a `-qV` is quiet). */
export function levelFor(global: { verbose?: boolean; quiet?: boolean }): LogLevel {
  if (global.quiet === true) return 'silent';
  if (global.verbose === true) return 'debug';
  return 'info';
}

/**
 * Build a logger. Shared rule: a line emits when its level passes the
 * EFFECTIVE threshold — the module's `--log` override, else the global —
 * and at the `silent` threshold only errors pass, unless `--quiet-error`.
 */
export function createLogger(options: LoggerOptions = {}, module?: string): Logger {
  const global = options.level ?? 'info';
  const modules = options.moduleFilter ?? {};
  const quietError = options.quietError === true;
  const isJson = options.json === true;
  const sink = options.sink ?? {
    write: (line: string): void => void process.stderr.write(`${line}\n`),
  };
  const paint = options.paint ?? ((_: string, line: string): string => line);
  const redact = makeRedact(options.redactKeys);

  const emits = (level: LogLevel): boolean => {
    const threshold = (module !== undefined ? modules[module] : undefined) ?? global;
    if (level === 'error') return !(threshold === 'silent' && quietError);
    if (threshold === 'silent') return false;
    return PRIORITY[level] <= PRIORITY[threshold];
  };

  const emit = (level: Exclude<LogLevel, 'silent'>, message: string): void => {
    if (!emits(level)) return;
    const safe = redact(message);
    if (isJson) {
      sink.write(
        `${JSON.stringify({
          ts: new Date().toISOString(),
          level,
          ...(module !== undefined ? { module } : {}),
          msg: safe,
        })}\n`
      );
      return;
    }
    const text = `${module !== undefined ? `[${module}] ` : ''}${
      level === 'info' ? safe : `${level}: ${safe}`
    }`;
    sink.write(`${paint(level, text)}\n`);
  };

  return {
    ...(module !== undefined ? { module } : {}),
    error: (message): void => void emit('error', message),
    warn: (message): void => void emit('warn', message),
    info: (message): void => void emit('info', message),
    debug: (message): void => void emit('debug', message),
    trace: (message): void => void emit('trace', message),
    child: (name: string): Logger =>
      createLogger(options, module !== undefined ? `${module}.${name}` : name),
  };
}
