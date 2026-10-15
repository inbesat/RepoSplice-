// P-179 — Sandbox: secret-safe sandbox.
//
// Sandboxed code is merged from repositories we do not trust. Three guarantees,
// in the order they matter:
//
//   1. THE CONTAINER NEVER SEES A HOST SECRET. `safeEnv` is the only path by
//      which environment variables reach a container, and its default policy
//      (`block`) removes every secret-keyed variable.
//   2. CAPTURED TEXT NEVER CARRIES A SECRET. `scrubSecrets` replaces in-scope
//      secret VALUES, secret-keyed `KEY=value` pairs, and credential SHAPES with
//      `[REDACTED]`; the capture buffer scrubs at ingress, so an unscrubbed line
//      is never stored, returned, or persisted.
//   3. ARTIFACT NAMES ARE CHECKED. A file called `id_rsa` or `sk-...` is worth a
//      warning even when its bytes are never read; full content scanning is
//      opt-in (`config.sandbox.secretScanArtifacts`) and reads a BOUNDED prefix.
//
// Two existing lists are reused rather than duplicated — a second, divergent
// secret list is precisely the drift this phase exists to prevent:
//
//   - P-010's logger redact list (`redactPaths` from `logger/redact.ts`), which
//     already declares `sandbox.env.*`; and
//   - P-145's `redactAuditText` (`ai/audit.ts`), the codebase's existing text
//     redactor, which yields the same uppercase `[REDACTED]` marker.
//
// Note the deliberate asymmetry in `isSecretKey` versus `scrubSecrets`: the KEY
// test is an over-approximation (dropping a non-secret env var is harmless,
// while leaking one is not), whereas the TEXT test is word-bounded (redacting
// prose destroys the artifact the operator is trying to debug).

import { ok, err, type Result } from 'neverthrow';
import { open } from 'node:fs/promises';
import { type StitchError } from '../result/index.js';
import { redactPaths } from '../logger/redact.js';
import { redactAuditText } from '../ai/audit.js';

/** The marker every redaction uses (uppercase, matching P-145). */
export const REDACTED = '[REDACTED]';

// ---------------------------------------------------------------------------
// Key recognition
// ---------------------------------------------------------------------------

/**
 * The phase-mandated key pattern (P-179 step 1).
 *
 * Note what it does NOT match: `cookie`, which P-010 *does* list. That gap is
 * closed below rather than ignored — see {@link isSecretKey}.
 */
export const SECRET_KEY_PATTERN =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|API_TOKEN|AUTH|CREDENTIAL|PRIVATE)/i;

/** The `*_KEY` suffix form, spelled out so it is testable on its own. */
export const SECRET_KEY_SUFFIX_PATTERN = /_KEY$/i;

/**
 * The sensitive FIELD names carried by P-010's logger redact list.
 *
 * `redactPaths` is a list of pino paths (`*.apiKey`, `github.auth.token`,
 * `sandbox.env.*`, `["x-api-key"]`); the vocabulary that matters here is each
 * path's leaf. Wildcards (`sandbox.env.*`) contribute nothing, since the leaf
 * is the wildcard itself rather than a field name.
 */
export function loggerSensitiveFields(): string[] {
  const fields = new Set<string>();
  for (const path of redactPaths) {
    const bracketed = /\["([^"]+)"\]$/.exec(path);
    if (bracketed?.[1] !== undefined && bracketed[1] !== '') {
      fields.add(bracketed[1]);
      continue;
    }
    const leaf = path.split('.').pop() ?? '';
    if (leaf !== '' && leaf !== '*') fields.add(leaf);
  }
  return [...fields].sort();
}

/**
 * Is this variable name secret-bearing?
 *
 * A SUPERSET of the phase's regex, on purpose: it also matches every field name
 * P-010's logger lists (which adds `cookie`, plus `Authorization`'s spelling and
 * `x-api-key`), because a secret test may over-match safely and may not
 * under-match. `secrets.test.ts` asserts the superset property directly, so the
 * two lists can never drift apart without a failing test.
 */
export function isSecretKey(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '') return false;
  if (SECRET_KEY_PATTERN.test(trimmed)) return true;
  if (SECRET_KEY_SUFFIX_PATTERN.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return loggerSensitiveFields().some(field => field.toLowerCase() === lower);
}

/**
 * The vocabulary {@link isSecretToken} tests against.
 *
 * Deliberately an EXACT word list rather than a substring pattern. The mandated
 * env regex has no boundaries, so it matches `monkey` (which contains `key`) and
 * `authenticate` (which contains `auth`) — harmless when the consequence is
 * dropping one non-secret environment variable, but destructive when the
 * consequence is redacting the log text an operator is reading to debug a
 * failure. Segment-exact matching keeps `API_KEY`, `GITHUB_TOKEN`,
 * `AWS_SECRET_ACCESS_KEY` and `privateKey` while leaving prose alone.
 */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  'key',
  'token',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'credential',
  'credentials',
  'auth',
  'authorization',
  'private',
  'privatekey',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'signing',
  'signingkey',
  'webhook',
  'webhooksecret',
  'cookie',
]);

