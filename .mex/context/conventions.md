---
name: conventions
description: How code is written in this project - naming, structure, patterns, and style. Load when writing new code or reviewing existing code.
triggers:
  - "convention"
  - "pattern"
  - "naming"
  - "style"
  - "how should I"
  - "what's the right way"
edges:
  - target: context/architecture.md
    condition: when a convention depends on understanding the system structure
  - target: context/agent-loop.md
    condition: when writing agent-loop or AI-provider code
  - target: patterns/add-core-module.md
    condition: when applying the barrel and Result conventions to new core code
  - target: patterns/add-cli-command.md
    condition: when applying the error, exit, and logging conventions to a CLI command
  - target: patterns/add-web-slice.md
    condition: when applying the state and token conventions to the web dashboard
  - target: patterns/debug-core-suite.md
    condition: when running the verify checklist after a change
# Add only nodes that embody the documented convention; do not ground examples broadly.
# grounds_to:
#   - node: "function:<tier-1-id>"
#     fingerprint: "mh2:64:<base64url>"
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2K99N5VSF22C75FZCPNET
  type: convention
  status: promoted
  revision: 7
  title: conventions
  relations:
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: when a convention depends on understanding the system structure
    - type: related_to
      target: mx_01M5G2K48EA9GDQKPMTW9E5VHN
      note: when writing agent-loop or AI-provider code
    - type: related_to
      target: mx_01M5G2KKBYPPGS0NJAEEZM6KDH
      note: when applying the barrel and Result conventions to new core code
    - type: related_to
      target: mx_01M5G2KJV1N5JFVPBRXWRHYG1A
      note: when applying the error, exit, and logging conventions to a CLI command
    - type: related_to
      target: mx_01M5G2KKYVH92TKZFNNTVS9H3S
      note: when applying the state and token conventions to the web dashboard
    - type: related_to
      target: mx_01M5G2KN16W5VEFN8NVCXMYA21
      note: when running the verify checklist after a change
---

# Conventions

<!-- mex:entity
id: mx_01M5G2K8V3PH5RRDETWP698ZTS
type: convention
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K99N5VSF22C75FZCPNET
    note: Section of conventions in context/conventions.md
-->
## Naming

- **Core module files are camelCase** — `runPipeline.ts`, `idempotency.ts`, `stateMachine.ts`. A few agent tool modules are snake_case (`packages/core/src/agent/tools/edit_config.ts`, `packages/core/src/agent/tools/move_file.ts`); match the sibling files in the folder you are editing rather than normalising them.
- **Every core module owns an `index.ts`** that re-exports its public surface. `packages/core/src/index.ts` is the only public entry point.
- **Identifier collisions are aliased in the root barrel** — `DepsConflict`, `DepsMergeResult`, `LicenseCompliancePolicy`, `ToolAutonomy`, `AgentDepsFacade`, `AgentLicenseFacade`, `EvalTokenUsage`. Never rename an existing export to dodge a collision.
- **CLI files are camelCase, commands are verbs** — `packages/cli/src/commands/<verb>.ts` (`merge.ts`, `status.ts`, `audit.ts`).
- **Web components and pages are PascalCase**, hooks and lib modules are camelCase — `ReviewPage.tsx`, `useMergeStream.ts`, `ws.ts`.
- **Error codes are string literals in a union** (`StitchErrorCode`), mapped to exit codes in one table. `ExitCode` is a const object, not a TypeScript enum.

<!-- mex:entity
id: mx_01M5G2K89GXXKZJ834PD8W76RA
type: convention
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K99N5VSF22C75FZCPNET
    note: Section of conventions in context/conventions.md
-->
## Structure

