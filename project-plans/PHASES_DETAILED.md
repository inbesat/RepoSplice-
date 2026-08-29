# PHASES_DETAILED.md — Elaborated Phase Context for AI Agents
## repo-stitcher: Phase-by-Phase Implementation Guide with MCPs, Skills, Acceptance Criteria

**Version:** 1.0.0
**Status:** Living document — updated per phase
**Last Updated:** 2026-08-30

---

## How to Use This Document

For each phase below, you'll find:
- **Phase ID** — matches MASTER_PLAN.md and PROGRESS.md
- **Owner** — inbesat or aradhy (enforced by package isolation)
- **Wave** — 0, 1, 2, or 3
- **Context** — why this phase exists, what problem it solves
- **Files to Create/Modify** — exact paths relative to repo root
- **Implementation Steps** — concrete, ordered tasks
- **Required MCPs/Connectors** — which external tools to invoke
- **Skills to Invoke** — which gstack skills apply
- **Acceptance Criteria** — measurable done conditions
- **Tests Required** — specific test cases
- **Dependencies** — phases that must complete first
- **Handoff Notes** — what the next phase/owner needs

**Read the phase you're working on fully before starting. Run validation after each phase.**

---

## WAVE 0 — FOUNDATION & DEPENDENCIES (inbesat)

---

### P-000: Init Bun Monorepo

**Owner:** inbesat | **Wave:** 0 | **Depends On:** None

**Context:** Create the root workspace configuration. All three packages (core, cli, web) will live under `packages/`. Bun workspaces handle linking and installs.

**Files to Create/Modify:**
- `package.json` (root)
- `bunfig.toml` (root)
- `.gitignore` (root)

**Implementation Steps:**
1. Create `package.json` with:
   - `name`: "repo-stitcher"
   - `private`: true
   - `workspaces`: ["packages/*"]
   - `scripts`: { "install": "bun install", "build": "bun run build:all", "test": "bun test", "lint": "eslint .", "typecheck": "tsc --noEmit", "format": "prettier --write .", "validate": "bun run typecheck && bun run lint && bun test && bun run build", "dev:cli": "bun --filter @repo-stitcher/cli run dev", "dev:web": "bun --filter @repo-stitcher/web run dev", "build:all": "bun run build:core && bun run build:cli && bun run build:web", "build:core": "bun --filter @repo-stitcher/core run build", "build:cli": "bun --filter @repo-stitcher/cli run build", "build:web": "bun --filter @repo-stitcher/web run build" }
   - `devDependencies`: typescript, eslint, @typescript-eslint/*, prettier, husky, lint-staged, @changesets/cli, vitest, @vitest/ui, tsup, nock, mockttp
   - `engines`: { "bun": ">=1.1.0" }
   - `packageManager`: "bun@1.1.0"
2. Create `bunfig.toml` with:
   - `[test]`: root = "."
   - `[install]`: registry = "https://registry.npmjs.org"
   - `[run]`: cwd = "."
3. Create `.gitignore` with standard Node/Bun ignores + `.env`, `.stitch/`, `dist/`, `build/`, `*.log`, `.DS_Store`, `coverage/`, `.turbo/`, `node_modules/`

**Required MCPs/Connectors:** None (local file ops)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `bun install` completes without errors
- [ ] `bun run typecheck` runs (will fail until tsconfig exists — expected)
- [ ] `bun test` runs (0 tests found — expected)
- [ ] Root `package.json` has correct workspace config

**Tests Required:** None (scaffold only)

**Dependencies:** None

**Handoff Notes:** Next phase creates package directories and tsconfig.

---

### P-001: Create Package Directories

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-000

**Context:** Set up the three-package monorepo structure. Each package gets its own `package.json`, `tsconfig.json`, and `src/` directory.

**Files to Create/Modify:**
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts` (empty export barrel)
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts` (empty)
- `packages/web/package.json`
- `packages/web/tsconfig.json`
- `packages/web/src/main.tsx` (minimal React entry)
- `packages/web/index.html` (Vite entry)
- `packages/web/vite.config.ts` (minimal)

**Implementation Steps:**
1. Create `packages/core/package.json`:
   - `name`: "@repo-stitcher/core"
   - `version`: "0.0.0"
   - `type`: "module"
   - `main`: "./dist/index.js"
   - `types`: "./dist/index.d.ts"
   - `exports`: { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }
   - `scripts`: { "build": "tsup src/index.ts --format esm,cjs --dts --out-dir dist", "test": "vitest run", "typecheck": "tsc --noEmit", "lint": "eslint src" }
2. Create `packages/core/tsconfig.json` extending `../../tsconfig.base.json` with `compilerOptions: { "rootDir": "src", "outDir": "dist" }`
3. Create `packages/cli/package.json`:
   - `name`: "@repo-stitcher/cli"
   - `version`: "0.0.0"
   - `type`: "module"
   - `bin`: { "stitch": "./dist/index.js" }
   - `scripts`: { "build": "tsup src/index.ts --format esm --out-dir dist --target bun", "dev": "bun --watch src/index.ts", "test": "vitest run", "typecheck": "tsc --noEmit", "lint": "eslint src" }
   - `dependencies`: { "@repo-stitcher/core": "workspace:*" }
4. Create `packages/cli/tsconfig.json` extending base
5. Create `packages/web/package.json`:
   - `name`: "@repo-stitcher/web"
   - `version`: "0.0.0"
   - `type`: "module"
   - `scripts`: { "dev": "vite", "build": "tsc && vite build", "preview": "vite preview", "test": "vitest run", "typecheck": "tsc --noEmit", "lint": "eslint src" }
   - `dependencies`: { "react": "^18.3.0", "react-dom": "^18.3.0", "@repo-stitcher/core": "workspace:*" }
   - `devDependencies`: { "vite": "^5.4.0", "@vitejs/plugin-react": "^4.3.0", "typescript": "^5.6.0", "tailwindcss": "^3.4.0", "postcss": "^8.4.0", "autoprefixer": "^10.4.0" }
6. Create `packages/web/tsconfig.json` extending base with JSX config
7. Create `packages/web/vite.config.ts` with React plugin, path aliases
8. Create `packages/web/index.html` with root div
9. Create `packages/web/src/main.tsx` with minimal React 18 createRoot

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] All three `package.json` files exist with correct names
- [ ] `bun install` links workspace packages
- [ ] `bun --filter @repo-stitcher/core run typecheck` passes (empty)
- [ ] `bun --filter @repo-stitcher/cli run typecheck` passes
- [ ] `bun --filter @repo-stitcher/web run typecheck` passes

**Tests Required:** None

**Dependencies:** P-000

**Handoff Notes:** Next phase creates shared tsconfig.base.json and ESLint/Prettier configs.

---

### P-002: Root TypeScript Config (Strict)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-001

**Context:** Establish the strict TypeScript baseline that all packages extend. This prevents "any" leakage, enforces exhaustive checks, and enables zod-to-json-schema generation.

**Files to Create/Modify:**
- `tsconfig.base.json` (root)

**Implementation Steps:**
1. Create `tsconfig.base.json` with:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@repo-stitcher/core/*": ["packages/core/src/*"],
      "@repo-stitcher/cli/*": ["packages/cli/src/*"],
      "@repo-stitcher/web/*": ["packages/web/src/*"]
    }
  },
  "exclude": ["node_modules", "dist", "build", "**/dist/**", "**/build/**"]
}
```

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `tsconfig.base.json` exists at root
- [ ] All three package `tsconfig.json` files extend it via `"extends": "../../tsconfig.base.json"` (or relative)
- [ ] `bun run typecheck` passes at root (no errors)

**Tests Required:** None

**Dependencies:** P-001

**Handoff Notes:** This config is frozen — changes require ADR. Next: ESLint + Prettier.

---

### P-003: Shared ESLint + Prettier Config

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-002

**Context:** Enforce consistent code style across all packages. Includes `no-restricted-imports` to enforce package boundaries (core in cli/web only via public API).

**Files to Create/Modify:**
- `eslint.config.mjs` (root, flat config)
- `.prettierrc` (root)
- `.eslintignore` (root)

**Implementation Steps:**
1. Create `eslint.config.mjs`:
```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-plugin-prettier'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { prettier, import: importPlugin },
    rules: {
      'prettier/prettier': 'error',
      'import/order': ['error', {
        groups: ['external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc' }
      }],
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['axios', 'node-fetch', 'ky', 'got'], message: 'Use fetch or ofetch' },
          { group: ['prisma', 'drizzle-orm', 'typeorm', 'sequelize', 'knex'], message: 'Use raw SQLite' },
          { group: ['jest', '@jest/*'], message: 'Use Vitest' },
          { group: ['webpack', 'rollup', 'esbuild'], message: 'Use bun build / tsup' },
          { group: ['redux', '@reduxjs/*', 'mobx', 'recoil', 'jotai'], message: 'Use Zustand + TanStack Query' },
          { group: ['moment', 'date-fns'], message: 'Use Temporal polyfill' },
          { group: ['joi', 'yup', 'class-validator'], message: 'Use Zod' },
          { group: ['socket.io', 'ws'], message: 'Use native WebSocket' },
          { group: ['better-sqlite3'], message: 'Use bun:sqlite' }
        ]
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-throw-literal': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    },
    settings: { 'import/resolver': { typescript: { project: ['packages/*/tsconfig.json'] } } }
  },
  { ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/*.config.*', '*.md'] }
)
```
2. Create `.prettierrc`:
```json
{ "semi": true, "singleQuote": true, "trailingComma": "es5", "printWidth": 100, "tabWidth": 2, "useTabs": false, "bracketSpacing": true, "arrowParens": "avoid", "endOfLine": "lf" }
```
3. Create `.eslintignore`: `dist/`, `build/`, `node_modules/`, `*.md`, `*.config.*`

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `bun run lint` passes (no errors) on empty codebase
- [ ] `bun run format` works
- [ ] `no-restricted-imports` rule would catch forbidden imports

**Tests Required:** None

**Dependencies:** P-002

**Handoff Notes:** Next: Vitest config at root + per-package.

---

### P-004: Vitest Config (Root + Per-Package)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-003

**Context:** Configure Vitest for unit/integration tests with coverage thresholds. Root config for cross-package tests; per-package for isolation.

**Files to Create/Modify:**
- `vitest.config.ts` (root)
- `packages/core/vitest.config.ts`
- `packages/cli/vitest.config.ts`
- `packages/web/vitest.config.ts`

**Implementation Steps:**
1. Root `vitest.config.ts`:
```ts
import { defineConfig, mergeConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    workspace: ['packages/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 }
    },
    testTimeout: 30000,
    hookTimeout: 10000
  },
  resolve: { alias: { '@repo-stitcher/core': resolve(__dirname, 'packages/core/src') } }
})
```
2. Per-package configs override workspace settings (coverage thresholds differ per package per TECH_STACK.md).

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `bun test` runs all workspaces
- [ ] `bun test --coverage` produces coverage report
- [ ] Coverage thresholds enforced per package

**Tests Required:** None (config only)

**Dependencies:** P-003

**Handoff Notes:** Next: Husky + Commitlint + Changesets.

---

### P-005: Commitlint + Husky + Conventional Commits

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-004

**Context:** Enforce conventional commit messages (`feat:`, `fix:`, `chore:`, etc.) and run lint/typecheck on pre-commit.

**Files to Create/Modify:**
- `.husky/pre-commit`
- `commitlint.config.cjs` (root)
- `.lintstagedrc` (root)
- Update root `package.json` with `prepare` script

**Implementation Steps:**
1. Create `commitlint.config.cjs`:
```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'revert', 'security']],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']]
  }
}
```
2. Create `.lintstagedrc`:
```json
{ "*.{ts,tsx,js,jsx,json,md}": ["prettier --write", "eslint --fix"] }
```
3. Create `.husky/pre-commit`:
```sh
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"
bun run lint-staged
```
4. Add to root `package.json` scripts: `"prepare": "husky install"`, `"lint-staged": "lint-staged"`

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `bun run prepare` installs husky hooks
- [ ] Commit with non-conventional message fails
- [ ] `git commit -m "feat: test"` succeeds
- [ ] Pre-commit runs lint-staged

**Tests Required:** None

**Dependencies:** P-004

**Handoff Notes:** Next: Changesets for versioning.

---

### P-006: Changesets for Versioning/Release

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-005

**Context:** Manage per-package versioning and changelogs. Each package versions independently.

**Files to Create/Modify:**
- `.changeset/config.json`
- `.github/workflows/release.yml`

**Implementation Steps:**
1. Run `bunx changeset init` (generates config)
2. Modify `.changeset/config.json`:
```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```
3. Create `.github/workflows/release.yml`:
```yaml
name: Release
on:
  push:
    branches: [main]
permissions:
  contents: write
  packages: write
  pull-requests: write
jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - uses: changesets/action@v1
        with:
          publish: bun run changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Required MCPs/Connectors:** GitHub Actions (for release workflow)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `bunx changeset` creates a changeset file
- [ ] Release workflow triggers on main push
- [ ] Version bump works per package

**Tests Required:** None

**Dependencies:** P-005

**Handoff Notes:** Next: GitHub Actions CI skeleton.

---

### P-007: GitHub Actions CI Skeleton

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-006

**Context:** CI pipeline that runs lint, typecheck, test, build on every PR and push. Matrix for Node/Bun versions if needed.

**Files to Create/Modify:**
- `.github/workflows/ci.yml`

**Implementation Steps:**
1. Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
jobs:
  lint-and-typecheck:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
  test:
    name: Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun test --coverage
      - uses: codecov/codecov-action@v4
  build:
    name: Build All Packages
    runs-on: ubuntu-latest
    needs: [lint-and-typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install --frozen-lockfile
      - run: bun run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: packages/*/dist }
