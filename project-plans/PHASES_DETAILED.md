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



**Context:** Add `simple-git` to core for Git operations (clone, merge, push, branch management). This is the primary Git wrapper used throughout the codebase.



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add simple-git --filter @repo-stitcher/core`

2. Verify `import { simpleGit } from 'simple-git'` works in core

3. Add type definitions if needed (built-in)



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] simple-git in core dependencies

- [ ] `bun --filter @repo-stitcher/core run typecheck` passes

- [ ] Can import and instantiate simpleGit in core modules



**Tests Required:** None



**Dependencies:** P-015



**Handoff Notes:** Continue with remaining core deps (P-017–P-039).



---



### P-017: Core Dependency — @octokit/rest



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-016



**Context:** Add `@octokit/rest` for GitHub REST API operations (repo listing, tree traversal, file content, PR creation, workflow dispatch).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add @octokit/rest --filter @repo-stitcher/core`

2. Verify `import { Octokit } from '@octokit/rest'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] @octokit/rest in core dependencies

- [ ] Typecheck passes

- [ ] Can instantiate Octokit client



**Tests Required:** None



**Dependencies:** P-016



**Handoff Notes:** Next: @octokit/auth-app for GitHub App auth.



---



### P-018: Core Dependency — @octokit/auth-app



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-017



**Context:** Add `@octokit/auth-app` for GitHub App authentication (preferred over PAT for production use).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add @octokit/auth-app --filter @repo-stitcher/core`

2. Verify `import { createAppAuth } from '@octokit/auth-app'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] @octokit/auth-app in core dependencies

- [ ] Typecheck passes

- [ ] Can create app auth instance



**Tests Required:** None



**Dependencies:** P-017



**Handoff Notes:** Next: semver for version resolution.



---



### P-019: Core Dependency — semver



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-018



**Context:** Add `semver` for semantic version parsing, comparison, and range intersection (used in dependency collision resolution).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add semver --filter @repo-stitcher/core`

2. Verify `import { satisfies, intersect, parse } from 'semver'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] semver in core dependencies

- [ ] Typecheck passes

- [ ] Can parse and intersect version ranges



**Tests Required:** None



**Dependencies:** P-018



**Handoff Notes:** Next: tree-sitter for multi-language dependency parsing.



---



### P-020: Core Dependency — tree-sitter + grammars



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-019



**Context:** Add `tree-sitter` and language grammars for multi-language dependency parsing (JS, TS, Python, Go, Rust) to resolve import dependencies across ecosystems.



**Files to Create/Modify:**

- `packages/core/package.json` (add dependencies)



**Implementation Steps:**

1. `bun add tree-sitter --filter @repo-stitcher/core`

2. `bun add tree-sitter-javascript tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-rust --filter @repo-stitcher/core`

3. Verify imports work: `import Parser from 'tree-sitter'; import JavaScript from 'tree-sitter-javascript'`



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] tree-sitter and all 5 grammars in core dependencies

- [ ] Typecheck passes

- [ ] Can instantiate parsers for each language



**Tests Required:** None



**Dependencies:** P-019



**Handoff Notes:** Next: dependency-cruiser for JS/TS dependency graph analysis.



---



### P-021: Core Dependency — dependency-cruiser



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-020



**Context:** Add `dependency-cruiser` for JavaScript/TypeScript dependency graph analysis (used to resolve import closures).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add dependency-cruiser --filter @repo-stitcher/core`

2. Verify `import { cruise } from 'dependency-cruiser'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] dependency-cruiser in core dependencies

- [ ] Typecheck passes

- [ ] Can run cruise programmatically



**Tests Required:** None



**Dependencies:** P-020



**Handoff Notes:** Next: madge for circular dependency detection.



---



### P-022: Core Dependency — madge



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-021



**Context:** Add `madge` for circular dependency detection and dependency visualization in JS/TS projects.



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add madge --filter @repo-stitcher/core`

2. Verify `import madge from 'madge'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] madge in core dependencies

- [ ] Typecheck passes



**Tests Required:** None



**Dependencies:** P-021



**Handoff Notes:** Next: license-checker for license scanning.



---



### P-023: Core Dependency — license-checker



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-022



**Context:** Add `license-checker` for scanning declared licenses from package manifests (package.json, requirements.txt, Cargo.toml, go.mod).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add license-checker --filter @repo-stitcher/core`

2. Verify `import licenseChecker from 'license-checker'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] license-checker in core dependencies

- [ ] Typecheck passes

- [ ] Can scan manifests programmatically



**Tests Required:** None



**Dependencies:** P-022



**Handoff Notes:** Next: spdx-expression-parse for SPDX parsing.



---



### P-024: Core Dependency — spdx-expression-parse



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-023



**Context:** Add `spdx-expression-parse` for parsing and evaluating SPDX license expressions (e.g., "MIT OR Apache-2.0").



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add spdx-expression-parse --filter @repo-stitcher/core`

2. Verify `import { parseExpression } from 'spdx-expression-parse'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] spdx-expression-parse in core dependencies

- [ ] Typecheck passes

- [ ] Can parse SPDX expressions



**Tests Required:** None



**Dependencies:** P-023



**Handoff Notes:** Next: spdx-correct for license ID normalization.



---



### P-025: Core Dependency — spdx-correct



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-024



**Context:** Add `spdx-correct` for normalizing license identifiers to valid SPDX IDs (e.g., "Apache 2.0" → "Apache-2.0").



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add spdx-correct --filter @repo-stitcher/core`

2. Verify `import { correct } from 'spdx-correct'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] spdx-correct in core dependencies

- [ ] Typecheck passes

- [ ] Can normalize license IDs



**Tests Required:** None



**Dependencies:** P-024



**Handoff Notes:** Next: spdx-license-list for official license registry.



---



### P-026: Core Dependency — spdx-license-list



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-025



**Context:** Add `spdx-license-list` for accessing the official SPDX license registry (license IDs, names, URLs, OSI approval status).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add spdx-license-list --filter @repo-stitcher/core`

2. Verify `import { licenses } from 'spdx-license-list'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] spdx-license-list in core dependencies

- [ ] Typecheck passes

- [ ] Can access official license registry



**Tests Required:** None



**Dependencies:** P-025



**Handoff Notes:** Next: openai client for OpenRouter/OpenAI/Ollama.



---



### P-027: Core Dependency — openai (OpenRouter client)



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-026



**Context:** Add `openai` npm package as the universal client for OpenRouter, OpenAI, and Ollama (all OpenAI-compatible APIs).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add openai --filter @repo-stitcher/core`

2. Verify `import OpenAI from 'openai'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] openai in core dependencies

- [ ] Typecheck passes

- [ ] Can instantiate client with custom baseURL



**Tests Required:** None



**Dependencies:** P-026



**Handoff Notes:** Next: @anthropic-ai/sdk for native Anthropic support.



---



### P-028: Core Dependency — @anthropic-ai/sdk



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-027



**Context:** Add `@anthropic-ai/sdk` for native Anthropic API access (Claude models with native tool calling format).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add @anthropic-ai/sdk --filter @repo-stitcher/core`

2. Verify `import Anthropic from '@anthropic-ai/sdk'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] @anthropic-ai/sdk in core dependencies

- [ ] Typecheck passes

- [ ] Can instantiate Anthropic client



**Tests Required:** None



**Dependencies:** P-027



**Handoff Notes:** Next: dockerode for sandbox container management.



---



### P-029: Core Dependency — dockerode



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-028



**Context:** Add `dockerode` for programmatic Docker container management (sandbox build/test verification).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add dockerode --filter @repo-stitcher/core`

2. Verify `import Docker from 'dockerode'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] dockerode in core dependencies

- [ ] Typecheck passes

- [ ] Can connect to Docker daemon



**Tests Required:** None



**Dependencies:** P-028



**Handoff Notes:** Next: bun:sqlite (native, no install).



---



### P-030: Core Dependency — bun:sqlite (native)



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-029



**Context:** Use Bun's native SQLite binding (`bun:sqlite`) for the job queue, event log, and repo cache. No npm install needed.



**Files to Create/Modify:**

- `packages/core/package.json` (no dependency needed — native)



**Implementation Steps:**

1. Verify `import { Database } from 'bun:sqlite'` works in core

2. No package.json changes needed (built into Bun)



**Required MCPs/Connectors:** None (Bun native)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] `import { Database } from 'bun:sqlite'` works

- [ ] Can create/open database files

- [ ] Typecheck passes



**Tests Required:** None



**Dependencies:** P-029



**Handoff Notes:** Next: p-limit for concurrency control.



---



### P-031: Core Dependency — p-limit



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-030



**Context:** Add `p-limit` for controlled concurrency (parallel clones, sandbox runs, API calls).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add p-limit --filter @repo-stitcher/core`

2. Verify `import pLimit from 'p-limit'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] p-limit in core dependencies

- [ ] Typecheck passes

- [ ] Can create concurrency limiter



**Tests Required:** None



**Dependencies:** P-030



**Handoff Notes:** Next: yaml for manifest parsing.



---



### P-032: Core Dependency — yaml



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-031



**Context:** Add `yaml` for parsing YAML manifests (docker-compose.yml, .github/workflows, .stitch/config.yaml).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add yaml --filter @repo-stitcher/core`

2. Verify `import { parse } from 'yaml'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] yaml in core dependencies

- [ ] Typecheck passes

- [ ] Can parse YAML documents



**Tests Required:** None



**Dependencies:** P-031



**Handoff Notes:** Next: ini for config parsing.



---



### P-033: Core Dependency — ini



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-032



**Context:** Add `ini` for parsing INI config files (git config, npmrc, cargo config).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add ini --filter @repo-stitcher/core`

2. Verify `import { parse } from 'ini'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] ini in core dependencies

- [ ] Typecheck passes

- [ ] Can parse INI files



**Tests Required:** None



**Dependencies:** P-032



**Handoff Notes:** Next: glob for file pattern matching.



---



### P-034: Core Dependency — glob



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-033



**Context:** Add `glob` for file pattern matching (used in fixture generation, repo scanning).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add glob --filter @repo-stitcher/core`

2. Verify `import { glob } from 'glob'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] glob in core dependencies

- [ ] Typecheck passes

- [ ] Can match file patterns



**Tests Required:** None



**Dependencies:** P-033



**Handoff Notes:** Next: fs-extra for extended file operations.



---



### P-035: Core Dependency — fs-extra



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-034



**Context:** Add `fs-extra` for extended file system operations (copy, move, ensureDir, emptyDir, JSON read/write).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add fs-extra --filter @repo-stitcher/core`

2. Verify `import fs from 'fs-extra'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] fs-extra in core dependencies

- [ ] Typecheck passes

- [ ] Can use extended fs methods



**Tests Required:** None



**Dependencies:** P-034



**Handoff Notes:** Next: picomatch for ignore patterns.



---



### P-036: Core Dependency — picomatch



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-035



**Context:** Add `picomatch` for fast glob/ignore pattern matching (used in .gitignore parsing, file filtering).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add picomatch --filter @repo-stitcher/core`

2. Verify `import { picomatch } from 'picomatch'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] picomatch in core dependencies

- [ ] Typecheck passes

- [ ] Can match glob patterns



**Tests Required:** None



**Dependencies:** P-035



**Handoff Notes:** Next: pino for structured logging.



---



### P-037: Core Dependency — pino



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-036



**Context:** Add `pino` for high-performance structured JSON logging with automatic secret redaction.



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add pino --filter @repo-stitcher/core`

2. Verify `import pino from 'pino'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] pino in core dependencies

- [ ] Typecheck passes

- [ ] Can create logger instance



**Tests Required:** None



**Dependencies:** P-036



**Handoff Notes:** Next: neverthrow for Result types.



---



### P-038: Core Dependency — neverthrow



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-037



**Context:** Add `neverthrow` for typed Result<T, E> error handling (no exceptions in core).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add neverthrow --filter @repo-stitcher/core`

2. Verify `import { Result, ok, err } from 'neverthrow'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] neverthrow in core dependencies

- [ ] Typecheck passes

- [ ] Can create Result instances



**Tests Required:** None



**Dependencies:** P-037



**Handoff Notes:** Next: zod-to-json-schema for AI tool schema generation.



---



### P-039: Core Dependency — zod-to-json-schema



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-038



**Context:** Add `zod-to-json-schema` for converting Zod schemas to JSON Schema (used for AI tool definitions).



**Files to Create/Modify:**

- `packages/core/package.json` (add dependency)



**Implementation Steps:**

1. `bun add zod-to-json-schema --filter @repo-stitcher/core`

2. Verify `import { zodToJsonSchema } from 'zod-to-json-schema'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] zod-to-json-schema in core dependencies

- [ ] Typecheck passes

- [ ] Can convert Zod schema to JSON Schema



**Tests Required:** None



**Dependencies:** P-038



**Handoff Notes:** Next: Core Dev Dependencies (P-040).



---



### P-040: Core Dev Dependencies — @types/node, vitest



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-039



**Context:** Add development dependencies for core package: TypeScript types for Node.js APIs and Vitest for testing.



**Files to Create/Modify:**

- `packages/core/package.json` (add devDependencies)



**Implementation Steps:**

1. `bun add -D @types/node vitest @vitest/ui --filter @repo-stitcher/core`

2. Verify `@types/node` provides Node.js types

3. Verify `vitest` runs tests correctly



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] @types/node, vitest, @vitest/ui in core devDependencies

- [ ] `bun --filter @repo-stitcher/core run typecheck` passes

- [ ] `bun --filter @repo-stitcher/core run test` runs



**Tests Required:** None



**Dependencies:** P-039



**Handoff Notes:** Next: CLI dependencies (P-041).



---



### P-041: CLI Dependency — commander



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-040



**Context:** Add `commander` for building the CLI command structure (commands, options, arguments, help).



**Files to Create/Modify:**

- `packages/cli/package.json` (add dependency)



**Implementation Steps:**

1. `bun add commander --filter @repo-stitcher/cli`

2. Verify `import { Command } from 'commander'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] commander in CLI dependencies

- [ ] Typecheck passes

- [ ] Can create Command instance



**Tests Required:** None



**Dependencies:** P-040



**Handoff Notes:** Next: ink for TUI.



---



### P-042: CLI Dependency — ink + @inkjs/ui



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-041



**Context:** Add `ink` and `@inkjs/ui` for building interactive terminal UIs (React-based components for CLI).



**Files to Create/Modify:**

- `packages/cli/package.json` (add dependencies)



**Implementation Steps:**

1. `bun add ink @inkjs/ui --filter @repo-stitcher/cli`

2. Verify `import { render, Text } from 'ink'` works

3. Verify `import { Select, Confirm } from '@inkjs/ui'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] ink and @inkjs/ui in CLI dependencies

- [ ] Typecheck passes

- [ ] Can render ink components



**Tests Required:** None



**Dependencies:** P-041



**Handoff Notes:** Next: elysia for HTTP/WS server.



---



### P-043: CLI Dependency — elysia



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-042



**Context:** Add `elysia` for the HTTP/WS server that serves the Web UI and provides the REST/WS API.



**Files to Create/Modify:**

- `packages/cli/package.json` (add dependency)



**Implementation Steps:**

1. `bun add elysia --filter @repo-stitcher/cli`

3. Verify `import { Elysia } from 'elysia'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] elysia in CLI dependencies

- [ ] Typecheck passes

- [ ] Can create Elysia app



**Tests Required:** None



**Dependencies:** P-042



**Handoff Notes:** Next: picocolors for CLI colors.



---



### P-044: CLI Dependency — picocolors



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-043



**Context:** Add `picocolors` for lightweight terminal color formatting (used in CLI output, progress bars, error messages).



**Files to Create/Modify:**

- `packages/cli/package.json` (add dependency)



**Implementation Steps:**

1. `bun add picocolors --filter @repo-stitcher/cli`

2. Verify `import pc from 'picocolors'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] picocolors in CLI dependencies

- [ ] Typecheck passes

- [ ] Can format colored output



**Tests Required:** None



**Dependencies:** P-043



**Handoff Notes:** Next: configstore for encrypted config storage.



---



### P-045: CLI Dependency — configstore



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-044



**Context:** Add `configstore` for encrypted persistent configuration storage (GitHub tokens, API keys, user preferences).



**Files to Create/Modify:**

- `packages/cli/package.json` (add dependency)



**Implementation Steps:**

1. `bun add configstore --filter @repo-stitcher/cli`

2. Verify `import Configstore from 'configstore'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] configstore in CLI dependencies

- [ ] Typecheck passes

- [ ] Can create Configstore instance



**Tests Required:** None



**Dependencies:** P-044



**Handoff Notes:** Next: update-notifier for version checks.



**Implementation Steps:** `bun add configstore --filter @repo-stitcher/cli`



---



### P-046: CLI Dependency — update-notifier



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-045



**Context:** Add `update-notifier` for automatic CLI version update notifications (checks npm registry on startup).



**Files to Create/Modify:**

- `packages/cli/package.json` (add dependency)



**Implementation Steps:**

1. `bun add update-notifier --filter @repo-stitcher/cli`

2. Verify `import updateNotifier from 'update-notifier'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] update-notifier in CLI dependencies

- [ ] Typecheck passes

- [ ] Can create update notifier instance



**Tests Required:** None



**Dependencies:** P-045



**Handoff Notes:** Next: Web dependencies (P-047).



---



### P-047: Web Dependency — react + react-dom



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-046



**Context:** Add `react` and `react-dom` for the Web UI dashboard (React 18 with concurrent features).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependencies)



**Implementation Steps:**

1. `bun add react react-dom --filter @repo-stitcher/web`

2. Verify `import React from 'react'` and `import { createRoot } from 'react-dom/client'` work



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] react and react-dom in Web dependencies

- [ ] Typecheck passes

- [ ] Can render React components



**Tests Required:** None



**Dependencies:** P-046



**Handoff Notes:** Next: Vite + React plugin.



---



### P-048: Web Dependency — vite + @vitejs/plugin-react



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-047



**Context:** Add Vite as the build tool and dev server, with React plugin for fast HMR and optimized builds.



**Files to Create/Modify:**

- `packages/web/package.json` (add devDependencies)



**Implementation Steps:**

1. `bun add -D vite @vitejs/plugin-react --filter @repo-stitcher/web`

2. Verify `import { defineConfig } from 'vite'` and `import react from '@vitejs/plugin-react'` work



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] vite and @vitejs/plugin-react in Web devDependencies

- [ ] Typecheck passes

- [ ] `bun --filter @repo-stitcher/web run dev` starts dev server



**Tests Required:** None



**Dependencies:** P-047



**Handoff Notes:** Next: Tailwind CSS.



---



### P-049: Web Dependency — tailwindcss + postcss + autoprefixer



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-048



**Context:** Add Tailwind CSS for utility-first styling, PostCSS for processing, and Autoprefixer for vendor prefixes.



**Files to Create/Modify:**

- `packages/web/package.json` (add devDependencies)



**Implementation Steps:**

1. `bun add -D tailwindcss postcss autoprefixer --filter @repo-stitcher/web`

2. `bunx tailwindcss init -p --filter @repo-stitcher/web` (generates tailwind.config.js, postcss.config.js)

3. Configure tailwind.config.ts with content paths, darkMode: 'class'



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] tailwindcss, postcss, autoprefixer in Web devDependencies

- [ ] tailwind.config.ts and postcss.config.js generated

- [ ] Typecheck passes

- [ ] Tailwind classes work in components



**Tests Required:** None



**Dependencies:** P-048



