// P-156 — agent tool `ask_user` (gated).
//
// The second `gated` tool, and the only one that *suspends* the loop rather
// than proposing a change. Some decisions are genuinely ambiguous or risky —
// which license to pick, whether a large vendored subtree is in scope, how to
// resolve an unresolvable conflict — and no amount of autonomy should guess.
//
// THREE TERMINAL OUTCOMES, DISTINCT ON PURPOSE
// P-155 taught the loop not to confuse "broken" with "unmeasured". The same
// discipline applies here: a human who picks an option, a human who actively
// cancels, and a human who never replies are three different events, so they
// map to three different results (`UserAnswer`, `ABORTED`, `USER_TIMEOUT`).
// Collapsing "cancelled" into "timed out" would make the loop retry a question
// a human deliberately declined.
//
// SECRET HYGIENE (P-156 handoff: "freeForm answers must never contain/leak
// keys"). A free-form answer is untrusted human text. It is redacted before it
// is persisted to the audit trail, and a redacted answer is what the tool
// reports, so a credential pasted into the answer never reaches a DB column or
// a model-visible tool result.
//
// The human channel itself is INJECTED (`HumanResponder`): P-160's HIL queue is
// the production implementation, and the agent layer never reaches into the CLI
// or the web directly.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext, HumanQuestion, HumanResponse } from '../../ai/types.js';
import type { AiAuditLog } from '../../ai/audit.js';
import { newAuditId, nowIso, redactAuditText } from '../../ai/audit.js';
import { DEFAULT_MAX_ASK_TIMEOUT_MS, type UserAnswer, type UserQuestion } from '../types.js';

/** Options for {@link askUser}. */
export interface AskUserOptions {
  /** Overrides `ctx.config.ai.maxAskTimeoutMs`. */
  timeoutMs?: number;
  /** Abort the wait (e.g. the job was cancelled). */
  signal?: AbortSignal;
  /** Audit sink; when absent the ask still works, it is just not recorded. */
  audit?: AiAuditLog;
  /** Stable id for the question. Generated when omitted. */
  id?: string;
}

/** Read the configured wait bound, falling back to the spec's 120s default. */
export function resolveAskTimeout(ctx: ToolContext, override?: number): number {
  if (override !== undefined) return override;
  const ai = ctx.config['ai'];
  if (typeof ai === 'object' && ai !== null) {
    const configured = (ai as Record<string, unknown>)['maxAskTimeoutMs'];
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
  }
  return DEFAULT_MAX_ASK_TIMEOUT_MS;
}

/**
 * Is this answer acceptable for this question?
 *
 * A non-free-form question with options accepts ONLY one of those options (or
 * the declared default). A free-form question accepts anything non-empty. An
 * empty answer is never acceptable — it would silently resume a loop that
 * learned nothing.
 */
export function validateAnswer(
  question: UserQuestion,
  answer: string
): Result<string, StitchError> {
  if (answer.trim() === '') {
    return err({
      code: 'TOOL_ARGS_VALIDATION',
      message: `Empty answer to question "${question.id}"; the loop cannot resume without input`,
    });
  }
  const options = question.options;
  if (options === undefined || question.freeForm === true) return ok(answer);
  if (options.includes(answer)) return ok(answer);
  if (question.defaultValue !== undefined && question.defaultValue === answer) {
    return ok(answer);
  }
  return err({
    code: 'TOOL_ARGS_VALIDATION',
    message:
      `Answer "${answer}" is not one of the offered options for "${question.id}": ` +
      options.join(', '),
  });
}

/** How the exchange ended, for both auditing and error mapping. */
type Outcome = 'answered' | 'cancelled' | 'timeout';

/**
 * Present a question to the human and wait for an answer.
 *
 * Resolves to one of three outcomes, never hangs: the configured bound (default
 * 120s) and an optional `AbortSignal` both terminate the wait.
 */