- **Business logic lives in `packages/core` only.** `packages/cli` and `packages/web` are consumers. `packages/web` never imports core at runtime — it talks to the CLI's HTTP/WS server.
- **Core module layout is folder-per-domain**: `agent/`, `ai/`, `deps/`, `events/`, `git/`, `jobs/`, `license/`, `pipeline/`, `provenance/`, `resolve/`, `sandbox/`, `store/`. Each holds `index.ts` plus its own files and colocated tests.
- **Tests are colocated** — `merge.ts` with `merge.test.ts` beside it. `core/src/__tests__/` is for cross-module tests only.
- **CLI command registration is split to avoid an import cycle**: `createProgram()` in `packages/cli/src/program.ts` owns the base program and `doctor`; `buildCLI()` in `packages/cli/src/cli.ts` attaches the workspace commands (`init`, `add`, `serve`, `status`).
- **Web state is one Zustand slice per domain** under `packages/web/src/store/` (`selection.ts`, `run.ts`, `deps.ts`, `licenses.ts`, `provenance.ts`, `sandbox.ts`, `flow.ts`, `tour.ts`), with shared selectors in `selectors.ts`.
- **Design tokens live in `packages/web/src/theme/`** — `tokens.css` holds the roles-in-CSS variables, `tokens.ts` is the typed mirror. Tailwind v4's `@theme inline` block is the configuration surface — there is no separate config file to edit.

<!-- mex:entity
id: mx_01M5G2K7VSHHJAFZ9ZQ00J3TPX
type: convention
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K99N5VSF22C75FZCPNET
    note: Section of conventions in context/conventions.md
-->
## Patterns

**1. Result, never throw.**

```ts
// Correct
return ok(value);
return err({ code: 'CONFIG_ERROR', message: 'stitch.toml is missing [sources]' });

// Wrong
throw new Error('stitch.toml is missing [sources]');
```

**2. Public API only, from the barrel.**

```ts
// Correct (packages/cli, packages/web)
import { runPipeline, type PipelineOptions } from '@repo-stitcher/core';

// Wrong - reaches into core internals
import { runPipeline } from '@repo-stitcher/core/src/pipeline/runPipeline';
```

**3. The shared logger, with redaction.**

```ts
// Correct
logger.info('stitch merge starting', { sourceCount: sources.length });

// Wrong
console.log('starting');
```

Secrets are redacted by value, not by key name. `packages/cli/src/log.ts` is the single logging entry (ADR-091); the sink is injected and defaults to STDERR.

**4. Every path goes through the path guard.**

```ts
// Correct - packages/cli/src/paths.ts is the single name/path guard
if (!validateName(name)) return err({ code: 'CONFIG_ERROR', message: 'invalid source name' });
const target = safeJoin(root, name);
```

`validateName` returns a boolean, `safeJoin` enforces lexical containment (no `realpath`), and the deny-list normalises separators and case (ADR-090).

**5. One error-to-exit-code table.**

```ts
// Correct
return exitCodeForResult(result, write);   // packages/cli/src/cli.ts

// Wrong
process.exit(1);
```

`packages/cli/src/errors.ts` owns the code-to-exit map (Config 3, HIL 10, License-deny 20, AI 40, Deps 50, Internal 70) and renders code + message + hint + next-step in one write (ADR-088). A command never calls `process.exit` itself.

<!-- mex:entity
id: mx_01M5G2K7B145Q2HR6D9BXQPTEM
type: convention
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2K99N5VSF22C75FZCPNET
    note: Section of conventions in context/conventions.md
-->
## Verify Checklist

Run this against anything you write, item by item, before presenting output:

- [ ] `bun run typecheck` passes (run `bun run build:core` first — the root typecheck resolves core's built output).
- [ ] `bun run lint` passes for the files you own. The root lint currently reports 18 formatting errors confined to concurrent P-331 taxonomy files — not yours, leave them.
- [ ] `bun run test` passes for the touched package. Coverage thresholds: core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60.
- [ ] `bun run lint:deps` passes — no restricted import, no circular dependency, no `core/src/*` import from cli or web.
- [ ] `bun run check:contracts` exits 0. If a frozen file changed, the ADR and `bun run check:contracts:update` must be committed with it.
- [ ] New public types are exported through `packages/core/src/index.ts` and the collisions are aliased, not renamed.
- [ ] No `throw`, no `any`, no `console.log`, no hardcoded secret, no path built without the guard.
- [ ] `project-plans/PROGRESS.md` updated, and an ADR appended to `project-plans/DECISIONS.md` if the public API changed.

**Phase completion.** A phase is not done until the recurring gate shape passes: scripts typecheck plus 8/8 script tests; the full core suite (one known ADR-079 red in jobs/idempotency); CLI 28 files / 173 tests; web typecheck plus e2e typecheck plus the full web vitest suite; the 3 Playwright E2E flows; `build:web` plus the 3 perf specs; root typecheck after `build:core`; root lint clean for owned files. The whole suite is not currently green — report that honestly rather than claiming a pass.