```

**Required MCPs/Connectors:** GitHub Actions

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] CI runs on PR and push
- [ ] Lint, typecheck, test, build all pass
- [ ] Artifacts uploaded

**Tests Required:** None

**Dependencies:** P-006

**Handoff Notes:** Next: Base Dockerfile for sandbox runner.

---

### P-008: Base Dockerfile for Sandbox Runner

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-007

**Context:** Create the base Docker image used by sandbox for build/test verification. Multi-stage for smaller final image.

**Files to Create/Modify:**
- `docker/sandbox-base.Dockerfile`
- `.github/workflows/docker.yml`

**Implementation Steps:**
1. Create `docker/sandbox-base.Dockerfile`:
```dockerfile
# Base stage with all toolchains
FROM oven/bun:1.1 AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip docker.io curl \
    && pip3 install --no-cache-dir git-filter-repo \
    && rm -rf /var/lib/apt/lists/*
# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup default stable && rustup component add rustfmt clippy
# Go
RUN curl -fsSL https://go.dev/dl/go1.22.linux-amd64.tar.gz | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"
# Python deps
RUN pip3 install --no-cache-dir uv poetry
WORKDIR /workspace
```
2. Create `.github/workflows/docker.yml` to build/push on tag.

**Required MCPs/Connectors:** Docker Hub / GHCR

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] Dockerfile builds without errors
- [ ] Image contains: bun, git, git-filter-repo, rust, go, python, uv, poetry
- [ ] `docker run --rm <image> bun --version` works

**Tests Required:** None (build verification)

**Dependencies:** P-007

**Handoff Notes:** Next: Zod ConfigSchema + .env.example.

---

### P-009: Zod ConfigSchema + .env.example

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-008

**Context:** Define the complete configuration schema using Zod. This schema generates types, validates all config sources, and produces JSON Schema for AI tool parameters.

**Files to Create/Modify:**
- `packages/core/src/config/schema.ts`
- `.env.example` (root)

**Implementation Steps:**
1. Create `packages/core/src/config/schema.ts` with Zod schema covering:
   - `github`: authType ('pat'|'app'), token?, appId?, privateKeyPath?, installationId?
   - `openrouter`: apiKey?, defaultModel?
   - `anthropic`: apiKey?
   - `ollama`: baseUrl?
   - `sandbox`: backend ('docker'|'github-actions'), dockerHost?, limits (memory, cpu, timeout)
   - `paths`: cacheDir, worktreeDir
   - `licensePolicy`: allow[], warn[], deny[]
   - `autonomy`: auto[], gated[]
2. Export `ConfigSchema`, `Config`, `loadConfig()` function
3. Create `.env.example` with all vars commented

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `ConfigSchema` parses valid config
- [ ] `ConfigSchema` rejects invalid config with clear errors
- [ ] `loadConfig()` merges defaults < file < env < CLI args
- [ ] Types inferred from schema match manual types

**Tests Required:**
- Valid config parses
- Invalid config rejects with correct error paths
- Layered merge precedence works

**Dependencies:** P-008

**Handoff Notes:** Next: Pino logger wrapper.

---

### P-010: Core Logger (Pino Wrapper)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-009

**Context:** Structured JSON logging with automatic secret redaction. All core modules use this.

**Files to Create/Modify:**
- `packages/core/src/logger/index.ts`
- `packages/core/src/logger/redact.ts`

**Implementation Steps:**
1. Create `redact.ts` with `redactPaths` array (see SECURITY.md §1.1)
2. Create `index.ts`:
```ts
import pino from 'pino'
import { redactPaths } from './redact'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  formatters: {
    level: (label) => ({ level: label })
  }
})

export function createJobLogger(jobId: string) {
  return logger.child({ jobId })
}
```

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `logger.info({ msg: 'test' })` outputs JSON
- [ ] Secrets in log object are redacted
- [ ] `createJobLogger('abc')` adds `jobId` to all logs

**Tests Required:**
- Redaction works for all paths in `redactPaths`
- Child logger inherits parent config

**Dependencies:** P-009

**Handoff Notes:** Next: neverthrow Result types.

---

### P-011: Core Result Types (neverthrow)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-010

**Context:** Standardize error handling using `Result<T, E>` from neverthrow. No exceptions in core.

**Files to Create/Modify:**
- `packages/core/src/result/index.ts`

**Implementation Steps:**
1. Re-export `Result`, `ok`, `err`, `ResultAsync` from neverthrow
2. Add helper: `fromPromise<T, E>(promise: Promise<T>, mapErr: (e: unknown) => E): ResultAsync<T, E>`
3. Add `match` helper for exhaustive handling
4. Define `StitchError` union type (see SECURITY.md §9.1)

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `ok(value)` and `err(error)` create Results
- [ ] `ResultAsync.fromPromise` wraps promises
- [ ] `match` forces handling both cases
- [ ] `StitchError` covers all error codes

**Tests Required:**
- Ok/Err construction
- map/andThen chains
- fromPromise catches rejections

**Dependencies:** P-010

**Handoff Notes:** Next: util helpers (ids, paths, glob).

---

### P-012: Core Util Helpers

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-011

**Context:** Shared utilities: unique IDs, safe path resolution, glob patterns, ignore matching.

**Files to Create/Modify:**
- `packages/core/src/util/id.ts`
- `packages/core/src/util/paths.ts`
- `packages/core/src/util/glob.ts`

**Implementation Steps:**
1. `id.ts`: `generateId()` (UUID v4), `shortId()` (8-char)
2. `paths.ts`: `safeResolve(base, target)` (SECURITY.md §3.2), `normalizePath()`, `ensureDir()`
3. `glob.ts`: `matchGlob(pattern, files[])`, `gitignoreToGlob()`

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] IDs are unique and correct length
- [ ] `safeResolve` blocks traversal, allows valid paths
- [ ] Glob matching works with standard patterns

**Tests Required:**
- Path traversal attempts blocked
- Valid paths resolve correctly
- Glob patterns match expected files

**Dependencies:** P-011

**Handoff Notes:** Next: ARCHITECTURE.md documentation.

---

### P-013: ARCHITECTURE.md Documentation

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-012

**Context:** Document the package boundaries, data flow, and module responsibilities. This is the structural map for all developers.

**Files to Create/Modify:**
- `ARCHITECTURE.md` (root) — already created in project-plans/ but needs to be at root for discoverability

**Implementation Steps:**
1. Copy `project-plans/ARCHITECTURE.md` to root `ARCHITECTURE.md`
2. Ensure it matches the current package structure

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] ARCHITECTURE.md exists at root
- [ ] Describes all three packages and boundaries
- [ ] Module responsibilities listed

**Tests Required:** None

**Dependencies:** P-012

**Handoff Notes:** Next: CONTRIBUTING.md

---

### P-014: CONTRIBUTING.md + Code Style Guide

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-013

**Context:** Contribution guidelines, code style, PR process, testing requirements.

**Files to Create/Modify:**
- `CONTRIBUTING.md` (root)

**Implementation Steps:**
1. Create `CONTRIBUTING.md` covering:
   - Branch naming: `feat/`, `fix/`, `chore/`, `docs/`
   - Commit messages: conventional commits
   - PR template: description, testing, screenshots (for UI)
   - Code style: TECH_STACK.md adherence, no restricted imports
   - Testing: coverage thresholds, test patterns
   - Release process: changesets

**Required MCPs/Connectors:** None

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] CONTRIBUTING.md exists
- [ ] Covers all required sections

**Tests Required:** None

**Dependencies:** P-013

**Handoff Notes:** Foundation complete. Next: All Dependencies (P-015–P-067).

---

### P-015: Core Dependency — zod

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-014

**Context:** Add `zod` to core for config validation and schema generation.

**Files to Create/Modify:**
- `packages/core/package.json` (add dependency)

**Implementation Steps:**
1. `bun add zod --filter @repo-stitcher/core`
2. Verify `import { z } from 'zod'` works in core

**Required MCPs/Connectors:** npm registry

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] zod in core dependencies
- [ ] `bun --filter @repo-stitcher/core run typecheck` passes

**Tests Required:** None

**Dependencies:** P-014

**Handoff Notes:** Continue with remaining core deps (P-016–P-039).

---

### P-016: Core Dependency — simple-git

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-015

**Files to Create/Modify:** `packages/core/package.json`

**Implementation Steps:** `bun add simple-git --filter @repo-stitcher/core`

**Acceptance Criteria:** simple-git in deps; typecheck passes.

---

### P-017: Core Dependency — @octokit/rest

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-016

**Implementation Steps:** `bun add @octokit/rest --filter @repo-stitcher/core`

---

### P-018: Core Dependency — @octokit/auth-app

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-017

**Implementation Steps:** `bun add @octokit/auth-app --filter @repo-stitcher/core`

---

### P-019: Core Dependency — semver

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-018

**Implementation Steps:** `bun add semver --filter @repo-stitcher/core`

---

### P-020: Core Dependency — tree-sitter + grammars

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-019

**Implementation Steps:**
```
bun add tree-sitter --filter @repo-stitcher/core
bun add tree-sitter-javascript tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-rust --filter @repo-stitcher/core
```

---

### P-021: Core Dependency — dependency-cruiser

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-020

**Implementation Steps:** `bun add dependency-cruiser --filter @repo-stitcher/core`

---

### P-022: Core Dependency — madge

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-021

**Implementation Steps:** `bun add madge --filter @repo-stitcher/core`

---

### P-023: Core Dependency — license-checker

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-022

**Implementation Steps:** `bun add license-checker --filter @repo-stitcher/core`

---

### P-024: Core Dependency — spdx-expression-parse

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-023

**Implementation Steps:** `bun add spdx-expression-parse --filter @repo-stitcher/core`

---

### P-025: Core Dependency — spdx-correct

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-024

**Implementation Steps:** `bun add spdx-correct --filter @repo-stitcher/core`

---

### P-026: Core Dependency — spdx-license-list

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-025

**Implementation Steps:** `bun add spdx-license-list --filter @repo-stitcher/core`

---

### P-027: Core Dependency — openai (OpenRouter client)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-026

**Implementation Steps:** `bun add openai --filter @repo-stitcher/core`

---

### P-028: Core Dependency — @anthropic-ai/sdk

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-027

**Implementation Steps:** `bun add @anthropic-ai/sdk --filter @repo-stitcher/core`

---

### P-029: Core Dependency — dockerode

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-028

**Implementation Steps:** `bun add dockerode --filter @repo-stitcher/core`

---

### P-030: Core Dependency — bun:sqlite (native)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-029

**Implementation Steps:** No install needed — native to Bun. Just verify `import { Database } from 'bun:sqlite'` works.

---

### P-031: Core Dependency — p-limit

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-030

**Implementation Steps:** `bun add p-limit --filter @repo-stitcher/core`

---

### P-032: Core Dependency — yaml

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-031

**Implementation Steps:** `bun add yaml --filter @repo-stitcher/core`

---

### P-033: Core Dependency — ini

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-032

**Implementation Steps:** `bun add ini --filter @repo-stitcher/core`

---

### P-034: Core Dependency — glob

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-033

**Implementation Steps:** `bun add glob --filter @repo-stitcher/core`

---

### P-035: Core Dependency — fs-extra

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-034

**Implementation Steps:** `bun add fs-extra --filter @repo-stitcher/core`

---

### P-036: Core Dependency — picomatch

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-035

**Implementation Steps:** `bun add picomatch --filter @repo-stitcher/core`

---

### P-037: Core Dependency — pino

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-036

**Implementation Steps:** `bun add pino --filter @repo-stitcher/core`

---

### P-038: Core Dependency — neverthrow

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-037

**Implementation Steps:** `bun add neverthrow --filter @repo-stitcher/core`

---

### P-039: Core Dependency — zod-to-json-schema

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-038

**Implementation Steps:** `bun add zod-to-json-schema --filter @repo-stitcher/core`

---

### P-040: Core Dev Dependencies — @types/node, vitest

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-039

**Implementation Steps:**
```
bun add -D @types/node vitest @vitest/ui --filter @repo-stitcher/core
```

---

### P-041: CLI Dependency — commander

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-040

**Implementation Steps:** `bun add commander --filter @repo-stitcher/cli`

---

### P-042: CLI Dependency — ink + @inkjs/ui

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-041

**Implementation Steps:** `bun add ink @inkjs/ui --filter @repo-stitcher/cli`

---

### P-043: CLI Dependency — elysia

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-042

**Implementation Steps:** `bun add elysia --filter @repo-stitcher/cli`

---

### P-044: CLI Dependency — picocolors

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-043

**Implementation Steps:** `bun add picocolors --filter @repo-stitcher/cli`

---

### P-045: CLI Dependency — configstore

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-044

**Implementation Steps:** `bun add configstore --filter @repo-stitcher/cli`

---

### P-046: CLI Dependency — update-notifier

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-045

**Implementation Steps:** `bun add update-notifier --filter @repo-stitcher/cli`

---

### P-047: Web Dependency — react + react-dom

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-046

**Implementation Steps:** `bun add react react-dom --filter @repo-stitcher/web`

---

### P-048: Web Dependency — vite + @vitejs/plugin-react

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-047

**Implementation Steps:** `bun add -D vite @vitejs/plugin-react --filter @repo-stitcher/web`

---

### P-049: Web Dependency — tailwindcss + postcss + autoprefixer

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-048

**Implementation Steps:**
```
bun add -D tailwindcss postcss autoprefixer --filter @repo-stitcher/web
bunx tailwindcss init -p --filter @repo-stitcher/web
```

---

### P-050: Web Dependency — zustand

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-049

**Implementation Steps:** `bun add zustand --filter @repo-stitcher/web`

---

### P-051: Web Dependency — @tanstack/react-query

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-050

**Implementation Steps:** `bun add @tanstack/react-query --filter @repo-stitcher/web`

---

### P-052: Web Dependency — react-diff-viewer-continued

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-051

**Implementation Steps:** `bun add react-diff-viewer-continued --filter @repo-stitcher/web`

---

### P-053: Web Dependency — shiki

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-052

**Implementation Steps:** `bun add shiki --filter @repo-stitcher/web`

---

### P-054: Web Dependency — lucide-react

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-053

**Implementation Steps:** `bun add lucide-react --filter @repo-stitcher/web`

---

### P-055: Web Dependency — @radix-ui/*

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-054

**Implementation Steps:**
```
bun add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area --filter @repo-stitcher/web
```

---

### P-056: Web Dependency — react-hook-form + @hookform/resolvers

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-055

**Implementation Steps:** `bun add react-hook-form @hookform/resolvers --filter @repo-stitcher/web`

---

### P-057: Web Dependency — sonner

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-056

**Implementation Steps:** `bun add sonner --filter @repo-stitcher/web`

---

### P-058: Web Dependency — react-arborist

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-057

**Implementation Steps:** `bun add react-arborist --filter @repo-stitcher/web`

---

### P-059: Web Dependency — clsx + tailwind-merge

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-058

**Implementation Steps:** `bun add clsx tailwind-merge --filter @repo-stitcher/web`

---

### P-060: Root Dev Dependency — vitest + @vitest/ui

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-059

**Implementation Steps:** `bun add -D vitest @vitest/ui` (root)

---

### P-061: Root Dev Dependency — @types/bun, @types/node

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-060

**Implementation Steps:** `bun add -D @types/bun @types/node` (root)

---

### P-062: Root Dev Dependency — tsup

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-061

**Implementation Steps:** `bun add -D tsup` (root)

---

### P-063: Root Dev Dependency — nock / mockttp

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-062

**Implementation Steps:** `bun add -D nock mockttp` (root)

---

### P-064: Root Dev Dependency — fixture-repo generator

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-063

**Implementation Steps:** Create `scripts/generate-fixtures.ts` script that creates test repos.

---

### P-065: System Dependency Doc — git ≥2.40

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-064

**Implementation Steps:** Add to `README.md` prerequisites section.

---

### P-066: System Dependency Doc — git-filter-repo (pip)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-065

**Implementation Steps:** Document `pipx install git-filter-repo` in README and `stitch doctor`.

---

### P-067: System Dependency Doc — Docker

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-066

**Implementation Steps:** Document Docker requirement.

---

### P-068: stitch doctor — System Dependency Verifier

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-067

**Context:** CLI command that checks all system dependencies are installed and working.

**Files to Create/Modify:**
- `packages/cli/src/commands/doctor.ts`

**Implementation Steps:**
1. Create `doctor.ts` command that checks:
   - `git --version` ≥ 2.40
   - `git-filter-repo --version` (via pipx)
   - `docker version` (daemon running)
   - `bun --version` ≥ 1.1
   - `python3 --version` ≥ 3.11
2. Output: ✅/❌ per check with install instructions for failures

**Required MCPs/Connectors:** System shell

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `stitch doctor` runs and reports all checks
- [ ] Fails gracefully with install hints
- [ ] Passes on properly configured machine

**Tests Required:** Mock missing deps; verify output.

**Dependencies:** P-067

**Handoff Notes:** Wave 0 complete. Run P-313–P-317 (workflow phases) then handoff to aradhy.

---

### P-313: Git Branching Model Doc

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-068

**Files to Create/Modify:** `docs/BRANCHING.md`

**Implementation Steps:** Document `main` (protected), `develop` (integration), feature branches `feat/*`, `fix/*`, PR rules, release flow.

---

### P-314: Contract Freeze Gate

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-313

**Files to Create/Modify:** `packages/core/src/types/index.ts` (public API), `packages/core/src/types/ws.ts` (WS messages)

**Implementation Steps:**
1. Define all public types in `core/src/types/`
2. Export via `core/src/index.ts`
3. Add `CONTRACT_FROZEN = true` constant
4. Document: any breaking change = major version + coordination

---

### P-315: packages/shared for Cross-Cutting Types

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-314

**Files to Create/Modify:** `packages/shared/` (optional — can live in core/src/types)

**Implementation Steps:** If needed, create `packages/shared` with read-only types for aradhy. Otherwise, types stay in core.

---

### P-316: Handoff Package — HANDOFF.md

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-315

**Files to Create/Modify:** `HANDOFF.md` (root)

**Implementation Steps:** Write `HANDOFF.md` with:
- Clone URL and branch
- `bun install` → `bun run dev:cli` → `bun run dev:web`
- Contract freeze notice
- Dep request process
- Contact info

---

### P-317: Dep Request Flow

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-316

**Implementation Steps:** Document in `HANDOFF.md` and `CONTRIBUTING.md`: aradhy files GitHub issue "dep needed: <pkg>" → inbesat adds to root `package.json` → aradhy pulls.

---

**END OF FIRST 30+ PHASES (P-000 through P-068 + P-313–P-317 = 35 phases)**

---

## NEXT CHUNK: P-069 through P-117 (Epics 2–4: Git Core, GitHub, Deps Merge)

---

### P-069: Git Core — cloneRepo (shallow/full)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** Wave 0 complete (P-317)

**Context:** Core git operation to clone parent repositories. Supports shallow (--depth=1) for speed and full clone for filter-repo compatibility.

**Files to Create/Modify:**
- `packages/core/src/git/clone.ts`
- `packages/core/src/git/index.ts` (export barrel)

**Implementation Steps:**
1. Create `packages/core/src/git/clone.ts`:
```ts
import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git'
import { Result, ok, err } from '../result'
import { StitchError } from '../result'
import { generateId } from '../util/id'
import { ensureDir } from '../util/paths'
import { logger } from '../logger'

export interface CloneOptions {
  url: string
  targetDir: string
  shallow?: boolean
  depth?: number
  branch?: string
  credentials?: { username: string; password: string }
}

export async function cloneRepo(opts: CloneOptions): Promise<Result<string, StitchError>> {
  const { url, targetDir, shallow = true, depth = 1, branch, credentials } = opts
  const log = logger.child({ op: 'clone', url, targetDir })

  try {
    await ensureDir(targetDir)
    const gitOptions: SimpleGitOptions = { baseDir: targetDir, binary: 'git' }
    const git: SimpleGit = simpleGit(gitOptions)

    const cloneArgs = [url, targetDir]
    if (shallow) {
      cloneArgs.unshift('--depth', String(depth))
    }
    if (branch) {
      cloneArgs.unshift('--branch', branch)
    }
    if (credentials) {
      const authUrl = url.replace('https://', `https://${credentials.username}:${credentials.password}@`)
      cloneArgs[0] = authUrl
    }

    log.info({ shallow, depth, branch }, 'Cloning repository')
    await git.clone(cloneArgs[0], cloneArgs[1], cloneArgs.slice(2))

    // Verify clone worked
    const repoGit = simpleGit({ baseDir: targetDir, binary: 'git' })
    const status = await repoGit.status()
    log.info({ current: status.current, tracking: status.tracking }, 'Clone complete')

    return ok(targetDir)
  } catch (e) {
    log.error({ err: e }, 'Clone failed')
    return err({ code: 'GIT_ERROR', message: `Clone failed: ${e}`, gitOutput: String(e) })
  }
}
```
2. Export from `packages/core/src/git/index.ts`

**Required MCPs/Connectors:** System `git` binary

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] Clones public repo with `--depth=1` in < 10s
- [ ] Clones private repo with PAT credentials
- [ ] Supports specific branch checkout
- [ ] Returns `Result<string, StitchError>` (path on success)
- [ ] Logs structured output with jobId

**Tests Required:**
- Unit: mock simple-git, verify args
- Integration: clone real public repo (shallow + full)
- Error: invalid URL, auth failure, network timeout

**Dependencies:** P-317 (Wave 0 complete)

**Handoff Notes:** Next: P-070 extractPathsViaFilterRepo.

---

### P-070: Git Core — extractPathsViaFilterRepo

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-069

**Context:** Use `git-filter-repo` to extract only selected paths from a cloned repo, rewriting history to keep only those paths and moving them under a subdirectory prefix (e.g., `repo-a/`). This preserves `git blame` history for the extracted files.

**Files to Create/Modify:**
- `packages/core/src/git/filterRepo.ts`
- `packages/core/src/git/index.ts` (add export)

**Implementation Steps:**
1. Create `packages/core/src/git/filterRepo.ts`:
```ts
import { $ } from 'bun'
import { Result, ok, err } from '../result'
import { StitchError } from '../result'
import { logger } from '../logger'
import { safeResolve } from '../util/paths'

export interface FilterRepoOptions {
  repoPath: string
  paths: string[]           // paths to keep (e.g., ['src/auth', 'src/utils'])
  targetSubdir: string      // prefix for extracted paths (e.g., 'repo-a')
  tagPrefix?: string        // prefix for tags (default: targetSubdir + '-')
}

export async function extractPathsViaFilterRepo(opts: FilterRepoOptions): Promise<Result<string, StitchError>> {
  const { repoPath, paths, targetSubdir, tagPrefix } = opts
  const log = logger.child({ op: 'filter-repo', repoPath, targetSubdir })

  try {
    // filter-repo requires a fresh clone without remotes (or --force)
    // We assume repoPath is already a fresh clone from cloneRepo()

    const args = ['filter-repo', '--force']
    for (const p of paths) {
      args.push('--path', p)
    }
    args.push('--to-subdirectory-filter', targetSubdir)
    const tagRename = tagPrefix || `${targetSubdir}-`
    args.push('--tag-rename', `:${tagRename}`)

    log.info({ args }, 'Running git filter-repo')
    const result = await $`git ${args}`.cwd(repoPath).quiet()
    
    if (result.exitCode !== 0) {
      throw new Error(`filter-repo exited with code ${result.exitCode}: ${result.stderr.toString()}`)
    }

    log.info('filter-repo complete')
    return ok(repoPath)
  } catch (e) {
    log.error({ err: e }, 'filter-repo failed')
    return err({ code: 'GIT_ERROR', message: `filter-repo failed: ${e}`, gitOutput: String(e) })
  }
}
```

**Required MCPs/Connectors:** System `git` + `git-filter-repo` (pip)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] Extracts only specified paths from repo
- [ ] Rewrites history: only commits touching those paths remain
- [ ] Moves extracted paths under `targetSubdir/` prefix
- [ ] Renames tags with prefix
- [ ] `git log --oneline` in result shows only relevant commits
- [ ] `git blame` on extracted files shows original authors/dates

**Tests Required:**
- Fixture repo with multiple dirs → extract one → verify only that dir's history remains
- Tag rename verified
- Multiple paths extracted correctly
- Error handling: invalid path, filter-repo not installed

**Dependencies:** P-069

**Handoff Notes:** Next: P-071 tagRename helper.

---

### P-071: Git Core — tagRename Helper

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-070

**Context:** Standalone helper to rename tags in a repo (used by filter-repo but also useful independently).

**Files to Create/Modify:**
- `packages/core/src/git/tagRename.ts`

**Implementation Steps:**
1. Create `tagRename.ts`:
```ts
import { $ } from 'bun'
import { Result, ok, err } from '../result'
import { StitchError } from '../result'

export async function tagRename(repoPath: string, prefix: string): Promise<Result<void, StitchError>> {
  try {
    // List all tags
    const tagsResult = await $`git tag -l`.cwd(repoPath).quiet()
    const tags = tagsResult.stdout.toString().trim().split('\n').filter(Boolean)
    
    for (const tag of tags) {
      const newTag = `${prefix}${tag}`
      await $`git tag ${newTag} ${tag}`.cwd(repoPath).quiet()
      await $`git tag -d ${tag}`.cwd(repoPath).quiet()
    }
    return ok(undefined)
  } catch (e) {
    return err({ code: 'GIT_ERROR', message: `tagRename failed: ${e}` })
  }
}
```

**Acceptance Criteria:**
- [ ] All tags renamed with prefix
- [ ] Old tags deleted
- [ ] Works on empty tag list

---

### P-072: Git Core — mergeRepos

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-071

**Context:** Merge two prepared repositories (with filter-repo applied) into a new child repo using `git merge --allow-unrelated-histories` with ort strategy.

**Files to Create/Modify:**
- `packages/core/src/git/merge.ts`

**Implementation Steps:**
1. Create `merge.ts`:
```ts
import { simpleGit } from 'simple-git'
import { Result, ok, err } from '../result'
import { StitchError } from '../result'
import { logger } from '../logger'
import { ensureDir } from '../util/paths'

export interface MergeReposOptions {
  repoAPath: string
  repoBPath: string
  targetPath: string
  branchName?: string
}

export async function mergeRepos(opts: MergeReposOptions): Promise<Result<string, StitchError>> {
  const { repoAPath, repoBPath, targetPath, branchName = 'main' } = opts
  const log = logger.child({ op: 'merge', repoAPath, repoBPath, targetPath })

  try {
    await ensureDir(targetPath)
    
    // Init target repo
    const targetGit = simpleGit({ baseDir: targetPath, binary: 'git' })
    await targetGit.init()
    await targetGit.checkoutLocalBranch(branchName)
    
    // Add repoA as remote and fetch
    await targetGit.addRemote('repo-a', repoAPath)
    await targetGit.fetch('repo-a')
    
    // Merge repoA into target
    await targetGit.merge(['--allow-unrelated-histories', '-s', 'ort', 'repo-a/main', '--no-edit'])
    
    // Add repoB as remote and fetch
    await targetGit.addRemote('repo-b', repoBPath)
    await targetGit.fetch('repo-b')
    
    // Merge repoB into target
    await targetGit.merge(['--allow-unrelated-histories', '-s', 'ort', 'repo-b/main', '--no-edit'])
    
    log.info('Merge complete')
    return ok(targetPath)
  } catch (e) {
    log.error({ err: e }, 'Merge failed')
    return err({ code: 'GIT_ERROR', message: `Merge failed: ${e}`, gitOutput: String(e) })
  }
}
```

**Acceptance Criteria:**
- [ ] Creates new repo at targetPath
- [ ] Merges both parent repos with `--allow-unrelated-histories`
- [ ] Uses `ort` strategy (default in Git 2.33+)
- [ ] No conflicts for non-overlapping paths (filter-repo ensured this)
- [ ] Result repo has commits from both parents

---

### P-073: Git Core — subtreeAdd (Alternative Path)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-072

**Context:** Alternative merge strategy using `git subtree add` for cases where filter-repo isn't suitable.

**Files to Create/Modify:**
- `packages/core/src/git/subtree.ts`

**Implementation Steps:**
```ts
export async function subtreeAdd(parentRepo: string, childRepo: string, prefix: string): Promise<Result<void, StitchError>>
```
- Use `git subtree add --prefix=<prefix> <childRepo> <branch> --squash` or without squash for history

**Acceptance Criteria:**
- [ ] Adds child repo as subtree under prefix
- [ ] Option to preserve history (no --squash) or squash
- [ ] Works for merge scenario

---

### P-074: Git Core — cherryPickRange

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-073

**Context:** Cherry-pick a range of commits from one repo to another (for selective history inclusion).

**Files to Create/Modify:**
- `packages/core/src/git/cherryPick.ts`

**Implementation Steps:**
```ts
export async function cherryPickRange(sourceRepo: string, targetRepo: string, startSha: string, endSha: string): Promise<Result<void, StitchError>>
```

**Acceptance Criteria:**
- [ ] Cherry-picks commits in range (inclusive)
- [ ] Handles conflicts gracefully (returns error with conflict info)

---

### P-075: Git Core — Conflict Resolver

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-074

**Context:** Detect and resolve merge conflicts (auto for simple, manual for complex).

**Files to Create/Modify:**
- `packages/core/src/git/conflicts.ts`

**Implementation Steps:**
1. `detectConflicts(repoPath)` → list of conflicted files
2. `resolveConflict(repoPath, file, strategy: 'ours'|'theirs'|'manual')`
3. Auto-resolve: prefer non-deleted, detect identical changes

**Acceptance Criteria:**
- [ ] Detects all conflicted files
- [ ] Auto-resolves trivial conflicts (same change both sides)
- [ ] Returns unresolved conflicts for manual handling

---

### P-076: Git Core — writeToWorktree

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-075

**Context:** Write files to a git worktree (used by AI agent for file operations).

**Files to Create/Modify:**
- `packages/core/src/git/write.ts`

**Implementation Steps:**
```ts
export async function writeFileToWorktree(repoPath: string, filePath: string, content: string): Promise<Result<void, StitchError>>
```
- Uses `safeResolve` to prevent traversal
- Creates parent dirs
- Writes file atomically

**Acceptance Criteria:**
- [ ] Writes file within repo worktree
- [ ] Blocks path traversal
- [ ] Creates parent directories

---

### P-077: Git Core — Commit with Co-Author Trailers

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-076

**Context:** Create commits with proper co-author trailers for AI-generated changes.

**Files to Create/Modify:**
- `packages/core/src/git/commit.ts`

**Implementation Steps:**
```ts
export async function commitWithTrailers(repoPath: string, message: string, coAuthors: string[]): Promise<Result<string, StitchError>>
```
- Format: `Co-Authored-By: Name <email>`
- Returns commit SHA

**Acceptance Criteria:**
- [ ] Commit includes co-author trailers
- [ ] Returns commit SHA
- [ ] Works with empty coAuthors array

---

### P-078: Git Core — pushToRemote

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-077

**Context:** Create remote repo (via GitHub API) and push merged result.

**Files to Create/Modify:**
- `packages/core/src/git/push.ts`

**Implementation Steps:**
```ts
export async function pushToRemote(repoPath: string, remoteUrl: string, branch: string, force?: boolean): Promise<Result<void, StitchError>>
```
- Creates repo via GitHub API if needed
- Pushes branch (force only for updates)

**Acceptance Criteria:**
- [ ] Creates GitHub repo if not exists
- [ ] Pushes branch successfully
- [ ] Force option works for re-push

---

### P-079: Git Core — Blame/Provenance Map Foundation

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-078

**Context:** Build the file→origin mapping used by provenance system.

**Files to Create/Modify:**
- `packages/core/src/git/provenance.ts`

**Implementation Steps:**
```ts
export interface ProvenanceEntry {
  filePath: string
  sourceRepo: 'A' | 'B'
  sourceCommit: string
  sourcePath: string
  author: { name: string; email: string; date: string }
}

export async function mapBlame(childRepo: string, parentRepos: { A: string; B: string }): Promise<ProvenanceEntry[]>
```
- Uses `git blame --line-porcelain` on child repo
- Maps each line to original commit in parent repo

**Acceptance Criteria:**
- [ ] Every file in child repo mapped to source repo + commit
- [ ] Author info preserved
- [ ] Handles moved/renamed files

---

### P-080: Git Core — Branch Management

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-079

**Files to Create/Modify:** `packages/core/src/git/branch.ts`

**Implementation Steps:**
- `createBranch(repoPath, name, startPoint?)`
- `deleteBranch(repoPath, name)`
- `listBranches(repoPath)`
- `getCurrentBranch(repoPath)`

---

### P-081: Git Core — Stash Safety

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-080

**Files to Create/Modify:** `packages/core/src/git/stash.ts`

**Implementation Steps:**
- `stash(repoPath, message?)`
- `unstash(repoPath)`
- `stashList(repoPath)`
- Used before risky operations

---

### P-082: Git Core — Binary Skip List

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-081

**Files to Create/Modify:** `packages/core/src/git/binarySkip.ts`

**Implementation Steps:**
- Detect binary files via `git check-attr`
- Skip binary files from AI processing
- Configurable patterns

---

### P-083: Git Core — .gitignore Merge

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-082

**Files to Create/Modify:** `packages/core/src/git/gitignore.ts`

**Implementation Steps:**
- Merge `.gitignore` from both parents
- Deduplicate entries
- Add `.stitch/` to ignore

---

### P-084: Git Core — Clean Tree Verify

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-083

**Files to Create/Modify:** `packages/core/src/git/verify.ts`

**Implementation Steps:**
- `isClean(repoPath)` → boolean
- `verifyCleanTree(repoPath)` → throws if dirty
- Checks: uncommitted changes, untracked files (except allowed)

---

### P-085: Git Core — Rollback/Abort

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-084

**Files to Create/Modify:** `packages/core/src/git/rollback.ts`

**Implementation Steps:**
- `abortMerge(repoPath)`
- `resetHard(repoPath, commit?)`
- `cleanWorktree(repoPath)`

---

### P-086: Git Core — Performance (Parallel, Cache)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-085

**Files to Create/Modify:** `packages/core/src/git/perf.ts`

**Implementation Steps:**
- Parallel clone for multiple repos
- Cache filtered repos by content hash
- Reuse filter-repo results for same paths

---

### P-087: Git Core — Unit Tests with Fixtures

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-086

**Files to Create/Modify:** `packages/core/src/git/__tests__/*.test.ts`

**Implementation Steps:**
- Create fixture repos in `tests/fixtures/`
- Test each function: clone, filter-repo, merge, push, provenance
- Test error cases

**Acceptance Criteria:**
- [ ] All git functions have unit tests
- [ ] Fixture repos cover: simple, nested dirs, binary files, tags
- [ ] Tests run in < 30s

---

### P-088: GitHub — Auth (Token + App)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-087

**Files to Create/Modify:**
- `packages/core/src/github/auth.ts`

**Implementation Steps:**
```ts
export function createOctokit(config: GitHubConfig): Octokit
export async function validateAuth(octokit: Octokit): Promise<Result<User, StitchError>>
```
- Supports PAT and GitHub App
- Validates scopes/permissions

---

### P-089: GitHub — List/Search Repos

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-088

**Files to Create/Modify:** `packages/core/src/github/repos.ts`

**Implementation Steps:**
- `listUserRepos(octokit, options)`
- `searchRepos(octokit, query)`
- Pagination handling

---

### P-090: GitHub — GetRepoTree (Recursive)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-089

**Files to Create/Modify:** `packages/core/src/github/trees.ts`

**Implementation Steps:**
- `getRepoTree(octokit, owner, repo, branch)` → flat file list
- Uses GraphQL for large repos (>10k files)
- Caches in SQLite (repo_cache table)

---

### P-091: GitHub — GetFileContent/Batch

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-090

**Files to Create/Modify:** `packages/core/src/github/contents.ts`

**Implementation Steps:**
- `getFileContent(octokit, owner, repo, path, branch)`
- `getFilesBatch(octokit, owner, repo, paths[], branch)` — parallel

---

### P-092: GitHub — CreateRepoC

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-091

**Files to Create/Modify:** `packages/core/src/github/create.ts`

**Implementation Steps:**
- `createRepo(octokit, name, private, description?)`
- Returns repo URL + clone URL

---

### P-093: GitHub — Branch/Protect

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-092

**Files to Create/Modify:** `packages/core/src/github/branch.ts`

**Implementation Steps:**
- `createBranch(octokit, owner, repo, branch, sha)`
- `protectBranch(octokit, owner, repo, branch)` — require PR reviews, status checks

---

### P-094: GitHub — OpenPR + CREDITS

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-093

**Files to Create/Modify:** `packages/core/src/github/pr.ts`

**Implementation Steps:**
- `createPR(octokit, owner, repo, title, body, head, base)`
- Body includes CREDITS.md summary
- Labels: `stitch-merge`

---

### P-095: GitHub — Actions Status Webhook

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-094

**Files to Create/Modify:** `packages/core/src/github/actions.ts`

**Implementation Steps:**
- `triggerWorkflow(octokit, owner, repo, workflowId, inputs)`
- `pollWorkflowRun(octokit, owner, repo, runId)` → status

---

### P-096: GitHub — Rate Limit Backoff

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-095

**Files to Create/Modify:** `packages/core/src/github/rateLimit.ts`

**Implementation Steps:**
- Wrapper `withBackoff(fn)` that respects `Retry-After`
- Exponential backoff with jitter
- Logs rate limit status

---

### P-097: GitHub — GraphQL Trees

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-096

**Files to Create/Modify:** `packages/core/src/github/graphql.ts`

**Implementation Steps:**
- GraphQL query for repo tree (single request)
- Handles pagination for huge repos
- Falls back to REST if GraphQL fails

---

### P-098: GitHub — DetectRepoLicense

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-097

**Files to Create/Modify:** `packages/core/src/github/license.ts`

**Implementation Steps:**
- `detectRepoLicense(octokit, owner, repo)` → reads LICENSE file + package.json
- Returns SPDX ID if detectable

---

### P-099: GitHub — Fork Support

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-098

**Files to Create/Modify:** `packages/core/src/github/fork.ts`

**Implementation Steps:**
- `forkRepo(octokit, owner, repo, organization?)`
- Wait for fork to be ready

---

### P-100: GitHub — GH Actions Sandbox Trigger

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-099

**Files to Create/Modify:** `packages/core/src/github/sandbox.ts`

**Implementation Steps:**
- Dispatch `stitch-sandbox.yml` workflow
- Inputs: repo URL, branch, ecosystem
- Poll for completion

---

### P-101: GitHub — Tests with Mocked Octokit

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-100

**Files to Create/Modify:** `packages/core/src/github/__tests__/*.test.ts`

**Implementation Steps:**
- Mock Octokit with nock
- Test all functions
- Test error cases (404, 403, rate limit)

---

### P-102: GitHub — Error Mapping

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-101

**Files to Create/Modify:** `packages/core/src/github/errors.ts`

**Implementation Steps:**
- Map Octokit errors to `StitchError` codes
- 404 → NOT_FOUND, 403 → UNAUTHORIZED, 422 → VALIDATION_ERROR
- Rate limit → RETRYABLE_ERROR

---

### P-103: Deps — Ecosystem Detect

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-102

**Files to Create/Modify:** `packages/core/src/deps/detect.ts`

**Implementation Steps:**
```ts
export type Ecosystem = 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go'

export function detectEcosystem(repoPath: string): Ecosystem[]
```
- Checks for manifest files: package.json, pnpm-lock.yaml, yarn.lock, requirements.txt, pyproject.toml, Cargo.toml, go.mod
- Returns all detected (monorepos may have multiple)

---

### P-104: Deps — Parse package.json

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-103

**Files to Create/Modify:** `packages/core/src/deps/parse/npm.ts`

**Implementation Steps:**
```ts
export interface NpmManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  scripts?: Record<string, string>
  engines?: Record<string, string>
}

export function parsePackageJson(content: string): Result<NpmManifest, StitchError>
export function serializePackageJson(manifest: NpmManifest): string
```

---

### P-105: Deps — Parse requirements.txt / pyproject.toml

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-104

**Files to Create/Modify:** `packages/core/src/deps/parse/python.ts`

**Implementation Steps:**
- Parse requirements.txt (line-by-line, handle comments, extras, versions)
- Parse pyproject.toml ([project], [tool.poetry.dependencies], [tool.uv.sources])
- Return unified PythonManifest type

---

### P-106: Deps — Parse Cargo.toml

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-105

**Files to Create/Modify:** `packages/core/src/deps/parse/cargo.ts`

**Implementation Steps:**
- Parse Cargo.toml with `toml` crate equivalent
- Handle [dependencies], [dev-dependencies], [build-dependencies], [features]
- Return CargoManifest

---

### P-107: Deps — Parse go.mod

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-106

**Files to Create/Modify:** `packages/core/src/deps/parse/go.ts`

**Implementation Steps:**
- Parse go.mod (module, go version, require, replace, exclude)
- Return GoManifest

---

### P-108: Deps — Union Manifests + Conflict Detect

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-107

**Files to Create/Modify:** `packages/core/src/deps/merge.ts`

**Implementation Steps:**
```ts
export interface MergeResult {
  merged: UnifiedManifest
  conflicts: Conflict[]
}

export interface Conflict {
  type: 'version' | 'peer' | 'script' | 'config'
  package: string
  values: Record<string, string>  // source → version
  suggestedResolution?: string
}

export function unionManifests(manifests: ParsedManifest[]): MergeResult
```

---

### P-109: Deps — Semver Collision Resolver

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-108

**Files to Create/Modify:** `packages/core/src/deps/semver.ts`

**Implementation Steps:**
```ts
export function resolveCollision(rangeA: string, rangeB: string): string | null
```
- Uses `semver.intersects()` to find compatible range
- Returns intersected range or null if impossible
- Handles prerelease, wildcards

---

### P-110: Deps — PeerDependency Conflict Handling

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-109

**Files to Create/Modify:** `packages/core/src/deps/peer.ts`

**Implementation Steps:**
- Detect peer dep mismatches (e.g., react@18 vs react@17)
- Suggest resolution: upgrade/downgrade/peer dep meta

---

### P-111: Deps — Dedupe/Nest Strategy

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-110

**Files to Create/Modify:** `packages/core/src/deps/dedupe.ts`

**Implementation Steps:**
- For same package different versions: prefer hoisting (npm v7+)
- If incompatible: nest in separate node_modules (legacy)
- Report strategy used

---

### P-112: Deps — Scripts Merge

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-111

**Files to Create/Modify:** `packages/core/src/deps/scripts.ts`

**Implementation Steps:**
- Merge scripts objects
- Prefix conflicts: `repo-a:build`, `repo-b:build`
- Preserve unique scripts

---

### P-113: Deps — Config Files Merge

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-112

**Files to Create/Modify:** `packages/core/src/deps/config.ts`

**Implementation Steps:**
- Merge tsconfig.json (extends, compilerOptions)
- Merge vite.config.ts (plugins, build)
- Merge eslint.config.mjs (rules, plugins)
- Deep merge with conflict detection

---

### P-114: Deps — Lockfile Regeneration

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-113

**Files to Create/Modify:** `packages/core/src/deps/lockfile.ts`

**Implementation Steps:**
- `regenerateLockfile(manifest, ecosystem)` — runs `bun install`, `pip compile`, `cargo generate-lockfile`, `go mod tidy`
- Returns path to lockfile or error

---

### P-115: Deps — Ecosystem Plugin Interface

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-114

**Files to Create/Modify:** `packages/core/src/deps/plugin.ts`

**Implementation Steps:**
```ts
export interface ManifestParser {
  detect(repoPath: string): boolean
  parse(content: string): Result<ParsedManifest, StitchError>
  serialize(manifest: ParsedManifest): string
  merge(manifests: ParsedManifest[]): MergeResult
  regenerateLockfile(manifest: ParsedManifest, repoPath: string): Result<void, StitchError>
}
```

---

### P-116: Deps — Deps Report (JSON)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-115

**Files to Create/Modify:** `packages/core/src/deps/report.ts`

**Implementation Steps:**
```ts
export function generateDepReport(result: MergeResult): DependencyReport
```
- Includes: merged deps, conflicts, resolutions, lockfile status

---

### P-117: Deps — Tests with Fixtures

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-116

**Files to Create/Modify:** `packages/core/src/deps/__tests__/*.test.ts`

**Implementation Steps:**
- Fixture manifests for each ecosystem
- Test collision scenarios
- Test merge output validity

---

**END OF SECOND CHUNK (P-069 through P-117 = 49 phases)**

---

## NEXT CHUNK: P-118 through P-188 (Epics 5–9: License, AI Provider, Agent Tools, Sandbox, Provenance)

---

### P-118: License — Scan Declared Licenses

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-117

**Context:** Scan manifest files for declared licenses using `license-checker`. This is the fast MVP path (not source-header scanning).

**Files to Create/Modify:**
- `packages/core/src/license/scan.ts`

**Implementation Steps:**
```ts
import licenseChecker from 'license-checker'
import { Result, ok, err } from '../result'
import { StitchError } from '../result'

export interface DeclaredLicense {
  package: string
  version: string
  licenses: string
  repository?: string
  licenseFile?: string
}

export async function scanDeclaredLicenses(repoPath: string): Promise<Result<DeclaredLicense[], StitchError>> {
  return new Promise((resolve) => {
    licenseChecker.init({
      start: repoPath,
      production: true,
      json: true,
      unknown: true,
      excludePrivatePackages: false
    }, (err, pkgs) => {
      if (err) {
        resolve(err({ code: 'LICENSE_SCAN_FAILED', message: String(err) }))
        return
      }
      const results: DeclaredLicense[] = Object.entries(pkgs).map(([pkg, info]: [string, any]) => ({
        package: pkg.split('@')[0],
        version: pkg.split('@')[1] || 'unknown',
        licenses: info.licenses || 'UNKNOWN',
        repository: info.repository,
        licenseFile: info.licenseFile
      }))
      resolve(ok(results))
    })
  })
}
```

**Required MCPs/Connectors:** npm `license-checker` binary

**Acceptance Criteria:**
- [ ] Scans package.json, requirements.txt, Cargo.toml, go.mod
- [ ] Returns normalized license strings
- [ ] Handles UNKNOWN licenses
- [ ] Works on monorepos with multiple manifests

---

### P-119: License — SPDX Normalize

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-118

**Files to Create/Modify:** `packages/core/src/license/spdx.ts`

**Implementation Steps:**
```ts
import { correct } from 'spdx-correct'
import { licenses } from 'spdx-license-list'

export function normalizeToSPDX(raw: string): string {
  try {
    return correct(raw) || raw
  } catch {
    return raw
  }
}

export function isValidSPDX(id: string): boolean {
  return licenses.some(l => l.licenseId === id || l.seeAlso?.includes(id))
}
```

**Acceptance Criteria:**
- [ ] `MIT` → `MIT`, `Apache 2.0` → `Apache-2.0`
- [ ] Unknown licenses pass through unchanged
- [ ] `isValidSPDX` validates against official list

---

### P-120: License — Compatibility Matrix

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-119

**Files to Create/Modify:** `packages/core/src/license/compat.ts`

**Implementation Steps:**
```ts
export type LicenseCategory = 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'network-copyleft' | 'unknown'

export const LICENSE_CATEGORIES: Record<string, LicenseCategory> = {
  'MIT': 'permissive', 'Apache-2.0': 'permissive', 'BSD-2-Clause': 'permissive', 'BSD-3-Clause': 'permissive',
  'ISC': 'permissive', 'Unlicense': 'permissive', 'CC0-1.0': 'permissive',
  'LGPL-2.1': 'weak-copyleft', 'LGPL-3.0': 'weak-copyleft', 'MPL-2.0': 'weak-copyleft',
  'GPL-2.0': 'strong-copyleft', 'GPL-3.0': 'strong-copyleft', 'AGPL-3.0': 'strong-copyleft',
  'SSPL-1.0': 'network-copyleft'
}

export function checkCompatibility(licenses: string[], policy: LicensePolicy): CompatibilityResult
```

**Acceptance Criteria:**
- [ ] Categorizes all common licenses
- [ ] Detects GPL/AGPL in permissive project → error
- [ ] LGPL/MPL → warning
- [ ] Policy-configurable allow/warn/deny lists

---

### P-121: License — GPL/AGPL Warning

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-120

**Files to Create/Modify:** `packages/core/src/license/gpl.ts`

**Implementation Steps:**
- Special handling for GPL family
- Checks if GPL code links with non-GPL (static/dynamic linking)
- For JS/TS: any GPL in deps = warning (conservative)
- Generates actionable remediation suggestions

---

### P-122: License — Dual-License Handling

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-121

**Files to Create/Modify:** `packages/core/src/license/dual.ts`

**Implementation Steps:**
- Parse `MIT OR Apache-2.0` expressions
- Choose most permissive compatible option
- Report both options

---

### P-123: License — Unknown Detection

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-122

**Files to Create/Modify:** `packages/core/src/license/unknown.ts`

**Implementation Steps:**
- Flag packages with `UNKNOWN` or non-SPDX licenses
- Require human decision (policy: allow/deny)
- Suggest checking LICENSE file manually

---

### P-124: License — Per-File Header Scan (ScanCode Opt-in)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-123

**Files to Create/Modify:** `packages/core/src/license/deepScan.ts`

**Implementation Steps:**
```ts
export async function runScanCode(repoPath: string): Promise<Result<DeepScanResult, StitchError>>
```
- Shells out to `scancode-toolkit` (Python)
- Only runs if `config.licensePolicy.deepScan === true`
- Parses JSON output → per-file license/copyright

---

### P-125: License — Generate LICENSE for C

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-124

**Files to Create/Modify:** `packages/core/src/license/generate.ts`

**Implementation Steps:**
- Based on compatibility result, choose output license
- If all permissive → MIT
- If any copyleft → must match strongest copyleft
- Write LICENSE file to child repo

---

### P-126: License — NOTICE/Attribution

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-125

**Files to Create/Modify:** `packages/core/src/license/notice.ts`

**Implementation Steps:**
- Generate NOTICE file with all attributions
- Required for Apache-2.0, BSD, etc.
- Format: `This product includes <pkg> (<license>) from <source>`

---

### P-127: License — Policy Allow/Deny

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-126

**Files to Create/Modify:** `packages/core/src/license/policy.ts`

**Implementation Steps:**
- Load policy from config (allow[], warn[], deny[])
- `evaluate(report, policy)` → `{ allowed, warnings, denied }`
- Deny = block merge unless overridden

---

### P-128: License — License Report Data

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-127

**Files to Create/Modify:** `packages/core/src/license/report.ts`

**Implementation Steps:**
- Generate structured `LicenseReport` for UI
- Includes: per-package table, compatibility matrix, policy verdict

---

### P-129: License — Deep-Scan Plugin

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-128

**Files to Create/Modify:** `packages/core/src/license/plugin.ts`

**Implementation Steps:**
- Plugin interface for alternative scanners
- ScanCode is default implementation
- Allows future: FOSSA, Snyk, etc.

---

### P-130: License — Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-129

**Files to Create/Modify:** `packages/core/src/license/__tests__/*.test.ts`

**Implementation Steps:**
- Fixture repos with known licenses
- Test GPL detection, SPDX normalization, policy evaluation

---

### P-131: AI Provider — ChatProvider Interface

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-130

**Files to Create/Modify:** `packages/core/src/ai/provider.ts`

**Implementation Steps:**
```ts
export interface ChatProvider {
  readonly name: string
  readonly model: string
  chat(messages: ChatMessage[], tools: ToolSchema[], options?: ChatOptions): AsyncIterable<ChatResponse>
  countTokens(messages: ChatMessage[]): number
}

export interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string }
export interface ToolSchema { name: string; description: string; parameters: JSONSchema }
export interface ChatResponse { content?: string; toolCalls?: ToolCall[]; finishReason: string; usage?: TokenUsage }
```

---

### P-132: AI Provider — OpenAICompatibleProvider

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-131

**Files to Create/Modify:** `packages/core/src/ai/openaiCompatible.ts`

**Implementation Steps:**
- Wraps `openai` SDK
- Base URL configurable (OpenRouter, OpenAI, Ollama)
- Normalizes tool calling to internal format
- Handles streaming responses

---

### P-133: AI Provider — AnthropicProvider

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-132

**Files to Create/Modify:** `packages/core/src/ai/anthropic.ts`

**Implementation Steps:**
- Wraps `@anthropic-ai/sdk`
- Converts Anthropic tool format ↔ internal format
- Handles `tool_use` / `tool_result` blocks

---

### P-134: AI Provider — Provider Registry + Config

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-133

**Files to Create/Modify:** `packages/core/src/ai/registry.ts`

**Implementation Steps:**
```ts
export function createProvider(config: ProviderConfig): ChatProvider
export const providerRegistry = new Map<string, () => ChatProvider>()
```
- Reads config (provider, model, apiKey, baseUrl)
- Instantiates correct provider

---

### P-135: AI Provider — Model Registry

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-134

**Files to Create/Modify:** `packages/core/src/ai/models.ts`

**Implementation Steps:**
- `models.json` with ModelSpec (id, provider, contextWindow, supportsTools, maxOutput, cost, recommendedFor)
- `getModel(id)` → ModelSpec
- `getRecommendedFor(task)` → best model

---

### P-136: AI Provider — Streaming Support

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-135

**Files to Create/Modify:** `packages/core/src/ai/stream.ts`

**Implementation Steps:**
- `streamChat(provider, messages, tools)` → AsyncIterable<ReasoningChunk>
- Buffers tool calls across chunks
- Emits `reasoning` events for WS

---

### P-137: AI Provider — Token/Cost Estimate

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-136

**Files to Create/Modify:** `packages/core/src/ai/cost.ts`

**Implementation Steps:**
- `estimateCost(messages, model)` → `{ promptTokens, estimatedCompletionTokens, costUSD }`
- Per-job budget tracking (default 500k tokens)
- Warns at 80%, aborts at 100%

---

### P-138: AI Provider — Retry/Backoff

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-137

**Files to Create/Modify:** `packages/core/src/ai/retry.ts`

**Implementation Steps:**
- Exponential backoff for 429, 5xx
- Respects `Retry-After` header
- Max 3 retries

---

### P-139: AI Provider — Zod→JSON Tool Adapter

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-138

**Files to Create/Modify:** `packages/core/src/ai/toolAdapter.ts`

**Implementation Steps:**
```ts
import { zodToJsonSchema } from 'zod-to-json-schema'

export function toolSchemaFromZod(zodSchema: z.ZodTypeAny): ToolSchema
```
- Converts Zod schemas to JSON Schema for tool definitions
- Used by all tool definitions

---

### P-140: AI Provider — Tool-Loop Executor

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-139

**Files to Create/Modify:** `packages/core/src/ai/loop.ts`

**Implementation Steps:**
```ts
export async function runAgentLoop(input: AgentInput, tools: Tool[], policy: AutonomyPolicy): Promise<AgentOutput>
```
- Multi-turn loop: prompt → tool calls → execute → results → repeat
- Handles tool call batching
- Enforces autonomy policy (auto vs gated)

---

### P-141: AI Provider — Prompt Templates

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-140

**Files to Create/Modify:** `packages/core/src/ai/prompts.ts`

**Implementation Steps:**
- System prompt for stitch agent
- Task-specific prompts (select, resolve, detect, propose)
- Context injection (repo trees, manifests, gaps)

---

### P-142: AI Provider — Context Window Management

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-141

**Files to Create/Modify:** `packages/core/src/ai/context.ts`

**Implementation Steps:**
- `buildContext(repoTree, selection, gaps, maxTokens)` → token-budgeted context
- Summarizes large trees (keep file names, drop content)
- Prioritizes: user selection → gaps → deps → config

---

### P-143: AI Provider — Block Gemini-3 Tool-Calling Default

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-142

**Files to Create/Modify:** `packages/core/src/ai/models.ts` (add to ModelSpec)

**Implementation Steps:**
- Mark Gemini 3 models as `supportsTools: false` for OpenRouter
- Document in model registry
- Default agent model: `anthropic/claude-3.5-sonnet`

---

### P-144: AI Provider — Mock Provider

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-143

**Files to Create/Modify:** `packages/core/src/ai/mock.ts`

**Implementation Steps:**
- `MockProvider` implements `ChatProvider`
- Returns canned responses for testing
- Simulates tool calls, delays, errors

---

### P-145: AI Provider — AI Call Audit Log

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-144

**Files to Create/Modify:** `packages/core/src/ai/audit.ts`

**Implementation Steps:**
- Log every AI call: provider, model, tokens, cost, duration
- Store in SQLite `provider_usage` table
- Redact prompt content (keep structure only)

---

### P-146: AI Provider — Runtime Provider Switch

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-145

**Files to Create/Modify:** `packages/core/src/ai/switch.ts`

**Implementation Steps:**
- `setProvider(config)` — hot-swap without restart
- Web UI setting triggers this
- Validates new provider works (test call)

---

### P-147: AI Provider — Loop Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-146

**Files to Create/Modify:** `packages/core/src/ai/__tests__/*.test.ts`

**Implementation Steps:**
- Test tool loop with MockProvider
- Test autonomy policy (auto vs gated)
- Test context budgeting
- Test error handling

---

### P-148: Agent Tools — select_files

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-147

**Files to Create/Modify:** `packages/core/src/ai/tools/selectFiles.ts`

**Implementation Steps:**
```ts
export const selectFilesTool = {
  name: 'select_files',
  description: 'Propose which files to pull from each parent repo',
  parameters: z.object({
    repo: z.enum(['A', 'B']),
    paths: z.array(z.string()),
    reason: z.string()
  }),
  handler: async (args) => { /* validate paths exist in repo tree */ }
}
```

---

### P-149: Agent Tools — resolve_dependency_closure

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-148

**Files to Create/Modify:** `packages/core/src/ai/tools/resolveDeps.ts`

**Implementation Steps:**
- Input: selected files
- Uses tree-sitter/dependency-cruiser to find imports
- Returns transitive closure of required files

---

### P-150: Agent Tools — detect_gaps

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-149

**Files to Create/Modify:** `packages/core/src/ai/tools/detectGaps.ts`

**Implementation Steps:**
- Analyzes merged tree for:
  - Broken imports (missing files)
  - Conflicting entrypoints (two `main` exports)
  - Missing config (tsconfig, eslint, etc.)
  - Duplicate symbols
- Returns structured `Gap[]`

---

### P-151: Agent Tools — fix_dependency (auto)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-150

**Files to Create/Modify:** `packages/core/src/ai/tools/fixDeps.ts`

**Implementation Steps:**
- Auto-executed tool
- Edits manifest to resolve version collisions
- Uses `resolveCollision` from deps merge

---

### P-152: Agent Tools — edit_config (auto)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-151

**Files to Create/Modify:** `packages/core/src/ai/tools/editConfig.ts`

**Implementation Steps:**
- Auto-executed
- Merges tsconfig, eslint, vite configs
- Uses config merge logic from deps

---

### P-153: Agent Tools — move_file (auto)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-152

**Files to Create/Modify:** `packages/core/src/ai/tools/moveFile.ts`

**Implementation Steps:**
- Auto-executed
- Relocates files to avoid path collisions
- Updates imports in moved files (tree-sitter)

---

### P-154: Agent Tools — propose_component (gated)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-153

**Files to Create/Modify:** `packages/core/src/ai/tools/proposeComponent.ts`

**Implementation Steps:**
```ts
export const proposeComponentTool = {
  name: 'propose_component',
  description: 'Generate new bridging code (adapter, facade, wiring). Requires human approval.',
  parameters: z.object({
    files: z.array(z.object({
      path: z.string(),
      content: z.string(),
      language: z.string()
    })),
    description: z.string(),
    reason: z.string()
  }),
  autonomy: 'gated'
}
```
- Generates net-new code
- Emits `proposal` event → WS → UI diff viewer
- Waits for approve/reject

---

### P-155: Agent Tools — run_build (sandbox)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-154

**Files to Create/Modify:** `packages/core/src/ai/tools/runBuild.ts`

**Implementation Steps:**
- Triggers sandbox build/test
- Returns `SandboxResult` (pass/fail, logs)
- Auto-retries on flaky failures

---

### P-156: Agent Tools — ask_user

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-155

**Files to Create/Modify:** `packages/core/src/ai/tools/askUser.ts`

**Implementation Steps:**
- Clarification questions (e.g., "Which entrypoint should be main?")
- Emits `question` event → UI prompt
- Returns user answer

---

### P-157: Agent Tools — Autonomy Policy Engine

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-156

**Files to Create/Modify:** `packages/core/src/ai/policy.ts`

**Implementation Steps:**
```ts
export const DEFAULT_POLICY: AutonomyPolicy = {
  auto: ['fix_dependency', 'edit_config', 'move_file', 'run_build'],
  gated: ['propose_component', 'ask_user']
}
```
- Configurable via `~/.stitch/config.json`
- Validates tool names exist

---

### P-158: Agent Tools — Tool Result Validation

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-157

**Files to Create/Modify:** `packages/core/src/ai/validation.ts`

**Implementation Steps:**
- Validates tool output against schema
- Rejects malformed results
- Retries with corrected prompt

---

### P-159: Agent Tools — Agent State Machine

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-158

**Files to Create/Modify:** `packages/core/src/ai/stateMachine.ts`

**Implementation Steps:**
- States: `planning` → `acting` → `verifying` → `complete`|`failed`
- Transitions on tool results
- Max iterations guard (default 25)

---

### P-160: Agent Tools — HIL Approval Queue

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-159

**Files to Create/Modify:** `packages/core/src/ai/approvalQueue.ts`

**Implementation Steps:**
- Queue for gated tools awaiting human decision
- `submit(proposal)` → returns promise resolving on approve/reject
- Timeout handling (default 30 min → auto-reject)

---

### P-161: Agent Tools — Revert a Tool Action

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-160

**Files to Create/Modify:** `packages/core/src/ai/revert.ts`

**Implementation Steps:**
- `revert(toolCallId)` — undoes file writes, config changes
- Uses git stash/snapshots
- Logged in audit trail

---

### P-162: Agent Tools — Reasoning Stream

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-161

**Files to Create/Modify:** `packages/core/src/ai/reasoning.ts`

**Implementation Steps:**
- Captures AI "thinking" between tool calls
- Streams as `reasoning` events via WS
- UI renders as live markdown

---

### P-163: Agent Tools — Error Handling

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-162

**Files to Create/Modify:** `packages/core/src/ai/errors.ts`

**Implementation Steps:**
- Maps tool errors to `StitchError`
- Retry logic for transient failures
- Escalates to `ask_user` on repeated failure

---

### P-164: Agent Tools — Loop Cap

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-163

**Files to Create/Modify:** `packages/core/src/ai/loopCap.ts`

**Implementation Steps:**
- Hard cap: 25 iterations per job
- Configurable via policy
- On cap: emit `error`, pause job

---

### P-165: Agent Tools — Git-Core Integration

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-164

**Files to Create/Modify:** `packages/core/src/ai/gitIntegration.ts`

**Implementation Steps:**
- Tool handlers call `writeFileToWorktree`, `commitWithTrailers`
- Uses git core functions directly
- Maintains provenance mapping

---

### P-166: Agent Tools — Deps/License Integration

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-165

**Files to Create/Modify:** `packages/core/src/ai/depsLicenseIntegration.ts`

**Implementation Steps:**
- `fix_dependency` calls deps merge resolution
- `propose_component` checks license of generated code
- Sandbox runs license scan

---

### P-167: Agent Tools — E2E Agent Test

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-166

**Files to Create/Modify:** `packages/core/src/ai/__tests__/e2e.test.ts`

**Implementation Steps:**
- Full agent loop on fixture repos
- Verify auto fixes apply, gated proposals appear
- Verify sandbox runs

---

### P-168: Sandbox — Docker Client

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-167

**Files to Create/Modify:** `packages/core/src/sandbox/docker.ts`

**Implementation Steps:**
```ts
import Docker from 'dockerode'