**Handoff Notes:** Next: zustand for state management.



---



### P-050: Web Dependency — zustand



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-049



**Context:** Add `zustand` for lightweight client-side state management (UI state, settings, theme).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependency)



**Implementation Steps:**

1. `bun add zustand --filter @repo-stitcher/web`

2. Verify `import { create } from 'zustand'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] zustand in Web dependencies

- [ ] Typecheck passes

- [ ] Can create store with create()



**Tests Required:** None



**Dependencies:** P-049



**Handoff Notes:** Next: @tanstack/react-query for server state.



---



### P-051: Web Dependency — @tanstack/react-query



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-050



**Context:** Add TanStack Query (React Query) for server state management (caching, deduping, optimistic updates for REST/WS API).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependency)



**Implementation Steps:**

1. `bun add @tanstack/react-query --filter @repo-stitcher/web`

2. Verify `import { useQuery, useMutation, QueryClient } from '@tanstack/react-query'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] @tanstack/react-query in Web dependencies

- [ ] Typecheck passes

- [ ] Can create QueryClient and use hooks



**Tests Required:** None



**Dependencies:** P-050



**Handoff Notes:** Next: react-diff-viewer-continued.



---



### P-052: Web Dependency — react-diff-viewer-continued



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-051



**Context:** Add `react-diff-viewer-continued` for side-by-side and inline diff viewing (used for AI component proposals).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependency)



**Implementation Steps:**

1. `bun add react-diff-viewer-continued --filter @repo-stitcher/web`

2. Verify `import DiffViewer from 'react-diff-viewer-continued'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] react-diff-viewer-continued in Web dependencies

- [ ] Typecheck passes

- [ ] Can render diff viewer with old/new content



**Tests Required:** None



**Dependencies:** P-051



**Handoff Notes:** Next: shiki for syntax highlighting.



---



### P-053: Web Dependency — shiki



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-052



**Context:** Add `shiki` for WASM-based syntax highlighting (used in code blocks, diff viewer, file preview).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependency)



**Implementation Steps:**

1. `bun add shiki --filter @repo-stitcher/web`

2. Verify `import { getHighlighter } from 'shiki'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] shiki in Web dependencies

- [ ] Typecheck passes

- [ ] Can highlight code for multiple languages



**Tests Required:** None



**Dependencies:** P-052



**Handoff Notes:** Next: lucide-react for icons.



---



### P-054: Web Dependency — lucide-react



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-053



**Context:** Add `lucide-react` for consistent, tree-shakeable SVG icons (used throughout UI).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependency)



**Implementation Steps:**

1. `bun add lucide-react --filter @repo-stitcher/web`