/** Split an identifier on separators AND camelCase humps, lowercased. */
function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(segment => segment !== '')
    .map(segment => segment.toLowerCase());
}

/**
 * Does this identifier contain a whole secret WORD?
 *
 * The TEXT-side test, used by {@link scrubSecrets} and the artifact-name scan.
 * See {@link SECRET_WORDS} for why it is exact rather than a substring match.
 */
export function isSecretToken(name: string): boolean {
  return splitIdentifier(name).some(word => SECRET_WORDS.has(word));
}

// ---------------------------------------------------------------------------
// safeEnv
// ---------------------------------------------------------------------------

/** How `safeEnv` treats a secret-keyed variable. */
export type EnvPolicy = 'block' | 'mask' | 'allow-list';

/** Options for {@link safeEnvPlan}. */
export interface SafeEnvOptions {
  /**
   * `config.sandbox.allowedEnv` — the key set the `allow-list` policy passes.
   * Absent means an EMPTY allow-list: nothing is passed, which fails safe.
   */
  allowedEnv?: readonly string[];
}

/** What {@link safeEnvPlan} decides. */
export interface SafeEnvPlan {
  /** Exactly what may be injected into the container. */
  env: Record<string, string>;
  /** Names the policy removed from `env`. */
  blocked: string[];
  /** Names that passed through AND are secret-keyed — mask these in logs. */
  masked: string[];
  /** The secret VALUES in scope, for {@link scrubSecrets}. Never logged. */
  secretValues: string[];
}

/**
 * Decide the container environment under a policy.
 *
 * The plan (rather than the environment alone) is the useful unit: the `mask`
 * policy must still INJECT the value while showing `****` in logs, so the caller
 * needs to know both what to pass through and what to scrub.
 */
export function safeEnvPlan(
  rawEnv: Record<string, string>,
  policy: EnvPolicy = 'block',
  opts: SafeEnvOptions = {}
): SafeEnvPlan {
  const allowed = opts.allowedEnv ?? [];
  const env: Record<string, string> = {};
  const blocked: string[] = [];
  const masked: string[] = [];
  const secretValues: string[] = [];

  for (const [name, value] of Object.entries(rawEnv)) {
    const secret = isSecretKey(name);

    if (policy === 'allow-list') {
      if (allowed.includes(name)) {
        env[name] = value;
        if (secret) {
          masked.push(name);
          secretValues.push(value);
        }
      } else {
        blocked.push(name);
        // The value is in scope even though it never reaches the container: a
        // caller may still log the env it *intended*, and that text is scrubbed.
        if (secret) secretValues.push(value);
      }
      continue;
    }

    if (policy === 'mask') {
      env[name] = value;
      if (secret) {
        masked.push(name);
        secretValues.push(value);
      }
      continue;
    }

    // `block` — the default. A secret-keyed name never reaches the container.
    if (secret) {
      blocked.push(name);
      secretValues.push(value);
    } else {
      env[name] = value;
    }
  }

  return {
    env,
    blocked,
    masked,
    secretValues: [...new Set(secretValues.filter(value => value !== ''))],
  };
}

/**
 * The sanitised container environment (the phase's `safeEnv` signature).
 *
 * A thin projection of {@link safeEnvPlan}; callers that also need to scrub logs
 * use the plan directly, because `mask`'s whole point is that the value IS
 * injected while its log rendering is not.
 */
export function safeEnv(
  rawEnv: Record<string, string>,
  policy: EnvPolicy = 'block',
  opts: SafeEnvOptions = {}
): Record<string, string> {
  return safeEnvPlan(rawEnv, policy, opts).env;
}

// ---------------------------------------------------------------------------
// scrubSecrets
// ---------------------------------------------------------------------------

/**
 * Replace secret material in text with {@link REDACTED}.
 *
 * Three passes, in this order — the order is load-bearing:
 *   1. the literal VALUES the caller knows are in scope, longest first so a
 *      shorter value nested inside a longer one cannot survive as a fragment;
 *   2. credential SHAPES via P-145's `redactAuditText` — BEFORE the key/value
 *      pass, because `Authorization: Bearer <token>` must have its token
 *      consumed as a shape. A key/value pass that ran first would redact only
 *      the scheme word and leave the token itself in the text (found by this
 *      phase's own test, not in theory);
 *   3. `KEY=value` / `key: value` pairs whose key is secret-keyed, with an
 *      optional scheme prefix folded into the redaction so the above cannot
 *      recur if a shape pattern is ever narrowed.
 *
 * The parameter is named `knownSecrets` rather than the spec's `knownKeys`
 * because the acceptance defines the behaviour precisely: it replaces secret
 * *values*. The name says what the array holds.
 */
