---
name: router
description: Session bootstrap and navigation hub. Read at the start of every session before any task. Contains project state, routing table, and behavioural contract.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why it is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: context/agent-loop.md
    condition: when touching the AI agent loop, autonomy, sandboxing, or human-in-the-loop flow
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
  - target: patterns/add-core-module.md
    condition: when adding a module to packages/core
  - target: patterns/add-cli-command.md
    condition: when adding or changing a CLI command
  - target: patterns/add-web-slice.md
    condition: when adding a page, component, or store slice to packages/web
  - target: patterns/change-frozen-contract.md
    condition: when changing the event envelope, the WS contract, the topics, or the job types
  - target: patterns/debug-core-suite.md
    condition: when a test, typecheck, lint, or coverage gate fails
last_updated: 2026-10-22
---

# Session Bootstrap

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Current Project State

**Working:**
- The Bun workspaces monorepo builds: core, CLI and web compile, and the CLI serves the built web app with SPA fallback (ADR-120).
- The CLI surface: `init`, `add`, `serve`, `status`, `audit`, `license`, `deps`, `merge`, `eval`, `config`, `doctor`, with one error/exit entrypoint (ADR-088).
- The core pipeline state machine and its stage set (git, deps, license, agent, sandbox, provenance) publishing typed envelopes on the Bus.
- The AI agent loop: hybrid autonomy, injected policy, loop cap, and a human-in-the-loop queue that owns its own tables.
- The frozen core-to-web wire contract with a CI gate (ADR-124), plus `packages/shared` for cross-cutting wire DTOs (ADR-125).
- The eval subsystem: corpus schema, pinned SHAs, harness, failure taxonomy, baseline, regression gate, and a generated `EVAL.md`.
- Cross-language resolvers: generic LSP client (ADR-144), TS/JS resolver at 4/4 accuracy (ADR-145), Python resolver with the jedi fallback (ADR-146).
- The MEX scaffold itself: populated `context/` and `patterns/` plus a fresh code graph (690 files indexed).

**Not yet built:**
- The real merge handler map and the dashboard REST/data providers (P-192/P-252). Eval must fail closed until it can produce and verify a child repo — an empty pipeline, or a build of parent B, is not a measured merge.
- Job owner fencing, lease renewal, and recovery of interrupted `running` stages (P-239/P-240).
- The provider-backed corpus baseline and the published evaluation (P-327/P-333). Synthetic or injected-port checks are not a substitute.
- The cross-language epic itself (ADR-143): its gate measured nothing, so every language is recorded as `skipped-gate`.
- CLI binary packaging — `build:cli` is deferred to P-062 (tsup).
- The Go resolver (gopls, P-338) is the current phase and is still in flight.

**Known issues:**
- The full suite is NOT green: the documented ADR-079 jobs/idempotency red and load-sensitive build/circular smoke failures remain.
- Native `bun test` fails on the existing `bunfig.toml` preload entry — the supported runner is Vitest via `bun run test`.
- Root `bun run lint` reports 18 formatting errors confined to concurrent P-331 taxonomy files owned by another lane.
- No coverage total can be produced because of a stale foreign coverage lock.
- `/workspace` remains writable (ADR-044).
- The code graph is partly stale for the in-flight Go/Rust resolver files; a stale graph is a lead, not an answer.

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Working on the AI agent loop, autonomy, sandbox, or HIL flow | `context/agent-loop.md` |
| Adding a core module | `patterns/add-core-module.md` |
| Adding or changing a CLI command | `patterns/add-cli-command.md` |
| Adding a web page, component, or store slice | `patterns/add-web-slice.md` |
| Changing the event envelope, WS, or job type contract | `patterns/change-frozen-contract.md` |
| Triaging a failing test or red gate | `patterns/debug-core-suite.md` |
| Any specific task | Check `patterns/INDEX.md` for a matching pattern |

## Behavioural Contract

For every task, follow this loop:

1. **CONTEXT** — Load the relevant context file(s) from the routing table above. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it.
2. **BUILD** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **VERIFY** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DEBUG** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run VERIFY.
5. **GROW** — After meaningful work, run this binary checklist:
   - **Ground:** What changed in reality? Name the changed behavior, system, command, dependency, or workflow.
   - **Record:** If project state changed, update the "Current Project State" section above. If documented facts changed, update the relevant `context/` file surgically. Record a new behavioral claim about specific code as its own entity (`mex wiki apply` with a `create-entry` operation), grounded to every symbol whose change could make it false and naming the identifiers and literals it depends on.
   - **Connect:** Link section entities to their enclosing knowledge with `refines` using existing ids. Preview missing structural links with `mex wiki link-sections`, then apply explicitly. Review semantic relationships from evidence; do not connect records just because they share keywords or code groundings.
   - **Orient:** If this task can recur and no pattern exists, create one in `patterns/` using `patterns/README.md`, then add it to `patterns/INDEX.md`. If a pattern exists but you learned a gotcha, update it.
   - **Write:** Bump `last_updated` in every scaffold file you changed. Read `mex logging --json` before optional `mex log` notes: `significant` records material rationale, `checkpoints` batches useful notes at task/session boundaries, and `manual` avoids unsolicited notes. Honor explicit user log requests in every mode; mandatory workflow Activity and recovery audits remain required.
