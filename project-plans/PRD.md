# PRD.md — Product Requirements Document
## repo-stitcher: Multi-Repo Composition Engine with AI-Augmented Stitching

**Version:** 1.0.0-draft
**Status:** Draft — awaiting stakeholder sign-off
**Owners:** inbesat (core, architecture), aradhy (CLI, Web UI)
**Last Updated:** 2026-08-30

---

## 1. Core Goal (Elevator Pitch)

**repo-stitcher** is a developer tool that takes **two (or more) existing Git repositories (A, B, …)** and produces a **new, runnable, history-preserving child repository C** — not by naive file copying, but by:

1. **Intelligently selecting** only the files you need from each parent repo (with dependency closure).
2. **Merging manifests** (package.json, pyproject.toml, Cargo.toml, go.mod, etc.) and resolving version collisions.
3. **Checking license compatibility** before you commit legal risk.
4. **Running an AI agent loop** that:
   - Detects gaps (broken imports, missing config, conflicting entrypoints).
   - **Auto-fixes mechanical issues** (dependency versions, config merges, file moves).
   - **Proposes net-new bridging components** (adapters, facades, wiring code) for human approval.
5. **Verifying the result** in an ephemeral sandbox (Docker) — build + test must pass.
6. **Emitting provenance** (CREDITS.md, SBOM, per-file git blame mapping) so C is auditable.

**Outcome:** A repo C that **compiles, runs, passes tests, and has clear legal provenance** — ready to ship or iterate.

---

## 2. User Journeys & Personas

### Persona 1: **Platform Engineer / Infra Lead (Primary)**
- **Context:** Owns internal developer platform; needs to compose "auth service from repo A" + "dashboard UI from repo B" into a new service C.
- **Pain:** Manual `git subtree` + dependency hell + broken builds + license risk.
- **Goal:** `stitch merge --from A:auth --from B:dashboard --out C` → green CI in minutes.

### Persona 2: **Full-Stack Developer (Secondary)**
- **Context:** Building a new microservice; wants to pull battle-tested modules from 2-3 company templates.
- **Pain:** Copy-paste doesn't bring history, deps conflict, `git blame` is useless.
- **Goal:** Visual picker in web UI → select folders → AI resolves gaps → working repo.

### Persona 3: **Open-Source Maintainer (Tertiary)**
- **Context:** Wants to extract a library from a monorepo and publish it standalone with clean history.
- **Pain:** `git filter-repo` is arcane; provenance is manual.
- **Goal:** `stitch extract --path pkg/mylib --to-subdir mylib --publish`.

### Persona 4: **Security / Compliance Engineer (Observer)**
- **Context:** Must approve any merged repo before it enters prod.
- **Pain:** License scanning is separate, manual, often skipped.
- **Goal:** Automated license report + SBOM baked into every merge; policy gate in CI.

---

## 3. Feature Scope — MVP (Must Have)

| ID | Feature | Description | Acceptance Criteria |
|----|---------|-------------|---------------------|
| **F-01** | **Repo Selection** | CLI + Web UI to pick source repos (GitHub URL, branch, paths). Supports private repos via token/App auth. | Can select `owner/repo@branch` + glob paths for A and B. |
| **F-02** | **Dependency Closure** | Given selected files, automatically include all transitive imports (TS/JS, Python, Go, Rust). | `stitch add A:src/auth` pulls `src/auth`, `src/utils`, `src/config` automatically. |
| **F-03** | **History-Preserving Merge** | Uses `git filter-repo --path --to-subdirectory-filter` + `git merge --allow-unrelated-histories`. | `git log --oneline C` shows commits from A (prefixed) and B (prefixed); `git blame` works. |
| **F-04** | **Manifest Merge** | Parses `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`; unions deps; flags semver collisions; suggests resolution. | Merged `package.json` has no duplicate keys; conflicts reported with suggested fix. |
| **F-05** | **License Compliance** | Scans declared licenses from manifests; normalizes to SPDX; checks compatibility matrix (permissive vs copyleft); warns on GPL/AGPL in MIT project. | Report shows: A=MIT, B=Apache-2.0 → OK; A=GPL-3.0, B=MIT → BLOCK/WARN. |
| **F-06** | **AI Agent Loop (Hybrid Autonomy)** | - **Auto:** fix_dependency, edit_config, move_file<br>- **Gated (human approve):** propose_component (new bridging code) | Auto fixes apply silently; proposals appear in Web UI diff viewer with Accept/Reject. |
| **F-07** | **Sandbox Verification** | Spins up Docker container per ecosystem; runs `install → build → test`; reports pass/fail + logs. | Green = merged repo builds and tests pass; Red = block merge, show logs. |
| **F-08** | **Provenance Artifacts** | Generates `CREDITS.md` (file → source repo/commit/author), CycloneDX SBOM, git notes. | Every file in C traceable to origin; SBOM valid SPDX. |
| **F-09** | **CLI** | `stitch init`, `stitch add`, `stitch merge`, `stitch serve`, `stitch doctor`, `stitch status`. | All commands work end-to-end on a fresh machine with only `git`, `docker`, `bun`. |
| **F-10** | **Web UI** | Dashboard served by `stitch serve`: repo pickers, file trees, AI thinking stream, diff viewer, approve gate, license panel, sandbox results, CREDITS preview. | Full merge flow doable in browser; real-time WS updates. |
| **F-11** | **Multi-Provider AI** | Pluggable `ChatProvider`: OpenRouter (default), OpenAI, Anthropic, Ollama. Config-driven model selection. | Switch provider in settings without code change; tool calling works across all. |
| **F-12** | **Project Persistence** | SQLite job queue; resume interrupted merges; history of past stitches. | `stitch status` shows past jobs; can resume after crash. |

