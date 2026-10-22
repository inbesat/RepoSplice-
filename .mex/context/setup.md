---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/architecture.md
    condition: when understanding how components connect during setup
  - target: patterns/debug-core-suite.md
    condition: when a setup or tooling problem shows up as a failing gate
# Ground only setup behavior implemented by specific code symbols.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh2:64:<base64url>" }
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
  type: guide
  status: promoted
  revision: 4
  title: setup
  relations:
    - type: related_to
      target: mx_01M5G2KJCCV9BDCQ862Y1JP82Z
      note: when specific technology versions or library details are needed
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: when understanding how components connect during setup
    - type: related_to
      target: mx_01M5G2KN16W5VEFN8NVCXMYA21
      note: when a setup or tooling problem shows up as a failing gate
---

# Setup

<!-- mex:entity
id: mx_01M5G2KH5YTZDHHQ1GXT3RVPPV
type: guide
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
    note: Section of setup in context/setup.md
-->
## Prerequisites

- **Git >= 2.40** — required for `git subtree`, `git merge --allow-unrelated-histories` and `git-filter-repo`. `stitch doctor` checks the version.
- **Bun >= 1.1** — the repo pins `bun@1.3.11` via `packageManager`. Bun is the runtime, package manager, test runner and bundler.
- **Docker >= 24 Engine** — the sandbox verification backend. Optional locally: the GitHub Actions fallback covers CI, and an unavailable sandbox is a typed result rather than a crash.
- **`git-filter-repo`** — a Python 3.11+ system binary on `PATH`, not an npm dependency.
- **Node >= 20** (>= 22 LTS as the TECH_STACK fallback) — only needed for tools that cannot run under Bun.

<!-- mex:entity
id: mx_01M5G2KGNA18C5MC2KSCABYZMZ
type: guide
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
    note: Section of setup in context/setup.md
-->
## First-time Setup

1. `bun install` — installs every workspace package (`packages/core`, `packages/cli`, `packages/web`, `packages/shared`).
2. Copy `.env.example` to `.env` and fill in the providers you actually use. Never commit `.env`.
3. `bun run build:core` — the root typecheck resolves core's built output, so build before typechecking.
4. `bun run typecheck && bun run lint && bun run test` — confirm a clean baseline before changing anything.
5. `bun run dev:cli` for the CLI, `bun run dev:web` for the dashboard. `stitch serve` hosts the built web app plus the HTTP/WS API on one port.

<!-- mex:entity
id: mx_01M5G2KG6XE69WD4ZWTY3TB55A
type: guide
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
    note: Section of setup in context/setup.md
-->
## Environment Variables

Every variable maps to a field in `packages/core/src/config/schema.ts`.

Required (for the features that need them):

- `OPENROUTER_API_KEY` — the default AI provider hub. Required for any AI-assisted merge.
- `GITHUB_TOKEN` — a PAT with `repo` scope, needed to create repo C and open the PR.

Conditional:

- `GITHUB_AUTH_TYPE=app`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_APP_INSTALLATION_ID` — GitHub App auth instead of a PAT. All four are needed together.
- `ANTHROPIC_API_KEY` — only when the provider is switched to Anthropic.
- `OLLAMA_BASE_URL` — only when the provider is switched to a local Ollama (defaults to `http://localhost:11434`).
- `OPENROUTER_DEFAULT_MODEL` — the model id; defaults to `openai/gpt-5`.
- `SANDBOX_BACKEND` — `docker` or `github-actions`.
- `SANDBOX_DOCKER_HOST`, `SANDBOX_LIMITS_MEMORY`, `SANDBOX_LIMITS_CPU`, `SANDBOX_LIMITS_TIMEOUT` — sandbox overrides.

Optional:

- `REPO_STITCHER_CACHE_DIR` — defaults to `.repo-stitcher/cache`.
- `REPO_STITCHER_WORKTREE_DIR` — defaults to `.repo-stitcher/worktrees`.

<!-- mex:entity
id: mx_01M5G2KFQDPY2A79V2RMY8W0WH
type: guide
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
    note: Section of setup in context/setup.md
-->
## Common Commands

- `bun run dev:cli` — the CLI with watch mode (`bun --watch packages/cli/src/index.ts`).
- `bun run dev:web` — the Vite dev server for the dashboard.
- `bun run test` — the Vitest suite across the workspace. `test:watch` and `test:coverage` are the variants.
- `bun run lint` — ESLint over the repo. `bun run lint:deps` runs dependency-cruiser over `packages/core/src`.
- `bun run typecheck` — `tsc --noEmit`. Run `bun run build:core` first.
- `bun run validate` — typecheck, lint, test and build in sequence.
- `bun run check:contracts` — the frozen-wire-contract gate. Exits 1 on an unauthorised change.
- `bun run check:contracts:update` — refresh `contracts.freeze.json` after an ADR authorises a change.
- `bun run eval:schema:check` — verify the eval corpus schema is unchanged; `bun run eval:verify-shas` verifies the pinned corpus SHAs.
- `bun run changeset` — create a Changesets release note. `changeset:status` shows pending changesets, `changeset:version` applies them, `changeset:publish` publishes (ADR-015).
- `bun run commitlint` — lint the commit message against the repo's commit conventions. Runs automatically through husky on commit.
- `bun run lint-staged` — lint and format the staged files only. Runs automatically through husky's pre-commit hook.

<!-- mex:entity
id: mx_01M5G2KF881D2JJNJG28SJRSWF
type: guide
status: promoted
revision: 2
relations:
  - type: refines
    target: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
    note: Section of setup in context/setup.md
-->
## Common Issues

- **Root `bun run typecheck` fails on core's exports** — run `bun run build:core` first. The root typecheck resolves against core's build output.
- **Root `bun run lint` reports 18 formatting errors** — they are confined to concurrent P-331 taxonomy files. Lint only the files you own; do not reformat someone else's lane.
- **The full suite is not green** — one documented red in core (`jobs` idempotency, ADR-079) plus load-sensitive build and circular-smoke failures. Do not "fix" them as a side effect of unrelated work, and do not report them as passing.
- **Native `bun test` fails** on the existing `bunfig.toml` preload entry. Use `bun run test` (Vitest) instead.
- **`bun run test:coverage` produces no total** — a stale foreign coverage lock can block it. Not a code failure.
- **`git-filter-repo` not found** — it is a system Python binary, not an npm package. Install it separately and keep it on `PATH`.
- **Docker unavailable** — the sandbox returns `SANDBOX_UNAVAILABLE` and the GitHub Actions fallback takes over. This is a typed outcome, not a crash; do not fabricate a verdict.
