// P-163 — centralized error classification and recovery for the agent.
//
// Errors reach the agent from five directions — providers (P-138/P-146), tools,
// git, deps, and the sandbox — and the loop has to answer one question for each:
// retry now, switch provider, ask the human, keep going, or fail the job. This
// module is where that question is answered, in one place, for every code.
//
// WHY AN EXPLICIT TABLE AND NOT PREFIX RULES. The spec describes six prefix
// rules (`TOOL_*`, `AUTH_*`, `SANDBOX_*`, `GIT_*`, `CONFIG_*`, else-fatal). Two
// measured problems with that shape:
//
//   1. COVERAGE. The six rules cover **11 of the 48** codes that exist today. The
//      other 37 would all fall through to `fatal`, and several demonstrably
//      should not: `RATE_LIMIT` is retryable by definition; `SCANCODE_MISSING`
//      is the repo's own opt-in-not-installed state (P-130), not a fault;
//      `LOOP_LIMIT`, `NO_FAILOVER` and `USER_CANCELLED` are terminal outcomes
//      rather than bugs; `DOCKER_ERROR` is sandbox work that `SANDBOX_*` never
//      matches. "Fatal" means "a human must change something", and a rate limit
//      does not qualify.
//   2. A PREFIX IS NOT A CATEGORY. `'GIT_ERROR'.startsWith('GIT')` is true — and
//      so is `'GITHUB_API_ERROR'`. A remote API failure and a local repository
//      failure need different recoveries, and a prefix check cannot tell them
//      apart.
//
// The table is keyed by `StitchErrorCode`, so adding a code to the union without
// classifying it is a COMPILE ERROR, and a test asserts coverage at runtime
// besides. Drift is impossible rather than merely unlikely.
//
// `ProviderError` is classified separately, because it is a different type with
// its own `kind` and its own `retryable` flag — and because it carries an
// `'auth'` kind that corresponds to, but is not the same thing as, the
// `AUTH_ERROR`/`AUTH_FAILED` codes.

import { ok, type Result } from 'neverthrow';
import { STITCH_ERROR_CODES, type StitchError, type StitchErrorCode } from '../result/index.js';
import type { ProviderError } from '../ai/types.js';
import { logger } from '../logger/index.js';

/** How the loop should treat an error (P-163 step 1). */
export type ErrorClass =
  'retryable' | 'provider' | 'config' | 'tool' | 'sandbox' | 'git' | 'auth' | 'fatal';

/** What the loop does about it (P-163 step 3). */
export type RecoveryAction = 'retry' | 'failover' | 'ask' | 'abort' | 'continue';

/** The full answer for one error. */
export interface ErrorClassification {
  cls: ErrorClass;
  message: string;
  /** Worth another attempt at all (the class, or the error's own flag). */
  retryable: boolean;
  /** A human or a different strategy can still make progress. */
  recoverable: boolean;
  /** The code (or provider kind) this came from, for logs and UI grouping. */
  source: string;
}

/** One code's classification, recovery, and the sentence a user should read. */
interface ErrorRule {
  cls: ErrorClass;
  action: RecoveryAction;
  /** Plain-language explanation with a concrete next step. */
  hint: string;
}

/**
 * Every `StitchError` code, classified.
 *
 * Keyed by the union, so an unclassified new code does not compile. Ordered to
 * group by class for readability; the `satisfies` clause at the end is what
 * makes the completeness a type-level guarantee.
 */
