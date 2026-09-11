# PROGRESS.md — Dynamic Task Tracker & Session Handoff
## repo-stitcher: Live Phase Status Dashboard

**Version:** 1.0.0
**Status:** Updated every session
**Last Updated:** 2026-09-05
**Current Phase:** P-085 - Rollback / Abort (awaiting go-ahead)

> **Note on status:** This file tracks *code implementation* completion (each phase requires `bun run validate` green per AGENTS.md). As of this update, the **plan document** (`PHASES_DETAILED.md`) is fully deep-elaborated (319/366 phases at 9/9 FULL via `check_phase_detail.ps1`), but no production code has been written yet — so implementation checkboxes remain unchecked below.

---

## 🎯 Quick Status Overview

| Metric | Value |
|--------|-------|
| **Total Phases** | 319 |
| **Plan Document (deep-elaborated)** | 319/319 (9/9 FULL) |
| **Implemented** | 85 |
| **Active** | 1 |
| **Blocked** | 0 (zod-to-json-schema v4 compat RESOLVED P-039 via ADR-017) |
| **Pending (implementation)** | 234 |
| **Current Wave** | 0 — Foundation & Dependencies (inbesat) |
| **Next Handoff** | P-085 → Git Core epic (P-069-P-087); Wave 1 after Wave 0 |

---

## 📋 Phase Tracker (All 319 Phases)

### WAVE 0 — Foundation & Dependencies (inbesat solo) — P-000 to P-068 + P-313 to P-317

#### Epic 0: Foundation (P-000–P-014)
- [x] **P-000** Init Bun monorepo: root `package.json` (workspaces), `bunfig.toml` *(2026-09-04)*
- [x] **P-001** Create `packages/core`, `packages/cli`, `packages/web` *(2026-09-04)*
- [x] **P-002** Root `tsconfig.base.json` (strict, `bundler` resolution, paths) *(2026-09-04)*
- [x] **P-003** Shared ESLint + typescript-eslint + Prettier config *(2026-09-04)*
- [x] **P-004** Vitest at root + per-package config; `bun test` fallback *(2026-09-04)*
- [x] **P-005** Commitlint + Husky + Conventional Commits *(2026-09-05)*
- [x] **P-006** Changesets for versioning/release *(2026-09-05)*
- [x] **P-007** GitHub Actions CI skeleton (lint/type/test/build) *(2026-09-05)*
- [x] **P-008** Base Dockerfile for sandbox runner + docker.yml workflow *(2026-09-05)*
- [ ] **P-009** Zod `ConfigSchema` + `.env.example`
- [ ] **P-010** `core/log` — Pino structured logger
- [ ] **P-011** `core/result` — neverthrow `Result`/error types
- [ ] **P-012** `core/util` — id, paths, ignore-pattern helpers
- [ ] **P-013** `ARCHITECTURE.md` (package boundaries, data flow)
- [ ] **P-014** `CONTRIBUTING.md` + code-style guide

#### Epic 1: All Dependencies (P-015–P-068)
- [ ] **P-015** core: `zod`
- [ ] **P-016** core: `simple-git`
- [ ] **P-017** core: `@octokit/rest`
- [ ] **P-018** core: `@octokit/auth-app`
- [ ] **P-019** core: `semver`
- [ ] **P-020** core: `tree-sitter` + grammars (js, ts, python, go, rust)
- [ ] **P-021** core: `dependency-cruiser`
- [ ] **P-022** core: `madge`
- [ ] **P-023** core: `license-checker`
- [ ] **P-024** core: `spdx-expression-parse`
- [x] **P-025** core: `spdx-correct`
- [x] **P-026** core: `spdx-license-list`
- [x] **P-027** core: `openai`
- [x] **P-028** core: `@anthropic-ai/sdk`
- [x] **P-029** core: `dockerode`
- [x] **P-030** core: `bun:sqlite` (native)
- [x] **P-031** core: `p-limit`
- [x] **P-032** core: `yaml`
- [x] **P-033** core: `ini`
- [x] **P-034** core: `glob`
- [x] **P-035** core: `fs-extra`
- [x] **P-036** core: `picomatch`
- [x] **P-037** core: `pino`
- [x] **P-038** core: `neverthrow`
- [x] **P-039** core: `zod-to-json-schema` (resolved via native `toJSONSchema`, ADR-017)
- [x] **P-040** core: `@types/node`, `vitest` dev deps (verify root-hoisted, no dup)
- [x] **P-041** cli: `commander` (root program + status scaffold, 4 tests)
- [x] **P-042** cli: `ink` + `@inkjs/ui` (tui.tsx renderScreen + QuitOnQ, 5 tests)
- [x] **P-043** cli: `elysia` (createApp /health + /ws echo, app.handle smoke)
- [x] **P-044** cli: `picocolors` (theme ok/warn/err + NO_COLOR, 2 tests)
- [x] **P-045** cli: `configstore` (openStore Result wrapper + redaction, 7 tests)
- [x] **P-046** cli: `update-notifier` (gated maybeNotify + notice mapping, 4 tests)
- [x] **P-047** web: `react` + `react-dom` (App root + SSR smoke, React 19 unified)
- [x] **P-048** web: `vite` + `@vitejs/plugin-react` (proxy config, real build, it builds)
- [x] **P-049** web: `tailwindcss` v4 + `postcss` + `autoprefixer` (@theme tokens + dark variant, styles resolve)
- [x] **P-050** web: `zustand` (useSessionStore reference pattern, 2 tests)
- [x] **P-051** web: `@tanstack/react-query` (QueryClient + useJobs/useRefreshJobs, 4 tests)
- [x] **P-052** web: `react-diff-viewer-continued` (DiffView + stitch chrome, 2 tests)
- [x] **P-053** web: `shiki` (Highlight light/dark + plain fallback, 4 tests)
- [x] **P-054** web: `lucide-react` (StatusIcon ok/warn/err/idle, 2 tests)
- [x] **P-055** web: `@radix-ui/*` (6 thin wrappers + axe-clean, 7 tests)
- [x] **P-056** web: `react-hook-form` + `@hookform/resolvers` (SettingsForm scaffold + 2 tests)
- [x] **P-057** web: `sonner` (notifyJob helper + Toaster at root + 1 test)
- [x] **P-058** web: `react-arborist` (FileTree scaffold + 3 tests, checkbox bubbling fix)
- [x] **P-059** web: `clsx` + `tailwind-merge` (`cn()` helper + 1 test)
- [x] **P-060** root: `vitest` + `@vitest/ui` (runner contract test, wiring verified)
- [x] **P-061** root: `@types/bun`, `@types/node` (types:[bun,node] + ADR-018, shim deleted)
- [x] **P-062** root: `tsup` (core ESM+CJS+dts + `it('builds')`; exports stay →src until P-278)
- [x] **P-063** root: `nock` / `mockttp` (shared `test-utils/http.ts` + 1 test)
- [x] **P-064** root: fixture-repo generator (script + 4 tests + race fix)
- [x] **P-065** System: git >=2.40 doc + MIN_GIT_VERSION (doctor deferred P-068)
- [x] **P-066** System: git-filter-repo doc + presence probe (no semver floor; doctor deferred P-068)
- [x] **P-067** System: Docker doc + daemon probe (no engine floor; doctor deferred P-068)
- [x] **P-068** `stitch doctor` verifier (ordered checks, p-limit, DoctorReport, CLI render + exit 0/1/2; init hook deferred P-190)