export async function askUser(
  question: UserQuestion,
  ctx: ToolContext,
  opts: AskUserOptions = {}
): Promise<Result<UserAnswer, StitchError>> {
  const responder = ctx.human;
  // The question's own id is authoritative: P-156 defines `UserAnswer.id` as
  // the `UserQuestion.id` it answers, so generating a fresh id here would
  // break the very binding the field exists to express. `opts.id` exists for
  // callers that need to override it.
  const id = opts.id ?? question.id;
  const timeoutMs = resolveAskTimeout(ctx, opts.timeoutMs);

  // Audit a non-answer as well as an answer: "the human declined" is exactly
  // the kind of provenance worth having on record.
  const record = (outcome: Outcome, value: string, freeForm: boolean): void => {
    opts.audit?.recordUserQuestion({
      questionId: id,
      prompt: question.prompt,
      answer: value,
      freeForm,
      outcome,
      provider: 'human',
      model: 'n/a',
    });
  };

  if (responder === undefined) {
    record('cancelled', '', false);
    return err({
      code: 'CONFIG_ERROR',
      field: 'human',
      message:
        'ask_user requires an injected HumanResponder (P-160 HIL queue / CLI TUI / web gate)',
    });
  }

  // An already-aborted signal short-circuits before the human is ever prompted.
  if (opts.signal?.aborted === true) {
    record('cancelled', '', false);
    return err({ code: 'ABORTED', message: 'ask_user aborted before the question was presented' });
  }

  const asHumanQuestion: HumanQuestion = {
    id,
    prompt: question.prompt,
    ...(question.options !== undefined ? { options: question.options } : {}),
    ...(question.defaultValue !== undefined ? { defaultValue: question.defaultValue } : {}),
    ...(question.freeForm !== undefined ? { freeForm: question.freeForm } : {}),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const response: HumanResponse = await new Promise<HumanResponse>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    const onAbort = (): void => resolve({ kind: 'cancelled' });
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    responder
      .present(asHumanQuestion)
      .then(resolve)
      .catch((cause: unknown) => {
        // A responder that rejects must not take the loop down.
        ctx.logger.error(
          { err: cause instanceof Error ? cause.message : String(cause) },
          'ask_user: responder failed'
        );
        resolve({ kind: 'cancelled' });
      })
      .finally(() => {
        if (timer !== undefined) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      });
  });
  if (timer !== undefined) clearTimeout(timer);

  if (response.kind === 'cancelled') {
    record('cancelled', '', false);
    return err({ code: 'ABORTED', message: 'ask_user cancelled by the human or by abort' });
  }
  if (response.kind === 'timeout') {
    record('timeout', '', false);
    return err({
      code: 'USER_TIMEOUT',
      timeoutMs,
      message: `ask_user: no answer to "${question.id}" within ${timeoutMs}ms`,
    });
  }

  const validated = validateAnswer(question, response.value);
  if (validated.isErr()) {
    record('answered', response.value, question.freeForm === true);
    return err(validated.error);
  }

  // The answer is redacted on the way out, so a credential pasted into a
  // free-form reply never reaches a model-visible tool result either.
  const safe = redactAuditText(validated.value);
  record('answered', validated.value, question.freeForm === true);
  return ok({ id, value: safe, ts: nowIso(), freeForm: question.freeForm === true });
}

/** Tool schema (P-156 step 3). */
export const askUserSchema = {
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(1).optional(),
  defaultValue: z.string().optional(),
  freeForm: z.boolean().optional(),
} satisfies Record<string, z.ZodTypeAny>;

const askUserObject = z.object(askUserSchema);

/** `ask_user` — `autonomy: 'gated'`. */
export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  description:
    'Ask the human a structured question and suspend until they answer. Use for genuinely ambiguous or risky decisions, not for things autonomy can decide.',
  schema: askUserSchema,
  autonomy: 'gated',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
    const parsed = askUserObject.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
        .join('; ');
      return err({
        code: 'TOOL_ARGS_VALIDATION',
        message: `ask_user arguments validation failed: ${issues}`,
      });
    }
    const { prompt, options, defaultValue, freeForm } = parsed.data;
    // The loop re-attaches the answer as a `tool` result message, so this tool
    // only has to produce the answer itself.
    const question: UserQuestion = {
      id: `ask_${newAuditId()}`,
      prompt,
      ...(options !== undefined ? { options } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(freeForm !== undefined ? { freeForm } : {}),
    };
    return askUser(question, ctx);
  },
};
