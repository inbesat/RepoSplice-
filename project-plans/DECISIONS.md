# DECISIONS.md — Architecture Decision Records (ADRs)
## repo-stitcher: Chronological Log of Technical Choices

**Version:** 1.0.0
**Status:** Living document — append only
**Format:** Each entry: `ADR-XXX: Title` + `Status` + `Context` + `Decision` + `Consequences` + `Date`
**Last Updated:** 2026-08-30

---

## ADR-001: Monorepo with Bun Workspaces

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Need to share TypeScript types, config, and tooling across core, CLI, and web packages. Want fast installs, native TypeScript, built-in test runner.

**Decision:** Use Bun workspaces (`"workspaces": ["packages/*"]`) with single `package.json` at root. All packages extend `tsconfig.base.json`. Shared ESLint/Prettier at root.

**Alternatives Considered:**
- **npm/yarn workspaces** — slower installs; no native TS; need separate test runner.
- **pnpm** — good but Bun's workspace support is first-class and faster.
- **Turborepo/Nx** — overkill for 3 packages; adds config complexity.

**Consequences:**
- ✅ Single `bun install` installs all; `bun test` runs all.
- ✅ `bun build --compile` produces single binaries for CLI.
- ⚠️ Team must have Bun installed (documented in `stitch doctor`).
- ⚠️ Some native deps (git-filter-repo, dockerode) need system deps documented.

---

## ADR-002: Package Isolation — Core Owns Logic, CLI/Web Are Consumers

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Two developers (inbesat, aradhy) working in parallel on same repo. Must avoid merge conflicts.

**Decision:** Strict package ownership:
- **inbesat** → `packages/core` + root config + docs
- **aradhy** → `packages/cli` + `packages/web`
- `core` exports **only** public API via `src/index.ts` (types + functions).
- `cli` and `web` import `core` **only** via that public API.
- `web` talks to `core` at runtime via CLI's HTTP/WS server (`stitch serve`), not direct import.

**Alternatives Considered:**
- Shared `packages/shared` for types — but then both edit it → conflicts.
- `web` imports `core` directly — couples build pipelines; breaks if `core` changes.
- Monolith (no packages) — no isolation; constant conflicts.

**Consequences:**
- ✅ Zero file overlap → clean merges.
- ✅ `core` can evolve internals without breaking `cli`/`web` if public API stable.
- ✅ `web` gets real-time updates via WS; no build-time coupling.
- ⚠️ Requires disciplined API design; public API changes = version bump + coordination.
- ⚠️ `cli` server must be running for `web` to work (local dev only).

---

## ADR-003: No ORM — Raw SQLite with Typed Helpers

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Need local persistence for job queue, events, cache. Want zero-dep, fast, embedded.

**Decision:** Use `bun:sqlite` (native) with hand-written SQL + TypeScript query helpers in `core/src/storage/queries.ts`. No Prisma, Drizzle, TypeORM, Kysely.

**Alternatives Considered:**
- **Prisma** — heavy; generates client; overkill for 5 tables.
- **Drizzle** — lighter but still a dep; schema sync complexity.
- **Kysely** — good but adds dep; raw SQL is simple enough here.
- **better-sqlite3** — same as `bun:sqlite` but extra dep.

**Consequences:**
- ✅ Zero runtime deps for DB; Bun native.
- ✅ Full control over queries; easy to optimize.
- ✅ Migrations are plain SQL files — transparent.
- ⚠️ Manual mapping rows → types (mitigated by helper functions).
- ⚠️ No auto-migration on schema change (run manually via `stitch migrate`).

---

## ADR-004: Git Operations via `simple-git` + System `git-filter-repo`

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Need to clone, filter-repo extract, merge, push. `git-filter-repo` is Python CLI only.

**Decision:**
- Routine git ops (clone, commit, push, branch) → `simple-git` (wraps `git` binary).
- History rewriting (filter-repo) → shell out to `git-filter-repo` binary (installed via pip).
- Never use `isomorphic-git` (pure JS) — slower, incomplete, no filter-repo support.

**Alternatives Considered:**
- **isomorphic-git** — no filter-repo, no subtree, slower on large repos.
- **Node `child_process` for all git** — `simple-git` handles promises, errors, streaming better.
- **Embed filter-repo logic in JS** — impossible; it's a complex Python tool.

**Consequences:**
- ✅ Uses battle-tested git CLI; full feature parity.
- ✅ `git-filter-repo` is the standard for history rewriting.
- ⚠️ Requires `git` + `git-filter-repo` on PATH (checked by `stitch doctor`).
- ⚠️ Windows paths need care (use `path.resolve`, forward slashes for filter-repo args).

---

## ADR-005: AI Provider Abstraction — OpenRouter as Default Hub

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Want multi-provider support (OpenRouter, OpenAI, Anthropic, Ollama) without rewriting agent loop per provider.

**Decision:**
- Define `ChatProvider` interface in `core/src/ai/provider.ts`.
- Implement `OpenAICompatibleProvider` for OpenRouter/OpenAI/Ollama (all share OpenAI tool-calling schema).
- Implement `AnthropicProvider` for native Anthropic SDK (adapter normalizes to internal schema).
- Default: OpenRouter with `anthropic/claude-3.5-sonnet` — best tool-calling reliability.
- **Explicitly block Gemini 3 via OpenRouter** for agent loop (known `thought_signature` bug).

**Alternatives Considered:**
- **Use Vercel AI SDK** — adds dep; abstracts less than we need (we need tool loop control).
- **LangChain** — massive dep; overkill for single agent loop.
- **Direct Anthropic only** — locks out local models, OpenRouter flexibility.

**Consequences:**
- ✅ Swap provider by config; agent loop unchanged.
- ✅ OpenRouter = 1 key for 100+ models.
- ✅ Local Ollama supported for air-gapped/offline.
- ⚠️ Must track provider-specific quirks (Gemini 3 bug documented).
- ⚠️ Anthropic tool format differs — adapter required.

---

## ADR-006: Hybrid AI Autonomy — Auto Mechanical, Gated Generative

**Status:** Accepted
**Date:** 2026-08-30

**Context:** AI should fix boring stuff automatically but ask before writing net-new code.

**Decision:** Two tool categories in `AutonomyPolicy`:
- **Auto-executed:** `fix_dependency`, `edit_config`, `move_file`, `run_build` — applied immediately.
- **Gated (human approve):** `propose_component` — emits `proposal` event → Web UI diff viewer → Accept/Reject → continues loop.
- Policy configurable via `~/.stitch/config.json`; default as above.

**Alternatives Considered:**
- **Fully autonomous** — risk of hallucinated components breaking build; hard to audit.
- **Fully manual** — defeats "AI that thinks" value prop; too slow.
- **Approve all tools** — noisy; mechanical fixes are deterministic.

**Consequences:**
- ✅ Safety: net-new code always reviewed.
- ✅ Speed: 80% of fixes (deps, config) are instant.
- ✅ Audit trail: every proposal logged with decision.
- ⚠️ Requires WS round-trip for gated tools (latency ~100ms local).
- ⚠️ CLI-only users get prompts via Ink (simpler UX).

---

## ADR-007: Sandbox Verification via Docker (Primary) + GH Actions Fallback

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Must verify merged repo builds + tests pass. Need isolation, speed, reproducibility.

**Decision:**
- **Primary:** Docker containers via `dockerode`. Prebuilt base images per ecosystem (Node, Python, Go, Rust). Ephemeral per job.
- **Fallback:** GitHub Actions workflow dispatch — if Docker unavailable (CI, no Docker daemon). Poll run status via Octokit.
- Limits: 4GB RAM, 2 CPU, 10min timeout, no network, read-only rootfs.

**Alternatives Considered:**
- **VM (firecracker/microvm)** — faster cold start but complex; Docker is universal.
- **Local process (no isolation)** — security risk; can't test install cleanly.
- **Only GH Actions** — slow feedback (queue + spin-up); requires network + GH token.

**Consequences:**
- ✅ Fast local feedback (sub-minute for cached images).
- ✅ Works offline (Docker only).
- ✅ Reproducible: same image in CI and local.
- ⚠️ Requires Docker daemon (checked by `stitch doctor`).
- ⚠️ Base images must be maintained (GitHub Actions workflow builds them on tag).

---

## ADR-008: License Scanning — Declared Manifests First (license-checker), ScanCode Optional

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Need license compliance for MVP. Full source scanning (ScanCode) is heavy (Python, slow).

**Decision:**
- **MVP:** Scan *declared* licenses from manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`) using `license-checker` (npm) + SPDX normalization.
- **Optional Deep Scan:** Shell out to `scancode-toolkit` (Python) for per-file header detection — opt-in via config.
- Compatibility matrix: permissive ✅, weak copyleft ⚠️, strong copyleft (GPL/AGPL) 🚫 in permissive project.

**Alternatives Considered:**
- **Only ScanCode** — accurate but slow (minutes per repo); heavy dep; overkill for declared licenses.
- **FOSSA/Snyk/BlackDuck** — SaaS; paid; not local-first.
- **license-compatibility-checker (npm)** — unmaintained (2021); skip.

**Consequences:**
- ✅ Fast (seconds); catches 80% of real issues (declared licenses).
- ✅ Pure JS/TS stack for MVP.
- ⚠️ Misses undeclared licenses in source headers (mitigated by optional ScanCode).
- ⚠️ `license-checker` only scans `node_modules` by default — we run on manifest files directly.

---

## ADR-009: WebSocket for Real-Time UI (Not Server-Sent Events or Polling)

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Web UI needs live updates: AI reasoning stream, job progress, gated proposals.

**Decision:** Native WebSocket (`ws` library via Elysia's built-in WS) on `/ws`. Single connection per job. Auto-reconnect with exponential backoff.

**Alternatives Considered:**
- **Server-Sent Events (SSE)** — simpler but no binary; harder bidirectional (approve/reject needs POST anyway).
- **Polling** — latency; wasteful; can't stream AI reasoning chunks.
- **Socket.io** — extra dep; overkill for simple event stream.

**Consequences:**
- ✅ Bidirectional; low latency; streams reasoning tokens.
- ✅ Elysia WS is type-safe and fast.
- ⚠️ CLI server must stay running during merge (expected).
- ⚠️ If CLI crashes, WS drops — job continues in background; UI reconnects on restart.

---

## ADR-010: State Management — Zustand + TanStack Query (Web), Ink State (CLI)

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Web UI needs client state (UI) + server state (jobs, config).

**Decision:**
- **Client/UI state** → Zustand (minimal, no Context, `persist` middleware for settings).
- **Server state** → TanStack Query (caching, deduping, optimistic updates for REST).
- **WS events** → merge into Query cache via `useJob` hook.
- **CLI TUI** → Ink's built-in `useState`/`useReducer` (no external state lib).

**Alternatives Considered:**
- **Redux** — boilerplate; overkill.
- **Jotai/Recoil** — atomic but less familiar; Zustand is simpler.
- **React Context + useReducer** — manual; no devtools.

**Consequences:**
- ✅ Tiny bundle; great DevTools; TypeScript-first.
- ✅ Query handles race conditions, retries, stale-while-revalidate.
- ⚠️ Two state systems (Zustand + Query) — clear separation: UI vs Server.

---

## ADR-011: Provenance via Git Notes + CREDITS.md + SBOM

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Child repo C must be traceable to parents A, B for legal and debugging.

**Decision:** Three-layer provenance:
1. **Git Notes** — `git notes add -f -m '{"sourceRepo":"A","sourceCommit":"abc","author":"..."}' <file>` per file in C. Machine-readable, travels with repo.
2. **CREDITS.md** — Human-readable table: `path | sourceRepo | sourceCommit | author | license`.
3. **SBOM (CycloneDX)** — Standard format for supply chain tools; includes components + licenses.

**Alternatives Considered:**
- **Only CREDITS.md** — human-only; not machine-consumable.
- **Only SBOM** — verbose; hard for humans to read.
- **Commit message embedding** — pollutes history; not queryable.

**Consequences:**
- ✅ `git log --show-notes` shows origin per file.
- ✅ SBOM integrates with dependency scanners.
- ✅ CREDITS.md satisfies human audit.
- ⚠️ Git notes not cloned by default (`git clone --notes`); documented.

---

## ADR-012: Configuration via Zod Schema + Layered Merge

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Need type-safe config from multiple sources (defaults, file, env, CLI args).

**Decision:** Single `ConfigSchema` (Zod) in `core/src/config/schema.ts`. Loader merges: `defaults < file < env < CLI args`. File at `~/.stitch/config.json` (CLI) or `.stitch/config.json` (project).

**Alternatives Considered:**
- **cosmiconfig** — searches up dirs; adds dep; less explicit.
- **Pure env vars** — no file; hard for complex objects (provider config).
- **YAML only** — no schema validation.

**Consequences:**
- ✅ Types flow from schema to code; `ConfigSchema.parse()` validates.
- ✅ `zod-to-json-schema` generates JSON Schema for AI tool params.
- ✅ Layered merge is predictable.
- ⚠️ Must keep schema in sync across packages (single source in `core`).

---

## ADR-013: Error Handling — neverthrow Result<T, E> (No Exceptions)

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Want exhaustive error handling; avoid uncaught promise rejections.

**Decision:** Use `neverthrow` `Result<T, E>` everywhere in `core`. All public functions return `Result`. CLI/UI layer matches on `Ok`/`Err`.

**Alternatives Considered:**
- **Exceptions + try/catch** — easy to forget; not typed.
- **Custom `Result` class** — `neverthrow` is battle-tested, tiny, has `map`, `andThen`, `match`.

**Consequences:**
- ✅ Compiler forces handling both cases.
- ✅ Errors are values — serializable, loggable.
- ⚠️ Learning curve for team (mitigated by `core/src/result/` helpers).
- ⚠️ Interop with promise-based libs needs `.then(r => r.match(...))`.

---

## ADR-014: Testing — Vitest Only; No Jest, No Cypress

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Need unit, integration, e2e tests. Want single runner, native TS, fast.

**Decision:**
- **Unit/Integration** → Vitest (native Bun, TS, same API as Jest).
- **E2E (CLI)** → Vitest + `bun spawn` (test binary).
- **E2E (Web)** → Playwright (separate, only for web) — but run via Vitest `test.projects` if possible, else separate CI job.
- **Coverage** → Vitest built-in (v8); thresholds in `vitest.config.ts`.

**Alternatives Considered:**
- **Jest** — needs babel/ts-jest; slower; not native Bun.
- **Cypress** — heavy; only for web e2e; Playwright is faster and headless-friendly.
- **Separate test runners** — fragmentation; Vitest does all.

**Consequences:**
- ✅ One command: `bun test` runs everything.
- ✅ Native TS, no config hell.
- ⚠️ Playwright for web e2e is separate binary (install in CI).

---

## ADR-015: Release via Changesets + `bun build --compile`

**Status:** Accepted
**Date:** 2026-08-30

**Context:** Need versioning, changelog, multi-package publish, binary releases.

**Decision:**
- **Versioning/Changelog** → Changesets (conventional commits, per-package versions).
- **CLI Binary** → `bun build --compile` per platform in Release workflow.
- **Core Library** → `tsup` → ESM/CJS/DTS → `npm publish`.
- **Docker Image** → Build on tag push → `ghcr.io`.

**Alternatives Considered:**
- **Standard-version** — single version; we want per-package.
- **Release-it** — more config; Changesets is purpose-built for monorepos.
- **pkg/vercel/pkg** — deprecated; `bun build --compile` is native.

**Consequences:**
- ✅ Per-package versions (core can patch while CLI major).
- ✅ Single binary per platform — no runtime install needed.
- ✅ Automated: push tag → CI builds + publishes all.

---

## ADR-016: Add Epics 16–19 (P-320–P-366) — Eval Harness, Cross-Language Resolution, Confidence Scoring, MCP-First Distribution

**Status:** Accepted
**Date:** 2026-08-30

**Context:** The original 319-phase plan treats "sandbox green" (F-07) as the definition of success. That proves the merged repo *builds* and doesn't break existing tests — it does not prove the AI wired the two repos together *correctly*. There was no mechanism to measure agent success rate against a fixed corpus before/during development, no plan for resolving imports beyond JS/TS, and the MCP distribution channel was buried in post-MVP Wave 3. Pre-build risk review (external) recommended closing these gaps.

**Decision:**
- Append **Epic 16 (Eval Harness, P-320–P-333)**, **Epic 17 (Cross-Language Resolution, P-334–P-345)**, **Epic 18 (Confidence Scoring, P-346–P-356)**, **Epic 19 (MCP-First Distribution, P-357–P-366)** to the roadmap, raising the total to **366 phases**.
- **P-327 (baseline eval run)** is the single most important checkpoint in the plan: its composite score + failure taxonomy (P-331) is the **go/no-go gate** for the rest of the roadmap.
- **Epic 17 is CONDITIONAL** — it is only built if P-331 shows import-resolution failures as a top-2 category. If tree-sitter heuristics (P-020/P-021/P-022) are already good enough per the baseline, skip to Epic 18 and revisit later.
- **Epic 18's weighting** is finalized only after P-354 (calibration vs human rubric) data exists — never by assumption.
- **P-299 (MCP Server for OpenCode) is SUPERSEDED by Epic 19.** Epic 19 is the fuller MCP-first treatment; the OpenCode use case is covered by P-358 (`stitch_select_files`) and P-363 (OpenCode host compatibility).
- Add milestones **M10 (Eval Baseline Established), M11 (Resolution Upgrade, conditional), M12 (Confidence Scoring Live), M13 (MCP Channel Live)**.
- Add Wave 2 exit-criteria gate: *"Eval corpus (P-321) composite score ≥ [target]% before MVP tag"* — target number chosen only after P-327, not guessed now.
- **Doc-hygiene fix (provenance):** PROGRESS.md's Wave 0 dependency block had duplicate/off-by-two phase IDs (P-048/P-049/P-050...P-068) that did not match PHASES_DETAILED.md. Renumbered P-047–P-068 to match the master; removed a spurious "P-067 Lockfile" entry (lockfile regeneration is P-114). MASTER_PLAN.md dependency-graph line `P-068 (lockfile)` also corrected to `P-068 (stitch doctor)`.

**Alternatives Considered:**
- **Keep 319-phase plan unchanged** — rejected: no mechanism to validate the core premise (does the AI actually wire repos correctly), no cross-language resolve, MCP too late.
- **Fully ship Epic 17 now** — rejected: building an LSP resolver preemptively risks wasted work if the baseline shows resolution isn't the bottleneck.
- **Delete P-299 rather than supersede** — rejected: keeping the ID with a superseded note preserves history for any script parsing completion.

**Consequences:**
- ✅ Measurable, corpus-based validation of the core AI-stitching premise (P-327) instead of assumptions.
- ✅ Cost/token tracked per run (P-330) so eval spend isn't a surprise; reuses existing budget tracking (P-302/P-137/P-145).
- ✅ MCP distribution starts earlier (parallel track after M6), not deferred to Wave 3.
- ⚠️ Phase count rises 319 → 366; MASTER_PLAN/PROGRESS/CONTEXT must be updated in the same change.
- ⚠️ Epic 17/18 carry conditionality — their phases exist in docs but are only executed if baseline/calibration data supports them.
- ⚠️ P-299 now references Epic 19; implementers must read the Epic 19 block to avoid duplicate MCP work.

---

## ADR-017: JSON Schema via Zod v4 Native `toJSONSchema`, Drop `zod-to-json-schema`

**Status:** Accepted
**Date:** 2026-09-06

**Context:** P-039 needs JSON Schema emission from Zod schemas (config schema for tooling/docs, AI tool args in P-139, I/O validation in P-297/298). `zod-to-json-schema@3.25.2` was installed at root in P-015, but P-015 proved empirically it does not support zod v4 schemas (returns just `{"$schema"}`); its peer range claims `^4` compat but conversion is empty. P-015 named P-039 as the follow-up with two options: (a) downgrade zod to v3, or (b) use zod v4's native converter.

**Decision:**
- Use zod v4's native `toJSONSchema()` (verified: preserves enums, `format: uri` for `z.url()`, full required lists on ConfigSchema).
- Add `configJsonSchema()` in `packages/core/src/config/jsonSchema.ts`, exported via the core barrel.
- Remove the broken `zod-to-json-schema` root devDependency (dead weight); do NOT add it to core.
- Update the P-015 KNOWN-ISSUE test to assert the resolved state.

**Alternatives Considered:**
- **Downgrade zod to ^3.25.x** — rejected: `schema.ts` uses the v4 API (`z.url()`), all config tests assert v4 behavior; ripple across every current and future zod consumer for the sake of one adapter package.
- **Keep the package installed but unused** — rejected: dead dependency that will confuse P-139/P-297 implementers into importing a silently-broken converter.
- **Vendor a fork/patch of zod-to-json-schema** — rejected: upstream may fix v4 support later; until then native covers all needs with zero extra deps.

**Consequences:**
- ✅ Working JSON Schema path with no new dependency.
- ✅ P-139/P-297/P-298 have a proven pattern (`toJSONSchema` on any schema).
- ⚠️ If a future consumer needs a JSON Schema draft older than 2020-12, native output targets 2020-12 only — revisit then.
- ⚠️ P-015's smoke file now asserts the fixed behavior; the old broken-state assertions are gone (history preserved in git).

---

## ADR-018: Bun Types via `@types/bun` Alias + Scoped tsconfig `types`

**Status:** Accepted
**Date:** 2026-09-08

**Context:** P-061 wires Bun/Node ambient types at the root. Until now `bun:sqlite` types came from a local shim (`packages/core/src/types/bun.d.ts`, P-030) holding a `/// <reference types="bun-types" />` so the frozen `tsconfig.base.json` stayed untouched. That shim's comment claimed `@types/bun` is deprecated upstream in favour of `bun-types` and suggested `types: ["bun-types", "node"]` instead. Both claims were re-probed against the live registry before touching the frozen file: `@types/bun@1.4.2` (published 2026-09-08, no `deprecated` field, ts6.0 tag) is a one-line alias (`/// <reference types="bun-types" />`) authored by the Bun team itself, depending on `bun-types@1.4.2` — the exact version already hoisted at root. And `types: ["bun-types"]` cannot work: the `types` field resolves under `node_modules/@types`, where `bun-types` does not live.

**Decision:**
- Add root devDep `@types/bun@1.4.2` (exact; `@types/node` stays at 26.4.1 — a transient 26.5.0 bump during install was deliberately reverted to keep the diff phase-pure).
- Set `tsconfig.base.json` `types: ["bun", "node"]`, scoping global auto-inclusion to Bun + Node. Module imports (`react`, dep `@types/*`) resolve independently of this field and are unaffected.
- Delete the `bun.d.ts` shim (its own documented completion criteria).

**Alternatives Considered:**
- **`types: ["bun-types", "node"]` (shim comment's suggestion)** — rejected: unresolvable path (TS2688), verified against TS module-resolution rules; the shim's deprecation claim is stale.
- **Keep the shim, skip the `types` field** — rejected: every future Bun-global consumer would need its own triple-slash line; the spec's centralized wiring is strictly better. Deleting also removes a file whose comment would otherwise mislead P-139+ implementers.
- **Accept the `@types/node` 26.5.0 drift** — rejected: types-only churn with no phase justification; reverted to 26.4.1.

**Consequences:**
- ✅ `bun:sqlite` + `Bun` globals resolve monorepo-wide with no per-file references; `types.smoke.test.ts` pins this.
- ✅ Removing the shim was proven load-bearing first: without it and without the `types` entry, `tsc` fails on `bun:sqlite`/`Bun` (TS2868 even prescribes this exact fix).
- ⚠️ Any future `@types/*` package whose *globals* (not imports) are needed must be appended to the `types` array with a comment — imports keep working regardless.

---

## ADR-019: Exclude Build Output from Coverage (`**/dist/**`)

**Status:** Accepted
**Date:** 2026-09-08

**Context:** P-062's `it('builds')` imports `packages/core/dist/index.js` + `require()`s `dist/index.cjs` to prove the bundles load. V8 coverage then tracks those loaded bundle files, and the aggregate report collapsed (statements 88.9% → 44.8%) even though every per-path threshold still passed. The installed vitest 5 defaults were read from source to rule out a replace-vs-merge trap: base `coverage.exclude` defaults to `[]`, and test-file exclusion is applied dynamically by vitest core (independent of the option), so setting `exclude` only ADDS patterns.

**Decision:**
- Add `coverage.exclude: ['**/dist/**']` to root `vitest.config.ts` (frozen file — this ADR is its authorization). The `**/` prefix matters: a bare `dist/**` would only match a root-level `dist/`, not `packages/*/dist/`.
- Justification (P-259 anticipates this class): `dist/` is generated output, gitignored, and already covered transitively — every bundled line originates from `src/` files measured directly. The `it('builds')` load assertions guard the bundle; coverage guards the sources.

**Alternatives Considered:**
- **Move the dist-load assertions out of the suite** — rejected: spec step 3–4 requires proving the bundles load and types resolve; untested build output is how P-278 would ship a broken package.
- **coverage `include` limited to `src/`** — rejected: larger diff touching per-project semantics; a single exclude pattern is minimal and matches P-259's planned exclude list (which will extend this same array for generated clients).

**Consequences:**
- ✅ Aggregate coverage returns to source-only numbers; thresholds unchanged and still enforced.
- ⚠️ Future generated files (P-252 client, P-259 baselines) must extend this array with the same justification format.

---

## ADR-020: Git >= 2.40 Floor — Doc + One-Line Frozen Cross-Refs (Doctor Wiring Deferred)

**Status:** Accepted
**Date:** 2026-09-08

**Context:** P-065 requires the git >= 2.40 system-doc plus a `MIN_GIT_VERSION`
constant, cross-referenced from the install docs — two of which (AGENTS.md,
SECURITY.md) are frozen. It also names doctor wiring (P-068) and a `doctor`
test, but no doctor exists yet (P-068 owns it; P-066 is next).

**Decision:**
- New `docs/system/git-version.md`: requirement, `MIN_GIT_VERSION` pointer,
  per-OS install/upgrade, `git --version` verification. Historical claims kept
  minimal and honest: the floor is a project matrix decision (Git Core epic
  built/tested against >= 2.40); the only release-specific assertion in the
  doc is the empirically verified one (unrelated-history `ort` merge works,
  transcript from git 2.45.1 included).
- New `packages/core/src/git/version.ts` (barrel-exported):
  `MIN_GIT_VERSION = '2.40.0'`, `parseGitVersion` (distro suffixes),
  `isGitVersionSupported` (strict: garbage coerces to err, never silent
  pass), plus `checkGitVersionOutput`/`localGitVersion` compositions P-068
  needs — all covered, including the verbatim `it('flags old git')`.
- Frozen cross-refs (this ADR is their authorization, docs-only links):
  one pitfalls-table row in AGENTS.md, one line under SECURITY.md section 5.
  TECH_STACK.md bullet extended (not frozen, no ADR needed for it alone).
- Doctor behavior + `doctor` test stay with P-068 (explicit non-scope).

**Alternatives Considered:**
- **Write the doctor check now** — rejected: P-068 owns the doctor verifier;
  building it here would pre-empt its spec and duplicate P-066's sequencing.
- **Loose check (warn-only helper in docs)** — rejected: the strict
  err-on-garbage contract is what makes the future doctor gate meaningful;
  pinning it now prevents a permissive default from fossilizing.
- **Skip frozen cross-refs to avoid an ADR** — rejected: the spec explicitly
  requires them, and undiscoverable docs rot; a docs-only ADR is cheap.

**Consequences:**
- ✅ P-068 has tested primitives + a doc to link; nothing to re-derive.
- ⚠️ The `doctor` test (`it('flags old git')` at doctor level) is still owed
  by P-068 — this phase's same-named test covers the version module only.

---

## ADR-021: P-148 Extends `GitFacade` + `LoopConfig` to Make Agent Tools Callable

**Status:** Accepted
**Date:** 2026-09-24

**Context:** P-148 (`select_files`) is the first agent tool of Epic 7 and the
first tool to actually read its runtime context. Two P-140 contracts turn out
to be insufficient for that, and the P-148 blueprint assumes both already work:

1. The blueprint's `execute` pseudo-code calls
   `ctx.git.listFiles(ctx.cwd, args.repo)`, but P-140 shipped `GitFacade` with
   only `diff`/`status`/`commit`/`add`. There was no file-listing capability.
2. P-140's loop hardcoded `tool.execute(args, {} as ToolContext)` — an empty
   cast, with the comment "ToolContext needs to be provided by caller" and no
   way for a caller to do so. Any tool dereferencing `ctx` would have thrown a
   `TypeError` at runtime, which would have made P-148's own mandated
   `runs through loop registry` test fail.

Neither is a plan error to be silently absorbed: P-148 both depends on a
listing and mandates executing through the loop, so both gaps are load-bearing.

**Decision:**
- Add `listFiles?(cwd: string, repo: 'A' | 'B'): Promise<Result<string[], StitchError>>`
  to `GitFacade`, using the blueprint's **exact** argument order rather than
  reshaping the call. Optional (`?`) so P-140-era facades keep compiling; the
  tool reports a typed `CONFIG_ERROR` when it is absent, because an unwired
  facade is a wiring fault and not a missing path — conflating the two would
  have the UI tell the model its path was wrong when the job was misconfigured.
- Add `context?: ToolContext` to `LoopConfig` and thread it into `execute`.
  Defaults to the previous `{} as ToolContext`, so every pre-P-148 caller and
  test behaves byte-identically.
- The tool re-validates its own arguments before use. The loop already parses
  via `parseToolArgs` (P-139), but `execute` is public; re-validating yields
  `TOOL_ARGS_VALIDATION` instead of a `TypeError` for direct callers.

**Alternatives Considered:**
- **Have the tool walk the filesystem itself** — rejected: the tool deliberately
  knows only `cwd` and the `A`/`B` label, never the checkout paths. The
  orchestrator (P-238) owns the A-to-path mapping; baking it into the tool would
  duplicate that mapping and make the tool untestable without real repos.
- **Read listings from `ctx.config`** — rejected: `config` is a
  `Record<string, unknown>` bag; an untyped channel for a core contract is
  exactly the "phantom API" the guardrails prohibit.
- **Make `listFiles` required on `GitFacade`** — rejected: it is a breaking
  change to a P-140 public type with no implementors yet but real export
  surface. Optional keeps the addition non-breaking and defers the migration
  to whoever wires the orchestrator.
- **Return a second error code for a misconfigured facade** — rejected: spec
  mandates one code; `CONFIG_ERROR` already models "a field is wired wrong"
  and carries the `field` name the caller needs.

**Consequences:**
- `select_files` is executable both directly and through the P-140 loop, and
  the mandated loop test passes against a real context.
- No pre-P-148 test changed behavior (both additions are optional).
- `ToolContext` is still unvalidated at the loop boundary — a caller can pass a
  partial object. The orchestrator (P-238) owns constructing a complete one;
  `select_files` guards its own access defensively.
- The A-to-checkout mapping remains unimplemented until P-238 injects a real
  `GitFacade`. P-148's tests inject an in-memory listing, which is the same
  seam the tool will use in production.

---

## ADR-022: P-149 Parses Imports from Facade-Supplied Content, Not via madge

**Status:** Accepted
**Date:** 2026-09-24

**Context:** P-149 (`resolve_dependency_closure`) step 2 says to parse imports
"via the ecosystem parser ... via madge/dependency-cruiser P-021/P-022 when
JS". Two obstacles make that instruction unimplementable as literally written:

1. `madge` and `dependency-cruiser` are **rooted at a real filesystem
   directory** and return a graph. A tool operating through `ToolContext` does
   not know its checkout paths — ADR-021 established that the facade
   deliberately hides them, so the orchestrator owns the A/B path mapping.
2. `GitFacade` (P-140, extended in ADR-021) offered only `listFiles` (names).
   P-149 needs file *contents* to read import statements at all, and no such
   method existed anywhere in core — every `readFile` in the codebase is
   internal to a module that already knows its own root.

**Decision:**
- Add `readFile?(cwd, repo, path): Promise<Result<string, StitchError>>` to
  `GitFacade`, optional for the same compatibility reason as `listFiles`.
- Import extraction runs over that content, implemented as pure functions in
  `agent/imports.ts` (`parseJsImports`, `parsePythonImports`, bare-vs-relative
  classification, relative-path resolution against a listing).
- Filter Node builtins and the Python 3 stdlib out of the required set, so
  `import fs` and `import os` are never reported as installable packages.
- Source-repo manifest dependencies (P-104–P-107) are read through the same
  `readFile` and merged in, so python/cargo/go requirements are reported even
  when no import statement names them.
- The deviation from the blueprint is recorded here rather than silently
  absorbed: the capability the step asked for (JS import resolution) is
  delivered; the named library is not usable at this layer.

**Alternatives Considered:**
- **Have the orchestrator precompute a madge graph and inject it** — rejected:
  it moves the closure computation out of the tool, contradicting the step that
  says the tool parses imports per file, and it would require madge to run
  against repos the tool has not been told about.
- **Give the tool the checkout paths via `ctx.config`** — rejected: untyped
  channel for a core contract (the "phantom API" the guardrails prohibit).
- **Use tree-sitter (P-020) for exact import extraction** — rejected as
  premature: it is accurate but heavyweight per file, and P-149 needs a
  deterministic lexical scan across possibly thousands of selected files. P-340
  (heuristic fallback) and Epic 17 (LSP resolvers) own the accuracy upgrade;
  the pure functions here are the seam they will replace.
- **Make `readFile` required on `GitFacade`** — rejected: same non-breaking
  rationale as ADR-021's `listFiles`.

**Consequences:**
- `resolve_dependency_closure` is fully testable offline with no filesystem,
  no madge, and no checkout knowledge.
- Import extraction is documented as best-effort lexical analysis that errs
  toward reporting a package that may not be needed — the safe direction for a
  tool whose purpose is preventing broken stitches.
- P-150 and P-151 consume the same `missing`/`missingDirect`/`missingTransitive`
  output, so the severity model is now part of the agent contract.

---

## ADR-023: P-150 Adds a Read-Only `StagingFacade` for Child Repo C

**Status:** Accepted
**Date:** 2026-09-24

**Context:** P-150 (`detect_gaps`) inspects "the current child-repo **staging
state**" — what has actually been composed into repo C so far. Every context
surface that existed could not express that:

- `GitFacade` (P-140, extended by ADR-021/ADR-022) addresses the **source**
  repos, and its repo parameter is typed `'A' | 'B'`. Repo C is not a source.
- `ToolContext` (P-140) holds `cwd`, `config`, facades, and no job state, so
  there was nowhere to say "this is what C currently contains".
- P-150's spec signature `detectGaps(ctx, opts: { focus?: GapKind[] })` carries
  no selection, yet the `missing_dep` check is specified as "reuse P-149
  `resolveDependenciesForFiles` over the selected set" — which needs the P-148
  `SelectedFile[]` to know what was selected.

**Decision:**
- Add `StagingFacade { listStagedFiles(); readStagedFile(path) }` to
  `ToolContext` as `staging?`. It has **no write methods**, so "P-150 is
  read-only" is enforced by the type rather than by convention; P-151–P-153 get
  their own mutation surface.
- Extend `DetectGapsOptions` with `selection?: SelectedFile[]` (additive). The
  spec's `opts` carries only `focus`, but the `missing_dep` check cannot run
  without the selection, and `ToolContext` deliberately holds no job state.
- Severity for `missing_file`, which the spec does not state: `warning`. The
  spec names severities for `missing_dep` (high), `broken_import` (error),
  `missing_env`/`config_mismatch`/`missing_test` (warning), and is silent on
  `missing_file`; warning is the conservative default that does not block a
  job over a missing README.
- A commented assignment in `.env.example` (`# SANDBOX_BACKEND=docker`) counts
  as a **declared** var. The example file is documentation, and a var that is
  only listed as an optional setting is still known to the project.
- Checks needing `staging` return `CONFIG_ERROR` when it is absent rather than
  reporting no gaps — a silently empty report is worse than a wiring fault.

**Alternatives Considered:**
- **Widen `GitFacade`'s repo parameter to `'A' | 'B' | 'C'`** — rejected: it
  would change `SelectedFile.repo`, a P-148 contract the spec fixes as
  `'A' | 'B'`, and provenance (P-181) reads that field.
- **Reuse `cwd` as the staging root and touch the filesystem directly** —
  rejected: the facade pattern exists precisely so tools do not assume where
  repos live, and direct fs access makes the tool untestable offline.
- **Stash the staging state on `ctx.config`** — rejected: untyped channel for a
  core contract (the "phantom API" the guardrails prohibit).
- **Make `staging` required on `ToolContext`** — rejected: same non-breaking
  rationale as ADR-021/ADR-022; P-148/P-149 tools do not need it.

**Consequences:**
- All six P-150 checks are testable offline with no filesystem.
- "Read-only" is a type-level property, so P-151–P-153 cannot accidentally
  route a mutation through the gap detector.
- P-151–P-153 consume `Gap`/`GapKind`; `GAP_KINDS` is exported as a const array
  so the tool schema enum and the runtime check list cannot drift apart.

---

## ADR-024: P-151 Validates Ranges Without Canonicalizing Them

**Status:** Accepted
**Date:** 2026-09-24

**Context:** P-151 step 2 says to "normalize `range`" and its handoff says
`fix_dependency` "must prefer preserving A/B's original range choice (per
resolve) to honor 'as-authored' provenance". Those two instructions pull in
opposite directions for this codebase, because P-019's `validRange` does not
merely validate — it **canonicalizes**: `^1.3.0` comes back as
`>=1.3.0 <2.0.0-0`.

