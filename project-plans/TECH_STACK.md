# TECH_STACK.md — Technical Blueprint
## repo-stitcher: Canonical Technology Choices

**Version:** 1.0.0
**Status:** Frozen for MVP — changes require ADR in DECISIONS.md
**Last Updated:** 2026-08-30

---

## 1. Core Runtimes & Languages

| Component | Version | Constraint | Rationale |
|-----------|---------|------------|-----------|
| **Bun** | ≥1.1.0 (latest stable) | **Required** | Native TypeScript, fast startup, built-in SQLite, test runner, bundler, package manager. Single binary for all dev/prod needs. |
| **TypeScript** | 5.6+ | Strict mode (`"strict": true`) | Type safety across monorepo; enables AI tool schema generation via `zod-to-json-schema`. |
| **Node.js** | ≥22 LTS (for compatibility) | Fallback only | Some legacy tools (git-filter-repo via pip) need Python/Node; Bun primary. |
| **Python** | 3.11+ | System dependency | `git-filter-repo` is Python; `scancode-toolkit` (optional deep scan) is Python. |
| **Docker** | ≥24.0 (Engine) | System dependency | Sandbox build/test containers. |
| **Git** | ≥2.40 | System dependency | `git subtree`, `git merge --allow-unrelated-histories`, `git-filter-repo` backend. |

---

## 2. Monorepo Structure

```
repo-stitcher/
├── package.json                 # Root: workspaces, scripts, devDeps
├── bunfig.toml                  # Bun config (test, install, run)
├── tsconfig.base.json           # Strict base; packages extend
├── .eslintrc.cjs                # Shared ESLint (typescript-eslint, prettier)
├── .prettierrc                  # Shared Prettier
├── .husky/                      # pre-commit: lint + typecheck
├── .github/
│   ├── workflows/
│   │   ├── ci.yml               # Lint, typecheck, test, build per package
│   │   ├── release.yml          # Changeset → npm + GH Release
│   │   └── docker.yml           # Build/push sandbox base image
│   └── dependabot.yml
├── packages/
│   ├── core/                    # All business logic (no UI)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                 # Public API exports
│   │   │   ├── types/                   # Shared types (frozen contract)
│   │   │   ├── git/                     # Git operations wrapper
│   │   │   ├── github/                  # Octokit wrapper
│   │   │   ├── deps/                    # Manifest parsing/merge
│   │   │   ├── license/                 # License scanning/compat
│   │   │   ├── ai/                      # Provider layer + agent loop
│   │   │   ├── sandbox/                 # Docker build/test
│   │   │   ├── provenance/              # CREDITS, SBOM, git notes
│   │   │   ├── orchestration/           # Pipeline, job queue, event bus
│   │   │   ├── storage/                 # SQLite (better-sqlite3 via bun:sqlite)
│   │   │   ├── config/                  # Zod schemas, env loading
│   │   │   ├── logger/                  # Pino wrapper
│   │   │   └── util/                    # IDs, paths, glob, etc.
│   │   └── tests/
│   ├── cli/                     # Terminal interface
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                 # Commander entry
│   │   │   ├── commands/                # init, add, merge, serve, doctor, status, license, deps
│   │   │   ├── ui/                      # Ink components (picker, progress, prompts)
│   │   │   ├── server/                  # Elysia HTTP+WS server (serves web UI + API)
│   │   │   └── config/                  # ~/.stitch config store
│   │   └── tests/
│   └── web/                     # Browser dashboard
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── pages/                   # Dashboard, MergeWizard, JobDetail, Settings
│       │   ├── components/              # Reusable UI (FileTree, DiffViewer, Panels)
│       │   ├── hooks/                   # useWebSocket, useJobs, useAuth
│       │   ├── store/                   # Zustand stores
│       │   ├── api/                     # Client for core API + WS
│       │   ├── styles/                  # Tailwind + CSS variables
│       │   └── utils/
│       └── tests/
├── docker/
│   ├── sandbox-base.Dockerfile    # Multi-arch base image with node/bun/python/go/rust/cargo
│   └── docker-compose.yml         # Local dev stack (optional)
├── docs/                          # Generated from source (typedoc, etc.)
└── project-plans/                 # This folder (PRD, ARCH, etc.)
```

---

## 3. Frontend Ecosystem (Web UI)

