// Runtime Provider Switch (P-146).
//
// A single backend can go down or rate-limit mid-job. `ProviderManager` owns
// the failover order and which provider is live; `switchProvider` moves to the
// next candidate that satisfies the provider contract (P-131) and the model
// policy (P-135 capability, P-143 tool-calling block), republishes the active
// provider for CLI/web, and records the switch on the P-145 audit trail.
//
// The loop (P-140) consumes `ProviderManager.active` and restarts the current
// turn on a new provider when a retryable error exhausts `withRetry` (P-138),
// bounded by a per-job switch budget so two flaky providers cannot bounce
// forever.

import { err, ok, type Result } from 'neverthrow';
import { logger } from '../logger/index.js';
import { type StitchError } from '../result/index.js';
import { conformsToChatProvider, isRetryableError, type ChatProvider } from './provider.js';
import { isToolCallingBlocked, MODELS, type ModelSpec } from './models.js';
import { defaultToolCallPolicyConfig, type ToolCallPolicyConfig } from './block.js';
import { setActiveProvider } from './registry.js';
import { PROVIDER_ENV_KEYS, resolveApiKey, type ProviderConfigInput } from './config.js';
import type { ProviderError } from './types.js';
import { newAuditId, nowIso, type AiAuditLog, type AiProviderSwitchRecord } from './audit.js';

/**
 * Per-job cap on automatic switches (spec handoff: "e.g. max 2 switches").
 * Bounding this is what stops two mutually-failing providers from bouncing
 * the loop forever.
 */
export const DEFAULT_MAX_FAILOVER_SWITCHES = 2;

/** Everything a caller needs to surface a switch in the UI/CLI (P-216/P-218). */
export interface ProviderSwitchInfo extends AiProviderSwitchRecord {
  id: string;
  ts: string;
}

/**
 * Owns the active provider and the failover order for one job.
 *
 * The constructor takes live provider instances (built by
 * `createProvider`), not ids: a failover target must be constructed and
 * key-resolved before it is worth switching to.
 */
export class ProviderManager {
  readonly #failover: ChatProvider[];
  #active: ChatProvider;
  #cursor = -1;
  #switches = 0;

  constructor(primary: ChatProvider, failoverOrder: ChatProvider[]) {
    this.#active = primary;
    // The primary is not a failover target for itself.
    this.#failover = failoverOrder.filter(p => p !== primary);
  }

  /** The provider currently serving calls. */
  get active(): ChatProvider {
    return this.#active;
  }

  /** Failover candidates, in order. */
  get failoverOrder(): readonly ChatProvider[] {
    return this.#failover;
  }

  /** Automatic switches performed through {@link switchToNext}. */
  get switchCount(): number {
    return this.#switches;
  }

  /**
   * Point the manager at a specific provider (a manual switch, or accepting
   * the result of {@link switchProvider}). The cursor moves with it so a
   * subsequent `switchToNext` continues after the current provider rather than
   * bouncing back to it.
   */
  setActive(provider: ChatProvider): void {
    this.#active = provider;
    const index = this.#failover.indexOf(provider);
    if (index >= 0) this.#cursor = index;
  }

