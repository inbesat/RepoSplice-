---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
# Broad inventory: ground only claims embodied by a small number of symbols.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh2:64:<base64url>" }
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2KJCCV9BDCQ862Y1JP82Z
  type: architecture
  status: promoted
  revision: 2
  title: stack
  relations:
    - type: related_to
      target: mx_01M5G2K99N5VSF22C75FZCPNET
      note: when understanding how to use a technology in this codebase
---

# Stack

## Core Technologies

- **Bun >= 1.1** (the repo pins `bun@1.3.11`) — the required runtime: native TypeScript, `bun:sqlite`, test runner, bundler and package manager. One `bun install` installs every workspace package.
- **TypeScript 5.6+ strict** — `tsconfig.base.json` at the root, scoped per package. `any` is an ESLint error.
- **Node >= 20** (>= 22 LTS as the TECH_STACK fallback) — only for tools that cannot run under Bun; the audit adapter uses `node:sqlite`.
- **Python 3.11+** — `git-filter-repo` is a system binary, not an npm dependency, and the eval harness in `eval/` is Python.
- **Docker >= 24 Engine** — sandbox verification; GitHub Actions is the fallback backend.
- **Git >= 2.40** — needed for `git subtree`, `git merge --allow-unrelated-histories` and `git-filter-repo`. `stitch doctor` gates the version.

## Key Libraries

- **zod** (not joi/yup) — the config schema in `core/src/config/schema.ts` and the frozen WS event envelope (`eventEnvelopeSchema`). v4's native `toJSONSchema` replaced `zod-to-json-schema` (ADR-017).
- **neverthrow** — every public core function returns `Result<T, StitchError>`. Exceptions are banned (ADR-013).
- **commander** — the CLI program. `createProgram()` owns the base program; `buildCLI()` attaches the workspace commands.
- **Ink 7** — the CLI TUI. Pickers are hand-built over `useInput` instead of `@inkjs/ui` (ADR-083), and progress renders through `instance.rerender()` snapshots (ADR-084).
- **Elysia** — the local HTTP and WebSocket server in `packages/cli/src/server/`. Core never imports Elysia (ADR-058): the contract is framework-agnostic.
- **React 19 + Vite + Tailwind v4** — the web dashboard. Tailwind v4's `@theme inline` is the "Tailwind config"; tokens are roles-in-CSS with a typed TS mirror (ADR-094).
- **Zustand + TanStack Query** — web state and server state (ADR-010). One slice per domain under `packages/web/src/store/`.
- **simple-git plus the system `git filter-repo` tool** — all git work goes through these, never raw `child_process` (ADR-004).
- **@octokit/rest and @octokit/auth-app** — GitHub API types, so response shapes are never assumed.
- **Vitest** — the only test runner; per-package coverage thresholds are enforced in `vitest.config.ts` (ADR-014).
- **smol-toml** — project config parsing for `stitch.toml`. `Bun.TOML` cannot run under Vitest (ADR-085).
- **dependency-cruiser** — `bun run lint:deps` enforces the public-API-only rule and detects circular dependencies.
- **Changesets plus `bun build --compile`** — the release flow and the single-file CLI binary (ADR-015).

## What We Deliberately Do NOT Use

- **axios / node-fetch / ky** — use `fetch` or `ofetch` (ESLint `no-restricted-imports` plus a dependency-cruiser rule).
- **Prisma / Drizzle / TypeORM / Sequelize** — raw SQLite with typed helpers (ADR-003).
- **Redux / MobX / Recoil / Jotai** — Zustand plus TanStack Query.
- **moment / date-fns** — Temporal, or native `Date` where Temporal is unavailable.
- **Jest / Mocha / Cypress** — Vitest only.
- **socket.io and the `ws` package** — the browser-native WebSocket client, with the WS adapter owned by the CLI server.
- **better-sqlite3** — `bun:sqlite` at runtime, `node:sqlite` for the read-only audit adapter.
- **isomorphic-git** — the real `git` and `git-filter-repo` binaries.
- **Webpack / Rollup / esbuild (direct)** — `bun build` and `tsup`.

## Version Constraints

- `bun@1.3.11` is pinned through `packageManager`; the documented floor is Bun >= 1.1.
- Git >= 2.40 — below that, `git-filter-repo` and the subtree merge fail, and `stitch doctor` reports it.
- Vitest 5, ESLint 10 and TypeScript 6 in dev; React 19 with Tailwind v4 in the web app. That pairing is a deliberate reconciliation, not a fresh scaffold (ADR-093).
- `build:cli` is still deferred to P-062 (`tsup`); the script currently prints a notice and exits 0.