const RULES = {
  // --- auth: recoverable by asking the human for a key (P-156 `ask_user`) ---
  AUTH_ERROR: {
    cls: 'auth',
    action: 'ask',
    hint: 'Authentication failed. Check the API token in your config and try again.',
  },
  AUTH_FAILED: {
    cls: 'auth',
    action: 'ask',
    hint: 'Could not sign in. The stored credentials were rejected; re-authenticate and retry.',
  },

  // --- retryable: transient, so the same request usually works later --------
  RATE_LIMIT: {
    cls: 'retryable',
    action: 'retry',
    hint: 'The provider is rate limiting this key. Waiting and retrying usually clears it.',
  },
  NETWORK: {
    cls: 'retryable',
    action: 'retry',
    hint: 'A network request failed. This is usually transient; check connectivity if it persists.',
  },
  GIT_ERROR: {
    cls: 'git',
    action: 'continue',
    hint: 'A git command failed. Check the repository state, credentials, and remote access.',
  },
  SCANCODE_FAILED: {
    cls: 'retryable',
    action: 'retry',
    hint: 'The ScanCode subprocess failed. Retrying, or running `stitch doctor`, usually helps.',
  },

  // --- provider: the model call failed; a different provider may succeed -----
  AI_PROVIDER_ERROR: {
    cls: 'provider',
    action: 'failover',
    hint: 'The AI provider returned an error. Try a different provider or model.',
  },
  NO_FAILOVER: {
    cls: 'provider',
    action: 'abort',
    hint: 'Every configured provider was tried and none worked. Check the model configuration.',
  },
  RETRY_EXHAUSTED: {
    cls: 'provider',
    action: 'abort',
    hint: 'The request was retried until the budget ran out, and still failed.',
  },
  INVALID_PROVIDER: {
    cls: 'config',
    action: 'abort',
    hint: 'The configured provider is not recognised. Fix the provider name in your config.',
  },
  UNKNOWN_MODEL: {
    cls: 'config',
    action: 'abort',
    hint: 'The configured model is not in the registry. Pick a supported model.',
  },
  MODEL_INCAPABLE: {
    cls: 'config',
    action: 'abort',
    hint: 'This model cannot make tool calls. Choose a tool-capable model.',
  },
  PROMPT_NOT_FOUND: {
    cls: 'config',
    action: 'abort',
    hint: 'The requested prompt template does not exist. Check the prompt name.',
  },
  PROMPT_MISSING_VAR: {
    cls: 'config',
    action: 'abort',
    hint: 'A prompt template is missing a required variable. Check the prompt arguments.',
  },

  // --- sandbox: recoverable by falling back (P-175 GH Actions) --------------
  SANDBOX_UNAVAILABLE: {
    cls: 'sandbox',
    action: 'abort',
    hint: 'No sandbox backend is available. Start Docker, or configure the GitHub Actions fallback.',
  },
  SANDBOX_FAILED: {
    cls: 'sandbox',
    action: 'abort',
    hint: 'The sandboxed build crashed. Try the GitHub Actions fallback, or inspect the build log.',
  },
  DEP_INSTALL_FAILED: {
    cls: 'sandbox',
    action: 'abort',
    hint: 'Installing dependencies inside the sandbox failed. Check the manifest/lockfile, or inspect the install log.',
  },
  DEP_INSTALL_OFFLINE_BLOCKED: {
    cls: 'sandbox',
    action: 'abort',
    hint: 'The install needs the network, which offline mode disabled. Enable sandbox.networkAllow, vendor the dependencies, or use the GitHub Actions fallback (which has network).',
  },
  DOCKER_ERROR: {
    cls: 'sandbox',
    action: 'abort',
    hint: 'Docker could not run the build. Check that Docker is installed, running, and permitted.',
  },
  DOCKER_PULL_FAILED: {
    cls: 'sandbox',
    action: 'abort',
    hint: 'The sandbox image could not be pulled. Check the image tag and registry access, or configure the GitHub Actions fallback.',
  },
  DOCKER_BUILD_FAILED: {
    cls: 'sandbox',
    action: 'abort',
    hint: 'The local sandbox image could not be built. Check the Dockerfile and its build context, or set sandbox.buildLocal to false to pull instead.',
  },

  // --- tool: the loop continues and the model adapts (P-158) ----------------
  TOOL_ARGS_INVALID_JSON: {
    cls: 'tool',
    action: 'continue',
    hint: 'A tool call was not valid JSON. The model will be told and can retry.',
  },
  TOOL_ARGS_VALIDATION: {
    cls: 'tool',
    action: 'continue',
    hint: 'A tool call had invalid arguments. The model will be told and can retry.',
  },
  TOOL_CALLING_BLOCKED: {
    cls: 'tool',
    action: 'continue',
    hint: 'This model may not make tool calls. The call was skipped.',
  },
  TOOL_DENIED: {
    cls: 'tool',
    action: 'continue',
    hint: 'The tool call was declined by policy or by a reviewer. The model can try another approach.',
  },
  TOOL_RESULT_TOO_LARGE: {
    cls: 'tool',
    action: 'continue',
    hint: 'A tool returned more data than the context allows. Narrow the request or raise the limit.',
  },
  UNKNOWN_TOOL: {
    cls: 'tool',
    action: 'continue',
    hint: 'The model called a tool that does not exist. The model will be told and can adapt.',
  },
  SELECT_PATH_NOT_FOUND: {
    cls: 'tool',
    action: 'continue',
    hint: 'A requested path was not present in the source repository listing.',
  },
  ILLEGAL_TRANSITION: {
    cls: 'tool',
    action: 'continue',
    hint: 'The agent tried a lifecycle step that was not allowed from its current state.',
  },
  NOTHING_TO_UNDO: {
    cls: 'tool',
    action: 'continue',
    hint: 'There was no recorded action to roll back.',
  },

  // --- config: a human must change something before this can ever work ------
  CONFIG_ERROR: {
    cls: 'config',
    action: 'abort',
    hint: 'The configuration is invalid. Fix the reported field and run again.',
  },
  UNSUPPORTED_ECOSYSTEM: {
    cls: 'config',
    action: 'abort',
    hint: 'This project uses an ecosystem that is not supported yet.',
  },
  ECOSYSTEM_MISMATCH: {
    cls: 'config',
    action: 'abort',
    hint: 'The sources disagree about which package ecosystem they use. Resolve the manifests first.',
  },
  LICENSE_VIOLATION: {
    cls: 'config',
    action: 'abort',
    hint: 'A licence is not permitted by your policy. Change the policy or the dependency.',
  },
  COMPLIANCE_VIOLATION: {
    cls: 'config',
    action: 'abort',
    hint: 'A licence rule was violated. Review the flagged dependency before continuing.',
  },
  UNKNOWN_LICENSE: {
    cls: 'config',
    action: 'abort',
    hint: 'A dependency has an unrecognised licence, so compliance cannot be determined.',
  },
  FORBIDDEN: {
    cls: 'config',
    action: 'abort',
    hint: 'The operation is not permitted by the current policy.',
  },
  COST_LIMIT: {
    cls: 'config',
    action: 'abort',
    hint: 'This job reached its token budget. Raise the budget or narrow the scope.',
  },
  LOOP_LIMIT: {
    cls: 'fatal',
    action: 'abort',
    hint: 'The agent ran out of iterations without finishing. Narrow the task, or raise the cap.',
  },
  // P-164 added this alongside COST_LIMIT. They are deliberately separate: a
  // token cap and a dollar cap fail at different points in the same run, and
  // telling a user they "hit the cost limit" when they actually hit a token
  // budget sends them to the wrong setting.
  TOKEN_LIMIT: {
    cls: 'config',
    action: 'abort',
    hint: 'This run reached its token budget. Raise the budget, use a cheaper model, or narrow the scope.',
  },
  DEPS_PARSE_ERROR: {
    cls: 'config',
    action: 'abort',
    hint: 'A dependency manifest could not be parsed. Fix the manifest syntax.',
  },
  DEPENDENCY_CONFLICT: {
    cls: 'config',
    action: 'abort',
    hint: 'Two sources require incompatible versions of the same dependency. Resolve the conflict.',
  },
  LOCKFILE_GENERATION_FAILED: {
    cls: 'config',
    action: 'abort',
    hint: 'The lockfile could not be generated. Check the package manager is installed.',
  },
  LOCKFILE_NOT_CREATED: {
    cls: 'config',
    action: 'abort',
    hint: 'No lockfile was produced. The package manager may have failed silently.',
  },
  LICENSE_SCAN_FAILED: {
    cls: 'fatal',
    action: 'abort',
    hint: 'The licence scan could not complete, so compliance is unknown.',
  },
  // ScanCode is opt-in and may simply not be installed (P-130). "Not installed"
  // is a configuration state with a known remedy, not a crash.
  SCANCODE_MISSING: {
    cls: 'config',
    action: 'abort',
    hint: 'ScanCode is not installed. Install it for a deep scan, or continue without one.',
  },
  GITHUB_API_ERROR: {
    cls: 'provider',
    action: 'retry',
    hint: 'The GitHub API returned an error. Check the token and the API rate limit, then retry.',
  },

  // --- terminal: the run ended, which is not the same as the run failing ----
  ABORTED: {
    cls: 'fatal',
    action: 'abort',
    hint: 'The run was aborted before it finished, so no result was produced.',
  },
  USER_CANCELLED: {
    cls: 'fatal',
    action: 'abort',
    hint: 'A person cancelled this run, so it stopped before finishing.',
  },
  USER_TIMEOUT: {
    cls: 'fatal',
    action: 'abort',
    hint: 'Nobody answered the question this run was waiting on, so it timed out.',
  },

  // --- lookup / internal ---------------------------------------------------
  NOT_FOUND: {
    cls: 'fatal',
    action: 'abort',
    hint: 'The requested item does not exist.',
  },
  FILE_NOT_FOUND: {
    cls: 'fatal',
    action: 'abort',
    hint: 'A required file is missing. Check the path and that the file was written.',
  },
  INTERNAL: {
    cls: 'fatal',
    action: 'abort',
    hint: 'An internal error occurred. This is a bug; the message above has the detail.',
  },
} as const satisfies Record<StitchErrorCode, ErrorRule>;