Writing the canonical form is semantically identical and would have silently
destroyed the as-authored provenance the handoff explicitly requires. The first
implementation returned `validRange(...)`'s output and the test suite caught it
immediately (4 failures, all showing `>=1.3.0 <2.0.0-0` where `^1.3.0` was
authored).

**Decision:**
- `validatePreserving(range)` runs `validRange` purely as a parse check and
  returns the caller's **own** text on success. The canonical form is used only
  to prove the range is valid; it is never persisted.
- `rangesEquivalent` (the "is this already satisfied?" test) still compares
  canonical forms, because equivalence is a semantic question — `1.3.0` and
  `^1.3.0` really are the same pin and must produce `action: 'unchanged'`.
  When the action is `unchanged`, the reported `version` is the range already
  in the manifest, not the requested one.

**Alternatives Considered:**
- **Persist the canonical range** — rejected: it is semantically fine and
  provenance-wrong. A reader comparing C's manifest against A's would see a
  diff for a package that was never changed.
- **Skip `validRange` entirely and let the registry reject bad ranges** —
  rejected: it would make validation a network round-trip and would leave the
  "no network in tests" guarantee (P-151) unenforced offline.
- **Return canonical form but log the authored form to P-181's audit** —
  rejected: the manifest on disk is what tools and humans read, and a fix that
  needs a side-channel to recover what it wrote is a bad fix.

**Consequences:**
- C's manifest keeps the exact range A or B authored whenever `'auto'` picks
  the source pin, satisfying the handoff.
- The `resolves auto range` test asserts `~1.2.0` survives verbatim, which is
  the standing regression guard against reintroducing canonicalization.
- `serializeFixedManifest` uses P-104's `serializePackageJson` directly rather
  than the P-115 `getParser(...).serialize()`: the plugin's `serialize` throws
  on an ecosystem mismatch (`deps/parsers/npm.ts:29`) and `getParser` throws on
  an unknown ecosystem (`deps/plugin.ts:48`), both of which would violate the
  no-throw rule. A non-npm manifest returns `undefined` instead of throwing.

---

## ADR-025: P-152 Uses `smol-toml` and a Hand-Rolled Unified Diff

**Status:** Accepted
**Date:** 2026-09-24

**Context:** P-152 (`edit_config`) names three things that do not exist as
written, and one security requirement it states but does not scope:

1. "`.toml` → `@iarna/toml`" — that package is **not installed**. P-106
   (`deps/parse/cargo.ts:37`) already established `smol-toml` as this repo's
   TOML implementation, and TECH_STACK pins the dependency set.
2. "write via `ctx.git.writeFile` (P-076)" — `GitFacade` had no write method at
   all. Every `writeFile` in core is internal to a module that already knows
   its own filesystem root.
3. "Return ... `diff` where `diff` is a unified diff string" — **no diff
   library is installed or used anywhere in core** (verified by search; the
   `toMatch` hits are Vitest matchers, not a diff utility).
4. Prototype pollution is a *requirement* ("reject dangerous keys") but the
   spec does not say at what layer to enforce it.