export const docker = new Docker({ socketPath: process.env.DOCKER_HOST || '/var/run/docker.sock' })
export async function ensureImage(image: string): Promise<void>
```

---

### P-169: Sandbox — Ephemeral Image per Ecosystem

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-168

**Files to Create/Modify:** `packages/core/src/sandbox/images.ts`

**Implementation Steps:**
- Map ecosystem → image tag
- `getSandboxImage(ecosystem)` → tag
- Pull if missing

---

### P-170: Sandbox — Install Deps

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-169

**Files to Create/Modify:** `packages/core/src/sandbox/install.ts`

**Implementation Steps:**
- `runInstall(container, ecosystem, workdir)`
- Commands: `bun install`, `pip install -r requirements.txt`, `cargo build`, `go mod download`

---

### P-171: Sandbox — Run Build

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-170

**Files to Create/Modify:** `packages/core/src/sandbox/build.ts`

**Implementation Steps:**
- `runBuild(container, ecosystem, workdir)`
- Detects build script from manifest
- Runs in container

---

### P-172: Sandbox — Run Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-171

**Files to Create/Modify:** `packages/core/src/sandbox/test.ts`

**Implementation Steps:**
- `runTests(container, ecosystem, workdir)`
- Commands: `bun test`, `pytest`, `cargo test`, `go test ./...`
- Parses output for pass/fail

---

### P-173: Sandbox — Capture Logs/Artifacts

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-172

**Files to Create/Modify:** `packages/core/src/sandbox/logs.ts`

**Implementation Steps:**
- Streams stdout/stderr to job events
- Captures last 10MB per step
- Saves artifacts (coverage, build output) to job output

---

### P-174: Sandbox — Timeout/Limits

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-173

**Files to Create/Modify:** `packages/core/src/sandbox/limits.ts`

**Implementation Steps:**
- Enforces: memory, CPU, pids, wall time
- Kills container on limit exceeded
- Returns `SandboxError` with limit type

---

### P-175: Sandbox — GH Actions Fallback

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-174

**Files to Create/Modify:** `packages/core/src/sandbox/fallback.ts`

**Implementation Steps:**
- If Docker unavailable, dispatch `stitch-sandbox.yml`
- Polls workflow run via Octokit
- Returns same `SandboxResult` interface

---

### P-176: Sandbox — Pass/Fail + Flaky Detection

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-175

**Files to Create/Modify:** `packages/core/src/sandbox/result.ts`

**Implementation Steps:**
- `SandboxResult`: `{ passed: boolean, logs: string, flaky: boolean, retries: number }`
- Re-runs failed tests once (configurable)
- Marks flaky if passes on retry

---

### P-177: Sandbox — Cleanup

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-176

**Files to Create/Modify:** `packages/core/src/sandbox/cleanup.ts`

**Implementation Steps:**
- `cleanup(container)` — stop + remove
- Removes temp volumes
- Runs on success, failure, timeout

---

### P-178: Sandbox — Layer Cache

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-177

**Files to Create/Modify:** `packages/core/src/sandbox/cache.ts`

**Implementation Steps:**
- Docker layer caching via base images
- Volume cache for `node_modules`, `target`, `.cargo`
- Keyed by lockfile hash

---

### P-179: Sandbox — Secret-Safe Sandbox

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-178

**Files to Create/Modify:** `packages/core/src/sandbox/security.ts`

**Implementation Steps:**
- Hardened container config (SECURITY.md §4.1)
- No network, read-only rootfs, no caps
- Non-root user

---

### P-180: Sandbox — Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-179

**Files to Create/Modify:** `packages/core/src/sandbox/__tests__/*.test.ts`

**Implementation Steps:**
- Test each ecosystem build+test
- Test Docker unavailable → GH Actions fallback
- Test limit enforcement

---

### P-181: Provenance — Track Source Repo/Commit/Author per File

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-180

**Files to Create/Modify:** `packages/core/src/provenance/track.ts`

**Implementation Steps:**
- Uses `mapBlame` from git core
- Builds `ProvenanceEntry[]` for all files in child repo
- Stores in job output

---

### P-182: Provenance — CREDITS.md

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-181

**Files to Create/Modify:** `packages/core/src/provenance/credits.ts`

**Implementation Steps:**
```ts
export function generateCredits(entries: ProvenanceEntry[]): string
```
- Markdown table: `Path | Source Repo | Commit | Author | Date | License`
- Written to child repo root

---

### P-183: Provenance — SBOM (CycloneDX/SPDX)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-182

**Files to Create/Modify:** `packages/core/src/provenance/sbom.ts`

**Implementation Steps:**
- Generates CycloneDX JSON
- Components = source repos + dependencies
- Includes licenses, hashes, provenance

---

### P-184: Provenance — Git Notes

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-183

**Files to Create/Modify:** `packages/core/src/provenance/gitNotes.ts`

**Implementation Steps:**
```ts
export async function attachProvenanceNotes(repoPath: string, entries: ProvenanceEntry[]): Promise<void>
```
- `git notes add -f -m '<json>' <file>` for each file
- Machine-readable, travels with repo

---

### P-185: Provenance — UI Provenance View

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-184

**Files to Create/Modify:** `packages/core/src/provenance/uiView.ts`

**Implementation Steps:**
- Data structure for web UI provenance panel
- File tree with origin badges
- Commit link to GitHub

---

### P-186: Provenance — Checksum Manifest

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-185

**Files to Create/Modify:** `packages/core/src/provenance/manifest.ts`

**Implementation Steps:**
- SHA256 of every file in child repo
- `MANIFEST.sha256` file
- Used for integrity verification

---

### P-187: Provenance — Audit Log

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-186

**Files to Create/Modify:** `packages/core/src/provenance/audit.ts`

**Implementation Steps:**
- Structured audit event per job
- Includes: parent repos, child repo, license verdict, AI usage, sandbox result
- Written to stdout + SQLite

---

### P-188: Provenance — Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-187

**Files to Create/Modify:** `packages/core/src/provenance/__tests__/*.test.ts`

**Implementation Steps:**
- Verify CREDITS.md format
- Verify SBOM validity (CycloneDX schema)
- Verify git notes attach/read

---

**END OF THIRD CHUNK (P-118 through P-188 = 71 phases)**

---

## NEXT CHUNK: P-189 through P-282 (Epics 10–14: CLI, Web UI, Orchestration, Testing, Docs)

---

### P-189: CLI — Commander + Global Options

**Owner:** aradhy | **Wave:** 1 (post-handoff) | **Depends On:** Wave 0 complete (P-317)

**Context:** CLI entry point using Commander.js with global options shared across all commands.

**Files to Create/Modify:**
- `packages/cli/src/index.ts`
- `packages/cli/src/commands/index.ts` (command registry)

**Implementation Steps:**
```ts
import { Command } from 'commander'
import { version } from '../package.json'

const program = new Command()
  .name('stitch')
  .description('Multi-repo composition engine with AI-augmented stitching')
  .version(version)
  .option('-c, --config <path>', 'config file path')
  .option('-v, --verbose', 'verbose logging')
  .option('--no-color', 'disable colors')
  .hook('preAction', (thisCmd, actionCmd) => {
    // Load config, setup logger level
  })

// Register all commands
import { initCmd } from './init'
import { addCmd } from './add'
// ... etc
program.addCommand(initCmd).addCommand(addCmd) // ...

export { program }
```

**Required MCPs/Connectors:** None

**Acceptance Criteria:**
- [ ] `stitch --help` shows all commands
- [ ] `stitch --version` works
- [ ] Global options parsed correctly
- [ ] Unknown command shows helpful error

---

### P-190: CLI — stitch init

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-189

**Files to Create/Modify:** `packages/cli/src/commands/init.ts`

**Implementation Steps:**
```ts
export const initCmd = new Command('init')
  .description('Initialize .stitch config in current directory')
  .option('-f, --force', 'overwrite existing config')
  .action(async (opts) => {
    // Create .stitch/config.json with defaults
    // Prompt for GitHub auth if not configured
  })
```

**Acceptance Criteria:**
- [ ] Creates `.stitch/config.json` with defaults
- [ ] Prompts for GitHub token if missing
- [ ] `--force` overwrites

---

### P-191: CLI — stitch add <repo> <paths...>

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-190

**Files to Create/Modify:** `packages/cli/src/commands/add.ts`

**Implementation Steps:**
```ts
export const addCmd = new Command('add')
  .description('Add a parent repository and select paths')
  .argument('<repo>', 'GitHub repo (owner/repo[@branch])')
  .argument('[paths...]', 'paths to include (glob)')
  .option('-b, --branch <branch>', 'branch name')
  .action(async (repo, paths, opts) => {
    // Validate repo format
    // Fetch repo tree via GitHub API
    // If paths empty → interactive picker (ink)
    // Save selection to job queue
  })
```

**Acceptance Criteria:**
- [ ] Parses `owner/repo@branch` format
- [ ] Fetches file tree from GitHub
- [ ] Interactive path picker if no paths given
- [ ] Stores selection for merge

---

### P-192: CLI — stitch merge

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-191

**Files to Create/Modify:** `packages/cli/src/commands/merge.ts`

**Implementation Steps:**
```ts
export const mergeCmd = new Command('merge')
  .description('Execute the stitch merge job')
  .option('--dry-run', 'simulate without pushing')
  .option('--no-sandbox', 'skip build/test verification')
  .option('--license-policy <strict|warn|off>', 'license enforcement')
  .action(async (opts) => {
    // Load selections from add commands
    // Call core.createStitchJob()
    // If --dry-run: print plan and exit
    // Otherwise: start job, stream events
    // On gated proposal: show diff in TUI, prompt approve/reject
  })
```

**Acceptance Criteria:**
- [ ] Creates job via core API
- [ ] Streams progress to console (ink)
- [ ] Handles gated proposals in TUI
- [ ] `--dry-run` shows plan without executing
- [ ] `--no-sandbox` skips verification

---

### P-193: CLI — stitch serve (Elysia)

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-192

**Files to Create/Modify:**
- `packages/cli/src/server/index.ts`
- `packages/cli/src/server/routes.ts`

**Implementation Steps:**
```ts
import { Elysia } from 'elysia'
import { staticPlugin } from '@elysiajs/static'
import { ws } from '@elysiajs/ws'

export function createServer(core: CoreAPI) {
  return new Elysia()
    .use(staticPlugin({ assets: '../../web/dist', prefix: '/' }))
    .use(ws())
    .get('/api/health', () => ({ ok: true, version }))
    .get('/api/schema', () => core.getOpenAPISchema())
    .post('/api/jobs', ({ body }) => core.createJob(body))
    .get('/api/jobs/:id', ({ params }) => core.getJob(params.id))
    .post('/api/jobs/:id/cancel', ({ params }) => core.cancelJob(params.id))
    .post('/api/jobs/:id/approve', ({ params, body }) => core.approveProposal(params.id, body.toolCallId))
    .post('/api/jobs/:id/reject', ({ params, body }) => core.rejectProposal(params.id, body.toolCallId, body.reason))
    .ws('/ws', {
      message(ws, message) { /* handle subscribe/approve/reject */ },
      open(ws) { /* track connection */ },
      close(ws) { /* cleanup */ }
    })
    .listen(3434, '127.0.0.1')
}
```

**Acceptance Criteria:**
- [ ] Serves Web UI at `http://localhost:3434`
- [ ] REST API works for job control
- [ ] WS `/ws?jobId=xxx` streams events
- [ ] Binds to 127.0.0.1 only

