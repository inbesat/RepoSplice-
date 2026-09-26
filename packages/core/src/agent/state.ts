// P-159 — the agent state machine.
//
// WHY THIS EXISTS. The agent loop is not one function; it is a lifecycle that a
// CLI, a web UI, a resume path, and an audit trail all need to observe. Before
// this, "is the agent waiting for a human?" was answerable only by reading the
// loop's local variables. After it, the answer is one value with an explicit
// set of legal moves, and an illegal move is a typed error rather than a
// silently impossible state.
//
// THE GUARD IS THE POINT, NOT THE ENUM. The phase's real requirement is
// "cannot execute a tool while in `waiting_*`" (acceptance criterion 4). That is
// enforced by two separate mechanisms, because there are two different
// questions and conflating them is the trap:
//
//   1. `canTransition('tool_executing')` answers "is this move in the map".
//      `waiting_user -> tool_executing` IS legal: it is the *return* from a
//      human round trip that a tool started, and forbidding it would make
//      `ask_user`'s answer unreturnable.
//   2. `canStartTool()` answers "may a tool execution BEGIN right now". That is
//      false in both `waiting_*` states, and the loop checks it immediately
//      before calling `execute`. This is what actually prevents a tool from
//      starting behind an outstanding human decision.
//
// EVERY NON-TERMINAL STATE HAS AN EDGE TO `error`. That is what makes the
// acceptance criterion "fatal error -> `error` state, not stuck `iterating`"
// structural rather than a promise: there is no state from which failure is
// unrepresentable.
//
// STATE NAMES ARE FROZEN. The handoff note says web P-216 maps them, so these
// nine literals plus `idle` are a public contract, and adding one is an ADR.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/**
 * The agent lifecycle states (P-159).
 *
 * Identical to `AgentStateName` in `ai/types.ts` — two unions of the same
 * string literals are the same type to TypeScript, so the loop can speak about
 * states without this module and `ai/` never has to import from `agent/`. A
 * drift between the two declarations would be a type error at every call site;
 * `state.test.ts` asserts it explicitly so the failure is legible.
 */
export type AgentState =
  | 'idle'
  | 'loading'
  | 'preparing'
  | 'tool_executing'
  | 'waiting_approval'
  | 'waiting_user'
  | 'streaming'
  | 'iterating'
  | 'done'
  | 'error';

/**
 * Every state, in lifecycle order. Frozen: this is the set P-216 maps.
 *
 * An array rather than a record because callers iterate it (UI pickers, tests,
 * the drift check) and an array has a meaningful order.
 */
export const AGENT_STATES: readonly AgentState[] = [
  'idle',
  'loading',
  'preparing',
  'streaming',
  'tool_executing',
  'waiting_approval',
  'waiting_user',
  'iterating',
  'done',
  'error',
] as const;

/**
 * The adjacency map (P-159 step 1).
 *
 * Read it as the loop's actual shape:
 *
 *   idle -> loading -> preparing -> streaming
 *   streaming -+-> tool_executing -> iterating -+-> streaming
 *               |                                  |
 *               +-> waiting_approval -> iterating -+
 *               |                      \-> error
 *               +-> done
 *               \-> error
 *   tool_executing -> waiting_user -> tool_executing   (a tool's human round
 *                                                       trip, mid-execution)
 *
 * `done` and `error` are terminal. Every other state can reach `error`.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<AgentState, readonly AgentState[]>> = {
  idle: ['loading'],
  loading: ['preparing', 'error'],
  preparing: ['streaming', 'error'],
  // The policy (P-157) decides here: `allow` -> tool_executing,
  // `ask` -> waiting_approval, `stop` -> done, fatal -> error.
  streaming: ['tool_executing', 'waiting_approval', 'done', 'error'],
  // A tool may suspend itself for a human (P-156 `ask_user`) and come back.
  tool_executing: ['iterating', 'waiting_user', 'error'],
  // The gate resolved. Control goes back to the loop, which then decides
  // whether to execute — it does not execute from inside the waiting state.
  waiting_approval: ['iterating', 'error'],
  // The answer arrived; the tool that asked is still running.
  waiting_user: ['tool_executing', 'iterating', 'error'],
  iterating: ['streaming', 'tool_executing', 'done', 'error'],
  done: [],
  error: [],
} as const;

/** One observed move. */
export interface StateChange {
  from: AgentState;
  to: AgentState;
  /** ISO timestamp, or whatever `now()` returned. */
  at: string;
}

