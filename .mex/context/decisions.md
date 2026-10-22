---
name: decisions
description: Key architectural and technical decisions with reasoning. Load when making design choices or understanding why it is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure
  - target: context/stack.md
    condition: when a decision relates to technology choice
  - target: context/agent-loop.md
    condition: when a decision relates to the agent loop or autonomy
# Decisions usually ground sparsely; add only symbols that implement the decision.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh2:64:<base64url>" }
grounds_to: []
last_updated: 2026-10-22
---

# Decisions

Every entry below maps to an `## ADR-NNN` block in `project-plans/DECISIONS.md`.
The ADR file is the source of truth; this file is the short, loadable version.

## Decision Log

<!-- mex:entity
id: mx_01M5G2KESE7JKNV5GEQA0GVXZT
type: decision
status: promoted
revision: 1
-->
### Bun workspaces monorepo with strict package isolation

**Date:** 2026-08-30
**Status:** Active
**Decision:** The repo is a Bun workspaces monorepo; `packages/core` owns all business logic and `packages/cli` and `packages/web` consume it only through the public barrel `@repo-stitcher/core`.
**Reasoning:** ADR-002 rejected a shared package because "then both edit it -> conflicts". Isolation keeps the core's API surface deliberate and makes the barrel the single visible contract.
**Alternatives considered:** A shared package (rejected in ADR-002; reintroduced in ADR-125 for cross-cutting wire DTOs only, with one owner). Importing `core/src/*` internals from CLI/web (rejected — enforced by ESLint `no-restricted-imports` and `bun run lint:deps`).
**Consequences:** New core capability is unusable until it is exported from `packages/core/src/index.ts`. On identifier collision the barrel ALIASES (`Conflict` -> `DepsConflict`), it never renames the original.

<!-- mex:entity
id: mx_01M5G2KE8BTXPVWK7NPWE6F7Z8
type: decision
status: promoted
revision: 1
-->
### Persistence is raw SQLite, no ORM

**Date:** 2026-08-30
**Status:** Active
**Decision:** All persistence uses raw SQLite with hand-written typed helpers; no ORM.
**Reasoning:** ADR-003 — the schema is small, explicit, and hand-versioned; the job/provenance/audit queries are query-specific and an ORM's abstraction would be in the way.
**Alternatives considered:** Prisma, Drizzle, TypeORM, Sequelize, Knex (all in the ESLint deny list and the dependency-cruiser forbidden set).
**Consequences:** Queries and schema changes are hand-written. `better-sqlite3` is forbidden — use `bun:sqlite`. The audit-log adapter uses `node:sqlite` because `openDb` is Bun-only (ADR-092), so it cannot run under Vitest without the adapter.

<!-- mex:entity
id: mx_01M5G2KDQPJF2GSPDYRXVA7AQJ
type: decision
status: promoted
revision: 1
-->
### Errors are values, never exceptions

**Date:** 2026-08-30
**Status:** Active
**Decision:** Public functions return `Result<T, StitchError>` (neverthrow); `throw` is an ESLint error.
**Reasoning:** ADR-013 — the pipeline state machine, the agent error table and the CLI exit map all need total, explicit failure classification. Exceptions make that classification non-exhaustive.
**Alternatives considered:** Throwing typed error classes (rejected — the classification stays implicit and the exit map becomes incomplete).
**Consequences:** Every failure path returns `err(...)`. The CLI maps results to exit codes in `packages/cli/src/errors.ts` through `exitCodeForResult()`.

<!-- mex:entity
id: mx_01M5G2KD4WAG8VN5M85K70HT82
type: decision
status: promoted
revision: 1
-->
### Hybrid AI autonomy: auto for mechanical, gated for generative

**Date:** 2026-08-30
**Status:** Active
**Decision:** The agent loop auto-executes mechanical fixes and puts generative/ambiguous work behind human approval.
**Reasoning:** ADR-006 — a merge that stops for every trivial rename is unusable; a merge that invents bridging code unsupervised is unsafe.
**Alternatives considered:** Full autonomy (rejected — unreviewed generated code lands in a merged repo), fully manual (rejected — defeats the product).
**Consequences:** The autonomy policy is injected into the loop, never imported (ADR-030), so it is testable and per-run configurable. The loop cap is the admission gate; token and dollar budgets are separate budgets (ADR-037).

<!-- mex:entity
id: mx_01M5G2KCQ1VMXMZJ9JFTDNWEMK
type: decision
status: promoted
revision: 1
-->
### The Bus lives in core, the CLI is the WebSocket adapter

**Date:** 2026-08-30
**Status:** Active
**Decision:** Core owns the event bus and publishes typed envelopes; the CLI server adapts them onto WebSocket; the web app is a consumer.
**Reasoning:** ADR-065 — the transport is an adapter concern, not a core concern. Core delivery is synchronous and coalescible: a topic holds one slot.
**Alternatives considered:** SSE (rejected — no bidirectional channel), polling (rejected — latency), putting the WS layer in core (rejected — core would own a server).
**Consequences:** `packages/core/src/events/bus.ts` is a frozen contract. The web re-parses the same shape as `WsEnvelope` and owns reconnection (500 ms -> 30 s backoff, 15 s heartbeat). Progress is normalised, never summed, and the ETA is never invented (ADR-066).

<!-- mex:entity
id: mx_01M5G2KC7ZPC2SDWFQM46CZ3Z1
type: decision
status: promoted
revision: 1
-->
### Git work uses simple-git plus the real git-filter-repo binary