/**
 * The compiled lookup, plus the compile-time completeness check that makes the
 * table and the code union impossible to drift apart silently.
 */
const RULES_BY_CODE: Readonly<Record<StitchErrorCode, ErrorRule>> = RULES;

/** Every code the table claims to cover, for the coverage assertion. */
export const CLASSIFIED_CODES: readonly StitchErrorCode[] = STITCH_ERROR_CODES;

/**
 * Can a human, or a different strategy, still make progress? (P-163 step 2)
 *
 * Spec-verbatim: `recoverable = cls !== 'fatal' && cls !== 'config'`. Stated
 * once here so both classification paths apply the same rule — and so the
 * provider path, whose class set provably excludes `fatal`, is not forced to
 * write a comparison TypeScript can see is dead.
 */
function isRecoverable(cls: ErrorClass): boolean {
  return cls !== 'fatal' && cls !== 'config';
}

/** Is this an object shaped like a `ProviderError`? */
function isProviderError(e: StitchError | ProviderError): e is ProviderError {
  return 'kind' in e && 'providerName' in e;
}

/** A short, safe description of where the error came from. */
function sourceOf(e: StitchError | ProviderError): string {
  return isProviderError(e) ? `provider:${e.providerName}:${e.kind}` : e.code;
}

/**
 * Classify one error (P-163 step 2).
 *
 * Total over both error shapes: a `ProviderError` is classified from its own
 * `kind`/`retryable`, and a `StitchError` from the table. Nothing throws and
 * nothing is unmatched, so an error nobody anticipated still produces a
 * decision rather than a crash.
 */
