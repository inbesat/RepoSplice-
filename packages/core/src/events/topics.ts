// P-241 — Orchestration: the event topics.
//
// One typed spine. Every module publishes here and nothing publishes to the
// WebSocket hub directly, which is what makes the CLI's progress view (P-199), the
// web thinking stream (P-216) and the job history (P-224) read from ONE contract
// instead of three ad-hoc channels.
//
// The topic names and payload shapes are a CONTRACT (the handoff says so
// explicitly: "they're the CLI/web contract"), so they are declared once here and
// referenced by producers, never re-typed at a call site.

import { z } from 'zod';

/** Every topic on the bus. */
export const TOPICS = [
  'pipeline.stage',
  'job.created',
  'job.started',
  'job.updated',
  'job.resumed',
  'job.cancelled',
  'job.failed',
  'job.succeeded',
  'agent.reasoning',
  'agent.tool',
  'license.verdict',
  'deps.merged',
  'sandbox.run',
  'progress',
] as const;

export type Topic = (typeof TOPICS)[number];

/** The topics whose payloads are high-frequency and therefore coalescible. */
export const COALESCIBLE_TOPICS: readonly Topic[] = ['progress', 'agent.reasoning'];

/**
 * The topics a subscriber may name.
 *
 * A trailing `.*` is a WILDCARD over the suffix, so `job.*` matches `job.created`
 * and `job.succeeded` but not `job` or `pipeline.stage`. An exact name matches
 * itself. Nothing else is a pattern — no `**`, no mid-string `*` — because a
 * richer grammar in an event bus is a footgun nobody asked for.
 */
export function matchesTopic(pattern: string, topic: Topic): boolean {
  if (pattern === topic) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return topic.startsWith(`${prefix}.`);
  }
  return false;
}

/** Every topic a pattern matches, for a subscriber that wants the list. */
export function topicsFor(pattern: string): Topic[] {
  return TOPICS.filter(topic => matchesTopic(pattern, topic));
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * The envelope every event carries on the wire.
 *
 * Validated with zod at the WS boundary (the one place loose data crosses), which
 * is the P-009 spirit: schema-check where data enters, keep the in-process path
 * typed rather than re-parsing it on every publish.
 */
export const eventEnvelopeSchema = z.object({
  topic: z.string().min(1),
  ts: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** A pipeline stage transition (P-238's `PipelineEvent`). */
export interface PipelineStagePayload {
  stage: string;
  from: string;
  to: string;
}

/** A job lifecycle change (P-239's `JobEvent`). */
export interface JobPayload {
  jobId: string;
  kind: string;
  status?: string;
  from?: string;
  to?: string;
  owner?: string;
}

/** A resume (P-240's `JobResumedEvent`). */
export interface JobResumedPayload extends JobPayload {
  fromStage: string;
  reason: string;
  mode: string;
}

/** An agent step (P-162's shape). */
export interface AgentPayload {
  iteration?: number;
  tool?: string;
  detail?: string;
  /** P-242: an intra-stage fraction, so an agent step can move the bar. */
  percent?: number;
}

/** A progress tick (P-242) — the coalescible one. */
export interface ProgressPayload {
  /** The stage the bar is currently on. */
  stage: string;
  /** The OVERALL percent, 0–100 (per-stage detail lives in the model, P-242). */
  percent?: number;
  /** The activity label, e.g. "installing deps npm". */
  detail?: string;
  /** P-242 additions: the aggregated snapshot, so a consumer renders one event. */
  overall?: number;
  etaMs?: number;
  phase?: string;
}

/** The payload type per topic, so a publisher cannot send the wrong shape. */
export interface TopicPayloads {
  'pipeline.stage': PipelineStagePayload;
  'job.created': JobPayload;
  'job.started': JobPayload;
  'job.updated': JobPayload;
  'job.resumed': JobResumedPayload;
  'job.cancelled': JobPayload;
  'job.failed': JobPayload;
  'job.succeeded': JobPayload;
  'agent.reasoning': AgentPayload;
  'agent.tool': AgentPayload;
  'license.verdict': Record<string, unknown>;
  'deps.merged': Record<string, unknown>;
  'sandbox.run': Record<string, unknown>;
  progress: ProgressPayload;
}

/** The payload type for a topic. */
export type PayloadFor<T extends Topic> = TopicPayloads[T];
