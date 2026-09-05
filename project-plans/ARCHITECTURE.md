# ARCHITECTURE.md — System Architecture Blueprint
## repo-stitcher: Complete Technical Architecture

**Version:** 1.1.0
**Status:** Frozen for MVP (Wave 0 foundation ships P-000…P-012; see §12)
**Last Updated:** 2026-09-05

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            USER INTERFACES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐                    ┌─────────────────────────────────┐ │
│  │   CLI (ink)     │                    │   Web UI (React + Vite)         │ │
│  │  - Commands     │                    │  - Dashboard                    │ │
│  │  - TUI Picker   │                    │  - Merge Wizard                 │ │
│  │  - Progress     │                    │  - Diff Viewer                  │ │
│  └────────┬────────┘                    │  - Approve Gate                 │ │
│           │                             │  - License Panel                │ │
│           ▼                             │  - Sandbox Results              │ │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    CLI HTTP/WS SERVER (Elysia)                       │  │
│  │  - Serves Web UI static assets                                      │  │
│  │  - WebSocket /ws for real-time events                               │  │
│  │  - REST /api/* for job control                                      │  │
│  └────────────────────────────┬────────────────────────────────────────┘  │
└───────────────────────────────│────────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CORE LIBRARY (packages/core)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌─────────┐ ┌────────┐ ┌──────────┐  │
│  │  Git     │ │ GitHub   │ │ Deps   │ │ License │ │  AI    │ │ Sandbox  │  │
│  │  Ops     │ │  API     │ │ Merge  │ │  Scan   │ │ Agent  │ │  Runner  │  │
│  └────┬─────┘ └────┬─────┘ └───┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘  │
│       │            │           │           │           │           │        │
│       ▼            ▼           ▼           ▼           ▼           ▼        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ORCHESTRATION ENGINE                              │   │
│  │  - Pipeline State Machine (init → select → resolve → merge →        │   │
│  │    ai-loop → verify → publish)                                       │   │
│  │  - Job Queue (SQLite) + Event Bus (WS)                               │   │
│  │  - Retry/Rollback/Resume Logic                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│                                    ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    PROVENANCE & STORAGE                              │   │
│  │  - CREDITS.md generator                                              │   │
│  │  - SBOM (CycloneDX/SPDX)                                             │   │
│  │  - Git Notes for per-file provenance                                 │   │
│  │  - SQLite: jobs, events, repo_cache, provider_usage, settings       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SYSTEMS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  GitHub API    │  Docker Engine    │  LLM Providers    │  Git Binary       │
│  (Octokit)     │  (dockerode)      │  (OpenRouter,     │  (simple-git +    │
│                │                   │   Anthropic,      │   git-filter-repo)│
│                │                   │   Ollama)         │                   │
└────────────────┴───────────────────┴───────────────────┴───────────────────┘
```

---

## 2. Package Boundaries & Dependency Rules

```
@repo-stitcher/core     ──►  (no internal deps) — PURE LOGIC
       ▲
       │ imports PUBLIC API only (packages/core/src/index.ts)
       │
@repo-stitcher/cli      ──►  @repo-stitcher/core
@repo-stitcher/web      ──►  @repo-stitcher/core  (via HTTP/WS, NOT direct import)
```

**Hard Rules:**
- `core` **never** imports `cli` or `web`.
- `cli` and `web` **never** import each other.
- `web` talks to `core` **only** via the CLI's HTTP/WS API (served by `stitch serve`).
- Shared types live in `core/src/types/` — exported via `core` public API; `web` fetches them via `/api/schema` or generates from OpenAPI.

---

## 3. Core Module Architecture (packages/core)

### 3.1 Public API Surface (`src/index.ts`)

```ts
// Types (frozen contract)
export type {
  RepoRef,           // { owner, repo, branch, paths[] }
  StitchInput,       // { repos: RepoRef[], options }
  StitchOutput,      // { childRepo, credits, sbom, sandboxResult }
  Job, JobEvent,
  ProviderConfig,
  LicenseReport,
  DependencyReport,
  SandboxResult,
  ProvenanceEntry,
} from './types';

// Core Functions
export { createStitchJob, resumeJob, cancelJob } from './orchestration/jobQueue';
export { getJobStatus, subscribeJobEvents } from './orchestration/eventBus';
export { mergeManifests, detectCollisions } from './deps/merge';
export { scanLicenses, checkCompatibility } from './license/scan';
export { runSandboxBuild } from './sandbox/runner';
export { generateCredits, generateSBOM } from './provenance/generator';

// AI (advanced)
export { createAgent, type ChatProvider, type Tool } from './ai/agent';

// Config
export { loadConfig, ConfigSchema } from './config/schema';
```

### 3.2 Module Details

#### `git/` — Git Operations
| File | Responsibility |
|------|----------------|
| `clone.ts` | `cloneRepo(url, opts)` — shallow/full, auth, cache to `.stitch/cache/repos/` |
| `filterRepo.ts` | `extractPaths(repoPath, paths, targetSubdir)` — wraps `git-filter-repo --path --to-subdirectory-filter --tag-rename` |
| `merge.ts` | `mergeRepos(repoA, repoB, strategy)` — `git merge --allow-unrelated-histories -s ort` |
| `subtree.ts` | `subtreeAdd(parent, child, prefix)` — alternative to filter-repo |
| `cherryPick.ts` | `cherryPickRange(source, commitRange, target)` |
| `conflicts.ts` | `detectConflicts()`, `resolveConflict(strategy)` |
| `commit.ts` | `commitWithTrailers(message, coAuthors)` |
| `push.ts` | `pushToRemote(remote, branch, force?)` |
| `provenance.ts` | `mapBlame(childRepo, parentRepos)` — builds file→origin map |
| `util.ts` | `isClean()`, `stash()`, `unstash()`, `getCurrentBranch()` |

#### `github/` — GitHub API
| File | Responsibility |
|------|----------------|
| `auth.ts` | `createOctokit(token | appAuth)` — supports PAT + GitHub App |
| `repos.ts` | `listUserRepos()`, `searchRepos(query)`, `getRepo(owner, repo)` |
| `trees.ts` | `getTree(owner, repo, branch, recursive)` — returns flat file list |
| `contents.ts` | `getFile(owner, repo, path, branch)` + batch |
| `create.ts` | `createRepo(name, private, template?)` |
| `pr.ts` | `createPR(base, head, title, body)` |
| `actions.ts` | `triggerWorkflow(repo, workflow, inputs)`, `pollRun(runId)` |
| `rateLimit.ts` | `withBackoff(fn)` — respects `Retry-After` |

#### `deps/` — Dependency & Manifest Merge
| File | Responsibility |
|------|----------------|
| `detect.ts` | `detectEcosystem(repoPath)` → `'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go'` |
| `parse/` | Per-ecosystem parsers: `npm.ts`, `python.ts`, `cargo.ts`, `go.ts` |
| `merge.ts` | `unionManifests(manifests[])` → `{ merged, conflicts[] }` |
| `semver.ts` | `resolveCollision(rangeA, rangeB)` → compatible range or `null` |
| `scripts.ts` | `mergeScripts(scriptsA, scriptsB)` — prefix conflicts |
| `config.ts` | `mergeConfigFiles(files[])` — tsconfig, vite, eslint, etc. |
| `lockfile.ts` | `regenerateLockfile(manifest, ecosystem)` — best effort |
| `report.ts` | `generateDepReport(merged, conflicts)` — JSON for UI |

#### `license/` — License Compliance
| File | Responsibility |
|------|----------------|
| `scan.ts` | `scanDeclaredLicenses(repoPath)` — runs `license-checker` on manifests |
| `spdx.ts` | `normalizeToSPDX(raw)` — uses `spdx-correct` |
| `compat.ts` | `checkCompatibility(licenses[])` → `{ allowed, warnings[], errors[] }` |
| `matrix.ts` | Hardcoded SPDX compatibility matrix (permissive ✅, copyleft ⚠️, network 🚫) |
| `policy.ts` | `loadPolicy(config)` — allowlist/denylist; `evaluate(report, policy)` |
| `deepScan.ts` | Optional: `runScanCode(repoPath)` — shells to `scancode-toolkit` |
| `report.ts` | `generateLicenseReport(scan, compat, policy)` |

#### `ai/` — AI Provider Layer & Agent Loop
| File | Responsibility |
|------|----------------|
| `provider.ts` | `ChatProvider` interface + `OpenAICompatibleProvider`, `AnthropicProvider`, `OllamaProvider` |
| `registry.ts` | `ModelRegistry` — loads `models.json`; filters by `supportsTools` |
| `tools/` | Tool definitions (Zod schemas → JSON Schema via `zod-to-json-schema`) |
| `tools/selectFiles.ts` | `select_files` — proposes which files to pull from each repo |
| `tools/resolveDeps.ts` | `resolve_dependency_closure` — walks imports, returns required files |
| `tools/detectGaps.ts` | `detect_gaps` — finds broken imports, missing config, entrypoint conflicts |
| `tools/fixDeps.ts` | `fix_dependency` — auto: edits manifest versions |
| `tools/editConfig.ts` | `edit_config` — auto: merges tsconfig, eslint, etc. |
| `tools/moveFile.ts` | `move_file` — auto: relocates files to avoid collisions |
| `tools/proposeComponent.ts` | `propose_component` — **gated**: generates new bridging code (adapter, facade) |
| `tools/runBuild.ts` | `run_build` — triggers sandbox, returns result |
| `tools/askUser.ts` | `ask_user` — clarification questions (e.g., "which entrypoint?") |
| `loop.ts` | `runAgentLoop(input, tools, policy)` — multi-turn; respects autonomy policy |
| `policy.ts` | `AutonomyPolicy` — `{ auto: ToolName[], gated: ToolName[] }` |
| `context.ts` | `buildContext(repoTree, selection, gaps)` — token-budgeted context for LLM |
| `stream.ts` | `streamReasoning(iterator)` — yields `ReasoningChunk` for WS |

#### `sandbox/` — Build/Test Verification
| File | Responsibility |
|------|----------------|
| `docker.ts` | `DockerClient` wrapper (dockerode) — create, start, exec, logs, cleanup |
| `images.ts` | `getSandboxImage(ecosystem)` — returns tag for prebuilt base image |
| `runner.ts` | `runBuildTest(repoPath, ecosystem, opts)` — `install → build → test` |
| `fallback.ts` | `runViaGitHubActions(repoPath, ...)` — if Docker unavailable |
| `limits.ts` | `ResourceLimits` — memory, cpu, timeout, pids |
| `security.ts` | `hardenContainer()` — no network, read-only, drop caps |

#### `provenance/` — Audit Trail
| File | Responsibility |
|------|----------------|
| `credits.ts` | `generateCredits(map)` → `CREDITS.md` (human-readable) |
| `sbom.ts` | `generateSBOM(map)` → CycloneDX JSON |
| `gitNotes.ts` | `attachProvenanceNotes(repo, map)` — `git notes add` per file |
| `manifest.ts` | `generateChecksumManifest(repoPath)` — SHA256 per file |

#### `orchestration/` — Pipeline Engine
| File | Responsibility |
|------|----------------|
| `jobQueue.ts` | `JobQueue` (SQLite) — CRUD, locking, priority |
| `eventBus.ts` | `EventBus` — in-memory + WS broadcast; `subscribe(jobId)` |
| `pipeline.ts` | `StitchPipeline` — state machine steps |
| `steps/` | Per-step implementations: `cloneStep`, `extractStep`, `mergeStep`, `aiStep`, `verifyStep`, `publishStep` |
| `retry.ts` | `withRetry(fn, policy)` — exponential backoff, max attempts |
| `rollback.ts` | `rollbackJob(jobId)` — deletes child repo, cleans worktrees |

#### `storage/` — SQLite
| File | Responsibility |
|------|----------------|
| `db.ts` | `openDB(path)` — singleton; runs migrations |
| `migrations/` | `001_initial.sql`, `002_add_provider_usage.sql`, ... |
| `queries.ts` | Typed query helpers (no ORM) |

#### `config/` — Configuration
| File | Responsibility |
|------|----------------|
| `schema.ts` | `ConfigSchema` (Zod) — all settings: providers, models, sandbox, paths |
| `loader.ts` | `loadConfig()` — merges: defaults < file < env < CLI args |

#### `logger/` — Pino Wrapper
| File | Responsibility |
|------|----------------|
| `index.ts` | `logger` instance; `child({ jobId })` for scoped logs |
| `redact.ts` | Redacts `apiKey`, `token`, `secret` from logs |

---

## 4. CLI Architecture (packages/cli)

### 4.1 Command Structure
```
stitch
├── init                    # Scaffold .stitch/ config in cwd
├── add <repo> <paths...>   # Add parent repo + path selection
├── merge                   # Execute stitch job
├── serve                   # Start HTTP/WS server + open browser
├── status [jobId]          # Show job progress / history
├── doctor                  # Verify system deps (git, docker, filter-repo, bun)
├── license <repo>          # Scan license report only
├── deps <repo>             # Show dependency tree / collisions
├── config                  # View/edit ~/.stitch config
├── auth                    # GitHub login (device flow) / OpenRouter key
└── completion              # Shell autocomplete (bash/zsh/fish)
```

### 4.2 CLI Server (`server/`)
- **Elysia app** on `localhost:3434` (configurable)
- **Routes:**
  - `GET /` → serves built Web UI (static)
  - `GET /api/health` → `{ ok: true, version }`
  - `GET /api/schema` → OpenAPI 3.1 spec for core types
  - `POST /api/jobs` → create job (returns `jobId`)
  - `GET /api/jobs/:id` → job status + output
  - `POST /api/jobs/:id/cancel`
  - `POST /api/jobs/:id/approve` → approve gated tool (component proposal)
  - `POST /api/jobs/:id/reject` → reject gated tool
  - `WS /ws` → real-time `JobEvent` stream (`jobId` query param)

### 4.3 TUI Components (`ui/`)
- `RepoPicker` — ink-based searchable list (GitHub API)
- `PathSelector` — checkbox tree (from `getTree`)
- `ProgressBar` — multi-step with substep detail
- `DiffViewer` — inline diff for `propose_component` (simplified for terminal)
- `ConfirmPrompt` — approve/reject gated actions

---

## 5. Web UI Architecture (packages/web)

### 5.1 Page Structure
```
/                          → Dashboard (recent jobs, quick actions)
/merge                     → Merge Wizard (5 steps)
/merge/:jobId              → Job Detail (live stream, approve gate, results)
/jobs                      → Job History (filterable table)
/settings                  → Providers, models, sandbox, paths, theme
/help                      → Docs viewer (markdown from repo)
```

### 5.2 Component Hierarchy
```
App
├── Layout (Sidebar + Topbar)
│   ├── Sidebar: Nav + Job Status Summary
│   └── Topbar: User, Theme, Notifications
├── Pages
│   ├── Dashboard
│   │   ├── QuickActions (New Merge, Extract, License Check)
│   │   ├── RecentJobs (list + status badges)
│   │   └── Stats (success rate, avg time)
│   ├── MergeWizard
│   │   ├── Step1: RepoPicker (A + B) — search + manual URL
│   │   ├── Step2: FileTreeA — virtualized, checkbox, dependency closure toggle
│   │   ├── Step3: FileTreeB — same
│   │   ├── Step4: Options — merge strategy, sandbox, license policy
│   │   └── Step5: Review + Launch
│   ├── JobDetail
│   │   ├── Timeline (steps with live status)
│   │   ├── AIThinkingStream — markdown + reasoning chunks
│   │   ├── DiffViewer — for gated proposals (Accept/Reject buttons)
│   │   ├── DepsPanel — collision table + resolutions
│   │   ├── LicensePanel — SPDX list + warnings
│   │   ├── SandboxPanel — logs + pass/fail
│   │   └── CreditsPreview — CREDITS.md rendered
│   ├── JobsTable — paginated, sortable, filterable
│   └── Settings
│       ├── Providers (OpenRouter key, Anthropic key, Ollama URL)
│       ├── Models (default agent, fallback)
│       ├── Sandbox (Docker vs GH Actions, limits)
│       ├── Paths (cache dir, worktree dir)
│       └── Theme (light/dark/system)
├── Shared Components
│   ├── FileTree (react-arborist + virtualization)
│   ├── DiffViewer (react-diff-viewer-continued)
│   ├── CodeBlock (Shiki)
│   ├── Badge, Button, Card, Dialog, Select, Tabs (Radix)
│   ├── Toast (Sonner)
│   └── LoadingSkeleton
├── Hooks
│   ├── useWebSocket(jobId) — auto-reconnect, event buffer
│   ├── useJobs() — TanStack Query for job list
│   ├── useJob(jobId) — single job + WS merge
│   ├── useAuth() — GitHub OAuth (if multi-user later)
│   └── useTheme() — persists to localStorage
└── Store (Zustand)
    ├── jobsStore — job list + filters
    ├── uiStore — sidebar open, toasts, modals
    └── settingsStore — persisted config
```

### 5.3 Real-Time Protocol (WS)
```ts
// Client → Server
type ClientMessage =
  | { type: 'subscribe'; jobId: string }
  | { type: 'approve'; jobId: string; toolCallId: string }
  | { type: 'reject'; jobId: string; toolCallId: string; reason?: string }
  | { type: 'cancel'; jobId: string };

// Server → Client
type ServerMessage =
  | { type: 'event'; event: JobEvent }           // step started/completed/failed
  | { type: 'proposal'; proposal: ToolProposal } // gated tool needs approval
  | { type: 'reasoning'; chunk: ReasoningChunk } // AI thinking stream
  | { type: 'error'; message: string }
  | { type: 'done'; output: StitchOutput };
```

---

## 6. Data Flow: End-to-End Stitch Job

```
1. USER (CLI or Web)
   → stitch merge (or Web "Launch")
   → POST /api/jobs { repos: [...], options }

2. ORCHESTRATION (core)
   → JobQueue.createJob(input) → jobId
   → EventBus.emit('job:created', jobId)
   → Pipeline.execute(jobId)

3. PIPELINE STEPS (sequential, each emits events)
   a) CLONE
      → git.cloneRepo() for each parent
      → cache in .stitch/cache/repos/{hash}
   b) EXTRACT
      → git.filterRepo.extractPaths() per selected path
      → each parent → isolated worktree with prefixed paths
   c) MERGE
      → git.mergeRepos() → child worktree
      → git.commitWithTrailers()
   d) DEPS + LICENSE (parallel)
      → deps.mergeManifests() → merged package.json + conflicts
      → license.scanDeclaredLicenses() → report
      → IF conflicts/warnings AND policy=strict → PAUSE for user
   e) AI LOOP
      → ai.runAgentLoop(context, tools, policy)
      → auto-tools execute immediately (fix_dependency, etc.)
      → gated tools (propose_component) → EventBus.emit('proposal')
      → WAIT for WS approve/reject
      → on approve: write files, continue loop
      → on reject: skip, continue loop
      → loop ends when: no gaps, max iterations, or user cancel
   f) VERIFY
      → sandbox.runBuildTest(childWorktree)
      → IF fail: report logs, PAUSE for user (retry/abort)
   g) PUBLISH
      → git.pushToRemote(childRepo)
      → provenance.generateCredits() → CREDITS.md
      → provenance.generateSBOM() → sbom.json
      → provenance.attachGitNotes()
      → JobQueue.complete(jobId, output)

4. REAL-TIME UI
   → WS receives JobEvent → updates timeline
   → WS receives proposal → opens DiffViewer modal
   → WS receives reasoning → appends to AI stream panel
   → On done → navigates to results view
```

---

## 7. Database Schema (SQLite)

```sql
-- jobs table
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('stitch','extract','license-check','deps-check')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  input_json TEXT NOT NULL,
  output_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);

-- job_events table
CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  message TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_job_events_job ON job_events(job_id);

-- repo_cache table (metadata to avoid re-fetching)
CREATE TABLE repo_cache (
  key TEXT PRIMARY KEY,              -- "owner/repo@branch"
  data_json TEXT NOT NULL,           -- { tree, license, defaultBranch, updatedAt }
  expires_at INTEGER NOT NULL
);

-- provider_usage table (cost tracking)
CREATE TABLE provider_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT REFERENCES jobs(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  created_at INTEGER NOT NULL
);

-- settings table (key-value)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

---

## 8. Security Architecture

| Layer | Controls |
|-------|----------|
| **Secrets** | `.env` for server; `configstore` (encrypted) for CLI; never in code/logs. |
| **GitHub Auth** | GitHub App (preferred) with minimal scopes (`contents:read`, `metadata:read`, `actions:write`); PAT fallback. |
| **AI Keys** | Stored in config; redacted in logs (`logger.redact`); never sent to client. |
| **Sandbox** | Docker: `--network=none`, `--read-only`, `--cap-drop=ALL`, `--pids-limit=100`, `--memory=4g`, `--cpus=2`. |
| **Path Safety** | All file ops: `resolve(target).startsWith(resolve(worktreeRoot))` guard. |
| **Input Validation** | All external input (GitHub API, user paths, AI tool args) validated via Zod schemas. |
| **Dependency Audit** | `bun audit` in CI; `license-checker --failOn` for GPL/AGPL. |

---

## 9. Deployment Architecture

### 9.1 CLI Binary
```
bun build --compile --target=bun-linux-x64-modern ./packages/cli/src/index.ts --outfile stitch-linux-x64
bun build --compile --target=bun-darwin-arm64 ./packages/cli/src/index.ts --outfile stitch-darwin-arm64
bun build --compile --target=bun-windows-x64 ./packages/cli/src/index.ts --outfile stitch-windows-x64.exe
```
Published to GitHub Releases + npm (`@repo-stitcher/cli`).

### 9.2 Core Library (npm)
```
tsup packages/core/src/index.ts --format esm,cjs --dts --out-dir packages/core/dist
npm publish packages/core
```

### 9.3 Sandbox Base Image (Docker)
```dockerfile
# docker/sandbox-base.Dockerfile
FROM oven/bun:1.1 AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip docker.io \
    && pip3 install git-filter-repo \
    && rm -rf /var/lib/apt/lists/*
# Pre-install toolchains
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && . "$HOME/.cargo/env" && rustup default stable
RUN curl -fsSL https://go.dev/dl/go1.22.linux-amd64.tar.gz | tar -C /usr/local -xz
ENV PATH="/root/.cargo/bin:/usr/local/go/bin:${PATH}"
```
Built via GitHub Actions on tag push; pushed to `ghcr.io/<owner>/repo-stitcher-sandbox:<version>`.

---

## 10. Scalability & Performance Considerations

| Concern | Mitigation |
|---------|------------|
| **Large repos (>50k files)** | Shallow clone (`--depth=1`); sparse checkout; virtualized file tree in UI; streaming tree API. |
| **AI token costs** | Context budgeting (max 50k tokens/turn); summarization for history; model fallback to cheaper. |
| **Sandbox cold start** | Prebuilt Docker images per ecosystem; layer caching; keep container pool warm (optional). |
| **Concurrent jobs** | SQLite WAL mode; advisory locks per job; configurable max parallel (default 2). |
| **GitHub API rate limits** | GraphQL for trees (single request); caching in `repo_cache` (TTL 1h); backoff + retry. |
| **Memory in CLI** | Streaming file processing; avoid loading full repo in memory; use `bun:sqlite` streaming. |

---

## 11. Extension Points (Post-MVP)

| Extension Point | Location | Contract |
|-----------------|----------|----------|
| **New Ecosystem** | `core/src/deps/parse/` | Implement `ManifestParser` interface |
| **New AI Provider** | `core/src/ai/provider.ts` | Implement `ChatProvider` interface |
| **New Sandbox Backend** | `core/src/sandbox/runner.ts` | Implement `SandboxRunner` interface |
| **New License Scanner** | `core/src/license/deepScan.ts` | Implement `DeepScanner` interface |
| **Custom Tool** | `core/src/ai/tools/` | Add tool def + handler; register in `loop.ts` |
| **Web UI Plugin** | `packages/web/src/components/extensions/` | React component + `registerExtension()` |

---

## 12. Implementation Status (Wave 0 — Foundation)

The plan document (`project-plans/PHASES_DETAILED.md`) describes the full 319-phase roadmap. This section tracks what is **actually implemented in code** as of the last update. Each row links to a session log entry in `PROGRESS.md` and confirms coverage + test status.

| Phase | Module | Status | Tests | Coverage | Notes |
|-------|--------|--------|-------|----------|-------|
| P-000 | (monorepo init) | ✅ shipped | 1 smoke / package | n/a | 3-package Bun workspace |
| P-001 | (package manifests) | ✅ shipped | 1 smoke / package | n/a | `private: true` (publishable at P-278) |
| P-002 | `tsconfig.base.json` | ✅ shipped | 4 files typechecked | n/a | strict + noUncheckedIndexedAccess; frozen |
| P-003 | `eslint.config.mjs` + prettier | ✅ shipped | lint clean | n/a | flat config, no-throw-literal rule |
| P-004 | vitest 5 (projects) | ✅ shipped | 3 smoke tests | n/a | core 80/70/80/80 thresholds |
| P-005 | commitlint + husky | ✅ shipped | conventional commits | n/a | 6 commits on main |
| P-006 | changesets | ✅ shipped | status/version | n/a | `access: public`; bumps deferred to P-278 |
| P-007 | `.github/workflows/ci.yml` | ✅ shipped | yaml valid | n/a | 3 jobs; dependabot added |
| P-008 | `docker/sandbox-base.Dockerfile` | ✅ shipped | hadolint pass | n/a | 5 spec warnings kept verbatim |
| P-009 | `core/src/config/schema.ts` | ✅ shipped | 21 tests | 95.34% stmts | Zod, loadConfig with layered merge |
| P-010 | `core/src/logger/` | ✅ shipped | 13 tests | 100% stmts | Pino + auto-redact, 69 paths |
| P-011 | `core/src/result/` | ✅ shipped | 21 tests | 100% stmts | neverthrow + 13-code StitchError |
| P-012 | `core/src/util/` | ✅ shipped | 27 tests | 91.86% stmts | id/paths/ignore helpers |
| P-013 | (this section) | ✅ shipped | docs | n/a | this file |
| P-014+ | (later phases) | ⏳ pending | — | — | see `PROGRESS.md` active phase |

### 12.1 Tooling Stack (root)

```
Bun 1.3.11
├── TypeScript 6.0.3 (downgraded from 7 — typescript-eslint 8.69 requires ≤6)
├── ESLint 10.10.0 + typescript-eslint 8.69.0 (flat config)
├── Prettier 3.9.6
├── Vitest 5.0.0 (root projects: ['packages/*'])
├── commitlint 21.2.2 + husky 9.1.7 + lint-staged 17.4.1
├── @changesets/cli 3.0.2
├── yaml 2.9.0 (for workflow validation)
└── hadolint 2.15.1 (for Dockerfile validation, via bunx)
```

### 12.2 Frozen Files

Per AGENTS.md and DECISIONS.md, these files require an ADR to change:

- `tsconfig.base.json` (P-002) — strict baseline shared by all 3 packages
- `eslint.config.mjs` (P-003) — enforced rules across the monorepo
- `commitlint.config.cjs` (P-005) — type-enum restricted to 11 conventional types
- `vitest.config.ts` (P-004) — per-glob coverage thresholds

### 12.3 What's NOT YET implemented (deferred to later phases)

- **TypeScript build (`tsup`)** — P-062; current `build` script is a stub
- **`packages/cli/src/commands/*`** — P-189+; CLI is currently a 1-line placeholder
- **`packages/web/src/pages/*`** — P-208+; web is currently a 1-line placeholder
- **Real git/GitHub/sandbox/etc modules** — P-069+; only `config/`, `logger/`, `result/`, `util/` exist in `core/src/` today
- **`core/src/storage/` (SQLite)** — P-026; no DB yet

---

## 13. Wave 0 Conventions (Foundation Contracts)

The four modules shipped in P-009..P-012 define the **error and configuration contracts** every later core module must follow. These are enforced by ESLint rules + TypeScript types; deviating requires an ADR.

### 13.1 Result Contract (P-011)

**Rule:** No public core function throws. Every public function returns `Result<T, StitchError>` from neverthrow.

- **Helper:** `match(result, { onOk, onErr })` forces both branches at the type level.
- **Error type:** `StitchError` — 13-code discriminated union (GIT_ERROR, GITHUB_API_ERROR, DOCKER_ERROR, AI_PROVIDER_ERROR, LICENSE_VIOLATION, DEPENDENCY_CONFLICT, SANDBOX_FAILED, CONFIG_ERROR, USER_CANCELLED, INTERNAL, AUTH_ERROR, COST_LIMIT, COMPLIANCE_VIOLATION). Each code carries different required fields.
- **Async:** Use `ResultAsync<T, E>` (neverthrow) for any function that does I/O. Wrap unsafe promises with `fromInternalPromise(promise, msgPrefix)` to auto-map rejections to `INTERNAL` StitchError.
- **Enforcement:** ESLint `no-throw-literal` (base) + `no-restricted-syntax` for `throw new Error()` (caller's responsibility; new ESLint rule can be added in P-011 follow-up).

**Anti-patterns (will be caught by review):**
```ts
// ❌ throws
function loadFoo(): Foo { throw new Error('nope'); }

// ✅ Result
function loadFoo(): Result<Foo, StitchError> {
  return ok(myFoo);
}

// ❌ returns null on failure
function loadBar(): Bar | null { return null; }

// ✅ Result
function loadBar(): Result<Bar, StitchError> {
  return err({ code: 'GIT_ERROR', message: 'no bar found' });
}
```

### 13.2 Config Contract (P-009)

**Rule:** No hardcoded config. Anything user-tunable goes through `loadConfig({ defaults, file, env, cli })`.

- **Schema:** `ConfigSchema` (Zod, in `core/src/config/schema.ts`) — github/openrouter/anthropic/ollama/sandbox/paths/licensePolicy/autonomy sections.
- **Merging:** 4 layers merge in spec precedence: `defaults < file < env < cli`. Deep-merge keeps siblings intact (e.g. overriding `paths.cacheDir` doesn't drop `paths.worktreeDir`).
- **Validation:** `loadConfig` runs Zod parse + a post-parse credential check (pat requires `token`; app requires `appId`+`privateKeyPath`+`installationId`).
- **Env:** `.env.example` is the canonical list; `~/.stitch/config.json` (P-200) overrides; secrets come from `config-secret` (P-206), not env dumps.

### 13.3 Logger Contract (P-010)

**Rule:** Every core module uses the singleton `logger` from `core/src/logger/`. Never `console.log` in core code.

- **Structure:** JSON in CI / prod, pretty in dev (`pino-pretty` worker when `NODE_ENV !== 'production'` and `LOG_PRETTY !== 'false'` and `VITEST !== 'true'`).
- **Levels:** Honored via `LOG_LEVEL` env (trace/debug/info/warn/error/fatal).
- **Redaction:** Auto-applied to 9 sensitive field names at depths 0..8 (apiKey, token, secret, password, privateKey, accessToken, refreshToken, webhookSecret, signingKey) + 6 literal paths (github.auth.token, openrouter.apiKey, anthropic.apiKey, ollama.apiKey, docker.authConfig, sandbox.env.*). 69 total paths. Pino's redact uses fast-redact which only supports `*` (single-segment) — hence the enumeration.
- **Job-scoped logs:** `createJobLogger(jobId)` returns a child logger that adds `jobId` to every line.
- **Test mode:** When `VITEST=true` or `NODE_ENV=test`, the worker-thread transport is suppressed (it can't run in vitest's process); logger writes JSON to stdout.

### 13.4 Util Contract (P-012)

**Rule:** Cross-cutting helpers (id, paths, ignore) live in `core/src/util/`. Do not re-implement them in feature modules.

- **`monotonicId(prefix)`** — `<prefix>_<base36-ts>_<base36-seq>_<12-char-nanoid>`. Sortable, concurrent-safe within a process. Use for `jobId`, `runId`, `stepId`. For cross-process uniqueness, prepend a process-id component.
- **`resolveWithin(root, p)`** — Result-returning; rejects `..` escapes; preferred over the throwing `safeJoin`.
- **`buildIgnoreMatcher(patterns, { baseDir, gitignore, negated })`** — .gitignore-style with auto-expansion of bare names: directory patterns (`node_modules` → `**/node_modules/**`) and file-extension patterns (`*.log` → `**/*.log`).

---

## 14. Open Architectural Questions (parking lot)

These need an ADR before code lands. Most are tracked in `DECISIONS.md` once decided.

| Question | Why pending | Likely decision point |
|----------|-------------|------------------------|
| Should `web` import `@repo-stitcher/core` types directly (via build-time codegen) or only via `/api/schema`? | Spec §2 says HTTP/WS only; spec §3.1 says public API exports types. | P-208+ (web) |
| Where do `core/src/types/` shared types live vs. `core/src/index.ts` re-exports? | Spec has both; conflict on `StitchInput`/`StitchOutput` definitions. | P-014+ |
| How does the `cli serve` Elysia server package the static web assets? | Single binary vs. external? | P-208 (vite build) → P-189+ (cli) |
| Does `core` own the SQLite DB or does `cli`? | Affects test isolation + cleanup. | P-026 / P-193 |

---

*End of ARCHITECTURE.md. This is the definitive structural map. Any structural change requires ADR in DECISIONS.md.*