export function classifyError(e: StitchError | ProviderError): ErrorClassification {
  if (isProviderError(e)) {
    // `kind` is the authoritative signal, and `retryable` is the provider's own
    // judgement about this specific failure. Both are honoured: a rate limit the
    // provider says is not retryable should not be retried.
    const retryable = e.retryable === true;
    const cls: ErrorClass =
      e.kind === 'auth'
        ? 'auth'
        : e.kind === 'invalid_request'
          ? 'config'
          : retryable
            ? 'retryable'
            : 'provider';
    return {
      cls,
      message: e.message,
      retryable,
      recoverable: isRecoverable(cls),
      source: sourceOf(e),
    };
  }
  const rule = RULES_BY_CODE[e.code];
  return {
    cls: rule.cls,
    message: rule.hint,
    retryable: rule.action === 'retry' || rule.action === 'failover',
    recoverable: isRecoverable(rule.cls),
    source: sourceOf(e),
  };
}

/**
 * The plain-language message a user should read (P-163 step 4).
 *
 * Derived from the same table as the classification, so a code cannot have a
 * class but no message. A `ProviderError` renders its own message, because the
 * table describes codes and not provider wording.
 */
export function friendlyError(e: StitchError | ProviderError): string {
  if (isProviderError(e)) {
    return `${e.providerName} (${e.kind}): ${e.message}`;
  }
  return RULES_BY_CODE[e.code].hint;
}