---

### P-194: CLI — stitch status

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-193

**Files to Create/Modify:** `packages/cli/src/commands/status.ts`

**Implementation Steps:**
```ts
export const statusCmd = new Command('status')
  .description('Show job status or history')
  .argument('[jobId]', 'job ID to show')
  .option('-a, --all', 'show all jobs')
  .action(async (jobId, opts) => {
    // Query SQLite for job(s)
    // Render table: ID, Type, Status, Created, Duration
    // If jobId given: show full details + events
  })
```

**Acceptance Criteria:**
- [ ] Lists recent jobs with status
- [ ] Shows details for specific job
- [ ] `--all` shows full history

---

### P-195: CLI — stitch doctor

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-194

**Files to Create/Modify:** `packages/cli/src/commands/doctor.ts` (moved from P-068)

**Implementation Steps:**
- Already implemented in P-068, now wired as CLI command
- Checks: git, git-filter-repo, docker, bun, python
- Output: ✅/❌ with install hints

---

### P-196: CLI — stitch license

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-195

**Files to Create/Modify:** `packages/cli/src/commands/license.ts`

**Implementation Steps:**
```ts
export const licenseCmd = new Command('license')
  .description('Scan license compliance for a repo')
  .argument('<repo>', 'GitHub repo or local path')
  .option('--policy <strict|warn|off>', 'enforcement level')
  .action(async (repo, opts) => {
    // Clone if remote
    // Run core.scanLicenses()
    // Print report table
    // Exit code 1 if policy violated
  })
```

