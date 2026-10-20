// P-228 — friendly UI errors: core/CLI codes → {title, message, recovery}.
//
// The web never shows raw stacks or raw JSON to users. Anything user-facing
// goes through `toUiError`, which maps the stitch error-code families to an
// actionable triple. Until P-192 carries typed errors, thrown
// `Error(describeFailure(...))` strings are bridged by scanning the message
// for an embedded ALL_CAPS code (`scanFromError`).

/** Error-code families, each with a stable UI presentation. */
export type ErrorFamily =
  'config' | 'license' | 'sandbox' | 'ai' | 'deps' | 'hil' | 'path' | 'internal';

/** What the UI renders for an error: title, friendly message, next step. */
export interface UiError {
  readonly family: ErrorFamily;
  readonly title: string;
  readonly message: string;
  readonly recovery: string;
}

/** Codes per family (mirrors core error taxonomy; new codes map via fallback). */
const FAMILIES: Readonly<Record<Exclude<ErrorFamily, 'internal'>, readonly string[]>> = {
  config: ['CONFIG_ERROR', 'CONFIG_INVALID', 'BAD_OPTION'],
  license: ['LICENSE_VIOLATION', 'COMPLIANCE_VIOLATION'],
  sandbox: ['SANDBOX_UNAVAILABLE', 'SANDBOX_ABORTED', 'DOCKER_ERROR'],
  ai: [
    'AI_PROVIDER_ERROR',
    'AUTH_ERROR',
    'INVALID_PROVIDER',
    'UNKNOWN_MODEL',
    'NO_FAILOVER',
    'MODEL_INCAPABLE',
  ],
  deps: ['DEPENDENCY_CONFLICT'],
  hil: ['ABORTED', 'USER_CANCELLED'],
  path: ['SELECT_PATH_NOT_FOUND', 'FILE_NOT_FOUND'],
};

/** First embedded stitch code in a free-form message, or undefined. */
export function scanCode(message: string): string | undefined {
  return /[A-Z][A-Z_]{3,}/.exec(message)?.[0];
}

/** Bridge: scan a thrown error's message for an embedded code. */
export function scanFromError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return scanCode(message);
}

/** The raw error text, useful as the fallback message. */
function rawMessage(raw: unknown): string {
  if (raw instanceof Error) return raw.message;
  if (typeof raw === 'string') return raw;
  return '';
}

const RECOVERY: Readonly<Record<Exclude<ErrorFamily, 'internal'>, string>> = {
  config: 'run stitch config and fix the highlighted field.',
  license: 'run stitch license — allow, deny, or decide the flagged licenses.',
  sandbox: 'check Docker (or the GitHub Actions fallback) is available and retry.',
  ai: 'check the provider API key and the selected model, then retry.',
  deps: 'resolve the dependency conflict in the review step.',
  hil: 'approve or reject the run in the review step.',
  path: 'check the source paths and re-pick the file selection.',
};

const TITLES: Readonly<Record<ErrorFamily, string>> = {
  config: 'Configuration problem',
  license: 'License policy blocked this',
  sandbox: 'Verification environment problem',
  ai: 'AI provider problem',
  deps: 'Dependency conflict',
  hil: 'Waiting on your decision',
  path: 'Path problem',
  internal: 'Something went wrong',
};

/**
 * Map a code (or any raw error) to the UI triple. Unknown codes and
 * code-less errors fall to the internal family with the raw message shown.
 */
export function toUiError(code: string | undefined, raw: unknown): UiError {
  const resolved = (code ?? scanFromError(raw))?.trim();
  if (resolved === undefined) {
    const message = rawMessage(raw);
    return {
      family: 'internal',
      title: TITLES.internal,
      message: message === '' ? 'An unexpected error occurred.' : message,
      recovery: 'retry the step; if it persists, re-run the phase from the shell.',
    };
  }
  const family = (Object.keys(FAMILIES) as Exclude<ErrorFamily, 'internal'>[]).find(family =>
    FAMILIES[family].includes(resolved)
  );
  if (family === undefined) {
    return {
      family: 'internal',
      title: TITLES.internal,
      message: rawMessage(raw),
      recovery: 'retry the step; if it persists, re-run the phase from the shell.',
    };
  }
  return {
    family,
    title: TITLES[family],
    message: rawMessage(raw),
    recovery: RECOVERY[family],
  };
}