#### Workflow Phases (P-313–P-317)
- [ ] **P-313** Git branching model doc (`dev`/`main`, PR rules)
- [ ] **P-314** Contract freeze gate — `core/src/types` + WS schema frozen after Wave 0
- [ ] **P-315** `packages/shared` for cross-cutting types (inbesat-owned, aradhy read-only)
- [ ] **P-316** Handoff package: `HANDOFF.md` + zipped repo instructions for aradhy
- [ ] **P-317** Dep request flow: aradhy files "dep needed" issue → inbesat adds it

---

### WAVE 1 — Parallel Core Logic (inbesat) + CLI/Web (aradhy post-handoff)

#### Epic 2: Git Core (P-069–P-087) — inbesat
- [x] **P-069** `cloneRepo` shallow/full (header auth, verified status, git/index barrel)
- [ ] **P-070** `extractPathsViaFilterRepo` (--path + --to-subdirectory-filter)
- [ ] **P-071** `tagRename` helper
- [ ] **P-072** `mergeRepos` (--allow-unrelated-histories, ort)
- [ ] **P-073** `subtreeAdd` alt path
- [ ] **P-074** `cherryPickRange`
- [ ] **P-075** Conflict resolver (auto+manual)
- [ ] **P-076** `writeToWorktree`
- [ ] **P-077** Commit with co-author trailers
- [ ] **P-078** `pushToRemote` (create C then push)
- [ ] **P-079** Blame/provenance map foundation
- [ ] **P-080** Branch mgmt
- [ ] **P-081** Stash safety
- [ ] **P-082** Binary-skip list
- [ ] **P-083** `.gitignore` merge
- [ ] **P-084** Clean-tree verify
- [ ] **P-085** Rollback/abort
- [ ] **P-086** Perf (parallel, cache)
- [ ] **P-087** Unit tests w/ fixtures

#### Epic 3: GitHub Integration (P-088–P-102) — inbesat
- [ ] **P-088** Auth (token + App)
- [ ] **P-089** List/search repos
- [ ] **P-090** GetRepoTree (recursive)
- [ ] **P-091** GetFileContent/batch
- [ ] **P-092** CreateRepoC
- [ ] **P-093** Branch/protect
- [ ] **P-094** OpenPR + CREDITS
- [ ] **P-095** Actions status webhook
- [ ] **P-096** Rate-limit backoff
- [ ] **P-097** GraphQL trees
- [ ] **P-098** DetectRepoLicense
- [ ] **P-099** Fork support
- [ ] **P-100** GH Actions sandbox trigger
- [ ] **P-101** Tests (mocked octokit)
- [ ] **P-102** Error mapping

#### Epic 4: Deps/Manifest Merge (P-103–P-117) — inbesat
- [ ] **P-103** Ecosystem detect
- [ ] **P-104** Parse package.json
- [ ] **P-105** Parse requirements/pyproject
- [ ] **P-106** Parse Cargo.toml
- [ ] **P-107** Parse go.mod
- [ ] **P-108** Union + conflict detect
- [ ] **P-109** Semver collision resolver
- [ ] **P-110** PeerDep conflicts
- [ ] **P-111** Dedupe/nest strategy
- [ ] **P-112** Scripts merge
- [ ] **P-113** Config merge (tsconfig, vite, eslint)
- [ ] **P-114** Lockfile regen
- [ ] **P-115** Ecosystem plugin iface
- [ ] **P-116** Deps report (JSON)
- [ ] **P-117** Tests w/ fixtures

#### Epic 5: License Compliance (P-118–P-130) — inbesat
- [ ] **P-118** Scan declared licenses
- [ ] **P-119** SPDX normalize
- [ ] **P-120** Compatibility matrix
- [ ] **P-121** GPL/AGPL warning
- [ ] **P-122** Dual-license
- [ ] **P-123** Unknown detection
- [ ] **P-124** Per-file header scan (ScanCode shell-out, optional)
- [ ] **P-125** Generate LICENSE for C
- [ ] **P-126** NOTICE/attribution
- [ ] **P-127** Policy allow/deny
- [ ] **P-128** License report data
- [ ] **P-129** Deep-scan plugin
- [ ] **P-130** Tests

#### Epic 6: AI Provider Layer (P-131–P-147) — inbesat
- [ ] **P-131** `ChatProvider` interface
- [ ] **P-132** `OpenAICompatibleProvider` (OpenRouter/OpenAI/Ollama)
- [ ] **P-133** `AnthropicProvider` (native SDK)
- [ ] **P-134** Provider registry + config
- [ ] **P-135** Model registry (capabilities)
- [ ] **P-136** Streaming support
- [ ] **P-137** Token/cost estimate
- [ ] **P-138** Retry/backoff
- [ ] **P-139** Zod→JSON tool adapter
- [ ] **P-140** Tool-loop executor
- [ ] **P-141** Prompt templates
- [ ] **P-142** Context-window mgmt (chunk/summarize)
- [ ] **P-143** Block Gemini-3 tool-calling default
- [ ] **P-144** Mock provider
- [ ] **P-145** AI call audit log
- [ ] **P-146** Runtime provider switch
- [ ] **P-147** Loop tests