| Layer | Choice | Version | Notes |
|-------|--------|---------|-------|
| **Framework** | React | 18.3+ | Concurrent features; Suspense for streaming AI responses. |
| **Build** | Vite | 5.4+ | HMR, fast builds, `vite-plugin-pwa` optional later. |
| **Styling** | Tailwind CSS | 3.4+ | Utility-first; design tokens from `tailwind.config.ts`; dark mode via `class` strategy. |
| **Components** | Radix UI Primitives | Latest | Accessible, unstyled primitives (Dialog, Select, Tabs, Tooltip, etc.). |
| **State** | Zustand | 4.5+ | Minimal, no Context hell; `persist` middleware for settings. |
| **Server State** | TanStack Query (React Query) | 5.5+ | Caching, deduping, optimistic updates for REST calls. |
| **Real-time** | Native WebSocket + custom hook | — | `stitch serve` exposes `/ws`; hook handles reconnect, backoff. |
| **Diff Viewer** | `react-diff-viewer-continued` | 3.2+ | Side-by-side, inline, syntax highlighted. |
| **Code Viewer** | Shiki | 1.12+ | WASM-based syntax highlighting (same as GitHub). |
| **File Tree** | `react-arborist` | 2.5+ | Virtualized, keyboard-navigable, checkbox selection. |
| **Forms** | React Hook Form + Zod resolver | 7.52+ / 3.23+ | Type-safe forms; shares schemas with core. |
| **Icons** | Lucide React | 0.44+ | Consistent, tree-shakeable. |
| **Toasts** | Sonner | 1.5+ | Accessible, promise-based. |
| **Theme** | `class` dark mode + CSS variables | — | Synced with Tailwind `darkMode: 'class'`. |

**Explicitly NOT used:** Next.js (overkill for local dashboard), Redux, Material UI, Chakra, Next.js App Router.

---

## 4. Backend & API Layer (Core + CLI Server)

| Layer | Choice | Version | Notes |
|-------|--------|---------|-------|
| **CLI Framework** | Commander.js | 12.1+ | Subcommands, help, autocomplete. |
| **TUI** | Ink + @inkjs/ui | 4.4+ / 1.0+ | React-based terminal UI; shares mental model with web. |
| **HTTP/WS Server** | Elysia | 1.1+ | Bun-native, fast, type-safe, WebSocket built-in. |
| **GitHub API** | @octokit/rest + @octokit/auth-app | 20+ / 6+ | REST + App auth; GraphQL for large trees. |
| **Git Wrapper** | simple-git | 3.27+ | Promise-based; shells to `git` binary. |
| **Filter-Repo** | System binary (`git-filter-repo`) | — | Invoked via `child_process`; not a Node dep. |
| **Dependency Graph** | dependency-cruiser + madge | 16+ / 8+ | JS/TS only; tree-sitter for multi-lang (see AI). |
| **Tree-Sitter** | tree-sitter + grammars | 0.22+ | `tree-sitter-javascript`, `-typescript`, `-python`, `-go`, `-rust`. |
| **License Scan** | license-checker | 25+ | Scans `node_modules`/`package.json`; outputs JSON. |
| **SPDX** | spdx-expression-parse, spdx-correct, spdx-license-list | 3+ / 3+ / 6+ | Normalize + compatibility logic. |
| **Docker Client** | dockerode | 4.0+ | Programmatic container control. |
| **SQLite** | bun:sqlite (native) | — | Zero-dep, fast, embedded. |
| **Config/Validation** | Zod | 3.23+ | Schema → types + JSON Schema for AI tools. |
| **Logging** | Pino | 9+ | Structured JSON; pretty in dev. |
| **Error Handling** | neverthrow (Result<T, E>) | 8+ | Exhaustive error handling; no `throw`. |
| **Concurrency** | p-limit | 6+ | Controlled parallelism for clones, sandbox. |
| **YAML/TOML/INI** | yaml, @iarna/toml, ini | 2+ / 0.1+ / 4+ | Manifest parsing. |

---

## 5. AI Provider Layer

| Provider | SDK | Base URL | Tool Calling | Notes |
|----------|-----|----------|--------------|-------|
| **OpenRouter** (default) | `openai` npm | `https://openrouter.ai/api/v1` | ✅ Full | One schema for Claude/GPT/Llama; **avoid Gemini 3** (broken `thought_signature`). |
| **OpenAI** | `openai` npm | `https://api.openai.com/v1` | ✅ Full | Direct; same schema as OpenRouter. |
| **Anthropic** | `@anthropic-ai/sdk` | `https://api.anthropic.com` | ✅ Native | Uses Anthropic tool format; adapter normalizes to internal schema. |
| **Ollama** (local) | `openai` npm | `http://localhost:11434/v1` | ✅ (Ollama 0.1.34+) | OpenAI-compatible; model must support tools (e.g., `llama3.1`, `nemotron3`). |
| **Custom** | Implement `ChatProvider` | Any | ✅ | Pluggable; config-driven. |

**Model Registry (core/ai/models.ts):**
```ts
interface ModelSpec {
  id: string;                    // e.g., "anthropic/claude-3.5-sonnet"
  provider: 'openrouter' | 'openai' | 'anthropic' | 'ollama';
  contextWindow: number;         // 200k, 128k, etc.
  supportsTools: boolean;        // false → excluded from agent loop
  maxOutputTokens: number;
  costPer1kIn: number;           // USD estimate
  costPer1kOut: number;
  recommendedFor: ('agent' | 'chat' | 'embed')[];
}
```
Default agent model: `anthropic/claude-3.5-sonnet` (via OpenRouter) — best tool-calling reliability.

---

## 6. Database & Storage

