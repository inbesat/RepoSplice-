# MASTER_PLAN.md — Phased Roadmap & Milestone Tracker
## repo-stitcher: 366 Phases Across 4 Waves, 19 Epics

**Version:** 1.0.0
**Status:** Baseline plan — adjust via ADR only
**Last Updated:** 2026-08-30

---

## 🎯 High-Level Timeline

| Wave | Duration | Focus | Owner | Key Deliverable |
|------|----------|-------|-------|-----------------|
| **Wave 0** | Weeks 1-2 | Foundation + All Dependencies + Contract Freeze | inbesat | Compiling monorepo, frozen `core` API, handoff package |
| **Wave 1** | Weeks 3-6 | Core Logic (inbesat) ∥ CLI + Web (aradhy) | Parallel | Working `stitch merge` end-to-end via CLI + Web UI |
| **Wave 1.5** | Weeks 6-7 | Research Gap Closure (Eval, Cross-Lang, Confidence, MCP) | inbesat/aradhy | Measured baseline + conditional resolution upgrade + confidence + MCP channel |
| **Wave 2** | Weeks 8-9 | Integration + Quality + Docs | Coordinated | Release-ready MVP with tests, CI, docs |
| **Wave 3** | Post-MVP | Advanced/Extensibility | Split by component | Plugins, multi-user, enterprise features |

---

## 📦 Wave 0: Foundation & Dependencies (P-000 to P-068 + P-313–P-317)
**Owner:** inbesat **only** | **Goal:** Zero-conflict scaffold + all deps installed + contract frozen

| Phase Range | Epic | Key Phases | Exit Criteria |
|-------------|------|------------|---------------|
| P-000–P-014 | Foundation | Monorepo init, TS config, ESLint, Vitest, Husky, Changesets, CI skeleton, Dockerfile, ConfigSchema, Pino, neverthrow, util, ARCHITECTURE.md, CONTRIBUTING.md | `bun install` works; `bun run typecheck` passes; `bun test` runs (0 tests); CI green |
| P-015–P-067 | All Dependencies | **68 phases** — every npm dep for core, cli, web + system deps documented + `stitch doctor` | `bun install` zero warnings; lockfile committed; `stitch doctor` passes on clean machine |
| P-313–P-317 | Workflow | Git branching doc, Contract freeze gate, `packages/shared`, Handoff package, Dep request flow | `HANDOFF.md` written; `core/src/types` frozen; aradhy can clone + `bun install` + start Wave 1 |

**Wave 0 Handoff Checklist (inbesat → aradhy):**
- [ ] Repo pushed to shared remote (GitHub)
- [ ] `HANDOFF.md` at root with: clone URL, branch, `bun install`, `bun run dev:cli`, `bun run dev:web`
- [ ] `core/src/types/index.ts` frozen (no breaking changes without version bump)
- [ ] WS message schema in `core/src/types/ws.ts` frozen
- [ ] All deps for `cli` and `web` already in root `package.json` (aradhy never edits `package.json`)
- [ ] `stitch doctor` passes on aradhy's machine

---

## 🔄 Wave 1: Parallel Development (P-069 to P-237)
**Goal:** inbesat builds all `core` logic; aradhy builds `cli` + `web` consuming frozen API

### inbesat Track: Core Logic (Epics 2–9, P-069–P-188)
| Epic | Phases | Description | Depends On |
|------|--------|-------------|------------|
| **2. Git Core** | P-069–P-087 | Clone, filter-repo extract, merge, push, provenance map | Wave 0 complete |
| **3. GitHub** | P-088–P-102 | Auth, repo/tree/file API, create repo C, PR, Actions | Epic 2 (for push) |
| **4. Deps Merge** | P-103–P-117 | Ecosystem detect, parse, union, semver resolve, config merge | Epic 2 (needs repo files) |
| **5. License** | P-118–P-130 | Scan, SPDX, compat matrix, GPL warning, policy, ScanCode opt | Epic 4 (needs manifests) |
| **6. AI Provider** | P-131–P-147 | ChatProvider interface, OpenRouter/OpenAI/Anthropic/Ollama, model registry, tool loop | Wave 0 (deps) |
| **7. Agent Tools** | P-148–P-167 | 10 tools (select, resolve, detect, fix, edit, move, propose, build, ask), policy, state machine | Epic 6 |
| **8. Sandbox** | P-168–P-180 | Docker runner, per-ecosystem images, GH Actions fallback, limits | Epic 7 (tool `run_build`) |
| **9. Provenance** | P-181–P-188 | File→origin map, CREDITS.md, SBOM, git notes, checksum manifest | Epic 2 (git ops) |