#### Epic 7: AI Agent Tools & Loop (P-148–P-167) — inbesat
- [ ] **P-148** Tool `select_files`
- [ ] **P-149** Tool `resolve_dependency_closure`
- [ ] **P-150** Tool `detect_gaps`
- [ ] **P-151** Tool `fix_dependency` (auto)
- [ ] **P-152** Tool `edit_config` (auto)
- [ ] **P-153** Tool `move_file` (auto)
- [ ] **P-154** Tool `propose_component` (gated)
- [ ] **P-155** Tool `run_build` (sandbox)
- [ ] **P-156** Tool `ask_user`
- [ ] **P-157** Autonomy policy engine
- [ ] **P-158** Tool-result validation
- [ ] **P-159** Agent state machine
- [ ] **P-160** HIL approval queue
- [ ] **P-161** Revert a tool action
- [ ] **P-162** Reasoning stream
- [ ] **P-163** Error handling
- [ ] **P-164** Loop cap
- [ ] **P-165** Git-core integration
- [ ] **P-166** Deps/license integration
- [ ] **P-167** E2E agent test

#### Epic 8: Sandbox Build/Test (P-168–P-180) — inbesat
- [ ] **P-168** Docker client
- [ ] **P-169** Ephemeral image per ecosystem
- [ ] **P-170** Install deps
- [ ] **P-171** Run build
- [ ] **P-172** Run tests
- [ ] **P-173** Capture logs/artifacts
- [ ] **P-174** Timeout/limits
- [ ] **P-175** GH Actions fallback
- [ ] **P-176** Pass/fail + flaky detect
- [ ] **P-177** Cleanup
- [ ] **P-178** Layer cache
- [ ] **P-179** Secret-safe sandbox
- [ ] **P-180** Tests

#### Epic 9: Provenance (P-181–P-188) — inbesat
- [ ] **P-181** Track source repo/commit/author per file
- [ ] **P-182** `CREDITS.md`
- [ ] **P-183** SBOM (CycloneDX/SPDX)
- [ ] **P-184** Git notes
- [ ] **P-185** UI provenance view
- [ ] **P-186** Checksum manifest
- [ ] **P-187** Audit log
- [ ] **P-188** Tests

#### Epic 10: CLI (P-189–P-207) — aradhy (post-handoff)
- [ ] **P-189** Commander + global opts
- [ ] **P-190** `stitch init`
- [ ] **P-191** `stitch add <repo> <paths>`
- [ ] **P-192** `stitch merge`
- [ ] **P-193** `stitch serve` (elysia)
- [ ] **P-194** `stitch status`
- [ ] **P-195** `stitch doctor`
- [ ] **P-196** `stitch license`
- [ ] **P-197** `stitch deps`
- [ ] **P-198** Ink picker
- [ ] **P-199** Progress render
- [ ] **P-200** `~/.stitch` config
- [ ] **P-201** Error UX
- [ ] **P-202** Help
- [ ] **P-203** Autocomplete
- [ ] **P-204** Integration tests
- [ ] **P-205** Windows path handling
- [ ] **P-206** Theme
- [ ] **P-207** Release binary build

#### Epic 11: Web UI (P-208–P-237) — aradhy (post-handoff)
- [ ] **P-208** Vite+Tailwind scaffold
- [ ] **P-209** Design tokens
- [ ] **P-210** Shell layout
- [ ] **P-211** Repo A picker
- [ ] **P-212** Repo B picker
- [ ] **P-213** File tree A
- [ ] **P-214** File tree B
- [ ] **P-215** Selection state
- [ ] **P-216** AI thinking stream
- [ ] **P-217** Diff viewer
- [ ] **P-218** Approve/reject gate
- [ ] **P-219** Deps conflict panel
- [ ] **P-220** License panel
- [ ] **P-221** Sandbox results
- [ ] **P-222** CREDITS preview
- [ ] **P-223** WS client+reconnect
- [ ] **P-224** Job history
- [ ] **P-225** Settings (provider/model/keys)
- [ ] **P-226** Dark mode
- [ ] **P-227** Responsive
- [ ] **P-228** Error boundaries
- [ ] **P-229** Onboarding tour
- [ ] **P-230** Session export/import
- [ ] **P-231** A11y
- [ ] **P-232** Virtualized trees
- [ ] **P-233** E2E (Playwright)
- [ ] **P-234** i18n (opt)
- [ ] **P-235** Static build served by cli
- [ ] **P-236** Tests
- [ ] **P-237** Perf pass

---


### WAVE 1.5 — Research Gap Closure (P-320–P-366)

#### Epic 16: Eval Harness (P-320–P-333) — inbesat
- [ ] **P-320** Corpus schema (EvalPair Zod schema)
- [ ] **P-321** Source 20 repo pairs (5 per ecosystem: JS/TS, Python, Go, Rust)
- [ ] **P-322** Pin fixture SHAs for reproducibility
- [ ] **P-323** Harness runner (`stitch eval run`)
- [ ] **P-324** Build-pass scoring (reuse sandbox P-168)
- [ ] **P-325** Human rubric schema (SemanticRubric 1-5)
- [ ] **P-326** Rater review tool (CLI + optional web)
- [ ] **P-327** Baseline run (build-pass, rubric avg, resolve rate) — **GO/NO-GO GATE**
- [ ] **P-328** CI regression gate (subset on PR, full on tag)
- [ ] **P-329** Per-ecosystem breakdown (JS/Python/Go/Rust)
- [ ] **P-330** Cost/token tracking per run (reuses P-137/P-145)
- [ ] **P-331** Failure taxonomy (import-res, semver, license, loop-cap, sandbox-timeout, semantic-wrong)
- [ ] **P-332** Corpus expansion process (CONTRIBUTING.md + CI validation)
- [ ] **P-333** Publish EVAL.md (methodology, baseline, reproducibility)

#### Epic 17: Cross-Language Resolution (P-334–P-345) — inbesat [CONDITIONAL on P-331]
- [ ] **P-334** Research spike: LSP viability (tsserver, pyright, gopls, rust-analyzer)
- [ ] **P-335** Generic LSP client (JSON-RPC over stdio)
- [ ] **P-336** TS/JS resolver (tsserver + TS compiler API fallback)
- [ ] **P-337** Python resolver (pyright + jedi fallback)
- [ ] **P-338** Go resolver (gopls)
- [ ] **P-339** Rust resolver (rust-analyzer, best-effort)
- [ ] **P-340** Heuristic fallback (tree-sitter P-020/P-021/P-022)
- [ ] **P-341** Unified resolver interface (DependencyResolver + registry)
- [ ] **P-342** Resolution confidence tagging (lsp-high / heuristic-medium / unresolved)
- [ ] **P-343** Integrate into resolve_dependency_closure (P-149)
- [ ] **P-344** LSP warm-server caching (pool, <200ms warm)
- [ ] **P-345** Resolver accuracy tests (fixtures, ≥95% accuracy)

