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

*End of DECISIONS.md. Append new ADRs as decisions are made. Format: `ADR-XXX: Title` with same sections.*