**inbesat Milestones:**
- **M1 (P-087):** Git core works — can extract + merge two local repos
- **M2 (P-102):** GitHub integration works — can create repo C + PR
- **M3 (P-117):** Deps merge works — collision report accurate
- **M4 (P-130):** License scan works — SPDX + policy gate
- **M5 (P-147):** AI provider loop works — tool calls execute
- **M6 (P-167):** Agent loop works — auto fixes + gated proposals
- **M7 (P-180):** Sandbox works — build+test in container
- **M8 (P-188):** Provenance works — CREDITS + SBOM generated

### aradhy Track: CLI + Web (Epics 10–11, P-189–P-237)
**Starts:** After Wave 0 handoff (can overlap with inbesat's Epics 2–9)

| Epic | Phases | Description | Consumes (Core API) |
|------|--------|-------------|---------------------|
| **10. CLI** | P-189–P-207 | Commander, 8 commands, Ink TUI, Elysia server, config, autocomplete, binary | `createStitchJob`, `getJobStatus`, `subscribeJobEvents`, `mergeManifests`, `scanLicenses`, `runSandboxBuild` |
| **11. Web UI** | P-208–P-237 | Vite+React+Tailwind, 5 pages, FileTree, DiffViewer, AI stream, WS, settings, a11y | `/api/jobs`, `/ws`, `/api/schema`, core types |

**aradhy Milestones:**
- **A1 (P-207):** CLI works — `stitch merge` runs full pipeline via core
- **A2 (P-222):** Web wizard works — repo pick → file trees → launch
- **A3 (P-237):** Web detail works — live stream, approve gate, results, CREDITS preview

**Integration Points (Wave 1 → Wave 2):**
- inbesat: `core/src/orchestration/eventBus.ts` emits `JobEvent` + `ToolProposal` on WS
- aradhy: `web/src/hooks/useWebSocket.ts` subscribes + renders
- **Contract freeze** (P-314) ensures these types don't change

---

## 🔬 Wave 1.5: Research Gap Closure (P-320 to P-366)
**Goal:** Validate core AI-stitching premise via corpus eval; conditional cross-language resolution; confidence scoring; MCP-first distribution
**Owners:** inbesat (Epics 16, 17, 18) / aradhy (Epic 18 UI, Epic 19)

| Epic | Phases | Owner | Description | Depends On / Condition |
|------|--------|-------|-------------|------------------------|
| **16. Eval Harness** | P-320–P-333 | inbesat | Corpus schema, 20 repo pairs, harness runner, build-pass scoring, human rubric, baseline run (P-327), CI gate, per-eco breakdown, cost tracking, failure taxonomy, corpus expansion, EVAL.md | Wave 1 M5/M6 (sandbox + provenance); **P-327 baseline is go/no-go gate** |
| **17. Cross-Language Resolution** | P-334–P-345 | inbesat | LSP viability spike, generic LSP client, TS/Python/Go/Rust resolvers, heuristic fallback, unified interface, confidence tagging, tool integration, warm caching, accuracy tests | **CONDITIONAL: Only if P-331 shows import-resolution is top-2 failure category** |
| **18. Confidence Scoring** | P-346–P-356 | inbesat + aradhy (UI) | SemanticConfidence schema, self-critique prompt, assess_confidence tool, composite model, threshold policy, CREDITS/web/CLI confidence, calibration, recalibration, tests + CONFIDENCE.md | Epic 16 rubric (P-325) + Epic 17 resolver confidence (P-342) |
| **19. MCP-First Distribution** | P-357–P-366 | aradhy | MCP server scaffold, tools (select_files, merge, check_license), progress streaming, auth passthrough, host compat, registry, quickstart, opt-in telemetry | Post M6 (P-167 agent loop), parallel with Wave 2; supersedes P-299 |

**Wave 1.5 Exit Criteria:**
- [ ] P-327 baseline run complete; build-pass rate, rubric avg, resolve rate documented in DECISIONS.md
- [ ] Epic 17 go/no-go decision recorded with data from P-331 failure taxonomy
- [ ] Epic 18 calibration (P-354) shows self-confidence correlates with human rubric (ρ ≥ 0.5) or documented limitation
- [ ] Epic 19 MCP server published to registry; `MCP_QUICKSTART.md` enables zero-to-merge via MCP alone

---

## 🤝 Wave 2: Integration + Quality + Docs (P-238 to P-282)
**Owner:** Coordinated (file-isolated) | **Goal:** Release-ready MVP

| Epic | Phases | Owner | Description |
|------|--------|-------|-------------|
| **12. Orchestration** | P-238–P-252 | Split (pipeline=inbesat, WS client=aradhy) | Pipeline state machine, job queue, event bus, retry, rollback, contract test |
| **13. Testing/CI/Quality** | P-253–P-267 | Split (core=inbesat, cli/web=aradhy) | Unit/integration/e2e, CI matrix, coverage, perf, security audit |
| **14. Docs/Packaging** | P-268–P-282 | Split (core/docs=inbesat, cli/web docs=aradhy) | README, QUICKSTART, API docs, CLI ref, web docs, publish, changelog |

**Wave 2 Exit Criteria (MVP Release):**
- [ ] `stitch merge` works end-to-end via CLI + Web on 5 diverse repo pairs
- [ ] All tests pass (`bun test`); coverage thresholds met
- [ ] CI green on Linux/macOS/Windows
- [ ] `stitch doctor` passes on clean machines
- [ ] License scan catches injected GPL in test fixture
- [ ] Sandbox builds pass for Node, Python, Go, Rust
- [ ] Web UI accessible (WCAG AA) + responsive
- [ ] Binary releases for 3 platforms + npm packages + Docker image
- [ ] All docs published (README, QUICKSTART, ARCHITECTURE, CONFIG_REF)
- [ ] **Eval corpus (P-321) composite score ≥ [target]% before MVP tag** (target set after P-327)

---

## 🚀 Wave 3: Advanced/Extensibility (P-283 to P-312 + P-320–P-366)
**Owner:** Split by component | **Goal:** Platform features (post-MVP, prioritized by demand)

| Epic | Phases | Owner | Description |
|------|--------|-------|-------------|
| **15. Advanced** | P-283–P-312 | Split | Plugin system, new ecosystems (Go, Rust, Python), AI connectors, template library, smart presets, batch stitch, scheduled merges, multi-user, RBAC, analytics, webhooks, REST/GraphQL API, **MCP server for OpenCode**, VS Code ext, offline models, cost budgets, cache, k8s sandbox, telemetry, SSO, compliance, marketplace, benchmarks, migration, i18n, roadmap |
| **16–19. Research Gap Closure** | P-320–P-366 | inbesat/aradhy | Eval harness, cross-language resolution (conditional), confidence scoring, MCP-first distribution (see Wave 1.5) |

**Prioritization:** Driven by user feedback + adoption metrics. Not planned in detail until MVP ships.

---

## 📊 Phase Dependency Graph (Critical Path)

```
P-000 → P-001 → P-002 → P-003 → P-004 → P-005 → P-006 → P-007 → P-008 → P-009 → P-010 → P-011 → P-012 → P-013 → P-014
                                                                     ↓
P-015 → P-016 → ... → P-067 (all deps) → P-068 (stitch doctor)
                                                                     ↓
P-313 (branch model) → P-314 (contract freeze) → P-315 (shared types) → P-316 (handoff) → P-317 (dep flow)
                                                                     ↓
                    ┌───────────────────────────────────┴───────────────────────────────────┐
                    ▼                                                                       ▼
            inbesat: Epics 2–9                                                          aradhy: Epics 10–11
        (P-069 → P-188)                                                           (P-189 → P-237)
                    │                                                                       │
                    └───────────────────────────────────┬───────────────────────────────────┘
                                                        ▼
                                              Wave 1.5: Epics 16–19
                                             (P-320 → P-366, P-334–P-345 conditional)
                                                        ▼
                                              Wave 2: Epics 12–14
                                             (P-238 → P-282)
                                                        ▼
                                              Wave 3: Epics 15 + 16–19
                                             (P-283 → P-312 + P-320 → P-366)
```

---

## 🎯 Milestone Definitions (Measurable)

| Milestone | Name | Criteria | Target |
|-----------|------|----------|--------|
| **M0** | Repo Scaffolded | Monorepo compiles; CI green; `stitch doctor` passes | End of Wave 0 |
| **M1** | Git Core Works | Can extract paths from A, B via filter-repo; merge to C; push | Week 2 |
| **M2** | GitHub Integration | Can create repo C via API; open PR with CREDITS | Week 3 |
| **M3** | Deps + License | Manifest merge + collision report; license scan + policy gate | Week 4 |
| **M4** | AI Agent Loop | Auto fixes apply; gated proposals appear in UI; loop completes | Week 5 |
| **M5** | Sandbox Verified | Docker build+test passes for 4 ecosystems; GH Actions fallback | Week 5 |
| **M6** | Provenance Complete | CREDITS.md + SBOM + git notes for every file in C | Week 6 |
| **M7** | CLI Ready | All 8 commands work; binary builds; `stitch serve` hosts Web | Week 6 |
| **M8** | Web UI Ready | 5-page wizard + detail view; WS real-time; a11y pass | Week 6 |
| **M9** | MVP Release | All Wave 2 exit criteria met; tagged `v1.0.0` | Week 9 |
| **M10** | Eval Baseline Established | P-327 complete; composite score + failure taxonomy documented; go/no-go decision recorded | Week 7 |
| **M11** | Resolution Upgrade (conditional) | Only if Epic 17 triggered — P-343 re-run shows measurable improvement in import-resolution failure category | Week 7-8 |
| **M12** | Confidence Scoring Live | P-354 calibration complete; confidence visible in CLI, Web, and CREDITS.md | Week 7 |
| **M13** | MCP Channel Live | P-364 complete — tool discoverable and usable from at least one real MCP host | Week 8 |

---

## 📅 Suggested Calendar (9-Week MVP with Research Gap)

| Week | inbesat | aradhy |
|------|---------|--------|
| 1 | P-000–P-014 (Foundation) | — |
| 2 | P-015–P-068 (All Deps) + P-313–P-317 | Onboard; clone repo; verify `stitch doctor` |
| 3 | Epic 2 (Git Core) | Epic 10 start (CLI commands) |
| 4 | Epic 3 (GitHub) + Epic 4 (Deps) | Epic 10 continue + Epic 11 start (Web scaffold) |
| 5 | Epic 5 (License) + Epic 6 (AI Provider) | Epic 11 (Web wizard + WS) |
| 6 | Epic 7 (Agent) + Epic 8 (Sandbox) + Epic 9 (Provenance) | Epic 11 (Detail view + polish) |
| 7 | **Wave 1.5: Epic 16 (Eval Harness)** | **Wave 1.5: Epic 19 (MCP) + Epic 18 UI** |
| 8 | **Epic 16 baseline (P-327) + Epic 17 conditional + Epic 18 (P-354)** | Epic 19 (MCP registry + quickstart) + Epic 18 UI |
| 9 | Epic 12 (Orchestration pipeline) + Epic 13 (Core tests) | Epic 12 (WS client) + Epic 13 (CLI/Web tests) + Epic 18 UI |
| 10 | Epic 14 (Core docs + publish) | Epic 14 (CLI/Web docs) + Release prep |

---

## 🚨 Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `git-filter-repo` Windows issues | Medium | High | Test on Windows early (P-087); document workarounds |
| OpenRouter Gemini 3 bug | Known | Medium | Documented block; default to Claude; test other models |
| Docker not available on CI | Low | Medium | GH Actions fallback implemented (P-175) |
| AI token cost overrun | Medium | Medium | Per-job budget (500k tokens); alert at 80% |
| License false negatives | Low | High | Test fixtures with known GPL/AGPL; ScanCode opt-in |
| Merge conflicts between devs | Low | High | Package isolation + contract freeze (enforced) |
| Web UI WS reconnection flaky | Medium | Low | Exponential backoff + event buffer in hook |
| Binary size too large | Low | Low | `bun build --compile` strips; target <50MB |
| **Eval corpus reveals low resolve rate** | Medium | **Critical** | P-327 baseline is go/no-go; Epic 17 conditional; fallback to human-review |
| **LSP startup cost too high** | Medium | Medium | Heuristic fallback (P-340) primary; warm caching (P-344) secondary |
| **Self-confidence uncorrelated with human** | Medium | High | P-354 calibration gate; P-355 recalibration loop; fallback to threshold policy |

---

## 📈 Success Metrics (MVP)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time-to-green-C | < 5 min | `stitch merge` → sandbox pass |
| Merge success rate | > 80% | Sandbox green on first try |
| License detection | 0% false negatives | GPL/AGPL always flagged |
| Provenance completeness | 100% | Every file in C mapped |
| CLI cold start | < 2s | `time stitch --version` |
| Web UI TTI | < 3s | Lighthouse local |
| Test coverage (core) | 80%/70%/80%/80% | Vitest thresholds |
| Zero critical vulns | 0 | `bun audit` + Dependabot |
| **Eval resolve rate (P-327)** | **≥ [target]%** | Build-pass AND rubric≥4 |
| **Cost per successful merge** | **< [$X]** | P-330 tracking |

---

## 🔄 Plan Amendment Process

1. **Any change to this plan** → Create ADR in `DECISIONS.md` with:
    - What changed (phase added/removed/reordered)
    - Why (new info, blocker, priority shift)
    - Impact on timeline/owners
2. **Both owners approve** (async via PR comment)
3. **Update `MASTER_PLAN.md` + `PROGRESS.md`** in same PR
4. **Communicate** in shared channel

---

*End of MASTER_PLAN.md. This is the living roadmap. Update only via ADR process.*