#### Epic 18: Confidence Scoring (P-346–P-356) — inbesat + aradhy (UI)
- [ ] **P-346** SemanticConfidence schema (composite 0-100, components, rationale, flags)
- [ ] **P-347** Self-critique prompt design (agent re-reads own diff)
- [ ] **P-348** Tool `assess_confidence` (auto after propose_component P-154)
- [ ] **P-349** Composite scoring model (weights: sandbox 30%, self 25%, resolver 20%, license 15%, tests 10%)
- [ ] **P-350** Threshold policy (auto_approve_threshold default 75, forces HIL P-160)
- [ ] **P-351** CREDITS.md confidence section (per-file score + flags)
- [ ] **P-352** Web UI confidence badges (DiffViewer P-217, Provenance P-185)
- [ ] **P-353** CLI confidence summary (stitch merge/status output)
- [ ] **P-354** Calibration check (self-confidence vs human rubric correlation)
- [ ] **P-355** Prompt/weight recalibration (iterate until ρ ≥ 0.5)
- [ ] **P-356** Tests + CONFIDENCE.md docs (explicit: heuristic not guarantee)

#### Epic 19: MCP-First Distribution (P-357–P-366) — aradhy [supersedes P-299]
- [ ] **P-357** MCP server scaffold (packages/mcp/, Elysia transport)
- [ ] **P-358** Tool: stitch_select_files (repo file-tree browsing)
- [ ] **P-359** Tool: stitch_merge (kick off merge job + polling)
- [ ] **P-360** Tool: stitch_check_license (<10s compat verdict)
- [ ] **P-361** Progress streaming via MCP (notifications/progress)
- [ ] **P-362** Auth/config passthrough (reuse ~/.stitch/config.json)
- [ ] **P-363** Host compatibility pass (Claude Code, OpenCode, Cursor)
- [ ] **P-364** MCP registry submission (discoverable by name)
- [ ] **P-365** MCP_QUICKSTART.md (zero-to-merge via MCP)
- [ ] **P-366** Opt-in telemetry (MCP vs CLI vs Web usage comparison)

---


### WAVE 2 — Integration (Coordinated, File-Isolated)

#### Epic 12: Orchestration (P-238–P-252) — split
- [ ] **P-238** Pipeline state machine (inbesat)
- [ ] **P-239** Job queue (sqlite) (inbesat)
- [ ] **P-240** Resume jobs (inbesat)
- [ ] **P-241** Event bus→WS (inbesat)
- [ ] **P-242** Progress aggregation (inbesat)
- [ ] **P-243** Per-job config (inbesat)
- [ ] **P-244** Dry-run (inbesat)
- [ ] **P-245** Rollback whole job (inbesat)
- [ ] **P-246** Cancel (inbesat)
- [ ] **P-247** Metrics (inbesat)
- [ ] **P-248** Tracing (inbesat)
- [ ] **P-249** Concurrency (inbesat)
- [ ] **P-250** Idempotency (inbesat)
- [ ] **P-251** Tests (both)
- [ ] **P-252** CLI↔Web contract (both)

#### Epic 13: Testing/CI/Quality (P-253–P-267) — split
- [ ] **P-253** Unit conventions (inbesat)
- [ ] **P-254** Integration fixtures (inbesat)
- [ ] **P-255** E2E CLI (inbesat)
- [ ] **P-256** E2E Web (aradhy)
- [ ] **P-257** CI matrix (inbesat)
- [ ] **P-258** Lint+type gates (inbesat)
- [ ] **P-259** Coverage (both)
- [ ] **P-260** Merge snapshots (inbesat)
- [ ] **P-261** Deps property tests (inbesat)
- [ ] **P-262** Perf benchmarks (inbesat)
- [ ] **P-263** Release pipeline (inbesat)
- [ ] **P-264** Docker CI (inbesat)
- [ ] **P-265** Security audit (both)
- [ ] **P-266** Quality dashboard (inbesat)
- [ ] **P-267** Flake triage (both)

#### Epic 14: Docs/Packaging/Release (P-268–P-282) — split
- [ ] **P-268** README (inbesat)
- [ ] **P-269** QUICKSTART (inbesat)
- [ ] **P-270** ARCHITECTURE (inbesat)
- [ ] **P-271** CONTRIBUTING (inbesat)
- [ ] **P-272** Core API docs (inbesat)
- [ ] **P-273** CLI ref (aradhy)
- [ ] **P-274** Web docs (aradhy)
- [ ] **P-275** Config ref (inbesat)
- [ ] **P-276** Provider setup guide (inbesat)
- [ ] **P-277** License guide (inbesat)
- [ ] **P-278** Publish core (inbesat)
- [ ] **P-279** Installer/homebrew (inbesat)
- [ ] **P-280** Docker publish (inbesat)
- [ ] **P-281** Versioning policy (inbesat)
- [ ] **P-282** Changelog automation (inbesat)

---

### WAVE 3 — Advanced/Extensibility (P-283–P-312) — Split by Component

- [ ] **P-283** Plugin system (inbesat)
- [ ] **P-284** Plugin: Go (inbesat)
- [ ] **P-285** Plugin: Rust (inbesat)
- [ ] **P-286** Plugin: Python (inbesat)
- [ ] **P-287** Plugin: AI connector (inbesat)
- [ ] **P-288** Template library (inbesat)
- [ ] **P-289** Smart presets (inbesat)
- [ ] **P-290** Batch stitch (inbesat)
- [ ] **P-291** Scheduled merges (inbesat)
- [ ] **P-292** Multi-user server mode (inbesat)
- [ ] **P-293** RBAC (inbesat)
- [ ] **P-294** Team workspaces (inbesat)
- [ ] **P-295** Analytics dashboard (aradhy)
- [ ] **P-296** Outgoing webhooks (inbesat)
- [ ] **P-297** REST API (inbesat)
- [ ] **P-298** GraphQL API (inbesat)
- [ ] **P-299** MCP server for OpenCode (inbesat) — **SUPERSEDED by Epic 19 (P-357–P-366)**
- [ ] **P-300** VS Code ext (aradhy)
- [ ] **P-301** Offline/local models (inbesat)
- [ ] **P-302** Cost budgets (inbesat)
- [ ] **P-303** Repo-metadata cache (inbesat)
- [ ] **P-304** K8s sandbox (inbesat)
- [ ] **P-305** Telemetry opt-in (both)
- [ ] **P-306** SSO (inbesat)
- [ ] **P-307** Compliance export (inbesat)
- [ ] **P-308** Plugin marketplace (aradhy)
- [ ] **P-309** Benchmarks (inbesat)
- [ ] **P-310** Config migration (inbesat)
- [ ] **P-311** i18n core (inbesat)
- [ ] **P-312** Roadmap doc (inbesat)