  /**
   * Advance to the next candidate in failover order.
   *
   * Returns `null` once the list is exhausted. The spec fixes this signature
   * (`ChatProvider | null`) — unlike {@link switchProvider} it performs no
   * policy validation, so callers that care about capability should go through
   * `switchProvider`.
   *
   * @param reason - Why the switch is happening (surfaced to callers/audit)
   */
  switchToNext(reason: string): ChatProvider | null {
    this.#cursor++;
    if (this.#cursor >= this.#failover.length) {
      this.#cursor = this.#failover.length;
      return null;
    }
    this.#switches++;
    const next = this.#failover[this.#cursor];
    if (next === undefined) return null;
    logger.warn({ reason, from: this.#active.id, to: next.id }, 'ai: switching provider');
    return next;
  }
}

export interface SwitchProviderOptions {
  /** The turn needs tools, so candidates must support them (P-135/P-143). */
  needsTools?: boolean;
  /** Minimum context window the task requires (P-135). */
  contextNeeded?: number;
  /** `[ai].overrideToolModels` overrides (P-143). */
  toolPolicy?: ToolCallPolicyConfig;
  /** Audit trail the switch is recorded on (P-145). */
  audit?: AiAuditLog;
}

/**
 * Move to the next failover provider that satisfies the contract and model
 * policy, publish it as active, and audit the switch.
 *
 * @param manager - The job's provider manager
 * @param reason - Why the switch is happening
 * @param opts - Policy inputs + audit sink
 * @returns `ok(newProvider)`, or `err('NO_FAILOVER')` once every remaining
 *   candidate has been tried or rejected
 */
export function switchProvider(
  manager: ProviderManager,
  reason: string,
  opts: SwitchProviderOptions = {}
): Result<ChatProvider, StitchError> {
  const toolPolicy = opts.toolPolicy ?? defaultToolCallPolicyConfig;
  const from = manager.active;
  const exhausted: string[] = [];

  for (;;) {
    const candidate = manager.switchToNext(reason);
    if (candidate === null) {
      return err({
        code: 'NO_FAILOVER',
        message: `No failover provider available after ${from.id}`,
        exhausted,
      });
    }

    const rejection = candidateRejection(candidate, opts, toolPolicy);
    if (rejection !== undefined) {
      exhausted.push(`${candidate.id}: ${rejection}`);
      logger.warn(
        { candidate: candidate.id, rejection },
        'ai: failover candidate rejected by policy'
      );
      continue;
    }

    manager.setActive(candidate);
    // Publish for CLI/web (P-196/P-198, P-216).
    setActiveProvider(candidate);

    const record: ProviderSwitchInfo = {
      id: newAuditId(),
      ts: nowIso(),
      reason,
      from: from.id,
      to: candidate.id,
      fromProvider: from.provider,
      toProvider: candidate.provider,
      fromModel: from.model,
      toModel: candidate.model,
    };
    opts.audit?.recordSwitch(record);

    return ok(candidate);
  }
}

/**
 * Model spec for a provider, without ever throwing.
 *
 * `getModel` throws for ids outside the curated registry; plugin and local
 * backends legitimately live outside it, so an unknown id simply skips the
 * capability gates (same precedent as the registry's own resolver).
 */
function candidateModelSpec(candidate: ChatProvider): ModelSpec | undefined {
  return MODELS.find(m => m.id === candidate.id || m.id === candidate.model);
}

/**
 * Why a candidate cannot serve the current turn, or `undefined` when it can.
 *
 * Runs the two policy gates the spec names: the P-131 contract guard and the
 * P-135/P-143 model policy.
 */
function candidateRejection(
  candidate: ChatProvider,
  opts: SwitchProviderOptions,
  toolPolicy: ToolCallPolicyConfig
): string | undefined {
  try {
    conformsToChatProvider(candidate);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return `contract validation failed: ${detail}`;
  }

  const spec = candidateModelSpec(candidate);
  if (spec === undefined) {
    // Unknown to the curated registry — nothing to enforce.
    return undefined;
  }

  if (opts.needsTools === true) {
    if (!spec.supportsTools) {
      return `model ${spec.id} does not support tool calling`;
    }
    if (isToolCallingBlocked(spec, toolPolicy)) {
      return `tool calling is blocked by default for model ${spec.id}`;
    }
  }

  if (opts.contextNeeded !== undefined && spec.contextWindow < opts.contextNeeded) {
    return `model ${spec.id} context window ${spec.contextWindow} < ${opts.contextNeeded}`;
  }

  return undefined;
}

/**
 * Whether a failover target is worth constructing: it must be a known
 * provider that can resolve a credential.
 *
 * NOTE on the spec's wording: P-146 step 1 describes the order as coming from
 * config `[ai].failover`, but this repo's `ConfigSchema` (P-009) has no `ai`
 * block — provider blocks are flat (`openrouter` / `anthropic` / `ollama`) and
 * keys resolve through `resolveApiKey`. So the order is passed in as ids and
 * filtered here, rather than inventing a config section that does not exist.
 */
export function isFailoverCandidate(providerId: string): boolean {
  if (!(providerId in PROVIDER_ENV_KEYS)) return false;
  return (
    resolveApiKey({ provider: providerId as ProviderConfigInput['provider'], model: '' }) !==
    undefined
  );
}

/**
 * Build the failover order from provider ids, dropping any that cannot be
 * constructed (unknown id, or no resolvable key).
 *
 * @param primaryId - Provider already in use; excluded from the order
 * @param failoverIds - Ordered provider ids to consider
 * @param build - Factory used to construct each surviving provider
 * @returns `ok(providers)` in order, or `err(INVALID_PROVIDER)` when the first
 *   constructable candidate fails
 */
export function buildFailoverOrder<T extends ChatProvider>(
  primaryId: string,
  failoverIds: readonly string[],
  build: (id: string) => Result<T, StitchError>
): Result<T[], StitchError> {
  const order: T[] = [];
  for (const id of failoverIds) {
    if (id === primaryId) continue;
    if (!isFailoverCandidate(id)) {
      logger.warn({ provider: id }, 'ai: failover provider dropped (unknown or no key)');
      continue;
    }
    const built = build(id);
    if (built.isErr()) {
      if (order.length === 0) return err(built.error);
      logger.warn(
        { provider: id, reason: built.error.code },
        'ai: failover provider failed to build'
      );
      continue;
    }
    order.push(built.value);
  }
  return ok(order);
}

/**
 * Whether a failed provider error is worth failing over for.
 *
 * Only retryable errors justify a switch: an `auth` failure means the
 * credentials are wrong, and moving to another backend would just fail the same
 * way while burning budget.
 */
export function shouldFailover(error: ProviderError): boolean {
  return isRetryableError(error);
}