**Acceptance Criteria:**
- [ ] Works on local path or GitHub URL
- [ ] Prints license table
- [ ] Exit code reflects policy

---

### P-197: CLI — stitch deps

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-196

**Files to Create/Modify:** `packages/cli/src/commands/deps.ts`

**Implementation Steps:**
```ts
export const depsCmd = new Command('deps')
  .description('Analyze dependency conflicts between repos')
  .argument('<repoA>')
  .argument('<repoB>')
  .action(async (repoA, repoB) => {
    // Clone both
    // Run core.mergeManifests()
    // Print collision table
  })
```

---

### P-198: CLI — Ink Interactive Picker

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-197

**Files to Create/Modify:**
- `packages/cli/src/ui/RepoPicker.tsx`
- `packages/cli/src/ui/PathSelector.tsx`
- `packages/cli/src/ui/Progress.tsx`

**Implementation Steps:**
- `RepoPicker`: searchable list from GitHub API (debounced)
- `PathSelector`: checkbox tree with dependency closure toggle
- `Progress`: multi-step bar with substep detail

---

### P-199: CLI — Progress Rendering

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-198

**Files to Create/Modify:** `packages/cli/src/ui/Progress.tsx` (continued)

**Implementation Steps:**
- Live progress for each pipeline step
- Sub-step spinner
- ETA estimation