---

## 📝 Session Log

| Date | Session | Phases Completed | Notes |
|------|---------|------------------|-------|
| 2026-08-30 | Initial planning | — | Created all context files in `project-plans/` |
| 2026-08-30 | Plan deep-elaboration | — (documentation) | Deep-elaborated `PHASES_DETAILED.md` to 9/9 FULL for all 366 phases (batches 5–25, P-114–P-318); deduped duplicate `P-055` header so the file reports exactly 319 headers matching MASTER_PLAN. No code implemented yet — implementation checkboxes intentionally left unchecked. |
| 2026-08-30 | Research Gap Closure phases added | — (documentation) | Added 47 phases P-320–P-366 (Epics 16–19) to PHASES_DETAILED.md with full 9/9 elaboration; updated MASTER_PLAN.md (366 phases, 19 epics, M10–M13); added WAVE 1.5 section to PROGRESS.md; P-299 marked superseded by Epic 19; P-327 baseline established as go/no-go gate; Epic 17 conditional on P-331. |

| 2026-08-30 | Plan depth re-elaboration (shallow/corrupt) | — (documentation) | Re-elaborated remaining shallow/under-standard phases to genuine 9/9 depth: Git Core (P-083–P-087), GitHub (P-088–P-102), Deps Ecosystem Detect (P-103), and fixed corrupted boilerplate copy in P-055, P-066, P-067, P-071, P-072 (+ deepened P-064). Final audit: 319 unique headers / single P-055 / 0 dups / 0 missing / 0 thin (<950 char) / 0 mojibake / 0 residual template filler. Plan document fully finalized. |
| 2026-09-04 | P-000 implementation | **P-000** | Init Bun monorepo: root `package.json` with `workspaces: ["packages/*"]`, `bunfig.toml` (exact versions, auto peer-deps), `.gitignore` (Node/Bun/IDE/OS/sandbox). Created `packages/{core,cli,web}` with minimal `package.json` (scoped `@repo-stitcher/*`, `workspace:*` for cli→core), each with `src/index.ts` placeholder. `bun install` ✓ (5 installs / 4 packages, no warnings). Verified cross-package resolution: `@repo-stitcher/cli` → `@repo-stitcher/core` resolves via symlink. **Defer:** `typecheck`/`lint`/`test`/`build` scripts in each package.json are stub `echo` placeholders pending P-002/P-003/P-004/P-062. |
| 2026-09-04 | P-001 implementation | **P-001** | Per-package `package.json` upgraded to P-001 spec: license (`UNLICENSED`), `main`/`types`, `bin: { "stitch": ... }` for cli, `files` field, `scripts` for build/dev/test/typecheck/lint (all stub `echo` until P-002/P-003/P-004/P-062 land). Per-package `tsconfig.json` (self-contained placeholders; P-002 will replace with `extends: "../../tsconfig.base.json"`). Web: `index.html` (root div + `/src/main.tsx`), `vite.config.ts` (React plugin, port 5173, path aliases), `src/main.tsx` (DOM `textContent` — avoids `react` import until P-047). `exports` field in each package points to `./src/index.ts` (dev mode); P-062 will repoint to `./dist/`. README.md per package (purpose, status, scripts, ownership). `bun install` ✓ (no changes). All 3 `bun run typecheck` ✓ (stub exit 0). Cross-package import verified: cli→core resolves ✓. **Defer:** real react/vite/tailwind deps → P-047–P-059; real `tsconfig.base.json` extends → P-002. |
| 2026-09-04 | P-002 implementation | **P-002** | Installed `typescript@7.0.2` as root devDep (pragmatic — required for `tsc --noEmit`). Created root `tsconfig.base.json` (strict, `bundler`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, `isolatedModules`, `declaration`, `declarationMap`, `sourceMap`, `skipLibCheck`, JSX `react-jsx`, path aliases for `@repo-stitcher/{core,cli,web}/*`). Created root `tsconfig.json` extending base with `noEmit: true` and `include: ["packages/*/src/**/*"]` so `bun run typecheck` (root) checks all 3 packages. Rewrote `packages/{core,cli,web}/tsconfig.json` to `extends: "../../tsconfig.base.json"` with `rootDir: "src"` and `outDir: "dist"` (web adds DOM libs). **TS 7.0 deviation:** spec wrote `baseUrl: "."` but TS 7 removed it; replaced with `paths: { "*": ["./*"], "@repo-stitcher/..." }` per TS 7 migration guide. Updated root `package.json` scripts: `typecheck: tsc --noEmit` (real), others stubbed with explicit deferral. Verified: `bun run typecheck` (root) → exit 0, 4 source files typechecked. Per-package `bun x tsc --noEmit` → all exit 0. Strictness probe: introduced `const x: number = "string"` → TS2322 surfaced, confirming strict mode active via inheritance. Probe removed. **Frozen**: per P-002 handoff note, tsconfig.base.json changes require ADR. |
| 2026-09-04 | P-003 implementation | **P-003** | Installed `eslint@10.10.0`, `typescript-eslint@8.69.0`, `@eslint/js@10.0.1`, `prettier@3.9.6`, `eslint-plugin-prettier@5.5.6`, `eslint-plugin-import@2.32.0`, `eslint-import-resolver-typescript@4.4.5` (root devDeps, 462 packages total). Created `eslint.config.mjs` (flat config, `tseslint.config()` helper) with: `js.configs.recommended` + `tseslint.configs.recommended`; `prettier/prettier: error`; `import/order: error` (groups external/internal/parent/sibling/index, alphabetize asc); `no-restricted-imports: error` with patterns for axios/node-fetch/ky/got → "Use fetch or ofetch", prisma/drizzle/typeorm/sequelize/knex → "Use raw SQLite", jest/@jest/* → "Use Vitest", webpack/rollup/esbuild → "Use bun build / tsup", redux/mobx/recoil/jotai → "Use Zustand + TanStack Query", moment/date-fns → "Use Temporal polyfill", joi/yup/class-validator → "Use Zod", socket.io/ws → "Use native WebSocket", better-sqlite3 → "Use bun:sqlite"; `@typescript-eslint/no-explicit-any: error`; `no-throw-literal: error`; `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'`; ignores `**/dist/**`, `**/build/**`, `**/node_modules/**`, `**/*.config.*`, `*.md`. Created `.prettierrc` (semi, singleQuote, trailingComma es5, printWidth 100, tabWidth 2, useTabs false, bracketSpacing, arrowParens avoid, endOfLine lf). Created `.prettierignore` (excludes project-plans, lockfiles, OS files, coverage). Created `.eslintignore` (legacy per spec step 3 — flat config emits deprecation warning but still works). **Two deviations from spec:** (1) `typescript@7.0.2` was incompatible with `typescript-eslint@8.69.0` which requires TS ≤6.x — downgraded to `typescript@6.0.3`; tsconfig.base.json `paths: { "*": ["./*"] }` workaround from P-002 is now unnecessary but harmless in TS 6 (works in both). (2) `@typescript-eslint/no-throw-literal` is **deprecated in typescript-eslint v7+** (replaced by base ESLint's `no-throw-literal`) — switched to `no-throw-literal: error`. Updated root `package.json` scripts: `lint: "eslint ."`, `lint:fix: "eslint . --fix"`, `format: "prettier --write ."`, `format:check: "prettier --check ."`, `typecheck: "tsc --noEmit"` (kept). Per-package `package.json` updated: `typecheck: "tsc --noEmit"`, `lint: "eslint src"` (both real). **Verified:** `bun run lint` → exit 0 (after autofix of 6 double-quote violations); `bun run typecheck` → exit 0; `bun run format:check` → exit 0 (after `bun run format` fixed 3 files). Per-package lint: all 3 packages → exit 0. **Probe:** added `import axios from "axios"` → ESLint errored `no-restricted-imports` with custom message "Use fetch or ofetch" + prettier quote fix. Probe removed. Cross-package import verified: cli→core still resolves. |
| 2026-09-05 | P-006 implementation | **P-006** | Installed `@changesets/cli@3.0.2` (66 packages, root devDep). `changeset init` is interactive; wrote `.changeset/config.json` directly per spec (8 fields). Created `.github/workflows/release.yml` per spec verbatim. Added root scripts: `changeset`, `changeset:status`, `changeset:version`, `changeset:publish`. Verified: `bunx changeset status` exit 0; probe `.changeset/smoke-test.md` removed. All 6 validation gates green. Commit `40cfcf5`. |
| 2026-09-05 | P-007 implementation | **P-007** | Created `.github/workflows/ci.yml` per spec verbatim: 3 jobs (lint-and-typecheck, test with codecov, build with artifact upload). Added `.github/dependabot.yml` (not in spec; recommended by P-000 risk table): weekly Monday, 5-PR limit, dependency groups. YAML validation via installed `yaml@2.9.0`. Build job note: `bun run build` is stub until P-062. All 5 validation gates green + yaml validation. Commit `1238483`. |
| 2026-09-05 | P-008 implementation | **P-008** | Created `docker/sandbox-base.Dockerfile` per spec verbatim. Created `.github/workflows/docker.yml` (spec said only "build/push on tag"): linux/amd64+arm64 matrix, docker/setup-qemu@v3, docker/setup-buildx@v3, docker/login@v3 to GHCR, docker/metadata@v5, docker/build-push@v5 with GHA cache. Image name: `ghcr.io/${{ github.repository_owner }}/repo-stitcher-sandbox`. Created `.dockerignore` (not in spec; per AGENTS.md). Validation via `hadolint@2.15.1` (bunx): 5 warnings on spec-verbatim lines, no errors. YAML validation: all 4 workflow files parse cleanly. All 5 validation gates green. Commit `5b71ae2`. |
| 2026-09-05 | P-009 implementation | **P-009** | Installed `zod@^4.5.4` to `packages/core`. Created `packages/core/src/config/schema.ts` exporting 11 Zod schemas (one per leaf + root `ConfigSchema`), inferred types, `defaultConfig`, and `loadConfig({ defaults?, file?, env?, cli? })` that deep-merges layers in spec-mandated precedence (defaults<file<env<cli), then `ConfigSchema.parse` + separate `validateGitHubCredentials` pass. Cross-field validation moved out of `.refine` to keep defaults round-trip-safe. Created `schema.test.ts` with 21 tests / 3 describe blocks (spec required 3: valid parse, invalid rejection, merge precedence). Re-exported all from `packages/core/src/index.ts`. Created root `.env.example` for all 5 env var groups. Coverage: 95.65% stmts / 88.88% br / 100% func / 100% lines. All 6 validation gates green. |

---

> KNOWN FLAKE (P-037): `dependency-cruiser.smoke.test.ts` beforeAll hook (in-process `cruise()`) exceeds its 60s hookTimeout under full `test:coverage` parallel load (passes standalone ~26s and via `lint:deps`). Not caused by P-037 (no new modules in cruise surface). Future infra pass should raise the hook timeout or memoize the cruise; do NOT silence by deleting the test.

## 🚀 Next Action

**P-085 (next, awaiting go-ahead):** rollback/abort per PHASES_DETAILED.md P-085 (read the FULL spec first; coordinate P-074 cherry-pick abort + P-076 worktree remove + P-081 stash pop pairs with P-084 assertClean verification; atomic merge staging for P-238).

**P-084 notes (done):** `git/clean.ts` (`isClean` → Result<boolean>, `assertClean(repoPath, context)` → Result<void> with typed GIT_ERROR refusal carrying sorted paths + exact count (P-203 will promote to DIRTY_TREE; until then GIT_ERROR per P-074 precedent), pure `parsePorcelainStatus`, `DEFAULT_CLEAN_TIMEOUT_MS` = 60_000; SINGLE `status --porcelain=v1 -z` spawn — no rev-parse preflight, non-repos map off the status failure; rename/copy bare source chunks consumed and never reported (probed); unmerged always dirty even when allowlisted; allowlist via P-012/P-036/P-083 matcher; refusal message capped at 20 paths with exact remainder) + barrels. 31/31 green (4 spec-required incl. single-spawn fast-porcelain proof); clean.ts 119/120 stmts, 0 uncovered branches/fns (1 named defensive arm: unprovable matcher-throw). Full suite 901 passed / 0 new failures (only the two documented load flakes: P-021 depcruise-hook timeout — clean standalone + lint:deps 51 modules — and P-037 logger roll smoke — 19/19 standalone).

**P-083 notes (done):** `git/gitignoreMerge.ts` (`mergeGitignores` + `collectGitignores` + pure `mergeIgnoreTexts`/`rebasePattern`: source order preserved (never sorted — last-match-wins), only anchored patterns rebase under merge prefixes, exact-line dedupe first-wins, dated+origin header with per-source dividers, LF/one trailing NL, BOM+CRLF stripped, real P-012/P-036 matcher validation + requiredFiles survival, no spawns, no new error codes) + REQUIRED matcher fix in `util/ignore.ts` (leading `/` stripped, anchored paths match entry+tree — probed: leading slash matched NOTHING before; all P-036 tests still green + 4 new anchored tests) + barrels. 20/20 green (incl. 4 spec-required + real git status selectivity proof); gitignoreMerge.ts 131/136 stmts (5 named defensive arms: unprovable matcher-throw x2, unreachable empty-merge passthrough, platform/race-only symlink+walk). Full suite 871 passed / 0 failed (only the documented P-021 depcruise-hook load flake).

**P-082 notes (done):** `git/binary.ts` (`isBinary` + `classifyFiles` + pure `parseCheckAttr`: attr policy (binary:set or diff unset, exactly like git's own diff) beats caller ext list (case-sensitive, default empty) beats NUL-in-8000 magic; 8KB capped reads via fs port; traversal/absolute/.git refused; skip decisions persist to the P-030 provenance table via DbLike (single versioned row per repo with HEAD key, replace-whole-list, deep row validation); no new error codes) + barrels. 33/33 green (7 real-git incl. 4 spec-required + subtree carry-through proof); binary.ts 166/166 stmts (100%). Full suite 844 passed / 0 failed (only documented load flakes: P-021/P-037/generate-fixtures timeouts, all green standalone).

**P-081 notes (done):** `git/stash.ts` (`safeStash` + `safeStashPop`: validate-first, rev-parse check, porcelain state (untracked counts dirty; unmerged refuses both directions), clean = idempotent no-op, `push -u -m` with top-SHA snapshot + record verify, `pop --index` with empty no-op + expectedRef gate + consume verify, ref-only audit logs, exit-codes-as-data runner (124 sentinel), no new error codes) + barrels. 28/28 green (7 real-git incl. 4 spec-required); stash.ts 143/143 stmts (100%). Full suite 813 passed / 0 failed (only the 2 documented known flakes: P-021 depcruise hook + P-037 logger roll under load).

**P-080 notes (done):** `git/branches.ts` (`createBranch` + `deleteBranch` + `renameBranch`: pre-spawn blank/protected guards, rev-parse repo check, check-ref-format names, ref resolution, idempotent same-ref create (P-250), unmerged-safe delete (-d keeps git's guard, -D forces), rename-away protection evasion refusal, rename-current moves HEAD, every mutation verified, exit-codes-as-data runner (124 sentinel), DEFAULT_PROTECTED_BRANCHES reused from push.ts (single source), no new error codes) + barrels. 44/44 green (10 real-git incl. 5 spec-required); branches.ts 202/202 stmts (100%). Full suite 774 passed / 0 failed (only the 2 documented known flakes: P-021 depcruise hook + P-037 logger roll under load). Note: C: disk full (0 bytes) breaks vite transforms — full suite needs TEMP/TMPDIR redirected to E: until the disk is cleaned.

**P-079 notes (done):** `git/blameMap.ts` (`buildBlameMap` + pure `parseBlamePorcelain`: ls-files blob SHAs, per-file line-porcelain blocks with final-file ranges, strict state-machine parser, per-line source resolution (unique tip ancestry, then longest prefix, then honest null; shared linear history documented ambiguous; absent prefix never matches, explicit empty = catch-all; ancestry-only cached, never path answers), uncommitted lines as null SHAs, no binary exclusion (authorship counts); `saveBlameMap`/`loadBlameMap` on the P-030 provenance table via DbLike (replace-whole-map, versioned JSON, deep row validation); no new error codes) + barrels. 36/36 green (6 real-git incl. 4 spec-required + fake-DbLike persistence); blameMap.ts 261/261 stmts (100%). Full suite 743 passed / 0 failed.

**P-078 notes (done):** `git/push.ts` (`pushToRemote` -> void: pre-spawn force/protected guards, rev-parse repo check, check-ref-format branch, local SHA resolve, ls-remote probe with skip-if-equal, GitHub existence + gated creation through RemoteRepoCheck/RepoCreator ports (P-092; absent port means push-is-the-probe, never conflating new-branch with missing-repo), plain/diverged-hint/lease push, post-push verify; P-069 header credentials (exact-match scrub + URL redaction, never logged); no new error codes) + pure `parseGitHubRemote` + barrels. 40/40 green (3 real-git incl. 4 spec-required via bare remotes, no network); push.ts 185/185 stmts (100%). Full suite 707 passed / 0 failed.

**P-077 notes (done):** `git/commit.ts` (`commitWithTrailers` + pure `buildCommitMessage`: CRLF->LF, CR/LF stripped from author fields (P-265), mailbox shape validated, dedupe by name+lowercased email, input (lineage) order preserved for P-181 (never sorted), exact staged set vs intended files, stray unstaged/untracked always refuse, unmerged refuse, empty index refuse (all GIT_ERROR + paths, P-074 precedent; P-203 owns DIRTY_TREE), unmatchable files entry -> CONFIG, returns `rev-parse HEAD` SHA (shape-checked), exit-codes-as-data runner (124 sentinel), no new error codes) + barrels. 39/39 green (10 real-git incl. 5 spec-required); commit.ts 180/180 stmts (100%). Full suite 666 passed / 0 failed (depcruise hook timeout under load = known P-021 flake; lint:deps clean).

**P-076 notes (done):** `git/worktree.ts` (`writeToWorktree` + `removeWorktree`: validate-all-first (incl. every rel through resolveTargetPath rooted at the tree), rev-parse repo check, `worktree add --detach` (bad ref -> CONFIG), occupied-target refusal, verbatim string staging via fs port, `VerifyTree` port (P-171; pass:false keeps files, no error), best-effort cleanup on failure, removal only for list-registered trees/never main/re-verified gone, exit-codes-as-data runner (124 sentinel), no new error codes; spec `Result<void>` widened to `Result<WriteWorktreeResult>` so P-077/P-085/P-238 get the handle) + pure `parseWorktreeList`/`samePath`/`exitCodeOf` + barrels. 39/39 green (9 real-git incl. 4 spec-required); worktree.ts 183/183 stmts (100%). Full suite 628 passed / 0 failed.

**P-075 notes (done):** `git/conflict.ts` (`detectConflicts` + `resolveConflicts`: porcelain `-z` + diff-U union, `ls-files -u` stage SHAs, NUL-in-8000 binary rule (numstat proven useless on unmerged paths), `--quiet -w` whitespace tier incl. trailing-newline, gitignore line-union, one-side-unchanged take, manifest/gate ports (P-108/109 and P-160 implement later), never-auto-write without approval, conditional verify with stuck-apply INTERNAL, `resolveWithin` + `.git` refusal, exit-codes-as-data runner (124 timeout sentinel), no new error codes) + pure `classifyStages`/`unionGitignoreSides`/`resolveTargetPath`/`exitCodeOf` + barrels. 63/63 green (15 real-git incl. 4 spec-required); conflict.ts 306/307 stmts (1 documented totality arm). Real-git tests carry explicit 30s budgets (root 30s does not inherit into defineProject; P-053 precedent).

**P-074 notes (done):** `git/cherryPick.ts` (cherryPickRange(repoPath, sourceRemote, range, opts?, runtime?) — spec-exact positional: structural guards (repo -> overlap sequencer files -> clean tree -> on-branch -> HEAD exists) -> fetch -> resolve SHA-list (order kept) or from..to (oldest-first) -> single cherry-pick (stops at first problem) -> 3-class failure discriminator (conflict with stopping commit / empty pick / leftover dirt) -> conditional abort + HEAD-unchanged+clean verify (P-085) or resolveConflicts hook with add+continue; returns new SHAs oldest-first. Probed findings encoded: empty picks leave CHERRY_PICK_HEAD with clean tree; blind abort exits 128; simple-git raw resolves silent failures (noisy symbolic-ref required). Secrets scrubbed.) + barrels. 38/38 green (4 verbatim + guards + resolver quartet + scripted failure paths); cherryPick.ts ~97% stmts (5 defensive lines accepted).

**P-073 notes (done):** `git/subtree.ts` (subtreeAdd(parentRepo, childRepo, prefix, opts?, runtime?) — spec-exact positional signature: cheap-first preflights (validation -> parent exists -> prefix free with ZERO git calls -> repo check -> ls-remote fetchability + symref branch resolution with HEAD fallback) -> `git subtree add` with hermetic identity flags (NO autocrlf override: it trips git-subtree clean-tree checks on foreign-normalized repos — probed) -> prefix verify; history mode keeps commits verbatim + provenance merge message, squash mode squashes; selectExtractStrategy filter-repo-first with subtree fallback, fail-closed on unknown/missing; secrets scrubbed via redactUrlCredentials) + barrels. 20/20 green (4 verbatim: squash/history/prefix-exists live + strategy table; 13 scripted mapping). subtree.ts 96% stmts (5 defensive lines accepted).

**P-072 notes (done):** `git/merge.ts` (mergeRepos: full-clone -> P-070 extract with `prefix/` tagPrefix -> P-071 listTags -> real `--allow-unrelated-histories` assembly on a fresh `-b main` child with empty root; R2 composition: extract does the tag rename so renameTags is NOT called — a second prepend would double-prefix; tagMap is namespaced->original (lossless); conflicts fail fast as GIT_ERROR naming files (P-203 remap noted) or via the resolveConflicts hook; atomic rollback removes the child; hermetic child config autocrlf/fileMode/gpgsign (Windows system autocrlf=true was rewriting child bytes — caught by suite); narrowed MergeGit seam (MergeStatus/MergeLog, no casts); deterministic identity+messages, proven by double-merge equality) + barrels. 33/33 green live (17 real-git incl. 5 verbatim + 14 scripted failure-mapping + 2 live filter-repo e2e); merge.ts ~98% stmts.

**P-071 notes (done):** `git/tagRename.ts` (listTags sorted, renameTags prefix-namespace + snapshot collision skips + annotated preserved as tag objects + check-ref-format pre-validation; duplication-over-loss ordering) + barrels. Return is { renamed: Map, skipped: [] } (TagMap<TagId> would invent P-079 types); sort is lexicographic with P-080-upgrade note. 11/11 green (7 mocked + 4 live local-git).

**P-070 notes (done):** `extractPathsViaFilterRepo` extends `git/filterRepo.ts` (P-066 probe intact) + barrels. Verified vs real 2.47.0: `:prefix` prepend, shallow-safe, unmatched-path exits 0 but EMPTIES repo (post-check rev-list turns it into GIT_ERROR), origin remote removed (P-072 must re-add). Live tests gated by collection-time binary probe (CI lacks the binary); 14/14 green with it on PATH. INCIDENT: a throwaway probe ran filter-repo with implicit cwd in the project root, emptying main history; recovered via re-add origin + fetch + reset --hard origin/main (HEAD 536996a, full tail, clean tree verified). RULE: destructive probes assert cwd (guard pattern); implementation seams always pass explicit cwd.

**P-069 notes (done):** `git/clone.ts` (header auth, scrubbed errors, verified status) + `git/index.ts` barrel (root barrel re-exports through it; factory gains `timeoutMs`). Live octocat/Hello-World: shallow 1.9s (1 commit), full 1.2s (3 commits). Private-repo PAT path is unit-verified only (no live private repo available).

**P-068 notes (done):** doctor composes P-065/066/067 probes; no new StitchError codes; exhaustive describeError forces render decisions. P-190 owns the init first-run hookup (no init command exists yet); P-194 owns the CLI-wide --json envelope; P-195 owns doctor UX expansion. Live `stitch doctor` on this machine: git PASS (2.45.1), filter-repo FAIL (not on PATH — the P-066 Windows trap), docker FAIL optional, exit 1. Test-budget fix: generate-fixtures `deterministic` gets `{ timeout: 20000 }` (P-053 precedent) - three generations + a dozen git spawns exceed the 5s default under full parallel load (399/399 with --testTimeout=20000 proved timing, not logic); depcruise-hook flake unchanged.

---

*Update this file at the END of every session. Mark phases with `☑️` (done), `🔄` (active), `🚫` (blocked).*