---

## 4. Out of Scope (Explicit Boundaries)

| ID | Excluded | Rationale |
|----|----------|-----------|
| **O-01** | **General-purpose code generation** (write a whole app from scratch) | We stitch *existing* code; generation is only for *bridging gaps*. |
| **O-02** | **Runtime deployment / hosting** | We produce a repo; deploy is user's CI/CD. |
| **O-03** | **Multi-repo sync / ongoing sync** | One-time merge; ongoing sync is Copybara/FBShipIt territory. |
| **O-04** | **Binary asset merging** (images, compiled artifacts) | Only source code + manifests; binaries are user's problem. |
| **O-05** | **Legal advice / license interpretation** | We surface SPDX data + warnings; lawyer reviews. |
| **O-06** | **Non-Git VCS** (SVN, Perforce) | Git-only; scope containment. |
| **O-07** | **GUI for git-filter-repo internals** | CLI flags exposed; advanced users use filter-repo directly. |
| **O-08** | **Multi-user SaaS / RBAC / org workspaces** | Post-MVP (Epic 15). |
| **O-09** | **VS Code extension / IDE integration** | Post-MVP. |
| **O-10** | **Support for >2 parent repos in single merge** | MVP = 2 parents; batch stitch (Epic 15) handles N. |

---

## 5. Edge Cases & Error States

| Scenario | Handling |
|----------|----------|
| **Network failure during clone** | Retry with exponential backoff (3x); cache shallow clones locally; surface clear error. |
| **GitHub API rate limit** | Backoff + `Retry-After` respect; show progress; allow token swap. |
| **`git-filter-repo` not installed** | `stitch doctor` detects; prints install instructions (`pipx install git-filter-repo`); blocks merge. |
| **Docker not running** | `stitch doctor` detects; falls back to GitHub Actions sandbox (if GH token present); else error. |
| **Manifest parse failure** (malformed package.json) | Graceful degradation: treat as opaque JSON, warn, allow manual override. |
| **License detection unknown** | Mark as `UNKNOWN`; require human decision; block auto-merge if policy=strict. |
| **AI proposes invalid code** | Sandbox catches at build/test; proposal auto-rejected; AI retries (max 3). |
| **Circular dependency between A and B imports** | Detect via dependency-cruiser; report; require manual resolution. |
| **Path collision** (same relative path in A and B) | Auto-rename with prefix (`a-`, `b-`); show in diff; allow override. |
| **Empty selection** (user picks no files) | Block merge; show friendly error. |
| **Huge repo (>10k files)** | Shallow clone + sparse checkout; stream file tree; virtualized UI. |
| **Private repo without auth** | Clear error: "Auth required — run `stitch auth github` or set `GITHUB_TOKEN`." |
| **AI tool call loop exceeds max iterations** | Hard cap (default 25); abort with summary; allow resume. |
| **Sandbox OOM / timeout** | Configurable limits (default: 4GB, 10min); kill container; report. |
| **Concurrent merges on same machine** | SQLite job queue with advisory locks; serialize or queue. |

---

## 6. Success Metrics (MVP)

| Metric | Target |
|--------|--------|
| **Time-to-green-C** (from `stitch init` to passing sandbox) | < 5 min for typical 2-repo stitch |
| **Merge success rate** (sandbox green on first try) | > 80% |
| **License false-negative rate** | 0% (any GPL/AGPL must be flagged) |
| **Provenance completeness** | 100% of files in C mapped to source |
| **CLI cold-start time** | < 2s (Bun) |
| **Web UI TTI (Time to Interactive)** | < 3s on localhost |

---

## 7. Release Criteria

- [ ] All F-01..F-12 implemented and tested
- [ ] 5 diverse repo pairs stitch successfully (JS+TS, Python+Go, Rust+JS, monorepo extraction, private+public)
- [ ] `stitch doctor` passes on clean macOS/Linux/Windows
- [ ] License scan catches injected GPL in MIT test fixture
- [ ] Sandbox builds pass on all 4 supported ecosystems
- [ ] Web UI accessible (WCAG AA) and responsive
- [ ] Docs: README, QUICKSTART, ARCHITECTURE, CONFIG_REF
- [ ] Changeset release published to npm + GitHub Releases

---

## 8. Assumptions & Dependencies

| Assumption | Validation |
|------------|------------|
| User has `git` ≥2.40, `docker`, `bun` ≥1.1 installed | `stitch doctor` enforces |
| GitHub token has `repo` + `workflow` scopes | Auth flow validates |
| OpenRouter API key valid for tool-calling models | Provider health check at startup |
| Repos use standard manifest locations (`package.json` at root, etc.) | Configurable search paths |
| AI model supports OpenAI-compatible tool calling | Model registry filters unsupported |

---

## 9. Glossary

| Term | Definition |
|------|------------|
| **Parent Repo** | Source repository A or B (or more) |
| **Child Repo (C)** | Output repository produced by stitching |
| **Dependency Closure** | All files transitively imported by selected files |
| **Filter-Repo** | `git-filter-repo` tool for history rewriting |
| **Subtree Merge** | Git merge strategy preserving subdirectory history |
| **Hybrid Autonomy** | AI auto-executes mechanical fixes; asks before net-new code |
| **SBOM** | Software Bill of Materials (CycloneDX/SPDX) |
| **CREDITS.md** | Human-readable provenance file mapping chunks → origin |
| **ChatProvider** | Abstract interface for LLM providers (OpenRouter, Anthropic, etc.) |
| **Tool Call** | Structured request from LLM to execute a local function |
| **Orchestration Bus** | Internal event bus (WS) for real-time progress to UI |

---

*End of PRD. This document is the single source of truth for product scope. Any feature not listed here is out of scope for MVP.*