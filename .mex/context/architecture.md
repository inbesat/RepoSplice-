---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
  - target: context/agent-loop.md
    condition: when working on the AI agent loop, autonomy policy, or tool execution
  - target: patterns/change-frozen-contract.md
    condition: when the change crosses the core-to-web event boundary
  - target: patterns/add-web-slice.md
    condition: when adding a consumer of the live event stream
# Broad overview: keep this empty unless a claim depends on a few specific symbols.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh2:64:<base64url>" }
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2K6S4C1SVBP01Y76AECCC
  type: architecture
  status: promoted
  revision: 5
  title: architecture
  relations:
    - type: related_to
      target: mx_01M5G2KJCCV9BDCQ862Y1JP82Z
      note: when specific technology details are needed
    - type: related_to
      target: mx_01M5G2K48EA9GDQKPMTW9E5VHN
      note: when working on the AI agent loop, autonomy policy, or tool execution
    - type: related_to
      target: mx_01M5G2KMFV9WRW9XWWRTWX4HJP
      note: when the change crosses the core-to-web event boundary
    - type: related_to
      target: mx_01M5G2KKYVH92TKZFNNTVS9H3S
      note: when adding a consumer of the live event stream
---

# Architecture

<!-- mex:entity
id: mx_01M5G2K68JR6EC9X5V5QBGK00M
type: component
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K6S4C1SVBP01Y76AECCC
    note: Section of architecture in context/architecture.md
-->
## System Overview

A stitch job starts in the CLI, is driven by the core pipeline, and is observed live by the web dashboard over a WebSocket.

```
stitch merge (packages/cli/src/cli.ts -> commands/merge.ts)
  -> core pipeline state machine (packages/core/src/pipeline/runPipeline.ts, pipeline/stateMachine.ts)
       stage git        core/src/git/         clone -> git-filter-repo -> subtree merge -> child repo C
       stage deps       core/src/deps/        manifest parse, transitive closure, semver collisions
       stage license    core/src/license/     SPDX normalize, permissive vs copyleft
       stage agent      core/src/agent/, core/src/ai/loop.ts   auto-fix mechanical, gate generative
       stage sandbox    core/src/sandbox/     Docker install/build/test, GitHub Actions fallback
       stage provenance core/src/provenance/  git notes, CREDITS.md, CycloneDX SBOM
  -> events published on the Bus (core/src/events/bus.ts)
       -> CLI WS adapter (packages/cli/src/server/ws.ts) -> /ws
            -> web WsClient (packages/web/src/lib/ws.ts) -> hooks/useMergeStream.ts -> store/ -> pages/
  -> human-in-the-loop questions -> HIL queue (core/src/jobs/queue.ts) -> web approve/reject gate
  -> results persisted in SQLite (core/src/store/db.ts, stitch.db) + audit logs (stitch audit)
```

A dry run swaps `finalize`, so nothing is written. Cancellation is observable through the `cancelling` state rather than an abrupt exit.

A single `stitch serve` process hosts the REST API, the WebSocket endpoint and the built web dashboard, so the CLI and the browser observe the same in-memory job state.

<!-- mex:entity
id: mx_01M5G2K5T8TK3MR3NP19MMX8EX
type: component
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K6S4C1SVBP01Y76AECCC
    note: Section of architecture in context/architecture.md
-->
## Key Components

