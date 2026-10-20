# Frozen Contracts

The wire contracts between the CLI/core (`packages/core`) and the web app
(`packages/web`) are **frozen** as of 2026-10-20 (ADR-124). The
`contract-freeze` gate fails CI when a frozen file changes without an ADR
that authorizes the change.

## What is frozen

| Path | What it carries |
| --- | --- |
| `packages/core/src/events/topics.ts` | The topic names, the zod `eventEnvelopeSchema`, and the per-topic payload types (`PipelineStagePayload`, `JobPayload`, `AgentPayload`, `ProgressPayload`). |
| `packages/core/src/events/bus.ts` | The in-process event bus: `Bus`, `BusEnvelope`, `BusHandler`, `createBusForwarder` and the `bus` singleton. |
| `packages/core/src/events/progress.ts` | `StageProgress`, `OverallProgress`, `ProgressAggregator` and `STAGE_FOR_TOPIC` — the progress shape the UI renders. |
| `packages/core/src/jobs/types.ts` | `JobStatus`, `JOB_TRANSITIONS`, `JobRecord` and `JobEvent` — the job lifecycle the UI polls. |
| `packages/web/src/lib/ws.ts` | The web mirror of the envelope (`WsEnvelope`) and the reconnecting `WsClient` that speaks to `/ws`. |

> The plan phrases this as "`core/src/types` + WS schema frozen". In the
> repository `packages/core/src/types/` holds only ambient module
> declarations (`madge.d.ts`, `picomatch.d.ts`, `raw.d.ts`), so the frozen
> surface is the event/job contract modules listed above plus the web mirror.

## The WS contract in one paragraph

`core` publishes envelopes on topics (`TOPICS` in `events/topics.ts`); each
envelope carries an `id`, a `topic`, a `payload` and a `timestamp`, and is
validated by the zod `eventEnvelopeSchema` before it leaves the process. The
web client (`packages/web/src/lib/ws.ts`) parses the same envelope shape
(`WsEnvelope`), subscribes to topics over `/ws`, and reconnects with a
backoff (500 ms → 30 s) plus a 15 s heartbeat. Progress events are aggregated
by `ProgressAggregator` into `OverallProgress`.

## How to change a frozen contract

1. Write the ADR in `project-plans/DECISIONS.md` — inside an `## ADR-…`
   section — and add one marker line per changed path:

   ```markdown
   contract-freeze: packages/core/src/events/topics.ts
   ```

   A marker outside an ADR section does **not** authorize anything.
2. Refresh the manifest so it records the new hashes:

   ```bash
   bun run check:contracts:update
   ```

3. Commit the ADR and the refreshed `contracts.freeze.json` together.

Until both steps are done, the gate reports the change as
`NOT authorized by an ADR` and exits non-zero.

## Running the gate

```bash
bun run check:contracts          # verify — exit 0 when intact, 1 on a violation
bun run check:contracts:update   # refresh the manifest (after an ADR)
bunx vitest run --config scripts/vitest.config.ts   # the gate's own tests
```

The gate reads the frozen files; it never writes to `packages/core` or
`packages/web`.

## CI

The `contract-freeze` job in `.github/workflows/ci.yml` runs the gate's tests,
type-checks the gate and executes the gate itself on every push and pull
request. A red `contract-freeze` job means a frozen contract changed without
an ADR — that is the signal to write the ADR, not to raise the limit.
