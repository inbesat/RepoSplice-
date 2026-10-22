---
name: add-core-module
description: Add a new module to packages/core and expose it through the public barrel. Use when creating a new core domain, service, or helper.
triggers:
  - "add a core module"
  - "new core package"
  - "packages/core"
  - "public barrel"
  - "core/src/index.ts"
edges:
  - target: context/architecture.md
    condition: when placing the new module in the core layout
  - target: context/conventions.md
    condition: for naming, Result usage, and the barrel rules
  - target: context/decisions.md
    condition: when the new module needs a design decision of its own
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2KKBYPPGS0NJAEEZM6KDH
  type: pattern
  status: promoted
  revision: 3
  title: add-core-module
  relations:
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: when placing the new module in the core layout
    - type: related_to
      target: mx_01M5G2K99N5VSF22C75FZCPNET
      note: for naming, Result usage, and the barrel rules
---

# Add a Core Module

## Context

`packages/core` owns every piece of business logic. Nothing outside core may import
`packages/core/src/*` internals — CLI and web use the package entrypoint
`@repo-stitcher/core`, whose public surface is the barrel `packages/core/src/index.ts`.

Load `context/conventions.md` for naming and the Result contract before writing code.
Read the neighbouring module's own `index.ts` first: the barrel pattern is
`packages/core/src/index.ts` re-exporting through a module barrel
(e.g. `packages/core/src/git/index.ts`), and each module barrel mirrors
`packages/core/src/util/index.ts`.

The pipeline entry point [`runPipeline()`](mex://function:93caa91ab88d04e6d6a6755503e9f050)
(`packages/core/src/pipeline/runPipeline.ts`) shows how a module is reached from the
orchestration layer.

## Steps

1. Create the module directory `packages/core/src/<domain>/`. One directory per domain
   (`git`, `deps`, `license`, `agent`, `sandbox`, `provenance`, `resolve`, …), not one
   directory per function.
2. Implement the module in that directory. Return `Result<T, StitchError>` from every
   public function — `ok(...)` / `err(...)`, never `throw`, never `any`.
3. Give the module its own `index.ts` barrel that re-exports the public symbols of that
   module only.
4. Export the symbols from `packages/core/src/index.ts`. The root barrel re-exports
   through each module's own `index.js`.
5. If the identifier already exists in another module, **alias it in the barrel** rather
   than renaming the original. Existing precedents:
   - `deps` `Conflict` -> `DepsConflict`, `MergeResult` -> `DepsMergeResult`
   - `license` `LicensePolicy` -> `LicenseCompliancePolicy`
   - `agent` `Autonomy` -> `ToolAutonomy`, `DepsFacade` -> `AgentDepsFacade`
6. Colocate tests next to the implementation as `<name>.test.ts`; shared fixtures live in
   `packages/core/src/__tests__/fixtures/`.
7. If the module needs a new third-party dependency, check it against the deny list in
   `packages/core/dependency-cruiser.config.cjs` first — it has a forbidden rule per banned
   library.

## Gotchas

- **Barrel collisions.** Two modules owning the same identifier is expected, not an error.
  Aliasing in the barrel is the established answer; renaming the original breaks the
  other module's consumers.
- **The barrel is also the entrypoint.** `packages/core/src/index.ts` is both the public
  barrel and the package entrypoint. A phase-vs-library conflict resolved this way
  (ADR-075) means "just add a file next to it" is not always enough.
- **`dist` in dependency-cruiser.** `packages/core/dependency-cruiser.config.cjs` excludes
  `dist` from traversal because a parallel build once raced the file reads (P-062/P-064).
  A stale `dist` will not cause a false cycle, but a missing build will cause typecheck
  errors.
- **`node:sqlite` vs `bun:sqlite`.** `openDb` is Bun-only; the audit-log path uses a
  `node:sqlite` adapter so it runs under Vitest (ADR-092). Copy whichever the neighbouring
  code already uses.
- **Import cycles.** `bun run lint:deps` also detects cycles (P-022, madge). A cycle
  through the root barrel means something in the new module imports the root barrel.

## Verify

- [ ] `bun run build:core` — the root `typecheck` resolves core through `dist`, so it fails
      misleadingly until core is built.
- [ ] `bun run typecheck` — 0 errors.
- [ ] `bun run lint` — 0 errors for the files you own.
- [ ] `bun run lint:deps` — no cycle, no forbidden dependency.
- [ ] `bun run test` — the new module's tests pass; core coverage stays at or above
      80/70/80/80 (statements/branches/functions/lines).
- [ ] The new symbols are reachable from `@repo-stitcher/core` and NOT from
      `core/src/*` in cli/web.
- [ ] `project-plans/PROGRESS.md` updated; an ADR appended to `project-plans/DECISIONS.md`
      if the public API changed.

## Debug

- **Root typecheck fails with unresolved core imports** — `bun run build:core` was not run
  after the barrel change.
- **`bun run lint:deps` reports a cycle** — something imports `packages/core/src/index.ts`
  from inside core. Import the module barrel instead.
- **A CLI/web import is rejected by ESLint** — the symbol was not exported from the root
  barrel, or it was exported under a different alias than the one used.
- **Vitest cannot open the database** — the code path used `openDb` instead of the
  `node:sqlite` adapter.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
