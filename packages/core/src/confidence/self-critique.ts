// P-347 — the self-critique pass.
//
// The agent re-reads its own proposed diff and scores it on the three human
// rubric dimensions (P-325) plus one overall confidence. A self-critique is a
// second opinion, not a measurement: sandbox execution and license risk are
// measured externally, so the model is told not to guess them and the mapping
// into the P-346 components deliberately leaves those two to the caller.
//
// The module never throws: the provider is called once, its reply is parsed,
// and every step returns a Result. A reply that is not a usable JSON document
// is a CONFIG_ERROR naming the field, not a crash.

import { z } from 'zod';
import { err, ok, type Result } from 'neverthrow';
import type { ChatMessage } from '../ai/types.js';
import { asProviderError, type ChatProvider } from '../ai/provider.js';
import { selfCritiquePrompt } from '../ai/prompts.js';
import { streamChat } from '../ai/stream.js';
import type { StitchError } from '../result/index.js';

/** The tool-call name the agent loop would use for this pass. */
export const SELF_CRITIQUE_TOOL = 'self_critique';

/** The three rubric-aligned self scores (P-325's dimensions, 1-5). */
export const SELF_CRITIQUE_SCORE_FIELDS = [
  'wiring_self_score',
  'unnecessary_changes_self_score',
  'patterns_self_score',
] as const;

/**
 * The self-critique document the model must return.
 *
 * The scores are bounded at the schema so an out-of-range answer is rejected
 * at the boundary instead of being trusted downstream.
 */
export const selfCritiqueSchema = z.object({
  self_confidence: z.number().int().min(0).max(100),
  wiring_self_score: z.number().int().min(1).max(5),
  unnecessary_changes_self_score: z.number().int().min(1).max(5),
  patterns_self_score: z.number().int().min(1).max(5),
  self_rationale: z.string().min(1),
  self_flags: z.array(z.string()),
});

/** A validated self-critique. */
export type SelfCritiqueReport = z.infer<typeof selfCritiqueSchema>;

/** What the agent hands in: its own diff, plus the context it was given. */
export interface SelfCritiqueInput {
  readonly diff: string;
  readonly context?: string;
  readonly signal?: AbortSignal;
}

/** The self-critique as the 0-100 values a confidence document wants. */
export interface SelfCritiqueComponents {
  readonly self_confidence: number;
  readonly wiring_correctness: number;
  readonly unnecessary_changes: number;
  readonly respects_patterns: number;
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause !== null && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(cause);
}

/**
 * The first complete JSON object in a reply.
 *
 * Models fence their JSON, prefix it with a sentence, or both; taking the
 * FIRST balanced brace pair tolerates all three without ever trusting the
 * surrounding prose. Returns undefined when there is no object at all.
 */
export function extractJsonObject(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = fenced?.[1] !== undefined ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return candidate.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

/** Parse and validate a model reply. Never throws. */
export function parseSelfCritique(text: string): Result<SelfCritiqueReport, StitchError> {
  const json = extractJsonObject(text);
  if (json === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.selfCritique',
      message: 'the reply carried no JSON object to parse',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.selfCritique',
      message: `the reply was not valid JSON: ${messageOf(cause)}`,
    });
  }
  const validated = selfCritiqueSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    return err({
      code: 'CONFIG_ERROR',
      field: 'confidence.selfCritique',
      message: `the self-critique did not match the schema: ${issues}`,
    });
  }
  return ok(validated.data);
}

/** A 1-5 rubric score on the 0-100 scale the confidence components use. */
export function rubricScoreToConfidence(score: number): number {
  const clamped = Math.min(5, Math.max(1, score));
  return Math.round(((clamped - 1) / 4) * 100);
}

/**
 * Map a self-critique onto the component values it can honestly speak to.
 *
 * Only the self estimates are mapped: `resolver_confidence`, `license_risk`
 * and `test_coverage` come from their own phases and are never invented here.
 */
export function toSelfCritiqueComponents(report: SelfCritiqueReport): SelfCritiqueComponents {
  return {
    self_confidence: report.self_confidence,
    wiring_correctness: rubricScoreToConfidence(report.wiring_self_score),
    unnecessary_changes: rubricScoreToConfidence(report.unnecessary_changes_self_score),
    respects_patterns: rubricScoreToConfidence(report.patterns_self_score),
  };
}

/**
 * Run the self-critique pass: render the prompt, ask the provider, validate.
 *
 * A provider failure becomes the existing AI_PROVIDER_ERROR (carrying the
 * provider's own classification) and a malformed reply becomes a CONFIG_ERROR
 * with the field — the caller decides whether a second opinion is mandatory.
 */
export async function runSelfCritique(
  provider: ChatProvider,
  input: SelfCritiqueInput
): Promise<Result<SelfCritiqueReport, StitchError>> {
  const { system, user } = selfCritiquePrompt(input.diff, input.context ?? '');
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let reply = '';
  try {
    for await (const chunk of streamChat(
      provider,
      messages,
      [],
      input.signal !== undefined ? { signal: input.signal } : undefined
    )) {
      if (chunk.type === 'text') {
        reply += chunk.text;
      } else if (chunk.type === 'error') {
        // streamChat normalises provider failures into an error chunk rather
        // than throwing, so the classification has to be read from the stream.
        return err({
          code: 'AI_PROVIDER_ERROR',
          provider: chunk.error.providerName,
          message: chunk.error.message,
        });
      }
    }
  } catch (cause) {
    const providerError = asProviderError(cause, provider.name);
    return err({
      code: 'AI_PROVIDER_ERROR',
      provider: providerError.providerName,
      message: providerError.message,
    });
  }
  return parseSelfCritique(reply);
}
