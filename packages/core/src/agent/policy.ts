// P-157 — the Autonomy Policy Engine.
//
// THE SINGLE PLACE AUTONOMY RULES LIVE (P-157 handoff: "anyone changing the
// hybrid model edits this + config, not the tools"). The tool loop asks this
// before every execution instead of hardcoding "gated means ask", so changing
// the hybrid model is a config edit rather than a code edit in nine tools.
//
// DETERMINISTIC BY CONSTRUCTION (acceptance: "same inputs -> same decision").
// The policy holds a frozen config and no mutable state, so evaluating the
// same tool twice in one run — or across two runs — cannot diverge.
//
// DENY IS ABSOLUTE AND EVALUATED FIRST. A tool on the deny list is refused
// regardless of its own `autonomy` flag or any override. If overrides were
// consulted first, an override could re-enable a tool an operator explicitly
// blacklisted, which is exactly backwards.
//
// `run_build` is always allowed: it is verify-only (P-155 builds nothing on the
// host and writes nothing), so gating it would add a human prompt before every
// verification and buy no safety.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { AiAuditLog } from '../ai/audit.js';
import type { Autonomy, AutonomyOverride, AutonomyPolicyConfig, PolicyDecision } from './types.js';

/** What {@link AutonomyPolicy.evaluate} may write to. */
export interface PolicyContext {
  /** P-145 audit sink; every decision is recorded with its reason. */
  audit?: AiAuditLog;
}

/** Tools that are gated by default (P-157 step 2). */
export const DEFAULT_GATED_TOOLS: readonly string[] = ['propose_component', 'ask_user'];

/**
 * Tools that are always allowed regardless of configuration.
 *
 * `run_build` only reads and reports; it never writes to the host tree
 * (P-155), so a gate in front of it would be pure friction.
 */
export const ALWAYS_ALLOWED_TOOLS: readonly string[] = ['run_build'];

/**
 * The autonomy policy (P-157).
 *
 * Immutable and injectable: construct with a config, then evaluate as many
 * times as needed. There is no global state and no default-constructed
 * singleton, so tests and the production loop share the same code path.
 */
export class AutonomyPolicy {
  readonly #config: AutonomyPolicyConfig;
  readonly #overrides: ReadonlyMap<string, Autonomy>;
  readonly #denied: ReadonlySet<string>;