export function scrubSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;

  const values = [...new Set(knownSecrets.filter(value => value !== ''))].sort(
    (a, b) => b.length - a.length
  );
  for (const value of values) out = out.split(value).join(REDACTED);

  out = redactAuditText(out);

  return out.replace(
    /\b([A-Za-z_][A-Za-z0-9_.-]*)(\s*[:=]\s*)(?:Bearer|Basic|Digest|Token)?\s*(\S+)/gi,
    (match: string, key: string, separator: string) =>
      isSecretToken(key) ? `${key}${separator}${REDACTED}` : match
  );
}

// ---------------------------------------------------------------------------
// Artifact scanning
// ---------------------------------------------------------------------------

/** A suspicious artifact finding. Carries a MASKED excerpt, never the secret. */
export interface SecretScanWarning {
  /** The artifact name or path that looked suspicious. */
  artifact: string;
  /** Why it looked suspicious (a stable, machine-readable reason). */
  reason: string;
  /** A masked excerpt of the match — never the secret itself. */
  excerpt: string;
}

/** Credential shapes recognisable in free text (value-shaped, not key-shaped). */
const CREDENTIAL_SHAPES: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, reason: 'provider-key-shape' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, reason: 'github-token-shape' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, reason: 'aws-access-key-shape' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, reason: 'bearer-token-shape' },
];

/**
 * Filenames that are secret-bearing by convention.
 *
 * A name check is cheap and catches the common accident (`cp ~/.ssh/id_rsa .`)
 * without reading a single byte.
 */
export const SENSITIVE_ARTIFACT_NAMES: readonly string[] = [
  '.env',
  '.env.local',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.dockercfg',
  'credentials',
  'credentials.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
];

/** Mask a match so a warning can never become the leak it reports. */
function maskExcerpt(match: string): string {
  const head = match.slice(0, 4);
  return `${head}…${REDACTED}`;
}

/** The shape reason for text, or `undefined`. */
export function suspectedSecretReason(text: string): string | undefined {
  for (const { pattern, reason } of CREDENTIAL_SHAPES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return reason;
  }
  return undefined;
}

/** A warning for an artifact NAME, or `undefined` when it looks benign. */
export function scanArtifactName(name: string): SecretScanWarning | undefined {
  if (name.trim() === '') return undefined;

  const shape = suspectedSecretReason(name);
  if (shape !== undefined) {
    return { artifact: name, reason: shape, excerpt: maskExcerpt(name) };
  }

  const basename =
    name
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() ?? name;
  const lower = basename.toLowerCase();
  if (SENSITIVE_ARTIFACT_NAMES.includes(lower)) {
    return { artifact: name, reason: 'sensitive-filename', excerpt: maskExcerpt(basename) };
  }

  // A secret-keyed token in the filename itself (`API_KEY.txt`, `my_token.log`),
  // checked per segment so `node_modules` is not mistaken for a secret.
  for (const segment of basename.split(/[.\\/_-]+/)) {
    if (segment !== '' && isSecretToken(segment)) {
      return { artifact: name, reason: 'secret-keyed-name', excerpt: maskExcerpt(basename) };
    }
  }

  return undefined;
}

/** Every warning in artifact CONTENT text (opt-in; see `secretScanArtifacts`). */
export function scanArtifactContent(text: string, artifact = '(content)'): SecretScanWarning[] {
  const warnings: SecretScanWarning[] = [];
  for (const { pattern, reason } of CREDENTIAL_SHAPES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      warnings.push({ artifact, reason, excerpt: maskExcerpt(match[0]) });
    }
  }
  // Secret-keyed assignments in the text.
  const assignment = /\b([A-Za-z_][A-Za-z0-9_.-]*)(\s*[:=]\s*)([^\s,;'"]{8,})/g;
  for (const match of text.matchAll(assignment)) {
    const key = match[1] ?? '';
    if (key !== '' && isSecretToken(key)) {
      warnings.push({
        artifact,
        reason: 'secret-keyed-assignment',
        excerpt: maskExcerpt(match[0]),
      });
    }
  }
  return warnings;
}

/**
 * Scan a file on disk, reading at most `maxBytes` (default 64 KiB).
 *
 * Bounded on purpose: artifacts can be 100 MB tars, and a secret-scan that reads
 * them whole would turn a safety feature into a memory hazard. The prefix is
 * where a leaked `.env` or a token in a script header lives in practice.
 */
export async function scanArtifactFile(
  path: string,
  opts: { maxBytes?: number } = {}
): Promise<Result<SecretScanWarning[], StitchError>> {
  if (path.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: 'scanArtifactFile: path is required',
    });
  }
  const maxBytes = Math.max(1, opts.maxBytes ?? 64 * 1024);
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `scanArtifactFile: cannot open ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return ok(scanArtifactContent(buffer.subarray(0, bytesRead).toString('utf8'), path));
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `scanArtifactFile: cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  } finally {
    await handle.close();
  }
}