**Date:** 2026-08-30
**Status:** Active
**Decision:** Git operations go through simple-git wrappers and the system `git-filter-repo` binary; Git >= 2.40 is required.
**Reasoning:** ADR-004 — history-preserving merges need real filter-repo semantics (rewrite history to take a subtree). No JS reimplementation matches it exactly.
**Alternatives considered:** isomorphic-git (denied in TECH_STACK.md), hand-rolled history rewriting (rejected — fidelity risk on the merge's core promise).
**Consequences:** `git-filter-repo` is a system install, not an npm dependency, and is not bundled; `stitch doctor` gates the Git version. Tests must use fixture repos and exercise the real binary rather than mocking it.

<!-- mex:entity
id: mx_01M5G2KBR0Q9YPMGDPPB8TJDQG
type: decision
status: promoted
revision: 1
-->
### The core-to-web wire contract is frozen and CI-enforced

**Date:** 2026-10-20
**Status:** Active
**Decision:** Five paths are frozen: `packages/core/src/events/topics.ts`, `packages/core/src/events/bus.ts`, `packages/core/src/events/progress.ts`, `packages/core/src/jobs/types.ts`, `packages/web/src/lib/ws.ts`. Changing one requires an ADR plus a refreshed `contracts.freeze.json`.
**Reasoning:** ADR-124 — core and web are built by two lanes in parallel and the envelope is the seam between them; drift there silently breaks the live UI.
**Alternatives considered:** Review-by-convention (rejected — it already drifted once), versioning the socket (rejected — both sides ship together).
**Consequences:** `bun run check:contracts` exits non-zero on an unauthorised change. The authorisation marker must sit inside an `## ADR-.` section, one `contract-freeze: <path>` line per changed path — a marker outside an ADR section authorises nothing. `packages/shared` (ADR-125) exists for NEW cross-cutting wire DTOs and holds no frozen contract.

<!-- mex:entity
id: mx_01M5G2KB6BTP5XXMMP09QBFNTH
type: decision
status: promoted
revision: 1
-->
### One error and exit entrypoint in the CLI

**Date:** 2026-10-17
**Status:** Active
**Decision:** `packages/cli/src/errors.ts` is the single error and exit-code entry; commands return results and the entrypoint maps them.
**Reasoning:** ADR-088 — exit codes were pinned in two places and a `printStitchError` contract coexisted with an older `friendlyError` hint path; two tests pinned the old output.
**Alternatives considered:** Keeping `EXIT_*` constants in `cli.ts` (rejected — duplicated pin points).
**Consequences:** `ExitCode` is a const object, not a runtime enum, and `EXIT_BY_CODE` is a sparse map — unlisted codes fall through to `ERROR` (1). Commands must not call `process.exit` directly.

<!-- mex:entity
id: mx_01M5G2KAQ899AVCP6N5ZQKQNX4
type: decision
status: promoted
revision: 1
-->
### Names and paths are guarded in one place

**Date:** 2026-10-17
**Status:** Active
**Decision:** `packages/cli/src/paths.ts` is the single name/path guard: `validateName()` returns a boolean, `safeJoin()` does lexical containment, and the write deny-list normalises separators and case.
**Reasoning:** ADR-090 — the same validation was being re-implemented per call site; the CLI lane could only wire its own sites, so core subsystems had to be handled separately.
**Alternatives considered:** `realpath`-based containment (rejected — breaks when the target does not exist yet, which is the normal case for an output repo), per-call-site validation (rejected — duplicated, and the deny-list drifted).
**Consequences:** Any new CLI code that writes a path goes through `safeJoin()` and `validateName()`. Dedupe mutates the `used` Set rather than returning a new one.

<!-- mex:entity
id: mx_01M5G2KA7P87MG4ZEX8T5CYG4P
type: decision
status: promoted
revision: 1
-->
### Cross-cutting wire types live in `packages/shared`

**Date:** 2026-10-20
**Status:** Active
**Decision:** Cross-cutting wire DTOs live in `packages/shared`, owned by the inbesat lane; core and web consume it by node resolution through the workspace symlink.
**Reasoning:** ADR-125 — it resolves the ADR-002 conflict by giving the shared surface a single owner while keeping it free of business logic.
**Alternatives considered:** Putting the DTOs in core (rejected — web would depend on the whole core barrel), reverting to "both lanes edit it" (rejected — conflicts).
**Consequences:** `packages/shared` holds no runtime behaviour and no frozen contract. New shared DTOs need a named single owner.

<!-- mex:entity
id: mx_01M5G2K9SCFNRJNXVH0EF3GR0S
type: decision
status: promoted
revision: 1
-->
### Cross-language resolution: the client shipped, the epic is deferred

**Date:** 2026-10-21
**Status:** Active
**Decision:** A generic LSP client over JSON-RPC stdio with TypeScript/JavaScript and Python resolvers ships, but the cross-language epic stays deferred because its own gate measured nothing.
**Reasoning:** ADR-143 — the P-334 spike only runs when the P-331 failure taxonomy shows import-resolution failures in the top-2 categories. The recorded taxonomy shows 0 of 1 failures are import-resolution, so every language is recorded as `skipped-gate`.
**Alternatives considered:** Reporting a zero (rejected — a missing number is never a zero), skipping the resolver work entirely (rejected — ADR-146 notes P-337's own text is unconditional, so the resolver builds on the shipped P-335 client).
**Consequences:** The TS/JS resolver measured 4/4 accuracy and the Python resolver shipped with a jedi subprocess fallback (ADR-146 supersedes ADR-145 decision 6), but no latency, stability or accuracy number exists for the deferred epic. A gate that did not run is deferred, never passing.
