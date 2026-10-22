---
name: debug-core-suite
description: Triage a failing test or a red gate in packages/core, cli, or web. Use when the suite fails, a typecheck breaks, or lint reports errors.
triggers:
  - "test fails"
  - "suite is red"
  - "debug"
  - "typecheck error"
  - "lint error"
  - "coverage"
edges:
  - target: context/setup.md
    condition: for environment and tooling problems
  - target: context/conventions.md
    condition: for the verify checklist and the known-red baseline
  - target: context/architecture.md
    condition: for locating the failure boundary
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2KN16W5VEFN8NVCXMYA21
  type: pattern
  status: promoted
  revision: 4
  title: debug-core-suite
  relations:
    - type: related_to
      target: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
      note: for environment and tooling problems
    - type: related_to
      target: mx_01M5G2K99N5VSF22C75FZCPNET
      note: for the verify checklist and the known-red baseline
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: for locating the failure boundary
---

# Debug a Failing Suite

## Context

The suite is **not green** as of 2026-10-21, and that is a recorded fact, not a surprise
you introduced. Known baseline:

- The ADR-079 jobs/idempotency red is documented and outstanding.
- Load-sensitive build and circular-dependency smoke failures also remain.
- Native `bun test` fails on the existing `bunfig.toml` preload entry — **the runner is
  Vitest**, invoked as `bun run test`.
- Root `bun run lint` reports 18 formatting errors confined to concurrent P-331 taxonomy
  files owned by another lane. Not yours; do not fix them here.
- A stale foreign coverage lock means no coverage total can be produced.

Your job is to separate **your** failures from the known baseline and to report honestly:
a gate that did not run is deferred, never passing, and a missing number is never a zero.

## Steps

1. Reproduce with the right runner: `bun run test` (Vitest), not `bun test`.
2. Get the known reds out of the way first — compare against the baseline above. If your
   failure list is a subset of the baseline, there is no new bug.
3. Build core before typechecking: `bun run build:core` then `bun run typecheck`. Root
   typecheck resolves core through `dist`.
4. Check the dependency graph for cycles: `bun run lint:deps`.
5. Locate the failing boundary with the code graph before reading files:
   - `mex graph status` — is the index fresh? A stale index points at code that changed.
   - `mex graph scope "<task>"` — returns bounded, source-backed JSONL context.
   - `mex graph query where-defined <symbol>` / `who-calls <symbol>` — exact resolvers.
   - `mex impact <symbol|file>` — the affected callers before you edit.
6. Read the failing test's neighbours before changing anything: the failure is usually a
   contract mismatch between two modules, and the fix belongs in the shared code.
7. Re-run the smallest scope that covers the change, then the full gate.

## Gotchas

- **`bun test` vs `bun run test`.** The first runs Bun's own runner and hits the
  `bunfig.toml` preload failure; the second runs Vitest, which is the only supported
  runner (ADR-014).
- **Stale graph.** `mex graph refresh` may report "Could not stage N source file(s)" when
  files are being edited concurrently. A stale graph gives you wrong callers — treat the
  graph as a lead, confirm with Grep/Glob.
- **Scope matches on words, not meaning.** `mex graph scope` output is starting evidence,
  not a complete answer. Do not re-run it with reworded phrasing more than once.
- **Coverage.** Core thresholds are 80/70/80/80, CLI 70/60/70/70, web 60/50/60/60. A new
  file with no test can push core below the threshold even when every test passes.
- **Vitest under Bun-specific APIs.** `openDb` is Bun-only; the audit-log path uses a
  `node:sqlite` adapter (ADR-092). A test that "works in the terminal" but fails under
  Vitest usually hits this.
- **`dist` in dependency-cruiser.** Excluded deliberately (P-062/P-064). Do not "fix" a
  lint:deps cycle by rebuilding and re-running.
- **Do not fix another lane's files.** `packages/core` is the inbesat lane; `packages/cli`
  and `packages/web` are the aradhy lane.

## Verify

- [ ] `bun run build:core` — exit 0.
- [ ] `bun run typecheck` — 0 errors.
- [ ] `bun run lint` — 0 errors for the files you own.
- [ ] `bun run lint:deps` — no cycle, no forbidden dependency.
- [ ] `bun run test` — your scope passes; any remaining failures are named explicitly and
      match the documented baseline.
- [ ] Coverage for the touched package is at or above its threshold.
- [ ] `bun run check:contracts` — exit 0, if the change touched a frozen path.
- [ ] The report says which gates ran and which did not. Unrun gates are reported as
      deferred, never as passing.

## Debug

- **Root typecheck fails only in core** — `bun run build:core` was not run after a barrel
  or type change.
- **A test passes alone but fails in the full run** — shared state, a real global
  (`openDb`), or a coverage lock. Check whether the failure is load-sensitive.
- **The same test fails on CI but not locally** — the CI job runs a different command
  (the root suite vs the scoped suite) or the build order differs.
- **`mex graph scope` returns nothing useful** — the task wording does not match the code
  vocabulary. Use Grep/Glob instead; do not keep rewording.
- **Coverage cannot be produced at all** — a stale foreign coverage lock, not your change.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