2. Verify `import { Folder, File, GitBranch } from 'lucide-react'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] lucide-react in Web dependencies

- [ ] Typecheck passes

- [ ] Can import and render icons



**Tests Required:** None



**Dependencies:** P-053



**Handoff Notes:** Next: @radix-ui primitives.



---



### P-055: Web Dependency — @radix-ui/*



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-054



**Context:** Add Radix UI primitives for accessible, unstyled components (Dialog, Select, Tabs, Tooltip, DropdownMenu, ScrollArea).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependencies)



**Implementation Steps:**

1. `bun add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area --filter @repo-stitcher/web`

2. Verify imports work for each primitive



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] All 6 Radix UI packages in Web dependencies

- [ ] Typecheck passes

- [ ] Can import and use primitives



**Tests Required:** None



**Dependencies:** P-054



**Handoff Notes:** Next: react-hook-form + resolvers.



---



### P-055: Web Dependency — @radix-ui/*



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-054



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-055 focuses on `@radix-ui/*` and depends on P-054 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/web/src/@radix-ui/*.tsx`



**Implementation Steps:**

```

bun add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area --filter @repo-stitcher/web

```



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-054 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-056 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-056: Web Dependency — react-hook-form + @hookform/resolvers



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-055



**Context:** Add `react-hook-form` for performant forms and `@hookform/resolvers` for Zod schema validation integration.



**Files to Create/Modify:**

- `packages/web/package.json` (add dependencies)



**Implementation Steps:**

1. `bun add react-hook-form @hookform/resolvers --filter @repo-stitcher/web`

2. Verify `import { useForm } from 'react-hook-form'` and `import { zodResolver } from '@hookform/resolvers/zod'` work



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] react-hook-form and @hookform/resolvers in Web dependencies

- [ ] Typecheck passes

- [ ] Can create form with Zod resolver



**Tests Required:** None



**Dependencies:** P-055



**Handoff Notes:** Next: sonner for toasts.



---



### P-057: Web Dependency — sonner



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-056



**Context:** Add `sonner` for accessible, promise-based toast notifications (used for success/error/info messages).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependency)



**Implementation Steps:**

1. `bun add sonner --filter @repo-stitcher/web`

2. Verify `import { Toaster, toast } from 'sonner'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] sonner in Web dependencies

- [ ] Typecheck passes

- [ ] Can show toast with toast()



**Tests Required:** None



**Dependencies:** P-056



**Handoff Notes:** Next: react-arborist for file tree.



---



### P-058: Web Dependency — react-arborist



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-057



**Context:** Add `react-arborist` for virtualized, keyboard-navigable file tree with checkbox selection (used in repo file pickers).



**Files to Create/Modify:**

- `packages/web/package.json` (add dependency)



**Implementation Steps:**

1. `bun add react-arborist --filter @repo-stitcher/web`

2. Verify `import { Tree, useTree } from 'react-arborist'` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] react-arborist in Web dependencies

- [ ] Typecheck passes

- [ ] Can render virtualized tree



**Tests Required:** None



**Dependencies:** P-057



**Handoff Notes:** Next: clsx + tailwind-merge for class utilities.



---



### P-059: Web Dependency — clsx + tailwind-merge



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-058



**Context:** Add `clsx` for conditional class names and `tailwind-merge` for merging Tailwind classes without conflicts.



**Files to Create/Modify:**

- `packages/web/package.json` (add dependencies)



**Implementation Steps:**

1. `bun add clsx tailwind-merge --filter @repo-stitcher/web`

2. Verify `import { clsx } from 'clsx'` and `import { twMerge } from 'tailwind-merge'` work

3. Create `cn` utility: `export const cn = (...inputs) => twMerge(clsx(inputs))`



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] clsx and tailwind-merge in Web dependencies

- [ ] Typecheck passes

- [ ] `cn()` utility works correctly



**Tests Required:** None



**Dependencies:** P-058



**Handoff Notes:** Next: Root dev dependencies (P-060).



---



### P-060: Root Dev Dependency — vitest + @vitest/ui



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-059



**Context:** Add Vitest and Vitest UI at root for cross-package testing and coverage reporting.



**Files to Create/Modify:**

- `package.json` (root, add devDependencies)



**Implementation Steps:**

1. `bun add -D vitest @vitest/ui` (root)

2. Verify `bun test` runs all workspace tests

3. Verify `bun test --ui` opens Vitest UI



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] vitest and @vitest/ui in root devDependencies

- [ ] `bun test` runs all workspace tests

- [ ] Coverage reports generated



**Tests Required:** None



**Dependencies:** P-059



**Handoff Notes:** Next: @types/bun, @types/node.



---



### P-061: Root Dev Dependency — @types/bun, @types/node



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-060



**Context:** Add TypeScript type definitions for Bun and Node.js globals at root (shared across packages).



**Files to Create/Modify:**

- `package.json` (root, add devDependencies)



**Implementation Steps:**

1. `bun add -D @types/bun @types/node` (root)

2. Verify types available in all packages



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] @types/bun and @types/node in root devDependencies

- [ ] Typecheck passes across all packages



**Tests Required:** None



**Dependencies:** P-060



**Handoff Notes:** Next: tsup for building core.



---



### P-062: Root Dev Dependency — tsup



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-061



**Context:** Add `tsup` for building the core package (ESM + CJS + types output).



**Files to Create/Modify:**

- `package.json` (root, add devDependency)



**Implementation Steps:**

1. `bun add -D tsup` (root)

2. Verify `tsup packages/core/src/index.ts --format esm,cjs --dts --out-dir packages/core/dist` works



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] tsup in root devDependencies

- [ ] Build produces ESM, CJS, and .d.ts files



**Tests Required:** None



**Dependencies:** P-061



**Handoff Notes:** Next: nock/mockttp for HTTP mocking.



---



### P-063: Root Dev Dependency — nock / mockttp



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-062



**Context:** Add HTTP mocking libraries for testing GitHub API, AI provider, and Docker interactions.



**Files to Create/Modify:**

- `package.json` (root, add devDependencies)



**Implementation Steps:**

1. `bun add -D nock mockttp` (root)

2. Verify mocking works in tests



**Required MCPs/Connectors:** npm registry



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] nock and mockttp in root devDependencies

- [ ] Tests can mock HTTP requests



**Tests Required:** None



**Dependencies:** P-062



**Handoff Notes:** Next: fixture-repo generator script.



---



### P-064: Root Dev Dependency — fixture-repo generator



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-063



**Context:** Create a script to generate fixture repositories for integration testing (various languages, structures, license types).



**Files to Create/Modify:**

- `scripts/generate-fixtures.ts` (new file)



**Implementation Steps:**

1. Create `scripts/generate-fixtures.ts` that:

   - Creates temp directories with git repos

   - Populates with sample code (JS, TS, Python, Go, Rust)

   - Adds package.json, requirements.txt, Cargo.toml, go.mod

   - Adds LICENSE files (MIT, Apache-2.0, GPL-3.0)

   - Commits and tags

2. Make executable: `chmod +x scripts/generate-fixtures.ts`

3. Add to package.json scripts: `"fixtures": "bun scripts/generate-fixtures.ts"`



**Required MCPs/Connectors:** npm registry, git binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Script creates 5+ fixture repos with different languages/licenses

- [ ] Repos have proper git history

- [ ] Can be used in integration tests



**Tests Required:** None



**Dependencies:** P-063



**Handoff Notes:** Next: System dependency docs (P-065).



---



### P-065: System Dependency Doc — git ≥2.40



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-064



**Context:** Document the minimum Git version requirement (2.40+) for `git merge --allow-unrelated-histories` and `ort` strategy support.



**Files to Create/Modify:**

- `README.md` (prerequisites section)

- `docs/PREREQUISITES.md` (detailed)



**Implementation Steps:**

1. Add to README.md prerequisites:

   - `git` ≥ 2.40 (required for `ort` merge strategy)

   - Check with `git --version`

2. Create `docs/PREREQUISITES.md` with:

   - Installation instructions per OS (brew, apt, winget, choco)

   - Version verification steps

   - Troubleshooting common issues



**Required MCPs/Connectors:** None



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] README.md has git version requirement

- [ ] docs/PREREQUISITES.md exists with install instructions

- [ ] `stitch doctor` validates git version



**Tests Required:** None



**Dependencies:** P-064



**Handoff Notes:** Next: git-filter-repo documentation.



---



### P-066: System Dependency Doc — git-filter-repo (pip)



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-065



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-066 focuses on `git-filter-repo (pip)` and depends on P-065 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/core/src/advanced/git-filter-repo_(pip).ts`



**Implementation Steps:** Document `pipx install git-filter-repo` in README and `stitch doctor`.



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `git-filter-repo (pip)` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-065 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-067 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-067: System Dependency Doc — Docker



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-066



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-067 focuses on `Docker` and depends on P-066 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/core/src/advanced/docker.ts`



**Implementation Steps:** Document Docker requirement.



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Docker` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-066 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-068 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



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



**Context:** Document the Git branching strategy for the project (main, develop, feature branches, PR rules).



**Files to Create/Modify:**

- `docs/BRANCHING.md`



**Implementation Steps:**

1. Document branch strategy:

   - `main`: protected, release tags only

   - `develop`: integration branch for features

   - Feature branches: `feat/*`, `fix/*`, `docs/*`

   - PR rules: require review, CI pass, up-to-date with develop

   - Release flow: develop → main via PR, tag, release workflow

2. Include diagrams for branching workflow



**Required MCPs/Connectors:** None



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] docs/BRANCHING.md exists with clear strategy

- [ ] Branch naming conventions documented

- [ ] PR merge requirements defined

- [ ] Release flow documented



**Tests Required:** None



**Dependencies:** P-068



**Handoff Notes:** Next: Contract freeze gate (P-314).



---



### P-314: Contract Freeze Gate



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-313



**Context:** Establish the frozen contract between core and CLI/Web packages. The public API of core (types, functions, WS messages) must not change without version bump and coordination.



**Files to Create/Modify:**

- `packages/core/src/types/index.ts` (public API)

- `packages/core/src/types/ws.ts` (WS messages)



**Implementation Steps:**

1. Define all public types in `core/src/types/`

2. Export via `core/src/index.ts`

3. Add `CONTRACT_FROZEN = true` constant

4. Document: any breaking change = major version + coordination with aradhy



**Required MCPs/Connectors:** None



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] `core/src/types/index.ts` exports all public types

- [ ] `core/src/types/ws.ts` defines WS message types

- [ ] `CONTRACT_FROZEN` constant exported

- [ ] Documentation states breaking change policy



**Tests Required:** None



**Dependencies:** P-313



**Handoff Notes:** Next: shared types package (P-315).



---



### P-315: packages/shared for Cross-Cutting Types



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-314



**Context:** Create a shared types package (or use core/src/types) for types consumed by both core and aradhy's packages (cli/web). Types are inbesat-owned, aradhy read-only.



**Files to Create/Modify:**

- `packages/shared/` (optional — can live in core/src/types)



**Implementation Steps:**

1. If needed, create `packages/shared` with read-only types for aradhy

2. Otherwise, types stay in `core/src/types/` and are imported via public API

3. Document: aradhy never modifies these types



**Required MCPs/Connectors:** None



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Shared types location decided and documented

- [ ] aradhy can import types without modifying them

- [ ] Type changes require core version bump



**Tests Required:** None



**Dependencies:** P-314



**Handoff Notes:** Next: Handoff package (P-316).



---



### P-316: Handoff Package — HANDOFF.md



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-315



**Context:** Create the handoff document for aradhy to start working on CLI/Web after Wave 0 is complete.



**Files to Create/Modify:**

- `HANDOFF.md` (root)



**Implementation Steps:**

1. Write `HANDOFF.md` with:

   - Clone URL and branch

   - `bun install` → `bun run dev:cli` → `bun run dev:web`

   - Contract freeze notice (core API frozen)

   - Dep request process

   - Contact info



**Required MCPs/Connectors:** None



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] HANDOFF.md at root with all required info

- [ ] Clear instructions for aradhy to start

- [ ] Contract freeze clearly stated

- [ ] Dep request process documented



**Tests Required:** None



**Dependencies:** P-315



**Handoff Notes:** Next: Dep request flow (P-317).



---



### P-317: Dep Request Flow



**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-316



**Context:** Document the process for aradhy to request new dependencies (since only inbesat manages package.json/lockfile).



**Files to Create/Modify:**

- `HANDOFF.md` (update)

- `CONTRIBUTING.md` (update)



**Implementation Steps:**

1. Document in `HANDOFF.md` and `CONTRIBUTING.md`:

   - aradhy files GitHub issue "dep needed: <pkg> — reason"

   - inbesat reviews, adds to root `package.json`

   - aradhy pulls latest and continues

2. Lockfile single-owner: only inbesat runs `bun install`



**Required MCPs/Connectors:** None



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] HANDOFF.md updated with dep request process

- [ ] CONTRIBUTING.md updated

- [ ] Clear that only inbesat modifies package.json/lockfile



**Tests Required:** None



**Dependencies:** P-316



**Handoff Notes:** End of Wave 0. aradhy can now clone and start Wave 1 (CLI/Web).



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



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-071 focuses on `tagRename Helper` and depends on P-070 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `tagRename Helper` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-070 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-072 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-072: Git Core — mergeRepos



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-071



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-072 focuses on `mergeRepos` and depends on P-071 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `mergeRepos` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-071 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-073 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



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



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Adds child repo as subtree under prefix

- [ ] Option to preserve history (no --squash) or squash

- [ ] Works for merge scenario



**Tests Required:** Fixture test with subtree add



**Dependencies:** P-072



**Handoff Notes:** Next: P-074 cherryPickRange.



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



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Cherry-picks commits in range (inclusive)

- [ ] Handles conflicts gracefully (returns error with conflict info)



**Tests Required:** Fixture test with cherry-pick range



**Dependencies:** P-073



**Handoff Notes:** Next: P-075 conflict resolver.



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



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Detects all conflicted files

- [ ] Auto-resolves trivial conflicts (same change both sides)

- [ ] Returns unresolved conflicts for manual handling



**Tests Required:** Fixture with conflicts



**Dependencies:** P-074



**Handoff Notes:** Next: P-076 writeToWorktree.



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



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Writes file within repo worktree

- [ ] Blocks path traversal

- [ ] Creates parent directories



**Tests Required:** Unit test with safe/unsafe paths



**Dependencies:** P-075



**Handoff Notes:** Next: P-077 commitWithTrailers.



---



### P-077: Git Core — Commit with Co-Author Trailers



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-076



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-077 focuses on `Commit with Co-Author Trailers` and depends on P-076 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/core/src/git/commit.ts`



**Implementation Steps:**

```ts

export async function commitWithTrailers(repoPath: string, message: string, coAuthors: string[]): Promise<Result<string, StitchError>>

```

- Format: `Co-Authored-By: Name <email>`

- Returns commit SHA



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Commit with Co-Author Trailers` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-076 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-078 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-078: Git Core — pushToRemote



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-077



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-078 focuses on `pushToRemote` and depends on P-077 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/core/src/git/push.ts`



**Implementation Steps:**

```ts

export async function pushToRemote(repoPath: string, remoteUrl: string, branch: string, force?: boolean): Promise<Result<void, StitchError>>

```

- Creates repo via GitHub API if needed

- Pushes branch (force only for updates)



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `pushToRemote` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-077 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-079 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



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



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Every file in child repo mapped to source repo + commit

- [ ] Author info preserved

- [ ] Handles moved/renamed files



**Tests Required:** Fixture with known provenance



**Dependencies:** P-078



**Handoff Notes:** Next: P-080 branch management.

- [ ] Author info preserved

- [ ] Handles moved/renamed files



---



### P-080: Git Core — Branch Management



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-079



**Context:** Manage branches in the child repo (create, delete, list, checkout).



**Files to Create/Modify:**

- `packages/core/src/git/branch.ts`



**Implementation Steps:**

```ts

export async function createBranch(repoPath: string, name: string, startPoint?: string): Promise<Result<void, StitchError>>

export async function deleteBranch(repoPath: string, name: string): Promise<Result<void, StitchError>>

export async function listBranches(repoPath: string): Promise<Result<string[], StitchError>>

export async function getCurrentBranch(repoPath: string): Promise<Result<string, StitchError>>

```



**Required MCPs/Connectors:** System `git` binary + simple-git



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Can create/delete/list branches

- [ ] getCurrentBranch returns correct branch name



**Tests Required:** Unit tests for each function



**Dependencies:** P-079



**Handoff Notes:** Next: P-081 stash safety.



---



### P-081: Git Core — Stash Safety



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-080



**Context:** Stash and restore changes for safe operations (used before risky operations).



**Files to Create/Modify:**

- `packages/core/src/git/stash.ts`



**Implementation Steps:**

```ts

export async function stash(repoPath: string, message?: string): Promise<Result<void, StitchError>>

export async function unstash(repoPath: string): Promise<Result<void, StitchError>>

export async function stashList(repoPath: string): Promise<Result<string[], StitchError>>

```

- Used before risky operations



**Required MCPs/Connectors:** System `git` binary + simple-git



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Can stash/unstash changes

- [ ] Stash list shows stashed changes

- [ ] Works with empty stash



**Tests Required:** Unit tests with fixture repo



**Dependencies:** P-080



**Handoff Notes:** Next: P-082 binary skip list.



---



### P-082: Git Core — Binary Skip List



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-081



**Context:** Detect binary files via `git check-attr` and skip them from AI processing.



**Files to Create/Modify:**

- `packages/core/src/git/binarySkip.ts`



**Implementation Steps:**

- Detect binary files via `git check-attr`

- Skip binary files from AI processing

- Configurable patterns



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Correctly identifies binary files

- [ ] Skips binary files in AI processing

- [ ] Configurable patterns work



**Tests Required:** Unit test with binary/text files



**Dependencies:** P-081



**Handoff Notes:** Next: P-083 .gitignore merge.



---



### P-083: Git Core — .gitignore Merge



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-082



**Context:** Merge `.gitignore` files from both parent repos, deduplicate entries, and add `.stitch/` to ignore.



**Files to Create/Modify:**

- `packages/core/src/git/gitignore.ts`



**Implementation Steps:**

- Merge `.gitignore` from both parents

- Deduplicate entries

- Add `.stitch/` to ignore



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Merges .gitignore from both parents

- [ ] Deduplicates entries

- [ ] Adds .stitch/ to ignore



**Tests Required:** Unit test with fixture .gitignore files



**Dependencies:** P-082



**Handoff Notes:** Next: P-084 clean tree verify.



---



### P-084: Git Core — Clean Tree Verify



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-083



**Context:** Verify the git worktree is clean before operations (no uncommitted changes, untracked files except allowed).



**Files to Create/Modify:**

- `packages/core/src/git/verify.ts`



**Implementation Steps:**

- `isClean(repoPath)` → boolean

- `verifyCleanTree(repoPath)` → throws if dirty



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Correctly identifies clean/dirty trees

- [ ] Throws on dirty tree

- [ ] Allows configured untracked files



**Tests Required:** Unit test with clean/dirty repos



**Dependencies:** P-083



**Handoff Notes:** Next: P-085 rollback/abort.

- Checks: uncommitted changes, untracked files (except allowed)



---



### P-085: Git Core — Rollback/Abort



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-084



**Context:** Abort operations and restore clean state (abort merge, hard reset, clean worktree).



**Files to Create/Modify:**

- `packages/core/src/git/rollback.ts`



**Implementation Steps:**

- `abortMerge(repoPath)` — aborts in-progress merge

- `resetHard(repoPath, commit?)` — hard reset to commit or HEAD

- `cleanWorktree(repoPath)` — removes untracked files



**Required MCPs/Connectors:** System `git` binary + simple-git



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Aborts in-progress merge

- [ ] Hard resets to specified commit or HEAD

- [ ] Cleans worktree of untracked files



**Tests Required:** Unit test with merge conflict, reset, clean



**Dependencies:** P-084



**Handoff Notes:** Next: P-086 performance optimization.



---



### P-086: Git Core — Performance (Parallel, Cache)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-085



**Context:** Optimize git operations with parallel execution and caching (parallel clones, cached filter-repo results).



**Files to Create/Modify:**

- `packages/core/src/git/perf.ts`



**Implementation Steps:**

- Parallel clone for multiple repos

- Cache filtered repos by content hash

- Reuse filter-repo results for same paths



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Parallel clone reduces total time

- [ ] Cache hit avoids re-filtering

- [ ] Cache invalidation on content change



**Tests Required:** Performance benchmarks



**Dependencies:** P-085



**Handoff Notes:** Next: P-087 unit tests with fixtures.



---



### P-087: Git Core — Unit Tests with Fixtures



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-086



**Context:** Comprehensive unit tests for all git operations using fixture repositories.



**Files to Create/Modify:**

- `packages/core/src/git/__tests__/*.test.ts`



**Implementation Steps:**

- Create fixture repos in `tests/fixtures/`

- Test each function: clone, filter-repo, merge, push, provenance

- Test error cases



**Required MCPs/Connectors:** System `git` binary



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] All git functions have unit tests

- [ ] Fixture repos cover: simple, nested dirs, binary files, tags

- [ ] Tests run in < 30s



**Tests Required:** All tests pass



**Dependencies:** P-086



**Handoff Notes:** End of Git Core epic. Next: GitHub integration (P-088).

export function createOctokit(config: GitHubConfig): Octokit

export async function validateAuth(octokit: Octokit): Promise<Result<User, StitchError>>

```

### P-088: GitHub — Auth (Token + App)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-087



**Context:** Create authenticated Octokit client supporting both Personal Access Tokens and GitHub App authentication.



**Files to Create/Modify:**

- `packages/core/src/github/auth.ts`



**Implementation Steps:**

```ts

export function createOctokit(config: GitHubConfig): Octokit

export async function validateAuth(octokit: Octokit): Promise<Result<User, StitchError>>

```

- Supports PAT and GitHub App

- Validates scopes/permissions



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Creates Octokit with PAT auth

- [ ] Creates Octokit with GitHub App auth

- [ ] Validates token has required scopes



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-087



**Handoff Notes:** Next: P-089 list/search repos.



---



### P-089: GitHub — List/Search Repos



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-088



**Context:** List user repositories and search for repositories by name/owner.



**Files to Create/Modify:**

- `packages/core/src/github/repos.ts`



**Implementation Steps:**

- `listUserRepos(octokit, options)` — paginated list

- `searchRepos(octokit, query)` — search by name/owner

- Pagination handling



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Lists user repos with pagination

- [ ] Searches repos by query

- [ ] Handles rate limits



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-088



**Handoff Notes:** Next: P-090 getRepoTree.



---



### P-090: GitHub — GetRepoTree (Recursive)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-089



**Context:** Get recursive file tree for a repository (used for file picker in Web UI).



**Files to Create/Modify:**

- `packages/core/src/github/trees.ts`



**Implementation Steps:**

- `getRepoTree(octokit, owner, repo, branch)` → flat file list

- Uses GraphQL for large repos (>10k files)

- Caches in SQLite (repo_cache table)



**Required MCPs/Connectors:** GitHub API (Octokit + GraphQL)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Returns flat file list with paths, types, sizes

- [ ] GraphQL for large repos

- [ ] Caches in SQLite with TTL



**Tests Required:** Unit test with mocked GraphQL/REST



**Dependencies:** P-089



**Handoff Notes:** Next: P-091 getFileContent.



### P-091: GitHub — GetFileContent/Batch



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-090



**Context:** Get file contents from a repository (single file or batch for efficiency).



**Files to Create/Modify:**

- `packages/core/src/github/contents.ts`



**Implementation Steps:**

- `getFileContent(octokit, owner, repo, path, branch)` — single file

- `getFilesBatch(octokit, owner, repo, paths[], branch)` — parallel batch



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Gets single file content (base64 decoded)

- [ ] Batch fetches multiple files in parallel

- [ ] Handles 404 for missing files



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-090



**Handoff Notes:** Next: P-092 CreateRepoC.



---



### P-092: GitHub — CreateRepoC



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-091



**Context:** Create the child repository C on GitHub for the merged result.



**Files to Create/Modify:**

- `packages/core/src/github/create.ts`



**Implementation Steps:**

- `createRepo(octokit, name, private, description?)` → creates repo

- Returns repo URL + clone URL



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Creates repo with given name/visibility

- [ ] Returns clone URL (HTTPS and SSH)

- [ ] Sets description if provided



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-091



**Handoff Notes:** Next: P-093 Branch/Protect.



### P-093: GitHub — Branch/Protect



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-092



**Context:** Create branch in the child repo and optionally enable branch protection (PR reviews, status checks).



**Files to Create/Modify:**

- `packages/core/src/github/branch.ts`



**Implementation Steps:**

- `createBranch(octokit, owner, repo, branch, sha)` — creates branch at SHA

- `protectBranch(octokit, owner, repo, branch)` — enable protection (PR reviews, status checks)



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Creates branch at specified SHA

- [ ] Enables branch protection rules

- [ ] Requires PR reviews and status checks



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-092



**Handoff Notes:** Next: P-094 OpenPR + CREDITS.



---



### P-094: GitHub — OpenPR + CREDITS



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-093



**Context:** Open a pull request for the merged result with CREDITS.md summary in the body.



**Files to Create/Modify:**

- `packages/core/src/github/pr.ts`



**Implementation Steps:**

- `createPR(octokit, owner, repo, title, body, head, base)`

- Body includes CREDITS.md summary

- Labels: `stitch-merge`



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Creates PR with title, body, head, base

- [ ] Body includes CREDITS.md summary

- [ ] Adds `stitch-merge` label



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-093



**Handoff Notes:** Next: P-095 Actions Status Webhook.



### P-095: GitHub — Actions Status Webhook



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-094



**Context:** Trigger and monitor GitHub Actions workflows for sandbox builds.



**Files to Create/Modify:**

- `packages/core/src/github/actions.ts`



**Implementation Steps:**

- `triggerWorkflow(octokit, owner, repo, workflowId, inputs)` — dispatch workflow

- `pollWorkflowRun(octokit, owner, repo, runId)` → polls for completion status



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Triggers workflow with inputs

- [ ] Polls run status until completion

- [ ] Returns final status (success/failure)



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-094



**Handoff Notes:** Next: P-096 Rate Limit Backoff.



---



### P-096: GitHub — Rate Limit Backoff



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-095



**Context:** Handle GitHub API rate limits with exponential backoff and jitter.



**Files to Create/Modify:**

- `packages/core/src/github/rateLimit.ts`



**Implementation Steps:**

- Wrapper `withBackoff(fn)` that respects `Retry-After`

- Exponential backoff with jitter

- Logs rate limit status



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Respects `Retry-After` header

- [ ] Exponential backoff with jitter

- [ ] Logs rate limit status



**Tests Required:** Unit test with mocked rate limit



**Dependencies:** P-095



**Handoff Notes:** Next: P-097 GraphQL Trees.



### P-097: GitHub — GraphQL Trees



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-096



**Context:** Use GraphQL to fetch repository tree in a single request (more efficient for large repos).



**Files to Create/Modify:**

- `packages/core/src/github/graphql.ts`



**Implementation Steps:**

- GraphQL query for repo tree (single request)

- Handles pagination for huge repos

- Falls back to REST if GraphQL fails



**Required MCPs/Connectors:** GitHub API (Octokit GraphQL)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Single GraphQL query fetches full tree

- [ ] Handles pagination for huge repos

- [ ] Falls back to REST on GraphQL failure



**Tests Required:** Unit test with mocked GraphQL



**Dependencies:** P-096



**Handoff Notes:** Next: P-098 DetectRepoLicense.



---



### P-098: GitHub — DetectRepoLicense



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-097



**Context:** Detect the license of a repository by reading LICENSE file and package.json.



**Files to Create/Modify:**

- `packages/core/src/github/license.ts`



**Implementation Steps:**

- `detectRepoLicense(octokit, owner, repo)` → reads LICENSE file + package.json

- Returns SPDX ID if detectable



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Reads LICENSE file from repo

- [ ] Parses package.json license field

- [ ] Returns SPDX ID or UNKNOWN



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-097



**Handoff Notes:** Next: P-099 Fork Support.



---



### P-099: GitHub — Fork Support



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-098



**Context:** Fork a repository (for sandbox workflows that need write access).



**Files to Create/Modify:**

- `packages/core/src/github/fork.ts`



**Implementation Steps:**

- `forkRepo(octokit, owner, repo, organization?)` → forks repo

- Wait for fork to be ready



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Forks repo to user/org

- [ ] Waits for fork to be ready

- [ ] Returns fork URL



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-098



**Handoff Notes:** Next: P-100 GH Actions Sandbox Trigger.



---



### P-100: GitHub — GH Actions Sandbox Trigger



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-099



**Context:** Dispatch the sandbox workflow on GitHub Actions for build/test verification.



**Files to Create/Modify:**

- `packages/core/src/github/sandbox.ts`



**Implementation Steps:**

- Dispatch `stitch-sandbox.yml` workflow

- Inputs: repo URL, branch, ecosystem

- Poll for completion



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Dispatches workflow with correct inputs

- [ ] Polls for completion

- [ ] Returns workflow status



**Tests Required:** Unit test with mocked Octokit



**Dependencies:** P-099



**Handoff Notes:** Next: P-101 Tests with Mocked Octokit.



---



### P-101: GitHub — Tests with Mocked Octokit



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-100



**Context:** Unit tests for all GitHub API functions using mocked Octokit.



**Files to Create/Modify:**

- `packages/core/src/github/__tests__/*.test.ts`



**Implementation Steps:**

- Mock Octokit with nock

- Test all functions

- Test error cases (404, 403, rate limit)



**Required MCPs/Connectors:** nock (mocking)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] All GitHub functions tested

- [ ] Error cases covered (404, 403, rate limit)

- [ ] Tests run in < 30s



**Tests Required:** All tests pass



**Dependencies:** P-100



**Handoff Notes:** Next: P-102 Error Mapping.



---



### P-102: GitHub — Error Mapping



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-101



**Context:** Map Octokit errors to StitchError codes for consistent error handling.



**Files to Create/Modify:**

- `packages/core/src/github/errors.ts`



**Implementation Steps:**

- Map Octokit errors to `StitchError` codes

- 404 → NOT_FOUND, 403 → UNAUTHORIZED, 422 → VALIDATION_ERROR

- Rate limit → RETRYABLE_ERROR



**Required MCPs/Connectors:** GitHub API (Octokit)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Maps 404 to NOT_FOUND

- [ ] Maps 403 to UNAUTHORIZED

- [ ] Maps 422 to VALIDATION_ERROR

- [ ] Maps rate limit to RETRYABLE_ERROR



**Tests Required:** Unit test with various error responses



**Dependencies:** P-101



**Handoff Notes:** End of GitHub epic. Next: Deps epic (P-103).



### P-103: Deps — Ecosystem Detect



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-102



**Context:** Detect which package ecosystems are present in a repository (npm, pnpm, yarn, pip, poetry, cargo, go).



**Files to Create/Modify:**

- `packages/core/src/deps/detect.ts`



**Implementation Steps:**

```ts

export type Ecosystem = 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go'



export function detectEcosystem(repoPath: string): Ecosystem[]

```

- Checks for manifest files: package.json, pnpm-lock.yaml, yarn.lock, requirements.txt, pyproject.toml, Cargo.toml, go.mod

- Returns all detected (monorepos may have multiple)



**Required MCPs/Connectors:** None (local filesystem)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Detects npm/pnpm/yarn via package.json + lockfiles

- [ ] Detects pip/poetry via requirements.txt/pyproject.toml

- [ ] Detects cargo via Cargo.toml

- [ ] Detects go via go.mod

- [ ] Returns multiple for monorepos



**Tests Required:** Unit test with fixture repos of each type



**Dependencies:** P-102



**Handoff Notes:** Next: P-104 Parse package.json.



---



### P-104: Deps — Parse package.json

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-103

**Context:** npm is the default ecosystem for repo-stitcher itself and most JS/TS repos to be stitched. This phase provides deterministic parsing and serialization for `package.json`, including all dependency fields, scripts, and engines. It is the first parser in the Deps epic and defines the `ParsedManifest` shape that later union logic (`P-108`) consumes. Without it, JS repos cannot participate in dependency merging.

**Files to Create/Modify:**
- `packages/core/src/deps/parse/npm.ts`
- `packages/core/src/deps/types.ts` (update — add `NpmManifest` to `ParsedManifest` union)
- `packages/core/src/deps/parse/npm.test.ts`

**Implementation Steps:**
1. Update `packages/core/src/deps/types.ts`:
   ```ts
   export interface NpmManifest {
     dependencies?: Record<string, string>
     devDependencies?: Record<string, string>
     peerDependencies?: Record<string, string>
     optionalDependencies?: Record<string, string>
     peerDependenciesMeta?: Record<string, { optional?: boolean }>
     scripts?: Record<string, string>
     engines?: Record<string, string>
     overrides?: Record<string, string>
     workspaces?: string[] | { packages: string[] }
   }
   export type ParsedManifest = { ecosystem: 'npm'; manifest: NpmManifest; path: string }
   ```
2. Create `packages/core/src/deps/parse/npm.ts`:
   ```ts
   import { Result, ok, err } from '../../result'
   import { StitchError } from '../../errors'
   export function parsePackageJson(content: string, filePath: string): Result<ParsedManifest, StitchError>
   export function serializePackageJson(manifest: NpmManifest): string
   ```
   - Inside `parsePackageJson`: `JSON.parse` with try/catch → map `SyntaxError` to `StitchError('DEPS_PARSE_ERROR')`; validate required fields via `zod` (if `name`/`version` present, ensure strings); strip `//` comments before parse (defensive); preserve raw `workspaces` shape.
   - `serializePackageJson`: `JSON.stringify(manifest, null, 2) + '\n'` with stable key order (dependencies → devDeps → peerDeps → scripts → engines).
3. Handle edge cases:
   - Missing file → return `err` with `code: 'FILE_NOT_FOUND'`.
   - Empty `dependencies` → normalize to `{}` for merge logic.
   - `workspaces` as array vs object → normalize to string[] for downstream.
4. Export from `packages/core/src/deps/parse/index.ts` and barrel `packages/core/src/deps/index.ts`.
5. Run `bun run typecheck` and `bun run lint`; fix `no-restricted-imports` if needed.

**Required MCPs/Connectors:** None (local file parsing)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `parsePackageJson('{"dependencies":{"react":"^18.0.0"}}')` returns `ok` with typed manifest; malformed JSON returns `err` with `DEPS_PARSE_ERROR`
- [ ] All dependency fields + `scripts`/`engines`/`overrides` round-trip via `serializePackageJson` without data loss
- [ ] Workspace shapes (array and `{packages:[]}`) normalized correctly
- [ ] `bun run typecheck` passes and `bun test` covers normal + malformed inputs

**Tests Required:** Unit `packages/core/src/deps/parse/npm.test.ts`:
- `it('parses all dep fields')` with fixture containing deps/devDeps/peerDeps/optionalDeps/scripts/engines/overrides
- `it('handles missing fields')` → empty manifest
- `it('returns error on invalid JSON')`
- `it('serializes stable order')` snapshot
- `it('normalizes workspaces')` for both shapes

**Dependencies:** P-103 (ecosystem detect must run first to route to this parser)

**Handoff Notes:** Next: P-105 Python parser. `ParsedManifest` union now includes npm; `P-108` will `switch(manifest.ecosystem)` to handle it. Notify aradhy that `NpmManifest` is frozen.

---
### P-105: Deps — Parse requirements.txt / pyproject.toml

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-104

**Context:** Python repos appear as `requirements.txt` (pip) or `pyproject.toml` (PEP 517/518, Poetry, PDM, uv). This phase adds parsers for both legacy and modern Python manifests, unifying them into a single `PythonManifest` that the union logic can merge. It blocks Python stitching until complete.

**Files to Create/Modify:**
- `packages/core/src/deps/parse/python.ts`
- `packages/core/src/deps/types.ts` (add `PythonManifest`)
- `packages/core/src/deps/parse/python.test.ts`
- `packages/core/package.json` (add `ini` / `toml` helper if not already present — `yaml` already covers toml via `smol-toml`? Use `ini` for requirements parsing)

**Implementation Steps:**
1. Extend `types.ts`:
   ```ts
   export interface PythonManifest {
     dependencies: Record<string, string> // name → version spec (e.g., "requests": ">=2.28.1")
     devDependencies?: Record<string, string>
     extras?: Record<string, string[]>
     pythonVersion?: string
     source: 'requirements.txt' | 'pyproject.toml' | 'poetry' | 'uv'
   }
   ```
2. Implement `parseRequirementsTxt(content: string): PythonManifest` in `python.ts`:
   - Split by `\n`, trim, skip `#` comments and `-r` includes (log warning for includes).
   - Regex `^([A-Za-z0-9_.-]+)(?:\[([^\]]+)\])?\s*([=<>!~]+.*)?$` to capture name, extras, spec.
   - Handle `package @ git+https://...` → store as `*` with `url` in comment field.
   - Deduplicate last-wins with warning.
3. Implement `parsePyprojectToml(content: string): Result<PythonManifest, StitchError>`:
   - Parse TOML via `smol-toml` (already via `yaml`? Add `smol-toml` if needed).
   - Support `[project].dependencies` (PEP 621), `[tool.poetry.dependencies]`, `[tool.poetry.group.dev.dependencies]`, `[dependency-groups]` (PEP 735), `[tool.uv.sources]`.
   - Extract `requires-python` → `pythonVersion`; map `project.optional-dependencies` → `extras`.
4. Export `parsePythonManifest(filePath: string, content: string)` dispatcher that checks extension.
5. Add tests and run validation.

**Required MCPs/Connectors:** None (local parsing; no network)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `requirements.txt` with `requests>=2.28.1`, `django[argon2]==4.2 # comment`, `-c constraints.txt` parses with extras and skips includes gracefully
- [ ] `pyproject.toml` for Poetry, Hatch, and uv fixtures all return correct `dependencies` + `pythonVersion`
- [ ] Malformed TOML returns `DEPS_PARSE_ERROR` with line number
- [ ] All parsers produce `PythonManifest` that `unionManifests` can consume

**Tests Required:** `python.test.ts` fixtures:
- `requirements-simple.txt`, `requirements-with-extras.txt`, `pyproject-poetry.toml`, `pyproject-pep621.toml`, `pyproject-uv.toml`
- Edge: empty file, comment-only, `package @ URL`, duplicate package last-wins

**Dependencies:** P-104 (npm parser establishes pattern and types)

**Handoff Notes:** Next: P-106 Cargo parser. Python source field informs `P-114` lockfile regeneration (`pip compile` vs `uv pip compile`).

---
### P-106: Deps — Parse Cargo.toml

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-105

**Context:** Rust `Cargo.toml` defines dependencies, features, and build targets. Parsing it correctly is needed to merge Rust projects and to detect feature-flag conflicts (e.g., `tokio/full` vs `tokio/sync`). This phase focuses on the single-manifest case; workspace `Cargo.toml` (members) is out of scope for MVP but stubbed.

**Files to Create/Modify:**
- `packages/core/src/deps/parse/cargo.ts`
- `packages/core/src/deps/types.ts` (add `CargoManifest`)
- `packages/core/src/deps/parse/cargo.test.ts`

**Implementation Steps:**
1. Add to `types.ts`:
   ```ts
   export interface CargoManifest {
     package: { name: string; version: string; edition?: string }
     dependencies: Record<string, string | { version: string; features?: string[]; optional?: boolean }>
     devDependencies?: Record<string, string | { version: string }>
     buildDependencies?: Record<string, string>
     features?: Record<string, string[]>
     workspace?: { members: string[] }
   }
   ```
2. Implement `parseCargoToml(content: string): Result<CargoManifest, StitchError>`:
   - Parse TOML via `smol-toml` (add `smol-toml` to `core` deps if missing: `bun add smol-toml --filter @repo-stitcher/core`).
   - Normalize `[dependencies]` values that are strings (`"1.0"`) vs tables (`{ version = "1.0", features = ["derive"] }`) → always store as object with `version`.
   - Preserve `features` and `workspace.members` for later merge warnings.
3. Handle `[patch]`, `[replace]` as warnings (log but not merged in MVP) → collect into `warnings[]` on result.
4. Export and barrel update; run `bun run typecheck`.

**Required MCPs/Connectors:** None (local TOML parsing)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] Parses `Cargo.toml` with `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, `[features]` correctly; string and table dependency forms normalized
- [ ] Workspace `members` preserved; `[patch]` emits warning not error
- [ ] Invalid TOML returns `DEPS_PARSE_ERROR` with line/col from parser
- [ ] Round-trip `serializeCargoToml` (if implemented) or at least `parse → manifest` is testable

**Tests Required:** Fixtures:
- `Cargo.simple.toml`, `Cargo.features.toml`, `Cargo.workspace.toml`
- Edge: dependency as `{ git = "..." }` → stored with `version: "*"` + warning

**Dependencies:** P-105 (establishes Python parsing pattern to replicate)

**Handoff Notes:** Next: P-107 `go.mod`. Cargo `features` map will be checked in `P-108` union for conflict detection (e.g., same crate different features).

---
### P-107: Deps — Parse go.mod

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-106

**Context:** Go `go.mod` is line-oriented (no JSON/TOML library needed) and includes `module`, `go`, `require`, `replace`, `exclude` directives. Correct parsing is needed to merge Go projects and to handle `replace` directives that affect build reproducibility. This phase completes the four-ecosystem parser set.

**Files to Create/Modify:**
- `packages/core/src/deps/parse/go.ts`
- `packages/core/src/deps/types.ts` (add `GoManifest`)
- `packages/core/src/deps/parse/go.test.ts`

**Implementation Steps:**
1. Add to `types.ts`:
   ```ts
   export interface GoManifest {
     module: string
     goVersion?: string
     require: Record<string, string> // module → version
     replace?: Record<string, string> // old → new
     exclude?: Record<string, string>
     indirect?: Set<string> // modules marked // indirect
   }
   ```
2. Implement `parseGoMod(content: string): Result<GoManifest, StitchError>`:
   - Line-by-line state machine: track `require (` block vs single `require`.
   - Regex for single: `^require\s+(\S+)\s+(\S+)(?:\s+//\s*indirect)?$`
   - Regex for block line: `^\s+(\S+)\s+(\S+)(?:\s+//\s*indirect)?$`
   - Parse `module`, `go 1.21`, `replace` (both single and block), `exclude`.
   - Collect `// indirect` markers into `indirect` set.
3. Implement `serializeGoMod(manifest: GoManifest): string` that emits sorted `require` block and preserves `replace` if present.
4. Handle `toolchain` directive (Go 1.21+) → store as warning, not merged.

**Required MCPs/Connectors:** None (local line parsing)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] Parses single-line `require` and block `require (` with `// indirect` correctly
- [ ] Captures `module`, `goVersion`, `replace`, `exclude` directives
- [ ] `go.mod` with `toolchain` does not error (warning)
- [ ] Malformed `go.mod` (missing module line) returns `DEPS_PARSE_ERROR`

**Tests Required:** Fixtures:
- `go.simple.mod`, `go.block.mod`, `go.replace.mod`, `go.indirect.mod`
- Snapshot `serializeGoMod` output matches `go fmt` style (sorted)

**Dependencies:** P-106 (last parser before union)

**Handoff Notes:** Next: P-108 `unionManifests`. All four `ParsedManifest` types now complete; union will dispatch per `ecosystem`. Notify that `go.mod` parsing is line-based, not TOML.

---
### P-108: Deps — Union Manifests + Conflict Detect

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-107

**Context:** After parsing per-ecosystem manifests from A and B, this phase merges them into a single `UnifiedManifest` and detects conflicts (same package, incompatible versions / peer mismatches / script collisions). It is the heart of `Epic 4` and feeds `P-109` semver resolver and `P-116` report.

**Files to Create/Modify:**
- `packages/core/src/deps/merge.ts` (previously stubbed)
- `packages/core/src/deps/types.ts` (add `MergeResult`, `Conflict`)
- `packages/core/src/deps/merge.test.ts`

**Implementation Steps:**
1. Define in `types.ts`:
   ```ts
   export interface Conflict {
     type: 'version' | 'peer' | 'script' | 'config'
     package: string
     values: Record<string, string> // sourceRepo -> version/spec (e.g., { "repo-a": "^1.0.0", "repo-b": "^2.0.0" })
     suggestedResolution?: string
     severity: 'error' | 'warning'
   }
   export interface MergeResult {
     merged: UnifiedManifest
     conflicts: Conflict[]
     warnings: string[]
   }
   export type UnifiedManifest = NpmManifest | PythonManifest | CargoManifest | GoManifest
   ```
2. Implement `unionManifests(manifests: ParsedManifest[]): MergeResult`:
   - Assert all manifests share same `ecosystem` (else return `err('ECOSYSTEM_MISMATCH')`).
   - Dispatch per ecosystem:
     - **npm**: merge `dependencies+devDependencies+peerDependencies` maps via `recordMerge`; scripts via `mergeScripts` helper (prefix on collision, see `P-112`); `engines` pick higher semver.
     - **python**: merge `dependencies` dict; extras union; `pythonVersion` pick higher (via pep440 compare).
     - **cargo**: merge `dependencies` (string vs object normalized); union `features`.
     - **go**: merge `require` maps; union `replace` (error if both define same old→different new).
   - For each key collision where values differ, push `Conflict{type:'version', package, values, severity:'error'}`.
   - For npm `peerDependencies` collisions, set `severity:'warning'` (handled in `P-110`).
3. Helper `recordMerge(a: Record<string,string>, b: Record<string,string>, sourceA: string, sourceB: string): { merged, conflicts }` — iterate b keys, if key in a and `a[key] !== b[key]` → conflict else merged[key]=value.
4. Export and run `bun run typecheck`; add unit tests.

**Required MCPs/Connectors:** None (pure merge logic)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `unionManifests([npmA, npmB])` where `react@^18` vs `react@^17` returns 1 conflict with `values:{'repo-a':'^18','repo-b':'^17'}` and `suggestedResolution` null (deferred to `P-109`)
- [ ] Mixed ecosystem input returns `ECOSYSTEM_MISMATCH` error
- [ ] Peer collisions marked `severity:'warning'` not `error`
- [ ] Merged manifest contains union of non-conflicting keys (e.g., `lodash` from A + `axios` from B)

**Tests Required:** `merge.test.ts`:
- `it('merges non-conflicting npm deps')`, `it('detects version conflict')`, `it('errors on ecosystem mismatch')`, `it('merges python extras')`, `it('merges go require with indirect preserved')`

**Dependencies:** P-107 (all parsers must exist to produce `ParsedManifest`)

**Handoff Notes:** Next: P-109 semver resolver will attempt to auto-resolve `version` conflicts where ranges intersect. `MergeResult.conflicts` is fed to UI panel (`P-219`).

---
### P-109: Deps — Semver Collision Resolver

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-108

**Context:** Many npm version conflicts are false positives — `^1.0.0` and `^1.2.3` intersect. This phase implements `resolveCollision` using `semver` to find an intersected range or determine impossibility, allowing auto-fix (`P-151`) to succeed without human input.

**Files to Create/Modify:**
- `packages/core/src/deps/semver.ts`
- `packages/core/src/deps/semver.test.ts`
- `packages/core/package.json` (ensure `semver` dep already in `P-019`)

**Implementation Steps:**
1. Create `packages/core/src/deps/semver.ts`:
   ```ts
   import semver from 'semver'
   export function resolveCollision(rangeA: string, rangeB: string): string | null {
     // Returns intersected range string or null if no overlap
   }
   export function maxSatisfying(versions: string[], range: string): string | null
   ```
2. Implement `resolveCollision`:
   - If `rangeA === rangeB` → return `rangeA`.
   - Use `semver.validRange` to validate; if invalid → return null and log warning.
   - Use `semver.intersects(rangeA, rangeB, true)` — if false → null.
   - If true, compute narrowest intersection: try `semver.subset`? Fallback: return `rangeA` if `semver.subset(rangeA, rangeB)` else `rangeB` if `subset(rangeB, rangeA)` else `${rangeA} ${rangeB}` (semver interprets space as AND).
   - Prerelease handling: pass `includePrerelease:true` only if either range contains prerelease.
3. Implement `maxSatisfying` for UI preview: given `versions` list (from npm registry stub), pick highest satisfying both ranges.
4. Unit test with `semver` fixtures and run `bun test`.

**Required MCPs/Connectors:** npm registry (optional for `maxSatisfying` demo; mocked via `nock`)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `resolveCollision('^1.0.0','^1.2.3')` → `'^1.2.3'` (or `'^1.0.0 ^1.2.3'` if narrowest logic) and `semver.intersects` true
- [ ] `resolveCollision('^1.0.0','^2.0.0')` → `null` (no overlap, major bump)
- [ ] Handles `*`, `>1.0`, `~1.2.3`, prerelease `1.0.0-beta.1`
- [ ] Invalid range returns `null` without throwing

**Tests Required:** `semver.test.ts`:
- `it('intersects compatible ranges')`, `it('returns null for major conflict')`, `it('handles wildcards')`, `it('handles prerelease')`, `it('returns null for invalid range')`

**Dependencies:** P-108 (needs `Conflict` objects to feed into resolver; `P-151` will call this)

**Handoff Notes:** Next: P-110 peer handling. `resolveCollision` will be called from `fix_dependency` auto-tool (`P-151`) and UI `DepsConflictPanel` (`P-219`) for suggested resolution preview.

---
### P-110: Deps — PeerDependency Conflict Handling

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-109

**Context:** `peerDependencies` are not installed automatically but indicate compatibility. A conflict like `react@18` (from A) vs `react@17` (from B) should warn, not block merge, but must surface to user. This phase classifies peer conflicts and suggests `overrides`/`resolutions` or `peerDependenciesMeta`.

**Files to Create/Modify:**
- `packages/core/src/deps/peer.ts`
- `packages/core/src/deps/peer.test.ts`
- `packages/core/src/deps/merge.ts` (update to call peer logic)

**Implementation Steps:**
1. Create `peer.ts`:
   ```ts
   export interface PeerConflict extends Conflict { peerSource: string }
   export function detectPeerConflicts(merged: NpmManifest, manifests: ParsedManifest[]): PeerConflict[]
   export function suggestPeerFix(conflict: PeerConflict): string // e.g., "add overrides: {react: '^18.0.0'}"
   ```
2. Implement `detectPeerConflicts`:
   - Collect all `peerDependencies` from A and B plus their `dependencies` (since peer must be satisfied by direct dep).
   - For each peer `pkg@range` required by A, check if B's `dependencies[peg]` satisfies range via `semver.satisfies`; if not, push conflict with `severity:'warning'`.
   - Special case: if both A and B peer same pkg but ranges don't intersect via `resolveCollision` → conflict.
3. Implement `suggestPeerFix`: if one side is `*` → suggest `peerDependenciesMeta: {pkg:{optional:true}}`; if ranges intersect partially → suggest `overrides` with intersected range; else suggest manual `peerDependenciesMeta`.
4. Integrate into `merge.ts`: after `recordMerge`, call `detectPeerConflicts` and append to `MergeResult.conflicts` with `type:'peer'`.

**Required MCPs/Connectors:** None (uses `semver` locally)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `react@18` in A `dependencies` satisfies `react@"^18"` peer from B → no conflict; `react@17` vs `react@"^18"` → warning conflict
- [ ] `suggestPeerFix` returns `overrides` suggestion for npm 8.3+ when intersect exists
- [ ] Peer conflicts have `severity:'warning'` not `error`, so `mergeResult` still considered mergeable
- [ ] Unit tests pass for peer optional (`*`) case

**Tests Required:** `peer.test.ts`:
- `it('no conflict when peer satisfied')`, `it('warns when peer unsatisfied')`, `it('suggests overrides when intersect')`

**Dependencies:** P-109 (needs `resolveCollision` for peer range intersect)

**Handoff Notes:** Next: P-111 dedupe strategy. Peer warnings will be shown in `P-219` Deps panel as yellow, not red.

---
### P-111: Deps — Dedupe/Nest Strategy

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-110

**Context:** When B requires `lodash@4.17.20` and A requires `lodash@4.17.21`, npm can hoist a single version (dedupe). When versions are incompatible, nesting (`node_modules/a/node_modules/lodash`) may be needed (legacy). This phase decides hoist vs nest and reports strategy, informing `P-114` lockfile regen and sandbox build.

**Files to Create/Modify:**
- `packages/core/src/deps/dedupe.ts`
- `packages/core/src/deps/dedupe.test.ts`

**Implementation Steps:**
1. Create `dedupe.ts`:
   ```ts
   export type DedupeStrategy = 'hoist' | 'nest' | 'error'
   export interface DedupeResult { strategy: DedupeStrategy; version: string; reason: string }
   export function chooseDedupeStrategy(versions: string[], requested: Record<string,string>): DedupeResult
   ```
2. Implement `chooseDedupeStrategy`:
   - Use `semver` to check if all requested ranges intersect: call `resolveCollision` iteratively across all ranges. If single intersected range exists and `maxSatisfying` from available `versions` (mock list `['4.17.20','4.17.21']`) satisfies → `strategy:'hoist'`, `version: maxSatisfying`.
   - If no intersect and `npm` version supports `overrides` (check `engines.npm` or default to npm 8) → still `hoist` with `overrides` suggestion; else `nest` (legacy) with warning.
   - If `peer` conflict involved → `nest` preferred.
   - Return `reason` string for report.
3. Integrate with `merge.ts`: for each `version` conflict where `resolveCollision` returned null, call `chooseDedupeStrategy` to set `suggestedResolution` and `dedupeStrategy`.
4. Add tests.

**Required MCPs/Connectors:** npm registry (mocked for available versions list)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `lodash@^4.17.20` + `lodash@^4.17.21` → `hoist` with `4.17.21`
- [ ] `react@17` + `react@18` (no intersect) → `nest` with reason "major version mismatch, requires nested node_modules"
- [ ] Peer-involved conflict → `nest` not `hoist`
- [ ] Result includes `reason` for `P-116` report

**Tests Required:** `dedupe.test.ts`:
- `it('hoists compatible patch versions')`, `it('nests major mismatch')`, `it('chooses overrides when npm supports')`

**Dependencies:** P-110 (needs peer classification to decide nest vs hoist)

**Handoff Notes:** Next: P-112 scripts merge. Dedupe strategy will be displayed in `P-116` report and used by `P-114` to decide `npm dedupe` vs legacy nesting.

---
### P-112: Deps — Scripts Merge

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-111

**Context:** `package.json` `scripts` often collide (`build`, `test`). Blindly overwriting loses one side's build pipeline. This phase merges scripts safely by prefixing collisions with `repo-a:` / `repo-b:` and preserving unique scripts, ensuring both repos' workflows remain runnable in C.

**Files to Create/Modify:**
- `packages/core/src/deps/scripts.ts`
- `packages/core/src/deps/scripts.test.ts`
- `packages/core/src/deps/merge.ts` (integrate)

**Implementation Steps:**
1. Create `scripts.ts`:
   ```ts
   export function mergeScripts(a: Record<string,string> | undefined, b: Record<string,string> | undefined, opts: { prefixA: string; prefixB: string }): { merged: Record<string,string>; conflicts: Conflict[] }
   ```
2. Logic:
   - `merged = { ...a }`
   - For each `k,v` in `b`: if `k` not in `merged` → `merged[k]=v`; else if `a[k]===v` → no conflict; else → `merged[`${prefixA}:${k}`]=a[k]`; `merged[`${prefixB}:${k}`]=v`; delete `merged[k]` and push `Conflict{type:'script', package:k, values:{'repo-a':a[k], 'repo-b':v}, severity:'warning'}`.
   - Preserve script order: unique scripts first, prefixed collisions after.
3. Integrate into `merge.ts` `unionManifests` for `ecosystem==='npm'` → call `mergeScripts` and merge conflicts into main list.
4. Handle `pre`/`post` hooks: if `build` collides, also check `prebuild`/`postbuild` similarly (same prefix logic).

**Required MCPs/Connectors:** None (local)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `a:{build:"tsc"}` + `b:{build:"vite build"}` → `merged:{'repo-a:build':"tsc",'repo-b:build':"vite build"}` + 1 script conflict warning
- [ ] `a:{test:"vitest"}` + `b:{test:"vitest"}` (same value) → no conflict, `merged:{test:"vitest"}`
- [ ] Unique scripts (`a:prepare`, `b:dev`) preserved without prefix
- [ ] `prebuild`/`postbuild` handled alongside `build`

**Tests Required:** `scripts.test.ts`:
- `it('prefixes colliding scripts')`, `it('keeps identical scripts')`, `it('preserves unique scripts')`, `it('handles pre/post hooks')`

**Dependencies:** P-111 (dedupe must decide before scripts; scripts merge is independent but ordering ensures version logic runs first)

**Handoff Notes:** Next: P-113 config files merge. Script prefix names (`repo-a`, `repo-b`) are derived from actual repo names (slugified) in `P-108`, not hardcoded.

---
### P-113: Deps — Config Files Merge

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-112

**Context:** Beyond `package.json`, repos have `tsconfig.json`, `vite.config.ts`, `eslint.config.mjs` that may conflict (e.g., different `compilerOptions.target` or `plugins`). This phase deep-merges JSON configs with conflict detection, producing a merged config that extends both via `extends` array where possible, else reports conflict for AI/human to resolve.

**Files to Create/Modify:**
- `packages/core/src/deps/config.ts`
- `packages/core/src/deps/config.test.ts`
- `packages/core/src/deps/merge.ts` (hook)

**Implementation Steps:**
1. Create `config.ts`:
   ```ts
   export interface ConfigMergeResult { merged: unknown; conflicts: Conflict[] }
   export function mergeTsConfig(a: unknown, b: unknown): ConfigMergeResult
   export function mergeViteConfig(a: unknown, b: unknown): ConfigMergeResult
   export function mergeEslintConfig(a: unknown, b: unknown): ConfigMergeResult
   export function mergeGenericJson(a: unknown, b: unknown, path: string): ConfigMergeResult
   ```
2. Implement `mergeTsConfig`:
   - If both have `extends` (string or array) → `merged.extends = [...new Set([...asArray(a.extends), ...asArray(b.extends)])]`.
   - Deep merge `compilerOptions`: for each key, if values equal → keep; else if `target`/`module` conflict → push `Conflict{type:'config', package:'tsconfig.compilerOptions.target', values:{'repo-a':a.target,'repo-b':b.target}}` and pick higher (`esnext` > `es2020` > `es2018`).
   - Preserve `references`, `include`, `exclude` via union.
3. Implement `mergeViteConfig` similarly: merge `plugins` array concat + dedupe by plugin name; `build` options deep merge.
4. Implement `mergeEslintConfig`: merge `rules` (if same rule different severity → conflict), `plugins` union.
5. Generic `mergeGenericJson`: recursive deep merge; primitive collision → conflict; object → recurse; array → union if primitives else conflict.
6. Unit tests with fixtures.

**Required MCPs/Connectors:** None (local JSON merging; no FS yet — caller reads files via `fs-extra` in `P-114`)

**Skills to Invoke:** None

**Acceptance Criteria:**
- [ ] `tsconfig` with `target:es2020` vs `target:esnext` → conflict + merged `extends` union, `target` conflict reported with both values
- [ ] `vite.config` plugins concat and deduped by name
- [ ] `eslint` rules merge where same rule different value → conflict
- [ ] Generic deep merge handles nested objects and preserves non-conflicting keys

**Tests Required:** `config.test.ts`:
- `it('merges tsconfig extends')`, `it('detects compilerOptions conflict')`, `it('merges vite plugins')`, `it('generic deep merge')`

**Dependencies:** P-112 (scripts merge must complete before config; both are part of manifest merge sequence)

**Handoff Notes:** Next: P-114 lockfile regeneration. Config merge conflicts are `type:'config'` and will be shown in `P-116` report and `P-219` UI. `P-152` `edit_config` tool can auto-apply merged config if `severity:'warning'`.

---
### P-114: Deps — Lockfile Regeneration



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-113



**Context:** Dependency merging is the core of repo-stitcher. This phase handles parsing and merging of manifests for a specific ecosystem, ensuring version collisions are detected and resolvable before sandbox verification. Phase P-114 focuses on `Lockfile Regeneration` and depends on P-113 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/deps/lockfile.ts`



**Implementation Steps:**

- `regenerateLockfile(manifest, ecosystem)` — runs `bun install`, `pip compile`, `cargo generate-lockfile`, `go mod tidy`

- Returns path to lockfile or error



**Required MCPs/Connectors:** None (local file parsing)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Parses `Lockfile Regeneration` correctly for fixtures (including edge cases like comments, wildcards, and missing fields)

- [ ] Returns typed `ParsedManifest` with Result<T,E> and maps errors to `StitchError`

- [ ] Integrates with `merge.ts` union logic without breaking existing ecosystems

- [ ] Unit tests cover normal + malformed inputs with 80%+ coverage



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-113 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-115 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-115: Deps — Ecosystem Plugin Interface



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-114



**Context:** Dependency merging is the core of repo-stitcher. This phase handles parsing and merging of manifests for a specific ecosystem, ensuring version collisions are detected and resolvable before sandbox verification. Phase P-115 focuses on `Ecosystem Plugin Interface` and depends on P-114 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (local file parsing)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Parses `Ecosystem Plugin Interface` correctly for fixtures (including edge cases like comments, wildcards, and missing fields)

- [ ] Returns typed `ParsedManifest` with Result<T,E> and maps errors to `StitchError`

- [ ] Integrates with `merge.ts` union logic without breaking existing ecosystems

- [ ] Unit tests cover normal + malformed inputs with 80%+ coverage



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-114 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-116 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-116: Deps — Deps Report (JSON)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-115



**Context:** Dependency merging is the core of repo-stitcher. This phase handles parsing and merging of manifests for a specific ecosystem, ensuring version collisions are detected and resolvable before sandbox verification. Phase P-116 focuses on `Deps Report (JSON)` and depends on P-115 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/deps/report.ts`



**Implementation Steps:**

```ts

export function generateDepReport(result: MergeResult): DependencyReport

```

- Includes: merged deps, conflicts, resolutions, lockfile status



**Required MCPs/Connectors:** None (local file parsing)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Parses `Deps Report (JSON)` correctly for fixtures (including edge cases like comments, wildcards, and missing fields)

- [ ] Returns typed `ParsedManifest` with Result<T,E> and maps errors to `StitchError`

- [ ] Integrates with `merge.ts` union logic without breaking existing ecosystems

- [ ] Unit tests cover normal + malformed inputs with 80%+ coverage



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-115 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-117 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-117: Deps — Tests with Fixtures



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-116



**Context:** Dependency merging is the core of repo-stitcher. This phase handles parsing and merging of manifests for a specific ecosystem, ensuring version collisions are detected and resolvable before sandbox verification. Phase P-117 focuses on `Tests with Fixtures` and depends on P-116 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/deps/__tests__/*.test.ts`



**Implementation Steps:**

- Fixture manifests for each ecosystem

- Test collision scenarios

- Test merge output validity



**Required MCPs/Connectors:** None (local file parsing)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Parses `Tests with Fixtures` correctly for fixtures (including edge cases like comments, wildcards, and missing fields)

- [ ] Returns typed `ParsedManifest` with Result<T,E> and maps errors to `StitchError`

- [ ] Integrates with `merge.ts` union logic without breaking existing ecosystems

- [ ] Unit tests cover normal + malformed inputs with 80%+ coverage



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-116 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-118 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-118: License — Scan Declared Licenses



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-117



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-118 focuses on `Scan Declared Licenses` and depends on P-117 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-117 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-119 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-119: License — SPDX Normalize



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-118



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-119 focuses on `SPDX Normalize` and depends on P-118 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-118 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-120 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-120: License — Compatibility Matrix



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-119



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-120 focuses on `Compatibility Matrix` and depends on P-119 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-119 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-121 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-121: License — GPL/AGPL Warning



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-120



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-121 focuses on `GPL/AGPL Warning` and depends on P-120 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/gpl.ts`



**Implementation Steps:**

- Special handling for GPL family

- Checks if GPL code links with non-GPL (static/dynamic linking)

- For JS/TS: any GPL in deps = warning (conservative)

- Generates actionable remediation suggestions



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-120 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-122 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-122: License — Dual-License Handling



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-121



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-122 focuses on `Dual-License Handling` and depends on P-121 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/dual.ts`



**Implementation Steps:**

- Parse `MIT OR Apache-2.0` expressions

- Choose most permissive compatible option

- Report both options



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-121 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-123 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-123: License — Unknown Detection



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-122



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-123 focuses on `Unknown Detection` and depends on P-122 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/unknown.ts`



**Implementation Steps:**

- Flag packages with `UNKNOWN` or non-SPDX licenses

- Require human decision (policy: allow/deny)

- Suggest checking LICENSE file manually



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-122 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-124 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-124: License — Per-File Header Scan (ScanCode Opt-in)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-123



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-124 focuses on `Per-File Header Scan (ScanCode Opt-in)` and depends on P-123 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/deepScan.ts`



**Implementation Steps:**

```ts

export async function runScanCode(repoPath: string): Promise<Result<DeepScanResult, StitchError>>

```

- Shells out to `scancode-toolkit` (Python)

- Only runs if `config.licensePolicy.deepScan === true`

- Parses JSON output → per-file license/copyright



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-123 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-125 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-125: License — Generate LICENSE for C



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-124



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-125 focuses on `Generate LICENSE for C` and depends on P-124 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/generate.ts`



**Implementation Steps:**

- Based on compatibility result, choose output license

- If all permissive → MIT

- If any copyleft → must match strongest copyleft

- Write LICENSE file to child repo



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-124 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-126 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-126: License — NOTICE/Attribution



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-125



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-126 focuses on `NOTICE/Attribution` and depends on P-125 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/notice.ts`



**Implementation Steps:**

- Generate NOTICE file with all attributions

- Required for Apache-2.0, BSD, etc.

- Format: `This product includes <pkg> (<license>) from <source>`



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-125 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-127 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-127: License — Policy Allow/Deny



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-126



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-127 focuses on `Policy Allow/Deny` and depends on P-126 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/policy.ts`



**Implementation Steps:**

- Load policy from config (allow[], warn[], deny[])

- `evaluate(report, policy)` → `{ allowed, warnings, denied }`

- Deny = block merge unless overridden



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-126 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-128 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-128: License — License Report Data



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-127



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-128 focuses on `License Report Data` and depends on P-127 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/report.ts`



**Implementation Steps:**

- Generate structured `LicenseReport` for UI

- Includes: per-package table, compatibility matrix, policy verdict



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-127 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-129 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-129: License — Deep-Scan Plugin



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-128



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-129 focuses on `Deep-Scan Plugin` and depends on P-128 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/plugin.ts`



**Implementation Steps:**

- Plugin interface for alternative scanners

- ScanCode is default implementation

- Allows future: FOSSA, Snyk, etc.



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-128 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-130 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-130: License — Tests



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-129



**Context:** License compliance is a hard gate for repository composition. This phase scans declared licenses, normalizes SPDX expressions, and enforces policy before child repo C is created. Phase P-130 focuses on `Tests` and depends on P-129 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/license/__tests__/*.test.ts`



**Implementation Steps:**

- Fixture repos with known licenses

- Test GPL detection, SPDX normalization, policy evaluation



**Required MCPs/Connectors:** None (local scanning via spdx-* and license-checker)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Scans declared licenses and normalizes to SPDX IDs via `spdx-correct`

- [ ] Flags incompatible combinations per compatibility matrix (GPL/AGPL warnings)

- [ ] Returns structured `LicenseReport` with policy decision (allow/deny)

- [ ] Tests include fixtures with dual-license, unknown, and per-file headers



**Tests Required:** Unit tests with fixture repos of each type; property tests for merge/compat logic; coverage gates enforced via `bun test --coverage`.



**Dependencies:** P-129 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-131 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-131: AI Provider — ChatProvider Interface



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-130



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-131 focuses on `ChatProvider Interface` and depends on P-130 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-130 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-132 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-132: AI Provider — OpenAICompatibleProvider



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-131



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-132 focuses on `OpenAICompatibleProvider` and depends on P-131 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/openaiCompatible.ts`



**Implementation Steps:**

- Wraps `openai` SDK

- Base URL configurable (OpenRouter, OpenAI, Ollama)

- Normalizes tool calling to internal format

- Handles streaming responses



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-131 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-133 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-133: AI Provider — AnthropicProvider



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-132



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-133 focuses on `AnthropicProvider` and depends on P-132 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/anthropic.ts`



**Implementation Steps:**

- Wraps `@anthropic-ai/sdk`

- Converts Anthropic tool format ↔ internal format

- Handles `tool_use` / `tool_result` blocks



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-132 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-134 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-134: AI Provider — Provider Registry + Config



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-133



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-134 focuses on `Provider Registry + Config` and depends on P-133 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/registry.ts`



**Implementation Steps:**

```ts

export function createProvider(config: ProviderConfig): ChatProvider

export const providerRegistry = new Map<string, () => ChatProvider>()

```

- Reads config (provider, model, apiKey, baseUrl)

- Instantiates correct provider



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-133 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-135 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-135: AI Provider — Model Registry



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-134



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-135 focuses on `Model Registry` and depends on P-134 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/models.ts`



**Implementation Steps:**

- `models.json` with ModelSpec (id, provider, contextWindow, supportsTools, maxOutput, cost, recommendedFor)

- `getModel(id)` → ModelSpec

- `getRecommendedFor(task)` → best model



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-134 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-136 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-136: AI Provider — Streaming Support



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-135



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-136 focuses on `Streaming Support` and depends on P-135 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/stream.ts`



**Implementation Steps:**

- `streamChat(provider, messages, tools)` → AsyncIterable<ReasoningChunk>

- Buffers tool calls across chunks

- Emits `reasoning` events for WS



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-135 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-137 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-137: AI Provider — Token/Cost Estimate



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-136



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-137 focuses on `Token/Cost Estimate` and depends on P-136 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/cost.ts`



**Implementation Steps:**

- `estimateCost(messages, model)` → `{ promptTokens, estimatedCompletionTokens, costUSD }`

- Per-job budget tracking (default 500k tokens)

- Warns at 80%, aborts at 100%



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-136 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-138 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-138: AI Provider — Retry/Backoff



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-137



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-138 focuses on `Retry/Backoff` and depends on P-137 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/retry.ts`



**Implementation Steps:**

- Exponential backoff for 429, 5xx

- Respects `Retry-After` header

- Max 3 retries



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-137 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-139 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-139: AI Provider — Zod→JSON Tool Adapter



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-138



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-139 focuses on `Zod→JSON Tool Adapter` and depends on P-138 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/toolAdapter.ts`



**Implementation Steps:**

```ts

import { zodToJsonSchema } from 'zod-to-json-schema'



export function toolSchemaFromZod(zodSchema: z.ZodTypeAny): ToolSchema

```

- Converts Zod schemas to JSON Schema for tool definitions

- Used by all tool definitions



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-138 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-140 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-140: AI Provider — Tool-Loop Executor



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-139



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-140 focuses on `Tool-Loop Executor` and depends on P-139 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/loop.ts`



**Implementation Steps:**

```ts

export async function runAgentLoop(input: AgentInput, tools: Tool[], policy: AutonomyPolicy): Promise<AgentOutput>

```

- Multi-turn loop: prompt → tool calls → execute → results → repeat

- Handles tool call batching

- Enforces autonomy policy (auto vs gated)



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-139 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-141 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-141: AI Provider — Prompt Templates



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-140



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-141 focuses on `Prompt Templates` and depends on P-140 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/prompts.ts`



**Implementation Steps:**

- System prompt for stitch agent

- Task-specific prompts (select, resolve, detect, propose)

- Context injection (repo trees, manifests, gaps)



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-140 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-142 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-142: AI Provider — Context Window Management



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-141



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-142 focuses on `Context Window Management` and depends on P-141 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/context.ts`



**Implementation Steps:**

- `buildContext(repoTree, selection, gaps, maxTokens)` → token-budgeted context

- Summarizes large trees (keep file names, drop content)

- Prioritizes: user selection → gaps → deps → config



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-141 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-143 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-143: AI Provider — Block Gemini-3 Tool-Calling Default



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-142



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-143 focuses on `Block Gemini-3 Tool-Calling Default` and depends on P-142 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/models.ts` (add to ModelSpec)



**Implementation Steps:**

- Mark Gemini 3 models as `supportsTools: false` for OpenRouter

- Document in model registry

- Default agent model: `anthropic/claude-3.5-sonnet`



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-142 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-144 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-144: AI Provider — Mock Provider



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-143



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-144 focuses on `Mock Provider` and depends on P-143 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/mock.ts`



**Implementation Steps:**

- `MockProvider` implements `ChatProvider`

- Returns canned responses for testing

- Simulates tool calls, delays, errors



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-143 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-145 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-145: AI Provider — AI Call Audit Log



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-144



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-145 focuses on `AI Call Audit Log` and depends on P-144 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/audit.ts`



**Implementation Steps:**

- Log every AI call: provider, model, tokens, cost, duration

- Store in SQLite `provider_usage` table

- Redact prompt content (keep structure only)



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-144 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-146 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-146: AI Provider — Runtime Provider Switch



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-145



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-146 focuses on `Runtime Provider Switch` and depends on P-145 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/switch.ts`



**Implementation Steps:**

- `setProvider(config)` — hot-swap without restart

- Web UI setting triggers this

- Validates new provider works (test call)



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-145 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-147 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-147: AI Provider — Loop Tests



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-146



**Context:** Multi-provider AI is required for resilient stitching. This phase implements the provider abstraction for OpenRouter/OpenAI/Anthropic/Ollama, including streaming, retries, and structured JSON tool calls. Phase P-147 focuses on `Loop Tests` and depends on P-146 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/__tests__/*.test.ts`



**Implementation Steps:**

- Test tool loop with MockProvider

- Test autonomy policy (auto vs gated)

- Test context budgeting

- Test error handling



**Required MCPs/Connectors:** OpenRouter API, Anthropic API (for testing), Ollama local (optional)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `ChatProvider` interface with streaming support and token/cost estimation

- [ ] Handles retries/backoff and maps provider errors to `StitchError`

- [ ] Passes Zod+JSON tool adapter validation for structured calls

- [ ] Mock provider enables offline tests without network



**Tests Required:** Unit tests with MockProvider; integration tests mock OpenRouter/Anthropic via nock; tool-loop tests verify Zod validation and retry/backoff.



**Dependencies:** P-146 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-148 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-148: Agent Tools — select_files



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-147



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-148 focuses on `select_files` and depends on P-147 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-147 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-149 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-149: Agent Tools — resolve_dependency_closure



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-148



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-149 focuses on `resolve_dependency_closure` and depends on P-148 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/tools/resolveDeps.ts`



**Implementation Steps:**

- Input: selected files

- Uses tree-sitter/dependency-cruiser to find imports

- Returns transitive closure of required files



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-148 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-150 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-150: Agent Tools — detect_gaps



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-149



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-150 focuses on `detect_gaps` and depends on P-149 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/tools/detectGaps.ts`



**Implementation Steps:**

- Analyzes merged tree for:

  - Broken imports (missing files)

  - Conflicting entrypoints (two `main` exports)

  - Missing config (tsconfig, eslint, etc.)

  - Duplicate symbols

- Returns structured `Gap[]`



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-149 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-151 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-151: Agent Tools — fix_dependency (auto)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-150



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-151 focuses on `fix_dependency (auto)` and depends on P-150 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/tools/fixDeps.ts`



**Implementation Steps:**

- Auto-executed tool

- Edits manifest to resolve version collisions

- Uses `resolveCollision` from deps merge



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-150 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-152 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-152: Agent Tools — edit_config (auto)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-151



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-152 focuses on `edit_config (auto)` and depends on P-151 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/tools/editConfig.ts`



**Implementation Steps:**

- Auto-executed

- Merges tsconfig, eslint, vite configs

- Uses config merge logic from deps



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-151 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-153 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-153: Agent Tools — move_file (auto)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-152



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-153 focuses on `move_file (auto)` and depends on P-152 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/tools/moveFile.ts`



**Implementation Steps:**

- Auto-executed

- Relocates files to avoid path collisions

- Updates imports in moved files (tree-sitter)



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-152 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-154 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-154: Agent Tools — propose_component (gated)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-153



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-154 focuses on `propose_component (gated)` and depends on P-153 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-153 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-155 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-155: Agent Tools — run_build (sandbox)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-154



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-155 focuses on `run_build (sandbox)` and depends on P-154 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/tools/runBuild.ts`



**Implementation Steps:**

- Triggers sandbox build/test

- Returns `SandboxResult` (pass/fail, logs)

- Auto-retries on flaky failures



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-154 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-156 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-156: Agent Tools — ask_user



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-155



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-156 focuses on `ask_user` and depends on P-155 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/tools/askUser.ts`



**Implementation Steps:**

- Clarification questions (e.g., "Which entrypoint should be main?")

- Emits `question` event → UI prompt

- Returns user answer



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-155 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-157 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-157: Agent Tools — Autonomy Policy Engine



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-156



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-157 focuses on `Autonomy Policy Engine` and depends on P-156 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-156 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-158 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-158: Agent Tools — Tool Result Validation



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-157



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-158 focuses on `Tool Result Validation` and depends on P-157 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/validation.ts`



**Implementation Steps:**

- Validates tool output against schema

- Rejects malformed results

- Retries with corrected prompt



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-157 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-159 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-159: Agent Tools — Agent State Machine



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-158



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-159 focuses on `Agent State Machine` and depends on P-158 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/stateMachine.ts`



**Implementation Steps:**

- States: `planning` → `acting` → `verifying` → `complete`|`failed`

- Transitions on tool results

- Max iterations guard (default 25)



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-158 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-160 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-160: Agent Tools — HIL Approval Queue



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-159



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-160 focuses on `HIL Approval Queue` and depends on P-159 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/approvalQueue.ts`



**Implementation Steps:**

- Queue for gated tools awaiting human decision

- `submit(proposal)` → returns promise resolving on approve/reject

- Timeout handling (default 30 min → auto-reject)



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-159 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-161 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-161: Agent Tools — Revert a Tool Action



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-160



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-161 focuses on `Revert a Tool Action` and depends on P-160 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/revert.ts`



**Implementation Steps:**

- `revert(toolCallId)` — undoes file writes, config changes

- Uses git stash/snapshots

- Logged in audit trail



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-160 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-162 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-162: Agent Tools — Reasoning Stream



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-161



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-162 focuses on `Reasoning Stream` and depends on P-161 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/reasoning.ts`



**Implementation Steps:**

- Captures AI "thinking" between tool calls

- Streams as `reasoning` events via WS

- UI renders as live markdown



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-161 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-163 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-163: Agent Tools — Error Handling



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-162



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-163 focuses on `Error Handling` and depends on P-162 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/errors.ts`



**Implementation Steps:**

- Maps tool errors to `StitchError`

- Retry logic for transient failures

- Escalates to `ask_user` on repeated failure



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-162 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-164 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-164: Agent Tools — Loop Cap



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-163



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-164 focuses on `Loop Cap` and depends on P-163 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/loopCap.ts`



**Implementation Steps:**

- Hard cap: 25 iterations per job

- Configurable via policy

- On cap: emit `error`, pause job



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-163 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-165 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-165: Agent Tools — Git-Core Integration



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-164



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-165 focuses on `Git-Core Integration` and depends on P-164 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/gitIntegration.ts`



**Implementation Steps:**

- Tool handlers call `writeFileToWorktree`, `commitWithTrailers`

- Uses git core functions directly

- Maintains provenance mapping



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-164 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-166 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-166: Agent Tools — Deps/License Integration



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-165



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-166 focuses on `Deps/License Integration` and depends on P-165 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/depsLicenseIntegration.ts`



**Implementation Steps:**

- `fix_dependency` calls deps merge resolution

- `propose_component` checks license of generated code

- Sandbox runs license scan



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-165 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-167 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-167: Agent Tools — E2E Agent Test



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-166



**Context:** Agent tools give the LLM controlled access to filesystem, deps, and build. This phase implements one tool plus its autonomy policy, ensuring auto-fixes are safe and gated proposals require human approval. Phase P-167 focuses on `E2E Agent Test` and depends on P-166 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/__tests__/e2e.test.ts`



**Implementation Steps:**

- Full agent loop on fixture repos

- Verify auto fixes apply, gated proposals appear

- Verify sandbox runs



**Required MCPs/Connectors:** None (local tool execution, sandbox for run_build)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tool executes with validation and returns typed `ToolResult` (success/error)

- [ ] Respects autonomy policy (auto vs gated) and logs to audit trail

- [ ] Reverts cleanly via snapshot/stash if requested

- [ ] Integration test shows tool participates in agent loop without exceeding loop cap



**Tests Required:** Unit tests mock filesystem/git; integration test runs full agent loop on fixture repos; verify auto vs gated behavior and revert.



**Dependencies:** P-166 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-168 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-168: Sandbox — Docker Client



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-167



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-168 focuses on `Docker Client` and depends on P-167 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/docker.ts`



**Implementation Steps:**

```ts

import Docker from 'dockerode'



export const docker = new Docker({ socketPath: process.env.DOCKER_HOST || '/var/run/docker.sock' })

export async function ensureImage(image: string): Promise<void>

```



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-167 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-169 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-169: Sandbox — Ephemeral Image per Ecosystem



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-168



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-169 focuses on `Ephemeral Image per Ecosystem` and depends on P-168 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/images.ts`



**Implementation Steps:**

- Map ecosystem → image tag

- `getSandboxImage(ecosystem)` → tag

- Pull if missing



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-168 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-170 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-170: Sandbox — Install Deps



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-169



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-170 focuses on `Install Deps` and depends on P-169 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/install.ts`



**Implementation Steps:**

- `runInstall(container, ecosystem, workdir)`

- Commands: `bun install`, `pip install -r requirements.txt`, `cargo build`, `go mod download`



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-169 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-171 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-171: Sandbox — Run Build



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-170



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-171 focuses on `Run Build` and depends on P-170 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/build.ts`



**Implementation Steps:**

- `runBuild(container, ecosystem, workdir)`

- Detects build script from manifest

- Runs in container



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-170 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-172 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-172: Sandbox — Run Tests



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-171



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-172 focuses on `Run Tests` and depends on P-171 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/test.ts`



**Implementation Steps:**

- `runTests(container, ecosystem, workdir)`

- Commands: `bun test`, `pytest`, `cargo test`, `go test ./...`

- Parses output for pass/fail



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-171 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-173 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-173: Sandbox — Capture Logs/Artifacts



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-172



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-173 focuses on `Capture Logs/Artifacts` and depends on P-172 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/logs.ts`



**Implementation Steps:**

- Streams stdout/stderr to job events

- Captures last 10MB per step

- Saves artifacts (coverage, build output) to job output



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-172 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-174 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-174: Sandbox — Timeout/Limits



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-173



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-174 focuses on `Timeout/Limits` and depends on P-173 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/limits.ts`



**Implementation Steps:**

- Enforces: memory, CPU, pids, wall time

- Kills container on limit exceeded

- Returns `SandboxError` with limit type



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-173 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-175 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-175: Sandbox — GH Actions Fallback



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-174



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-175 focuses on `GH Actions Fallback` and depends on P-174 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/fallback.ts`



**Implementation Steps:**

- If Docker unavailable, dispatch `stitch-sandbox.yml`

- Polls workflow run via Octokit

- Returns same `SandboxResult` interface



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-174 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-176 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-176: Sandbox — Pass/Fail + Flaky Detection



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-175



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-176 focuses on `Pass/Fail + Flaky Detection` and depends on P-175 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/result.ts`



**Implementation Steps:**

- `SandboxResult`: `{ passed: boolean, logs: string, flaky: boolean, retries: number }`

- Re-runs failed tests once (configurable)

- Marks flaky if passes on retry



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-175 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-177 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-177: Sandbox — Cleanup



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-176



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-177 focuses on `Cleanup` and depends on P-176 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/cleanup.ts`



**Implementation Steps:**

- `cleanup(container)` — stop + remove

- Removes temp volumes

- Runs on success, failure, timeout



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-176 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-178 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-178: Sandbox — Layer Cache



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-177



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-178 focuses on `Layer Cache` and depends on P-177 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/cache.ts`



**Implementation Steps:**

- Docker layer caching via base images

- Volume cache for `node_modules`, `target`, `.cargo`

- Keyed by lockfile hash



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-177 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-179 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-179: Sandbox — Secret-Safe Sandbox



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-178



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-179 focuses on `Secret-Safe Sandbox` and depends on P-178 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/security.ts`



**Implementation Steps:**

- Hardened container config (SECURITY.md §4.1)

- No network, read-only rootfs, no caps

- Non-root user



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-178 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-180 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-180: Sandbox — Tests



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-179



**Context:** Sandbox verification proves that merged repo C actually builds and tests pass. This phase implements Docker-based isolation with per-ecosystem images and GH Actions fallback. Phase P-180 focuses on `Tests` and depends on P-179 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/__tests__/*.test.ts`



**Implementation Steps:**

- Test each ecosystem build+test

- Test Docker unavailable → GH Actions fallback

- Test limit enforcement



**Required MCPs/Connectors:** Docker daemon (dockerode), GitHub Actions API (fallback)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Spins up ephemeral per-ecosystem container with resource limits (2 CPU, 4GB, 30 min timeout)

- [ ] Captures logs/artifacts and reports pass/fail with flaky detection

- [ ] Cleans up containers even on failure/cancel

- [ ] Falls back to GH Actions trigger when Docker unavailable



**Tests Required:** Unit tests mock dockerode; integration tests run real container for Node/Python only on CI; verify fallback to GH Actions when Docker unavailable.



**Dependencies:** P-179 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-181 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-181: Provenance — Track Source Repo/Commit/Author per File



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-180



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-181 focuses on `Track Source Repo/Commit/Author per File` and depends on P-180 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/track.ts`



**Implementation Steps:**

- Uses `mapBlame` from git core

- Builds `ProvenanceEntry[]` for all files in child repo

- Stores in job output



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-180 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-182 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-182: Provenance — CREDITS.md



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-181



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-182 focuses on `CREDITS.md` and depends on P-181 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/credits.ts`



**Implementation Steps:**

```ts

export function generateCredits(entries: ProvenanceEntry[]): string

```

- Markdown table: `Path | Source Repo | Commit | Author | Date | License`

- Written to child repo root



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-181 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-183 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-183: Provenance — SBOM (CycloneDX/SPDX)



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-182



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-183 focuses on `SBOM (CycloneDX/SPDX)` and depends on P-182 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/sbom.ts`



**Implementation Steps:**

- Generates CycloneDX JSON

- Components = source repos + dependencies

- Includes licenses, hashes, provenance



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-182 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-184 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-184: Provenance — Git Notes



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-183



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-184 focuses on `Git Notes` and depends on P-183 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/gitNotes.ts`



**Implementation Steps:**

```ts

export async function attachProvenanceNotes(repoPath: string, entries: ProvenanceEntry[]): Promise<void>

```

- `git notes add -f -m '<json>' <file>` for each file

- Machine-readable, travels with repo



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-183 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-185 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-185: Provenance — UI Provenance View



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-184



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-185 focuses on `UI Provenance View` and depends on P-184 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/uiView.ts`



**Implementation Steps:**

- Data structure for web UI provenance panel

- File tree with origin badges

- Commit link to GitHub



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-184 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-186 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-186: Provenance — Checksum Manifest



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-185



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-186 focuses on `Checksum Manifest` and depends on P-185 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/manifest.ts`



**Implementation Steps:**

- SHA256 of every file in child repo

- `MANIFEST.sha256` file

- Used for integrity verification



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-185 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-187 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-187: Provenance — Audit Log



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-186



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-187 focuses on `Audit Log` and depends on P-186 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/audit.ts`



**Implementation Steps:**

- Structured audit event per job

- Includes: parent repos, child repo, license verdict, AI usage, sandbox result

- Written to stdout + SQLite



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-186 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-188 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-188: Provenance — Tests



**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-187



**Context:** Provenance tracking ensures every file in child repo C can be traced to origin repo/commit/author. Required for CREDITS.md, SBOM, and audit compliance. Phase P-188 focuses on `Tests` and depends on P-187 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/provenance/__tests__/*.test.ts`



**Implementation Steps:**

- Verify CREDITS.md format

- Verify SBOM validity (CycloneDX schema)

- Verify git notes attach/read



**Required MCPs/Connectors:** None (git blame/notes local)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tracks source repo/commit/author per file via git blame + provenance map

- [ ] Generates CREDITS.md and CycloneDX/SPDX SBOM for child repo C

- [ ] Writes git notes and checksum manifest for audit

- [ ] UI provenance view renders correctly in web detail page



**Tests Required:** Unit tests verify blame→map logic; integration test generates CREDITS/SBOM on fixture merge and validates checksum manifest.



**Dependencies:** P-187 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-189 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-189: CLI — Commander + Global Options



**Owner:** aradhy | **Wave:** 1 (post-handoff) | **Depends On:** Wave 0 complete (P-317)



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-189 focuses on `Commander + Global Options` and depends on Wave 0 complete (P-317) completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** Wave 0 complete (P-317) must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-190 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-190: CLI — stitch init



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-189



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-190 focuses on `stitch init` and depends on P-189 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-189 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-191 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-191: CLI — stitch add <repo> <paths...>



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-190



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-191 focuses on `stitch add <repo> <paths...>` and depends on P-190 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-190 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-192 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-192: CLI — stitch merge



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-191



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-192 focuses on `stitch merge` and depends on P-191 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-191 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-193 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-193: CLI — stitch serve (Elysia)



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-192



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-193 focuses on `stitch serve (Elysia)` and depends on P-192 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-192 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-194 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-194: CLI — stitch status



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-193



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-194 focuses on `stitch status` and depends on P-193 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-193 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-195 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-195: CLI — stitch doctor



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-194



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-195 focuses on `stitch doctor` and depends on P-194 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/commands/doctor.ts` (moved from P-068)



**Implementation Steps:**

- Already implemented in P-068, now wired as CLI command

- Checks: git, git-filter-repo, docker, bun, python

- Output: ✅/❌ with install hints



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-194 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-196 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-196: CLI — stitch license



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-195



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-196 focuses on `stitch license` and depends on P-195 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-195 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-197 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-197: CLI — stitch deps



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-196



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-197 focuses on `stitch deps` and depends on P-196 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-196 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-198 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-198: CLI — Ink Interactive Picker



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-197



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-198 focuses on `Ink Interactive Picker` and depends on P-197 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/cli/src/ui/RepoPicker.tsx`

- `packages/cli/src/ui/PathSelector.tsx`

- `packages/cli/src/ui/Progress.tsx`



**Implementation Steps:**

- `RepoPicker`: searchable list from GitHub API (debounced)

- `PathSelector`: checkbox tree with dependency closure toggle

- `Progress`: multi-step bar with substep detail



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-197 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-199 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-199: CLI — Progress Rendering



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-198



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-199 focuses on `Progress Rendering` and depends on P-198 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/ui/Progress.tsx` (continued)



**Implementation Steps:**

- Live progress for each pipeline step

- Sub-step spinner

- ETA estimation



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-198 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-200 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-200: CLI — ~/.stitch Config Store



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-199



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-200 focuses on `~/.stitch Config Store` and depends on P-199 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/config/store.ts`



**Implementation Steps:**

- Uses `configstore` (encrypted)

- `get(key)`, `set(key, value)`, `delete(key)`

- Keys: github.auth, openrouter.apiKey, anthropic.apiKey, ollama.baseUrl



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-199 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-201 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-201: CLI — Error UX



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-200



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-201 focuses on `Error UX` and depends on P-200 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/ui/errors.tsx`



**Implementation Steps:**

- Pretty error panels (ink)

- Actionable suggestions

- Links to docs



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-200 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-202 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-202: CLI — Help



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-201



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-202 focuses on `Help` and depends on P-201 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/commands/help.ts`



**Implementation Steps:**

- Custom help command with examples

- `stitch help <command>` for subcommand help



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-201 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-203 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-203: CLI — Autocomplete



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-202



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-203 focuses on `Autocomplete` and depends on P-202 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/commands/completion.ts`



**Implementation Steps:**

- `stitch completion bash|zsh|fish` → prints script

- Command/option completion

- Repo name completion (from GitHub API cache)



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-202 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-204 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-204: CLI — Integration Tests



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-203



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-204 focuses on `Integration Tests` and depends on P-203 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/__tests__/integration.test.ts`



**Implementation Steps:**

- Test full `stitch add → merge` flow

- Mock GitHub API, Docker

- Test error paths



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-203 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-205 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-205: CLI — Windows Path Handling



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-204



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-205 focuses on `Windows Path Handling` and depends on P-204 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/util/paths.ts`



**Implementation Steps:**

- `path.resolve` with `\\?\` prefix for long paths

- Forward slashes for git/filter-repo args

- Test on Windows CI



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-204 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-206 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-206: CLI — Theme



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-205



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-206 focuses on `Theme` and depends on P-205 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/ui/theme.ts`



**Implementation Steps:**

- Color scheme for ink components

- Respects `--no-color` and `NO_COLOR` env



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-205 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-207 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-207: CLI — Release Binary Build



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-206



**Context:** CLI is the primary interface for stitch operations. This phase implements a commander command with Ink TUI and Elysia server integration, consuming frozen core APIs. Phase P-207 focuses on `Release Binary Build` and depends on P-206 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `.github/workflows/release.yml` (add binary build)



**Implementation Steps:**

```yaml

- run: bun build --compile --target=bun-linux-x64-modern packages/cli/src/index.ts --outfile stitch-linux-x64

- run: bun build --compile --target=bun-darwin-arm64 packages/cli/src/src/index.ts --outfile stitch-darwin-arm64

- run: bun build --compile --target=bun-windows-x64 packages/cli/src/index.ts --outfile stitch-windows-x64.exe

```



**Required MCPs/Connectors:** GitHub API (for repo pick), FileSystem



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Command parses via Commander with global `--json` and `--verbose` support

- [ ] Ink TUI renders without layout thrash; handles resize and cancellation

- [ ] Config stored via `configstore` and secrets redacted in logs

- [ ] Integration test invokes command against fixture repos



**Tests Required:** Unit tests for command parsing; integration tests invoke CLI against temp fixture repos with mocked GitHub via nock; Ink snapshot tests for UI.



**Dependencies:** P-206 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-208 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-208: Web — Vite+Tailwind Scaffold



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-207



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-208 focuses on `Vite+Tailwind Scaffold` and depends on P-207 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/web/vite.config.ts`

- `packages/web/tailwind.config.ts`

- `packages/web/postcss.config.js`

- `packages/web/src/styles/globals.css`



**Implementation Steps:**

- Vite config with React, path aliases

- Tailwind with custom design tokens

- Dark mode via `class` strategy



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-207 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-209 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-209: Web — Design Tokens



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-208



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-209 focuses on `Design Tokens` and depends on P-208 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/styles/tokens.css`



**Implementation Steps:**

- CSS variables for colors, spacing, radii

- Semantic tokens (primary, surface, border, text)

- Consistent with CLI theme



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-208 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-210 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-210: Web — Shell Layout



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-209



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-210 focuses on `Shell Layout` and depends on P-209 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/web/src/components/Layout.tsx`

- `packages/web/src/components/Sidebar.tsx`

- `packages/web/src/components/Topbar.tsx`



**Implementation Steps:**

- Responsive sidebar (collapsible)

- Topbar: theme toggle, notifications, user menu

- Mobile drawer



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-209 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-211 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-211: Web — Repo A Picker



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-210



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-211 focuses on `Repo A Picker` and depends on P-210 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/pages/MergeWizard/Step1RepoPicker.tsx`



**Implementation Steps:**

- Search input → GitHub API `/search/repos`

- List results with avatar, description, stars

- Manual URL input fallback

- Selection stored in Zustand



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-210 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-212 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-212: Web — Repo B Picker



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-211



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-212 focuses on `Repo B Picker` and depends on P-211 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/pages/MergeWizard/Step1RepoPicker.tsx` (same component, two instances)



**Implementation Steps:**

1. Implement `Repo B Picker` per TECH_STACK.md and ARCHITECTURE.md

2. Return `Result<T, StitchError>` and log via `logger`

3. Validate via `bun run typecheck`



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-211 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-213 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-213: Web — File Tree A



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-212



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-213 focuses on `File Tree A` and depends on P-212 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/web/src/components/FileTree.tsx`

- `packages/web/src/hooks/useFileTree.ts`



**Implementation Steps:**

- `react-arborist` with virtualization

- Checkbox selection (multi-select)

- Lazy-load children

- Dependency closure toggle (shows required files)

- Search/filter



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-212 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-214 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-214: Web — File Tree B



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-213



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-214 focuses on `File Tree B` and depends on P-213 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** Same `FileTree` component, second instance



**Implementation Steps:**

1. Implement `File Tree B` per TECH_STACK.md and ARCHITECTURE.md

2. Return `Result<T, StitchError>` and log via `logger`

3. Validate via `bun run typecheck`



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-213 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-215 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-215: Web — Selection State



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-214



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-215 focuses on `Selection State` and depends on P-214 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/store/selectionStore.ts`



**Implementation Steps:**

- Zustand store: `repoA`, `repoB`, `selectedPathsA`, `selectedPathsB`

- Persists to localStorage

- Computed: `dependencyClosureA`, `dependencyClosureB`



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-214 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-216 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-216: Web — AI Thinking Stream



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-215



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-216 focuses on `AI Thinking Stream` and depends on P-215 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:**

- `packages/web/src/components/AIThinkingStream.tsx`

- `packages/web/src/hooks/useJob.ts` (WS integration)



**Implementation Steps:**

- Connects to `/ws?jobId=`

- Renders `reasoning` chunks as live markdown

- Auto-scroll, syntax highlight for code blocks



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-215 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-217 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-217: Web — Diff Viewer



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-216



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-217 focuses on `Diff Viewer` and depends on P-216 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/DiffViewer.tsx`



**Implementation Steps:**

- `react-diff-viewer-continued`

- Side-by-side + inline toggle

- Accept/Reject buttons for gated proposals

- Keyboard shortcuts (A/R)



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-216 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-218 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-218: Web — Approve/Reject Gate



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-217



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-218 focuses on `Approve/Reject Gate` and depends on P-217 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/ProposalGate.tsx`



**Implementation Steps:**

- Modal triggered by `proposal` WS event

- Shows diff, description, files affected

- `POST /api/jobs/:id/approve|reject`

- Blocks further progress until decision



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-217 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-219 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-219: Web — Deps Conflict Panel



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-218



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-219 focuses on `Deps Conflict Panel` and depends on P-218 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/DepsPanel.tsx`



**Implementation Steps:**

- Table: Package | Repo A Version | Repo B Version | Conflict | Resolution

- Inline resolution selector (pick version)

- Auto-resolve button (uses semver intersect)



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-218 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-220 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-220: Web — License Panel



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-219



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-220 focuses on `License Panel` and depends on P-219 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/LicensePanel.tsx`



**Implementation Steps:**

- List: Package | License | Category | Policy Verdict

- Color-coded: green (allow), yellow (warn), red (deny)

- Expand for details (SPDX, repository)



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-219 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-221 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-221: Web — Sandbox Results



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-220



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-221 focuses on `Sandbox Results` and depends on P-220 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/SandboxPanel.tsx`



**Implementation Steps:**

- Step tabs: Install | Build | Test

- Live logs (ansi-to-html)

- Pass/Fail badge with retry button

- Artifact download links



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-220 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-222 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-222: Web — CREDITS Preview



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-221



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-222 focuses on `CREDITS Preview` and depends on P-221 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/CreditsPreview.tsx`



**Implementation Steps:**

- Renders `CREDITS.md` as sortable table

- Columns: Path, Source Repo, Commit, Author, License

- Filter by source repo

- Export to CSV



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-221 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-223 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-223: Web — WS Client + Reconnect



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-222



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-223 focuses on `WS Client + Reconnect` and depends on P-222 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-222 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-224 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-224: Web — Job History



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-223



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-224 focuses on `Job History` and depends on P-223 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/pages/JobsTable.tsx`



**Implementation Steps:**

- TanStack Query for `/api/jobs`

- Sortable, filterable table

- Click → navigate to `/merge/:jobId`



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-223 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-225 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-225: Web — Settings



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-224



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-225 focuses on `Settings` and depends on P-224 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/pages/Settings.tsx`



**Implementation Steps:**

- Provider keys (OpenRouter, Anthropic, Ollama)

- Default model selector

- Sandbox backend (Docker/GH Actions)

- Paths (cache, worktree)

- Theme (light/dark/system)



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-224 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-226 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-226: Web — Dark Mode



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-225



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-226 focuses on `Dark Mode` and depends on P-225 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/hooks/useTheme.ts`



**Implementation Steps:**

- `class` strategy on `<html>`

- Persists to localStorage

- Syncs with system preference



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-225 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-227 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-227: Web — Responsive



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-226



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-227 focuses on `Responsive` and depends on P-226 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** Tailwind responsive utilities throughout



**Implementation Steps:**

- Mobile-first breakpoints

- Sidebar drawer on mobile

- Stacked layout for wizard steps



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-226 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-228 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-228: Web — Error Boundaries



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-227



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-228 focuses on `Error Boundaries` and depends on P-227 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/ErrorBoundary.tsx`



**Implementation Steps:**

- React error boundary per page

- Friendly error UI with retry

- Reports to error tracking (future)



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-227 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-229 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-229: Web — Onboarding Tour



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-228



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-229 focuses on `Onboarding Tour` and depends on P-228 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/Onboarding.tsx`



**Implementation Steps:**

- Driver.js or custom stepper

- Highlights: repo picker, file tree, launch

- Skippable, persists dismissed state



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-228 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-230 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-230: Web — Session Export/Import



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-229



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-230 focuses on `Session Export/Import` and depends on P-229 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/hooks/useSession.ts`



**Implementation Steps:**

- Export: JSON with selections, config, job ID

- Import: restores wizard state

- Shareable URL with encoded state



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-229 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-231 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-231: Web — A11y



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-230



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-231 focuses on `A11y` and depends on P-230 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** All components



**Implementation Steps:**

- ARIA labels, roles

- Keyboard navigation

- Focus management

- Color contrast (WCAG AA)

- Screen reader testing



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-230 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-232 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-232: Web — Virtualized Trees



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-231



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-232 focuses on `Virtualized Trees` and depends on P-231 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/components/FileTree.tsx` (optimize)



**Implementation Steps:**

- `react-arborist` virtualization

- Windowing for 10k+ files

- Lazy load on expand



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-231 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-233 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-233: Web — E2E (Playwright)



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-232



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-233 focuses on `E2E (Playwright)` and depends on P-232 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/e2e/*.spec.ts`



**Implementation Steps:**

- Test full wizard flow

- Test WS reconnect

- Test approve/reject gate

- CI: `playwright test` in GitHub Actions



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-232 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-234 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-234: Web — i18n (Optional)



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-233



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-234 focuses on `i18n (Optional)` and depends on P-233 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/i18n/` (if needed)



**Implementation Steps:**

- `i18next` setup

- English default

- Structure for future locales



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-233 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-235 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-235: Web — Static Build Served by CLI



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-234



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-235 focuses on `Static Build Served by CLI` and depends on P-234 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/vite.config.ts` (build config)



**Implementation Steps:**

- `vite build` → `packages/web/dist`

- CLI server serves via `staticPlugin`

- Version hash in filename for cache busting



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-234 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-236 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-236: Web — Tests



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-235



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-236 focuses on `Tests` and depends on P-235 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/**/__tests__/*.test.tsx`



**Implementation Steps:**

- Unit tests for hooks, store, utils

- Component tests with React Testing Library

- Coverage thresholds (60/50/60/60)



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-235 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-237 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-237: Web — Perf Pass



**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-236



**Context:** Web UI provides a visual stitch wizard alongside CLI. This phase builds a React page/component with Tailwind, Zustand, and TanStack Query, consuming WS events from core orchestration. Phase P-237 focuses on `Perf Pass` and depends on P-236 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** Bundle analysis, lazy loading



**Implementation Steps:**

- `vite build --mode analyze`

- Code-split pages (React.lazy)

- Optimize images, fonts



**Required MCPs/Connectors:** None (frontend, WS client)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Component renders with Tailwind + Radix, no a11y violations (axe check)

- [ ] State managed via Zustand/TanStack Query with WS reconnection

- [ ] Responsive layout works at 375px, 768px, 1280px

- [ ] Playwright e2e covers happy path + error boundary



**Tests Required:** Vitest unit for components/hooks; Playwright e2e for wizard flow; a11y audit via axe; visual regression optional.



**Dependencies:** P-236 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-238 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-238: Orchestration — Pipeline State Machine



**Owner:** inbesat | **Wave:** 2 | **Depends On:** Wave 1 complete



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-238 focuses on `Pipeline State Machine` and depends on Wave 1 complete completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** Wave 1 complete must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-239 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-239: Orchestration — Job Queue (SQLite)



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-238



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-239 focuses on `Job Queue (SQLite)` and depends on P-238 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/jobQueue.ts`



**Implementation Steps:**

- `createJob(input)`, `getJob(id)`, `updateJob(id, patch)`, `listJobs(filters)`

- Advisory locks for concurrent access

- Priority queue (FIFO with priority)



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-238 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-240 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-240: Orchestration — Resume Jobs



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-239



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-240 focuses on `Resume Jobs` and depends on P-239 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/resume.ts`



**Implementation Steps:**

- On startup: find `running`/`paused` jobs

- Resume from last completed step

- Recover WS connections



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-239 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-241 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-241: Orchestration — Event Bus → WS



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-240



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-241 focuses on `Event Bus → WS` and depends on P-240 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/eventBus.ts`



**Implementation Steps:**

- In-memory event bus (per-process)

- `emit(jobId, event)` → broadcasts to WS connections

- `subscribe(jobId)` → async iterator for CLI server



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-240 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-242 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-242: Orchestration — Progress Aggregation



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-241



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-242 focuses on `Progress Aggregation` and depends on P-241 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/progress.ts`



**Implementation Steps:**

- Aggregates sub-step progress into step progress

- Computes ETA based on historical averages

- Emits `progress` events



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-241 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-243 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-243: Orchestration — Per-Job Config



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-242



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-243 focuses on `Per-Job Config` and depends on P-242 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/config.ts`



**Implementation Steps:**

- Job-specific config overrides global

- Merged at job start

- Immutable during execution



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-242 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-244 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-244: Orchestration — Dry-Run



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-243



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-244 focuses on `Dry-Run` and depends on P-243 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/dryRun.ts`



**Implementation Steps:**

- Executes pipeline without side effects

- Returns plan: files to pull, merges, AI proposals (simulated)

- Used by `stitch merge --dry-run`



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-243 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-245 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-245: Orchestration — Rollback Whole Job



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-244



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-245 focuses on `Rollback Whole Job` and depends on P-244 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/rollback.ts`



**Implementation Steps:**

- `rollbackJob(jobId)` → deletes child repo, cleans worktrees, cancels sandbox

- Idempotent



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-244 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-246 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-246: Orchestration — Cancel



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-245



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-246 focuses on `Cancel` and depends on P-245 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/cancel.ts`



**Implementation Steps:**

- `cancelJob(jobId)` → sets status `cancelled`, stops pipeline

- Graceful: waits for current step to finish or timeout



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-245 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-247 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-247: Orchestration — Metrics



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-246



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-247 focuses on `Metrics` and depends on P-246 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/metrics.ts`



**Implementation Steps:**

- Job duration, success rate, token usage, cost

- Exported via `/api/metrics` (Prometheus format optional)



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-246 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-248 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-248: Orchestration — Tracing



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-247



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-248 focuses on `Tracing` and depends on P-247 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/tracing.ts`



**Implementation Steps:**

- OpenTelemetry spans for each step

- Trace context propagated to AI calls, sandbox

- Exported to stdout (JSON) or collector



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-247 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-249 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-249: Orchestration — Concurrency



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-248



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-249 focuses on `Concurrency` and depends on P-248 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/concurrency.ts`



**Implementation Steps:**

- Semaphore for max parallel jobs (default 2)

- Per-job resource limits

- Queue overflow handling



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-248 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-250 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-250: Orchestration — Idempotency



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-249



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-250 focuses on `Idempotency` and depends on P-249 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/idempotency.ts`



**Implementation Steps:**

- Job input hash → deduplication

- Re-running same input returns existing job

- Safe retries



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-249 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-251 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-251: Orchestration — Tests



**Owner:** both | **Wave:** 2 | **Depends On:** P-250



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-251 focuses on `Tests` and depends on P-250 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/orchestration/__tests__/*.test.ts`



**Implementation Steps:**

- Test state machine transitions

- Test resume after crash

- Test cancel/rollback

- Test concurrency limits



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-250 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-252 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-252: Orchestration — CLI↔Web Contract



**Owner:** both | **Wave:** 2 | **Depends On:** P-251



**Context:** Orchestration coordinates the full pipeline from clone → merge → AI fix → sandbox → push. This phase implements state machine, job queue, and event bus for resumable jobs. Phase P-252 focuses on `CLI↔Web Contract` and depends on P-251 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/types/ws.ts` (shared)



**Implementation Steps:**

- Define WS message types (single source of truth)

- Both CLI server and Web UI import from core

- Versioned: `ws/v1`



**Required MCPs/Connectors:** SQLite (bun:sqlite), WebSocket (Elysia), Docker



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] State machine transitions correctly (planning→acting→verifying→complete|failed)

- [ ] Job persists to SQLite and resumes after process restart

- [ ] EventBus emits WS events and progress aggregates correctly

- [ ] Rollback aborts cleanly and releases resources



**Tests Required:** Unit tests for pipeline/job queue logic with in-memory SQLite; integration tests simulate crash→resume; WS contract tests.



**Dependencies:** P-251 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-253 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-253: Testing — Unit Conventions



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-252



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-253 focuses on `Unit Conventions` and depends on P-252 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `TESTING_CONVENTIONS.md` (root)



**Implementation Steps:**

- Document patterns: AAA, fixtures, mocking

- Naming: `*.test.ts`, `describe`/`it`

- Coverage expectations



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-252 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-254 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-254: Testing — Integration Fixtures



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-253



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-254 focuses on `Integration Fixtures` and depends on P-253 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `tests/fixtures/` (repo pairs)



**Implementation Steps:**

- Fixture 1: JS auth + JS UI (simple)

- Fixture 2: Python API + JS frontend

- Fixture 3: Go service + Rust lib

- Fixture 4: Monorepo extraction

- Fixture 5: Private + public repo



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-253 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-255 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-255: Testing — E2E CLI



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-254



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-255 focuses on `E2E CLI` and depends on P-254 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/__tests__/e2e.test.ts`



**Implementation Steps:**

- `stitch add A B → stitch merge` on fixtures

- Verify child repo builds + tests pass

- Test `--dry-run`, `--no-sandbox`



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-254 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-256 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-256: Testing — E2E Web



**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-255



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-256 focuses on `E2E Web` and depends on P-255 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/e2e/merge.spec.ts`



**Implementation Steps:**

- Playwright: full wizard → launch → approve → verify

- Test WS reconnect (kill server, restart)

- Test keyboard shortcuts



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-255 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-257 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-257: Testing — CI Matrix



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-256



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-257 focuses on `CI Matrix` and depends on P-256 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `.github/workflows/ci.yml` (update)



**Implementation Steps:**

- Matrix: ubuntu-latest, macos-latest, windows-latest

- Node versions: 22, 20 (if needed)

- Bun versions: latest, latest-1



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-256 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-258 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-258: Testing — Lint+Type Gates



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-257



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-258 focuses on `Lint+Type Gates` and depends on P-257 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** CI workflow



**Implementation Steps:**

- Required status checks on PR

- Fail on any lint/type error

- Separate jobs for speed



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-257 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-259 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-259: Testing — Coverage



**Owner:** both | **Wave:** 2 | **Depends On:** P-258



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-259 focuses on `Coverage` and depends on P-258 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `vitest.config.ts` thresholds



**Implementation Steps:**

- Enforce thresholds per package

- Upload to Codecov

- PR comment with coverage diff



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-258 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-260 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-260: Testing — Merge Snapshots



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-259



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-260 focuses on `Merge Snapshots` and depends on P-259 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `tests/snapshots/`



**Implementation Steps:**

- Snapshot test: merged repo structure

- Snapshot: CREDITS.md, SBOM

- Update on intentional changes



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-259 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-261 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-261: Testing — Deps Property Tests



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-260



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-261 focuses on `Deps Property Tests` and depends on P-260 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/deps/__tests__/property.test.ts`



**Implementation Steps:**

- Fast-check property tests for semver resolution

- `merge(a, b)` == `merge(b, a)` (commutative)

- `merge(a, a)` == `a` (idempotent)



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-260 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-262 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-262: Testing — Perf Benchmarks



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-261



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-262 focuses on `Perf Benchmarks` and depends on P-261 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `benchmarks/`



**Implementation Steps:**

- Benchmark: clone, filter-repo, merge, AI loop

- Track over time

- Alert on regression > 20%



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-261 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-263 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-263: Testing — Release Pipeline



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-262



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-263 focuses on `Release Pipeline` and depends on P-262 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `.github/workflows/release.yml`



**Implementation Steps:**

- Changeset → version bump → build → publish npm + GH Release + Docker

- Automated on tag push



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-262 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-264 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-264: Testing — Docker CI



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-263



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-264 focuses on `Docker CI` and depends on P-263 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `.github/workflows/docker.yml`



**Implementation Steps:**

- Build sandbox base images on tag

- Multi-arch (amd64, arm64)

- Push to GHCR



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-263 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-265 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-265: Testing — Security Audit



**Owner:** both | **Wave:** 2 | **Depends On:** P-264



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-265 focuses on `Security Audit` and depends on P-264 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** CI workflow + `bun audit`



**Implementation Steps:**

- `bun audit --level=high` in CI

- `trufflehog` scan for secrets

- Dependabot PRs auto-merged for patch



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-264 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-266 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-266: Testing — Quality Dashboard



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-265



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-266 focuses on `Quality Dashboard` and depends on P-265 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** GitHub Pages or simple HTML



**Implementation Steps:**

- Aggregates: test pass rate, coverage, build time, bundle size

- Trend charts

- Linked from README



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-265 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-267 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-267: Testing — Flake Triage



**Owner:** both | **Wave:** 2 | **Depends On:** P-266



**Context:** Quality gates enforce reliability before MVP release. This phase adds unit/integration/e2e coverage, CI matrix, and performance benchmarks. Phase P-267 focuses on `Flake Triage` and depends on P-266 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `FLAKE_TRIAGE.md`



**Implementation Steps:**

- Document known flaky tests

- Auto-quarantine (retry 3x, then mark flaky)

- Monthly review



**Required MCPs/Connectors:** Vitest, Playwright (for e2e), GitHub Actions



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Tests meet coverage thresholds (core 80/70/80/80, cli 70/60/70/70, web 60/50/60/60)

- [ ] CI matrix passes on Linux/macOS/Windows + Node 20/22 and Bun 1.1+

- [ ] No flaky tests; retry logic isolates flake triage

- [ ] Quality dashboard reports 0 critical vulns



**Tests Required:** Meta: validate coverage thresholds and CI matrix; tests themselves are verified via mutation/property tests.



**Dependencies:** P-266 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-268 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-268: Docs — README



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-267



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-268 focuses on `README` and depends on P-267 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `README.md` (root)



**Implementation Steps:**

- Badges (version, license, CI)

- Quick install (`bun add @repo-stitcher/cli`)

- Quick start (3 commands)

- Architecture diagram

- Links to docs



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-267 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-269 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-269: Docs — QUICKSTART



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-268



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-269 focuses on `QUICKSTART` and depends on P-268 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/QUICKSTART.md`



**Implementation Steps:**

- Prerequisites

- `stitch init` → `stitch add` → `stitch merge`

- Web UI: `stitch serve`

- Troubleshooting



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-268 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-270 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-270: Docs — ARCHITECTURE



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-269



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-270 focuses on `ARCHITECTURE` and depends on P-269 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/ARCHITECTURE.md` (copy from project-plans)



**Implementation Steps:**

1. Implement `ARCHITECTURE` per TECH_STACK.md and ARCHITECTURE.md

2. Return `Result<T, StitchError>` and log via `logger`

3. Validate via `bun run typecheck`



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-269 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-271 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-271: Docs — CONTRIBUTING



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-270



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-271 focuses on `CONTRIBUTING` and depends on P-270 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/CONTRIBUTING.md` (copy from project-plans)



**Implementation Steps:**

1. Implement `CONTRIBUTING` per TECH_STACK.md and ARCHITECTURE.md

2. Return `Result<T, StitchError>` and log via `logger`

3. Validate via `bun run typecheck`



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-270 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-272 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-272: Docs — Core API Docs



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-271



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-272 focuses on `Core API Docs` and depends on P-271 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/API.md` (generated)



**Implementation Steps:**

- `typedoc packages/core/src/index.ts --out docs/api`

- CI: generate on release



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-271 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-273 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-273: Docs — CLI Ref



**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-272



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-273 focuses on `CLI Ref` and depends on P-272 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/CLI.md`



**Implementation Steps:**

- Auto-generated from Commander help

- `stitch --help` → markdown



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-272 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-274 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-274: Docs — Web Docs



**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-273



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-274 focuses on `Web Docs` and depends on P-273 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/WEB.md`



**Implementation Steps:**

- Dashboard tour

- Merge wizard guide

- Settings reference



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-273 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-275 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-275: Docs — Config Ref



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-274



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-275 focuses on `Config Ref` and depends on P-274 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/CONFIG.md`



**Implementation Steps:**

- All config options with types, defaults, env vars

- Example files



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-274 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-276 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-276: Docs — Provider Setup Guide



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-275



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-276 focuses on `Provider Setup Guide` and depends on P-275 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/PROVIDERS.md`



**Implementation Steps:**

- OpenRouter: get key, choose model

- Anthropic: get key

- Ollama: install, pull model

- Troubleshooting



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-275 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-277 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-277: Docs — License Guide



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-276



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-277 focuses on `License Guide` and depends on P-276 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/LICENSES.md`



**Implementation Steps:**

- SPDX reference

- Compatibility matrix

- Policy configuration

- Deep scan setup



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-276 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-278 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-278: Docs — Publish Core



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-277



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-278 focuses on `Publish Core` and depends on P-277 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** Release workflow



**Implementation Steps:**

- `tsup` build → `npm publish --access public`

- Scoped package: `@repo-stitcher/core`



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-277 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-279 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-279: Docs — Installer/Homebrew



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-278



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-279 focuses on `Installer/Homebrew` and depends on P-278 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** Homebrew tap repo



**Implementation Steps:**

- Formula for `stitch` binary

- `brew tap repo-stitcher/tap && brew install stitch`



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-278 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-280 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-280: Docs — Docker Publish



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-279



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-280 focuses on `Docker Publish` and depends on P-279 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** Docker workflow



**Implementation Steps:**

- `ghcr.io/repo-stitcher/sandbox:node-22`, etc.

- `ghcr.io/repo-stitcher/cli:latest`



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-279 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-281 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-281: Docs — Versioning Policy



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-280



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-281 focuses on `Versioning Policy` and depends on P-280 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `docs/VERSIONING.md`



**Implementation Steps:**

- SemVer per package

- Breaking changes = major

- Deprecation policy (2 minor versions)



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-280 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-282 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-282: Docs — Changelog Automation



**Owner:** inbesat | **Wave:** 2 | **Depends On:** P-281



**Context:** Documentation enables adoption. This phase writes user and developer docs for the applicable surface (CLI, Web, Core API, or deployment). Phase P-282 focuses on `Changelog Automation` and depends on P-281 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** Changesets config



**Implementation Steps:**

- `@changesets/changelog-github` for GH Release notes

- Conventional commits → categorized changelog



**Required MCPs/Connectors:** None (markdown)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Markdown follows Diataxis structure and passes lint (no broken links)

- [ ] Examples are runnable via `bun run` and verified in CI

- [ ] Versioned docs align with code (checked via doc drift test)

- [ ] README QUICKSTART completes on clean machine in <5 min



**Tests Required:** Link checker + doc drift test (code vs docs); QUICKSTART run on clean Docker image.



**Dependencies:** P-281 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-283 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-283: Advanced — Plugin System



**Owner:** inbesat | **Wave:** 3 | **Depends On:** MVP release



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-283 focuses on `Plugin System` and depends on MVP release completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



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



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Plugin System` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** MVP release must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-284 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-284: Advanced — Plugin: Go Ecosystem



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-283



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-284 focuses on `Plugin: Go Ecosystem` and depends on P-283 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/plugins/go.ts`



**Implementation Steps:**

- Implements `ManifestParser` for `go.mod`/`go.sum`

- Adds Go to ecosystem detection

- Registers `go test` in sandbox



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Plugin: Go Ecosystem` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-283 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-285 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-285: Advanced — Plugin: Rust Ecosystem



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-284



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-285 focuses on `Plugin: Rust Ecosystem` and depends on P-284 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/plugins/rust.ts`



**Implementation Steps:**

- `Cargo.toml` parser with features, editions

- `cargo build --release` / `cargo test` in sandbox

- Handles workspace members



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Plugin: Rust Ecosystem` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-284 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-286 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-286: Advanced — Plugin: Python Ecosystem



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-285



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-286 focuses on `Plugin: Python Ecosystem` and depends on P-285 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/plugins/python.ts`



**Implementation Steps:**

- Supports `requirements.txt`, `pyproject.toml` (poetry, uv, pip)

- `pip install`, `pytest` in sandbox

- Handles virtualenv detection



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Plugin: Python Ecosystem` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-285 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-287 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-287: Advanced — Plugin: AI Connector



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-286



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-287 focuses on `Plugin: AI Connector` and depends on P-286 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/plugins/aiConnector.ts`



**Implementation Steps:**

- Example: `OllamaProvider` as plugin

- Template for custom providers

- Documentation: how to write a provider plugin



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Plugin: AI Connector` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-286 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-288 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-288: Advanced — Template Library



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-287



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-288 focuses on `Template Library` and depends on P-287 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/templates/`



**Implementation Steps:**

- Curated list of "known good" repo pairs

- `stitch template list` → shows templates

- `stitch template use <name>` → pre-fills repo A/B + paths

- Templates: `auth+dashboard`, `api+frontend`, `service+worker`, `monorepo-extract`



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Template Library` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-287 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-289 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-289: Advanced — Smart Presets



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-288



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-289 focuses on `Smart Presets` and depends on P-288 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/presets/`



**Implementation Steps:**

- `stitch preset auth` → auto-detects auth patterns in repo A

- `stitch preset ui` → auto-detects UI components in repo B

- ML-based: learns from successful merges

- Configurable patterns per org



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Smart Presets` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-288 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-290 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-290: Advanced — Batch Stitch



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-289



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-290 focuses on `Batch Stitch` and depends on P-289 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/batch.ts`



**Implementation Steps:**

```ts

export async function batchStitch(inputs: StitchInput[]): Promise<BatchResult>

```

- Processes multiple merges sequentially/parallel

- Shared cache for repos

- Aggregate report



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Batch Stitch` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-289 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-291 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-291: Advanced — Scheduled Merges



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-290



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-291 focuses on `Scheduled Merges` and depends on P-290 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/scheduler.ts`



**Implementation Steps:**

- Cron-like scheduler (node-cron)

- `stitch schedule add --cron "0 2 * * *" --config merge.json`

- Runs in background (separate process or systemd)

- Notifies on success/failure



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Scheduled Merges` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-290 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-292 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-292: Advanced — Multi-User Server Mode



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-291



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-292 focuses on `Multi-User Server Mode` and depends on P-291 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/server/multiUser.ts`



**Implementation Steps:**

- JWT auth (GitHub OAuth)

- Per-user job isolation

- Team workspaces (shared jobs)

- Admin dashboard



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Multi-User Server Mode` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-291 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-293 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-293: Advanced — RBAC



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-292



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-293 focuses on `RBAC` and depends on P-292 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/auth/rbac.ts`



**Implementation Steps:**

- Roles: `admin`, `developer`, `viewer`

- Permissions: `job:create`, `job:cancel`, `job:view`, `config:write`

- Team-based access



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `RBAC` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-292 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-294 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-294: Advanced — Team Workspaces



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-293



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-294 focuses on `Team Workspaces` and depends on P-293 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/workspaces/`



**Implementation Steps:**

- Shared config, credentials, templates

- Workspace-scoped job history

- Billing/metrics per workspace



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Team Workspaces` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-293 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-295 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-295: Advanced — Analytics Dashboard



**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-294



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-295 focuses on `Analytics Dashboard` and depends on P-294 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/pages/Analytics.tsx`



**Implementation Steps:**

- Merge success rate over time

- Average time-to-green

- Token cost trends

- License violation heatmap

- Repo popularity



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Analytics Dashboard` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-294 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-296 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-296: Advanced — Outgoing Webhooks



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-295



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-296 focuses on `Outgoing Webhooks` and depends on P-295 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/webhooks/`



**Implementation Steps:**

- `stitch webhook add --url https://... --events job.completed,job.failed`

- HMAC signature verification

- Retry with backoff

- Event payload: job ID, status, output summary



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Outgoing Webhooks` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-295 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-297 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-297: Advanced — REST API



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-296



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-297 focuses on `REST API` and depends on P-296 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/server/rest.ts`



**Implementation Steps:**

- Full OpenAPI 3.1 spec

- Endpoints: `/jobs`, `/repos`, `/templates`, `/config`

- Auth: Bearer token (JWT or API key)

- Rate limiting



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `REST API` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-296 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-298 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-298: Advanced — GraphQL API



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-297



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-298 focuses on `GraphQL API` and depends on P-297 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/cli/src/server/graphql.ts`



**Implementation Steps:**

- Schema: Job, Repo, Template, Config

- Queries: jobs with filters, job details

- Mutations: createJob, cancelJob, approveProposal

- Subscriptions: job events (WS)



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `GraphQL API` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-297 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-299 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-299: Advanced — MCP Server for OpenCode



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-298



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-299 focuses on `MCP Server for OpenCode` and depends on P-298 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/mcp/`



**Implementation Steps:**

- Implements MCP (Model Context Protocol) server

- Tools: `stitch_merge`, `stitch_license_check`, `stitch_deps_analyze`

- Resources: `stitch://jobs/{id}`, `stitch://templates`

- Prompts: "merge auth from A into B"

- Config: `mcpServers.repo-stitcher` in OpenCode config



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `MCP Server for OpenCode` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-298 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-300 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-300: Advanced — VS Code Extension



**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-299



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-300 focuses on `VS Code Extension` and depends on P-299 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/vscode-extension/` (separate package)



**Implementation Steps:**

- Tree view: recent jobs, templates

- Command: `Stitch: Merge Repos` → opens webview

- Inline diff for proposals

- Settings sync with CLI config



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `VS Code Extension` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-299 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-301 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-301: Advanced — Offline/Local Models



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-300



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-301 focuses on `Offline/Local Models` and depends on P-300 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/offline.ts`



**Implementation Steps:**

- Bundled quantized models (llama.cpp, ONNX)

- Auto-download on first use

- Fallback chain: local → Ollama → OpenRouter

- Air-gapped mode flag



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Offline/Local Models` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-300 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-302 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-302: Advanced — Cost Budgets



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-301



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-302 focuses on `Cost Budgets` and depends on P-301 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/ai/budgets.ts`



**Implementation Steps:**

- Per-user/org monthly budget

- Per-job token limit

- Alerts at 50%, 80%, 100%

- Hard stop at budget

- Cost breakdown by provider/model



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Cost Budgets` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-301 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-303 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-303: Advanced — Repo-Metadata Cache



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-302



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-303 focuses on `Repo-Metadata Cache` and depends on P-302 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/cache/repoCache.ts`



**Implementation Steps:**

- SQLite cache with TTL

- Caches: repo tree, license, default branch, stars

- Invalidation on push (webhook) or TTL expiry

- Shared across jobs



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Repo-Metadata Cache` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-302 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-304 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-304: Advanced — K8s Sandbox



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-303



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-304 focuses on `K8s Sandbox` and depends on P-303 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/sandbox/k8s.ts`



**Implementation Steps:**

- Kubernetes Job for sandbox

- Ephemeral pods with resource limits

- PersistentVolume for cache

- KEDA autoscaling for queue



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `K8s Sandbox` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-303 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-305 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-305: Advanced — Telemetry Opt-In



**Owner:** both | **Wave:** 3 | **Depends On:** P-304



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-305 focuses on `Telemetry Opt-In` and depends on P-304 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/telemetry/`



**Implementation Steps:**

- Anonymous usage stats (opt-in)

- Events: job_started, job_completed, proposal_accepted

- No code/content sent

- GDPR/CCPA compliant



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Telemetry Opt-In` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-304 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-306 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-306: Advanced — SSO



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-305



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-306 focuses on `SSO` and depends on P-305 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/auth/sso.ts`



**Implementation Steps:**

- SAML 2.0 / OIDC

- SCIM provisioning

- Attribute mapping (groups → roles)

- IdP: Okta, Azure AD, Google Workspace



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `SSO` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-305 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-307 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-307: Advanced — Compliance Export



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-306



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-307 focuses on `Compliance Export` and depends on P-306 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/compliance/`



**Implementation Steps:**

- SOC2 Type II evidence export

- Audit trail: who merged what, when, with what approvals

- SBOM archive

- License compliance report



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Compliance Export` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-306 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-308 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-308: Advanced — Plugin Marketplace



**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-307



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-308 focuses on `Plugin Marketplace` and depends on P-307 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/web/src/pages/Marketplace.tsx`



**Implementation Steps:**

- Browse/install plugins from registry

- Ratings, reviews, compatibility

- One-click install (npm pack + local registry)



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Plugin Marketplace` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-307 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-309 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-309: Advanced — Benchmarks Suite



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-308



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-309 focuses on `Benchmarks Suite` and depends on P-308 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `benchmarks/suite.ts`



**Implementation Steps:**

- Standardized benchmark repos

- Metrics: time, tokens, cost, memory

- CI: run on every release, compare to baseline

- Publish results



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Benchmarks Suite` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-308 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-310 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-310: Advanced — Config Migration



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-309



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-310 focuses on `Config Migration` and depends on P-309 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/config/migration.ts`



**Implementation Steps:**

- `ConfigSchema.version` field

- Migration functions: `v1 → v2`, `v2 → v3`

- `stitch config migrate` command

- Backup before migrate



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Config Migration` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-309 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-311 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-311: Advanced — Internationalization Core



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-310



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-311 focuses on `Internationalization Core` and depends on P-310 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `packages/core/src/i18n/`



**Implementation Steps:**

- Message catalogs (JSON)

- `t(key, params)` function

- Pluralization, date/number formatting

- CLI and Web use same catalogs



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Internationalization Core` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-310 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-312 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



---



### P-312: Advanced — Roadmap Doc



**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-311



**Context:** Wave 3 extensibility. This phase adds plugin/enterprise features post-MVP, gated by demand. Implements interfaces without breaking core contracts. Phase P-312 focuses on `Roadmap Doc` and depends on P-311 completing successfully. It must be isolated to its owner package and validated via `bun run typecheck` + `bun test` before handoff.



**Files to Create/Modify:** `ROADMAP.md` (root)



**Implementation Steps:**

- 6-month, 12-month, 24-month horizons

- Community-requested features

- Technical debt items

- Maintainer guidelines



**Required MCPs/Connectors:** Varies by plugin (e.g., Docker, K8s, REST)



**Skills to Invoke:** None



**Acceptance Criteria:**

- [ ] Implements `Roadmap Doc` behind feature flag without breaking frozen core API

- [ ] Plugin interface validated via contract tests

- [ ] E2e test covers plugin registration + execution

- [ ] Docs and changelog updated



**Tests Required:** Unit + integration tests per package thresholds; e2e where applicable; `bun run typecheck && bun run lint && bun test` must pass.



**Dependencies:** P-311 must be completed and validated (typecheck+tests green) before starting. Follows package isolation so no cross-owner blocking.



**Handoff Notes:** Next: P-313 consumes output of this phase. Export public types via `packages/core/src/index.ts` (if core) and ensure `bun run build` succeeds. Update `PROGRESS.md` and commit.



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

