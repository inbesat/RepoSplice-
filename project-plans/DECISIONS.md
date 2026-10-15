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

*End of DECISIONS.md. Append new ADRs as decisions are made. Format: `ADR-XXX: Title` with same sections.*