  constructor(config: AutonomyPolicyConfig) {
    this.#config = {
      overrides: [...config.overrides],
      defaultMode: config.defaultMode,
      denyTools: [...config.denyTools],
    };
    // Built once in the constructor: a later caller mutating the array it
    // passed in cannot change this policy's behaviour.
    this.#overrides = new Map(this.#config.overrides.map(o => [o.tool, o.mode]));
    this.#denied = new Set(this.#config.denyTools);
  }

  /** The frozen config this policy was built from. */
  get config(): AutonomyPolicyConfig {
    return this.#config;
  }

  /**
   * Decide what happens to one tool execution.
   *
   * Resolution order (P-157 step 2):
   *   1. `denyTools` -> `deny`, regardless of anything else.
   *   2. always-allowed allowlist -> `allow`.
   *   3. a per-tool `override` -> that mode.
   *   4. the tool's own `autonomy` flag.
   *   5. `defaultMode`.
   * `auto` maps to `allow`, `gated` maps to `ask`.
   */
  evaluate(toolName: string, toolAutonomy: Autonomy, ctx: PolicyContext = {}): PolicyDecision {
    const decision = this.decide(toolName, toolAutonomy);
    // P-157 step 5: every decision is recorded with its reason. A failing audit
    // must not block execution, so the log is best-effort by construction
    // (AiAuditLog never throws).
    ctx.audit?.recordPolicyDecision({
      tool: toolName,
      action: decision.action,
      reason: decision.reason,
      effectiveMode: this.effectiveMode(toolName, toolAutonomy),
      requestedMode: toolAutonomy,
      denied: this.#denied.has(toolName),
    });
    return decision;
  }

  /** The decision without touching the audit trail. */
  decide(toolName: string, toolAutonomy: Autonomy): PolicyDecision {
    if (this.#denied.has(toolName)) {
      return {
        action: 'deny',
        reason: `Tool "${toolName}" is on the autonomy deny list and must never run`,
      };
    }
    if (ALWAYS_ALLOWED_TOOLS.includes(toolName)) {
      return {
        action: 'allow',
        reason: `Tool "${toolName}" is verify-only and is always allowed`,
      };
    }
    const override = this.#overrides.get(toolName);
    if (override !== undefined) {
      return {
        action: override === 'auto' ? 'allow' : 'ask',
        reason: `Tool "${toolName}" is overridden to "${override}" by policy`,
      };
    }
    if (toolAutonomy === 'gated') {
      return {
        action: 'ask',
        reason: `Tool "${toolName}" is gated and requires human approval`,
      };
    }
    return {
      action: 'allow',
      reason: `Tool "${toolName}" is auto and runs without a gate`,
    };
  }

  /** The mode actually applied, for reporting and for the audit row. */
  effectiveMode(toolName: string, toolAutonomy: Autonomy): Autonomy {
    if (ALWAYS_ALLOWED_TOOLS.includes(toolName)) return 'auto';
    return this.#overrides.get(toolName) ?? toolAutonomy;
  }

  /** Register a per-tool override, returning a new policy (never mutating). */
  withOverride(override: AutonomyOverride): AutonomyPolicy {
    const next = this.#config.overrides.filter(o => o.tool !== override.tool);
    next.push(override);
    return new AutonomyPolicy({
      ...this.#config,
      overrides: next,
    });
  }

  /** Add a tool to the deny list, returning a new policy (never mutating). */
  withDeniedTool(tool: string): AutonomyPolicy {
    if (this.#denied.has(tool)) return this;
    return new AutonomyPolicy({
      ...this.#config,
      denyTools: [...this.#config.denyTools, tool],
    });
  }
}

/**
 * The shipped default policy (P-157 step 3).
 *
 * `defaultMode: 'auto'`, the gated list is empty because the gate lives on
 * each tool's own `autonomy` flag (`propose_component` and `ask_user` declare
 * themselves `gated`), and the deny list starts empty.
 *
 * The `[agent]` config block (P-009) is applied by the caller: map
 * `autonomy.auto` / `autonomy.gated` onto overrides before constructing.
 */
export function defaultAutonomyPolicy(): AutonomyPolicy {
  return new AutonomyPolicy({
    overrides: [],
    defaultMode: 'auto',
    denyTools: [],
  });
}

/**
 * Build a policy from the P-009 `[agent]` config block plus a base policy.
 *
 * The config block is `{ auto: string[], gated: string[] }`. Both lists are
 * applied as overrides, which means the config is authoritative over a tool's
 * own flag — that is the point of having an override layer at all. Later
 * entries win, so a name appearing in both lists resolves to the gated entry
 * when the caller lists `gated` last; callers should not rely on that, and
 * `assertNoConflicts` exists for them.
 */
export function policyFromAgentConfig(
  block: { auto: readonly string[]; gated: readonly string[] },
  base: AutonomyPolicy = defaultAutonomyPolicy()
): Result<AutonomyPolicy, StitchError> {
  const conflicts = block.auto.filter(name => block.gated.includes(name));
  if (conflicts.length > 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'autonomy',
      message:
        'The same tool appears in both autonomy.auto and autonomy.gated: ' + conflicts.join(', '),
    });
  }
  let policy = base;
  for (const tool of block.auto) {
    policy = policy.withOverride({ tool, mode: 'auto' });
  }
  for (const tool of block.gated) {
    policy = policy.withOverride({ tool, mode: 'gated' });
  }
  return ok(policy);
}