**Decision:**
- Use `smol-toml` (P-106's already-vetted choice) rather than adding
  `@iarna/toml`. TECH_STACK is the enforced dependency contract; adding a
  second TOML parser for one call site would be a scope violation.
- Add `readStagedFile?` and `writeFile?` to `GitFacade`, both optional, matching
  the ADR-021/022/023 precedent. P-076's `writeToWorktree` is the production
  implementation the orchestrator injects.
- Implement a self-contained LCS unified diff in `agent/diff.ts`. Config files
  are small, so the O(n*m) table is irrelevant at this size and produces the
  minimal edit script, which is what makes the output readable in a review UI.
- Enforce prototype-pollution refusal in `agent/configDoc.ts` at three layers:
  `parseKeyPath` splits, `assertSafeKeyPath` denies `__proto__`/`prototype`/
  `constructor` up front, and every object built during `setAtPath`/`deepMerge`
  uses a **null prototype** so an inherited `Object.prototype` member can never
  be read as data. `getAtPath` additionally reads only own properties.
- JSONC comment stripping is string-aware: a `//` inside a JSON string literal
  is preserved. P-152's handoff calls out comment stability explicitly, and a
  naive regex corrupts `"https://example.com"`.

**Alternatives Considered:**
- **Add `@iarna/toml`** — rejected: TECH_STACK is enforced by lint and human
  review; the repo already standardizes on `smol-toml` for P-106.
- **Shell out to `git diff --no-index` for the diff** — rejected: it needs a
  filesystem and a subprocess, which breaks offline testability and adds a
  process spawn to a pure function.
- **Validate dangerous keys only in the tool, not the document layer** —
  rejected: the path walker is the component that actually indexes and
  assigns. Guarding at the call site leaves a foot-gun for P-161 and P-166.
- **Preserve JSONC comments across a round-trip** — rejected as out of scope:
  it needs a comment-position-preserving JSONC parser. P-152's handoff asks for
  a *stable strip*, not a lossless round-trip, and the undo stack restores the
  exact original bytes on revert.

**Consequences:**
- `edit_config` is fully testable offline with no filesystem, no subprocess, and
  no registry.
- Reverting restores byte-identical original content, so the loss of comments
  in the *forward* path is reversible even though the write itself normalizes
  formatting.
- Two real bugs were caught by the suite and fixed at the source rather than
  papered over: `merge` returned the merged subtree instead of writing it back
  at the key path (discarding every sibling of the merged key), and a
  test-fixture key mismatch exposed that staged files are addressed
  repo-relative (ADR-023) while the stage-root prefix is only a containment
  boundary.

---

## ADR-026: P-153 Plans and Executes Separately; Rewrites Are Syntax-Anchored

**Status:** Accepted
**Date:** 2026-09-25

**Context:** P-153 (`move_file`) has one absent contract and one requirement it
states but does not scope:

1. Step 3 says "`ctx.git.move(from, to)`" — `GitFacade` had no `move` method.
   P-152 added `readStagedFile?`/`writeFile?`; a rename is genuinely different,
   because a read-then-write pair can leave content at BOTH paths if the process
   dies between the two.
2. The handoff is emphatic: "Keep import-rewrite matching **conservative** — only
   rewrite known relative refs, **never substring-match unrelated text**." A naive
   `content.replace('./util', './shared/util')` would also rewrite the same text
   in prose, comments, and unrelated string literals.

**Decision:**
- Add `move?(cwd, repo, from, to)` to `GitFacade`, optional, same rationale as
  every other facade addition (ADR-021/022/023/025). Rollback calls it in
  reverse, so it is required to be symmetric.
- **Plan and execute are separate functions.** `planMove` runs every check and
  computes every rewrite while writing nothing, so a dry run is the *same code
  path* as a real plan rather than a parallel implementation that can drift. The
  test asserts the dry-run and real plans produce byte-identical
  `importRewrites` — the guarantee that makes the dry run trustworthy.
- **Rewrites are anchored to import syntax.** `rewriteImportRefs` applies each
  replacement through a regex requiring the specifier to follow
  `from` / `import(` / `require(` / `import` with a matching quote pair. The
  test plants four decoys — prose, a line comment, a bare string literal, and a
  variable merely named `requireLike` — and asserts all four survive untouched
  while real static, dynamic, and CJS imports are updated.
- `executeMove` captures the prior content of every file it will touch BEFORE
  touching anything, then rolls all of it back and reverses the move on failure.
  The rollback test uses two importers and fails the *second* write, proving the
  first one's rewrite is reverted rather than left half-applied.
- A `dryRun` plan passed to `executeMove` is an explicit no-op — the safest
  possible reading, and it means a caller cannot accidentally execute a plan
  they meant only to inspect.

**Alternatives Considered:**
- **Do a global string replace** — rejected: exactly what the handoff forbids.
  A tsconfig comment or a doc string naming the module would be corrupted.
- **Use madge/dependency-cruiser to find dependents** — rejected per ADR-022:
  both are rooted at a real filesystem directory, and the facade deliberately
  hides checkout paths. The textual relative-path scan (reusing P-149's
  `parseJsImports` + `resolveRelativeImport`) is the same capability at the
  layer that can actually reach it.
- **Implement dry run as a separate `dryRunPlan` function** — rejected: two code
  paths computing rewrites will eventually disagree, and then the dry run stops
  being evidence.
- **Roll back by re-reading the file from the source repo** — rejected: the
  staged content may never have existed in A or B, since P-151/P-152 can produce
  it. Only the captured bytes are authoritative.

**Consequences:**
- A move cannot leave a half-rewritten tree, which is the failure mode that
  makes automated refactors untrustworthy.
- The dry run is genuinely predictive, not indicative.
- A real bug was caught by the suite and fixed at source: `rewriteSpecifier`
  kept the *target's* file extension when the author's ref had an explicit one,
  silently rewriting `./util.js` to `./shared/util.ts`. That is a real and
  common convention (NodeNext resolution) and the rewrite changed the author's
  intent. The test for it is now a standing guard.

---

## ADR-027: P-154 Re-Validates at Apply Time and Treats Registration as Append

**Status:** Accepted
**Date:** 2026-09-25

**Context:** P-154 (`propose_component`) is the first `gated` tool: it drafts a
net-new component and returns it for human approval, writing nothing until
`applyProposal` runs. Two consequences of being the *first* gated tool are easy
to get wrong, and both were caught by the suite:

1. **A proposal outlives the world it was drafted in.** Between drafting and a
   human clicking approve, another agent action (or a concurrent job) can create
   the target file. Applying on the strength of the draft-time check alone would
   silently clobber it.
2. **The registration file is an append target, not a create target.** A barrel
   entry only makes sense for a barrel that already exists, so a blanket
   "nothing may exist" check makes registration impossible by definition.

Separately, `ComponentProposal.path` is repo-relative (ADR-023: the staging
facade speaks repo-relative paths), which means it no longer carries the `C/`
stage-root prefix that `assertWithinRoot` requires of a caller-supplied path.

**Decision:**
- `applyProposal` re-runs containment and non-collision at apply time. The
  non-collision check covers the component and its sibling test — the two files
  that must be created — and deliberately **excludes** the registration file,
  which is read-and-appended.
- Added `assertRelativeInside` for paths that are already repo-relative. It
  answers the question that actually matters for such a path — can it escape the
  stage? — rather than demanding a prefix that is no longer there. Reusing
  `assertWithinRoot` here was a real bug the suite caught: it rejected every
  legitimate proposal with "outside stage root C".
- The `testPath` field is additive to the blueprint's `ComponentProposal`. An
  approver who sees code without the test that will be written alongside it
  cannot make an informed decision, and the path must be known to review the
  sibling spec.
- Draft scaffolds follow TECH_STACK §7/§11: single quotes, 2-space indent,
  trailing commas, explicit JSDoc, `export function` (not default-only), and
  **Vitest** — never Jest — for the sibling spec. The tests assert this on the
  generated text, since the handoff requires approved code to build as-is.

**Alternatives Considered:**
- **Trust the draft-time checks and apply directly** — rejected: it makes the
  approval meaningless in the one case that matters most (a human approved a
  file that no longer means what they saw).
- **Snapshot and restore on apply failure** — deferred to P-161, which owns
  "Revert a tool action". Adding a partial rollback here would duplicate that
  and give two mechanisms with different guarantees.
- **Store the proposal on disk so the UI can read it** — rejected: the spec says
  keep the draft in memory only, and a disk artifact would be a write before
  approval, violating the tool's entire purpose.
- **Use the model's raw output as the component code** — rejected: P-154 step 2
  specifies a template-produced scaffold, and the handoff requires it follow
  CODE_STYLE/TECH_STACK so it builds without a human rewrite.

**Consequences:**
- The gated tool's central negative property is tested directly: every test
  asserts the **write journal is empty** after drafting, not merely that a
  proposal was returned.
- `propose_component` is now the only `gated` tool in the registry, asserted by
  a test that also pins every other tool to `auto` — so a future tool cannot
  silently opt into the wrong autonomy class.
- P-160's HIL queue and P-218's web gate can serialize the proposal object
  directly; its field set is documented as stable.

---

## ADR-028: P-155 Adds `SANDBOX_UNAVAILABLE` and an Injected `SandboxRunner`

**Status:** Accepted
**Date:** 2026-09-25

**Context:** P-155 (`run_build`) is the read-only verification step that closes
the agent loop, and it carries the strongest constraint in Epic 7:

> "Call the SANDBOX runner (P-171 build / P-172 test) — **never run on the
> host**." … "Read-only on the host tree (diff applied in sandbox)."

Two things had to be resolved:

1. **No sandbox surface existed.** P-168's Docker client
   (`sandbox/docker.ts`) and P-067's daemon probe exist, but there is no facade
   an agent tool can call, and `ToolContext` had no place to put one.
2. **`SANDBOX_UNAVAILABLE` did not exist as an error code.** The spec mandates
   the name explicitly, and the closest existing code — `SANDBOX_FAILED` — is
   semantically wrong for it: a failed build ran and produced a verdict; an
   unavailable backend produced **no verdict at all**. Collapsing them would
   make the agent loop treat "we could not check" as "the build is broken" and
   iterate on a fix for a problem that was never measured.

**Decision:**
- Add `SANDBOX_UNAVAILABLE { message; backend? }` as a distinct code (44 total),
  wired into the union, `STITCH_ERROR_CODES`, the exhaustive `doctor.ts`
  renderer, and the build-smoke count.
- Add `SandboxRunner { backend; available(); run() }` to `ToolContext` as
  `sandbox?`, alongside the P-150 `StagingFacade`. It is **injected, never
  constructed by the tool layer**, so "never on the host" is a structural
  property of the type surface rather than a convention the code could forget.
  `run_build.ts` contains no `child_process`, no `execa`, and no shell
  invocation of any kind.
- `available()` is separate from `run()` so "no backend" and "build failed"
  are distinguishable at the type level.
- A build failure is terminal: the test step is skipped and `flaky` stays
  false, because repeating a failed build cannot produce new information.
- A failing build returns `ok(BuildOutcome{pass:false})`, not an `err`. A red
  build is a *result*; only an absent backend is a tool error.
- Logs are bounded to the last `MAX_BUILD_LOG_LINES` (500) per stream, keeping
  the **tail** — a build failure is at the end of the output.

**Alternatives Considered:**
- **Return `SANDBOX_FAILED` when no backend exists** — rejected: it is
  semantically false (nothing failed) and would make the loop's iterate-or-stop
  decision wrong in the most dangerous direction.
- **Call `sandbox/docker.ts` directly from the tool** — rejected: that couples
  the agent layer to a concrete Docker client, breaks offline testability, and
  leaves P-175's GH Actions fallback with nowhere to plug in.
- **Add a host-execution fallback so `run_build` always works** — rejected
  outright: the spec forbids it twice, and it would execute untrusted merged
  code on the developer's machine.
- **Always repeat the build for flakiness** — rejected: only the test step is
  subject to flakes; a deterministic build failure repeated is just slower.

**Consequences:**
- `run_build` is fully testable offline with a fake runner, and the tests
  assert on the **call journal** (which command, which step, how many times)
  plus an assertion that the host write journal stays empty.
- The ordering question flagged before this phase is resolved by the blueprint
  itself: `MASTER_PLAN.md:53` lists Epic 8 (P-168–P-180) as depending on
  Epic 7's `run_build` **tool**, so the tool consumes the backend through the
  seam and the Docker client lands later at P-168. No reordering is needed.
- P-156 can read `pass` and `flaky` to make the loop's iterate-or-stop decision
  without the loop ever spinning on a flaky suite.

---

## ADR-029: P-156 Distinguishes Timeout from Cancellation and Redacts Free-Form Answers

**Status:** Accepted
**Date:** 2026-09-25

**Context:** P-156 (`ask_user`) is the second `gated` tool and the only one that
*suspends* the loop rather than proposing a change. Four things had to be
resolved:

1. **No human channel existed.** P-160's HIL queue, P-198's Ink picker, and
   P-218's web gate are all unbuilt, and `ToolContext` had no place to put a
   responder. P-156 step 2 nonetheless requires the tool to "enqueue into the HIL
   queue and wait".
2. **`USER_TIMEOUT` did not exist as an error code.** The spec names it
   explicitly. The closest existing codes are `ABORTED` and `USER_CANCELLED` —
   and P-156's acceptance criteria say cancellation maps to `ABORTED`, so
   `USER_CANCELLED` is not a candidate.
3. **The handoff carries a security requirement:** "freeForm answers must never
   contain/leak keys." A free-form answer is untrusted human text, and the audit
   trail is a database, not a redacting log pipeline.
4. **The P-140 loop gates every `gated` tool identically**, via a single
   `approvalGate(tool.name)` check before execution.

**Decision:**
- Add `HumanResponder { present(question): Promise<HumanResponse> }` to
  `ToolContext` as `human?`, alongside `StagingFacade` and `SandboxRunner`.
  `HumanQuestion` is declared in the `ai` contract module (where the context
  surface lives) and the agent's `UserQuestion` satisfies it structurally, so
  there is one runtime shape and no import cycle.
- Add `USER_TIMEOUT { message; timeoutMs }` as a distinct code (45 total).
  **Timeout, active cancellation, and an answered question are three different
  events** and map to `USER_TIMEOUT`, `ABORTED`, and `UserAnswer` respectively.
  Collapsing "cancelled" into "timed out" would make the agent loop retry a
  question a human deliberately declined — the same class of mistake P-155
  avoided by keeping `SANDBOX_UNAVAILABLE` distinct from `SANDBOX_FAILED`.
- Free-form answers are redacted through P-145's `redactAuditText` **twice**:
  once before persisting to the audit column, and once before the value is
  returned as the tool result. The second pass matters because a tool result is
  model-visible, so an unredacted answer would reach the provider's context.
  The test asserts the credential shape is absent from *both*.
- Every terminal outcome is audited, not just successes. "The human declined"
  and "nobody answered" are exactly the provenance worth keeping, and the audit
  row follows P-146's `recordSwitch` precedent: zero tokens, zero cost, zero
  latency, queryable via `query({ task: 'ask-user' })`.
- The question's **own `id` is authoritative** over any generated id, because
  P-156 defines `UserAnswer.id` as the `UserQuestion.id` it answers. Generating
  a fresh id would break the exact binding the field exists to express — the
  suite caught this immediately.
- `question.id` wins over the caller's `opts.id` only in the sense that
  `opts.id` is an explicit override; the default is the question's own id.

**On the loop's blanket gating (item 4):** this is surfaced, not worked around.
Until P-157's `AutonomyPolicy` lands, the P-140 loop applies one
`approvalGate(name)` check to every `gated` tool, which would ask the human to
*approve the question* before `ask_user` could ask it. That is backwards, and
P-157 is explicitly the phase that "decides at runtime whether a tool execution
requires a human gate" — the place that can distinguish "needs approval before
acting" from "needs a human mid-action". P-156 therefore delivers the tool and
its contract; it does not pre-empt the policy engine that owns the distinction.

**Alternatives Considered:**
- **Reuse `USER_CANCELLED` for a timeout** — rejected: it is a distinct,
  pre-existing code with a `reason` field and a different meaning, and P-156
  explicitly specifies `USER_TIMEOUT`.
- **Return the timeout as `ABORTED`** — rejected: the loop cannot then tell
  "the human said no" from "the human was away", and would likely retry the
  former.
- **Store the raw answer and rely on log redaction** — rejected: pino's
  `redact` protects log output, not a SQLite column. P-145 established
  `redactAuditText` for exactly this gap in provider error text; the same
  reasoning applies to human text.
- **Let the tool call the CLI/web directly** — rejected: the agent layer must
  not reach into either, and an injected seam is what keeps this testable
  offline.
- **Add a `prompt` capability that blocks forever until answered** — rejected:
  P-156 step 4 mandates a bound (120s default). A loop that can hang is a loop
  that never terminates.

**Consequences:**
- All five terminal paths are covered deterministically by a controllable fake
  responder — no real waits, no timers left dangling (the timeout is cleared in
  a `finally` whether the responder resolves, rejects, or loses the race).
- A responder that *rejects* is contained: it is logged and degrades to
  `ABORTED` rather than propagating an exception out of the agent loop.
- An already-aborted signal short-circuits **before** the human is prompted, so
  a cancelled job never disturbs a user with a question it will not use.
- `ask_user` is now the second `gated` tool; the registry test pins the exact
  gated set to `['propose_component', 'ask_user']` so a future tool cannot
  silently opt into the wrong autonomy class.

---

## ADR-030: The Autonomy Policy Is Injected Into the Loop, Not Imported By It

**Status:** Accepted
**Date:** 2026-08-30

**Context:** P-157 is the enforcement point for the whole agent loop. Its spec
named four targets, and three of them did not match the codebase:

1. `packages/core/src/agent/policy.ts` — "(fill stub -- keep `AutonomyPolicy`/`evaluate`)".
   No such stub exists. A grep for `AutonomyPolicy`, `PolicyDecision`,
   `AutonomyOverride` and `defaultAutonomyPolicy` across `src/` returns zero
   matches, and `src/agent/` contains no `policy.ts`. The file is created new.
2. `packages/core/src/agent/loop.ts` — "invoke policy before tool execution".
   No such file exists. The P-140 tool loop is `packages/core/src/ai/loop.ts`.
   The spec's own step 4 also says "(P-140)", which is `ai/loop.ts`; the path in
   the Files list is the error.
3. `export type Autonomy = 'auto' | 'gated'` — P-009's `config/schema.ts` already
   exports a public `Autonomy`, and it is a different concept entirely: the
   `[agent]` config block, `{ auto: string[]; gated: string[] }` (a list of tool
   names), not a single tool's mode.

There is also a structural hazard the spec does not mention: `src/agent/*`
already imports `src/ai/*` (tools take `ToolContext`, the registry depends on
`ToolDefinition`). A direct `import { AutonomyPolicy } from '../agent/policy.js'`
inside `ai/loop.ts` closes the cycle `agent -> ai -> agent`, which is exactly the
class of defect P-022 spent a phase working around.

**Decision:** Keep the class in `agent/policy.ts` as specified, and inject it
across the module boundary instead of importing it.

- `ai/types.ts` declares the loop's own view structurally: `PolicyVerdict`
  (`{ action: 'allow' | 'ask' | 'deny'; reason: string }`) and
  `ToolPolicyEvaluator` (`evaluate(toolName, toolAutonomy)`).
- `LoopConfig.policy?: ToolPolicyEvaluator` is the seam.
- `agent/types.ts`'s `PolicyDecision` has exactly the `PolicyVerdict` shape, so
  `AutonomyPolicy` satisfies `ToolPolicyEvaluator` structurally. No import, no
  cycle, and no `as` cast.
- **No policy injected means P-140 behaviour, byte for byte**: `gated` asks,
  `auto` runs. Every pre-P-157 caller is unaffected, which is why the phase did
  not have to touch the existing loop tests.

**Resolution of the `Autonomy` name collision:** the spec-mandated
`Autonomy = 'auto' | 'gated'` is declared in `agent/types.ts` and re-exported
from `@repo-stitcher/core` as **`ToolAutonomy`**, because the P-009 config type
already owns the plain name in the same barrel. This is the same disambiguation
the barrel already applies to `LicensePolicy` / `LicenseCompliancePolicy`
(P-118), so it introduces no new convention.

**Deny is evaluated first and is absolute.** If overrides were consulted before
the deny list, an operator's override could re-enable a tool they had explicitly
blacklisted. Order is: deny list -> always-allowed -> override -> the tool's own
flag -> `defaultMode`. `run_build` is always allowed because P-155 made it
verify-only: it writes nothing to the host, so a gate in front of it is pure
friction and buys no safety.

**A denial is a tool result, not a loop abort.** The spec says "on `deny` return
`err('TOOL_DENIED')`". Implemented at tool scope: a `TOOL_DENIED` result is
pushed back to the model and the loop continues, matching the existing
gate-refusal path. Failing the whole `Result` for one refused call would let a
single denial end a stitch that can still make progress, and would make the
policy a denial-of-service vector against the agent's own work.

**Every decision is audited (spec step 5).** `AiAuditLog` gains
`recordPolicyDecision` and a `policy` column, following the two additive
columns already established by P-145 (`switch_reason`) and P-156 (`question`).
Like those, the reason is passed through `redactAuditText`, because it embeds a
tool name. No fabricated cost or latency: a policy check calls no model.

**Alternatives Considered:**
- **Import `AutonomyPolicy` into `ai/loop.ts`** — rejected: closes an
  `agent -> ai -> agent` cycle. `src/agent/tools/*` already depend on
  `ai/types.js`, so this is a real cycle, not a theoretical one.
- **Move the tool loop to `agent/loop.ts` as the spec's path suggests** —
  rejected: the loop is provider, cost-tracking, and failover logic owned by
  P-140/P-145/P-146. Moving it would invert the established ownership and touch
  phases already signed off.
- **Rename the P-009 config type instead** — rejected: it is already public,
  already consumed, and it is the more natural owner of the plain name (a config
  block is more prominent than one enum value).
- **Make `deny` fail the whole loop with `err`** — rejected: see above; one bad
  tool name should not end a job.
- **Apply overrides last-wins when a tool is in both config lists** — rejected:
  a silent resolution hides a configuration mistake. `policyFromAgentConfig`
  returns `CONFIG_ERROR` naming the conflicting tools.

**Consequences:**
- The hybrid autonomy model is now a config edit. `policyFromAgentConfig` maps
  the P-009 `[agent]` block onto overrides, so moving a tool from `gated` to
  `auto` requires no code change in nine tools — the phase's stated goal.
- The policy is immutable: `withOverride` / `withDeniedTool` return a new
  instance, and the config arrays are copied in the constructor, so a caller
  mutating an array it passed in cannot change a live policy's behaviour.
- `PolicyDecision` and `PolicyVerdict` are structurally identical but separately
  declared. That is deliberate: the agent layer owns the policy vocabulary, the
  loop owns only what it consumes, and the shared shape is the cycle-breaker.
- ADR-029's blanket-gating limitation is now *addressable* but not yet
  resolved. `ask_user` is still `gated`, so the loop still routes it through
  `approvalGate(name)` before its own `HumanResponder` round-trip. P-157 makes
  the distinction expressible (the policy can now say "allow" and let the tool
  handle the human interaction itself) but the shipped defaults do not use it.
  P-160 owns the consolidation.

---

## ADR-031: Tool Validation Runs on Raw Arguments, Before Zod

**Status:** Accepted
**Date:** 2026-08-30

**Context:** P-158 adds a validation layer over tool arguments and tool
results. Its spec text contained three problems, and the phase's own test suite
surfaced a fourth that the spec did not anticipate at all.

**Spec conflicts, all in `PHASES_DETAILED.md:7959-8007`:**

1. **The Files list names `packages/core/src/agent/loop.ts` (line 7968) for the
   wiring.** That file does not exist and never has. The P-140 tool loop is
   `packages/core/src/ai/loop.ts`. This is the *same* path error P-157 hit, which
   makes it a systematic mistake in the Epic 7 phase templates rather than a
   one-off — worth recording so P-159 and P-160 do not each rediscover it.
2. **The spec's own sketch uses `(val as any).__proto__` / `(val as any).constructor`
   (line 7976).** That violates the standing no-`any` rule, and the sketch's
   block is a no-op anyway — an empty `if` body. P-152 had already solved this
   exact problem with `Object.getPrototypeOf` and null-prototype objects.
3. **The spec's denylist is `__proto__` / `prototype` (line 7984), omitting
   `constructor`.** Assigning `constructor` is the same class of attack.

**The problem the spec did not anticipate — and the most important decision
here.** The spec's step 4 wires validation "after `policy.evaluate` and before
`execute`", and the loop already called P-139's `parseToolArgs` *before* the
policy check. The natural reading is therefore "validate the parsed args". That
is wrong, and the test proved it: **Zod builds a fresh object for a record and
therefore strips a `__proto__` key.** A `{"__proto__": {...}}` payload handed to
`z.record(...)` comes out of `parseToolArgs` clean. Scanning post-Zod finds
nothing to reject, and the tool executes with the hostile arguments.

**Decision:**

- **The scan runs on the raw `tc.arguments`, before any parsing.** When a
  validator is injected, `sanitizeToolArgs` does both jobs in the correct order —
  hostile scan, then `parseToolArgs`. When no validator is injected the loop
  keeps its P-140/P-139 order exactly, so no pre-P-158 caller changed.
- **The denylist is P-152's** — `__proto__`, `prototype`, `constructor` — and is
  exported as `FORBIDDEN_ARG_KEYS` so the codebase has one list rather than three
  that drift.
- **The walk is iterative with a visit set, not recursive.** Unbounded recursion
  over model-controlled data is a stack-overflow crash, and a cyclic argument
  tree would hang a recursive walker forever. `MAX_TOOL_ARGS_DEPTH` is carried
  per frame and checked on the way *down*, so a value nested past the limit is
  rejected without ever being descended into.
- **A traversal is resolved, not grepped.** `a/../b` cancels a segment and stays
  inside the repo, so it is accepted; `../b` escapes and is refused. Backslashes
  are normalized first, or a Windows-authored `..\..\` would slip past a
  forward-slash-only check. Absolute (`/etc/passwd`) and drive-qualified
  (`C:\Windows`) paths are refused too, since a repo-relative field has no
  legitimate absolute value.
- **Path fields are checked in both shapes.** `path` is one path and `paths` /
  `files` are lists; checking only the string case would let a traversal through
  the moment a tool grew an array argument. This was a real bug the suite
  caught, not a hypothetical.
- **Rejection, not sanitization.** A hostile input is refused rather than
  stripped, because silently dropping a key changes what the tool was asked to
  do and turns a clear security rejection into a baffling tool error.

**A deliberate deviation: argument validation runs BEFORE the policy check, not
after.** The spec's step 4 says "after `policy.evaluate` (P-157) and before
`execute`, validate `args`", which places validation between the policy verdict
and the tool call. The implementation validates first:

- The spec's order would put the `approvalGate` prompt *before* the arguments
  are known to be well-formed — a human would be asked to approve a call that is
  about to be rejected as malformed. Asking someone to authorise garbage is
  worse than refusing it silently.
- A hostile key should be rejected before anything else in the call path looks
  at it, including the policy.
- `policy.evaluate` is a pure function with no side effects, so evaluating it
  second cannot change any verdict — only which rejection the model sees when a
  call is *both* denied *and* malformed.

Recorded here because it contradicts a literal instruction in the phase file,
and the alternative to recording it is a silent deviation.

**Error codes — one new, three reused.** `TOOL_RESULT_TOO_LARGE { size, max }` is
genuinely new: the tool reported success and no existing code means "the output
was unusable", and a caller cannot fix it by changing the arguments, only by
raising the bound. The three argument-side failures (proto pollution, traversal,
depth) all map to the existing `TOOL_ARGS_VALIDATION`, which is precisely what
that code already means, with the specific cause carried in the message and
recovered into a filterable `kind` on the audit row. Inventing three
near-identical codes would have violated the no-duplicate-codes rule, not
satisfied it.

**Config.** The handoff note ("keep `MAX_TOOL_RESULT_BYTES` in config (P-009) so
large-repo tools can raise it") is honoured with a new `[agent]` block holding
`maxToolResultBytes` and `maxToolArgsDepth`. Both fields default, so a config
written before P-158 still validates — asserted in `zod.smoke.test.ts`. The
block is *optional* in input and present in output.

**Alternatives Considered:**
- **Follow the spec's `(val as any).__proto__` sketch** — rejected: `any`
  violates the type baseline, and the sketch's `if` block is empty, so it
  performs no check at all.
- **Scan the parsed args (the literal reading of step 4)** — rejected: proven
  ineffective by test. Zod strips the key before the scan runs.
- **Run the scan after `parseToolArgs` but on the raw value too** — rejected:
  scanning both is redundant work, and scanning only the raw value is the one
  that can actually see a hostile key.
- **Three separate codes for the three arg-side failures** — rejected: duplicate
  semantics. The distinguishing information belongs in the message and the
  audit `kind`, which is queryable.
- **Truncate an oversized result instead of rejecting it** — rejected: a
  silently truncated diff is worse than an error, because the model cannot tell
  the difference between "that is the whole file" and "that is the first
  megabyte".
- **Make the loop import `agent/validation.ts` directly** — rejected: closes
  `agent -> ai -> agent`. The `ToolValidator` seam in `ai/types.ts` plus
  `createToolValidator` in the agent module is the same cycle-breaker P-157 used
  for `ToolPolicyEvaluator`.

**Consequences:**
- The loop is safe by construction: with a validator injected, a hostile key,
  a traversal, or an oversized result cannot reach a tool or the model's
  context. With none injected, the loop is byte-identical to P-157.
- Validation failures are audited under `tool-validation`, with `stage`,
  `kind`, tool name, and the reason redacted through `redactAuditText` — the
  fourth such additive column, following `switch_reason` / `question` /
  `policy`. Answering "is the model emitting traversal?" is now a `query({ task,
  kind })` away rather than a grep over prose.
- The four arg-side checks are *one* code, so any security monitoring keyed on
  error codes will not distinguish them; the audit `kind` is the discriminator.
  Recorded as a deliberate tradeoff, with Epic 13's security audit (P-265) as
  the place to revisit.
- One pre-existing cast remains in the loop: the empty `ToolContext` fallback.
  It predates P-148 and is now centralised into a single documented
  `emptyCtx` constant rather than a fresh cast literal per tool call.

---

## ADR-032: The Agent Lifecycle Is a Port, Not a `state` Column

**Status:** Accepted
**Date:** 2026-08-30

**Context:** P-159 makes the agent lifecycle explicit so it is observable,
resumable, and testable. Its spec text contained five problems, three of them
about files and APIs that do not exist.

**Spec conflicts, all in `PHASES_DETAILED.md:8014-8059`:**

1. **The Files list names `packages/core/src/agent/loop.ts` (line 8023).** That
   file does not exist and never has. This is the *third* consecutive phase in
   Epic 7 to name it (P-157 line 7911, P-158 line 7968, P-159 line 8023), so it
   is a systematic error in the phase templates rather than three coincidences.
   The P-140 loop is `ai/loop.ts`.
2. **`transition(to)` "throws `err('ILLEGAL_TRANSITION', {from,to})`" (line
   8031).** `err` is a value; it is not something to throw. The no-throw rule
   decides it: `transition` returns `Result<void, StitchError>`. Step 2's
   `transition(to): void` contradicts step 1 anyway, and step 2's own
   `canTransition(to): boolean` is the pre-check that makes the `Result`
   ergonomic.
3. **Step 4: "store in the P-239 job record via a `state` column" (line 8039).**
   P-159 comes before P-239. The `jobs` table *does* exist
   (`store/schema.ts:69`, from the P-030 store foundation), but that file's own
   header reserves the extension: *"Tables (initial migration v1 — extended by
   P-181/187/**230/239**/241/303/309)"* (`store/schema.ts:10`). Adding a `state`
   column here would take a migration slot that P-239 is designated to own, and
   `src/orchestration/` does not exist at all.
4. **Step 3: `idle → "starting"` at loop entry (line 8034).** `"starting"` is
   not one of the ten states step 1 defines. The nearest real state is
   `loading`.
5. **Step 2 freezes the state names for web P-216 (line 8059),** which makes
   them a public contract — so the `AgentState` union had to be declared in a way
   that `ai/` can also name, without the two modules importing each other.

**Decisions:**

- **P-159 owns an `AgentStateStore` port, not a table.** `load(jobId)` /
  `save(jobId, state)`, plus `memoryStateStore()` for callers without a
  database. The orchestrator wires the real store when P-239 lands. This is the
  same "own the contract, let the phase that owns the storage supply the
  implementation" rule the facade seams already follow (ADR-021/023/028). The
  test proves the port against **real SQLite storage** rather than claiming a
  table this phase does not own.
- **`AgentState` and `AgentStateName` are the same type, declared twice.** Two
  unions of identical string literals are identical to TypeScript, so
  `ai/loop.ts` can drive the lifecycle without importing `agent/state.ts` — the
  ADR-030 cycle-breaker, third use. `state.test.ts` asserts the two are
  assignment-compatible, so drift is a test failure rather than a silent type
  mismatch.
- **The HIL guard needs two mechanisms, not one.** The acceptance criterion is
  "cannot execute a tool while in `waiting_*`". The naive reading — forbid
  `waiting_* → tool_executing` — makes `ask_user` unrepresentable, because the
  tool that asked the question is still mid-execution when the answer arrives
  and must resume. So:
  - `canTransition` answers "is this move in the map", and
    `waiting_user → tool_executing` is legal (the *return*);
  - `canStartTool()` answers "may a tool execution **begin** now", and is false
    in both `waiting_*` states.
  The loop checks the second immediately before `execute`, and the *transition
  itself* is the guard: `move('tool_executing')` returns `ILLEGAL_TRANSITION` if
  a decision is outstanding, the tool never runs, and the refusal becomes the
  tool's result. One mechanism, no separate bookkeeping.
- **`waiting_approval` has no direct edge to `tool_executing`.** The gate must
  resolve and hand control back to the loop (`waiting_approval → iterating`)
  before anything may execute. This is the adjacency map doing the HIL-pause
  work.
- **`waiting_user` is driven by wrapping the responder, not by the tool.** The
  tool layer must not know a state machine exists, so the loop decorates whatever
  `HumanResponder` it was given: `present()` moves to `waiting_user`, and the
  `finally` moves back to `tool_executing`. Accurate, and it needs no cooperation
  from any tool.
- **Terminal state is a function of the loop's outcome.** Every `ok` return ends
  in `done` (including a truncated `length`/`content_filter` finish — the
  finishReason is carried in the result, and conflating "stopped early" with
  "failed" would hide a real signal); every `err` return ends in `error`,
  including abort and loop-limit. This is what makes "fatal error → `error`, not
  stuck `iterating`" structural: there is no exit path that leaves a job parked
  in a non-terminal state, indistinguishable from a running one.
- **A refused move is inert.** It changes neither the state nor the history and
  does **not** fire `onChange` — subscribers are told what happened, not what was
  attempted.
- **A failing store does not undo a transition.** The agent genuinely is in that
  state; pretending otherwise would desynchronise the machine from the loop that
  drove it. The store error is returned to the caller and the state stands. A
  failing *load* is non-fatal, so a job that cannot read its own history still
  runs.

**Alternatives Considered:**
- **Add a `state` column to `jobs` now** — rejected: `store/schema.ts:10`
  reserves that extension for P-239/P-241/P-303/P-309, and a migration taken
  early is a migration P-239 has to work around rather than build on.
- **Forbid `waiting_user → tool_executing`** — rejected: it makes `ask_user`'s
  answer unreturnable, so the phase would ship a lifecycle that cannot represent
  its own headline feature.
- **Have the tool report that it is waiting** — rejected: that pushes
  state-machine knowledge into nine tool implementations and re-opens the ADR-029
  pattern of every tool re-deciding orchestration policy for itself.
- **Throw on an illegal transition** — rejected by the no-throw rule, and the
  spec's own `err(...)` is a value.
- **Reset to `idle` between loop runs** — not applicable, and the tests found
  out: a terminal machine cannot be reset, because `idle` is not a legal target
  from `done`. That is the adjacency map working correctly, and it is why each
  loop scenario in the test uses a fresh machine.

**Consequences:**
- The nine state names are a frozen public contract for P-216; adding one is an
  ADR.
- With a machine injected the loop is fully observable; with none injected it is
  byte-identical to P-158, so the lifecycle is opt-in and never a precondition
  for the agent running.
- `ILLEGAL_TRANSITION` is a new code (47 total), carrying `from`/`to` as plain
  strings so the contract module never imports from the agent module.
- The HIL-pause integrity ADR-029 flagged is now enforced by the type system and
  the adjacency map rather than by convention. P-160's queue is what *resolves*
  `waiting_approval`; the machine already guarantees nothing executes before it
  does.

---

## ADR-033: The HIL Queue Owns Its Own Tables, and a Question's Answer Is Its Note

**Status:** Accepted
**Date:** 2026-08-30

**Context:** P-160 is the phase that actually asks a human. P-157 made the
policy decide one is needed, P-159 made the lifecycle enforce that nothing
executes until they answer, and neither one *asks*. Four spec problems, three of
them about things that do not exist.

**Spec conflicts, all in `PHASES_DETAILED.md:8066-8109`:**

1. **The Files list names `packages/core/src/agent/loop.ts` (line 8075).** The
   *fourth* consecutive Epic 7 phase to do so (P-157:7911, P-158:7968,
   P-159:8023, P-160:8075). At four occurrences this is a defect in the phase
   templates, not four coincidences, and every one of these phases wired into
   `ai/loop.ts` instead.
2. **"backed by `bun:sqlite` P-230 helper" (line 8070).** That helper does not
   exist. This repo's own `PROGRESS.md` describes `db/sqlite.ts` as a
   *"minimal local engine helper — P-230 pending"*, and P-230 is Wave 2, well
   after P-160. Second forward-reference in two phases, after P-159's P-239.
3. **`enqueue(req): string` and `resolve(id, res): void`** have no error channel
   at all, so neither can honour the no-throw rule. Both return `Result`.
4. **`waitForResolution` "resolves when `resolve` called (event emitter /
   polling with interval)"** offers a choice without making it.

**Decisions:**

- **`HilQueue` owns `hil_requests` / `hil_resolutions` and creates them on
  construction.** Not a `store/schema.ts` migration, because that file's header
  reserves the store extension for P-181/187/**230**/239/241/303/309 and taking
  a slot another phase owns leaves it with a migration to work around. Same
  arrangement `ai/audit.ts` has used for `ai_calls` since P-145. No `bun:sqlite`
  import either: it is unavailable in vitest's Node workers, and the repo's
  `DbLike` + `node:sqlite` test adapter is the established answer.
- **The duplicate rule is enforced by the DATABASE.** "Overwrite a duplicate
  pending by toolName" is a partial unique index —
  `CREATE UNIQUE INDEX ... ON hil_requests (tool_name) WHERE status='pending'` —
  not a select-then-delete in application code. Two loops racing to gate the
  same tool would both pass an application-level check and leave two pending
  rows for one human, and the second approval would then apply twice.
- **The superseded request is marked `cancelled`, not deleted, and its waiter is
  woken with `ABORTED`.** It must not silently vanish from the audit trail, and a
  loop blocked on it must learn it is no longer live rather than wait out a
  timeout.
- **A deferred map, not polling.** `Map<id, Deferred>` has no timer to leak;
  polling has a timer to clear on every exit path, and P-156 already showed how
  that goes wrong when one path is missed. The only timer is the timeout guard,
  cleared in a `finally` on every path. `Ok` and `Err` are both array-like in
  neverthrow, so the waiter result is destructured rather than iterated.
- **`waitForResolution` consults storage BEFORE it waits.** An approval the CLI
  recorded while the loop was between states — or before a restart — returns
  immediately instead of hanging until the timeout. This is what makes the
  spec's step 5 "idempotent via `id`" load-bearing rather than aspirational, and
  it is verified by a test that parks a request, closes the database, reopens it
  in a "new process", answers, closes again, and then reopens a third time to
  show the original wait returns promptly.
- **`resolve` is idempotent, and the first decision stands.** A retried or
  double-clicked approve returns the stored resolution rather than re-applying.
  A human who approved and then accidentally rejected the same card did not
  change their mind.
- **A question's answer is the resolution's `note`.** The spec's `HilResolution`
  is `{ id, resolution, by, ts, note? }` and has no answer field. Rather than
  widen a shape P-198 and P-218 post against, `by` is who answered and `note` is
  what they said — a question approved with no note yields an **empty answer,
  not a fabricated one**. Recorded here because the alternative (adding
  `answer?: string`) is a real design and this was a judgement call.
- **`cancel` is a third outcome, not a rejection.** It returns
  `Result<void, StitchError>`, records *no* resolution (so `resolutionFor` stays
  `null` and nobody can later mistake a cancel for a human saying no), and wakes
  the waiter with `ABORTED`.
- **`waiting_approval` is entered BEFORE the request is parked, and for BOTH the
  queue and the inline `approvalGate` path.** P-159's contract is that a gated
  tool parks in `waiting_approval`; that is a property of the tool being gated,
  not of how the human is reached. Parking first would stamp the previous state
  (`streaming`) onto a request whose entire purpose is to explain why the job
  went quiet. A regression here was caught by P-159's own test.
- **`ask_user` reuses the queue with `kind:'question'` — this closes ADR-029.**
  Previously the loop asked the human to *approve* the question, and only then
  did the tool ask it: two prompts for one answer. Now there is one channel. The
  tool layer still knows nothing about the queue, because the loop decorates
  whatever `HumanResponder` it was handed.
- **No new `StitchError` code.** `USER_TIMEOUT` (nobody answered) and `ABORTED`
  (someone stopped the wait) already exist and mean exactly this, kept distinct
  for the same reason P-156 separated them. A stale id from a reconnected web
  client is `CONFIG_ERROR { field: 'id' }` — bad input, not a runtime fault.
  Count stays 47.

**Alternatives Considered:**
- **Wait on the store's `jobs` table (P-230/P-239)** — rejected: the extension is
  reserved in that file's own header, and those phases have not run.
- **Enforce the duplicate rule in application code** — rejected: racy, and the
  failure mode is a double-applied approval.
- **Poll for the resolution on an interval** — rejected: a timer on every exit
  path, for a wake-up that can be a direct call.
- **Delete the superseded request** — rejected: it erases the fact that a human
  was asked, which is exactly the provenance worth keeping.
- **Add `answer?: string` to `HilResolution`** — viable, rejected only to keep
  the frozen spec shape; noted above as a judgement call, not a strong claim.
- **Let the tool layer call the queue** — rejected: re-opens the ADR-029 pattern
  of every tool re-deciding orchestration for itself.

**Consequences:**
- Approval is genuinely cross-process and crash-safe, and answerable from the
  CLI (P-198) or web (P-218) using only the request id.
- A stale or double-submitted approval cannot apply an action twice.
- `ask_user` prompts once instead of twice — ADR-029's known limitation is now
  **closed** rather than merely addressed.
- P-160 owns resolution *persistence and idempotent re-read*. Re-**executing** an
  approved action is P-161's territory and was deliberately not pulled forward.

---

## ADR-034: The Undo Stack Only Records What Can Actually Be Reversed

**Status:** Accepted
**Date:** 2026-08-30

**Context:** P-161 makes the `auto` autonomy class safe by making mistakes
reversible. Five spec problems, four of them substantive.

**Spec conflicts, all in `PHASES_DETAILED.md:8118-8164`:**

1. **The Files list omits `agent/loop.ts`** while step 3 says "Wire into the
   loop". Unlike P-157–P-160 this is an *omission* rather than a wrong path, and
   the loop is still `ai/loop.ts`.
2. **Step 2 specifies `undo(): Result<UndoRecord, StitchError>` but also says
   undo "invoke[s] the matching reverter"** — and a reverter doing real git work
   can fail. Returning only the popped record would report success for a failed
   revert. `undo()` returns the *reverter's* error, and the record stays on the
   stack.
3. **Step 4 says "Persist the stack in the job store (P-239)"** — the third
   forward-reference in three consecutive phases, still unimplemented.
4. **Step 2 says each revert uses `ctx.git.writeFile`/`move` as though they were
   guaranteed.** They are **optional** members of `GitFacade` (ADR-021), and
   P-154's own `applyProposal` guards `writeFile === undefined` with a typed
   `CONFIG_ERROR`. P-161 follows that precedent.
5. **`UndoRecord.{before, after}` are `unknown` and cannot express a
   `file_move`'s import rewrites** (P-153), which are half the work of undoing a
   move.

**The capability gap the spec did not anticipate:** reverting a `proposal_apply`
means **deleting** the files it created (acceptance criterion 3), and there was
**no delete capability anywhere on `ToolContext`**. Verified by grepping
`ai/types.ts` for delete/remove/unlink — zero hits. Added `deleteFile?` as an
*optional* `GitFacade` member, exactly the pattern ADR-021 established: injected,
never constructed, and its absence a typed error rather than a silent no-op.

**Decisions:**

- **`before` is `FileSnapshot[]`, not a string.** `content: null` means *the file
  did not exist*, which is the case that makes reverting a created file a
  deletion. A plain before-string cannot express "there was nothing there", and
  `proposal_apply` is entirely about files that were not there.
- **`UndoRecord` gains `importRewrites?: ImportRewrite[]`** beyond the spec's
  shape. `ImportRewrite` is `{ file, oldRef, newRef }`, so the inverse is
  mechanical, but it is not expressible in `{before, after}`.
- **A `file_move` revert inverts the rewrites with `rewriteImportRefs` rather than
  restoring whole files.** This is the single most important decision in the
  phase: a move rewrites third-party files, and restoring their entire prior
  content would destroy any *unrelated* edit made to them after the move. A
  revert that silently destroys work is worse than no revert. Verified by a test
  that edits an importer after the move and asserts that edit survives.
- **A failed revert KEEPS its record.** The tree was not restored, so the history
  must not claim otherwise; a record lost to a transient git error is
  unrecoverable.
- **The cap drops the OLDEST, not the newest**, and reports what it dropped. The
  newest is what a human most likely wants to undo, and a silently truncated undo
  history is indistinguishable from "there is nothing to undo".
- **`revert_last` is `gated`.** A revert is itself a mutation, so the risk is
  symmetric and it needs the same human approval as the change it undoes.
  P-160's queue parks it like any other gate.
- **Every required capability is checked before the first write**, so a revert
  either restores the whole set or refuses — never half-applies, which with the
  record already popped would leave the tree inconsistent with the history.
- **`NOTHING_TO_UNDO` is a new code (48).** The spec names no code for an empty
  stack, and nothing existing means it: the caller asked for a no-op that cannot
  be performed, which the loop must be able to distinguish from a revert that
  was attempted and failed.
- **The loop records via an injected `UndoRecorder`,** only on success and only
  after P-158's result validation passed, so the stack never holds an entry for
  work that did not happen.

**The decision this phase is actually about: what the stack does NOT record.**
`UNDO_DERIVERS` covers `edit_config` and `move_file` only. `fix_dependency`
returns `{ action, package, version, section }` and `applyProposal` returns
`{ written: string[] }` — **neither carries the prior content of the file it
wrote.** Both reverter *kinds* are fully implemented and tested (by pushing
records directly), but the two tools do not yet emit records, and they are
deliberately absent from the registry. Recording them would put an entry in a
stack that advertises reversibility it does not have, which is worse than no
entry: a human who is told an action is revertable will trust it.

Making those two tools emit records means adding a read-before-write to each,
which changes their contracts and their own tests. That is a follow-up, named
here rather than silently absorbed. P-154 already anticipated the split — its
`applyProposal` carries the comment *"P-161 owns cross-tool reversion; this
applies forward only"*.

**Alternatives Considered:**
- **Record every mutating tool regardless of before-state** — rejected: an
  unrevertable entry in an undo stack is a lie the human pays for.
- **Restore whole files for a `file_move` revert** — rejected: destroys unrelated
  post-move edits. Directly counter-tested.
- **Pop the record before reverting** — rejected: a failed revert then loses the
  only record of what went wrong.
- **Drop the newest past the cap** — rejected: wrong end of the stack.
- **Add `deleteFile` as required** — rejected: ADR-021 made every write
  capability optional precisely so the agent layer cannot assume it; a required
  delete would break every existing context.
- **Take a store-schema migration for the stack (P-239)** — rejected:
  `store/schema.ts:10` reserves that extension, and the stack is in-process for
  now. The `UndoStack` is injectable, so a store-backed one drops in when P-239
  lands.

**Consequences:**
- `edit_config` and `move_file` mistakes are recoverable today through a gated
  `revert_last`; `fix_dependency` and `applyProposal` are not yet, and the code
  says so rather than pretending.
- Reverting a proposal now exercises a capability (`deleteFile?`) that did not
  exist before this phase, guarded the same way `writeFile?` already was.
- The undo history is honest: every entry in it can actually be undone.

---

## ADR-035: The Reasoning Stream Is Strictly Less Load-Bearing Than What It Observes

**Status:** Accepted
**Date:** 2026-08-30

**Context:** P-162 makes the agent legible: every policy verdict, tool call, tool result, state transition, failover, and cost tick published live to the CLI (P-199) and web (P-216) over WS (P-193/P-241). Four spec problems, plus one requirement the spec omits that matters more than any of them.

**Spec conflicts, all in `PHASES_DETAILED.md:8171-8219`:**

1. **The Files list names `agent/loop.ts` (line 8180)** — the *fifth* consecutive Epic 7 phase to do so (P-157:7911, P-158:7968, P-159:8023, P-160:8075, P-162:8180). The template defect is now unambiguous rather than merely suspected.
2. **The `policy` variant is typed with P-157's `PolicyDecision`.** Same module (`agent/`), so there is no cycle and none of the structural duplication that P-159's `AgentState`/`AgentStateName` pair required across a module boundary. `reasoning.ts` **imports** the real type rather than restating it.
3. **Step 3 says "`plan` when building a prompt (P-141)", but P-141's `buildPrompt` does not exist.** Verified: `ai/prompts.ts` exports `render`, `systemPrompt`, `resolveDepsPrompt`, `generateComponentPrompt`, `detectGapsPrompt` and `promptVersion` — none of which carries agent intent, and no function by that name anywhere in the repo.
4. **The handoff note's "dedupe `state`/`policy` bursts so the UI isn't spammed" directly contradicts the acceptance criterion "No events lost (all emitted before completion)".** Those cannot both hold at the `emit` boundary.

**Decisions:**

- **A THROWING SUBSCRIBER MUST NOT BREAK THE AGENT.** This is the requirement the spec omits and the one that matters most: a WS bridge with a closed socket, or a serialisation bug in a forwarder, must not fail the stitch it is only observing. Every listener call is isolated, the failure is logged and counted in `subscriberFailures`, and the remaining listeners still receive the event. Tested directly: a throwing subscriber alongside a healthy one, on the same emit.
- **`ReasoningEvent` is NOT `ReasoningChunk`.** The spec's context blurs them ("via the P-136 `ReasoningChunk`"), so it is worth being precise. Verified: `ReasoningChunk` is the *provider's* raw stream — `{type:'text'|'tool_call'|'done'|'error'}` — and `ReasoningEvent` is the *agent's* account of itself. A provider text chunk is where a `plan` event comes from; nothing else overlaps. Declaring a second copy of `ReasoningChunk` here would have been the mistake.
- **The `plan` event is emitted once per turn, from the text the model actually streamed back.** Since P-141's `buildPrompt` does not exist, inventing a plan source would have meant emitting an empty or fabricated event. Per-turn rather than per-chunk keeps the feed readable, and an empty turn emits nothing.
- **Live delivery is complete; the post-hoc buffer is bounded.** The two acceptance criteria are reconciled rather than traded. A subscriber attached at emit time receives every event without exception, satisfying "no events lost", while `dump()` is capped at 1000 so a long job cannot grow without limit. The discards are counted and exposed, because a silently truncated audit trail is indistinguishable from one that never happened. The cap drops the OLDEST, so a review shows the end of the run — which is where a problem is. Same rule as `UndoStack` (ADR-034).
- **Dedupe belongs at the render layer, not at `emit`.** This resolves conflict 4: collapsing `state`/`policy` bursts inside the stream would destroy the ordering a consumer needs and violate "no events lost". `ReasoningStream` publishes everything and says nothing about presentation; P-216 and P-199 own their own dedupe.
- **Every exit path publishes a `tool_result`.** Unknown tool, arg-rejected (P-158), denied by policy, rejected by a human, blocked by the lifecycle guard (P-159), rejected by validation, and the ordinary success/failure of the tool itself. A call that vanished from the feed and a call that failed are very different things to a user, and only the second is honest.
- **Rendered text is redacted.** `reasoningText` passes every model- or human-authored field through P-145's `redactAuditText`, because a tool result or an error message is arbitrary text that can carry a credential shape, and this is a user-facing surface rather than a redacting log pipeline.
- **Cost precision scales with magnitude.** `CostTracker` reports dollars and `estimateCost` divides per-million-token prices by 1e6, so a short run legitimately costs a fraction of a cent. Fixed 4dp would render that as `$0.0000`, which reads as "free".
- **`ReasoningSink` is the sixth structural seam** (ADR-030's pattern), with an ai-side `ReasoningEventLike` union built from `PolicyVerdict` and `AgentStateName` so the loop can construct events without reaching into the agent module.

**Alternatives Considered:**
- **Let a throwing subscriber propagate** — rejected: it would let a failed websocket fail a stitch. That is the whole design constraint.
- **Emit `plan` from a synthesized prompt** — rejected: `buildPrompt` does not exist, and a fabricated plan is worse than none.
- **Dedupe `state`/`policy` at `emit`** — rejected: contradicts "no events lost" and destroys the ordering a consumer renders from.
- **Unbounded `dump()`** — rejected: a long job would grow the buffer without limit, which is the leak `MAX_PENDING` already guards against in the audit log.
- **Have the tool layer publish its own events** — rejected: re-opens the ADR-029 pattern of every tool re-deciding orchestration for itself.

**Consequences:**
- The agent is observable end to end, and P-162 adds **no new error code** — an observability layer that can fail is not something this phase should introduce.
- A broken WS bridge is visible (`subscriberFailures`) and harmless.
- `dump()` is a post-hoc review artefact, bounded and self-reporting.
- `state` events are published from the single `move()` funnel, so every transition appears exactly once and in order, and a refused transition publishes nothing — the agent did not go anywhere.

---

## ADR-036: Error Classification Is an Explicit Table, Not Prefix Rules

**Status:** Accepted
**Date:** 2026-08-30

**Context:** P-163 classifies every error the agent can see so the loop can decide retry / failover / ask / continue / abort. The spec describes six prefix rules and one catch-all. Measured against the codebase, that shape does not work.

**Spec conflicts, all in `PHASES_DETAILED.md:8226-8278`:**

1. **The Files list names `agent/loop.ts` (line 8235)** — the *sixth* consecutive Epic 7 phase to do so (P-157, P-158, P-159, P-160, P-162, P-163).
2. **Step 2's six rules cover 11 of the 48 codes that exist.** Verified by extracting every `code: '...'` from `result/index.ts`. The other **37 would all fall through to `fatal`**, and several demonstrably should not:
   - `RATE_LIMIT` is retryable by definition;
   - `SCANCODE_MISSING` is this repo's own opt-in-not-installed state (P-130) — a configuration with a known remedy, not a crash;
   - `LOOP_LIMIT`, `NO_FAILOVER` and `USER_CANCELLED` are terminal *outcomes*, not bugs;
   - `DOCKER_ERROR` is sandbox work that `SANDBOX_*` never matches.
   "Fatal" means a human must change something, and a rate limit does not qualify.
3. **A prefix is not a category.** `'GIT_ERROR'.startsWith('GIT')` is true — and so is `'GITHUB_API_ERROR'`. A remote API failure and a local repository failure need different recoveries, and no prefix check can tell them apart. Both are asserted directly in the tests.
4. **Step 2's "`AUTH_*`/401" conflates two different things.** There are `StitchError` codes `AUTH_ERROR`/`AUTH_FAILED`, *and* `ProviderError.kind === 'auth'`, which is a different type with a different remedy path. Both are classified, separately.
5. **Step 3 never maps two of the eight classes.** It covers `retryable`, `auth`, `tool`, `sandbox`, `fatal`/`config` — and says nothing about `provider` or `git`. Both are resolved here: `provider` skips straight to failover (the provider already refused once, so retrying the same request is pointless) and then aborts; `git` continues, because the spec calls it "recoverable with guidance" and the model is told what git said and can adapt.
6. **Step 3's signature is `handleError(e, ctx, loop)`.** The `loop` parameter is dropped: nothing in the decision needs to call back into the loop, and taking a whole loop as an argument would make the function untestable in isolation. The recovery decision is a *value* the loop acts on, not a call the loop makes.

**Decision: an explicit `Record<StitchErrorCode, ErrorRule>` covering all 48 codes.**

- The key type is `StitchErrorCode`, so **adding a code to the union without classifying it is a compile error** — not a review comment. Drift is impossible rather than merely unlikely. A runtime test asserts coverage on top of that, and another asserts the whole non-recoverable set by name.
- Each rule carries its `class`, its `action`, and the user-facing sentence, so a code cannot have a classification but no message — which matters because CLI P-201 and web P-228 render from `friendlyError`.
- `recoverable = cls !== 'fatal' && cls !== 'config'` is spec-verbatim, stated once in `isRecoverable()` so both classification paths apply one rule. TypeScript proved this worth extracting: the provider branch's class set excludes `'fatal'` entirely, so writing the comparison inline was a provably-dead comparison the compiler rejected.
- `ProviderError` is classified from its own `kind` **and** its own `retryable` flag. Both are honoured: a rate limit the provider says is not retryable must not be retried, whatever the kind implies.
- **The retry → failover → abort chain terminates by construction.** Budget is an explicit `ErrorBudget` *input*, not a counter buried in the loop, so `handleError` is a pure function of `(error, budget)` and the test drives it to termination without a timer.
- **`ABORTED`, `USER_CANCELLED`, `USER_TIMEOUT` and `LOOP_LIMIT` are `fatal` but their messages never say "bug"**, because they are outcomes a person chose or a budget reached. A test enforces that.
- **The loop's catch-all is the acceptance criterion.** A tool is typed to return a `Result`, but one that throws — a bug, or a facade that throws before its own guard — would escape `runToolLoop` and take the stitch with it. The catch wraps the single `tool.execute()` call: the throw becomes an `INTERNAL` tool result, a `tool_result` reasoning event, and the loop continues. It is there rather than around the whole loop because everything outside that one call already returns a `Result` and cannot throw.
- **No new `StitchError` code.** Classification adds no failure mode.

**Alternatives Considered:**
- **Prefix rules with a `startsWith` fallback** — rejected: covers 11 of 48, misfiles `GITHUB_API_ERROR` as `git`, and cannot be exhaustive.
- **Extend the prefix set until it covers everything** — rejected: that is the explicit table with worse ergonomics and a compile-time guarantee thrown away.
- **A `Record<string, ...>` keyed loosely** — rejected: loses the compile-time exhaustiveness, which is the whole benefit.
- **Retry git errors** — rejected: the model supplied the bad input, so a retry sends the same input again. Continue, and let the model adapt.
- **Keep the spec's `loop` parameter** — rejected: it makes the decision untestable without standing up a loop, for no behavioural gain.
- **Put the `switch` in the loop** — rejected: the classification is a product surface (P-201, P-228 both render it), so it belongs in the agent module where those types live.

**Consequences:**
- Every one of the 48 codes has a deliberate class, a deliberate action, and a readable message, and adding code 49 will not compile until it is classified.
- The two errors the prefix rules would have gotten most wrong — `GITHUB_API_ERROR` and `RATE_LIMIT` — are both covered by name in the tests.
- `ErrorClass` is frozen as the handoff requires: web P-228's error boundary and CLI P-201 render from `friendlyError`, and the union is the contract they share.
- The loop provably cannot be taken down by a tool that throws, with or without the router wired.

---

## ADR-037: The Loop Cap Is the Admission Gate, Tokens and Dollars Are Separate Budgets, and Raises Are Bounded

**Status:** Accepted
**Date:** 2026-09-26

**Context:** P-164 bounds every agent run with an iteration cap, a token budget, and a dollar budget. The spec's shape does not survive contact with the codebase, and two of its statements are actively unsafe.

**Spec conflicts, all in `PHASES_DETAILED.md:8285-8327`:**

1. **The Files list names `agent/loop.ts` (line 8294)** — the *seventh* consecutive Epic 7 phase with the same wrong path (P-157:7911, P-158:7968, P-159:8023, P-160:8075, P-162:8180, P-163:8235, P-164:8294). The template defect is now beyond doubt.
2. **The spec names an error code that does not exist.** Step 2 and acceptance criterion 2 both require `err('TOKEN_LIMIT')`, but `TOKEN_LIMIT` was **not** in the union — verified: absent from `result/index.ts`, absent from the root barrel, and the only `*LIMIT*` codes were `COST_LIMIT`, `RATE_LIMIT`, `LOOP_LIMIT`. So this phase adds **code 49**, with the four coordinated edits: the union, `STITCH_ERROR_CODES`, `doctor.ts`'s exhaustive `describeError`, and `build.smoke.test.ts`'s hardcoded count.
3. **The comparison in step 2 cannot compile.** `ctx.costTracker.get totalTokens > maxTokens` — but `CostTracker.totalTokens` is a `TokenUsage` **object** (`{input, output, total}`), not a number. Compared against `>`, this is a type error. The guard takes flat numbers instead.
4. **`ctx: LoopContext` names a type that does not exist.** `ToolContext.config` is also `Record<string, unknown>`, not `Config`, so reading `[agent]` out of it is a narrowing job. `LoopContext` is defined here (the spec's own name) and `readCapConfig` does the narrowing with no casts.
5. **The iteration rule is off by one.** Step 2 says "if `iterations > cap.maxIterations`" and step 4 says "consult the guard at the top of each iteration". Read together, at the top of iteration *k* the counter is *k*, so `>` permits `maxIterations + 1` iterations. The loop's existing and tested behaviour is exactly `maxIterations` (`loop.test.ts` asserts `LOOP_LIMIT`), so the guard refuses on `iterations >= maxIterations`. The tested behaviour is preserved rather than quietly gaining a call.

**The trap this phase had to avoid: a guard that never fires.** The loop was already `for (iterations = 0; iterations < maxIterations; iterations++)` and already returned `LOOP_LIMIT`. Layering a guard on top of an existing hard bound means the **bound fires first** and the guard is dead code that only ever runs in unit tests — a spend guard that is never consulted. So the bound was removed and the loop became `for (;;)`, with the guard as the sole authority. TypeScript then proved the old fall-through `return err({code:'LOOP_LIMIT'})` unreachable, and it was **deleted** rather than left behind as a second answer to the same question. The existing `loop.test.ts` still passes unchanged, which is the evidence the off-by-one decision was right.

**Decisions:**

- **`TOKEN_LIMIT` is a new code, not a `COST_LIMIT` alias.** Tokens and dollars are different budgets: a cheap model can exhaust a token cap with no dollar consequence, and an expensive one can hit the dollar cap first. Collapsing them would send an operator to the wrong setting. New shape: `{ code, spentTokens, limitTokens, message }`.
- **`COST_LIMIT` gained an optional `message`.** It previously had no `message` and no `hint`, so a cap stop could not carry a reason the way `LOOP_LIMIT` and `TOKEN_LIMIT` do. The addition is optional and backward compatible — `doctor.test.ts` already constructs one and still typechecks.
- **`0` MEANS OFF, and that is decided in exactly one place.** The `[agent]` defaults are `maxTokens: 0` and `maxCostUsd: 0`. Read literally as limits, **every default run would stop on its first iteration**. `budgetOf()` is the single definition of what `0` means, and a test asserts a cap with a billion tokens and $999 does *not* stop.
- **A configured dollar budget with no priced tracker is an error, not a no-op.** The loop's own `ModelSpec` is a placeholder with `cost: { input: 0, output: 0 }` (`ai/loop.ts`), so real pricing exists only in the `CostTracker` a caller injects. Silently not enforcing a spend cap is precisely the failure this phase exists to prevent, so it returns `CONFIG_ERROR` on `agent.maxCostUsd` explaining that the cap cannot be enforced. Safe direction: refuse rather than under-enforce.
- **The token budget does not need a tracker.** The loop accumulates `usage.total` itself each turn, because providers report usage whether or not a tracker was injected — so the token cap is enforceable for every caller, not only those who opted into `LoopConfig.cost`.
- **The cap stop is checked FIRST in the iteration body**, before the P-159 state moves. Transitioning to `streaming` and *then* refusing would publish a P-162 `state` event for an iteration that never ran — the exact "it never happened" vs "it failed" confusion P-162 was built to prevent. A test asserts exactly `maxIterations` `streaming` events for a capped run.
- **A cap stop emits `{type:'complete', finishReason:'length'}`** per the handoff note. `'length'` is the honest existing `FinishReason`: the run ended because a limit was reached, not because the model chose to stop. No new event variant, so P-162's union contract is unchanged.
- **The guard is consulted before a human is asked**, via `canRaise()`, so a run that has spent its raise allowance does not park a question whose only possible answer is "no".
- **`ai/loop.ts` imports `agent/cap.ts` — the one exception to the eight ADR-030 seams.** Those seams exist to break a cycle, and `agent/cap.ts` imports nothing from `ai/` precisely so no cycle exists here. The spec also puts the guard's construction and consultation in the loop, so injecting it would have been more improvisation than importing it. `LoopCapLike` is still declared in `ai/types.ts` so the loop depends on the shape, and a test asserts a real `LoopCap` satisfies it.
- **Resolution order for the cap:** per-task `LoopConfig.cap` → `[agent]` config → the caller's own `LoopConfig.maxIterations` (which predates this phase and stays authoritative when nothing else says otherwise) → `DEFAULT_MAX_ITERATIONS = 20`.

**A real defect the test suite caught, and it was mine.** The first version of `autoRaiseBudget` raised the cap without bound. The test **hung**, and the reason was a genuine design fault, not a flaky test: a human who keeps saying yes is answered, the budget doubles, the loop resumes, hits the new ceiling, asks again, and runs indefinitely. That converts the phase's central promise — spend is bounded — into unbounded spend with extra steps, and an auto-approving client would never stop. Fixed by `maxRaises` (default **1**), with the bound enforced *inside the guard* so it holds however a caller reaches it. One raise is the useful case: the cap was set too low for a job that is nearly done.

Two follow-on defects the same test exposed:

- **The loop rebuilt the guard after a raise**, which reset the raise counter and made the bound unreachable. `raise()` now mutates the guard in place, so the counter and the cap are the same object and cannot disagree.
- **`raise()` doubled the STOP's recorded limit rather than the current cap**, so the second raise returned 4 again — a silent no-op that still consumed the allowance, reading as "the human approved and nothing happened". It now doubles the current value; the stop is consulted only for *which* budget to widen.

**Alternatives Considered:**

- **Keep the `for` bound and add the guard alongside it** — rejected: the bound fires first and the guard is dead code. This is the shape the spec implies, and it is the one that would have shipped a spend guard that never runs.
- **Reuse `COST_LIMIT` for tokens** — rejected: sends the operator to the wrong setting, and the two budgets fail at different points in the same run.
- **Read `0` as "no tokens allowed"** — rejected: the config default is `0`, so this kills every default run at iteration one.
- **Silently skip an unenforceable cost cap** — rejected: a guard that reports success while enforcing nothing is worse than one that refuses.
- **Unbounded `autoRaiseBudget`** — rejected: this is the hang above.
- **Let the guard raise the cap itself, with no human** — rejected outright by step 5, and by the fact that an agent deciding to spend more of someone's money is the failure mode this whole phase is defending against.
- **Add a `limit` variant to `ReasoningEvent`** — rejected: the handoff asked for a `complete`-style event, and `finishReason: 'length'` already says "stopped at a limit" without extending a contract P-162's UI renders.
- **Enforce the cap inside the `for` condition** — rejected: it cannot express the token and dollar budgets at all, and it would put the decision in the least testable place.

**Consequences:**

- Every agent run is bounded on three independent axes, each with a distinct code carrying its own usage numbers, and each with a reason a user can read.
- Adding code 50 cannot ship unclassified: P-163's `Record<StitchErrorCode, ErrorRule>` makes it a compile error, and P-163's hardcoded non-recoverable list makes it a test failure. Adding `TOKEN_LIMIT` triggered exactly that, which is the mechanism working.
- The loop provably cannot exceed its budgets, and the guard — not a loop condition — is what proves it.
- A budget can be raised at most once per run by default, and only by a human who was asked.

---

## ADR-038: The Git Facade Mutates the Child Stage, Not the Source Repos

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-165 supplies the production implementation of the `GitFacade` contract that P-140 declared and P-161 extended (`GitFacade` was, until now, only a *type* — `ai/types.ts:75`). Its stated job (`PHASES_DETAILED.md:8334-8377`) is to make agent-tool mutations "real git operations **on the child-repo stage**", so `select_files`/`move_file`/`edit_config`/`propose_component` and P-161's undo stack write history instead of raw bytes.

The spec's step 1 sketches a capability list (`writeFile`→P-076 `writeToWorktree`, `move`→P-073, `commit`→P-077, `mergeSources`→P-072+P-075, `stageStatus`→P-084, `rollback`→P-085). As with every Epic 7 phase, the sketch is advisory: ADR-021/023/025 fix the real signatures, and the mandate is to reconcile against the declared type, not the sketch.

**The defect this phase had to correct.** An in-progress draft (uncommitted) implemented the mutating methods as `repoFor(label)` — i.e. `writeFile('A', path)` wrote into **source repo A**. That is wrong, and it is wrong in the one way that matters most here:

1. **ADR-023 says so explicitly** (`DECISIONS.md:658`): "`GitFacade` … addresses the **source** repos, and its repo parameter is typed `'A' | 'B'`. **Repo C is not a source.**" The mutation surface P-152 later added to `GitFacade` is the read/write counterpart of the read-only `StagingFacade`, and P-152 step 3 requires the path "within C stage root".
2. **Every mutating tool addresses the stage.** `edit_config`/`move_file`/`propose_component` validate containment against `ctx.config['stageRoot'] ?? 'C'` and then call `ctx.git.writeFile(ctx.cwd, 'A', …)` / `ctx.git.readStagedFile(…)`; `revert.ts` uses the same `REVERT_REPO = 'A'` placeholder. The `'A'` argument is a convention forced by the P-140 signature, not a target choice.
3. **Writing to source A corrupts provenance.** The agent composes into C; rewriting the user's originals (A/B) would silently falsify the `ProvenanceMap` (P-181) that credits upstream authors. The phase's own acceptance criterion says "traversal outside **stage root**".

**Decisions:**

- **Mutations target `paths.repoC`; reads split by purpose.** `listFiles`/`readFile` address the source repos (`'A' | 'B'`); `readStagedFile`/`writeFile`/`move`/`deleteFile`/`commit`/`commitStage`/`rollback`/`abort`/`stageStatus` address the child stage. The `repo: 'A' | 'B'` parameter on the mutating methods is retained (the contract fixes the arity) but is **ignored as a target** and documented as the provenance origin hint — widening it to `'A' | 'B' | 'C'` stays rejected per ADR-023.
- **`writeFile` writes the live stage worktree, then verifies `git add`.** `writeToWorktree` (P-076) writes into an *isolated detached* worktree (`git/worktree.ts:445-528`) — correct for the merge/commit pipeline, wrong for an interactive agent whose very next tool (`run_build`, `edit_config`'s read-back) must see the file in the stage. So the facade writes with `fs` (mkdir -p), verifies, then `git add -- <path>` so the change is a real, staged git change. The spec's "→ `writeToWorktree`" is therefore deliberately not followed, for the same reason step 1's `listFiles`-via-P-090 sketch was reconciled against P-148's real `listFiles`.
- **The P-082 binary skip is enforced and SURFACED, never silent.** A payload with a NUL in git's 8000-byte window is refused before any write; every write is then verified with P-082's `isBinary` (git attr + extension + magic) and, if binary, the bytes are reverted and a typed `CONFIG_ERROR` naming the reason is returned. Silently dropping a file the model asked to write is exactly the "it never happened" failure P-162 exists to prevent.
- **`mergeSources` and `stageStatus` are added as extra capabilities on the concrete class.** `mergeSources(opts)` delegates to `mergeRepos` (P-072, which applies the caller's P-075 resolver via `resolveConflicts`); `stageStatus()` delegates to `isClean` (P-084). The spec's `rollback`/`rollbackAbort` maps onto P-085's real exports: `rollback(ref)` = `resetTo` (reverts a failed multi-step mutation, the acceptance criterion), and `abort(kind)` = `abortGitOp` (aborts an in-progress op).
- **`commit(message): Promise<void>` throws** — the P-140 contract returns `void` and so has no error channel. Callers that want a typed result use `commitStage`. This is the one place the no-throw rule is overridden by a pre-existing interface, and it is documented at the call site.
- **Loop wiring.** `createGitFacade` is exported from `agent/index.ts`; the loop's context is injected (`LoopConfig.context`, P-140/ADR-021), so the real facade is the only production implementation and there is no mock in the production path. The end-to-end loop proof (two fixture repos → agent loop → buildable C) is P-167's mandate and is not pre-empted here.

**A real bug the tests caught.** `commitStage` pre-expands the tool's intended file list to `git status --porcelain=v1 -z --untracked-files=all` granularity so P-077's file-for-file precheck passes for brand-new directories. The first version mishandled two chunk shapes: a staged **rename** (`R  <new>\0<old>\0`, where the second chunk has no `XY ` prefix) was truncated to garbage, and a staged **deletion** (`D `) was passed to `git add`, which fails with `pathspec '<deleted>' did not match any files` once the deletion is already in the index. Fixed by parsing the rename source correctly and excluding already-staged deletions from the pre-stage set, while still passing a genuinely unmatched entry through so git refuses it (the `move` + commit sequence is the standing regression guard).

**Alternatives Considered:**

- **Keep the draft's source-repo mapping** — rejected: ADR-023/025 and every tool's `stageRoot: 'C'` containment check contradict it, and it corrupts P-181 provenance.
- **Widen the repo parameter to `'A' | 'B' | 'C'`** — rejected (again, per ADR-023): it would change `SelectedFile.repo`, a P-148 contract P-181 reads.
- **Use P-076 `writeToWorktree` for `writeFile`** — rejected: it mutates an ephemeral detached worktree the stage never sees.
- **Silently skip binary writes** — rejected: a hidden no-op the model cannot observe is the failure P-162 guards against.
- **Filter `commitStage`'s pre-stage to "addable" paths generically** — rejected: a truly unmatched path must still fail loudly, so the exclusion is scoped to *already-staged deletions* only.

**Consequences:**

- Every agent mutation lands in the child stage as a real git change, so P-079/P-181 can reconstruct provenance from history and P-161's undo reverts real commits.
- Commits carry co-author trailers (P-077) plus a one-line JSON `Stitch-Origin:` trailer (`parseOriginTrailer` reads it back) — the structured seam P-181/P-311 consume.
- The binary skip is a first-class, visible refusal rather than a silent drop.
- `readStagedFile` closes the P-152 gap so `edit_config`/`move_file`/`propose_component`/`revert` read and write the same tree.

---

## ADR-039: The Deps/License Facades Implement the Thin Contract and Add the Rich Verbs as Concrete Methods

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-166 (`PHASES_DETAILED.md:8384-8430`) supplies the production `ToolContext['deps']` and `ToolContext['license']` so the loop's checks and fixes reuse the real P-104–P-117 / P-118–P-130 modules instead of re-implementing them. Its step 1 sketches a rich surface (`DepsFacade.union/resolve/dedupe/mergeScripts/lockfile/report`; `LicenseFacade.scan/normalize/compat/policy/reportData` + `complianceGate`), but the P-140 declarations the tools are actually written against are minimal — `DepsFacade { analyze(); install() }` and `LicenseFacade { scan(); check() }` (`ai/types.ts:155-163`), and `analyze()` is the *only* facade method any tool calls (`resolve_deps.ts:274`, `fix_dependency.ts:260`).

**Decisions:**

- **`ai/types.ts` is not widened.** The rich verbs are CONCRETE methods on the two classes, exactly as P-165 kept `commitStage`/`mergeSources`/`stageStatus` off the `GitFacade` interface. The declared members are implemented faithfully, so every pre-P-166 `ToolContext` still compiles and no tool's assumed surface changed.
- **The agent classes are aliased at the public barrel.** `src/index.ts` already exports the `ai/types` `DepsFacade`/`LicenseFacade` interfaces, so `agent/index.ts`'s classes are re-exported there as `AgentDepsFacade`/`AgentLicenseFacade` — the same disambiguation the barrel already uses for `LicenseCompliancePolicy` and `DepsMergeResult`. `agent/index.ts` exports them under their spec names.
- **`analyze()` reads the stage's own manifests.** It runs P-103 `detectEcosystems` over repo C, parses each hit with the phase-correct parser (P-104–P-107; note `parsePythonManifest` takes `(filePath, content)` — the opposite order to its siblings), and flattens every install section to one `name -> range` map. It REJECTS when the stage cannot be walked, because both call sites wrap it in `try/catch` and map the caught message to a typed `INTERNAL`; returning `{}` would silently report every imported package as missing — a false gap, worse than a loud failure. A single unparseable/stale manifest entry is skipped, never fatal.
- **`install()` is realised as a documented refusal.** Dependency installation is the sandbox's job (P-170) and the host-side agent facade must never spawn a package manager (ADR-028: "never run on the host"). A method with no error channel that this layer must not perform can only refuse honestly.
- **Signature reconciliation (module wins over sketch, the P-165 precedent).** P-109's `resolveCollision` has no `pkg` input, so `resolve(rangeA, rangeB, options?)` takes two ranges. P-111's `chooseDedupeStrategy` needs `(versions, requested)`, so `dedupe` takes that pair. P-112's `mergeScripts` requires `prefixA`/`prefixB`, so the facade requires its options. The alternative — inventing a `(pkg, range)` or a `(manifest)`-shaped wrapper — would be a second code path with made-up semantics.
- **`complianceGate` fails CLOSED.** A scan that cannot run returns `{ blocking: true, report }` with the failure as a reason; "we could not check" must never read as "it is compliant" (the same direction as P-164's unenforceable-cost cap). On success it is a single honest delegate chain: `scanDeclared` (P-118) → `detectUnknown` (P-123) → `checkGpl` (P-121) → `chooseDualLicense` for OR expressions (P-122) → `checkCompatibility` (P-120) → `evaluatePolicy` (P-127).
- **The declared placeholders are given real meaning.** `LicenseFacade.scan(): string[]` returns the distinct normalized SPDX ids the stage declares; `check(): boolean` is the inverse of the gate's `blocking`. Both delegate, so the pre-existing members are no longer stubs.
- **`LicenseAggregateFieldsLike` is a structural seam.** P-127's `LicenseAggregateFields` is module-private, so the facade declares an identically-shaped interface (ADR-030's pattern) rather than importing a private type — the compiled contract is the same without reaching into another module's internals.
- **`DEFAULT_LICENSE_POLICY` is explicit and documented.** `complianceGate`/`check` default to permissive + weak-copyleft allowed, unknown denied, attribution required, MIT target. A caller needing a different bar passes its own; nothing reads the config schema's name-list `LicensePolicy`, which is a different concept.
- **Loop wiring is injection, not a `loop.ts` edit.** `ToolContext.deps`/`.license` are required members, but the loop receives the whole context (`LoopConfig.context`, P-140/ADR-021), so the real facades are wired by the orchestrator (P-238) and there is no mock in the production path. The mandated test drives the real `runToolLoop` with a `ToolContext` whose facades are the real classes and asserts a tool reads real module output through them. The full E2E is P-167's mandate and is not pre-empted here.

**Consequences:**

- `fix_dependency`/`detect_gaps` see what C actually declares; a licence verdict blocks via `complianceGate` with the real policy engine; neither has a second, drifting implementation.
- Adding a facade method is additive; no interface change was needed, so no P-140–P-165 tool or loop test changed.
- The 4 mandated tests (`deps union/resolve match modules`, `license scan/compat match modules`, `complianceGate blocks on deny`, `loop uses real facades`) plus 9 extras run against real modules and fixture packages.

---

## ADR-040: The E2E Harness Owns Orchestration, the Fixtures Are Generated From Committed Specs, and `fix_dependency` Persistence Is the Caller's Job

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-167 (`PHASES_DETAILED.md:8437-8481`) is the gate that declares Epic 7 done: two real fixture repos → a real agent loop with tools → a buildable child repo C → the licence/compliance gate, end to end and offline. Its Files list names a committed `agent/__tests__/fixtures/` tree, and its steps describe a `runAgentE2E` "orchestration harness". Running the real stack surfaced several places where the E2E must supply what the tools deliberately do NOT own.

**Decisions:**

- **Fixtures are generated from COMMITTED specs, not a committed `fixtures/` tree.** Step 1 allows "the P-064 generator **or** committed [repos]". A committed tree of `.js` files under `src/` would be linted by the repo-wide `eslint .` (there is no fixtures ignore, and every other fixture dir in this repo is non-JS), and would have to carry nested `.git` directories. So the `FixtureSpec` constants are committed in `agent.e2e.test.ts` and the generator builds the repos per run — the same "committed spec, generated repo" arrangement `gitFacade.test.ts` (P-165) and the P-087 git suites use, which is deterministic without either problem.
- **The harness is the orchestrator for the steps tools deliberately do not own.** `select_files` only *proposes* a selection (P-148 is read-only), so the harness writes the selected files into C before the loop, exactly as the merge pipeline does.
- **`fix_dependency` persistence is the caller's job, and it is a MERGE, not a replace.** P-151 is compute-only and says so ("the caller serializes/writes it, not this tool"), and `runFixDependency` models a synthetic `{name, dependencies}` manifest. Writing that verbatim drops `license`/`version`/`scripts` — and the compliance gate (P-120) then reads the root package as `UNKNOWN` and blocks a stage that is actually MIT. The harness therefore merges the fix's `{package, version}` into the stage manifest's `fix.section`, preserving every other field. The `selection` is threaded through `runFixDependency`'s options because `ToolDefinition.execute` has no options channel (P-151 designed it that way for exactly this caller).
- **The HIL test uses the REAL `HilQueue`**, over a local in-memory `DbLike` (the `node:sqlite` adapter every P-145/P-160 test file defines), not a mock gate. A short `hilTimeoutMs` lets the parked request be asserted *after* `USER_TIMEOUT` without hanging the suite — `waitForResolution` leaves the row `pending`, so `queue.pending()` proves both the park and its `waiting_approval` state, and the stage's commit log (baseline only) proves C was not finalised.
- **No production `StagingFacade` exists**, so the harness supplies a small read-only one over the stage (P-150 specified only the interface; the orchestrator, P-238, owns the production one, exactly as it owns the other facades' construction).
- **The sandbox is the P-155 seam, stubbed.** The injected `SandboxRunner` returns exit 0 and records every request, so the build/test half runs offline; the test asserts the recorded sequence `['build','test','test']`, which is P-155's build-once/test-twice policy.
- **`test:agent:e2e` runs the repo's runner, not `bun test`.** The script mirrors the existing `test:ai`/`test:license` shape (`bunx vitest run src/agent --coverage … --coverage.thresholds…`): `bun test` cannot run in this repo (its `bunfig.toml` `preload` is rejected by Bun's native runner), and running the whole `src/agent` suite is what makes the 80/70/80/80 gate honest — one E2E file cannot cover the module.
- **Barrel completeness (step 6) uncovered a real omission.** `createUndoRecorder` — the `UndoRecorder` the loop consumes (P-161) — was implemented and used but never exported from `agent/index.ts` or the public barrel. Added to both.

**Consequences:**

- The suite proves the whole stack wires together: selection → real `resolve_dependency_closure` finding `left-pad` missing → real P-151 fix → manifest updated on disk → `run_build` through the sandbox seam → `complianceGate` `allow`.
- The blocking path is proven with real modules: an installed GPL dependency makes `complianceGate().blocking === true`, the gated `ask_user` parks a durable `waiting_approval` request, and the stage keeps only its baseline commit.
- `LOOP_LIMIT` and `revert_last` are covered end to end, so the cap (P-164) and the undo stack (P-161) are proven against the real loop rather than in isolation.
- `test:agent:e2e` is green (21 files / 160 tests, coverage 84.27/71.98/93.02/88.73 vs the 80/70/80/80 gate), and the full suite is green (161 files / 2014 tests).

---

## ADR-041: The Docker Client Adds `DOCKER_PULL_FAILED` and `networkAllow`, Wraps the P-067 Probe, and Adapts dockerode's Overloads

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-168 (`PHASES_DETAILED.md:8488-8532`) opens Epic 8 with the container-lifecycle client the whole Sandbox epic builds on. Four of its requirements did not match the codebase, and one was a TypeScript trap.

**Decisions:**

1. **`DOCKER_PULL_FAILED` is a new code.** The spec mandates `err('DOCKER_PULL_FAILED')` (step 2 + acceptance), but `result/index.ts` only had `DOCKER_ERROR` (a container operation failed) and `SANDBOX_FAILED`/`SANDBOX_UNAVAILABLE`. The distinction is real: a pull failure is about the image/tag/registry or daemon auth and is what P-175's GH Actions fallback keys off, while a container failure is about the run. Added as **code 50** with the same six coordinated edits P-164 used for `TOKEN_LIMIT`: the union, `STITCH_ERROR_CODES`, `doctor.ts`'s exhaustive `describeError`, **P-163's `Record<StitchErrorCode, ErrorRule>` in `agent/errors.ts`** (the mechanism P-163 built — the compile error fired exactly as designed), `build.smoke.test.ts`'s hardcoded count (49 → 50), and `INTEGRATIONS.md` §9.1.
2. **`config.sandbox.networkAllow` is added as an OPTIONAL boolean.** Step 4 and the acceptance criterion both name it, but `SandboxConfigSchema` had only `backend`/`dockerHost?`/`limits`. It is `.optional()` rather than defaulted so `defaultConfig` needs no change and an existing config is untouched; `undefined` means "network allowed", which is the pre-P-168 behaviour. `SandboxClient` takes the flag as a constructor option (so it is testable without a `Config`) and the orchestrator passes `config.sandbox.networkAllow` through. P-174 owns the product default.
3. **The client WRAPS the P-067 surface instead of reimplementing it.** `sandbox/docker.ts` already exports `createDockerClient` (factory, no I/O), `pingDocker` (reachability as data, never an err) and `defaultDockerSocket`. `SandboxClient.isAvailable()` therefore delegates to `pingDocker` rather than calling `docker.ping()` itself, and `SandboxClient.create()` builds its instance via `createDockerClient` — so there is one reachability policy in the codebase, not two.
4. **The dockerode seam is a NARROW structural interface plus explicit adapters.** `Docker.createContainer`/`Container.wait`/`logs`/`remove`/`stats` are **overload sets** (`(options, callback)` + `(options)`), and TypeScript checks a single-signature target against the first overload only — assigning a real `Docker` to a one-argument `DockerLike` fails with `Expected 2 or more arguments, but got 1`, and mirroring the overload pair on the target does not fix it. `adaptDocker`/`adaptContainer` name each member explicitly, which sidesteps the structural-overload comparison with **no cast** and documents exactly which dockerode calls this client may make. (The container-overload was measured, not guessed: the identical error recurred on `Container.wait` after `createContainer` was fixed.)
5. **Timeout and abort use existing codes.** A `timeoutMs` expiry returns `DOCKER_ERROR` (a daemon-level failure, carrying the `containerId`) and an abort returns `ABORTED` (the P-140 code for `AbortSignal`); only the spec-named pull failure needed a new code. Also: a `StitchError` union member without `message` (`SANDBOX_FAILED`) is why the tests narrow on `.code` before reading `.message` — the P-124 lesson, applied here.
6. **Logs are demultiplexed and bounded.** Docker multiplexes stdout/stderr into one stream with 8-byte frame headers when TTY is off; `demuxDockerLogs` splits them, falls back to "everything is stdout" for a raw/TTY stream, and keeps the newest `MAX_CONTAINER_LOG_LINES` (500) per stream — the phase handoff's explicit memory bound. `ContainerRun` mirrors P-155's `SandboxRunResult` line-array shape so P-171/P-172 can hand it straight to `run_build`.

**Consequences:**

- Everything the Sandbox epic needs (pull, run, stats, rm) is exercised offline: the 7 mandated tests plus 5 extras run against a fake dockerode with no daemon, and the `NetworkMode` / cleanup properties are asserted against the options the client actually sent, not against a spy's return value.
- Adding code 51 cannot ship unclassified: P-163's `Record` and the smoke-test count both fail the build, which is the guard working.
- `isAvailable()` is the single guard P-175 keys its GH Actions fallback on, and it never throws — an unreachable daemon is an expected state, not an error.

---

## ADR-042: Images Key on the Real `Ecosystem` Union, Add `DOCKER_BUILD_FAILED` and Two Config Keys, and Cache Through the P-145 Table Pattern

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-169 (`PHASES_DETAILED.md:8539-8584`) gives each ecosystem a pinned base image (or a locally-built `Dockerfile.<ecosystem>`) and caches the resolution. Four of its requirements did not match the codebase, one of them in a way that would have produced dead files.

**Decisions:**

1. **`ECOSYSTEM_IMAGES` is keyed by `Ecosystem` as the codebase defines it, not by the sketch's keys.** Step 1's sketch is `{ npm: …, python: …, cargo: …, go: … }`, but the P-103 union is `Ecosystem = 'node' | 'python' | 'rust' | 'go'` (`npm`/`cargo` are the *parser* ids, `EcosystemParser`). Every consumer — P-155's `BuildEcosystem`, `ECOSYSTEM_COMMANDS`, `detectEcosystems`, `detectEcosystemFromListing` — speaks `node|python|rust|go`, so a map keyed `npm|python|cargo|go` would be unusable from `run_build`. Same reason the Dockerfiles are **`Dockerfile.node|python|rust|go`**: step 2's lookup is `Dockerfile.<eco>` where `<eco>` is the resolution key, so `Dockerfile.npm`/`Dockerfile.cargo` could never be found — dead files. The four files exist as the phase's Files list requires, named for the ecosystem they serve.
2. **`DOCKER_BUILD_FAILED` is a new code (51).** The spec mandates it and it is genuinely distinct: a *pull* failure is registry/image/auth (and drives P-175's fallback), a *container* failure is the run, and a *build* failure is the Dockerfile/context the user asked us to use. Added with the same six coordinated edits as `DOCKER_PULL_FAILED` (union, `STITCH_ERROR_CODES`, `doctor.ts`'s exhaustive renderer, P-163's `Record<StitchErrorCode, ErrorRule>` — the compile error fired again — `build.smoke`'s count, and `INTEGRATIONS.md` §9.1).
3. **`config.sandbox.overrideImage` and `config.sandbox.buildLocal` are added as OPTIONAL.** Both are named by step 2 and neither existed (`SandboxConfigSchema` had `backend`/`dockerHost?`/`limits` + P-168's `networkAllow`). Optional keeps `defaultConfig` and existing configs untouched; `overrideImage` is an open record whose unknown keys are ignored rather than rejected.
4. **`SandboxClient.buildImage` is added to the P-168 client**, because P-169's build path mandates `client.buildImage` and P-168's spec did not include it. It is dockerode-shaped (`buildImage(context, { t, dockerfile, buildargs })`), drains the build stream (a `{"error": …}` line is a failure even when the call resolved), and maps to `DOCKER_BUILD_FAILED`; the shared stream-drain was factored into one `#drainStream(makeError)`. The build **context** is a tar path or stream passed through unchanged — **no `tar` dependency is added** (shaping a context is a packaging concern), so `buildLocal` requires an explicit `dockerfileDir` and the context defaults to it.
5. **The `ensureImage` client seam is narrow and structural.** `SandboxClient` declares `#private` fields, which makes the class **nominally** typed, so no test fake could be assigned to it; `ImageClient` names exactly the two methods needed (`pull`, `buildImage`). This is the ADR-030 rule applied once more.
6. **Caching owns its table and fails loud on misconfiguration.** The `sandbox_images` table is created on first use (the P-145 `ai_calls` / P-160 `hil_requests` pattern — `store/schema.ts`'s header reserves its own migration slots), keyed `ecosystem|tag|platform` with an upsert so a re-resolve never duplicates, and `platform` recorded (`null` when unqualified). A missing `dockerfileDir` or `Dockerfile.<eco>` under `buildLocal` is a typed `CONFIG_ERROR`, never a silent fall-through to a pull the user did not ask for; pull/build errors propagate unchanged.

**Consequences:**

- Image resolution is one pure-ish decision function plus a cache, entirely exercisable offline with a fake client — the 6 mandated tests plus 4 extras run with no daemon and no registry.
- The resolved ref (pinned public tag, or a deterministic `stitch-<eco>:stitch-ephemeral-<hash>`) is what P-170/P-171 hand to `run`, and `EPHEMERAL_PREFIX` is what P-177's cleanup prunes.
- Reusing the in-repo `Ecosystem` union means adding an ecosystem is a compile error in `ECOSYSTEM_IMAGES` rather than a silent miss.

---

## ADR-043: The Node Image Must Be Bun-Ready, Offline Is Declared Not Probed, and the New Install Code Carries a `message`

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-170 (`PHASES_DETAILED.md:8591-8628`) installs the staged repo's dependencies inside the sandbox, between resolving an image (P-169) and building (P-171). Its shape is sound, but executing it exposed a cross-phase inconsistency and two contract details.

**Decisions:**

1. **`ECOSYSTEM_IMAGES.node` is corrected to the bun-ready image (`oven/bun:1.1`), amending P-169.** P-169's step-1 note says *"For npm use the bun-ready node image"* — but its sketch value was `node:22-alpine`, which is what P-169 committed. That value cannot work: P-170's node install is `bun install`, and P-155's node build/test are `bun run build` / `bun test`; a node-only image carries no bun, so **P-171 would have failed at its first command**. `oven/bun:1.1` is the repo's own P-008 base and is already bun-ready. `npm ci` (the spec's alternative) was not used, because a bun-based image gives no npm guarantee and one package manager keeps one lockfile story (`bun install`, `--frozen-lockfile` when a lockfile is committed). The P-169 test's expectation was updated with it.
2. **Two new codes: `DEP_INSTALL_FAILED` (52) and `DEP_INSTALL_OFFLINE_BLOCKED` (53)**, each with the six coordinated edits (union, `STITCH_ERROR_CODES`, `doctor.ts`'s exhaustive renderer, P-163's `Record<StitchErrorCode, ErrorRule>`, `build.smoke`'s count, `INTEGRATIONS.md` §9.1). They are distinct from `SANDBOX_FAILED` so a failure is attributed to the install step rather than the build — which is what lets P-171/P-175 react correctly.
3. **`DEP_INSTALL_FAILED` carries a `message` in addition to the spec's `{ exitCode, stderr }`.** Not decoration: the cli's `describeError` has a `default` branch that reads `error.message`, so a code with no `message` **breaks that consumer** — the typecheck caught it immediately (`packages/cli/src/commands/doctor.ts:97`). The alternatives were to edit a package this phase does not own, or to make the payload additive; additive wins.
4. **Offline is a DECLARATION, not a probe.** `NetworkMode: 'none'` means we cannot test the registry to discover whether a cache is warm, so `installDeps` does not pretend to. When `networkAllowed === false` the caller must declare `offlineReady` (deps vendored or a warm cache) — that is the only honest way to distinguish "offline and fine" from "offline and doomed" — and otherwise it returns `DEP_INSTALL_OFFLINE_BLOCKED` **without creating a container**, so a job can never hang against a network it was denied. P-175's GH-Actions path has network and is the natural fallback (the error's hint says so).
5. **Ecosystem keys are the real `Ecosystem` union**, as in P-169: the spec's `npm`/`cargo` are parser ids; the command map switches on `node | python | rust | go`.
6. **The client seam is the narrow structural `InstallClient`**, because `SandboxClient`'s `#private` fields make it nominally typed and no fake is assignable (the ADR-030 rule, third use in Epic 8).
7. **`image` defaults to `imageFor(ecosystem)` but is overridable**, so the acceptance criterion ("uses `imageFor(ecosystem)`") holds while the pipeline can pass the resolved ref from P-169's `ensureImage` (which exists precisely for overrides and local builds). `packageCount` is a documented best-effort parse of the tool's own stdout, absent when it printed none; `dirty: false` is the P-181 anticipation the handoff calls out (the install must not leak host files).

**Consequences:**

- The install step is fully exercisable offline with a fake client: 5 mandated tests plus 4 extras assert the command per ecosystem, the `/workspace` read-write mount, the `NetworkMode` switch, the offline gate, and both typed failures.
- A blocked-offline job fails fast with an actionable hint instead of hanging, and the same code path is what P-171/P-172 gate on.
- Correcting the node image means Epic 8's build/test commands can actually run — the alternative was a latent P-171 failure discovered two phases late.

---

## ADR-044: Artifact Capture Rides With the Run, `copyFrom` Writes an Archive, and a Build Verdict Is Never an Error

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-171 (`PHASES_DETAILED.md:8635-8676`) is the central verification — does merged C actually build — and its `BuildResult` is FROZEN because the web panel (P-220) and CLI progress (P-199) render it. Reading P-168's container contract before writing surfaced one requirement that could not work as specified.

**Decisions:**

1. **The artifact copy rides WITH the run, because P-168 removes the container in a `finally`.** The phase says "on completion … copy it out via `client.copyFrom(id, '/workspace/dist', target)`", but `SandboxClient.run` deletes its container before returning — so after `run` resolves there is nothing left to copy from, and keeping the container alive would break the cleanup guarantee that is P-168's acceptance criterion. `RunOptions.capture = { containerPath, hostDir }` therefore performs the copy inside the container's lifetime, and `ContainerRun.capturedArchive` reports the host path. A capture that finds nothing (many projects produce no output dir) is **not** an error. This was a structural conflict, not a preference.
2. **`SandboxClient.copyFrom` is added** (dockerode's `getArchive`), writing the container path's TAR out **verbatim** as `<hostDir>/<basename>.tar`. No tar-extraction dependency is added — the same decision ADR-042 recorded for build contexts — so unpacking belongs to the artifact consumer (P-173). `ContainerLike` gained `getArchive` (through the existing explicit adapter, which is what avoids dockerode's overload-assignability trap).
3. **A build verdict is never an `err`.** `pass = exitCode === 0`; a red build returns `ok(BuildResult{pass:false})` because the agent loop (P-163's recovery, P-155's `run_build`) must iterate on it. Only infrastructure problems — a container/client error, a blank `repoPath` — are typed errors. A test asserts both directions so the distinction cannot drift.
4. **`/workspace` read-only is NOT implemented.** Step 2 asks for "read-only for source, with a writable `/buildout`", but the pinned commands write into the project (`bun run build` → `dist/`, `go build` → caches), and the current `bindMounts` shape cannot express a `:ro` mode safely (a `host:container:ro` string breaks on Windows drive letters). `/buildout` IS mounted read-write when the caller supplies `buildoutDir`, and the acceptance criteria — which say only "reads staged C from `/workspace`" — are met. Recorded rather than silently dropped.
5. **The rust command diverges from P-155's map on purpose.** `ECOSYSTEM_COMMANDS.rust` (agent side) is `cargo build`; this phase specifies `cargo build --release`, and the phase's own dependency note says "the agent `run_build` P-155 stub now points here" — so `BUILD_COMMANDS` in `sandbox/build.ts` is the sandbox path's authority. The divergence is documented, not accidental.
6. **Artifacts are reported only when THIS run asked for them and the build passed.** The first version trusted any `capturedArchive` on a passing run; the fake-driven test caught it (a client returning one unrequested produced a phantom `outputDir`), and the check is now `wantCapture && pass && capturedArchive !== undefined`.
7. **Public-barrel collisions with P-155 are resolved by exporting once.** `MAX_BUILD_LOG_LINES` and `RunBuildOptions` already exist on the agent side (`run_build.ts`), so only the unique sandbox names (`runBuild`, `BUILD_COMMANDS`, `DEFAULT_OUTPUT_DIRS`, `DEFAULT_BUILDOUT`/`DEFAULT_BUILD_TIMEOUT_MS`, `BUILDOUT_MOUNT`, `BuildResult`, `BuildClient`) are re-exported publicly; the rest stay module-local in `sandbox/index.ts`.

**Handoff:** the P-155 `SandboxRunner` seam (the agent tool's injected backend) is **not** rewired here — P-171's file list is `build.ts` + `build.test.ts`, and the adapter that binds `SandboxRunner` to this client belongs to the phase that owns the seam (P-175's fallback / the pipeline). Recorded in PROGRESS as the open item.

**Consequences:**

- The build verdict is exercisable offline: the 6 mandated tests plus 3 extras cover the command per ecosystem, the mount/workingDir, both verdict directions, the infrastructure error, the capture request (including that it rides with the run and honours a custom `outputDir`), and the 500-line log bound.
- Logs are bounded twice — by the client's `MAX_CONTAINER_LOG_LINES` and again by this phase's `boundLogLines` — so a chatty build cannot exhaust memory even if a caller passes a custom client.

---

## ADR-045: Test Counts Come From Each Runner's Own Summary, Because No Runner Emits a Machine-Readable Report on Stdout

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-172 (`PHASES_DETAILED.md:8683-8725`) must turn a test run into a STRUCTURED `TestResult` — counts plus a bounded failure list — because the pipeline gate and P-176's flaky detection need more than a boolean, and `failures[].file` is what ties a red test back to a source file for P-181 provenance. Step 2 asks for "a `JUNIT`/`json` reporter flag where supported … else parse stdout regex".

**The measurement that shaped the phase:** none of the four runners can emit a machine-readable report on **stdout**:

| runner | flag | reality |
|--------|------|---------|
| `bun test` | `--reporter=junit` | **requires `--reporter-outfile=<path>`** — verified directly via `bun test --help`; it writes a FILE |
| `pytest` | `--junit-xml` | writes a FILE |
| `cargo test` | `--format json` | needs nightly |
| `go test` | `-json` | exists, but go is not installed on this machine, so it could not be verified |

So adding a reporter flag to the captured stdout would have produced nothing to parse — a phantom flag. The decision is therefore:

1. **Counts come from each runner's own summary line**, parsed by `parseSummary`: `bun test` → `N pass / N fail / N skip`; `pytest -q` → `N passed, N failed, N skipped`; `cargo test` → `test result: … N passed; N failed; N ignored`; `go test` → intentionally **no counts** (it enumerates only failures, and counting `ok <pkg>` lines as tests would overstate), so the exit code carries the verdict — which is exactly step 3's "0 when unparseable but exit 0 → trust exit code".
2. **A JUnit parser IS implemented and honoured when the output is XML** (`looksLikeJunit` → `parseJunitXml`). Nothing produces that today, but P-173's artifact capture lifts reporter files out of the container, at which point the same parser consumes them — so the support the handoff asks to "keep documented per ecosystem" is real code, not a promise. Malformed XML falls back to the text path rather than reporting zeros.
3. **A real parser gap was caught by the tests:** the first version's failure regex only matched `<failure message="m">stack</failure>` and silently dropped the **self-closing** `<failure message="m"/>`, which is valid JUnit and is what a reporter emits for a message-only failure. Fixed, with the capped-failures test asserting 5 of 90.
4. **Verdict semantics mirror P-171:** `pass = exitCode === 0`; a red suite is `ok(pass:false)` (the loop and the pipeline iterate on it), and only an infrastructure failure — a container error, a blank `repoPath` — is a typed `err`. No new error codes were needed.
5. **Bounds are explicit and separate:** log lines are capped by P-171's `boundLogLines` (500, reused rather than re-declared) and the failure list by `MAX_TEST_FAILURES` (50), because a 90-failure suite would otherwise flood the UI P-220 renders.
6. **The container seam is shared with P-171** (`TestClient = BuildClient`): same `run(spec, opts)` shape, same `/workspace` mount, plus `/buildout` when the caller supplies a dir, and `networkDisabled` when `networkAllowed === false`.

**Consequences:**

- The suite is exercisable offline with a fake client: the 6 mandated tests plus 3 extras feed sampled bun / pytest / cargo / go output and JUnit XML through the real parsers and assert counts, failure identity (name, message, file), the fallback, both verdict directions, the offline switch, and both bounds.
- Every parser is a pure exported function, so a future runner's format is a data change with a test, not a rewrite of `runTests`.

---

## ADR-046: Capture Owns Its Table, Overflow Is a Typed Result Not a Raise, and `onLog` Delivers Collected Lines

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-173 (`PHASES_DETAILED.md:8732-8771`) formalises capture so a failed stitch is reproducible post-hoc: a bounded ring buffer of logs, artifact extraction into a run-scoped host directory, and metadata persisted "in the job record". Four of its statements needed reconciling, and the no-throw rule forced a fifth.

**Decisions:**

1. **`capture()` returns a `Result`, and overflow is `SANDBOX_LOG_LIMIT` — not a raise.** Step 1 sketches `capture(...): Promise<{ logs; sizeBytes }>` and then says "raise `SANDBOX_LOG_LIMIT` if cap exceeded (but keep latest)". A method with no error channel cannot raise under the no-throw rule, and the parenthetical says the operation *partly* succeeded — so overflow returns `err(SANDBOX_LOG_LIMIT)` carrying `dropped`/`retained`, while the retained lines stay retrievable through `logs(runId)`. Success returns the spec's `{ logs, sizeBytes }` plus `dropped`. This is the P-165/P-168 precedent: the sketch is reconciled against the guardrails, and the code the spec names gets a real home rather than being dropped.
2. **Timestamps live in the buffer, not the spec's shape.** The handoff requires "timestamps per line (ISO) so re-run diffing is possible", but the spec's `logs` is `string[]`. Both are honoured: the ring buffer stores `LogEntry { ts, line }`, `entries(runId)` exposes them, and `logs(runId)` returns the plain strings the spec asks for. The buffer keeps the NEWEST lines on overflow (bounded memory, not truncation, per the same handoff).
3. **Metadata is persisted by a table this phase OWNS.** "Persist … as part of `JobRecord.artifacts` (P-239/248)" is a forward reference — P-239 is Wave 2 and `store/schema.ts`'s header reserves its migration slots for `P-181/187/230/239/241/303/309`. So `capture_runs` is created on first use over an injected `DbLike`, exactly as P-145 (`ai_calls`), P-160 (`hil_requests`) and P-169 (`sandbox_images`) do; P-239 reads it when it owns the real job record. Memory-only when no `db` is supplied.
4. **`onLog` delivers the run's COLLECTED lines; `followLogs` is the live path.** Acceptance asks that `client.run` "accepts onLog and streams to capture". A concurrent follow stream would race the client's own log read (two readers on one container) for no benefit at this layer, so `run` invokes `onLog` for each collected line when it settles — bounded, single-reader, and the binding test drives the REAL `SandboxClient` end to end. Callers that genuinely need lines as they are emitted use the new `followLogs(containerId)`, which returns the raw multiplexed stream; `capture(..., { format: 'json' })` uses exactly that path to split newline-delimited records.
5. **Two new codes, both carrying `message`.** `SANDBOX_LOG_LIMIT` (54) and `SANDBOX_ARTIFACT_LIMIT` (55), added with the six coordinated edits each. Both include a `message` deliberately: P-170 already proved that a code without one breaks the cli's `describeError` default branch, so the payload shape is chosen to keep every consumer compiling. `SANDBOX_LOG_LIMIT` is classified `continue` (the run happened; lines were lost), `SANDBOX_ARTIFACT_LIMIT` likewise — neither is a reason to abort a stitch.
6. **Artifact safety is a pure, tested gate.** `sanitizeSegment` refuses separators, `..`, `.`, drive-prefixed and NUL-bearing segments, and it guards BOTH the run id and each artifact name before `hostArtifactPath` joins them; `extractArtifacts` refuses a traversing run id *before* copying anything (asserted with zero copy calls), and the cumulative written size is checked against `sandbox.maxArtifactBytes` (new optional config field; code default 100 MB). The run-scoped directory is built by an explicit separator-aware join rather than string slicing, which the first draft got wrong.

**Consequences:**

- The capture path is exercisable offline: 5 mandated tests (bounded streaming, the cap with latest-kept, artifact extraction with `capture_runs` metadata, sanitisation, and the real-client `onLog` binding) run against a fake client and a minimal fake docker, with no daemon.
- A red run leaves a reproducible trail — timestamped logs plus a run-scoped artifact directory — which is exactly what P-181's provenance, P-183's SBOM and P-248's trace viewer need, and what P-176's flaky detection will diff.

---

## ADR-047: Sandbox Limits Parse Docker's Own Notation, Timeout and Abort Get Distinct Codes, and OOM-Kill Is Left Enabled

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-174 (`PHASES_DETAILED.md:8778-8821`) makes the sandbox enforce hard resource limits so a runaway merged repo cannot hang or starve the host. Its handoff names the goal precisely: "expose failures distinctly (timeout vs OOM vs abort) so P-163 can route them". Five things needed reconciling.

**Decisions:**

1. **`SANDBOX_TIMEOUT` (56) and `SANDBOX_ABORTED` (57) are new codes, and P-168's `run` ADOPTS them.** The handoff asks for distinct failures, but P-168 reported a wall-clock overrun as `DOCKER_ERROR` and an abort as the generic `ABORTED` (a P-140 loop code). Both are wrong for routing: a timeout is the runaway-build class that P-163 retries or fails distinctly, while `ABORTED` already means "the agent loop stopped". So `run`'s timeout path now returns `SANDBOX_TIMEOUT { timeoutMs }` and its abort paths `SANDBOX_ABORTED`, and `enforceTimeout` reports the same two codes — one vocabulary whichever layer catches the stop. P-168's two tests were updated with it; nothing else consumed those codes.
2. **`enforceTimeout` owns a clock, and container cleanup stays P-168's.** The phase says "on timeout, `client.kill(id)` + `client.rm(id)`", but `run` removes its container in a `finally` and never exposes a handle — so a wrapper holding an id could not be generic, and a second killer would race the first. The wrapper is therefore `(fn, timeoutMs, signal)` exactly as specified and returns the typed codes; the kill+remove is P-168's in-run guarantee. That the container really is gone is asserted end-to-end (a real `SandboxClient` over a fake docker, `removed === ['t1']`), not assumed.
3. **Limits parse Docker's own notation, and an unreadable value is a typed error.** `config.sandbox.limits` speaks Docker (`memory: '2g'`, `cpu: '1'`, `timeout: 600` **seconds**) while `ContainerSpec` wants bytes and cores. `parseMemoryToMb` (`2g`/`512m`/`1.5g`/`1024k`/bare-MB) and `parseCpuCount` (fractions allowed) are the conversion, and an invalid value returns `CONFIG_ERROR` rather than a silent `0` — a dropped limit would remove the very protection this phase exists to add. `defaultLimits(config)` consequently returns a `Result` (the spec sketched a bare return; the no-throw rule and the failure mode decide it).
4. **The spec's listed defaults lose to the config's actual defaults.** Step 1 lists `timeoutMs 300_000 … memMb 1536, cpuCount 2` but labels them "Defaults (config P-009)", and P-009's real schema is `limits: { memory: '2g', cpu: '1', timeout: 600 }` — i.e. **2048 MB, 1 core, 600 s**. Since the acceptance criterion says "Defaults from config", the config wins when supplied (600 s ⇒ `600_000` ms, with the seconds→ms conversion documented), and the step-1 numbers survive only as the no-config fallback (`DEFAULT_LIMITS`).
5. **`OomKillDisable` is deliberately NOT set.** The Files list says "client.ts (optionally set OOM)"; setting it would disable the OOM killer and let a runaway allocation starve the host — the exact failure class this phase prevents. The memory cap plus the daemon's default OOM-kill policy is the safe pair, and a test asserts the field is absent so the decision cannot drift silently.
6. **`strictLimits()` tightens only time/memory/CPU/network.** The log and artifact bounds stay P-173's constants (`DEFAULT_LOG_CAPACITY`, `DEFAULT_MAX_ARTIFACT_BYTES`) because they protect host memory rather than constrain the code under test; `limitsToCaptureOptions(cfg)` is the shared wiring that lets a `CaptureManager` be built straight from a profile (asserted: a 2-line profile really drops the third line).

**Consequences:**

- The profile is one mapping plus one clock, so it is entirely unit-testable, and the last test closes the loop — `applyLimits` output through the real client produces `HostConfig { Memory, NanoCpus, NetworkMode: 'none' }`, which is what the daemon actually receives.
- Timeouts and aborts are now distinguishable at the boundary, which is what P-163's error table and P-175's fallback decision both need.
- `defaultLimits` cannot silently drop a limit: a typo'd `sandbox.limits.memory` fails loudly at config-read time.

---

## ADR-048: The Fallback Adds `sandbox.mode` and an Optional `ci` Block, Renders a Committed Template, and Never Fabricates a Verdict

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-175 (`PHASES_DETAILED.md:8828-8872`) makes verification work when Docker is not: select a backend, run the build/test on GitHub Actions through the workflow P-100 already dispatches, and hand back the SAME `BuildResult`/`TestResult` the Docker path returns so no consumer can tell which ran. Four of its requirements needed a decision.

**Decisions:**

1. **`config.sandbox.mode` is a NEW optional field; the P-009 `backend` is not widened.** The spec wants `mode: 'auto' | 'docker' | 'github'`, but `SandboxBackendSchema` is `'docker' | 'github-actions'` and has no `auto`. Adding a member to that enum would force every existing consumer's `switch` to change; instead `mode` is additive and `fallbackSelection` prefers it, falling back to `backend` when unset — so an existing config keeps its meaning and the new knob is explicit about precedence. (One selector, two inputs, documented, rather than a silent reinterpretation of `backend`.)
2. **`config.ci.path` is a new OPTIONAL top-level `ci` block**, and its presence (together with resolved auth) is the GH path's "flag" that step 4 asks for. It is the only new top-level section, so `configJsonSchema.test.ts`'s pinned **`required`** list is unchanged — but its pinned **`properties`** list broke, which is the test doing its job; the expectation was updated with the reason recorded in the test itself.
3. **The workflow template is a committed FILE, and rendering takes its TEXT.** Reading `templates/github-build.yml` at runtime would break in a bundled `dist` (the same packaging problem ADR-042 recorded for build contexts), and duplicating it as a string constant would drift. So `renderWorkflow(template, values)` is pure and the production caller supplies the file it read (path from `config.ci.path`); tests read the real committed file. Substitution is strict, like P-141's prompt renderer: a missing value is a typed `CONFIG_ERROR` rather than a `{{placeholder}}` left in a dispatched workflow. The first draft wrapped placeholders in `${{ '…' }}`, which the test caught surviving into the output — a real defect in my own template, fixed rather than asserted around.
4. **A forced `docker` with no daemon falls back to a usable GitHub path; it is `unavailable` only when there is none.** Step 1 says a forced docker should "error if daemon down", but the acceptance criterion refines it to "…error only when no GH path" — and the acceptance wins, because refusing to verify when a working backend is configured would be the wrong failure. `auto` is unchanged: Docker first, GitHub second.
5. **An unfinished GitHub run is `SANDBOX_TIMEOUT`, never a verdict.** A run that has not completed has no `pass`/`fail` to report, and inventing one would feed a false result to the agent loop and the pipeline. Latency is documented as minutes-not-seconds (queue + cold runner + install), and the caller's `timeoutMs` is the poll budget.
6. **The GH test path REUSES P-172's `parseTestOutput`.** Counts and the failure list are produced by the same parser as the Docker path, so "identical shape" is enforced by construction rather than by convention — which is what the handoff demands. Only the log SOURCE differs (a fetched job log instead of a container stream).
7. **`runVerification` separates "no backend exists" from "the wiring is missing":** the former is `SANDBOX_UNAVAILABLE` (an environment state P-155 added for exactly this), the latter `CONFIG_ERROR` (a caller bug). A test asserts both, because collapsing them would send a user to fix their machine when the bug is in the call.

**Consequences:**

- The whole fallback is exercisable offline: the Octokit surface is P-100's own narrow `SandboxTriggerClient` (carried in `opts.github`, preserving the spec's four-argument signature), so the tests need no HTTP mock and no network.
- Both backends now provably return the same shape — asserted field-by-field for build AND test — which is the property every downstream consumer (agent tool, web panel, pipeline) depends on.

---

## ADR-049: The Flaky Check Takes a Re-Run Thunk, Off Means Off, and `pass` Comes From the First Attempt

**Status:** Accepted
**Date:** 2026-10-15

**Context:** P-176 (`PHASES_DETAILED.md:8879-8921`) turns a raw run into a VERDICT with a bounded repeat check, so a flaky test cannot make the agent loop forever on noise or let the pipeline ship a broken child. Its handoff then makes `Verdict.flaky` the field the loop (P-155) and the pipeline (P-238) read to decide whether to stop retrying.

**Decisions:**

1. **`checkFlaky` takes a re-run THUNK, not a client.** The spec's fifth parameter is `client`, but re-running means re-dispatching through P-175 — which is Docker *or* GitHub, chosen at call time — and the mandated tests are "fake runner with scripted outcomes". A `FlakyRunner = (attempt) => Promise<Result<RunOutcome, StitchError>>` is what keeps one code path for both backends and lets the tests script flips with no daemon and no network. Production passes `runVerification` itself.
2. **Off means off: only `enabled === true` enables repeats.** `config.sandbox.flakyCheck` is new and optional, and the default must be the cheap posture. My first version read `enabled === false` as the only off-switch, which silently made an UNSET config run three attempts — a real cost bug on the GitHub path (each attempt is minutes of runner time), caught by the `disabled by default` test. The guard is now `enabled !== true`.
3. **`pass` comes from the FIRST attempt; a lucky retry never turns a red base green.** The acceptance states it plainly ("failing base that passes on retry → `flaky:true, pass:false`"), and the asymmetry is deliberate: a passing base gets exactly ONE confirmation (cheap), while a failing base gets the caller's budget. Declaring success on a retry would hide the failure the retry just demonstrated.
4. **`assessVerdict` accepts a single run OR a sequence (additive), with three defined `stableSince` values.** The spec sketches one run, but the multi-attempt rule then has no home and would be written twice. Widening the parameter is backward compatible for the single-run call, and `stableSince` becomes precise: `'first'` when every attempt passed, `'last'` when only the final one did, `'none'` when the final one failed.
5. **The Verdict rides on the result via an intersection type, not by mutating the frozen shapes.** P-171's handoff froze `BuildResult` for the web panel (P-220); so `runVerification` returns `VerifiedRun = (BuildResult | TestResult) & { verdict?: Verdict }` and the raw `runBuild`/`runTests` stay untouched.
6. **`repeat` is clamped to 0..{@link MAX_FLAKY_REPEAT} (3), default 2.** The phase handoff says "keep `repeat` small (1–3) to bound cost/latency" and P-175's handoff notes a GH attempt costs minutes, so the bound is enforced in `resolveRepeat` rather than trusted from the caller (`repeat: 99` yields 3).
7. **Warnings live on the Verdict.** The UI (P-220) needs the flaky-file hint, and the spec's `Verdict` return type is one value, so `Verdict.warnings?` is additive: `flakySameFileSeen` names files that failed in *some* attempts (a file failing in all of them is broken, not flaky), and a line diff between attempts flags a likely timing dependence.

**Consequences:**

- The verdict layer is pure plus one injected thunk, so all six mandated scenarios run in milliseconds: a clean pass, a green-to-red flip (flaky but still a pass), a red-to-green retry (flaky and still NOT a pass), the repeat bound, the default-off posture, and the flaky-file warning.
- `Verdict.flaky` is now a real signal for P-155/P-238 to stop retrying on noise, and it is produced by the same code whichever backend ran.

---

## ADR-050: Cleanup Is a Tracker Sweep That Returns a Summary, Removes Ephemeral Images Only, and Reuses the Client's Existing Removal Guarantee

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-177 (`PHASES_DETAILED.md:8928-8968`) closes the Sandbox epic by making removal of every container, image, volume, network and temp dir a structural guarantee on every exit path. Its step 3 sketches `try { ...run } finally { await cleanupSandbox(...) }`, its step 2 mandates that only `stitch-ephemeral-` tagged images be pruned, and its acceptance requires that cleanup errors "degrade to warnings (don't throw/abort the run)". The Context also warns this phase must UNIFY existing cleanup rather than duplicate it: P-168's `SandboxClient.run` already force-removes its own container in a `finally` (asserted on timeout/abort/start-failure), `rm` never throws, and P-169's `EPHEMERAL_PREFIX`/`isEphemeralTag` are the existing prune marker.

**Decisions:**

1. **`cleanup(client)` returns a `CleanupSummary`, not the sketch's `Promise<void[]>`.** The acceptance needs three distinct facts the sketch's type cannot carry: what was removed (`removed`), what could not be (`errors`, each a warning), and the deliberate NON-removals (`preservedImages`) plus an opt-in prune count (`prunedImages`). A bare `void[]` would force callers to infer failure from length, and there would be nowhere to report a preserved image at all. The spec's own acceptance ("non-ephemeral preserved", "summary logged") is what fixes the shape; `cleanupSandbox` is still `Promise`-based and still never rejects.
2. **The tracker, not a daemon query, decides what is ephemeral.** "Prune only those with the `stitch-ephemeral-` tag" is answered by `isEphemeralTag(resource.id)` over the resources the run itself took responsibility for — no `listImages()`/`inspect` round-trip. This is also why it is conservative in the right direction: an image the tracker holds that is NOT ephemeral-tagged (a pulled pinned base) is reported in `preservedImages` and kept, because it is reused by the next run and is not ours to delete.
3. **`track` is idempotent per `(kind, id)`.** A retry that registers the same container twice must not attempt two removals: the second would fail against an already-gone resource and surface as noise in the summary's `errors`. Tracking returns `false` for a duplicate rather than silently double-adding.
4. **The P-168 `SandboxClient` gains `removeImage`/`removeVolume`/`removeNetwork`/`pruneImages` (plus the `DockerLike` handles `getImage`/`getVolume`/`getNetwork`/`pruneImages`), even though the phase's Files list names only `cleanup.ts` and `runner.ts`.** The acceptance cannot be met with `rm` alone, and the established precedent from P-169 (`buildImage`) and P-171 (`copyFrom`) is that a later phase extends the client with the capability it needs rather than reaching around it. Extending the `DockerLike` seam (verified against `@types/dockerode@4.0.1` first: `getImage`/`getVolume`/`getNetwork`/`pruneImages` all exist) is what forced the three existing test fakes to add the four members — a compile-time cost paid once, and evidence the seam is real rather than a cast. Every new method returns `Result`; `rm` keeps its signature because its never-throws contract is already load-bearing in `run`'s `finally`.
5. **`pruneImages` is opt-in and default `false`.** A daemon-wide prune deletes images repo-stitcher never created, including a developer's cached dev images — the spec says "kept conservative to avoid nuking cached dev images" — so `config.sandbox.pruneImages` (new, optional) is the only gate, added to `SandboxConfigSchema` as a nested key, which leaves the pinned top-level `jsonSchema` expectations untouched.
6. **No new `StitchError` code was needed, and that is the notable part.** Unlike P-169/P-170/P-174 (six coordinated edits per code), cleanup maps onto existing codes: `DOCKER_ERROR` for a failed removal, `CONFIG_ERROR` for an empty ref, and `INTERNAL` for the one case where a body THROWS. `withCleanup` converts a throwing body into `err({code:'INTERNAL'})` rather than letting it escape, preserving the no-throw rule for callers who supplied a possibly-throwing body.
7. **A missing client capability is reported, never pretended away.** When the client cannot remove a kind (`removeImage === undefined`) or no client is supplied at all, the resource lands in `errors` with an explanatory message. Silently dropping it would report a false "clean". Container removal via `rm` remains the one capability assumed of any client, because P-168's `rm` is the already-shipped, never-throwing primitive.
8. **`cleanupSandbox` orders removals containers → images → volumes → networks → temp dirs.** Containers are force-removed first because they hold volumes and networks open; a later sweep of a volume still mounted would fail for a reason unrelated to the volume.
9. **Runner wiring keeps the tracker OPTIONAL, so the `finally` guarantee is additive.** `runVerification` now wraps its whole dispatch (including P-176's flaky repeats) in `withCleanup` **only when `opts.cleanup.tracker` is supplied**; with no tracker the behaviour is byte-for-byte the P-176 path, and the per-run container removal P-168 already performs inside `run` still applies. Making a tracker mandatory would have invented an owner for resources this phase does not create — P-171's `artifactTarget`/`buildoutDir` are CALLER-owned host dirs, and deleting them would destroy the caller's captured artifacts. The tracker is how a caller says "this one is mine to remove", so `tempDir` removal stays scoped to what was tracked.
10. **The summary sink is an injected `onSummary`, not a direct audit-log call.** Step 4 says "log … to the audit log (P-145) + tracing (P-248)"; neither is reachable from `sandbox/` — `ai/audit.ts` is AI-call specific and P-248 does not exist yet. An `onSummary` callback lets both wire in later without this phase importing a layer it does not own, and it is what makes the `logs summary` test assert a real call rather than a spy on a global.

**Consequences:**

- The `finally` guarantee is now testable through the REAL dispatcher: a `runVerification` call whose selection resolves to nothing still sweeps a tracked temp dir on the failure path.
- The Sandbox epic (P-168–P-177) is complete; cleanup is the safety backstop, and "own what you created" is expressed as the tracker rather than a broad prune.
- Three existing test fakes (`capture.test.ts`, `client.test.ts`, `limits.test.ts`) had to grow four members — the seam change is compiler-enforced, so no fake can silently omit cleanup support.

---

## ADR-051: The Cache Key Refuses to Be Silently Weakened, Its Full-Tree Walk Must Ignore Install Output, and a Broken Cache Never Fails a Run

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-178 (`PHASES_DETAILED.md:8975-9015`) stops re-pulling images and re-installing deps on repeat runs by keying the install layer on the ecosystem's content. Its step 1 sketches `cacheKey(ecosystem, repoPath, { includeLock, includeFiles? }): Promise<string>` and cites "P-186 checksum helper"; step 2 sketches `class SandboxCache` over a `bun:sqlite` table `sandbox_cache (cache_key TEXT PK, kind, created_at, meta JSON)` with `get(...)`/`put(...)` returning bare promises; steps 3–6 wire it into `install.ts`, `runner.ts`, log hit/miss "to tracing (P-248)", and export from the barrel. Its acceptance demands a key that is stable for the same content and changes with the lockfile/manifest, a hit that skips the reinstall, a miss that installs and records, an `includeFiles` gate, CLI eviction (P-190, a LATER phase), and logged hits/misses.

**Decisions:**

1. **P-186's "checksum helper" does not exist, so the hashing is local.** P-186 is a later phase; grep found only forward references to it (`git/blameMap.ts:2`, `git/binary.ts:3`) and no reusable checksum export. Importing it would have been a phantom API, so `cacheKey` hashes with `node:crypto` itself — the same private-`sha256` choice `license/generate.ts` makes. This is the anti-hallucination rule applied to a *citation inside a phase spec*: a named helper is not evidence it exists.
2. **`get`/`put` return `Result`, not the sketch's bare promises.** The house rule is that every core public API speaks `neverthrow` (`Result`/`ResultAsync`), and the caller genuinely needs to distinguish "no entry" from "the store failed" — the install path treats the first as a miss and the second as a degraded cold install. `clear`/`entries` follow the same shape.
3. **`includeFiles: true` is REFUSED (`CONFIG_ERROR`) when `config.sandbox.cacheKeyFullTree` is off — never silently downgraded.** A downgraded key is not a cost saving, it is a *stale-hit* bug: the key would stop describing what the caller asked it to describe, and old entries would keep matching content they no longer cover. `includeFiles: string[]` (a caller-bounded shortlist) needs no gate. This mirrors P-141/P-175's strict-substitution rule — an unhonourable request is a typed error, not a quiet fallback.
4. **A full-tree walk MUST ignore install/build output — {@link FULL_TREE_IGNORES} is load-bearing, not cosmetic.** `node_modules`, `target`, `dist`, `.venv`, `__pycache__`, `vendor`, `.cache`, `.git` are the *outputs* of the very step the key describes. Include any of them and the install changes the key that is supposed to describe the install's input, so the cache would MISS ON EVERY RUN — a permanent, silent no-op. `cache.test.ts` pins this with `it('ignores install output in a full-tree key')`, which writes `node_modules/` and `target/` and asserts the key does not move.
5. **The lockfile is IN the key by default; `includeLock: false` is the opt-out.** Acceptance is absolute ("Key includes lockfile hash"), so the default cannot be `false`; the opt-out exists for a caller that deliberately wants a manifest-only key. A file that is legitimately absent contributes a stable `-` marker rather than an error, because a python workspace with no `pyproject.toml` is valid — and a missing file must not make the key unstable across runs.
6. **The key is version-prefixed and order-independent.** `CACHE_KEY_VERSION` (`v1`) is the first input, and file names are sorted before hashing, so the digest never depends on iteration order and a future format change invalidates every entry at once rather than silently comparing incomparable keys.
7. **`kind` carries the ecosystem; `created_at` comes from an INJECTED clock.** The table's `kind` column is the ecosystem, so an entry is identifiable without parsing JSON, and `meta` holds only what is left (`imageTag`, `command`). `SandboxCacheOptions.now` exists so P-178's tests can assert exact timestamps instead of matching a pattern.
8. **No new `StitchError` code was needed — again.** `CONFIG_ERROR` covers a blank path, an unknown ecosystem and the refused full-tree ask; `INTERNAL` covers file IO and sqlite (which `dbAll`/`dbGet`/`dbRun` already map that way). P-177 and P-178 are consecutive phases that skip the six-edit error-code ritual, which is the point: the ritual is for genuinely new failure modes, not for every phase.
9. **A broken cache NEVER fails a run.** A failed read is emitted as `read-failed` and degrades to a miss; a failed write is emitted as `write-failed` and the install still returns `ok`. A cache is an optimization — failing a verification because the store hiccuped would be strictly worse than a cold run. `cache.test.ts` proves it with a `DbLike` whose `query` throws: the install still runs and still succeeds.
10. **`install.ts` computes the key once and reuses it.** `get` returns the resolved `cacheKey`, which is passed to `put` via `CacheAccessOptions.cacheKey`, so the workspace is hashed once per install call rather than twice. On a hit the install returns `cached: true, installed: false, command: '(cached)'` and creates **no container at all** — the phase's "hit skips install", asserted by counting the fake client's calls.
11. **The runner attaches the cache by resolving the run IMAGE from it, and only when the caller passed no `image`.** The dispatcher runs build/test, not install, so there is no install to skip there; tying the cache to the image the run uses is the honest, non-hollow wiring (the install and the build run in the same image). It is resolved ONCE before the body so P-176's repeats reuse the same tag, and a cache error is deliberately not a run error.
12. **`clear()` is programmatic; `sandbox cache clear` is P-190's CLI.** P-190 does not exist, so the acceptance's "evictable via CLI" is met by `SandboxCache.clear()` and asserted in `cache.test.ts` — the same arrangement P-169 and P-173 used for their later CLI surfaces.
13. **The `onEvent` sink is the P-248 seam.** Step 5 says "log hit/miss to tracing (P-248)"; P-248 does not exist, so hit/miss/read-failed/write-failed are delivered to an injected sink — P-177's `onSummary` precedent.
14. **`sandbox_cache` is created on first use; `store/schema.ts` is untouched.** Its header reserves migration slots for `P-181/187/230/239/241/303/309`, so P-178 owns its table the way P-169 (`sandbox_images`) and P-173 (`capture_runs`) do. Without a `DbLike` the class falls back to a module-level in-memory map (with `clearCacheForTests`) — the same dual arrangement `images.ts` uses.

**Consequences:**

- The acceptance is honest about one inherent property of content-keyed caching, and it is worth stating explicitly: P-170's install writes into the **bind-mounted workspace**, so a hit asserts *content identity* (the lockfile/manifest are unchanged) rather than re-verifying that the workspace still holds its dependencies. If a caller deletes the workspace's `node_modules` while leaving `package.json`/`bun.lock` byte-identical, a hit would skip an install it should have re-run; `SandboxCache.clear()` is the documented escape hatch, and the key itself cannot observe that case by construction.
- Eleven tests (six spec-named) cover the key's stability/invalidation, the gate and its refusal, the ignore-list trap, hit-skips-install, miss-installs-and-records, eviction, the event sink, the `restoreCache`/`saveCache` round-trip, the broken-cache degradation, and the runner's cached-image wiring.
- The Sandbox epic's cache step is now in place ahead of P-179 (secret-safe sandbox), whose handoff notes that caching the install layer is safe because it holds no secrets — which is only true because the key derives from manifests and never from env.

---

## ADR-052: The Key Test Is Deliberately Wider Than the Spec, the Text Test Is Deliberately Narrower, and `scrubSecrets`'s Pass Order Is Load-Bearing

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-179 (`PHASES_DETAILED.md:9022-9063`) makes the sandbox secret-safe: the container must never see a host secret, captured text must not carry one, and a suspicious artifact name must warn. Its step 1 mandates `isSecretKey(name)` matching `/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|API_TOKEN|AUTH|CREDENTIAL|PRIVATE)/i` "and `*_KEY`"; step 2 mandates `safeEnv(rawEnv, policy): Record<string,string>` with `block` (default) / `mask` / `allow-list`; step 3 mandates `scrubSecrets(text, knownKeys=[])` replacing in-scope secret values with `[REDACTED]` "using the logger's redact list, P-010"; step 4 wires `client.run` and `capture`; step 5 forbids passing host env wholesale.

**Decisions:**

1. **`packages/core/src/log/` does not exist — the logger is `src/logger/` and its redact list is `redactPaths`.** Verified by glob + read before any import was written. `redact.ts` builds `redactPaths` from `SENSITIVE_FIELDS` plus `LITERAL_PATHS`, which **already contains `sandbox.env.*`** — so the declaration this phase enforces was already in the codebase. A phase's citation of a helper is not evidence the path exists; reading it is.
2. **`isSecretKey` is a SUPERSET of the mandated regex: regex ∪ P-010's `redactPaths` leaf fields ∪ `/_KEY$/i`.** The mandated regex does **not** match `cookie`, which `SENSITIVE_FIELDS` does list (proved in a test: `SECRET_KEY_PATTERN.test('cookie') === false` while `isSecretKey('cookie') === true`). Widening a secret test is the fail-safe direction — dropping one non-secret env var is harmless, leaking one is not — and it is literally what "using the logger's redact list" asks for. `it('covers every logger redact field')` asserts the superset property, so the two lists cannot silently diverge again.
3. **A SECOND, narrower test — `isSecretToken` — exists for text, because the mandated regex matches `monkey`.** `KEY` is a substring of `monkey`, so an unbounded regex applied to prose would redact `monkey: business`; the same is true of `authenticate` and `auth`. For env vars that over-match is harmless; for the log text an operator is reading to debug a failure it is destructive. `isSecretToken` splits on separators *and* camelCase and matches whole WORDS, which keeps `API_KEY`, `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY` and `privateKey` while leaving prose alone. The asymmetry is intentional, documented at both definitions, and pinned by a test asserting `isSecretKey('monkey') === true` **and** `isSecretToken('monkey') === false`.
4. **`safeEnv` keeps the mandated `Record<string,string>` return, and `safeEnvPlan` carries the rest.** The spec's return type cannot express `mask`: the value must still be INJECTED while its log rendering shows `****`, so the caller needs both "what to pass" and "what to scrub". `safeEnv` stays a thin projection (`plan.env`) so the mandated signature is honoured literally, and `client.run` uses the plan. Additive, not a reinterpretation — the same widening P-176 applied to `assessVerdict`.
5. **`allow-list` with no list passes NOTHING.** `opts.allowedEnv ?? []` means an absent allow-list is empty rather than "allow everything". A missing allow-list silently becoming a full bypass would be the worst possible default for a security control.
6. **`scrubSecrets`'s pass order is load-bearing, and the phase's own test caught a real leak.** The order is: (1) known literal values longest-first, (2) credential SHAPES via `redactAuditText`, (3) secret-keyed `KEY=value` pairs. My first implementation ran the key/value pass BEFORE the shape pass, and `Authorization: Bearer abcdefgh1234` came out as `Authorization[REDACTED] abcdefgh1234` — the scheme word was redacted and **the token itself was left in the text**. Running the shape pass first consumes `Bearer <token>` as a unit. Pass 3 additionally folds an optional scheme prefix (`Bearer|Basic|Digest|Token`) into its own redaction, so the same defect cannot recur if a shape pattern is ever narrowed. This is the third phase in a row where the mandated test suite found a defect in my own first implementation rather than confirming it.
7. **P-145's `redactAuditText` is reused for shapes rather than a second copy of `SECRET_PATTERNS`.** A parallel, divergent secret list is precisely the drift this phase exists to prevent. `ai/audit.ts` imports only `node:crypto`, `logger`, `result` and `ai/types` — no path back to `sandbox` — and `bun run lint:deps` confirms **no dependency violations (171 modules, 463 dependencies)**, i.e. no cycle was introduced. That check was run, not assumed.
8. **No new `StitchError` code was needed.** A dropped variable is a policy outcome, not a failure; there is no new way for a run to fail. This is the third consecutive phase (P-177, P-178, P-179) in which the six-edit error-code ritual did not apply.
9. **`SecretScanWarning` is a WARNING VALUE, not an `StitchError` variant.** A suspicious artifact NAME must never fail a capture that otherwise succeeded, and `extractArtifacts` keeps its `Result<string[], StitchError>` signature — the warning is delivered through an injected `CaptureOptions.onWarning`, the P-177 `onSummary` / P-178 `onEvent` pattern.
10. **The capture buffer scrubs at INGRESS.** `append()` scrubs before the line enters the ring buffer, so no unscrubbed text is ever retained, returned by `logs()`, written to `entries()`, or persisted. An egress scrub would have to be remembered at every reader; an ingress scrub cannot be forgotten. Per-run secret values are added via `bindRun(runId, secrets)` and never leak between runs.
11. **Artifact content scanning is opt-in AND bounded (64 KiB prefix).** `config.sandbox.secretScanArtifacts` defaults off, and when on it reads only a prefix — artifacts can be 100 MB tars, and a secret-scan that read them whole would turn a safety feature into a memory hazard. A test proves the bound is honoured (a secret past `maxBytes` is not found).
12. **A warning's `excerpt` is masked.** A secret-scan warning that quoted the secret would BE the leak it reports; `maskExcerpt` keeps four characters and appends `[REDACTED]`, asserted for both the name and the content paths.
13. **The two named config keys did not exist and are added as OPTIONAL nested keys.** `sandbox.allowedEnv` (a string array) and `sandbox.secretScanArtifacts` (a boolean) — both absent from `SandboxConfigSchema` before this phase. Nested optional keys leave the pinned top-level `jsonSchema` expectations untouched, as P-175 and P-178 already established.
14. **The client never reads `process.env`, and never mutates the caller's spec.** `run` builds `safeEnvPlan(spec.env ?? {})` and, only when the caller supplied env, constructs a NEW spec (`{ ...spec, env: plan.env }`) — so `Env` stays absent for callers that pass none, and the caller's object is untouched. "Host env never passed wholesale" is therefore structural: `spec.env` is the only source, and it is filtered on the way in and scrubbed on the way out.

**Consequences:**

- Eleven tests (six spec-named) cover env blocking, masking, the allow-list (including the empty-list case), log scrubbing, the logger-coverage drift guard, the client's env filter and log scrub, ingress scrubbing in capture, the artifact-name warning (unit + wired), the opt-in bounded content scan, and typed errors from `scanArtifactFile`.
- Secret-safety is now a property of the sandbox rather than a convention: a caller cannot pass host env through, because there is no code path that would let it.

---

## ADR-053: The Coverage Gate Uses the Repo's vitest Form (Not `bun test`), the Fake Exposes `kill` While the Seam Deliberately Does Not, and Measured Behaviour Beat My Guess

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-180 (`PHASES_DETAILED.md:9070-9108`) closes the Sandbox epic (P-168–P-179) by consolidating its tests behind fakes plus a Docker-gated integration suite, adding a coverage gate, and verifying the full offline sequence (availability → image → install → build → test → capture → limits → fallback → verdict → cleanup → cache → secrets). It mandates `sandbox/__tests__/fake-docker.ts`, two suites, a `test:sandbox` script equal to `bun test src/sandbox --coverage` with a "≥80% line / 70% branch gate", and the test names `it('runs full sandbox flow with fake')`, `it('covers each module')`, `it('docker integration (gated)')`, `it('coverage gate')`.

**Decisions:**

1. **The mandated command `bun test src/sandbox --coverage` cannot run in this repo, so `test:sandbox` uses the vitest form the repo already ships four times over.** `bun test` is rejected by Bun's native runner (the `bunfig.toml` `preload` is not supported), and `test:license`, `test:ai`, `test:agent:e2e` and `test:deps-fix` all already read `bunx vitest run <dir> --coverage --coverage.include=… --coverage.exclude=… --coverage.thresholds.*`. `test:sandbox` mirrors that exactly, so it inherits a proven working shape instead of introducing a second, broken one. The mandated **thresholds are honoured verbatim** — 80 statements / 70 branches / 80 functions / 80 lines — and the gate also excludes `**/__tests__/**` and `**/*.test.ts` so test code cannot inflate its own coverage.
2. **`kill` is exposed by the FAKE but deliberately NOT added to the production seam.** Step 1 lists `ping/create/start/logs/wait/remove/kill/copyFrom`, but `ContainerLike` (read: `client.ts:84-99`) declares start/wait/logs/remove/stats/inspect/getArchive/followLogs — **there is no `kill`**. Adding one to satisfy the phase's prose would be a phantom method invented to match a naming list, and the client's real guarantee is the opposite: it force-REMOVES in a `finally` rather than killing and abandoning a corpse. So `FakeContainer` (the fake's own type) adds `kill()` — recorded in `killed` and callable — while `ContainerLike` is untouched, and the flow test asserts force-removal, which is what actually happens.
3. **This phase CONSOLIDATES; it does not re-test what thirteen suites already own.** `client/images/install/build/test/capture/limits/cache/secrets/verdict/cleanup/fallback/runner` each already have a module suite. P-180 therefore adds three things they cannot provide: a shared harness (`fake-docker.ts`), a single cross-module FLOW test, and a per-module smoke. `fallback.test.ts` keeps ownership of `runViaGitHubActions`' happy path rather than having it duplicated here.
4. **The nested `__tests__/` directory really is collected — verified by RUNNING the suite.** `vitest.config.ts` includes `['src/**/*.{test,spec}.ts', 'src/**/*.suite.ts']`; reading that glob *suggests* nested matches, but a glob is not evidence, so the suite was executed and its counts confirmed (`16 passed | 1 skipped`). This is the phase's own stated watch point ("verify by running it, not by reading the glob").
5. **The fakes implement the SEAMS, never the class** (ADR-030). `SandboxClient` has `#private` fields and is nominally typed, so `FakeDockerode implements DockerLike` and `FakeOctokit implements SandboxTriggerClient` structurally. The harness also obeys the production rules: **nothing throws**, failures are SCRIPTED (`failStart`, `failWait`, `hangUntilAborted`, `failPull`, `failBuild`, `failPing`) so a test asserts the client's typed mapping (`DOCKER_ERROR`, `SANDBOX_TIMEOUT`, `SANDBOX_ABORTED`) rather than catching an exception from the harness, and `makeRunClient` returns `err(...)` — **no casts, no `any`**, same as production.
6. **The fake Octokit is a real implementation, because the seam is only four methods.** Reading `SandboxTriggerClient` → `SandboxReposEndpoint` + `ActionsRunsEndpoint` showed exactly `createDispatchEvent`, `createWorkflowDispatch`, `listWorkflowRunsForRepo`, `getWorkflowRun`. With a correlated run (`head_sha` matching the dispatched sha, `status: 'completed'`, `conclusion: 'success'`) the same fake drives `runViaGitHubActions` to a genuine `pass: true, exitCode: 0` — **offline, with no network** — which is the "Fallback uses fake Octokit" acceptance met by execution rather than by assertion about a mock.
7. **A guess of mine was corrected by measurement, and the measured value is what shipped.** I asserted the dispatched-but-uncorrelated GitHub path returned `SANDBOX_UNAVAILABLE`; the running test showed **`GITHUB_API_ERROR`**. The assertion now pins the observed code, with a comment recording that it was measured — and the property the phase actually cares about is preserved either way: **a dispatch with nothing to correlate is a typed error, never a manufactured verdict**.
8. **`process.env.DOCKER` gates the integration suite via `describe.skipIf`, normalised to `1`/`true`.** The phase writes `!process.env.DOCKER`; with bare truthiness the string `"0"` would ENABLE a Docker suite, which is the opposite of what someone typing `DOCKER=0` means. No gate convention existed anywhere in `packages/core/src` before this phase, so the header comment in `sandbox.docker.test.ts` is its documentation. Offline, the block is reported **skipped**, so `bun run test` stays green with no daemon.
9. **`it('coverage gate')` asserts the gate EXISTS, not that coverage passed.** It reads `package.json` and pins the `test:sandbox` shape — vitest, `--coverage`, all four thresholds, and both excludes. A test that merely re-ran the coverage tool would duplicate the script; this one fails the moment someone deletes a threshold, which is the silent way a quality gate dies.
10. **The Docker suite reports only what the seam can verify.** `docker-integration.ts` returns `{exitCode, stdout, stderr}` and makes **no claim about removal**, because `ContainerLike` exposes no "does this container still exist?" call — asserting it would mean inventing seam capability production does not have. Removal is asserted where it IS observable: `FakeDockerode.removed` in the unit flow. The integration run pulls first, then runs `node:22-alpine` `echo` with `networkDisabled` for the workload itself.

**Consequences:**

- **The gate was executed, not assumed:** `bun run test:sandbox` exits **0** with **87.57% statements / 78.73% branches / 82.51% functions / 91.47% lines**, all above the 80/70/80/80 thresholds.
- Full gate: typecheck 0, lint 0, **depcruise 0 violations (173 modules, 464 dependencies)**, build 0, and **175 passed | 1 skipped** files (**2119 passed | 1 skipped** tests) — the single skip being the Docker gate, exactly as designed.
- The harness is the reusable piece the handoff promises for P-167's agent E2E and the pipeline tests: a scripted daemon, a scripted Octokit, and an in-memory `DbLike`, with no daemon, no network and no container start.
- **Epic 8 (Sandbox, P-168–P-180) is CLOSED.** P-181 opens Epic 9 (Provenance).

---

## ADR-054: `MergeManifest` Does Not Exist (So the Input Is P-079's `BlameMap`), the v1 `provenance` Table Is Reused, and the Phase's Own Tests Corrected Two of My Assumptions

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-181 (`PHASES_DETAILED.md:9115-9158`) opens Epic 9 by making every file in child repo C traceable to its source repo, commit and author. It names `prov-buildProvenanceMap(ctx, mergedFiles: MergeManifest)`, a `provenance` sqlite table, a `provenance.recordEmail` config key "(P-009)", and a modification to `agent/gitFacade.ts` to "emit origin at commit (P-165)". Its five required tests are `attributes A file to A commit`, `marks agent edits`, `maps teleported path`, `flags unattributed`, `persists and queries`, against "two fixture git repos merged".

**Decisions:**

1. **`MergeManifest` does not exist, so the parameter became P-079's real `BlameMap`.** `grep Manifest packages/core/src` returns `ParsedManifest`/`UnifiedManifest`/`MergeResult` and nothing named `MergeManifest`. Rather than invent a type, the input is `BlameMap | readonly BlameMap[]` — an additive union because "two fixture git repos merged" means TWO blame maps, one per source (the same widening P-176 applied to `assessVerdict`). The reconciliation also made the module BETTER than the spec's sketch: the phase wanted P-079's output and P-079 already produces exactly it.
2. **`provenance.recordEmail` does not exist, and no `config` key was added.** `grep recordEmail` finds nothing and `config/schema.ts` has no `provenance` block at all, so the handoff's "P-009 `provenance.recordEmail`" is a phantom key. `recordEmail` is therefore an OPTION (`ProvenanceOptions.recordEmail`, default **false**) rather than a config field — which is also the right scope, since a config block is not in this phase's `Files to Create/Modify` list. Default OFF is the PII-safe posture: attribution is the purpose, harvesting contributor addresses by default is not.
3. **The `provenance` table already exists in migration v1 and is REUSED, not recreated.** `store/schema.ts:84-90` defines `provenance (id, repo, commit_sha, payload, created_at)`. Unlike P-169/P-173/P-178 — each of which had to own a table created on first use — this phase writes `repo` and `commit_sha` as first-class columns with the whole `FileOrigin` as `payload`, and creates no second table. Because v1 gives no per-file uniqueness, `save` APPENDS one row per file and `load` takes the newest row per file; the accumulation is not merely tolerated, it is an attribution audit trail, and the final test proves a correction wins without destroying the other file's entry.
4. **`agent/gitFacade.ts` was deliberately NOT modified, because its half was already done.** `commitStage` already calls `withOriginTrailer(message, opts.origin)`, and `parseOriginTrailer` is already exported — and its docstring literally says `(P-181 seam)`. So the phase's "emit origin at commit (P-165)" is satisfied by existing code; P-181 is the CONSUMER. This is a documented deviation from the phase's file list, taken deliberately because editing a file that already implements the requirement would be churn. The test proves the seam end-to-end by parsing a real trailer through `parseOriginTrailer` rather than hand-building the object.
5. **`FileOrigin.repo` is widened to `'A' | 'B' | 'unknown'`; `sourceCommit` stays a required `string` with an explicit `UNKNOWN_COMMIT` (`''`).** The spec's own step 5 requires the `'unknown'` fallback for unattributable files, so the field cannot be the two-member union it declares. Keeping `sourceCommit` required (rather than optional) preserves the declared shape while making "we could not tell" a visible value accompanied by a `ProvenanceWarning` — never a missing property a consumer might read as zero-risk.
6. **Attribution composes the two substrates by role: the trailer says what the merge RECORDED, blame says what git can PROVE.** `repo`, `sourcePath` and `stitchedBy` come from P-165's `Stitch-Origin`; `sourceCommit`, `sourceAuthor` and `sourceEmail` come from P-079's dominant line-origin. An agent trailer (`source: 'agent'`, or `op: 'component'`) marks `stitchedBy: 'agent'` while still recording the commit derived from — exactly the acceptance's "agent-edited … with source derivation".
7. **The dominant origin is the line-block covering the most lines, ties broken by earliest `startLine`.** Deterministic (P-282), so the same tree always yields the same attribution. **This rule was validated by measurement, not assumption:** my first version of the last test changed only line 2, leaving line 1 attributed to the previous commit, and the rule correctly reported the OLDER commit. The test was wrong, not the code — it now rewrites the whole file, and the comment records why.
8. **A source with no teleport `prefix` cannot be resolved without its `tipSha` — discovered by a failing test.** B's file blamed to `'unknown'` until the fixture supplied real tip SHAs; A had appeared to work only because its path matched the teleport prefix. That is P-079's real contract (`tipSha` = "merged tip SHA for ancestry attribution"), so the fixture now builds `SOURCES` inside `beforeAll`, after the repos have committed — the only point at which a tip SHA exists.
9. **Unattributable files produce a WARNING VALUE with three distinct reasons** — `no-line-origins`, `uncommitted` (all-zero blame), and `unknown-source` (a real commit no source claims) — and the map RETAINS them (`warnings()`) so P-182 can render "unattributed". A warning is not a `StitchError`: it must never fail a build that otherwise succeeded (the P-179 `SecretScanWarning` precedent). Notably, `unknown-source` still reports the commit it DID find, because "we know the commit but not the repo" is more useful than a blank.
10. **No new `StitchError` code — and this module constructs none at all.** Persistence and reads propagate `store/schema.ts`'s `INTERNAL`; the only other outcomes are warnings. P-181 is the fourth consecutive phase (P-177 → P-181) in which the six-edit error-code ritual did not apply.
11. **The `git/blameMap.js` and `agent/gitFacade.js` imports are type-only**, so the new `provenance → {git, agent}` edges add no runtime dependency and cannot form a cycle; `bun run lint:deps` was RUN to prove it (**0 violations, 175 modules, 467 dependencies**).

**Consequences:**

- Five tests (all spec-named) run against **real git repositories** — `makeTempRepo`/`commitFiles`/`headSha` — and assert against the REAL commit SHAs those repos produced, including a teleported path (`repo-a/lib/util.ts` → sourcePath `lib/util.ts`), an agent trailer parsed by P-165's own parser, all three unattributed reasons, and a sqlite round trip whose correction path is verified.
- `ProvenanceMap.getOrigin` is the single documented query path for P-182 (CREDITS), P-183 (SBOM), P-185 (UI) and P-124 (per-file license).
- Full gate: typecheck 0, lint 0, depcruise 0, build 0, **176 passed | 1 skipped** files / **2124 passed | 1 skipped** tests.

---

## ADR-055: CREDITS Gets a Target Because the Acceptance Demands Both, Its Timestamp Comes From the Map Because "Stable" and "Generated Now" Cannot Both Be True, and the PII Rule Is a Scrub Rather Than a Template Convention

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-182 (`PHASES_DETAILED.md:9165-9207`) renders P-181's `ProvenanceMap` into a human-readable `CREDITS.md`: grouped by repo then `remoteUrl`, a fixed table `| File in C | Source Commit | Author |`, a `## Unattributed` section, a `## Notes` section for agent-stitched files, sorted by repo then path. Step 3 writes to `<repoC>/CREDITS.md` "and return[s] the content string too"; the acceptance repeats both, and separately demands "Output stable across runs (same map → same text)".

**Decisions:**

1. **`CreditsOptions` gains `repoC`, because accepting the declared shape alone would fail the acceptance.** The declared options are `{repoNameA?, repoNameB?, includeEmails?, header?}` — with no target — yet step 3 must write a file AND the acceptance requires the content "returned as string". Adding one optional `repoC` satisfies both with one function: absent ⇒ render-only (the pure path tests and the P-185/P-222 previews use), present ⇒ write-then-return. A separate `writeCredits` would have duplicated the renderer.
2. **The header timestamp defaults to the LATEST `copiedAt` already in the map, not the wall clock.** "Title + generated timestamp" and "same map → same text" are mutually exclusive if the stamp is `Date.now()`: two renders a second apart differ, and CI diffs plus the web preview would never be stable. Deriving the stamp from P-181's own data makes it simultaneously a real "provenance as of" marker and deterministic BY CONSTRUCTION. `now?` still overrides it for a true generation stamp, documented as breaking stability — so the trade is explicit and opt-in rather than accidental.
3. **The table stays exactly three columns, and `sourcePath` rides in the first cell only when it differs.** The handoff is explicit that "web P-222 CREDITS preview and CI checks parse it", so a fourth (or conditional) column would break consumers. A teleported file therefore renders as `` `repo-a/app.ts` (from `app.ts`) `` — the C path leads, so a parser keying on the leading backticked token is unaffected, while the original path (the thing attribution exists to record) is still visible.
4. **`## Unattributed` keys off `repo === 'unknown'`, and P-181's retained warnings are rendered too.** `repo: 'unknown'` is the attribution failure P-181 warns about, so those files are grouped into their own section rather than dropped — nothing may silently vanish from attribution. The map's `warnings()` are additionally listed under `### Attribution warnings` with their reason, so a reader learns *why* a file is unattributed, not just that it is.
5. **`UNKNOWN_COMMIT` renders as an explicit `—`, never a blank cell.** A blank cell reads as "no commit needed"; the dash reads as "we could not determine one", which is the truth.
6. **`## Notes` states the negative case explicitly.** With no agent-stitched files it prints "No files were stitched by the agent." rather than emitting an empty section, because an empty section is indistinguishable from a rendering bug.
7. **The PII rule is a SCRUB, not merely a template decision.** Email is rendered only when `includeEmails` is true, and when it is false every retained `sourceEmail` value is stripped from the finished text (`→ [redacted]`). P-181 already gates *retention* behind its own opt-in; this gates *display* independently, so a future edit to a template cannot leak an address the map legitimately holds. Two independent gates, both defaulting closed.
8. **`license/notice.ts` was not modified.** The phase marks it "optionally reference CREDITS", and the file already documents that it is "sourced from the P-118 scan + P-181 provenance" — it needs no CREDITS reference, and editing it would add coupling without a requirement.
9. **No new `StitchError` code.** A blank `repoC` is `CONFIG_ERROR`; a failed write is `INTERNAL`. Rendering itself is total (map → string cannot fail), so there is no third path.
10. **Determinism covers ORDER, not just the timestamp.** Sections are ranked A → B → unknown, then by `remoteUrl`, then by file path — asserted in the `stable output` test by rendering the same origins in REVERSED input order and requiring byte-identical output.

**Consequences:**

- Five tests (all spec-named) plus a sixth `it('stable output')`-internal set of extra assertions cover grouping and ordering, the fixed columns, the teleport annotation, the unattributed section with its warnings, the Notes negative case, the scrub, the write-and-return equivalence (read back from disk and compared byte-for-byte), a nested target directory, the blank-target config error, the clock override, and a custom header.
- `generateCredits` returns the content in every case, so P-185's preview and P-222's web view never have to read the file back — and the test proves the returned string and the file are identical.
- Full gate: typecheck 0, lint 0, depcruise 0 (176 modules / 469 deps), build 0, **177 passed | 1 skipped** files / **2129 passed | 1 skipped** tests.

---

## ADR-056: `format: 'both'` Needs One Document Per Format, the Error-Code Ritual Was Really Nine Edits, and Validation Is an Exported Gate Because Otherwise It Is Untestable

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-183 (`PHASES_DETAILED.md:9214-9252`) emits a machine-readable SBOM for the composed app: CycloneDX JSON (primary) and SPDX (optional), carrying dependency components with `purl`s and P-128 licence verdicts plus P-181's file provenance. It declares `generateSbom(...): Promise<Result<string, StitchError>>`, mandates `err('SBOM_INVALID')` on malformed output, and requires validation against a minimal schema.

**Decisions:**

1. **`format: 'both'` cannot be a single `string`, so the result carries one document per requested format.** The declared `Result<string, …>` works for one flavour, but "both" has no honest single-string representation — inventing a JSON envelope would be a format nobody specified and every consumer would have to learn. `SbomOutput.documents` holds `{ cyclonedx?, spdx? }` and `written` lists the paths actually written. This is the same reconciliation shape as P-182's `repoC`: widen additively rather than fail an acceptance criterion the declaration cannot express.
2. **The `SBOM_INVALID` ritual was NINE coordinated edits, not the six the precedent implies — and two were found by RUNNING tests.** The seven known sites are the union variant, `STITCH_ERROR_CODES`, `system/doctor.ts`, `agent/errors.ts`'s `ErrorRule`, both `build.smoke.test.ts` counts, and `INTEGRATIONS.md` §9.1. `CLASSIFIED_CODES` (an *alias* of `STITCH_ERROR_CODES`, so it looked self-maintaining) and `errors.test.ts`'s explicit **non-recoverable list** were invisible to reading: `typecheck` was already **0** and the change *looked* complete. The `classifies provider/tool/auth/sandbox/fatal` test caught it on the first run. **A green typecheck is not a green change** — the same lesson as P-181's logger-field drift guard.
3. **Validation is an EXPORTED gate (`checkSbom`), not an inline step, because otherwise the mandated `SBOM_INVALID` path is untestable dead code.** The renderer is deterministic and, by construction, always produces a valid document — so a malformed document can only be reached from outside. Extracting the gate lets `generateSbom` use it *and* lets a test drive it with `'{}'` and `'not json'`, proving the malformed path returns the typed error instead of writing a broken artifact. A branch that cannot be exercised is the same as no branch.
4. **Components are read from the merged manifest by `in`-narrowing its 4-way union — no casts (ADR-041).** `'require' in m` → Go, `'package' in m` → Cargo, `'source' in m` → Python, else npm. Cargo's values are themselves a union (`string | { version }`), handled explicitly, and npm contributes all four of its dependency maps.
5. **`purl` uses P-115's parser ids, which map 1:1 onto purl types** (`npm`/`python`/`cargo`/`go` → `npm`/`pypi`/`cargo`/`golang`) — so no package-name translation table exists. An npm scope is a namespace+name pair and `@` is percent-encoded (`pkg:npm/%40angular/core@17.0.0`), because the unencoded form does not round-trip.
6. **Output is deterministic from the inputs.** `created` defaults to `deps.generatedAt`, and the CycloneDX `serialNumber` / SPDX `documentNamespace` are content hashes rather than `randomUUID()` — so the same inputs render byte-identical documents, which is what makes the artifacts diffable in CI. `now`/`serialSeed` remain as explicit overrides (the P-182 precedent).
7. **`LicenseReportRow` keyed `package@version` is the bridge from the manifest component set to the P-128 verdict**, and a component with no row is `NOASSERTION` — never a silently permissive default. The policy `decision` is exposed alongside, so a consumer can tell "allowed" from "concluded".
8. **`NOASSERTION` (SPDX's own no-assertion token) is used for both formats**, so the two documents speak one vocabulary rather than each inventing its own blank.
9. **Provenance rides in CycloneDX `properties`, not in `components`.** A compliance tool counts `components` as libraries; adding one entry per file would corrupt that count. Each origin becomes `stitch:file-origin:<C path>` with `repo`/`commit`/`sourcePath`/`stitchedBy`. SPDX uses `files` with `artifactOf` attribution, as the phase asks.
10. **`provenance/types.ts` RE-EXPORTS rather than re-declares.** P-181 owns the origin types in `map.ts` and P-182 owns `CreditsOptions`; the phase lists a `types.ts`, and one home per type is what keeps that list honest.
11. **A test found a real defect in the path this module REPORTS.** `written` was built by string concatenation with `/`, while `join()` yields `\` on Windows — so the function handed a caller a path it could not open. Fixed to use `join`, which is also why the assertion compares against `join(...)`.
12. **No further error code.** Blank `metadata` and a blank `repoC` are `CONFIG_ERROR`; a failed write is `INTERNAL`; malformed output is `SBOM_INVALID`. Validation itself is a total function returning the reason as a `string | undefined`, so no throw is involved anywhere.

**Consequences:**

- Five tests (all spec-named) cover CycloneDX components+licences+provenance and the `both` shape, SPDX packages with `externalRefs`/`artifactOf`, purl formation (including the npm scope), the licence-verdict mapping (including the no-row `NOASSERTION` case), and validation — the last exercising the `SBOM_INVALID` gate directly with malformed and unparseable input, plus the write/return byte-equality and the two `CONFIG_ERROR` guards.
- Gate: typecheck 0, lint 0, **depcruise 0 (178 modules, 470 dependencies)**, build 0, and the **core** suite **156 passed | 1 skipped (157 files), 2069 passed | 1 skipped tests, exit 0**.
- SBOM output is now the machine-readable counterpart to P-182's CREDITS, both rendering from P-181's one map, ready for compliance export (P-307) and the web view (P-220).

---

## ADR-057: `git notes add` Refuses to Overwrite (So Write Means Read-Merge-Force), a Note Failure Is a Property of the Wiring Rather Than the Primitive, and `map.ts` Was Deliberately Not Touched

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-184 (`PHASES_DETAILED.md:9259-9298`) makes provenance travel with the repository: a `git notes` entry under `refs/notes/stitch-prov` attaches `{ schemaVersion, provenanceRef, mapChecksum, generatedAt, statistics }` to the merge commit without rewriting history. It mandates append/merge semantics, a `readGitNotes` that returns `undefined` for an absent note, `fetchAllProvenanceNotes` for audits (P-187), wiring into `map.ts` finalize, and the acceptance that a failed write WARNS rather than blocks.

**Decisions:**

1. **A write is read → merge → `add -f`, because `git notes add` REFUSES to overwrite.** This is the whole reason the phase asks for "append/merge JSON fragments": the naive implementation calls `add` a second time and git rejects it, losing the new fragment — or uses `-f` blind and destroys the previous note. A second write is therefore a first-class test, not an edge case.
2. **The merge loses no KEY: an existing-only key survives, and on a conflicting scalar the NEW value wins.** Implemented as a recursive object merge, so nested fragments (e.g. `statistics`) merge rather than replace wholesale. The new-wins rule on scalars is deliberate — a re-run of the same stitch must be able to refresh `generatedAt` and `mapChecksum` — and it is asserted both ways: an existing-only key survives, a new key is added, and a nested object merges field by field.
3. **`mapChecksum` hashes `ProvenanceMap.origins()`, which is already path-sorted (P-282).** Hashing a `Map` would hash INSERTION order, so two maps with identical content could produce different checksums — precisely the property a checksum exists to rule out.
4. **The note REFERENCES the SBOM rather than inlining it.** `provenanceRef` defaults to P-183's `SBOM_FILENAMES.cyclonedx` (imported, not retyped) and only the checksum and statistics ride along. A note is rewritten on every merge; a note carrying the map would be rewritten with a copy of the map.
5. **Two layers, because "non-blocking but surfaced" is a property of the WIRING, not of the primitive.** `writeGitNotes` returns a `Result` so a caller can act on a failure; `attachProvenanceNote` is the finalize-level call that degrades a failure to an `onWarning` event and reports `ok(false)`. Collapsing these into one swallowing function would make the failure unactionable; keeping only the primitive would let a lost note silently pass.
6. **`readGitNotes` distinguishes "absent" from "corrupt".** A missing note is `ok(undefined)` — the acceptance says so, and it is the normal first-write state. A note that EXISTS but is not a JSON object is `err(GIT_ERROR)`: folding it into `undefined` would hide a corrupt record from exactly the audit (P-187) that reads these notes. The test writes a real non-JSON note to prove it.
7. **No new `StitchError` code.** A failed git command is `GIT_ERROR` (existing); blank `repoPath`/`commitRef` is `CONFIG_ERROR`; corruption is `GIT_ERROR`. There is no new failure MODE here — a note that cannot be written is git failing at something git does.
8. **`provenance/map.ts` was deliberately NOT modified, despite being in the phase's file list.** `buildProvenanceMap` is pure-ish and unit-tested WITHOUT a repository, so wiring a git write into it would make a pure function require a repo and break its existing tests. The phase's own step 3 says "wire into `map.ts` finalize / pipeline" — the *pipeline* is the right seam, and the exported `attachProvenanceNote` is the call it makes. Same reasoning as P-181 leaving `gitFacade.ts` alone: editing a file to satisfy a list, when the requirement belongs elsewhere, is churn.
9. **`fetchAllProvenanceNotes` keys by the ANNOTATED commit.** `git notes list` prints `<note blob sha> <object sha>`; an audit wants the object, so the last field is the key. A namespace nobody wrote to yields an empty map — not an error — which the test asserts.
10. **The git runner mirrors the house pattern** (`agent/gitFacade.ts:205`): `execFile` wrapped so a spawn rejection becomes data (`{ code, stdout, stderr }`), never a throw. The primitive talks to real git, and the suite drives real repositories rather than a stubbed runner, because a fake cannot prove the `add`-refuses-to-overwrite behaviour this module exists to handle.

**Consequences:**

- Five tests (all spec-named) run against **real temp git repositories** and cover the first write plus git-tooling readability, the second write merging without loss (and the recursive merge unit), reading JSON plus enumeration plus the corrupt-note error, absent-note-as-`undefined` across namespace and enumeration, and the failure path at BOTH layers (primitive `err` / helper warning).
- Gate: typecheck 0, lint 0, **depcruise 0 (179 modules, 472 dependencies)**, build 0, and the **core** suite **157 passed | 1 skipped (158 files), 2074 passed | 1 skipped tests, exit 0**.
- P-184 is the last piece of Epic 9's data layer before the UI (P-185): CREDITS is the human read, the SBOM the machine read, and the git note the copy that survives a clone.

---

## ADR-058: No `Elysia` Import in Core (the Contract Is Framework-Agnostic), `ctx` Must Be USED, and PII Gets a Third Default-Closed Gate

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-185 (`PHASES_DETAILED.md:9305-9344`) exposes P-181's provenance map to the UI: `serializeProvenanceMap`, `provenanceRoutes(ctx, { getMap })`, plus `/api/provenance`, `/api/provenance/file?path=` and `/api/credits`, with acceptance requiring a 404 on an unknown path, email hidden unless configured, and the contract types exportable for web. It sketches the return type as `Elysia.Routes`. Its files are `packages/core/src/provenance/api.ts` + `api.test.ts` — and the block explicitly defers rendering ("later web P-221/P-229 render it — this phase produces the contract + route handlers"), while step 4 already places the server wiring at P-193.

**Decisions:**

1. **No `Elysia` import in `packages/core`, because elysia is not a core dependency — verified, not assumed.** `packages/core/package.json` declares no elysia; `packages/cli/package.json` pins `"elysia": "1.4.30"`, and core's own description reserves the HTTP/WS server for the CLI. Importing it would (a) demand a dependency core does not declare, breaking a frozen-lockfile install, and (b) push a server framework down a layer. So core exports **framework-agnostic route descriptors with pure handlers** and the CLI's Elysia server **binds** them at P-193 — which is the block's own step 4 and what its own test line ("route handler with fake ctx/getMap") presumes. `packages/cli` is another developer's package and was not touched.
2. **`ctx` is typed `RouteHost` so it is USED rather than an ignored parameter.** `provenanceRoutes(ctx, opts)` calls `ctx.register(route)` for each descriptor AND returns them. The CLI passes an adapter over its Elysia app; a test passes `recordingRouteHost()`, which ships with the module. Keeping the phase's two-parameter arity while making the first parameter meaningful beats either an unused argument or a redesign that drops it.
3. **Handlers are pure: `{ status, body }` in, no framework out.** This makes every acceptance criterion testable with a function call — no listener, no port, no Elysia — which is why the suite is fast and deterministic.
4. **`400`, `404` and `500` are kept distinct, because they mean different things.** A missing/blank `path` parameter is the caller's mistake (400); a path the map does not contain is a normal miss (404); a renderer that returned `err` is a real defect (500). Collapsing 404 into 400 tells a client it called wrongly when it called correctly, and collapsing either into 500 hides a broken server behind an apparent data gap.
5. **`404` is a response VALUE, not a `StitchError`.** An absent file is an expected answer; `Result` remains for genuine handler failures. Conflating "not found" with "failed" is exactly the distinction P-184's `readGitNotes` also draws between absent and corrupt.
6. **The stats reuse P-182's exact predicates.** `unattributed` counts `repo === 'unknown'` and `agentEdited` counts `stitchedBy === 'agent'` — the same two tests CREDITS renders sections from — so the panel and the document cannot disagree about what "unattributed" means. `byRepo` is counted per label.
7. **Email gains a THIRD default-closed gate.** P-181 only *stores* `sourceEmail` behind its own opt-in; P-182 only *renders* one behind its own flag; this serializer only *transports* one when `includeEmails` is set. Three independent gates, all off by default, and the test asserts the address never appears in the serialized JSON (not merely that the field is absent) so a nested leak would also fail.
8. **Lookup goes through `getOrigin`, which normalises separators.** The handler does not re-implement file lookup, which is also why a Windows-style `lib\\util.go` query resolves and the test asserts it.
9. **`/api/credits` returns the markdown as the BODY**, matching the acceptance's wording ("returns the CREDITS content"), and defaults to `generateCredits(map, {})` — which is render-only when no `repoC` is given, so this route never touches the filesystem. An injectable `getCredits` keeps the route testable and lets a caller substitute a cached document.
10. **`PROVENANCE_ROUTES` is exported** so a binder and the tests agree on the three paths without retyping them — the same drift-proofing P-182 applied to its table columns.
11. **No new `StitchError` code.** Everything here is a response status; the only error crossing the boundary is P-182's renderer `Result`, whose message is narrowed via `'message' in error` before being placed in a 500 body.

**Consequences:**

- Five tests (all spec-named) cover the full map plus stats and descriptor registration, a file origin including the backslash-normalised lookup and an unattributed file being SERVED rather than hidden, the 400/404/500 three-way distinction, credits rendering plus an injected renderer and its failure, and the email gate across both the serializer and the routes.
- The contract is now the single shape web P-221/P-229 and the CLI server (P-193) both consume, and `ProvenanceMapDto` is exported from `src/index.ts` for the web import the acceptance requires.
- Gate: typecheck 0, lint 0, **depcruise 0 (180 modules, 474 dependencies)**, build 0, and the **core** suite **158 passed | 1 skipped (159 files), 2079 passed | 1 skipped tests, exit 0**.

---

## ADR-059: The Manifest Hash Excludes Its Own Timestamp, the File Is `sha256sum`-Shaped, Absence Is a Mismatch, and `map.ts` Gains One Optional Field

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-186 (`PHASES_DETAILED.md:9351-9394`) records a SHA-256 per staged file as the tamper-evidence anchor — integrity, drift detection and release auditing — with `manifestSha256` over the whole manifest, a written `<repoC>/checksums.sha256`, and `verifyChecksums` to detect drift. It mandates ignore globs, streaming hashes (bounded memory), and bounded concurrency via `p-limit` (P-031).

**Decisions:**

1. **`manifestSha256` covers `{ algorithm, entries }` and deliberately EXCLUDES `generatedAt`.** The phase says the hash must be "stable over the same tree" but also requires a `generatedAt` field; including the timestamp would make the hash differ on every rebuild of an unchanged tree, which is exactly what the stability criterion exists to prevent. The exclusion is stated in the module header and asserted directly (same tree, different clock, same hash) rather than left implicit.
2. **`checksums.sha256` uses the conventional `sha256sum` line shape — `<sha256>  <path>`, two spaces, sorted, trailing newline.** The manifest is the artifact an auditor verifies; inventing a bespoke format would make it unverifiable by the coreutils they already have. A test asserts the two-space form and the exact rendered bytes.
3. **Files are hashed as BYTE STREAMS, never decoded.** `git/binary.ts`'s header records that checksums "still carry every byte", so the stream is fed to `createHash` as buffers; a test hashes a `0x00 0xff 0x10 0x80` blob and asserts both its 4-byte size and its digest. Streaming is also what bounds memory by chunk size instead of repository size.
4. **An ABSENT file is a mismatch, not an error.** `verifyChecksums` answers `valid: false` for drift AND for a missing entry, because both mean "C is not what was recorded" — the question the caller asked. Only a genuine IO failure (an unreadable file that exists) is an `err`. Same absent-vs-broken distinction P-184 drew for git notes.
5. **Bounded concurrency via `p-limit`, default 8.** Verified before use that `p-limit` is a real core dependency (`"p-limit": "7.3.2"`) rather than trusting the phase's citation — the same check that caught P-183's phantom type and P-185's cross-layer dependency.
6. **The walk reuses `util/glob.ts`'s `listFiles` with merged ignore globs.** No new walker: `listFiles` already accepts glob `ignore` patterns (verified empirically at P-034, and already used by P-178's cache), so `opts.ignore` merges ON TOP of {@link DEFAULT_CHECKSUM_IGNORES} rather than replacing them — a caller narrowing the walk should not silently start hashing `node_modules`.
7. **The defaults exclude vcs, dependencies, build output AND the manifest itself.** `node_modules` alone would dominate both runtime and manifest, and excluding the manifest's own file keeps the manifest from describing itself on a second run — a test asserts the entry set is unchanged after a write.
8. **Paths are stored relative and posix-normalised.** A manifest produced on Windows must verify on Linux; absolute or backslash paths would break the anchor exactly when it is needed (a release audit on a different machine).
9. **`map.ts` gains ONE additive optional field** — a third constructor parameter and a `checksumManifestPath` getter, threaded through `from`. Existing callers (`ProvenanceMap.from(origins)`, `from(origins, warnings)`) are unaffected, and loading from sqlite simply has no manifest path. It is a session reference; the persisted payload remains the origins only.
10. **No new `StitchError` code.** A blank `repoPath`/`repoC` is `CONFIG_ERROR`; walk, read and write failures are `INTERNAL`. Absence and drift never reach the error channel at all.

**Consequences:**

- Six tests (all spec-named) run against a REAL temp tree: sorted entries with real digests and sizes plus a byte-exact binary case, manifest-hash stability across clocks and its movement on a changed byte, the written file's `sha256sum` shape and byte-equality with the rendered text, a clean verification plus the empty-manifest and blank-repo cases, drift/absence/size-growth all landing in `mismatches` with `valid: false`, and the ignore defaults plus an extra glob.
- Gate: typecheck 0, lint 0, **depcruise 0 (181 modules, 477 dependencies)**, build 0, and the **core** suite **159 passed | 1 skipped (160 files), 2085 passed | 1 skipped tests, exit 0**.
- `manifestSha256` is now the value the git note (P-184) and the SBOM (P-183) reference, and the release checklist (P-318) verifies — one anchor, two references.

---

## ADR-060: A Second Audit Surface Owned on First Use, Append-Only Verified Structurally, and Detail Scrubbed by Walking the Object

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-187 (`PHASES_DETAILED.md:9401-9443`) records an append-only trail of pipeline events — 17 `AuditAction`s, `AuditRecord { id, ts, action, actor, jobId?, detail, ok }` — in a `provenance_audit` SQLite table, with `query` filters, `exportJson` for compliance (P-307), `fullAudit` for review, and `detail` sanitized. It lists `orchestration/pipeline.ts` as a "later hook", and the CLI command as P-196-area.

**Decisions:**

1. **The `provenance_audit` table is OWNED on first use, not added as a store migration.** `store/schema.ts:10` does reserve an extension slot for `P-187`, so this was a real choice rather than a default: the phase never asks for the store to be edited, every sibling that needed a table (P-145/P-169/P-173/P-178) owned it, and `DbLike` is deliberately `bun:sqlite`-free so an owner can create its table without touching another phase's migration surface. Recorded because the reservation means the opposite choice was defensible.
2. **This is a SECOND audit surface, and the name says so.** Migration v1 already defines a general `audit` table and P-145 owns `ai_calls`; neither can answer "what did this stitch do" without wading through unrelated rows, so `provenance_audit` is its own table.
3. **Append-only is verified STRUCTURALLY, not by intent.** The test enumerates the class prototype and asserts the ABSENCE of `update`/`delete`/`remove`/`edit`/`clear`/`reset`/`truncate` while confirming `append` exists. A test that only calls `append` and counts rows would pass for a class that could also delete them.
4. **`detail` is sanitized by WALKING the object, scrubbing every string leaf through P-179's `scrubSecrets`.** Stringifying the whole detail and scrubbing the text would work too, but it would collapse the structure — a caller reading a record back would get a string where it stored an object. Walking preserves the shape AND removes credentials, and non-strings keep their types (asserted: a number stays `3`, a boolean stays `true`).
5. **Sanitization happens BEFORE the insert, which is the actual guarantee.** The test queries the RAW table and asserts the credential is absent from the stored `detail` column — not merely that the returned object looks clean. Ingress scrubbing means a compliance dump cannot leak what was never written (the same choice P-173's capture made for a different stream).
6. **A durable `DbLike` is REQUIRED; there is no in-memory fallback.** Every other table-owning phase (P-178's cache, P-179's fallbacks) could sensibly degrade to memory because it was an optimisation. An audit that evaporates with the process is not an audit, so requiring storage is the honest signature.
7. **`id` and `ts` are assigned by `append` and returned**, so a caller gets the stored record rather than having to re-read it, and `ts` comes from an INJECTED clock so all six tests are deterministic (the P-178…P-186 precedent).
8. **`exportJson` is ordered OLDEST-first by `ts` then `id`.** `query` returns newest-first, which is right for a UI, but a compliance dump must read as a story and must be DIFFABLE: the test asserts two exports of the same log are byte-identical, and an empty log exports `[]` rather than failing.
9. **Filters combine with AND, and no match is an empty list rather than an error** — the same "absence is an answer" rule P-184 and P-186 applied. `limit` is validated as a positive integer before being applied.
10. **No new `StitchError` code.** A blank `action`/`actor` is `CONFIG_ERROR`; table setup and SQL failures are `INTERNAL` (already produced by `dbRun`/`dbAll`).
11. **`orchestration/pipeline.ts` was NOT touched.** The phase marks it "emit audit events — later hook", and the pipeline is P-238; wiring it now would mean inventing the pipeline's structure ahead of its own phase. The audit's `append` is the seam P-238 and P-160's HIL flow will call, and the test proves both the pipeline-shaped actions (`clone`/`build`/`commit`) and the HIL pair (`approve`/`reject`) record and are attributable to one `jobId`.

**Consequences:**

- Six tests (all spec-named) run against REAL temp SQLite and cover assignment and raw-row storage, the structural append-only check, every query filter plus AND-combination and the empty result, the sanitizer at both entry and storage, pipeline and HIL actions attributing to a job, and the ordered diffable export.
- Gate: typecheck 0, lint 0, **depcruise 0 (182 modules, 480 dependencies)**, build 0, and the **core** suite **160 passed | 1 skipped (161 files), 2091 passed | 1 skipped tests, exit 0**.
- The audit log is now the trust record beside the tamper-evidence anchor (P-186), and the last provenance data phase; P-188 consolidates the epic's tests the way P-180 closed the sandbox epic.

---

## ADR-061: The Gate Is the vitest Form, Fixtures Are Committed as CONTENT and Materialized at Test Time, and the Suite Found Two Wrong Assumptions of Mine

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-188 (`PHASES_DETAILED.md:9451-9497`) closes Epic 9 by consolidating provenance (P-181–P-187) into one suite that verifies the whole chain — merge → map → CREDITS → SBOM → git notes → checksums → audit — with fixture repos and a coverage gate. It mandates `provenance.suite.test.ts`, a committed `fixtures/` directory with two tiny JS repos A/B, and `test:provenance` = `bun test src/provenance --coverage` with ≥80 line / ≥70 branch.

**Decisions:**

1. **`test:provenance` uses the vitest form, because `bun test` cannot run in this repo.** This is the identical conflict P-180 resolved for the sandbox (bunfig `preload` is rejected by Bun's native runner), so the script mirrors the five existing `test:<area>` siblings with `--coverage.include`/`--coverage.exclude` and the 80/70/80/80 thresholds. The mandated ≥80 line / ≥70 branch are honoured exactly, and the acceptance was met **by running it**: `test:provenance` exits 0 at **89.24% statements / 80.99% branches / 92.17% functions / 94.57% lines**.
2. **The fixtures are committed as CONTENT and materialized at test time.** A literal `.git` directory inside `packages/core/src` would be walked by lint and dep-cruise, and a committed object database bakes in machine-authored commit SHAs. Committing the file SETS and `git init`-ing them through `commitFiles` + `FIXTURE_IDENTITY` gives shared, reviewed content AND authorship that is deterministic on every machine — which is precisely the property P-204's CLI integration tests will rely on when they reuse these fixtures (the phase's own handoff).
3. **The chain starts where provenance starts: a staged tree C plus a blame map.** P-072/P-076's merge has its own suite and its own fixtures; re-driving it here would turn this into a git-core integration test. C is staged in the P-070 teleport shape (`repo-a/…`, `repo-b/…`) that P-181's suite already models, and `BlameSource.prefix` is what recovers the original source paths.
4. **A material caveat this suite FOUND, recorded rather than papered over: `sourceCommit` is the commit THAT C BLAMES, not A's or B's.** A real pipeline merge imports A/B's objects, so the blamed commit is the upstream one; this staging does not share their history, so the honest assertion is C's own commit — asserted as such rather than against a SHA the fixture cannot produce. The limitation is in the HARNESS, not the code: P-181's `buildProvenanceMap` reports whatever the blame map proves, which is the contract.
5. **`deterministic map` means two INDEPENDENT passes**, not two reads of one map: a fresh `buildBlameMap` and a fresh `buildProvenanceMap` each time, comparing origins, the serialized DTO, `mapChecksum`, and the CREDITS text byte-for-byte. It also carries forward ADR-059's property that `manifestSha256` is stable across a different clock. This is the acceptance's own wording ("attribution deterministic across runs").
6. **A second wrong assumption of mine, caught by the suite: `origins()` sorts with `localeCompare`, which is NOT default code-unit `.sort()` order.** The first version asserted the DTO's file order equalled `[...files].sort()` and failed on `repo-a/lib/index.js` vs `repo-a/README.md`. The fix asserts the contract that actually exists — the transport preserves the map's own order, and that order is `localeCompare`-sorted — instead of asserting a different ordering rule and calling it the same.
7. **The dependency report is an INDEPENDENT fixture input, stated as such in the file header.** It uses a `GoManifest` because every required field of that variant is knowable (P-183's reasoning); it is not a description of the JS fixture repos, and implying otherwise would be a quiet incoherence.
8. **No new production API** — the only non-test artifact is one `package.json` script. The suite exercises the `Result`-returning surface already gated in P-181…P-187.
9. **The audit step uses a real `DbLike`**, because ADR-060 deliberately gave `ProvenanceAudit` no in-memory fallback, and it re-asserts that a credential in a `detail` never reaches the export.
10. **The `it('coverage gate')` assertion P-180 used is deliberately NOT duplicated.** P-180 asserted the script exists because its acceptance was about the script; here the acceptance is that the gate PASSES, so the gate itself was executed as part of this phase's own verification — a stronger check than a string match.

**Consequences:**

- Five tests (all spec-named) run the whole chain against ONE staged tree, plus the determinism, licence-verdict, tamper-detection and append-only scenarios — 42 tests across 8 files under `test:provenance`.
- Gate: typecheck 0, lint 0, **depcruise 0 (183 modules, 480 dependencies)**, build 0, core suite **161 passed | 1 skipped (162 files), 2096 passed | 1 skipped tests**, `test:provenance` **0** at 89.24/80.99/92.17/94.57.
- **Epic 9 (Provenance, P-181–P-188) is CLOSED.** Provenance now has one contract (the map), three reads (CREDITS, SBOM, the HTTP DTO), a durable transport (git notes), a tamper anchor (checksums), a trust record (audit), and a suite that proves they wire together.

---

## ADR-062: The Declared Dependency Was Sequencing, `failed` Is Not Settled, and the Executor Has No Hidden Cursor

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-238 (`PHASES_DETAILED.md:11738-11779`) is the heart of merge execution: a nine-stage pipeline (`config → sources → selection → deps → licenses → agent → sandbox → provenance → finalize`) with explicit states, a transition table, per-stage records, and hooks for resumability (P-240), cancel-safety (P-246) and observability (P-241). It declares `Depends On: P-237`, and its `runPipeline.ts` is described as wiring the concrete stage modules.

**Decisions:**

1. **The declared `Depends On: P-237` is wave SEQUENCING, not a code input — and that is why this phase could be taken at all.** P-237 is `### P-237: Web - Perf Pass` (`:11694`), a web-UI optimisation. P-238's own context lists what it actually composes — config, fetch, selection, deps, license, agent, sandbox, provenance, finalize — and every one of those components has been implemented, tested and green since P-188. A web performance pass is not an input to a core pipeline state machine, so the dependency encodes "Wave 3 runs after Wave 2" rather than "P-238 needs P-237's artefact". Recorded explicitly, because a phase started over a declared dependency must say so rather than quietly ignore it.
2. **`TRANSITIONS` is the single source of truth, and every move is validated against it.** The handoff is emphatic — "keep transitions table-only (no hidden state)" — and the reason is mechanical: a resumable machine persists only its RECORDS, so any state not in a record is lost on restart and the resume replays a different pipeline. `transition` is therefore the only mutator, and it consults `canTransition` every time.
3. **`failed` is NOT a settled status — and the mandated test caught me getting this wrong.** My first version counted `failed` as settled, so after a stage failed the executor saw "nothing unsettled" ahead of it and walked ON to the next stage, reporting `completed` while a stage sat failed. `isSettledStatus` now means `passed | skipped` only, because a failed stage is still owed a retry (`failed → running` is legal in the table). The failing assertion was `expected 1 to be 2` on the attempt count — i.e. the retry had silently not happened. This is the sharpest form of decision 2: a status's MEANING to the executor is part of the law, not an implementation detail.
4. **Resumable by construction: the records ARE the cursor.** `run` begins at the first unsettled stage and skips settled ones, so a second call after a pause, a failure or a process restart continues where it stopped. There is no separate `resume` path to keep in sync with the forward path — which is what makes P-240's persisted-state resume a matter of passing `records` back in rather than a second implementation.
5. **Pausing is a first-class outcome.** A handler returning `blocked` or `awaiting_hil` stops the run and reports `stoppedAt`, so a licence verdict (P-131) or an HIL approval (P-160) can arrive out-of-band and the same `run` call resumes at that stage. `blocked → running` and `awaiting_hil → running` are in the table precisely for that re-entry.
6. **A failed stage is a RESULT, not an `err`.** Like P-155's failing build, a red stage is reported in the returned records and the outcome is `'failed'`; the caller decides whether that is fatal. Only a genuine defect returns a typed error: `ILLEGAL_TRANSITION` (P-159's existing `{ from, to, message }` shape — **no new error code**, so no ritual) and `INTERNAL` for an unknown stage.
7. **A stage with no handler is a deliberate `skipped`, not a failure.** The machine's job is to SEQUENCE; requiring every stage to be wired would make a partial pipeline indistinguishable from a broken one, and would break the dry-run use case.
8. **`runPipeline` is the COMPOSER, and the concrete module wiring is injected.** The phase describes it as wiring deps P-113, license P-131, agent P-167, sandbox P-177 and provenance P-187 directly. Those handlers are supplied by the caller instead, deliberately: each is a thin adapter over a module whose signature belongs to that module, and the drivers that already exist — the merge command (P-192), the web server (P-216) and the job queue (P-239) — are where the business choice of WHICH modules to wire belongs. What this file owns is the composition contract (build the context, drive the machine, report), which is real and tested. Constructing five adapters blind from here would mean guessing at five APIs, exactly the failure mode the anti-hallucination protocol exists to prevent.
9. **The idempotency seam is a PREDICATE, not a store.** `StageCache` is `{ has(stage, ctx) }` and a hit marks the stage `skipped` with `meta.cached`. P-250 owns persistence, so this phase depends on the shape and not on a table — the same "own the contract, let the storage owner supply the implementation" rule P-159's `AgentStateStore` followed.
10. **Events are emitted from `transition` itself**, in P-241's shape (`{ type: 'stage:transition', stage, from, to, at }`). Emitting at the call site rather than at the executor loop means no transition can occur unobserved — the log cannot drift from the state.
11. **`--jobs` and `--offline` reach the handlers through the context**, asserted directly, so the policies P-204 and P-146 own are plumbed rather than assumed.

**Consequences:**

- Four tests (all spec-named) cover the vocabulary and a nine-stage happy path with all 18 transitions announced in order plus policy plumbing, the transition table's enforcement including terminal and unknown-stage cases, a `blocked` pause and its resume (and the `awaiting_hil` equivalent), and a failing stage's retry, a permanent failure leaving later stages `pending`, and a cache hit skipping a handler.
- Gate: typecheck 0, lint 0, **depcruise 0 (186 modules, 482 dependencies)**, build 0, and the **core** suite **162 passed | 1 skipped (163 files), 2100 passed | 1 skipped tests, exit 0**.
- P-238 is the deterministic core the rest of Wave 3 builds on: P-239 wraps it in the job queue, P-240 persists records for resume, P-241 taps the events, P-246 passes a signal.

---

## ADR-063: The Queue Table Is pipeline_jobs, Claim Is One Guarded UPDATE, and the Default Job Id Needed a Suffix

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-239 (PHASES_DETAILED.md:11786-11827) makes the queue the durable spine of Wave 3: jobs persisted with a lease, an atomic claim, guarded transitions, and crash recovery.

**Decisions:**

1. THE TABLE IS NAMED pipeline_jobs, NOT jobs. store/schema.ts (migration v1, P-030) ALREADY defines a jobs table (id, status, payload, created_at, updated_at) whose shape differs from the eleven columns this phase mandates. CREATE TABLE IF NOT EXISTS jobs would silently NO-OP against it, and every INSERT would then fail against columns that do not exist - a landmine that only fires at runtime, in the component whose job is durable failure. The phase column set is kept verbatim and the table named distinctly. store/schema.ts:10 DOES reserve an extension slot for P-239, so the alternative (ALTER the v1 table via a new migration) is real; this phase own file mandate is a schema.ts that owns its DDL - the arrangement P-169/P-173/P-178 used. Recorded rather than silently resolved.
2. CLAIM IS ONE GUARDED UPDATE. It compiles to UPDATE ... WHERE id = ? AND status = ?, reading changes; two workers racing therefore produce exactly one winner and the loser gets ok(undefined) - a lost race, not an error. A read-then-write would let both observe queued and both run the job, so no-double-run is a property of the SQL rather than of caller care. Every other mutator is guarded the same way, with the status re-checked inside the WHERE so the guard cannot be lost to a race between the check and the update.
3. THE LEASE IS THE CONCURRENCY AUTHORITY. lease_expires_at turns a crashed worker into a recoverable job (requeueStale) instead of one that runs forever; recovery is a RE-ENTRY (back to queued, claimable again), not a reset, and a live worker lease is left untouched - asserted directly.
4. A REFUSED TRANSITION IS A TYPED ERROR, reusing P-159 existing ILLEGAL_TRANSITION ({from,to,message} - ADR-032 kept those fields plain for exactly this reuse). NO new error code, so no ritual.
5. A REAL FLAW THE TEST CAUGHT: the default id was slug + timestamp only, which is NOT unique - two jobs of the same kind enqueued in one clock tick collided on the PRIMARY KEY and the second insert failed silently behind an isOk guard. The id now carries a random suffix; slug and timestamp keep it readable. The regression is asserted directly.
6. A second wrong assumption of mine, corrected by the suite: started_at is the CLAIM time (when the job starts running), not the enqueue time; the fixture ticks the clock between the two so the assertion can tell them apart.

**Consequences:**

- Five tests (all spec-named) against REAL temp SQLite cover the full lifecycle with event emission, a genuine two-worker race plus pollReady skipping what it cannot win, cancel/pause/resume/retry with terminal refusals, stale-lease requeue that leaves a live lease alone, and the query surface status/history/metrics will consume.
- Gate: typecheck 0, lint 0, depcruise 0 (189 modules, 485 dependencies), build 0, and the core suite 163 passed / 1 skipped files, 2105 passed / 1 skipped tests, exit 0.

---

## ADR-064: A Missing Checkpoint Is Refused, a Config Mismatch Restarts, and the Sweep Pauses Rather Than Requeues

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-240 (PHASES_DETAILED.md:11834-11873) adds job resume: on restart, on an explicit --resume, or after an HIL pause, a job re-enters the P-238 machine at the last incomplete stage, reusing persisted state, and records a resume marker in the audit log.

**Decisions:**

1. RESUME IS POSSIBLE ONLY BECAUSE OF P-238 AND P-239. P-238 keeps the pipeline RECORDS as its cursor, so re-entry needs no second code path; P-239 persists job and context. resume() is therefore mostly load-and-hand-back, and it uses the machine own resumePoint so the definition of incomplete has ONE home.
2. A MISSING CHECKPOINT IS REFUSED, not treated as a fresh start. A job that never checkpointed has nothing to re-enter, and silently starting from the beginning would re-run stages a caller believed finished. It is a typed CONFIG_ERROR.
3. A CONFIG MISMATCH RESTARTS rather than refusing. A checkpoint produced under a different configuration no longer describes the work, so the honest outcome is begin again from config - and the stale checkpoint is CLEARED so it cannot be replayed. This is a different outcome from cannot resume and is modelled as one (mode: restart).
4. THE CRASH SWEEP PAUSES, IT DOES NOT REQUEUE. P-239 requeueStale already returns an expired lease to queued; this phase own acceptance asks for the swept job to be marked paused so it is VISIBLE as waiting for a resume, and the caller decides when to re-enter. The sweep composes the queue existing pause/list primitives rather than adding a second sweeper, and it is a NO-OP under --no-resume.
5. THE LEASE IS TAKEN BEFORE THE STATE IS HANDED BACK. resume calls the queue guarded claim first, so a job owned by a LIVE worker cannot be stolen and a finished job cannot be reopened; failure is a typed ILLEGAL_TRANSITION (P-159 existing shape, no new code).
6. CHECKPOINT GRANULARITY IS PER-STAGE, and stage_status is written on its OWN so a checkpoint never read-modify-writes the row and cannot clobber a concurrent lease update. Honest limit: adding the column to the IF NOT EXISTS DDL covers a fresh database (all tests) but is NOT a migration for an existing one; that upgrade path belongs with the store owner.
7. THREE TEST-FIXTURE BUGS WERE MINE, not the implementation: the crash sweep DEFAULTS to the wall clock, so a fixture that did not pass now explicitly swept everything; my resume fixture omitted the agent record, and since the machine transitions all nine stages a missing record is an unknown stage (INTERNAL); and an off-by-one expected deps where the first incomplete stage is licenses. Each was corrected at source with the reasoning recorded in the assertion.

**Consequences:**

- Four tests (all spec-named) against REAL SQLite and the REAL machine prove a checkpoint round-trips through the database, that resume re-enters at the first incomplete stage and that passed stages are NOT re-run (the driven machine journal omits them), that the sweep pauses only the expired lease and leaves a live worker alone, and that a config mismatch restarts with the checkpoint cleared and cannot then be resumed again.
- Gate: typecheck 0, lint 0, depcruise 0 (190 modules, 486 dependencies), build 0, and the core suite 164 passed / 1 skipped files, 2109 passed / 1 skipped tests, exit 0.

---

## ADR-065: The Bus Is Core and the WS Adapter Is the CLI, Delivery Is Synchronous, and a Coalescible Topic Holds One Slot

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-241 (PHASES_DETAILED.md:11880-11918) makes one typed event spine that every core module publishes to and bridges it to the WebSocket hub, so the CLI progress view and the web surfaces subscribe from one place.

**Decisions:**

1. THE BRIDGE LOGIC IS CORE; THE ADAPTER IS THE CLI. The phase lists packages/cli/src/server/wsBridge.ts and its Owner is inbesat, so two signals conflict: AGENTS.md assigns cli/web to the other developer. Reconciled the way P-185 ADR-058 did it: core exports createBusForwarder(bus, sink), pure logic over an injected EventSink, and the CLI adapter becomes a handful of lines binding its hub. packages/cli was NOT touched, and the mandated ws-forward test drives a FAKE sink, so it tests the real logic without a server.
2. DELIVERY IS SYNCHRONOUS, IN PUBLISH ORDER, PER TOPIC. The bus stamps a per-topic SEQUENCE itself, so two publishers cannot disagree about order and a subscriber can assert it. Async handlers are allowed but NOT awaited: a slow subscriber must never sit on the pipeline critical path.
3. A THROWING OR REJECTING HANDLER IS REPORTED, NOT PROPAGATED. The publisher is a pipeline stage, so one bad subscriber must not abort delivery to the others or blow up the publisher; failures go to onHandlerError as values.
4. WILDCARDS ARE ONE LEVEL: prefix.* only. No ** and no mid-string star, because a richer grammar in an event bus is a footgun nobody asked for. Matched only in matchesTopic, so the semantics have one home.
5. A COALESCIBLE TOPIC HOLDS AT MOST ONE QUEUED SLOT, and my first version got this wrong in a way the test caught: it replaced an existing sample only when the buffer was ALREADY full, so several progress samples accumulated (expected 1, got 3). Replacing unconditionally is what makes at most one true, and it is the right semantic anyway - a progress bar wants the latest position, so any earlier sample is dead weight whether or not the client has fallen behind. A non-coalescible event is DROPPED when the buffer is full, never allowed to block, and the drop is counted so the loss is visible.
6. ZOD VALIDATES THE ENVELOPE at the WS boundary, the one place loose data crosses, while payloads stay TS-typed in-process rather than re-parsed on every publish (the P-009 spirit). eventEnvelopeSchema is exported for the CLI and the web to share.
7. NO NEW ERROR CODE: the bus reports failures as values and publish cannot fail.

**Consequences:**

- Five tests (all spec-named) cover per-topic ordering and the stamped sequence plus envelope validation, one-level wildcards and once(), idempotent unsubscribe and removing one of two subscriptions, async handlers not being awaited plus throw and rejection reporting, and the forwarder coalescing to the LATEST progress value, counting drops, honouring a hello topic filter, and detaching on close.
- Gate: typecheck 0, lint 0, depcruise 0 (192 modules, 487 dependencies), build 0, and the core suite 165 passed / 1 skipped files, 2114 passed / 1 skipped tests, exit 0.

---

## ADR-066: Progress Is Normalised (Not Summed), an ETA Is Never Invented, and "Current" Means Earliest Unresolved

**Status:** Accepted
**Date:** 2026-10-16

**Context:** P-242 (PHASES_DETAILED.md:11925-11962) reduces the P-241 event spine into one stable, throttled progress model - per-stage and overall percent, ETA, activity label, phase grouping - which the CLI progress view (P-199) and the web ThinkingStream (P-216) render. The handoff names the stake: "a lying ETA erodes trust".

**Decisions:**

1. THE STAGE VOCABULARY IS THE PIPELINE'S OWN. The phase illustrates weights with four stage names (deps, agent, sandbox, provenance); the aggregator reduces the very events the pipeline emits, so it uses the real nine 'PIPELINE_STAGES' from P-238. Weights, labels and phase groupings are 'Record<PipelineStage, ...>', so a stage that exists without a weight is a compile error rather than a silent zero on screen.

2. WEIGHTS ARE NORMALISED OVER THE ACTIVE (NON-SKIPPED) STAGES, NOT SUMMED. The phase's own example weights sum to 0.95, so a naive 'overall = sum(weight*percent)' caps a fully finished stitch at 95%. Dividing by the weight of the stages still in play is ALSO exactly the skipped-stage redistribution the phase asks for in step 4 - one rule, not two - instead of leaving a permanent hole in the bar. A wholly skipped pipeline reads 100 (nothing left to do), not 0.

3. AN ETA IS NEVER INVENTED. Before any event has been observed there is no throughput, so 'etaMs' is undefined; it stays undefined while overall percent is 0, and is 0 (known-complete) at 100%. Above zero it is 'elapsed*(100-pct)/pct' clamped to [0, maxEtaMs], with elapsed itself clamped at 0 so a clock that moves backwards cannot yield a negative estimate. An absent estimate is honest; a fabricated one is worse than none.

4. EMISSION IS FORCED ON A STAGE CHANGE AND THROTTLED (default 200ms) OTHERWISE, and never fires twice for an identical model - that is the no-flicker requirement in both directions (a repeated frame is noise, a missed stage change is useless). 'etaMs' is deliberately EXCLUDED from the change signature, because it moves with the clock on every tick and would otherwise defeat the guard entirely. State is always live even when a frame is held, so throttling never loses information.

5. ACTIVITY PRIORITY: paused (awaiting_hil/blocked) shows "awaiting approval", derived from the STAGE STATUSES rather than stored, so resuming releases it with no second piece of state to desynchronise. Otherwise a payload 'detail' is SPECIFIC and always wins; a topic or stage default label is GENERIC, replaces another generic (so the line follows the newest stage and does not go stale) but never clobbers a specific label.

6. "CURRENT" IS THE EARLIEST UNRESOLVED STAGE. My first version scanned from the BACK, so 'overall.phase' and the emitted 'progress.stage' named the last unfinished stage - it reported 'attest' while the agent was still running, and 'finalize' as the stage the bar was on. The tests caught it; scanning from the front is what makes both fields describe where the run IS.

7. VALIDATION IS THE ONLY FALLIBLE ENTRY POINT AND REUSES AN EXISTING CODE. 'createProgressAggregator' returns 'Result<ProgressAggregator, StitchError>', rejecting a NaN weight (P-243 will feed weights in from per-job config, so this is a real trust boundary) and a non-positive cadence. It reuses 'CONFIG_ERROR {field, message}', so the 'StitchError' union is unchanged at 58 codes and the six-to-nine coordinated edits a new code requires were correctly NOT needed. The constructor is private, so an unvalidated instance cannot exist; every other method is infallible and returns a plain value, matching P-241's precedent for 'publish'.

8. TWO ADDITIVE PAYLOAD EXTENSIONS, both in my own P-241 module: 'ProgressPayload' gains 'overall'/'etaMs'/'phase' (the original 'stage'/'percent'/'detail' cannot carry the model, and the phase says this model is what gets emitted) and 'AgentPayload' gains 'percent', so an agent step can move the agent stage. Both are optional, so no existing producer breaks.

9. THE PUBLIC BARREL NOW EXPORTS THE EVENTS MODULE (bus, topics, progress). AGENTS.md section 7 requires core types to be reachable through 'core/src/index.ts', and P-242's own context makes the consumer explicit, which is why this could no longer be deferred - P-241 had left it undone. Open item, recorded rather than hidden: 'pipeline/' and 'jobs/' are still not exported from the barrel, and P-241 acceptance item 2 (re-pointing P-238/239/240's emit callbacks onto the shared bus) remains open.

**Consequences:**

- Five tests (all spec-named) assert real arithmetic rather than shapes: weighted percent (45% for five passed stages plus a half-done agent, and 100% - not 95% - when finished), throttling (a held frame with live state, then a changed frame, then an identical one that does NOT repaint, plus forced ticks), skipped redistribution (54%, explicitly asserted NOT to be the 37% a non-redistributed weighting would give, and a wholly skipped run reading 100), ETA clamping (a 1s ceiling reached from a ~67s extrapolation, undefined at 0%, 0 at 100%, non-negative on a backwards clock, and an ETA-only move not emitting), and a four-step activity priority matrix including the HIL pause and its release.
- One test assertion was itself wrong and was fixed, not the code: a late group event from an already-passed stage re-offers that stage's generic label, which IS a model change and therefore an extra frame.
- Gate: typecheck 0, lint 0, depcruise 0 (193 modules, 491 dependencies), build 0, and the core suite 166 passed / 1 skipped files, 2119 passed / 1 skipped tests, exit 0.

## ADR-067: `ProposedPlan` Does Not Exist (So It Is Authored), the Dry Run Is Enforced by Swapping `finalize`, and the State Machine Takes a Primitive Rather Than the Config

**Status:** Accepted
**Date:** 2026-10-17

**Context:** P-244 (PHASES_DETAILED.md:12011-12050) adds dry-run mode: the pipeline runs to a verdict but C is never written and AI stays propose-only, producing one preview plan the CLI (P-192 `--json`) and the web (P-217 proposed diff) both render.

**Decisions:**

1. `ProposedPlan` IS A PHANTOM AND WAS AUTHORED, NOT IMPORTED. Step 2 says the agent should "generate a `ProposedPlan` (new/modify/delete ops + rationale)". A repo-wide grep finds `ProposedPlan` ONLY in that spec line (PHASES_DETAILED.md:12024); the nearest real type, P-154's `ComponentProposal`, describes one component and has no notion of a whole-run plan. So `pipeline/dryRun.ts` DEFINES `ProposedFileOp` and `DryRunPlan`. Importing a type that does not exist would have been the failure the anti-hallucination rule names.

2. THE DRY RUN IS ENFORCED BY SWAPPING THE `finalize` HANDLER, NOT BY TEACHING `finalize` ABOUT DRY RUN. `runPipeline` replaces `handlers.finalize` with a handler that returns `{status:'skipped', meta:{reason:'dry-run'}}` when `cfg.flags.dryRun` is set. This keeps the ban in ONE place the machine already understands, leaves a caller's own `finalize` untouched for a real run, and makes the skip auditable in the stage record. A dry run that relied on every implementation remembering to check a flag would eventually write.

3. `PipelineOptions` GAINS `cfg?: JobConfig`, BUT THE MACHINE TAKES A PRIMITIVE. The state machine receives `dryRun: boolean` (on `RunOptions`, surfaced on `PipelineCtx`), never the `JobConfig`: `jobs/jobConfig.ts` already imports `pipeline/states.js`, so importing the config back into `pipeline/stateMachine.ts` would close a `jobs → pipeline → jobs` cycle — which `analysis/circular.smoke.test.ts` fails. `runPipeline` (which may import `jobs`) derives the boolean and forwards it. The circular guard stays green.

4. `finalized` IS REPORTED, NOT ASSUMED FALSE. `DryRunPlan.finalized` is computed from the `finalize` record's status, and the tests assert it is `false`; a future change that let `finalize` run through the dry-run branch could not pass silently.

5. THE NO-GENERATION RULE IS A NAMED PREDICATE, NOT AN INFERENCE. `dryRunAllowsGeneration(cfg)` is exported so the agent stage has exactly one thing to consult and the test asserts the rule directly (`false` when dry run, `true` otherwise) rather than inferring it from a flag.

6. STAGE METAS ARE UNTRUSTED HEADING INTO THE PLAN. `meta.proposedOps` is `Record<string, unknown>` by contract, so entries with a blank path or an unknown op are DROPPED, and only `create|modify|delete` survive. This feeds a UI that shows the user what a run would do, so a plausible-looking bad op is worse than a missing one.

7. `job.dry-run-plan` GREW `TOPICS` TO 16 AND RE-BROKE P-241'S HARDCODED EXPECTATIONS A SECOND TIME. P-243's `job.config-resolved` had already forced `bus.test.ts` to 15; this topic also matches the `job.*` wildcard, so both the length AND the `topicsFor('job.*')` list move. Both are updated in the same commit — the P-241 test asserting the topic contract is doing its job, and it is cheap to keep honest.

8. SANDBOX EPHEMERALITY IS NOT DUPLICATED HERE. Step 3 asks that the sandbox use ephemeral volumes (P-169/P-178). That is a property of the injected sandbox handler, which P-238 already treats as caller-supplied; the dry run surfaces that stage's `meta` as `sandboxPreview` rather than re-owning the runner. The guarantee this module makes on its own is the one it can keep: it performs no I/O.

**Consequences:**

- Six tests: the five spec-named cases (`skips finalize`, `no generation`, `builds plan`, `no side effects`, `plan json`) plus the step-4 `job.dry-run-plan` emit. They assert the NEGATIVE that defines a dry run — the caller's `finalize` writer is never invoked, the writer sink stays empty, `plan.finalized` is false — and that a REAL run still finalises, so the swap is conditional rather than global.
- `--dry-run` reaches the CLI/API (P-192/P-217); that wiring is the CLI/web lane and is not part of this phase.
- Gate: typecheck 0, lint 0, prettier clean, circular guard 3/3, full core suite 173 passed / 1 skipped files and 2279 passed / 1 skipped tests, exit 0.

## ADR-068: P-245 Grows the Job Vocabulary (`rolled_back`), and P-239's Terminal Assertion Is Updated Rather Than Worked Around

**Status:** Accepted
**Date:** 2026-10-17

**Context:** P-245 (PHASES_DETAILED.md:12057) mandates that a rollback "set job status `rolled_back`". P-239's `JOB_STATUSES`/`JOB_TRANSITIONS` (`jobs/types.ts`) declared `succeeded` and `cancelled` TERMINAL, and `jobs/__tests__/queue.test.ts:111` asserted `isTerminalJobStatus('succeeded') === true`. The two cannot both hold: if `succeeded` may reach `rolled_back`, it is by definition not terminal. The blueprint defines no conflict rule for this, so the conflict was SURFACED (with the failing assertion as evidence) rather than silently resolved.

**Decisions:**

1. THE STATUS IS ADDED AND `succeeded`/`cancelled` BECOME NON-TERMINAL. `JOB_STATUSES` gains `rolled_back`; `succeeded → rolled_back` and `cancelled → rolled_back` are legal; `failed → rolled_back` too (a failed job may still have written files); `rolled_back` is the new TERMINAL status. The model this expresses is the phase's own: a finalised C that turns out wrong is not the last word.

2. P-239'S ASSERTION IS UPDATED, NOT WORKED AROUND. `queue.test.ts:111` now asserts `succeeded` is NOT terminal and `rolled_back` IS, and its `Object.keys(JOB_TRANSITIONS)` count moves 6 → 7. The alternative — writing `rolled_back` into the row while leaving `canJobTransition` unaware — was rejected: it would make the table lie about a status the database actually holds, in the one module whose job is to make failures durable.

3. NO NEW `StitchError` CODE. A drift refusal is a `CONFIG_ERROR {field:'force'}` — a bad request against the current state the caller can fix — matching the P-074/P-084 precedent, so the union does not grow for a recoverable condition.

4. CONTAINMENT REUSES `resolveWithin` (P-205), not a new helper. Every path a rollback touches (removal target AND backup source) is re-resolved under its root, so a snapshot row that was tampered with cannot be used to delete outside its own tree.

5. THE SNAPSHOT IS ITS OWN TABLE (`pipeline_job_snapshots`), following the "own your DDL on first use" pattern of P-169/P-173/P-178/P-241 rather than altering `jobs/schema.ts`'s `pipeline_jobs` (ADR-063). Backups default to a SIBLING of the out dir, never inside it — a backup dir under the out dir would be indexed by the snapshot and then deleted by the very rollback that needs it.

6. `job.rolled-back` GREW `TOPICS` TO 17, which matches the `job.*` wildcard, so P-241's `bus.test.ts` length AND list moved for a third time. Updating them is cheap and is the P-241 contract test doing its job.

**Consequences:**

- Six tests (all spec-named): snapshot restore, generated-file removal, config revert, drift-block-then-force, dry-run list (asserting NOTHING moved and the status is unchanged), and the audit record + `job.rolled-back` event + a second rollback reporting "nothing to undo".
- P-246 (Cancel) will grow the vocabulary again (`cancelling`); the same P-239 count/terminality edits should be expected there.
- Gate: typecheck 0, lint 0, prettier clean, circular guard green, full core suite 174 passed / 1 skipped files and 2285 passed / 1 skipped tests, exit 0.

## ADR-069: P-246 Makes Cancellation Observable (`cancelling`), Durable Before the Token, and Adds a `cancel` Audit Action

**Status:** Accepted
**Date:** 2026-10-17

**Context:** P-246 (PHASES_DETAILED.md:12100) adds cooperative cancellation: `cancel(id,{reason})` asks a running pipeline to stop at its next safe checkpoint, marks the job `cancelled` (NOT `failed`), and makes a first SIGINT/SIGTERM graceful with a second as hard exit.

**Decisions:**

1. `cancelling` IS ADDED TO `JOB_STATUSES` AND THE QUEUE GROWS A `markCancelling` SEAM. The phase names the intermediate state, and it earns its keep: without it a UI cannot distinguish "stop requested, cleanup running" from "stopped". It settles to `cancelled` — or to `failed` if cleanup itself broke, which is why `cancelling → failed` is legal. This is the FOURTH edit to P-239's vocabulary across P-245/P-246, and `queue.test.ts`'s `Object.keys(JOB_TRANSITIONS)` count moves 7 → 8.

2. THE STATUS IS DURABLE BEFORE THE TOKEN FIRES. `cancelJob` marks `cancelling`, THEN aborts the `AbortSignal`, THEN settles `cancelled`. Aborting first would let a stage complete its cleanup and report success while the queue still believed the run was live. The test asserts this as a SEQUENCE, not merely a final value.

3. `'cancel'` IS ADDED TO `AuditAction`. The phase mandates a `CancelRecord`; reusing `'reject'` would make a human stopping a run indistinguishable from a refused proposal in the audit log. `AUDIT_ACTIONS` (the validating array) is a DIFFERENT declaration from the `AuditAction` union, and its length is pinned in `audit.test.ts` — both moved together, 17 → 18.

4. NO NEW `StitchError` CODE. Cancelling a finished job or an unknown id is a `CONFIG_ERROR` — a bad request against current state the caller can fix — matching P-074/P-084 and ADR-068.

5. "RESUME REFUSES CANCELLED" IS ALREADY TRUE AND NEEDS NO CODE. `resume` runs through `claim`, whose `canJobTransition` guard has no `cancelled → running` edge, so P-240's re-entry cannot revive a cancelled run. The test runs against a REAL `JobQueue` on real SQLite, because that refusal lives in SQL-backed state, not in a branch of this module — a fake would prove nothing.

6. THE SIGNAL HANDLER IS A PLAIN FUNCTION OF THE SIGNAL NAME (`createSignalHandler`). Raising a real SIGINT in a test is untestable and dangerous; the handler takes the signal name and counts calls, so the graceful/hard-exit pair (`onFirst` once, then `onSecond` or exit 130) is asserted directly. The default exit sets `process.exitCode` rather than calling `process.exit`, so core never hard-kills a host process on its own.

7. THE SANDBOX STOP IS A PORT (`SandboxStopper`). `cancel.ts` never imports Docker (P-168); a blank run id is refused rather than forwarded, because a port that read `''` as "all containers" would turn one job's cancel into a fleet-wide stop.

**Consequences:**

- Four tests (all spec-named): cancels mid-op (the op is genuinely interrupted and the state order is `['cancelling','cancelled']`), already-done errors (succeeded/failed/cancelled/rolled_back, unknown id, blank id — with nothing written), sigint graceful (once = graceful, twice = exit 130, exactly-once), and resume-refuses-cancelled against real SQLite.
- Gate: typecheck 0, lint 0, prettier clean, full core suite 175 passed / 1 skipped files and 2289 passed / 1 skipped tests, exit 0.

## ADR-070: P-247 Stores Metrics in Their Own Table, Collects Them Event-Sourced, and Clamps Every Provider Number

**Status:** Accepted
**Date:** 2026-10-17

**Context:** P-247 (PHASES_DETAILED.md:12145) adds run metrics — per-stage timings, counts, token/cost and sandbox resource usage — "persisted in SQLite (P-239 job row)" and queryable per-job and as a trend.

**Decisions:**

1. METRICS GET THEIR OWN TABLE (`pipeline_job_metrics`), NOT P-239's ROW. The phase says "the job row"; the repo's own-DDL precedent (ADR-063 for `pipeline_jobs`, ADR-068 for the rollback snapshots, plus P-169/P-173/P-178/P-241) plus the `listMetrics({kind,from,to})` TREND query both fit a side table better — a trend is a scan over many jobs, and it would otherwise mean reading every job row. It also keeps a metrics write from touching the queue's row mid-lifecycle. Recorded rather than silently chosen.

2. TIMINGS ARE DERIVED, NEVER SEPARATELY INSTRUMENTED. P-238 already stamps `StageRecord.startedAt`/`finishedAt` and emits a transition per move, so a duration is the distance between two transitions the pipeline already produced. Any second source would drift from the first, which is exactly the "the numbers must match what the UI showed" requirement in the handoff.

3. COLLECTION IS SYNCHRONOUS AND PURE; PERSISTENCE IS ONE EXPLICIT CALL. `MetricsCollector` holds counters and a stage map and does no I/O; `finalizeMetrics` writes once at the end. A collector that wrote per event could leave half-written metrics behind a crashing stage, and would put SQLite on the pipeline's hot path.

4. EVERY PROVIDER NUMBER IS CLAMPED (`safeAdd`). Token and dollar totals come from an adapter (P-143) that can report `NaN`, `Infinity` or a negative. One such value would silently poison every trend that includes it, so non-finite/negative deltas contribute 0 and the total is capped at `Number.MAX_SAFE_INTEGER`.

5. SANDBOX MEMORY IS A PEAK, NOT A SUM. CPU and job counts accumulate; `sandboxMemMb` keeps the HIGHEST reading, because summing peak memory across runs reports a number no container ever used.

6. `reusedFromCache` IS READ OFF THE SETTLING STATUS. P-238's cache hit settles a stage as `skipped`, so reuse needs no extra signal — the same transition that says "nothing to do here" is the one that says "already done".

7. NO NEW `StitchError` CODE. A storage failure is `INTERNAL`; there is no new caller-fixable condition. The `listMetrics` WHERE clauses are built from bound parameters only, so a caller-supplied `kind` cannot reach the SQL text.

**Consequences:**

- Five tests (all spec-named): timings (a real 1500ms duration from an injected clock, a cache-hit reuse, and an unsettled stage contributing nothing), counts (bus-driven tallies, detach stopping them, direct tallies clamped against negatives/NaN), token cost (aggregation plus a hostile `NaN`/`Infinity`/negative reading), persist-and-query (round-trip, kind/from filters, `undefined` for an unknown job, replace-not-duplicate on re-finalize), and resources (sum vs peak semantics, plus the `sandbox.run` bus path).
- Wiring to `/api/jobs/<id>/metrics` (P-193/P-216) and `stitch status --json` (P-194) is the CLI/web lane.
- Gate: typecheck 0, lint 0, prettier clean, full core suite 176 passed / 1 skipped files and 2294 passed / 1 skipped tests, exit 0.

## ADR-071: Tracing Auto-Parents Through Async-Local Storage, Decides Sampling at the Root, and Orders a Trace by Pre-Order Walk Rather Than Finish Time

**Status:** Accepted
**Date:** 2026-10-17

**Context:** P-248 (PHASES_DETAILED.md:12188) adds lightweight tracing: nested spans (job → stage → tool/sandbox/ai/fs) with start/end/duration/attrs, a waterfall for `--verbose`, per-job buffering, JSON export, and config-driven sampling.

**Decisions:**

1. NESTING COMES FROM `AsyncLocalStorage`, NOT A THREADED PARAMETER. The phase's whole premise is that an op several frames deep gets the right parent. Threading a `ctx` would make every intermediate function trace-aware; `AsyncLocalStorage.run` keeps the call sites plain, and the test asserts the parent survives an `await` — which is exactly what a threaded parameter would have to be re-passed to preserve.

2. SAMPLING IS DECIDED AT THE ROOT AND INHERITED. A child of a sampled span is sampled; a child of an unsampled one is not. Per-span random sampling would produce traces with holes, which are worse than no trace at all, and the test asserts both directions. An unsampled span is still CREATED and returned, so call sites never grow an `if (sampled)` branch — it simply never reaches `onSpan`.

3. A TRACE IS ORDERED BY PRE-ORDER WALK, NOT BY FINISH TIME. The first implementation appended spans in the order they FINISHED, and the tests caught it: a child closes before its parent, so the list read `deps, job`. `orderTrace` walks `parentId` from the root depth-first, so the array is already in the order a reader (and the waterfall renderer) expects. The walk is cycle-bounded, so a corrupt trace cannot hang it.

4. `finish()` IS IDEMPOTENT. A stage that closes a span in both a success and an error path (a `finally`) must not emit two records for one span, so the second call returns the first result untouched. Attrs merge on finish and open-time attrs survive.

5. THE COLLECTOR IS SEPARATE FROM THE TRACER. The tracer does not know what a job is; `TraceCollector.record(jobId, span)` supplies that, so one tracer can serve several jobs and "per job buffer" is a map lookup. The phase's `traceCollector(jobId)`/`getTrace(jobId)` reads as one object; splitting the two responsibilities keeps the tracer reusable and is the same shape ADR-070 used for metrics.

6. `onSpan` IS AN INJECTED CALLBACK, NOT A BUS SUBSCRIPTION. The phase says spans are "linked to the event bus (P-241)". There is no `trace.span` topic in `TOPICS` (17), and adding one is a fourth edit to the P-241 contract for a consumer (the web trace view, P-224) that does not exist yet. Every other producer in this wave (P-238/239/240) also emits through injected callbacks — wiring them all onto the bus is one coherent piece of work, and doing it for tracing alone would make it inconsistent. Recorded, not hidden.

7. `trace.ratio` IS A CONSTRUCTOR OPTION, NOT YET READ FROM `JobConfig`. P-243's `JobConfigSchema` has no `trace` section, and editing another phase's schema to add one is out of this phase's file mandate. The ratio arrives where the Tracer is built; that wiring is where `cfg.trace.ratio` will be read.

8. NO NEW `StitchError` CODE. Tracing is infallible and side-effect-free: it allocates records and calls a callback. There is no failure mode for a caller to handle, so nothing in the phase returns a `Result` — which is the honest shape rather than wrapping infallible work in `ok()`.

**Consequences:**

- Five tests (all spec-named): nesting (parentage at three depths, a sibling staying a root, and parentage surviving an `await`), finish attrs (status/duration/merged attrs, idempotent double-finish, error status), per-job buffer (separate jobs, an unknown job, sampling dropping a root AND its child, release), waterfall render (depth-based indent, kind in the gutter, `(open)` for a running span, `!` for an error, seconds over 1000ms), and JSON export (flat list + `parentId`, round-trips through `JSON.stringify`, unknown job → `undefined`).
- Two test assertions were themselves wrong and were fixed, not the code: one expected start-order insertion (fixed by `orderTrace` in the CODE, since the module header already promised start order), and one advanced the injected clock *before* opening a span and then expected a non-zero duration.
- Wiring to `/api/jobs/<id>/trace` (P-216) and `--verbose`/`--trace` printing (P-206) is the CLI/web lane.
- Gate: typecheck 0, lint 0, prettier clean, full core suite 177 passed / 1 skipped files and 2299 passed / 1 skipped tests, exit 0.

## ADR-072: P-249 Gives Concurrency ONE Shared Budget, Serves Priority at the Waiter, and Defers the `TASK_TIMEOUT` Error Code as Coordinated Debt

**Status:** Accepted
**Date:** 2026-10-17

**Context:** P-249 (PHASES_DETAILED.md:12234) adds a bounded concurrency governor: a semaphore pool with priority, per-task timeout and cancellation, plus a global cap of `min(configured, host cpu, sandbox host cap)` shared so sandbox + AI + dep-install compete for one allowance.

**Decisions:**

1. THE BUDGET IS SHARED BY COMPOSITION, NOT BY CONVENTION. A named stage pool takes a slot from a PARENT pool first (`PoolOptions.parent`), and `Limits.pool(name)` wires every stage pool to one global. Three pools at `--jobs 4` would otherwise put twelve containers on a four-core host; the test asserts the combined peak across two pools never exceeds the shared limit.

2. `resolveLimit` NEVER RETURNS BELOW 1 AND TREATS AN ABSENT INPUT AS UNCONSTRAINING. `min(configured, host, sandboxCap)` with a missing value falling back to the host's core count; a pool that can run nothing is a deadlock, not a limit.

3. PRIORITY IS SERVED AT THE WAITER, NOT AT SUBMIT TIME. A queued task carries a priority and its insertion sequence; `#dispatch` picks the highest priority, FIFO within a level. That is what stops an HIL approval (P-160) queueing behind the long build it is meant to unblock. The first implementation had `#acquireWithPriority` drop the priority on the floor — the code was corrected, and the test asserts the observed ORDER (`holder, high, low`), not a counter.

4. A TIMEOUT RESOLVES A TYPED ERROR; IT NEVER REJECTS. `Promise.race` between the task and a deadline that RESOLVES `err(...)` keeps this module throw-free (no rejection is used as control flow). A timed-out task cannot be un-run — a promise is not cancellable — so the `AbortSignal` is what actually stops the work, and the deadline is reported honestly rather than pretended to be a cancellation.

5. CANCELLATION IS PROMPT FOR WAITERS, NOT FOR RUNNERS. A queued waiter listens on its signal and leaves the queue IMMEDIATELY (`queued` drops at once in the test); a task already running is handed the signal and stops at its own next boundary. Claiming more than that would be a lie about what a promise can do.

6. `tryAcquire` EXISTS FOR PREFLIGHT. The phase asks for it explicitly so a caller can avoid deadlocking on a slot it must hold across several steps.

7. **`TASK_TIMEOUT` IS DEFERRED AS COORDINATED DEBT.** A pool deadline is genuinely distinct from `USER_TIMEOUT` (P-156 `ask_user` — no human answered) and `SANDBOX_TIMEOUT` (P-174 — a container blew its budget), so a dedicated code is the right shape. It was TRIALLED and reverted: ADR-066's warning proved accurate — `agent/errors.ts`'s `ERROR_RULES` is a TOTAL `Record` over the union, `errors.test.ts` pins the recovery classification in two lists, and `system/doctor.ts` switches over the union exhaustively, so the new member broke three files at once (`TS2741`, two failing tests, and `TS2366` in a file this phase does not own). P-249 therefore reports a deadline as `INTERNAL` carrying the milliseconds in its message, and records the distinct code as follow-up. Adding an error code is a single coordinated change, not a per-phase one.

**Consequences:**

- Five tests (all spec-named) measure OBSERVED behaviour rather than internals: peak in-flight of six tasks on a two-slot pool; the actual run order for a priority pair and a FIFO pair; a deadline reported without wedging the pool (slot released), a throwing task becoming `INTERNAL`, and an in-time task returning untouched; `min()` resolution plus a measured combined peak across two shared pools; and cancellation where a queued waiter leaves immediately, an already-aborted signal never queues, and `drain()` settles.
- Gate: typecheck 0, lint 0, prettier clean, full core suite 178 passed / 1 skipped files and 2304 passed / 1 skipped tests, exit 0.
- Follow-up recorded for whoever next grows `StitchError`: add `TASK_TIMEOUT` together with its `ERROR_RULES` entry, the `errors.test.ts` recovery lists, and any exhaustive switch.

---

*End of DECISIONS.md. Append new ADRs as decisions are made. Format: `ADR-XXX: Title` with same sections.*