| Layer | Choice | Schema |
|-------|--------|--------|
| **Primary** | SQLite (bun:sqlite) | `jobs`, `job_events`, `repo_cache`, `provider_usage`, `settings` |
| **Migrations** | Custom (timestamped SQL files in `core/src/storage/migrations/`) | Run on CLI startup |
| **No ORM** | Raw SQL + typed helpers | `kysely` considered but rejected for simplicity (ADR-003) |

**Key Tables:**
```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,              -- UUID
  type TEXT NOT NULL,               -- 'stitch' | 'extract' | 'license-check'
  status TEXT NOT NULL,             -- 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  input_json TEXT NOT NULL,         -- serialized StitchInput
  output_json TEXT,                 -- serialized StitchOutput
  created_at INTEGER NOT NULL,      -- unix ms
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  step TEXT NOT NULL,               -- 'clone' | 'extract' | 'merge' | 'ai-loop' | 'sandbox' | 'publish'
  status TEXT NOT NULL,             -- 'started' | 'completed' | 'failed'
  message TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
```

---

## 7. Linting, Formatting & Quality Rules

| Tool | Config | Enforcement |
|------|--------|-------------|
| **ESLint** | `eslint.config.mjs` (flat config) | `typescript-eslint`, `import/order`, `no-restricted-imports` (no `core` in `cli`/`web` except via public API) |
| **Prettier** | `.prettierrc` | Single quotes, 2 spaces, trailing commas, 100 char line |
| **TypeScript** | `tsconfig.base.json` | `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns` |
| **Vitest** | `vitest.config.ts` | Coverage thresholds: statements 80%, branches 70%, functions 80%, lines 80% |
| **Changesets** | `.changeset/config.json` | Conventional commits; auto-version per package |
| **Husky** | `.husky/pre-commit` | `bun run lint && bun run typecheck` (fast, per-package) |
| **Commitlint** | `@commitlint/config-conventional` | Enforces `feat:`, `fix:`, `chore:`, etc. |

**Quality Gates (CI):**
1. `bun run lint` — zero errors
2. `bun run typecheck` — zero errors
3. `bun run test` — all pass, coverage thresholds met
4. `bun run build` — all packages produce output

---

## 8. Infrastructure & Deployment

| Target | Method | Details |
|--------|--------|---------|
| **CLI Distribution** | `bun build --compile` → single binary | `stitch` binary for macOS (arm64/x64), Linux (x64/arm64), Windows (x64) |
| **npm Package** | `tsup` → ESM + CJS + types | Published as `@repo-stitcher/core`, `@repo-stitcher/cli` |
| **Docker Image** | `docker/build-push-action` | `ghcr.io/<owner>/repo-stitcher-sandbox:latest` (multi-arch) |
| **GitHub Actions** | 3 workflows | CI (per-package), Release (changeset), Docker (sandbox base) |
| **Self-Hosted Web** | `stitch serve` | Runs Elysia on `localhost:3434`; serves built web assets + WS API |

---

## 9. Security Boundaries (enforced by SECURITY.md)

- **No secrets in code** — `.env` only; `configstore` for CLI keys; env vars for server.
- **Sandbox containers** — no network, read-only rootfs, no GPU, memory/CPU limits.
- **GitHub App auth** — preferred over PAT; fine-grained permissions.
- **AI provider keys** — never logged; redacted in audit logs.
- **Path traversal** — all file ops resolved against worktree root; `path.resolve` + `startsWith` guard.

---

## 10. Version Pinning Strategy

- **Runtime (Bun)**: pinned in `bunfig.toml` + `package.json#engines`
- **Dependencies**: exact versions in `package.json` (no `^`/`~`); updated via Dependabot PRs
- **System deps**: documented in `stitch doctor` + `README#prerequisites`
- **AI Models**: pinned by model ID in `core/ai/models.ts`; updated via minor release

---

## 11. Explicit "Do Not Use" List (AI Guardrails)

| Category | Forbidden | Use Instead |
|----------|-----------|-------------|
| **HTTP Client** | `axios`, `node-fetch`, `ky` | `fetch` (global) or `ofetch` (if needed) |
| **Date/Time** | `moment`, `date-fns` (heavy) | `Temporal` (polyfill) or native `Date` |
| **Validation** | `joi`, `yup`, `class-validator` | `zod` (already in stack) |
| **State (Web)** | Redux, MobX, Recoil, Jotai | `zustand` + `tanstack-query` |
| **Styling** | CSS Modules, Styled Components, Emotion | Tailwind CSS |
| **Git Wrapper** | `isomorphic-git` | `simple-git` (shells to binary) |
| **SQL** | Prisma, Drizzle, TypeORM, Sequelize | Raw SQLite + typed helpers |
| **Testing** | Jest, Mocha | Vitest (native Bun) |
| **Bundler** | Webpack, Rollup, esbuild (direct) | `bun build` / `tsup` |
| **Process** | `child_process` raw | `execa` (if needed) or `bun.$` |

---

*End of TECH_STACK.md. This file is the absolute reference for all tool/library/runtime choices. Any deviation requires an ADR in DECISIONS.md.*