# PROGRESS.md — Dynamic Task Tracker & Session Handoff
## repo-stitcher: Live Phase Status Dashboard

**Version:** 1.0.0
**Status:** Updated every session
**Last Updated:** 2026-08-30
**Current Wave:** 0 (Foundation + Dependencies)
**Current Phase:** P-000 (Not Started)

---

## 🎯 Quick Status Overview

| Metric | Value |
|--------|-------|
| **Total Phases** | 319 |
| **Completed** | 0 |
| **Active** | 0 |
| **Blocked** | 0 |
| **Pending** | 319 |
| **Current Wave** | 0 — Foundation & Dependencies (inbesat) |
| **Next Handoff** | After P-068 → aradhy starts Wave 1 (CLI + Web) |

---

## 📋 Phase Tracker (All 319 Phases)

### WAVE 0 — Foundation & Dependencies (inbesat solo) — P-000 to P-068 + P-313 to P-317

#### Epic 0: Foundation (P-000–P-014)
- [ ] **P-000** Init Bun monorepo: root `package.json` (workspaces), `bunfig.toml`
- [ ] **P-001** Create `packages/core`, `packages/cli`, `packages/web`
- [ ] **P-002** Root `tsconfig.base.json` (strict, `bundler` resolution, paths)
- [ ] **P-003** Shared ESLint + typescript-eslint + Prettier config
- [ ] **P-004** Vitest at root + per-package config; `bun test` fallback
- [ ] **P-005** Commitlint + Husky + Conventional Commits
- [ ] **P-006** Changesets for versioning/release
- [ ] **P-007** GitHub Actions CI skeleton (lint/type/test/build)
- [ ] **P-008** Base Dockerfile for sandbox runner image
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
- [ ] **P-025** core: `spdx-correct`
- [ ] **P-026** core: `spdx-license-list`
- [ ] **P-027** core: `openai` (OpenRouter/OpenAI/Ollama client)
- [ ] **P-028** core: `@anthropic-ai/sdk`
- [ ] **P-029** core: `dockerode`
- [ ] **P-030** core: `bun:sqlite` (native)
- [ ] **P-031** core: `p-limit`
- [ ] **P-032** core: `yaml`
- [ ] **P-033** core: `ini`
- [ ] **P-034** core: `glob`
- [ ] **P-035** core: `fs-extra`
- [ ] **P-036** core: `picomatch`
- [ ] **P-037** core: `pino`
- [ ] **P-038** core: `neverthrow`
- [ ] **P-039** core: `zod-to-json-schema`
- [ ] **P-040** core: `@types/node`, `vitest` dev deps
- [ ] **P-041** cli: `commander`
- [ ] **P-042** cli: `ink` + `@inkjs/ui`
- [ ] **P-043** cli: `elysia`
- [ ] **P-044** cli: `picocolors`
- [ ] **P-045** cli: `configstore`
- [ ] **P-046** cli: `update-notifier`
- [ ] **P-047** web: `react` + `react-dom`
- [ ] **P-048** web: `vite` + `@vitejs/plugin-react`
- [ ] **P-049** web: `tailwindcss` + `postcss` + `autoprefixer`
- [ ] **P-048** web: `zustand`
- [ ] **P-049** web: `@tanstack/react-query`
- [ ] **P-050** web: `react-diff-viewer-continued`
- [ ] **P-051** web: `shiki`
- [ ] **P-052** web: `lucide-react`
- [ ] **P-053** web: `@radix-ui/*` (dialog, select, tabs, tooltip, etc.)
- [ ] **P-054** web: `react-hook-form` + `@hookform/resolvers`
- [ ] **P-055** web: `sonner`
- [ ] **P-056** web: `react-arborist`
- [ ] **P-057** web: `clsx` + `tailwind-merge`
- [ ] **P-058** root: `vitest` + `@vitest/ui`
- [ ] **P-059** root: `@types/bun`, `@types/node`
- [ ] **P-060** root: `tsup`
- [ ] **P-061** root: `nock` / `mockttp`
- [ ] **P-062** root: fixture-repo generator
- [ ] **P-063** System: Doc `git` ≥2.40 requirement
- [ ] **P-064** System: Doc `git-filter-repo` (pip) install
- [ ] **P-065** System: Doc Docker requirement
- [ ] **P-066** `stitch doctor` system-dep verifier
- [ ] **P-067** Lockfile + dedupe (`bun install` audit)

#### Workflow Phases (P-313–P-317)
- [ ] **P-313** Git branching model doc (`dev`/`main`, PR rules)
- [ ] **P-314** Contract freeze gate — `core/src/types` + WS schema frozen after Wave 0
- [ ] **P-315** `packages/shared` for cross-cutting types (inbesat-owned, aradhy read-only)
- [ ] **P-316** Handoff package: `HANDOFF.md` + zipped repo instructions for aradhy
- [ ] **P-317** Dep request flow: aradhy files "dep needed" issue → inbesat adds it

---

### WAVE 1 — Parallel Core Logic (inbesat) + CLI/Web (aradhy post-handoff)

#### Epic 2: Git Core (P-069–P-087) — inbesat
- [ ] **P-069** `cloneRepo` (shallow/full)
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
- [ ] **P-299** MCP server for OpenCode (inbesat)
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

---

## 🚀 Next Action

**Start Wave 0, Phase P-000:** Initialize Bun monorepo with workspaces.

**Command to run when ready:**
```bash
cd E:\git\project && mkdir -p repo-stitcher && cd repo-stitcher && bun init -y
```

---

*Update this file at the END of every session. Mark phases with `☑️` (done), `🔄` (active), `🚫` (blocked).*