---

### P-200: CLI — ~/.stitch Config Store

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-199

**Files to Create/Modify:** `packages/cli/src/config/store.ts`

**Implementation Steps:**
- Uses `configstore` (encrypted)
- `get(key)`, `set(key, value)`, `delete(key)`
- Keys: github.auth, openrouter.apiKey, anthropic.apiKey, ollama.baseUrl

---

### P-201: CLI — Error UX

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-200

**Files to Create/Modify:** `packages/cli/src/ui/errors.tsx`

**Implementation Steps:**
- Pretty error panels (ink)
- Actionable suggestions
- Links to docs

---

### P-202: CLI — Help

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-201

**Files to Create/Modify:** `packages/cli/src/commands/help.ts`

**Implementation Steps:**
- Custom help command with examples
- `stitch help <command>` for subcommand help

---

### P-203: CLI — Autocomplete

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-202

**Files to Create/Modify:** `packages/cli/src/commands/completion.ts`

**Implementation Steps:**
- `stitch completion bash|zsh|fish` → prints script
- Command/option completion
- Repo name completion (from GitHub API cache)

---

### P-204: CLI — Integration Tests

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-203

**Files to Create/Modify:** `packages/cli/__tests__/integration.test.ts`

**Implementation Steps:**
- Test full `stitch add → merge` flow
- Mock GitHub API, Docker
- Test error paths

---

### P-205: CLI — Windows Path Handling

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-204

**Files to Create/Modify:** `packages/cli/src/util/paths.ts`