- **Core public barrel** (`packages/core/src/index.ts`) — the single public surface of `packages/core`. It re-exports each module's own `index.ts`; identifier collisions are aliased here (`DepsConflict`, `DepsMergeResult`, `LicenseCompliancePolicy`, `ToolAutonomy`, `AgentDepsFacade`, `AgentLicenseFacade`, `EvalTokenUsage`).
- **Pipeline state machine** — [`runPipeline()`](mex://function:93caa91ab88d04e6d6a6755503e9f050) drives the stages. `pipeline/stateMachine.ts` owns the legal transitions; `pipeline/dryRun.ts` is dry-run-by-swap.
- **Event Bus** — [`createBusForwarder()`](mex://function:0b057ad4c678d405c67ec75f6e40849b) forwards core events. Delivery is synchronous and a coalescible topic holds one slot (ADR-065).
- **Progress aggregator** — [`ProgressAggregator`](mex://class:e2d87921935e3eee944bb5e236fa340f) normalises per-stage progress into `OverallProgress`. Progress is normalised, not summed, and an ETA is never invented (ADR-066).
- **Agent loop** — `core/src/agent/` plus `core/src/ai/loop.ts`. Plan and execute are separate phases, the Git facade mutates the child stage only, and the autonomy policy is injected rather than imported. See `context/agent-loop.md`.
- **Git operations** — `core/src/git/` wraps simple-git and the *system* `git-filter-repo` binary (ADR-004). Git >= 2.40 is a hard floor.
- **Dependency merge** — `core/src/deps/` parses the dependency manifests of the source repos (npm, Python, Cargo and Go manifests; see the fixtures under `packages/core/src/deps/__fixtures__/`), computes the transitive closure and resolves semver collisions.
- **License compliance** — `core/src/license/` normalises SPDX ids and separates permissive from copyleft. An "allowed but unknown" matrix entry still denies (ADR-081).
- **Sandbox runner** — `core/src/sandbox/` runs install/build/test in Docker with a GitHub Actions fallback (`sandbox/fallback.ts`). A missing Docker host yields `SANDBOX_UNAVAILABLE`, never a fabricated verdict.
- **Provenance** — `core/src/provenance/` writes git notes, a credits file and a CycloneDX SBOM into the output repo. PII is scrubbed by walking the object, not by template convention.
- **Jobs and the HIL queue** — `core/src/jobs/` owns its own tables (`pipeline_jobs`). A question's answer is stored as that question's note (ADR-033).
- **CLI** — a commander program (`createProgram()`), an Ink TUI under `packages/cli/src/ui/`, and a local Elysia server in `packages/cli/src/server/` that serves the built web app with SPA fallback.
- **Web dashboard** — React 19 + Vite + Tailwind v4. Zustand slices live in `packages/web/src/store/`; tokens live in `packages/web/src/theme/` as roles-in-CSS with a typed TS mirror.
- **Shared wire types** — `packages/shared/` holds the cross-cutting types used by more than one package (ADR-125).

<!-- mex:entity
id: mx_01M5G2K5BVHX1PF82STZHK64RF
type: component
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K6S4C1SVBP01Y76AECCC
    note: Section of architecture in context/architecture.md
-->
## External Dependencies

- **Git >= 2.40 and the system `git filter-repo` tool** — history rewriting and subtree merge. That tool is a Python 3.11+ system binary installed outside npm, not a package dependency. Git below 2.40 is gated by `stitch doctor`.
- **Docker >= 24 Engine** — sandbox install, build and test. Optional in CI: the GitHub Actions fallback covers it, and an unavailable sandbox is a typed result rather than a crash.
- **AI providers** — OpenRouter (the default hub), OpenAI, Anthropic and Ollama (local). Selected in `stitch.toml`; keys come from environment variables only.
- **GitHub API** — creating repo C and opening the PR, via a PAT (`GITHUB_TOKEN`) or GitHub App auth. Response shapes come from Octokit types, never from assumptions (ADR-058).
- **SQLite** — `bun:sqlite` at runtime and `node:sqlite` in the read-only audit adapter (ADR-092). No ORM, no server database.
- **npm registry** — semver resolution for dependency collisions; the `--lockfile` flow runs npm in a scratch directory.

<!-- mex:entity
id: mx_01M5G2K4WZYX6N04123JP4G0CZ
type: component
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K6S4C1SVBP01Y76AECCC
    note: Section of architecture in context/architecture.md
-->
## What Does NOT Exist Here

- **No ORM and no server database** — raw SQLite with typed helpers only (ADR-003).
- **No background worker service** — the job and HIL queue is in-process SQLite; there is no separate worker deployment.
- **No SSE and no polling** — WebSocket is the only real-time channel (ADR-009).
- **No MCP server** — the MCP workspace is source-only. Distribution is the CLI plus the local web UI (ADR-016, deferred).
- **No direct web-to-core import** — the web app reaches core only through the CLI's HTTP and WebSocket server.
- **No provider-backed evaluation baseline yet** — the corpus machinery exists; the real baseline is deferred (P-327, P-333).
