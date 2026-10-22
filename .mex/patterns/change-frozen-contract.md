---
name: change-frozen-contract
description: Change the core-to-web event envelope or job type contract. Use when editing packages/core/src/events, packages/core/src/jobs/types.ts, or packages/web/src/lib/ws.ts.
triggers:
  - "event envelope"
  - "WebSocket contract"
  - "topic"
  - "jobs/types"
  - "check:contracts"
  - "contract freeze"
edges:
  - target: context/architecture.md
    condition: for the event flow from core to the web UI
  - target: context/decisions.md
    condition: for the ADR-124 freeze decision
  - target: context/conventions.md
    condition: for the Result and validation conventions
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2KMFV9WRW9XWWRTWX4HJP
  type: pattern
  status: promoted
  revision: 3
  title: change-frozen-contract
  relations:
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: for the event flow from core to the web UI
    - type: related_to
      target: mx_01M5G2K99N5VSF22C75FZCPNET
      note: for the Result and validation conventions
---

# Change a Frozen Contract

## Context

Five paths are frozen as of 2026-10-20 (ADR-124):

| Path | What it owns |
|---|---|
| `packages/core/src/events/topics.ts` | topic names, the zod `eventEnvelopeSchema`, per-topic payload types (`PipelineStagePayload`, `JobPayload`, `AgentPayload`, `ProgressPayload`) |
| `packages/core/src/events/bus.ts` | `Bus`, `BusEnvelope`, `BusHandler`, `createBusForwarder`, the `bus` singleton |
| `packages/core/src/events/progress.ts` | `StageProgress`, `OverallProgress`, `ProgressAggregator`, `STAGE_FOR_TOPIC` |
| `packages/core/src/jobs/types.ts` | `JobStatus`, `JOB_TRANSITIONS`, `JobRecord`, `JobEvent` |
| `packages/web/src/lib/ws.ts` | the web mirror `WsEnvelope` and the reconnecting `WsClient` |

The contract in one paragraph: core publishes envelopes on TOPICS; every envelope carries
`id`, `topic`, `payload` and `timestamp` and is validated by the zod
`eventEnvelopeSchema` before it leaves the process; the web parses the same shape as
`WsEnvelope`, subscribes over `/ws`, reconnects with 500 ms -> 30 s backoff plus a 15 s
heartbeat; `ProgressAggregator` folds stage progress into `OverallProgress`.

Core owns the bus, the CLI server is the WebSocket adapter
([`createBusForwarder()`](mex://function:0b057ad4c678d405c67ec75f6e40849b)), and the
aggregator is the single place that turns stages into overall progress
([`ProgressAggregator`](mex://class:e2d87921935e3eee944bb5e236fa340f)).

If the change is a NEW cross-cutting DTO rather than a change to these five, it does not
belong here — put it in `packages/shared` (ADR-125).

## Steps

1. Write the ADR in `project-plans/DECISIONS.md` inside an `## ADR-NNN: <Title>` section.
   The section must carry a `Date:` line, a Status and the phase/owner.
2. Inside that ADR section add one marker line per changed path, exactly:
   `contract-freeze: packages/core/src/events/topics.ts`
   One line per path, no globbing, no prose on the line.
3. Change the code.
4. Refresh the manifest: `bun run check:contracts:update`. This rewrites
   `contracts.freeze.json`.
5. Commit the ADR and the refreshed `contracts.freeze.json` **together**. A commit with
   only one of the two leaves the gate broken.

## Gotchas

- **A marker outside an ADR section authorises nothing.** The gate scans for
  `contract-freeze:` lines inside `## ADR-.` blocks. A stray marker in a code comment or
  a changelog entry does not count.
- **The manifest and the ADR must land together.** Committing only the ADR leaves
  `contracts.freeze.json` stale; committing only the manifest leaves the change
  unauthorised. The gate fails with "NOT authorized by an ADR" and exits non-zero either
  way.
- **Core and web must change together.** The web mirrors the envelope as `WsEnvelope`; a
  core-only change produces envelopes the web client cannot parse, and the failure shows
  up as a silent UI stall rather than an exception.
- **Validation happens before the envelope leaves the process.** A payload that does not
  satisfy the zod schema never reaches the wire — so a payload change and a schema change
  are the same change.
- **Progress is normalised, not summed, and the ETA is never invented** (ADR-066). If you
  change how progress is computed, the aggregation contract changes with it.
- **The freeze covers the files, not the behaviour.** Adding a new topic in a frozen file
  still needs the ADR, because the file's hash is what the gate compares.

## Verify

- [ ] `bun run check:contracts` — exit 0, "intact".
- [ ] `bunx vitest run --config scripts/vitest.config.ts` — the gate's own test suite.
- [ ] `bun run typecheck` — 0 errors in core and web.
- [ ] `bun run test` — core and web suites pass.
- [ ] The web typecheck passes with the mirrored `WsEnvelope` updated.
- [ ] `project-plans/DECISIONS.md` has the ADR with the marker line per changed path.
- [ ] `contracts.freeze.json` is staged in the same commit as the ADR.

## Debug

- **The gate says "NOT authorized by an ADR"** — the marker line is missing, is in the
  wrong file, or sits outside an `## ADR-.` section. Check the exact path spelling.
- **The gate reports a hash mismatch** — the manifest was not refreshed; run
  `bun run check:contracts:update` and commit it together with the ADR.
- **The web UI stops receiving events** — the envelope shape and the zod schema disagree,
  or the web mirror was not updated. Check `packages/web/src/lib/ws.ts` against
  `packages/core/src/events/topics.ts` field by field.
- **Progress bars stall at one stage** — the topic is not in `STAGE_FOR_TOPIC`, or the
  aggregator does not recognise the new payload.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