**Implementation Steps:**
- `path.resolve` with `\\?\` prefix for long paths
- Forward slashes for git/filter-repo args
- Test on Windows CI

---

### P-206: CLI — Theme

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-205

**Files to Create/Modify:** `packages/cli/src/ui/theme.ts`

**Implementation Steps:**
- Color scheme for ink components
- Respects `--no-color` and `NO_COLOR` env

---

### P-207: CLI — Release Binary Build

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-206

**Files to Create/Modify:** `.github/workflows/release.yml` (add binary build)

**Implementation Steps:**
```yaml
- run: bun build --compile --target=bun-linux-x64-modern packages/cli/src/index.ts --outfile stitch-linux-x64
- run: bun build --compile --target=bun-darwin-arm64 packages/cli/src/src/index.ts --outfile stitch-darwin-arm64
- run: bun build --compile --target=bun-windows-x64 packages/cli/src/index.ts --outfile stitch-windows-x64.exe
```

---

### P-208: Web — Vite+Tailwind Scaffold

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-207

**Files to Create/Modify:**
- `packages/web/vite.config.ts`
- `packages/web/tailwind.config.ts`
- `packages/web/postcss.config.js`
- `packages/web/src/styles/globals.css`

**Implementation Steps:**
- Vite config with React, path aliases
- Tailwind with custom design tokens
- Dark mode via `class` strategy

---

### P-209: Web — Design Tokens

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-208

**Files to Create/Modify:** `packages/web/src/styles/tokens.css`

**Implementation Steps:**
- CSS variables for colors, spacing, radii
- Semantic tokens (primary, surface, border, text)
- Consistent with CLI theme

---

### P-210: Web — Shell Layout

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-209

**Files to Create/Modify:**
- `packages/web/src/components/Layout.tsx`
- `packages/web/src/components/Sidebar.tsx`
- `packages/web/src/components/Topbar.tsx`

**Implementation Steps:**
- Responsive sidebar (collapsible)
- Topbar: theme toggle, notifications, user menu
- Mobile drawer

---

### P-211: Web — Repo A Picker

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-210

**Files to Create/Modify:** `packages/web/src/pages/MergeWizard/Step1RepoPicker.tsx`

**Implementation Steps:**
- Search input → GitHub API `/search/repos`
- List results with avatar, description, stars
- Manual URL input fallback
- Selection stored in Zustand

---

### P-212: Web — Repo B Picker

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-211

**Files to Create/Modify:** `packages/web/src/pages/MergeWizard/Step1RepoPicker.tsx` (same component, two instances)

---

### P-213: Web — File Tree A

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-212

**Files to Create/Modify:**
- `packages/web/src/components/FileTree.tsx`
- `packages/web/src/hooks/useFileTree.ts`

**Implementation Steps:**
- `react-arborist` with virtualization
- Checkbox selection (multi-select)
- Lazy-load children
- Dependency closure toggle (shows required files)
- Search/filter

---

### P-214: Web — File Tree B

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-213

**Files to Create/Modify:** Same `FileTree` component, second instance

---

### P-215: Web — Selection State

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-214

**Files to Create/Modify:** `packages/web/src/store/selectionStore.ts`

**Implementation Steps:**
- Zustand store: `repoA`, `repoB`, `selectedPathsA`, `selectedPathsB`
- Persists to localStorage
- Computed: `dependencyClosureA`, `dependencyClosureB`

---

### P-216: Web — AI Thinking Stream

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-215

**Files to Create/Modify:**
- `packages/web/src/components/AIThinkingStream.tsx`
- `packages/web/src/hooks/useJob.ts` (WS integration)

**Implementation Steps:**
- Connects to `/ws?jobId=`
- Renders `reasoning` chunks as live markdown
- Auto-scroll, syntax highlight for code blocks

---

### P-217: Web — Diff Viewer

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-216

**Files to Create/Modify:** `packages/web/src/components/DiffViewer.tsx`

**Implementation Steps:**
- `react-diff-viewer-continued`
- Side-by-side + inline toggle
- Accept/Reject buttons for gated proposals
- Keyboard shortcuts (A/R)

---

### P-218: Web — Approve/Reject Gate

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-217

**Files to Create/Modify:** `packages/web/src/components/ProposalGate.tsx`

**Implementation Steps:**
- Modal triggered by `proposal` WS event
- Shows diff, description, files affected
- `POST /api/jobs/:id/approve|reject`
- Blocks further progress until decision

---

### P-219: Web — Deps Conflict Panel

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-218

**Files to Create/Modify:** `packages/web/src/components/DepsPanel.tsx`

**Implementation Steps:**
- Table: Package | Repo A Version | Repo B Version | Conflict | Resolution
- Inline resolution selector (pick version)
- Auto-resolve button (uses semver intersect)

---

### P-220: Web — License Panel

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-219

**Files to Create/Modify:** `packages/web/src/components/LicensePanel.tsx`

**Implementation Steps:**
- List: Package | License | Category | Policy Verdict
- Color-coded: green (allow), yellow (warn), red (deny)
- Expand for details (SPDX, repository)

---

### P-221: Web — Sandbox Results

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-220

**Files to Create/Modify:** `packages/web/src/components/SandboxPanel.tsx`

**Implementation Steps:**
- Step tabs: Install | Build | Test
- Live logs (ansi-to-html)
- Pass/Fail badge with retry button
- Artifact download links

---

### P-222: Web — CREDITS Preview

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-221

**Files to Create/Modify:** `packages/web/src/components/CreditsPreview.tsx`

**Implementation Steps:**
- Renders `CREDITS.md` as sortable table
- Columns: Path, Source Repo, Commit, Author, License
- Filter by source repo
- Export to CSV

---

### P-223: Web — WS Client + Reconnect

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-222

**Files to Create/Modify:** `packages/web/src/hooks/useWebSocket.ts`

**Implementation Steps:**
```ts
export function useWebSocket(jobId: string) {
  // Connects to ws://localhost:3434/ws?jobId=
  // Auto-reconnect with exponential backoff
  // Buffers events during disconnect
  // Returns { events, proposals, reasoning, subscribe, approve, reject }
}
```

---

### P-224: Web — Job History

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-223

**Files to Create/Modify:** `packages/web/src/pages/JobsTable.tsx`

**Implementation Steps:**
- TanStack Query for `/api/jobs`
- Sortable, filterable table
- Click → navigate to `/merge/:jobId`

---

### P-225: Web — Settings

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-224

**Files to Create/Modify:** `packages/web/src/pages/Settings.tsx`

**Implementation Steps:**
- Provider keys (OpenRouter, Anthropic, Ollama)
- Default model selector
- Sandbox backend (Docker/GH Actions)
- Paths (cache, worktree)
- Theme (light/dark/system)

---

### P-226: Web — Dark Mode

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-225

**Files to Create/Modify:** `packages/web/src/hooks/useTheme.ts`

**Implementation Steps:**
- `class` strategy on `<html>`
- Persists to localStorage
- Syncs with system preference

---

### P-227: Web — Responsive

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-226

**Files to Create/Modify:** Tailwind responsive utilities throughout

**Implementation Steps:**
- Mobile-first breakpoints
- Sidebar drawer on mobile
- Stacked layout for wizard steps

---

### P-228: Web — Error Boundaries

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-227

**Files to Create/Modify:** `packages/web/src/components/ErrorBoundary.tsx`

**Implementation Steps:**
- React error boundary per page
- Friendly error UI with retry
- Reports to error tracking (future)

---

### P-229: Web — Onboarding Tour

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-228

**Files to Create/Modify:** `packages/web/src/components/Onboarding.tsx`

**Implementation Steps:**
- Driver.js or custom stepper
- Highlights: repo picker, file tree, launch
- Skippable, persists dismissed state

---

### P-230: Web — Session Export/Import

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-229

**Files to Create/Modify:** `packages/web/src/hooks/useSession.ts`

**Implementation Steps:**
- Export: JSON with selections, config, job ID
- Import: restores wizard state
- Shareable URL with encoded state

---

### P-231: Web — A11y

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-230

**Files to Create/Modify:** All components

**Implementation Steps:**
- ARIA labels, roles
- Keyboard navigation
- Focus management
- Color contrast (WCAG AA)
- Screen reader testing

---

### P-232: Web — Virtualized Trees

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-231

**Files to Create/Modify:** `packages/web/src/components/FileTree.tsx` (optimize)

**Implementation Steps:**
- `react-arborist` virtualization
- Windowing for 10k+ files
- Lazy load on expand

---

### P-233: Web — E2E (Playwright)

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-232

**Files to Create/Modify:** `packages/web/e2e/*.spec.ts`

**Implementation Steps:**
- Test full wizard flow
- Test WS reconnect
- Test approve/reject gate
- CI: `playwright test` in GitHub Actions

---

### P-234: Web — i18n (Optional)

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-233

**Files to Create/Modify:** `packages/web/src/i18n/` (if needed)

**Implementation Steps:**
- `i18next` setup
- English default
- Structure for future locales

---

### P-235: Web — Static Build Served by CLI

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-234

**Files to Create/Modify:** `packages/web/vite.config.ts` (build config)

**Implementation Steps:**
- `vite build` → `packages/web/dist`
- CLI server serves via `staticPlugin`
- Version hash in filename for cache busting

---

### P-236: Web — Tests

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-235

**Files to Create/Modify:** `packages/web/src/**/__tests__/*.test.tsx`

**Implementation Steps:**
- Unit tests for hooks, store, utils
- Component tests with React Testing Library
- Coverage thresholds (60/50/60/60)

---

### P-237: Web — Perf Pass

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-236

**Files to Create/Modify:** Bundle analysis, lazy loading

**Implementation Steps:**
- `vite build --mode analyze`
- Code-split pages (React.lazy)
- Optimize images, fonts

---

### P-238: Orchestration — Pipeline State Machine

**Owner:** inbesat | **Wave:** 2 | **Depends On:** Wave 1 complete

**Files to Create/Modify:** `packages/core/src/orchestration/pipeline.ts`

**Implementation Steps:**
```ts
type Step = 'init' | 'clone' | 'extract' | 'merge' | 'deps' | 'license' | 'ai-loop' | 'verify' | 'publish'
type Status = 'pending' | 'running' | 'completed' | 'failed' | 'paused'

export class StitchPipeline {
  async execute(jobId: string): Promise<void>
  private async runStep(jobId: string, step: Step): Promise<void>
}
```

---

### P-239: Orchestration — Job Queue (SQLite)

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-238

**Files to Create/Modify:** `packages/core/src/orchestration/jobQueue.ts`

**Implementation Steps:**
- `createJob(input)`, `getJob(id)`, `updateJob(id, patch)`, `listJobs(filters)`
- Advisory locks for concurrent access
- Priority queue (FIFO with priority)

---

### P-240: Orchestration — Resume Jobs

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-239

**Files to Create/Modify:** `packages/core/src/orchestration/resume.ts`

**Implementation Steps:**
- On startup: find `running`/`paused` jobs
- Resume from last completed step
- Recover WS connections

---

### P-241: Orchestration — Event Bus → WS

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-240

**Files to Create/Modify:** `packages/core/src/orchestration/eventBus.ts`

**Implementation Steps:**
- In-memory event bus (per-process)
- `emit(jobId, event)` → broadcasts to WS connections
- `subscribe(jobId)` → async iterator for CLI server

---

### P-242: Orchestration — Progress Aggregation

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-241

**Files to Create/Modify:** `packages/core/src/orchestration/progress.ts`

**Implementation Steps:**
- Aggregates sub-step progress into step progress
- Computes ETA based on historical averages
- Emits `progress` events

---

### P-243: Orchestration — Per-Job Config

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-242

**Files to Create/Modify:** `packages/core/src/orchestration/config.ts`

**Implementation Steps:**
- Job-specific config overrides global
- Merged at job start
- Immutable during execution

---

### P-244: Orchestration — Dry-Run

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-243

**Files to Create/Modify:** `packages/core/src/orchestration/dryRun.ts`

**Implementation Steps:**
- Executes pipeline without side effects
- Returns plan: files to pull, merges, AI proposals (simulated)
- Used by `stitch merge --dry-run`

---

### P-245: Orchestration — Rollback Whole Job

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-244

**Files to Create/Modify:** `packages/core/src/orchestration/rollback.ts`

**Implementation Steps:**
- `rollbackJob(jobId)` → deletes child repo, cleans worktrees, cancels sandbox
- Idempotent

---

### P-246: Orchestration — Cancel

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-245

**Files to Create/Modify:** `packages/core/src/orchestration/cancel.ts`

**Implementation Steps:**
- `cancelJob(jobId)` → sets status `cancelled`, stops pipeline
- Graceful: waits for current step to finish or timeout

---

### P-247: Orchestration — Metrics

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-246

**Files to Create/Modify:** `packages/core/src/orchestration/metrics.ts`

**Implementation Steps:**
- Job duration, success rate, token usage, cost
- Exported via `/api/metrics` (Prometheus format optional)

---

### P-248: Orchestration — Tracing

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-247

**Files to Create/Modify:** `packages/core/src/orchestration/tracing.ts`

**Implementation Steps:**
- OpenTelemetry spans for each step
- Trace context propagated to AI calls, sandbox
- Exported to stdout (JSON) or collector

---

### P-249: Orchestration — Concurrency

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-248

**Files to Create/Modify:** `packages/core/src/orchestration/concurrency.ts`

**Implementation Steps:**
- Semaphore for max parallel jobs (default 2)
- Per-job resource limits
- Queue overflow handling

---

### P-250: Orchestration — Idempotency

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-249

**Files to Create/Modify:** `packages/core/src/orchestration/idempotency.ts`

**Implementation Steps:**
- Job input hash → deduplication
- Re-running same input returns existing job
- Safe retries

---

### P-251: Orchestration — Tests

**Owner:** both | **Wave:** 2 | **Depends On:** P-250

**Files to Create/Modify:** `packages/core/src/orchestration/__tests__/*.test.ts`

**Implementation Steps:**
- Test state machine transitions
- Test resume after crash
- Test cancel/rollback
- Test concurrency limits

---

### P-252: Orchestration — CLI↔Web Contract

**Owner:** both | **Wave:** 2 | **Depends On:** P-251

**Files to Create/Modify:** `packages/core/src/types/ws.ts` (shared)

**Implementation Steps:**
- Define WS message types (single source of truth)
- Both CLI server and Web UI import from core
- Versioned: `ws/v1`

---

### P-253: Testing — Unit Conventions

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-252

**Files to Create/Modify:** `TESTING_CONVENTIONS.md` (root)

**Implementation Steps:**
- Document patterns: AAA, fixtures, mocking
- Naming: `*.test.ts`, `describe`/`it`
- Coverage expectations

---

### P-254: Testing — Integration Fixtures

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-253

**Files to Create/Modify:** `tests/fixtures/` (repo pairs)

**Implementation Steps:**
- Fixture 1: JS auth + JS UI (simple)
- Fixture 2: Python API + JS frontend
- Fixture 3: Go service + Rust lib
- Fixture 4: Monorepo extraction
- Fixture 5: Private + public repo

---

### P-255: Testing — E2E CLI

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-254

**Files to Create/Modify:** `packages/cli/__tests__/e2e.test.ts`

**Implementation Steps:**
- `stitch add A B → stitch merge` on fixtures
- Verify child repo builds + tests pass
- Test `--dry-run`, `--no-sandbox`

---

### P-256: Testing — E2E Web

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-255

**Files to Create/Modify:** `packages/web/e2e/merge.spec.ts`

**Implementation Steps:**
- Playwright: full wizard → launch → approve → verify
- Test WS reconnect (kill server, restart)
- Test keyboard shortcuts

---

### P-257: Testing — CI Matrix

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-256

**Files to Create/Modify:** `.github/workflows/ci.yml` (update)

**Implementation Steps:**
- Matrix: ubuntu-latest, macos-latest, windows-latest
- Node versions: 22, 20 (if needed)
- Bun versions: latest, latest-1

---

### P-258: Testing — Lint+Type Gates

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-257

**Files to Create/Modify:** CI workflow

**Implementation Steps:**
- Required status checks on PR
- Fail on any lint/type error
- Separate jobs for speed

---

### P-259: Testing — Coverage

**Owner:** both | **Wave:** 2 | **Depends On:** P-258

**Files to Create/Modify:** `vitest.config.ts` thresholds

**Implementation Steps:**
- Enforce thresholds per package
- Upload to Codecov
- PR comment with coverage diff

---

### P-260: Testing — Merge Snapshots

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-259

**Files to Create/Modify:** `tests/snapshots/`

**Implementation Steps:**
- Snapshot test: merged repo structure
- Snapshot: CREDITS.md, SBOM
- Update on intentional changes

---

### P-261: Testing — Deps Property Tests

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-260

**Files to Create/Modify:** `packages/core/src/deps/__tests__/property.test.ts`

**Implementation Steps:**
- Fast-check property tests for semver resolution
- `merge(a, b)` == `merge(b, a)` (commutative)
- `merge(a, a)` == `a` (idempotent)

---

### P-262: Testing — Perf Benchmarks

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-261

**Files to Create/Modify:** `benchmarks/`

**Implementation Steps:**
- Benchmark: clone, filter-repo, merge, AI loop
- Track over time
- Alert on regression > 20%

---

### P-263: Testing — Release Pipeline

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-262

**Files to Create/Modify:** `.github/workflows/release.yml`

**Implementation Steps:**
- Changeset → version bump → build → publish npm + GH Release + Docker
- Automated on tag push

---

### P-264: Testing — Docker CI

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-263

**Files to Create/Modify:** `.github/workflows/docker.yml`

**Implementation Steps:**
- Build sandbox base images on tag
- Multi-arch (amd64, arm64)
- Push to GHCR

---

### P-265: Testing — Security Audit

**Owner:** both | **Wave:** 2 | **Depends On:** P-264

**Files to Create/Modify:** CI workflow + `bun audit`

**Implementation Steps:**
- `bun audit --level=high` in CI
- `trufflehog` scan for secrets
- Dependabot PRs auto-merged for patch

---

### P-266: Testing — Quality Dashboard

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-265

**Files to Create/Modify:** GitHub Pages or simple HTML

**Implementation Steps:**
- Aggregates: test pass rate, coverage, build time, bundle size
- Trend charts
- Linked from README

---

### P-267: Testing — Flake Triage

**Owner:** both | **Wave:** 2 | **Depends On:** P-266

**Files to Create/Modify:** `FLAKE_TRIAGE.md`

**Implementation Steps:**
- Document known flaky tests
- Auto-quarantine (retry 3x, then mark flaky)
- Monthly review

---

### P-268: Docs — README

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-267

**Files to Create/Modify:** `README.md` (root)

**Implementation Steps:**
- Badges (version, license, CI)
- Quick install (`bun add @repo-stitcher/cli`)
- Quick start (3 commands)
- Architecture diagram
- Links to docs

---

### P-269: Docs — QUICKSTART

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-268

**Files to Create/Modify:** `docs/QUICKSTART.md`

**Implementation Steps:**
- Prerequisites
- `stitch init` → `stitch add` → `stitch merge`
- Web UI: `stitch serve`
- Troubleshooting

---

### P-270: Docs — ARCHITECTURE

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-269

**Files to Create/Modify:** `docs/ARCHITECTURE.md` (copy from project-plans)

---

### P-271: Docs — CONTRIBUTING

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-270

**Files to Create/Modify:** `docs/CONTRIBUTING.md` (copy from project-plans)

---

### P-272: Docs — Core API Docs

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-271

**Files to Create/Modify:** `docs/API.md` (generated)

**Implementation Steps:**
- `typedoc packages/core/src/index.ts --out docs/api`
- CI: generate on release

---

### P-273: Docs — CLI Ref

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-272

**Files to Create/Modify:** `docs/CLI.md`

**Implementation Steps:**
- Auto-generated from Commander help
- `stitch --help` → markdown

---

### P-274: Docs — Web Docs

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-273

**Files to Create/Modify:** `docs/WEB.md`

**Implementation Steps:**
- Dashboard tour
- Merge wizard guide
- Settings reference

---

### P-275: Docs — Config Ref

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-274

**Files to Create/Modify:** `docs/CONFIG.md`

**Implementation Steps:**
- All config options with types, defaults, env vars
- Example files

---

### P-276: Docs — Provider Setup Guide

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-275

**Files to Create/Modify:** `docs/PROVIDERS.md`

**Implementation Steps:**
- OpenRouter: get key, choose model
- Anthropic: get key
- Ollama: install, pull model
- Troubleshooting

---

### P-277: Docs — License Guide

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-276

**Files to Create/Modify:** `docs/LICENSES.md`

**Implementation Steps:**
- SPDX reference
- Compatibility matrix
- Policy configuration
- Deep scan setup

---

### P-278: Docs — Publish Core

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-277

**Files to Create/Modify:** Release workflow

**Implementation Steps:**
- `tsup` build → `npm publish --access public`
- Scoped package: `@repo-stitcher/core`

---

### P-279: Docs — Installer/Homebrew

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-278

**Files to Create/Modify:** Homebrew tap repo

**Implementation Steps:**
- Formula for `stitch` binary
- `brew tap repo-stitcher/tap && brew install stitch`

---

### P-280: Docs — Docker Publish

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-279

**Files to Create/Modify:** Docker workflow

**Implementation Steps:**
- `ghcr.io/repo-stitcher/sandbox:node-22`, etc.
- `ghcr.io/repo-stitcher/cli:latest`

---

### P-281: Docs — Versioning Policy

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-280

**Files to Create/Modify:** `docs/VERSIONING.md`

**Implementation Steps:**
- SemVer per package
- Breaking changes = major
- Deprecation policy (2 minor versions)

---

### P-282: Docs — Changelog Automation

**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-281

**Files to Create/Modify:** Changesets config

**Implementation Steps:**
- `@changesets/changelog-github` for GH Release notes
- Conventional commits → categorized changelog

---

**END OF FOURTH CHUNK (P-189 through P-282 = 94 phases)**

---

## FINAL CHUNK: P-283 through P-318 (Epic 15: Advanced/Extensibility)

---

### P-283: Advanced — Plugin System

**Owner:** inbesat | **Wave:** 3 | **Depends On:** MVP release

**Files to Create/Modify:**
- `packages/core/src/plugins/registry.ts`
- `packages/core/src/plugins/types.ts`

**Implementation Steps:**
```ts
export interface Plugin {
  name: string
  version: string
  ecosystems?: ManifestParser[]
  aiProviders?: ChatProvider[]
  sandboxRunners?: SandboxRunner[]
  licenseScanners?: DeepScanner[]
  hooks?: {
    preMerge?: (context: MergeContext) => Promise<void>
    postMerge?: (result: StitchOutput) => Promise<void>
  }
}

export const pluginRegistry = new Map<string, Plugin>()
export function registerPlugin(plugin: Plugin): void
export function getPlugins(): Plugin[]
```

**Acceptance Criteria:**
- [ ] Plugins loaded from `~/.stitch/plugins/` or npm `@repo-stitcher/plugin-*`
- [ ] Type-safe registration
- [ ] Hot-reload in dev mode

---

### P-284: Advanced — Plugin: Go Ecosystem

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-283

**Files to Create/Modify:** `packages/core/src/plugins/go.ts`

**Implementation Steps:**
- Implements `ManifestParser` for `go.mod`/`go.sum`
- Adds Go to ecosystem detection
- Registers `go test` in sandbox

---

### P-285: Advanced — Plugin: Rust Ecosystem

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-284

**Files to Create/Modify:** `packages/core/src/plugins/rust.ts`

**Implementation Steps:**
- `Cargo.toml` parser with features, editions
- `cargo build --release` / `cargo test` in sandbox
- Handles workspace members

---

### P-286: Advanced — Plugin: Python Ecosystem

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-285

**Files to Create/Modify:** `packages/core/src/plugins/python.ts`

**Implementation Steps:**
- Supports `requirements.txt`, `pyproject.toml` (poetry, uv, pip)
- `pip install`, `pytest` in sandbox
- Handles virtualenv detection

---

### P-287: Advanced — Plugin: AI Connector

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-286

**Files to Create/Modify:** `packages/core/src/plugins/aiConnector.ts`

**Implementation Steps:**
- Example: `OllamaProvider` as plugin
- Template for custom providers
- Documentation: how to write a provider plugin

---

### P-288: Advanced — Template Library

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-287

**Files to Create/Modify:** `packages/core/src/templates/`

**Implementation Steps:**
- Curated list of "known good" repo pairs
- `stitch template list` → shows templates
- `stitch template use <name>` → pre-fills repo A/B + paths
- Templates: `auth+dashboard`, `api+frontend`, `service+worker`, `monorepo-extract`

---

### P-289: Advanced — Smart Presets

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-288

**Files to Create/Modify:** `packages/core/src/presets/`

**Implementation Steps:**
- `stitch preset auth` → auto-detects auth patterns in repo A
- `stitch preset ui` → auto-detects UI components in repo B
- ML-based: learns from successful merges
- Configurable patterns per org

---

### P-290: Advanced — Batch Stitch

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-289

**Files to Create/Modify:** `packages/core/src/batch.ts`

**Implementation Steps:**
```ts
export async function batchStitch(inputs: StitchInput[]): Promise<BatchResult>
```
- Processes multiple merges sequentially/parallel
- Shared cache for repos
- Aggregate report

---

### P-291: Advanced — Scheduled Merges

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-290

**Files to Create/Modify:** `packages/core/src/scheduler.ts`

**Implementation Steps:**
- Cron-like scheduler (node-cron)
- `stitch schedule add --cron "0 2 * * *" --config merge.json`
- Runs in background (separate process or systemd)
- Notifies on success/failure

---

### P-292: Advanced — Multi-User Server Mode

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-291

**Files to Create/Modify:** `packages/cli/src/server/multiUser.ts`

**Implementation Steps:**
- JWT auth (GitHub OAuth)
- Per-user job isolation
- Team workspaces (shared jobs)
- Admin dashboard

---

### P-293: Advanced — RBAC

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-292

**Files to Create/Modify:** `packages/core/src/auth/rbac.ts`

**Implementation Steps:**
- Roles: `admin`, `developer`, `viewer`
- Permissions: `job:create`, `job:cancel`, `job:view`, `config:write`
- Team-based access

---

### P-294: Advanced — Team Workspaces

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-293

**Files to Create/Modify:** `packages/core/src/workspaces/`

**Implementation Steps:**
- Shared config, credentials, templates
- Workspace-scoped job history
- Billing/metrics per workspace

---

### P-295: Advanced — Analytics Dashboard

**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-294

**Files to Create/Modify:** `packages/web/src/pages/Analytics.tsx`

**Implementation Steps:**
- Merge success rate over time
- Average time-to-green
- Token cost trends
- License violation heatmap
- Repo popularity

---

### P-296: Advanced — Outgoing Webhooks

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-295

**Files to Create/Modify:** `packages/core/src/webhooks/`

**Implementation Steps:**
- `stitch webhook add --url https://... --events job.completed,job.failed`
- HMAC signature verification
- Retry with backoff
- Event payload: job ID, status, output summary

---

### P-297: Advanced — REST API

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-296

**Files to Create/Modify:** `packages/cli/src/server/rest.ts`

**Implementation Steps:**
- Full OpenAPI 3.1 spec
- Endpoints: `/jobs`, `/repos`, `/templates`, `/config`
- Auth: Bearer token (JWT or API key)
- Rate limiting

---

### P-298: Advanced — GraphQL API

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-297

**Files to Create/Modify:** `packages/cli/src/server/graphql.ts`

**Implementation Steps:**
- Schema: Job, Repo, Template, Config
- Queries: jobs with filters, job details
- Mutations: createJob, cancelJob, approveProposal
- Subscriptions: job events (WS)

---

### P-299: Advanced — MCP Server for OpenCode

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-298

**Files to Create/Modify:** `packages/core/src/mcp/`

**Implementation Steps:**
- Implements MCP (Model Context Protocol) server
- Tools: `stitch_merge`, `stitch_license_check`, `stitch_deps_analyze`
- Resources: `stitch://jobs/{id}`, `stitch://templates`
- Prompts: "merge auth from A into B"
- Config: `mcpServers.repo-stitcher` in OpenCode config

---

### P-300: Advanced — VS Code Extension

**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-299

**Files to Create/Modify:** `packages/vscode-extension/` (separate package)

**Implementation Steps:**
- Tree view: recent jobs, templates
- Command: `Stitch: Merge Repos` → opens webview
- Inline diff for proposals
- Settings sync with CLI config

---

### P-301: Advanced — Offline/Local Models

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-300

**Files to Create/Modify:** `packages/core/src/ai/offline.ts`

**Implementation Steps:**
- Bundled quantized models (llama.cpp, ONNX)
- Auto-download on first use
- Fallback chain: local → Ollama → OpenRouter
- Air-gapped mode flag

---

### P-302: Advanced — Cost Budgets

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-301

**Files to Create/Modify:** `packages/core/src/ai/budgets.ts`

**Implementation Steps:**
- Per-user/org monthly budget
- Per-job token limit
- Alerts at 50%, 80%, 100%
- Hard stop at budget
- Cost breakdown by provider/model

---

### P-303: Advanced — Repo-Metadata Cache

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-302

**Files to Create/Modify:** `packages/core/src/cache/repoCache.ts`

**Implementation Steps:**
- SQLite cache with TTL
- Caches: repo tree, license, default branch, stars
- Invalidation on push (webhook) or TTL expiry
- Shared across jobs

---

### P-304: Advanced — K8s Sandbox

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-303

**Files to Create/Modify:** `packages/core/src/sandbox/k8s.ts`

**Implementation Steps:**
- Kubernetes Job for sandbox
- Ephemeral pods with resource limits
- PersistentVolume for cache
- KEDA autoscaling for queue

---

### P-305: Advanced — Telemetry Opt-In

**Owner:** both | **Wave:** 3 | **Depends On:** P-304

**Files to Create/Modify:** `packages/core/src/telemetry/`

**Implementation Steps:**
- Anonymous usage stats (opt-in)
- Events: job_started, job_completed, proposal_accepted
- No code/content sent
- GDPR/CCPA compliant

---

### P-306: Advanced — SSO

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-305

**Files to Create/Modify:** `packages/core/src/auth/sso.ts`

**Implementation Steps:**
- SAML 2.0 / OIDC
- SCIM provisioning
- Attribute mapping (groups → roles)
- IdP: Okta, Azure AD, Google Workspace

---

### P-307: Advanced — Compliance Export

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-306

**Files to Create/Modify:** `packages/core/src/compliance/`

**Implementation Steps:**
- SOC2 Type II evidence export
- Audit trail: who merged what, when, with what approvals
- SBOM archive
- License compliance report

---

### P-308: Advanced — Plugin Marketplace

**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-307

**Files to Create/Modify:** `packages/web/src/pages/Marketplace.tsx`

**Implementation Steps:**
- Browse/install plugins from registry
- Ratings, reviews, compatibility
- One-click install (npm pack + local registry)

---

### P-309: Advanced — Benchmarks Suite

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-308

**Files to Create/Modify:** `benchmarks/suite.ts`

**Implementation Steps:**
- Standardized benchmark repos
- Metrics: time, tokens, cost, memory
- CI: run on every release, compare to baseline
- Publish results

---

### P-310: Advanced — Config Migration

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-309

**Files to Create/Modify:** `packages/core/src/config/migration.ts`

**Implementation Steps:**
- `ConfigSchema.version` field
- Migration functions: `v1 → v2`, `v2 → v3`
- `stitch config migrate` command
- Backup before migrate

---

### P-311: Advanced — Internationalization Core

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-310

**Files to Create/Modify:** `packages/core/src/i18n/`

**Implementation Steps:**
- Message catalogs (JSON)
- `t(key, params)` function
- Pluralization, date/number formatting
- CLI and Web use same catalogs

---

### P-312: Advanced — Roadmap Doc

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-311

**Files to Create/Modify:** `ROADMAP.md` (root)

**Implementation Steps:**
- 6-month, 12-month, 24-month horizons
- Community-requested features
- Technical debt items
- Maintainer guidelines

---

### P-318: Advanced — v1.0.0 Release Checklist & Project Retrospective

**Owner:** both | **Wave:** 3 | **Depends On:** P-312

**Context:** Final phase before declaring v1.0.0. Ensures all MVP criteria are met, documents lessons learned, and prepares for public launch.

**Files to Create/Modify:**
- `RELEASE_CHECKLIST.md` (root)
- `RETROSPECTIVE.md` (root)
- Update `CHANGELOG.md` with v1.0.0 entry

**Implementation Steps:**
1. **Release Checklist** (`RELEASE_CHECKLIST.md`):
   - [ ] All MVP features (F-01..F-12) implemented and tested
   - [ ] 5 diverse repo pairs stitch successfully (JS+TS, Python+Go, Rust+JS, monorepo extraction, private+public)
   - [ ] `stitch doctor` passes on clean macOS/Linux/Windows
   - [ ] License scan catches injected GPL in MIT test fixture
   - [ ] Sandbox builds pass on all 4 supported ecosystems
   - [ ] Web UI accessible (WCAG AA) and responsive
   - [ ] Docs published: README, QUICKSTART, ARCHITECTURE, CONFIG_REF
   - [ ] Changeset release published to npm + GitHub Releases
   - [ ] Binary releases for 3 platforms (linux-x64, darwin-arm64, windows-x64)
   - [ ] Docker images pushed to GHCR
   - [ ] Security audit clean (`bun audit`, `trufflehog`)

2. **Project Retrospective** (`RETROSPECTIVE.md`):
   - What went well (technical decisions, team dynamics, tooling)
   - What didn't (blockers, scope creep, technical debt)
   - Metrics: phases completed, bugs found, lines of code, test coverage
   - Lessons for v1.1+

3. **Final Validation**:
   - Run `bun run validate` on all packages
   - Run full E2E test suite on all fixtures
   - Verify `stitch merge --dry-run` works on all fixtures
   - Tag `v1.0.0` and push

**Required MCPs/Connectors:** GitHub (for release), npm (for publish), Docker (for images)

**Skills to Invoke:** `gstack-ship` (for release workflow), `gstack-retro` (for retrospective)

**Acceptance Criteria:**
- [ ] `RELEASE_CHECKLIST.md` 100% complete
- [ ] `RETROSPECTIVE.md` documented and shared
- [ ] v1.0.0 tagged and released on GitHub
- [ ] npm packages published: `@repo-stitcher/core`, `@repo-stitcher/cli`
- [ ] Docker images available on GHCR
- [ ] Homebrew formula updated (if applicable)
- [ ] All CI checks green on release tag

**Tests Required:** Full regression test on all 5 fixture repo pairs

**Dependencies:** P-312 (Roadmap Doc)

**Handoff Notes:** This is the final phase. After completion, the project enters maintenance mode. Next steps: community feedback, v1.1 planning, plugin ecosystem growth.

---

**END OF FINAL CHUNK (P-283 through P-318 = 36 phases)**

---

## COMPLETE: ALL 319 PHASES DOCUMENTED

| Chunk | Phases | Epics Covered |
|-------|--------|---------------|
| 1 | P-000–P-068 + P-313–P-317 (35) | Foundation, Dependencies, Workflow |
| 2 | P-069–P-117 (49) | Git Core, GitHub, Deps Merge |
| 3 | P-118–P-188 (71) | License, AI Provider, Agent Tools, Sandbox, Provenance |
| 4 | P-189–P-282 (94) | CLI, Web UI, Orchestration, Testing, Docs |
| 5 | P-283–P-318 (36) | Advanced/Extensibility |
| **Total** | **319** | **15 Epics, 4 Waves** |

---

## QUICK REFERENCE: PHASE → FILE MAP

| Phase Range | Primary Files |
|-------------|---------------|
| P-000–P-014 | Root config: package.json, tsconfig, eslint, vitest, husky, changesets, CI, Dockerfile |
| P-015–P-068 | All `package.json` deps (core, cli, web) |
| P-313–P-317 | Handoff docs, contract freeze, shared types |
| P-069–P-087 | `packages/core/src/git/*.ts` |
| P-088–P-102 | `packages/core/src/github/*.ts` |
| P-103–P-117 | `packages/core/src/deps/*.ts` |
| P-118–P-130 | `packages/core/src/license/*.ts` |
| P-131–P-147 | `packages/core/src/ai/*.ts` (provider layer) |
| P-148–P-167 | `packages/core/src/ai/tools/*.ts` |
| P-168–P-180 | `packages/core/src/sandbox/*.ts` |
| P-181–P-188 | `packages/core/src/provenance/*.ts` |
| P-189–P-207 | `packages/cli/src/commands/*.ts`, `packages/cli/src/ui/*.tsx`, `packages/cli/src/server/*.ts` |
| P-208–P-237 | `packages/web/src/pages/*.tsx`, `packages/web/src/components/*.tsx`, `packages/web/src/hooks/*.ts` |
| P-238–P-252 | `packages/core/src/orchestration/*.ts` |
| P-253–P-282 | Docs, CI, testing configs |
| P-283–P-318 | `packages/core/src/plugins/*.ts`, `packages/core/src/templates/`, advanced features |

---

## HOW TO START IMPLEMENTATION

1. **Wave 0 (inbesat):** Run phases P-000 through P-317 sequentially
   ```bash
   cd E:\git\project\repo-stitcher
   # P-000
   bun init -y
   # ... follow each phase's Implementation Steps
   ```

2. **Handoff:** Push to GitHub, send `HANDOFF.md` to aradhy

3. **Wave 1 (parallel):**
   - inbesat: P-069 through P-188
   - aradhy: P-189 through P-237 (after cloning)

4. **Wave 2 (coordinated):** P-238 through P-282

5. **Wave 3 (post-MVP):** P-283 through P-318 (prioritize by demand)

**Validation after each phase:**
```bash
bun run validate  # typecheck + lint + test + build
```

Update `PROGRESS.md` with ✅/🔄/🚫 after each phase.