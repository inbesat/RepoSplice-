// Redaction paths per SECURITY.md §1.1.
//
// Pino's `redact` is backed by fast-redact, which supports `*` (single-segment
// wildcard) but NOT `**` (multi-level wildcard). To cover any nesting depth we
// enumerate each sensitive field at depths 0..MAX_DEPTH. Beyond MAX_DEPTH we
// accept the risk: the codebase never produces structures deeper than ~4 in
// practice (e.g. `config.github.auth.token`), but we cap at 8 for defense in
// depth.
const MAX_DEPTH = 8;

const SENSITIVE_FIELDS = [
  'apiKey',
  'token',
  'secret',
  'password',
  'privateKey',
  'accessToken',
  'refreshToken',
  'webhookSecret',
  'signingKey',
] as const;

const LITERAL_PATHS = [
  'github.auth.token',
  'openrouter.apiKey',
  'anthropic.apiKey',
  'ollama.apiKey',
  'docker.authConfig',
  'sandbox.env.*',
] as const;

function buildPaths(): string[] {
  const out: string[] = [];
  for (const field of SENSITIVE_FIELDS) {
    for (let depth = 0; depth <= MAX_DEPTH; depth++) {
      const segs = Array<string>(depth).fill('*');
      segs.push(field);
      out.push(segs.join('.'));
    }
  }
  out.push(...LITERAL_PATHS);
  return out;
}

export const redactPaths: string[] = buildPaths();