/** Is `to` reachable from `from`? */
export function canTransition(from: AgentState, to: AgentState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** `done` and `error` admit no further moves. */
export function isTerminalState(state: AgentState): boolean {
  return LEGAL_TRANSITIONS[state].length === 0;
}

/** The two states in which a human decision is outstanding. */
export function isWaitingState(state: AgentState): boolean {
  return state === 'waiting_approval' || state === 'waiting_user';
}

/**
 * May a tool execution START right now (P-159 acceptance criterion 4)?
 *
 * False in both `waiting_*` states. Distinct from `canTransition`, because
 * `waiting_user -> tool_executing` is a legal *return* from a human round trip
 * — this asks whether a *new* tool call may begin, which is exactly the HIL
 * pause the phase exists to protect.
 */
export function canStartToolFrom(state: AgentState): boolean {
  return !isWaitingState(state);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Where the current state is kept so a job can resume (P-159).
 *
 * A port, not a table. The spec asks for "the P-239 job record via a `state`
 * column", but `store/schema.ts` reserves the `jobs` table extension for
 * P-239/P-241/P-303/P-309 in that file's own header, and `src/orchestration/`
 * does not exist yet. Writing a `state` column here would collide with the
 * phase that owns it, so P-159 owns the *contract* and the orchestrator wires
 * the real store when P-239 lands.
 */
export interface AgentStateStore {
  /** The persisted state for `jobId`, or `null` if this job has no history. */
  load(jobId: string): Result<AgentState | null, StitchError>;
  /** Persist `state` for `jobId`. Called on every accepted transition. */
  save(jobId: string, state: AgentState): Result<void, StitchError>;
}

/**
 * An in-memory store: correct for a single process, useless across a restart.
 *
 * Shipped as the default so a caller with no database still gets persistence
 * semantics (load never finds a state, save always succeeds) rather than a
 * null-object that pretends to have saved.
 */
export function memoryStateStore(): AgentStateStore {
  const rows = new Map<string, AgentState>();
  return {
    load(jobId: string): Result<AgentState | null, StitchError> {
      return ok(rows.get(jobId) ?? null);
    },
    save(jobId: string, state: AgentState): Result<void, StitchError> {
      rows.set(jobId, state);
      return ok(undefined);
    },
  };
}

/** Is `value` one of the frozen state names? Guards a store's untrusted read. */
export function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && (AGENT_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

/** Construction options. Every field is optional so `new AgentStateMachine()` works. */
export interface AgentStateMachineOptions {
  /** Starting state. Defaults to `idle`. */
  initial?: AgentState;
  /** Called after every accepted transition, never after a refused one. */
  onChange?: (change: StateChange) => void;
  /** Where to persist. Omit for a machine that does not survive the process. */
  store?: AgentStateStore;
  /** Which job's state to persist. Required for `store` to do anything. */
  jobId?: string;
  /** Clock, injectable so tests do not depend on wall time. */
  now?: () => string;
}

/** Bound on the retained transition log, so a long job cannot grow without limit. */
export const MAX_STATE_HISTORY = 500;

/**
 * The agent state machine (P-159).
 *
 * Deterministic: the same transition sequence from the same initial state
 * produces the same history, and `canTransition` consults only the frozen
 * adjacency map plus the current state. There is no clock in the decision and
 * no hidden mutable state beyond `state` itself.
 */
export class AgentStateMachine {
  #state: AgentState;
  readonly #store: AgentStateStore | undefined;
  readonly #jobId: string | undefined;
  readonly #now: () => string;
  readonly #history: StateChange[] = [];
  #dropped = 0;

  /**
   * Notified after every accepted transition. Public and mutable so a late
   * subscriber (P-216's web socket) can attach after construction.
   */
  onChange: ((change: StateChange) => void) | undefined;

  constructor(options: AgentStateMachineOptions = {}) {
    this.#state = options.initial ?? 'idle';
    this.onChange = options.onChange;
    this.#store = options.store;
    this.#jobId = options.jobId;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** The current state. */
  get state(): AgentState {
    return this.#state;
  }

  /** Every accepted transition, oldest first, capped at {@link MAX_STATE_HISTORY}. */
  get history(): readonly StateChange[] {
    return this.#history;
  }

  /** Transitions discarded because the log hit its cap. */
  get droppedTransitions(): number {
    return this.#dropped;
  }

  /** Is a move to `to` legal right now? */
  canTransition(to: AgentState): boolean {
    return canTransition(this.#state, to);
  }

  /** May a tool execution start right now? See {@link canStartToolFrom}. */
  canStartTool(): boolean {
    return canStartToolFrom(this.#state);
  }

  /** Has the lifecycle finished, one way or the other? */
  get isTerminal(): boolean {
    return isTerminalState(this.#state);
  }

  /**
   * Move to `to`.
   *
   * Returns `ILLEGAL_TRANSITION` rather than throwing, so an impossible move
   * is a value the caller must handle. The spec's "throws `err(...)`" is
   * self-contradictory — `err` is a value, not something to throw — and the
   * no-throw rule decides it.
   *
   * An illegal move leaves the state and the log completely untouched, and does
   * NOT call `onChange`: the subscriber is told what happened, not what was
   * refused.
   *
   * @param to - The requested state
   * @returns `ok` on an accepted move, `ILLEGAL_TRANSITION` otherwise
   */
  transition(to: AgentState): Result<void, StitchError> {
    if (!canTransition(this.#state, to)) {
      return err({
        code: 'ILLEGAL_TRANSITION',
        message:
          `Cannot move from "${this.#state}" to "${to}": ` +
          (LEGAL_TRANSITIONS[this.#state].length === 0
            ? `"${this.#state}" is terminal`
            : `legal targets are ${LEGAL_TRANSITIONS[this.#state].join(', ')}`),
        from: this.#state,
        to,
      });
    }
    const change: StateChange = { from: this.#state, to, at: this.#now() };
    this.#state = to;
    this.#record(change);
    // Persist after the in-memory move, so a failing store cannot desynchronise
    // the two. A store failure is reported to the caller but does NOT undo the
    // transition: the agent really is in that state, and pretending otherwise
    // would leave `state` disagreeing with the loop that drove it.
    const saved = this.#persist();
    this.onChange?.(change);
    return saved;
  }

  /**
   * Load the persisted state, if the store has one.
   *
   * Only a value that is a real state name is adopted; a store that returns
   * something else (a renamed literal, a corrupt row) is ignored and reported,
   * because adopting an unknown state would poison every later transition.
   *
   * @returns `ok(state)` when restored, `ok(null)` when there was nothing to
   *   restore or the stored value was not a valid state
   */
  restore(): Result<AgentState | null, StitchError> {
    if (this.#store === undefined || this.#jobId === undefined) return ok(null);
    const loaded = this.#store.load(this.#jobId);
    if (loaded.isErr()) return loaded;
    const value = loaded.value;
    if (value === null) return ok(null);
    if (!isAgentState(value)) {
      return ok(null);
    }
    if (value !== this.#state) {
      const change: StateChange = { from: this.#state, to: value, at: this.#now() };
      this.#state = value;
      this.#record(change);
      this.onChange?.(change);
    }
    return ok(value);
  }

  /** Write the current state, ignoring whether a store is configured. */
  #persist(): Result<void, StitchError> {
    if (this.#store === undefined || this.#jobId === undefined) return ok(undefined);
    return this.#store.save(this.#jobId, this.#state);
  }

  #record(change: StateChange): void {
    this.#history.push(change);
    if (this.#history.length > MAX_STATE_HISTORY) {
      this.#history.shift();
      this.#dropped += 1;
    }
  }
}