/**
 * How much recovery budget is left (P-163 step 3).
 *
 * Explicit rather than hidden in module state, so the retry -> failover -> abort
 * chain is a pure function of its inputs and the test can drive it to
 * termination without touching a timer.
 */
export interface ErrorBudget {
  /** Attempts left before giving up on this request. */
  retriesLeft: number;
  /** Providers left to switch to before giving up. */
  failoversLeft: number;
}

/** The action the loop should take, with the reason it chose it. */
export interface RecoveryDecision {
  action: RecoveryAction;
  cls: ErrorClass;
  /** The user-facing sentence, so a caller can surface it without re-deriving. */
  message: string;
}

/**
 * Decide what to do about an error (P-163 step 3).
 *
 * The retry -> failover -> abort chain terminates by construction: each call
 * consumes budget, and a call with no budget left returns `abort`. There is no
 * path that can loop forever, because the budget is an input rather than a
 * counter buried in the loop.
 *
 * The spec's signature is `handleError(e, ctx, loop)`. The `loop` parameter is
 * dropped: nothing here needs to call back into the loop, and taking a whole
 * loop as an argument would make this untestable in isolation. The recovery
 * decision is a value the loop acts on, not a call the loop makes.
 */
export async function handleError(
  e: StitchError | ProviderError,
  budget: ErrorBudget
): Promise<Result<RecoveryDecision, StitchError>> {
  const classified = classifyError(e);
  const message = friendlyError(e);
  const decide = (action: RecoveryAction): Result<RecoveryDecision, StitchError> =>
    ok({ action, cls: classified.cls, message });

  switch (classified.cls) {
    case 'retryable': {
      if (budget.retriesLeft > 0) return decide('retry');
      if (budget.failoversLeft > 0) return decide('failover');
      return decide('abort');
    }
    case 'provider': {
      // The provider already refused this request once; the remaining lever is
      // a different provider, and after that there is nothing left to try.
      if (budget.failoversLeft > 0) return decide('failover');
      return decide('abort');
    }
    case 'auth':
      return decide('ask');
    // A tool failure and a git failure are both recoverable: the model is
    // told what went wrong and can adapt, so the run continues rather than
    // dying. Step 3 never maps `git` to an action at all - it and `provider`
    // are both unmapped - and continuing matches both "recoverable" and the
    // table's own action for GIT_ERROR.
    case 'tool':
    case 'git':
      return decide('continue');
    case 'sandbox':
    case 'config':
    case 'fatal':
      return decide('abort');
  }
}

/**
 * Turn an unclassifiable throw into a decision (P-163 acceptance criterion 4).
 *
 * A tool or a facade that throws despite its `Result` contract would otherwise
 * escape the loop. This is the funnel that guarantees it cannot: the value is
 * logged, classified as `fatal` on its own text, and routed to `abort` with a
 * readable message. Never throws.
 */
export function fromUnknownThrow(caught: unknown): RecoveryDecision {
  const text = caught instanceof Error ? caught.message : String(caught);
  logger.error({ err: text }, 'agent: unhandled error; routing to abort');
  return {
    action: 'abort',
    cls: 'fatal',
    message: `An unexpected error stopped this run: ${text}`,
  };
}
