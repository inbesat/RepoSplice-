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

**Context:** Standardize error handling so every public function in `packages/core` returns `Result<T, E>` from neverthrow (P-038) instead of throwing or returning `null`. This gives the orchestration layer (P-238) and consumers (CLI P-189, web P-208) a uniform, compile-time-forced way to handle both success and typed failure, and lets the whole pipeline propagate typed errors (P-203) without exceptions. It is the error-handling contract that SECURITY (P-265) and AGENTS (no-throw rule) build on.

**Files to Create/Modify:**
- `packages/core/src/result/index.ts` (new — Result re-exports + helpers)
- `packages/core/src/result/__tests__/result.test.ts` (new)
- `packages/core/src/result/` barrel exported via `packages/core/src/index.ts`

**Implementation Steps:**
1. Re-export `Result`, `ResultAsync`, `ok`, `err`, `fromThrowable`, `fromPromise` from neverthrow.
2. Add `fromPromise<T, E>(promise, mapErr)` helper wrapping unsafe promise-producing calls into `ResultAsync`.
3. Add a `match(result, { onOk, onErr })` helper for exhaustive handling so callers can't forget the error case.
4. Define the `StitchError` union type (per SECURITY P-265 section 9.1) — typed error kinds with stable codes (P-203) covering all pipeline stages: git, github, deps, license, ai, sandbox, orchestration, config, auth, cost, compliance.
5. Export the helpers + `StitchError` from the core public API (`index.ts`) so CLI/web import only the public surface (AGENTS import rule).
6. `result.test.ts`: ok/err construction, map/andThen chains, `fromPromise` catch+map of rejections, `match` exhaustive handling, error-code uniqueness check.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `ok`/`err` + `ResultAsync`/`fromPromise` work; `match` forces both cases
- [ ] `StitchError` union covers all pipeline stage codes (P-203) uniquely
- [ ] Exported via core public API (`index.ts`), no internal leakage
- [ ] No exceptions thrown from core result helpers
- [ ] Tests pass

**Tests Required:** `result.test.ts`:
- `it('ok err construction')`, `it('map andThen chains')`, `it('fromPromise catches')`, `it('match exhaustive')`, `it('error codes unique')`

**Dependencies:** P-010. P-038 neverthrow is installed by this dependency chain; used by every later core phase.

**Handoff Notes:** Next: P-012 util helpers. All core logic should build on this Result contract — treat it as the foundation for the no-throw rule in AGENTS.md.

---




### P-012: Core Util Helpers

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-011

**Context:** Provide small, typed, well-tested utility helpers used across `packages/core`: monotonic/counter-based id generation, safe path joining and normalization (Windows-safe, P-205), and ignore-pattern matching (composed with picomatch P-036) for filtering files during tree scans (P-103) and merges (P-192). Keeps cross-cutting concerns in one place so git/license/ai/sandbox modules stay focused.

**Files to Create/Modify:**
- `packages/core/src/util/id.ts` (new)
- `packages/core/src/util/paths.ts` (new)
- `packages/core/src/util/ignore.ts` (new)
- `packages/core/src/util/__tests__/util.test.ts` (new)
- `packages/core/src/util/index.ts` barrel + root export

**Implementation Steps:**
1. `id.ts`: `nanoid`-style + monotonic prefix builder (`job_<ts>_<seq>`) for stable, sortable job/run ids (used by P-239 queue, P-181 provenance), safe under concurrency (P-249).
2. `paths.ts`: `safeJoin(root, ...parts)` that rejects `..` escapes (path-traversal guard P-205), `toPosix`, `normalize` handling Windows backslashes, and a `resolveWithin(root, p)` helper returning `Result` on escape.
3. `ignore.ts`: `buildIgnoreMatcher(patterns, { negate, baseDir })` wrapping picomatch with `.gitignore`-style semantics (P-083 reuse), plus `shouldIgnore(relPath)`.
4. Wire exports via `index.ts`; use the no-throw Result contract (P-011) for `resolveWithin`.
5. `util.test.ts`: id uniqueness/monotonicity, safeJoin escape rejection, Windows path normalization, ignore matching incl. negation + dir scoping.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `id` unique + monotonic (job/run ids); concurrency-safe
- [ ] `safeJoin`/`resolveWithin` reject `..` escapes (P-205 Windows path safety)
- [ ] `buildIgnoreMatcher` negated + dir-scoped (composes P-036/picomatch)
- [ ] Exported via core `index.ts`; used by later scan/merge phases
- [ ] Tests pass

**Tests Required:** `util.test.ts`:
- `it('id unique monotonic')`, `it('safe join rejects escape')`, `it('path normalize')`, `it('ignore matcher')`

**Dependencies:** P-011. P-036 picomatch (dependency chain), P-205.

**Handoff Notes:** Next: P-013 ARCHITECTURE.md. Put every reusable cross-cutting helper here rather than duplicating it in a feature module.

---




### P-013: ARCHITECTURE.md

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-012

**Context:** Document the monorepo's package boundaries, data flow, module layout, and the contract between packages (core public API vs cli/web imports) so contributors (P-014) and the two owner agents (inbesat=core, aradhy=cli/web) build in the right places without violating isolation (AGENTS ownership rule). This is the authoritative map referenced by all later handoff phases.

**Files to Create/Modify:**
- `project-plans/ARCHITECTURE.md` (new — package boundaries, data flow, module layout)

**Implementation Steps:**
1. Document monorepo layout: `packages/core`, `packages/cli`, `packages/web` + root tooling (tsconfig P-002, eslint P-003, vitest P-004).
2. Package boundaries: core exposes a public API via `index.ts`; cli/web may import ONLY the public surface (AGENTS restricted-import rule); core never imports cli/web.
3. Data flow: CLI server (`serve` P-193) hosts REST/WS on :3434, web Vite :5173 proxies to it; core runs the pipeline (P-238) and posts events (P-241) over WS; the queue/provenance/db live in core (SQLite P-026, dirs P-205).
4. Module map per epic: git (P-069+), github (P-088+), deps (P-104+), license (P-114+), ai (P-133+), sandbox (P-168+), provenance (P-181+), orchestration (P-238+).
5. Document the Result (P-011) + config (P-009/P-200) conventions and the SECURITY (P-265) placement.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] ARCHITECTURE.md documents package boundaries + ownership + import rule
- [ ] Data flow (serve/WS/web proxy) documented and consistent with INTEGRATIONS
- [ ] Module map covers every epic/location
- [ ] Reviewed against AGENTS/TECH_STACK for accuracy

**Tests Required:** None (docs).

**Dependencies:** P-012. Aligned with TECH_STACK/AGENTS/INTEGRATIONS.

**Handoff Notes:** Next: P-014 CONTRIBUTING. This is the source of truth for where code lives — keep it in sync as modules ship.

---




### P-014: CONTRIBUTING.md + Code Style Guide

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-013

**Context:** Provide contribution guidelines, enforced code style, PR process, and testing requirements so both owner agents and external contributors produce consistent, reviewable changes that pass CI (P-007) and the coverage gates (AGENTS section 3). Encodes branch naming, conventional commits (P-005), the validate loop, and the phase-completion checklist.

**Files to Create/Modify:**
- `CONTRIBUTING.md` (root, new)

**Implementation Steps:**
1. Branch naming: `feat/`, `fix/`, `chore/`, `docs/` prefixed branches.
2. Commit message rules: Conventional Commits (P-005) with scope (core/cli/web/root).
3. PR template: description, testing performed, screenshots (UI), changeset (P-006) if user-facing.
4. Code style: TECH_STACK adherence, no restricted imports (AGENTS), Result not throw (P-011), max line 100, single quotes.
5. Testing requirements: coverage thresholds (core 80% stmt/70% branch), test patterns, fixtures, and the `validate()` helper (typecheck+lint+test+build).
6. Release process: changesets (P-006) + changelog (P-282).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] CONTRIBUTING.md exists and covers branch/commits/PR/style/testing/release
- [ ] Matches AGENTS.md enforced rules (no-throw, restricted imports, coverage)
- [ ] PR template + changeset guidance included

**Tests Required:** None (docs).

**Dependencies:** P-013. Aligned with AGENTS.md/CI gates.

**Handoff Notes:** Next: P-015+ All Dependencies. This file is the contract for every later contribution; keep it consistent with AGENTS.md.

---




### P-015: core: zod

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-014

**Context:** Add `zod` to `packages/core` — the schema/validation library for the config schema (P-009 `ConfigSchema`), provider configs (P-134/P-225), and every input boundary (CLI args P-189, REST P-297, AI JSON tool args P-139). Zod gives parse-time type-safety and serves as the single source of validation types across the monorepo (paired with zod-to-json-schema P-039 and @hookform/resolvers in web P-054).

**Files to Create/Modify:**
- `packages/core/package.json` (add `zod` dependency)

**Implementation Steps:**
1. `bun add zod --filter @repo-stitcher/core` (pin a locked, non-major range; bun.lock P-067 captures exact).
2. Verify `import { z } from 'zod'` and `z.object({...}).parse()` from a core module (P-009 uses it).
3. Confirm the version satisfies `zod-to-json-schema` (P-039) + web `@hookform/resolvers/zod` (P-054) compatibility.
4. Add a smoke test that a schema parses valid input and rejects invalid input (types flow).

**Required MCPs/Connectors:** npm registry.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `zod` in core dependencies; `import { z }` resolves
- [ ] `ConfigSchema` (P-009) parses via `zod` .parse with typed output
- [ ] Compatible with P-039 zod-to-json-schema + P-054 resolvers
- [ ] Smoke test passes; typecheck green

**Tests Required:** `config` smoke test: `it('parses valid config')`, `it('rejects invalid config')`.

**Dependencies:** P-014.

**Handoff Notes:** Next: P-016 simple-git.

---




### P-016: core: simple-git

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-015

**Context:** Add `simple-git` to `packages/core` — the promise-based Node git wrapper backing the Git Core epic (P-069–P-087): clone (P-069), merge (P-072), subtree (P-073), cherry-pick (P-074), push (P-078), status (P-194). Provides a typed, awaitable interface over `git` CLI (min git 2.40, P-063) that returns `ResultAsync` (P-011) for error handling.

**Files to Create/Modify:**
- `packages/core/package.json` (add `simple-git` + `@types/simple-git` dev if needed)

**Implementation Steps:**
1. `bun add simple-git --filter @repo-stitcher/core`; add matching `@types` if required by TS strict (P-002).
2. Add a thin wrapper module (`packages/core/src/git/` stub or `simpleGit()` factory) so the rest of core imports a typed, Result-returning helper rather than the raw lib.
3. Verify `git().init()` / `git().clone(repo, dir)` works against a throwaway temp fixture (P-062 pattern).
4. Confirm it runs the matched system `git` (P-063 requirement) and honors `GIT_TERMINAL_PROMPT=0` (non-interactive, P-265).

**Required MCPs/Connectors:** System `git` ≥2.40 (P-063).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `simple-git` in core deps; `import { simpleGit } from 'simple-git'` resolves
- [ ] Wrapper returns `ResultAsync` (P-011); clone/status smoke works on a temp fixture
- [ ] Non-interactive (no prompts, honors disable-prompt env)
- [ ] Typecheck green

**Tests Required:** Git wrapper smoke: `it('clones fixture')`, `it('status result')`.

**Dependencies:** P-015. Used by P-069–P-087.

**Handoff Notes:** Next: P-017 @octokit/rest (core GitHub client).

---




### P-017: core: @octokit/rest

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-016

**Context:** Add `@octokit/rest` to `packages/core` — the typed GitHub REST client backing the GitHub Integration epic (P-088–P-102): auth (P-088), repo search/list (P-089), tree/file fetch (P-090/091), repo creation (P-092), branches/protection (P-093), PRs (P-094), Actions status (P-095), rate limiting (P-096), forks (P-099). Octokit's native typings keep API shapes honest (AGENTS: read INTEGRATIONS first).

**Files to Create/Modify:**
- `packages/core/package.json` (add `@octokit/rest`)

**Implementation Steps:**
1. `bun add @octokit/rest --filter @repo-stitcher/core`.
2. Verify `import { Octokit } from '@octokit/rest'` + `new Octokit({auth})` and a typed endpoint (`octokit.repos.getContent` etc.) typecheck (P-002 strict).
3. Confirm it composes with `@octokit/auth-app` (P-018) for App auth (P-088).
4. Add a smoke test with a mocked `repos.get` (nock P-061) asserting the result is typed and flows to `Result` (P-011).

**Required MCPs/Connectors:** npm registry.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `@octokit/rest` in core deps; typed client constructs + endpoint typechecks (strict)
- [ ] Works with auth-app (P-018) and token auth
- [ ] Mocked-endpoint smoke test passes; respects rate-limit handling (P-096)
- [ ] Typecheck green

**Tests Required:** `github` smoke: `it('typed getContent')` (mocked).

**Dependencies:** P-016. Used by P-088–P-102; composes P-018.

**Handoff Notes:** Next: P-018 @octokit/auth-app.

---




### P-018: core: @octokit/auth-app

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-017

**Context:** Add `@octokit/auth-app` to `packages/core` — handles GitHub App installation token generation for server-to-server and installation-scoped calls (P-088 auth). This lets `stitch serve` (P-193) access GitHub with scoped, non-personal credentials (SECURITY P-265), rotation-aware, and never hardcoded tokens (AGENTS secret rule).

**Files to Create/Modify:**
- `packages/core/package.json` (add `@octokit/auth-app`)

**Implementation Steps:**
1. `bun add @octokit/auth-app --filter @repo-stitcher/core`.
2. Verify `import { createAppAuth } from '@octokit/auth-app'` + constructing an `App` auth that yields an installation token typechecks (P-002 strict).
3. Confirm it plugs into `new Octokit({ authStrategy, auth: {...app secrets} })` (P-017).
4. Ensure the auth flow supplies tokens via `~/.stitch` config-secret (P-200, P-206) — never in code/env dumps (logger redaction P-010).
5. Smoke test: auth hook returns a token-shaped result given mocked app id/installation (no real GH call).

**Required MCPs/Connectors:** npm registry.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `@octokit/auth-app` in core deps; `createAppAuth` constructs + typechecks
- [ ] Auth strategy composes with `@octokit/rest` client (P-017)
- [ ] Tokens sourced from config-secret (P-200/206), redacted in logs
- [ ] Mocked auth smoke test passes

**Tests Required:** `github` smoke: `it('app auth token', mocked)`.

**Dependencies:** P-017. Used by P-088.

**Handoff Notes:** Next: P-019 semver (version logic).

---




### P-019: core: semver

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-018

**Context:** Add `semver` to `packages/core` — the version-comparison library behind dependency resolution (P-104–P-113): merge manifest ranges (P-108/109), detect collisions, pick compatible versions, and validate pins. It drives the semver collision resolver (P-109) and the final merged deps report (P-116).

**Files to Create/Modify:**
- `packages/core/package.json` (add `semver` + `@types/semver`)

**Implementation Steps:**
1. `bun add semver --filter @repo-stitcher/core` + `bun add -d @types/semver`.
2. Verify `import { satisfies, validRange, coerce, intersect } from 'semver'` typechecks (P-002).
3. Smoke test: a range set `["^1.0.0","~1.1.0"]` → `satisfies` + `intersect` produces the intersection used by P-109.

**Required MCPs/Connectors:** npm registry.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `semver` (+types) in core deps; helpers import + typecheck
- [ ] `validRange`/`satisfies`/`intersect`/`coerce` behave on a fixture range
- [ ] Typecheck + test green

**Tests Required:** `semver` smoke: `it('intersects ranges')`, `it('coerces')`.

**Dependencies:** P-018. Used by P-104–P-116.

**Handoff Notes:** Next: P-020 tree-sitter (language grammars).

---




### P-020: core: tree-sitter + grammars

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-019

**Context:** Add `tree-sitter` + WebAssembly grammars (TypeScript, JavaScript, Python, Go, Rust) to `packages/core` — an incremental, exact parser used for safer per-file analysis: syntax-aware ignore of generated code, structure-aware file selection in the agent (P-148/P-152), and import/usage scanning during dependency detection (P-104/105/106/107). Exact parsing avoids regex fragility.

**Files to Create/Modify:**
- `packages/core/package.json` (add `web-tree-sitter` + grammar packages per P-020 list)
- `packages/core/src/analysis/treeSitter.ts` (new — loader + parse helpers + tests)

**Implementation Steps:**
1. Add `web-tree-sitter` + grammars: tree-sitter-typescript, targets; tree-sitter-javascript, python, go, rust (or `@tree-sitter-grammars/*` equivalents per current naming).
2. `treeSitter.ts`: async loader that initializes the parser + loads each `.wasm` grammar (P-260 perf-conscious: lazy-load per language).
3. `parse(filePath, {language})` returns a typed AST or `Result` error on unsupported language (P-011).
4. Smoke test: parse a small TS/PY/GO/RS snippet and assert a known node (e.g. import statement) is found.

**Required MCPs/Connectors:** None (WASM local).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `web-tree-sitter` + 5 grammars installed
- [ ] Loader lazy-loads per language; `parse` returns `Result`
- [ ] A known node found in each language smoke snippet
- [ ] Typecheck + tests green

**Tests Required:** `analysis` test: `it('parses ts/js/py/go/rs')`, `it('unsupported language errors')`.

**Dependencies:** P-019. Used by P-104–P-107, P-148/P-152.

**Handoff Notes:** Next: P-021 dependency-cruiser (JS/TS graph).

---




### P-021: Core Dependency - dependency-cruiser

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-020

**Context:** Add `dependency-cruiser` to `packages/core` — a static analyzer that builds a JavaScript/TypeScript dependency graph and enforces/forbids import rules. It powers AGENTS' `no-restricted-imports` guarantees at analysis time and can cross-check dependency resolution (P-104–P-113) by surfacing real import edges, plus feed the ecosystem/agent analysis (P-103/P-149) with module connectivity.

**Files to Create/Modify:**
- `packages/core/package.json` (add `dependency-cruiser`)
- `packages/core/dependency-cruiser.config.cjs` (new) + wiring for a `lint:deps` npm script

**Implementation Steps:**
1. `bun add -d dependency-cruiser --filter @repo-stitcher/core` (build/analysis tooling, not runtime).
2. Add a config forbidding imports into `core` internals from outside the public `index.ts` surface (enforce AGENTS restricted-import rule) and disallowing forbidden deps.
3. Add a root/package script `depcruise` that runs `depcruise src` and fails on violation (CI gate, P-260-adjacent).
4. Smoke test: run `depcruise` on the current `src` and confirm it passes; verify it flags a deliberate bad import in a throwaway fixture.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `dependency-cruiser` installed (dev); config + `depcruise` npm script wired
- [ ] Config enforces core public-API-only imports (AGENTS rule)
- [ ] CI/`bun run validate` runs depcruise and fails on violation
- [ ] Smoke test: pass on clean tree, flag a bad import fixture

**Tests Required:** (covered by CI/depcruise smoke) — the fixture-check doubles as the test.

**Dependencies:** P-020. Used with P-022, P-104, P-149.

**Handoff Notes:** Next: P-022 madge.

---




### P-022: Core Dependency - madge

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-021

**Context:** Add `madge` to `packages/core` — circular-dependency detection and graph visualization. Used to detect import cycles that would break the dependency-closure resolution (P-149) and cause ordering bugs in merged repos (P-238), and to produce a module graph for the architecture review (P-013) and pinning decisions.

**Files to Create/Modify:**
- `packages/core/package.json` (add `madge`, dev)
- `packages/core/src/analysis/circular.ts` (new — wraps madge as a typed check)

**Implementation Steps:**
1. `bun add -d madge --filter @repo-stitcher/core`.
2. Verify programmatic API: `madge(srcPath).then(m => m.circular())` returns a list of cycles (P-002 strict types).
3. `circular.ts`: `findCycles(root)` returns a `Result<string[][]>` (P-011); a `--no-circles` CI gate fails on any cycle.
4. Smoke test: a temp file with a deliberate cycle is detected; a clean tree reports none.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `madge` installed; programmatic `circular()` works (typed)
- [ ] `findCycles` returns `Result`; CI `--no-circles` gate
- [ ] Smoke: detects a seeded cycle, passes on clean tree
- [ ] Typecheck + test green

**Tests Required:** `analysis` test: `it('detects cycle')`, `it('clean tree none')`.

**Dependencies:** P-021.

**Handoff Notes:** Next: P-023 license-checker.

---




### P-023: Core Dependency - license-checker

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-022

**Context:** Add `license-checker` to `packages/core` — scans declared licenses from installed package manifests. It's a primary source for the License Compliance epic (P-114–P-132): reading licenses out of `node_modules` (P-118 scan), feeding SPDX normalization (P-119), and contributing to the license report (P-128). Output is normalized before SPDX parsing (P-024).

**Files to Create/Modify:**
- `packages/core/package.json` (add `license-checker`)
- `packages/core/src/license/scan.ts` (new — wraps license-checker into the P-011 Result contract)

**Implementation Steps:**
1. `bun add license-checker --filter @repo-stitcher/core`.
2. Verify programmatic API: `licenseChecker.init({start}, cb)` yields a `{ [pkg]: { licenses, licenseFile, repository } }` map; type via our own wrapper types.
3. `scan.ts`: `scanDeclared(depsDir)` → `Result<DeclaredLicense[]>` mapping raw `licenses` strings into structured entries, deferring parsing to P-024/P-119.
4. Smoke test (fixture `node_modules` with a few mock manifests) returns a structured list; unavailable dir → typed error.

**Required MCPs/Connectors:** None (local scan).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `license-checker` installed; programmatic init works
- [ ] `scanDeclared` returns `Result<DeclaredLicense[]>` (P-011), structured
- [ ] Fixture smoke passes; missing dir errors
- [ ] Feeds P-114–P-132 pipeline

**Tests Required:** `license` test: `it('scans fixture')`, `it('missing dir errors')`.

**Dependencies:** P-022. Used by P-118/P-128.

**Handoff Notes:** Next: P-024 spdx-expression-parse.

---




### P-024: Core Dependency - spdx-expression-parse

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-023

**Context:** Add `spdx-expression-parse` to `packages/core` — parses and evaluates SPDX license expression syntax (`MIT`, `(MIT OR Apache-2.0)`, `GPL-2.0-only WITH Classpath-exception-2.0`). This is the grammar engine for license compatibility analysis (P-120), dual-license handling (P-122), and generation of the dependency license verdicts (P-128).

**Files to Create/Modify:**
- `packages/core/package.json` (add `spdx-expression-parse`)

**Implementation Steps:**
1. `bun add spdx-expression-parse --filter @repo-stitcher/core`.
2. Verify `spdxExpressionParse(expr)` returns an AST for compound expressions (AND/OR/WITH) (strict types via our wrapper).
3. Wrap in `packages/core/src/license/expr.ts` as `parseExpr(expr)` → `Result<LicenseExpr>` with a typed error for malformed input (P-011).
4. Smoke test: parses `(MIT OR Apache-2.0)` into a compound node; rejects `not-a-license`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `spdx-expression-parse` installed; compound/`WITH` expressions parse to AST
- [ ] `parseExpr` returns `Result` (P-011); malformed input → typed error
- [ ] Smoke tests pass; used by P-120/P-122/P-128

**Tests Required:** `license` test: `it('parses compound')`, `it('rejects malformed')`.

**Dependencies:** P-023. Used by P-114–P-132.

**Handoff Notes:** Next: P-025 spdx-correct.

---




### P-025: Core Dependency - spdx-correct

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-024

**Context:** Add `spdx-correct` to `packages/core` — maps common misspellings/aliases to valid SPDX ids (e.g. `Apache 2.0` → `Apache-2.0`, `GPL` → `GPL-3.0-or-later`), the fuzzy step before strict parsing (P-024) in the normalization pipeline (P-119). Ensures messy third-party declared licenses resolve to canonical ids so compatibility (P-120) and the report (P-128) are reliable.

**Files to Create/Modify:**
- `packages/core/package.json` (add `spdx-correct`)

**Implementation Steps:**
1. `bun add spdx-correct --filter @repo-stitcher/core`.
2. Verify `spdxCorrect(raw)` returns a canonical id or `null`.
3. Wire into `packages/core/src/license/normalize.ts`: `normalizeLicense(raw)` → `Result<string>` that corrects then, if `null`, marks unknown (P-123).
4. Smoke test: `Apache 2` → `Apache-2.0`, `GPLv2` → `GPL-2.0-only` (or best-match per lib), unresolvable → not-correctable path.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `spdx-correct` installed; `spdxCorrect` maps aliases to canonical ids
- [ ] `normalizeLicense` correct-or-unknown → `Result`
- [ ] Smoke tests pass; feeds P-119

**Tests Required:** `license` test: `it('corrects alias')`, `it('unknown path')`.

**Dependencies:** P-024. Used by P-119.

**Handoff Notes:** Next: P-026 spdx-license-list.

---




### P-026: Core Dependency - spdx-license-list

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-025

**Context:** Add `spdx-license-list` to `packages/core` — the official SPDX license registry (id → name/url/osi/fsf flags) with offline data. It is the reference source for validating corrected ids (P-025), the compatibility matrix (P-120), and generating NOTICE/attribution (P-126) and the SBOM (P-183). Offline data keeps licensing usable in the privacy/offline mode (P-301).

**Files to Create/Modify:**
- `packages/core/package.json` (add `spdx-license-list`)

**Implementation Steps:**
1. `bun add spdx-license-list --filter @repo-stitcher/core`.
2. Verify the import surface (`licenses`, `licensesById`) exposes id → `{ name, url, osiApproved, fsfLibre }`.
3. Wrap in `packages/core/src/license/spdxIndex.ts`: `lookupLicense(id)` → `Result<LicenseInfo>` and `isKnown(id)`.
4. Smoke test: known id returns metadata; unknown returns typed not-found; OSI flag read correctly.

**Required MCPs/Connectors:** None (offline data bundled).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `spdx-license-list` installed; offline registry accessible (id → metadata)
- [ ] `lookupLicense` → `Result` (P-011); `isKnown` for validation
- [ ] Smoke tests pass; supports offline (P-301)

**Tests Required:** `license` test: `it('lookup known')`, `it('unknown not found')`, `it('osi flag')`.

**Dependencies:** P-025. Used by P-119/120/126/183.

**Handoff Notes:** Next: P-027 openai (OpenRouter/Ollama universal client).

---




### P-027: Core Dependency - openai (OpenRouter client)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-026

**Context:** Add the `openai` npm package to `packages/core` — the universal OpenAI-compatible client used as the transport for OpenRouter, OpenAI, and Ollama/local endpoints (P-132 `OpenAICompatibleProvider`, P-140 Ollama). It speaks the shared OpenAI-compatible chat-completions/tool-calling protocol, letting the AI provider layer (P-133–P-147) support many backends through one code path (P-287 adapter parity).

**Files to Create/Modify:**
- `packages/core/package.json` (add `openai`)

**Implementation Steps:**
1. `bun add openai --filter @repo-stitcher/core`.
2. Verify `new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser? })` + `openai.chat.completions.create({model, messages, tools})` typechecks (P-002).
3. Add a thin typed wrapper module (@openai-compat) so core imports one surface and can point `baseURL` at OpenRouter/OpenAI/Ollama.
4. Offline/local: confirm it works point-at a local Ollama/OpenAI-compatible endpoint (P-301) with retries (P-139).
5. Smoke test with a mocked endpoint (nock P-061) verifying request shape (baseURL/model/tools) and streaming.

**Required MCPs/Connectors:** npm registry; optional local Ollama.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `openai` installed; typed client + chat-completions + tools typecheck
- [ ] `baseURL` configurable (OpenRouter/OpenAI/Ollama), retry/backoff (P-139)
- [ ] Works against local endpoints (P-301); mocked request-shape test passes
- [ ] Typecheck + tests green

**Tests Required:** provider test: `it('openai compat request')`, `it('streams')` (mocked).

**Dependencies:** P-026. Used by P-132/P-140/P-287.

**Handoff Notes:** Next: P-028 @anthropic-ai/sdk.

---




### P-028: Core Dependency - @anthropic-ai/sdk

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-027

**Context:** Add `@anthropic-ai/sdk` to `packages/core` — native Anthropic API access for Claude models with native tool-calling, used by `AnthropicProvider` (P-133). Keep parity with the OpenAI-compatible path (P-027/P-132) behind the shared `ChatProvider` interface (P-131) so the provider registry (P-134) can mix backends.

**Files to Create/Modify:**
- `packages/core/package.json` (add `@anthropic-ai/sdk`)

**Implementation Steps:**
1. `bun add @anthropic-ai/sdk --filter @repo-stitcher/core`.
2. Verify `new Anthropic({ apiKey })` + `client.messages.create({ model, system, messages, tools })` typechecks (P-002).
3. Ensure the Anthropic adapter maps the interface's messages/tools/types onto Claude's protocol and maps errors into `StitchError` (P-011/P-203).
4. Mocked-endpoint smoke test (nock P-061) verifies request + streaming + tool-use response shape.

**Required MCPs/Connectors:** npm registry.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `@anthropic-ai/sdk` installed; native messages/tools typecheck
- [ ] Backs `AnthropicProvider` (P-133) behind `ChatProvider` (P-131)
- [ ] Errors map to `StitchError`; mocked request/stream test passes
- [ ] Typecheck + tests green

**Tests Required:** provider test: `it('anthropic request')`, `it('tool use maps')` (mocked).

**Dependencies:** P-027. Used by P-133.

**Handoff Notes:** Next: P-029 dockerode (sandbox).

---




### P-029: Core Dependency - dockerode

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-028

**Context:** Add `dockerode` to `packages/core` — programmatic Docker container management for the sandbox (P-168–P-180): build/run ephemeral per-ecosystem images (P-169), install deps (P-170), run build/tests (P-171/172), capture logs (P-173), apply limits/timeout (P-174), and clean up (P-177). It is the primary local sandbox backend (with GH Actions P-178 + K8s P-304 as alternates).

**Files to Create/Modify:**
- `packages/core/package.json` (add `dockerode` + `@types/dockerode`)

**Implementation Steps:**
1. `bun add dockerode --filter @repo-stitcher/core` + `bun add -d @types/dockerode`.
2. Verify `new Docker()`, `docker.pull`, `docker.createContainer`, `container.start/logs/remove` typecheck (P-002).
3. Fold into `sandbox/docker.ts`: a typed client with graceful degradation when Docker is unavailable (P-168 fallback to GH Actions P-178).
4. Smoke test: `docker.ping()` detection path returns reachable/unreachable `Result` (no real container needed; use mocks P-061).

**Required MCPs/Connectors:** Docker daemon (P-065); mocks in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `dockerode` (+types) installed; client APIs typecheck
- [ ] Typed sandbox docker client with ping/unavailable detection
- [ ] Fails gracefully when Docker missing (fallback P-178)
- [ ] Mocked smoke test passes

**Tests Required:** `sandbox` test: `it('docker available')`, `it('docker unavailable fallback')` (mocked).

**Dependencies:** P-028. Used by P-168–P-180.

**Handoff Notes:** Next: P-030 bun:sqlite (native storage).

---




### P-030: Core Dependency - bun:sqlite (native)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-029

**Context:** Use Bun's native `bun:sqlite` binding for local persistence: the job queue (P-239), job/event audit log (P-187/P-241), provenance store (P-181), baseline store (P-309), and config/cache records (P-303). Bundled with Bun, zero external deps, synchronous + fast — the durable backbone for the orchestration and provenance epics.

**Files to Create/Modify:**
- `packages/core/src/store/db.ts` (new — typed SQLite wrapper)
- `packages/core/src/store/schema.ts` (new — migrations + tables)
- `packages/core/src/store/__tests__/db.test.ts` (new)

**Implementation Steps:**
1. `db.ts`: `openDb(path)` → a typed `Database` exposing prepared-statement helpers (`get`, `all`, `run`) wrapping `bun:sqlite`.
2. `schema.ts`: a migration runner (schema_version table + sequential `migrations[]`) + initial tables (jobs, events, provenance, audit, baselines, cache) — deterministic (P-282).
3. Verify `import { Database } from 'bun:sqlite'` typechecks (P-002) and a table create/insert/select round-trips.
4. Offset into `~/.stitch/store.db` (P-200/P-205); WAL mode for concurrency (P-249).
5. `db.test.ts`: migration idempotency, CRUD round-trip, WAL/concurrency, prepared-statement injection safety.

**Required MCPs/Connectors:** None (native).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `bun:sqlite` wrapper + migration runner; initial tables
- [ ] CRUD + prepared statements (injection-safe); WAL for concurrency
- [ ] Stores in `~/.stitch` (P-200/P-205); deterministic migrations
- [ ] `db.test.ts` passes

**Tests Required:** `store` test: `it('migrations idempotent')`, `it('crud')`, `it('wal concurrency')`, `it('prepared safe')`.

**Dependencies:** P-029. Used by P-187/239/241/181/309/303.

**Handoff Notes:** Next: P-031 p-limit (concurrency).

---




### P-031: Core Dependency - p-limit

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-030

**Context:** Add `p-limit` to `packages/core` — controlled concurrency limiting for parallel clones (P-069/P-086), concurrent sandbox runs (P-168–P-180), and AI provider rate-limited calls (P-139). It caps resource use to stay within the sandbox/rate budgets (P-174/P-249) and avoids exhausting the environment during batch operations (P-290).

**Files to Create/Modify:**
- `packages/core/package.json` (add `p-limit`)
- `packages/core/src/util/limit.ts` (new — typed limit unwrap helper)

**Implementation Steps:**
1. `bun add p-limit --filter @repo-stitcher/core`.
2. Verify `import pLimit from 'p-limit'` + `limit(concurrency)(fn)` typechecks (P-002).
3. `limit.ts`: `withLimit(concurrency, fn)` + a `mapLimit(items, concurrency, mapper)` returning `Result`s (P-011) for parallel-but-bounded batches.
4. Smoke test: run N tasks with concurrency 2 and assert only 2 run at a time (counter); errors map to `Result`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `p-limit` installed; `mapLimit` bounded-parallel `Result` helper
- [ ] Rejects when the queue is misused; errors → `Result` (P-011)
- [ ] Smoke: concurrency cap verified; typecheck green

**Tests Required:** `util` test: `it('caps concurrency')`, `it('maps errors')`.

**Dependencies:** P-030. Used by P-069/086/139/249.

**Handoff Notes:** Next: P-032 yaml.

---




### P-032: Core Dependency - yaml

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-031

**Context:** Add `yaml` to `packages/core` — YAML parsing/serialization for manifests such as `docker-compose.yml`, `.github/workflows/*.yml`, and structured output (CICD/toolchain files during config merge P-113/P-132). Lossless enough for round-tripping config while merging (P-112/113).

**Files to Create/Modify:**
- `packages/core/package.json` (add `yaml`)

**Implementation Steps:**
1. `bun add yaml --filter @repo-stitcher/core`.
2. Verify `parse`, `stringify`, and comment-preserving `Document` APIs typecheck (P-002).
3. Wrap in `packages/core/src/util/yaml.ts`: `parseYaml<T>(text)` / `stringifyYaml` with `Result` (P-011) on syntax errors.
4. Smoke test: parse a workflows fixture, round-trip preserves keys, malformed input → typed error.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `yaml` installed; parse/stringify + `Document` typecheck
- [ ] `parseYaml` → `Result` (P-011); malformed → typed error
- [ ] Smoke tests pass; used by P-112/113/132

**Tests Required:** `util` test: `it('parses yaml')`, `it('round trips'), it('malformed errors')`.

**Dependencies:** P-031.

**Handoff Notes:** Next: P-033 ini.

---




### P-033: Core Dependency - ini

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-032

**Context:** Add `ini` to `packages/core` — INI parsing for config files like `git config`, `.npmrc`, and `cargo` config that appear in merged repos (P-112/113 dependency/config merge) and ecosystem detection (P-103). Parses dotted-section/flat INI into nested objects.

**Files to Create/Modify:**
- `packages/core/package.json` (add `ini`)

**Implementation Steps:**
1. `bun add ini --filter @repo-stitcher/core`.
2. Verify `ini.parse(text)` / `ini.stringify(obj)` typecheck (P-002).
3. Wrap in `packages/core/src/util/ini.ts`: `parseIni` → `Result` (P-011), handling section nesting.
4. Smoke test: parse a `.npmrc`/git-config fixture into the expected nested shape.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `ini` installed; parse/stringify typecheck
- [ ] `parseIni` → `Result` (P-011), section nesting handled
- [ ] Smoke test passes; used by P-103/112/113

**Tests Required:** `util` test: `it('parses ini')`, `it('nested sections')`.

**Dependencies:** P-032.

**Handoff Notes:** Next: P-034 glob.

---




### P-034: Core Dependency - glob

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-033

**Context:** Add `glob` to `packages/core` — recursive file pattern matching for fixture generation (P-062), repo scanning (P-103), and tree operations. Provides a fast, Node-native way to discover files matching patterns in pace with the merge/scan stages.

**Files to Create/Modify:**
- `packages/core/package.json` (add `glob`)

**Implementation Steps:**
1. `bun add glob --filter @repo-stitcher/core`.
2. Verify the async `glob(patterns, { cwd, ignore })` API typechecks (P-002).
3. Wrap in `packages/core/src/util/glob.ts`: `listFiles(root, patterns, { ignore })` → `Result<string[]>` (P-011), absolute + posix-normalized.
4. Smoke test: fixture tree returns expected relative files honoring `ignore`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `glob` installed; async glob typechecks
- [ ] `listFiles` → `Result<string[]>` honoring `ignore` (P-036 reuse)
- [ ] Smoke test passes; used by P-062/103

**Tests Required:** `util` test: `it('lists files')`, `it('respects ignore')`.

**Dependencies:** P-033.

**Handoff Notes:** Next: P-035 fs-extra.

---




### P-035: Core Dependency - fs-extra

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-034

**Context:** Add `fs-extra` to `packages/core` — extended filesystem ops (`copy`, `move`, `ensureDir`, `emptyDir`, `remove`) used across staging/writing phases: writing the merged child repo (P-076/P-192), temp staging dirs, and fixture setup (P-062). Provides ergonomic async + atomic-ish helpers on Node fs.

**Files to Create/Modify:**
- `packages/core/package.json` (add `fs-extra` + `@types/fs-extra`)

**Implementation Steps:**
1. `bun add fs-extra --filter @repo-stitcher/core` + `bun add -d @types/fs-extra`.
2. Verify `copy`, `move`, `ensureDir`, `emptyDir`, `remove` typecheck (P-002).
3. Wrap win-safe staging helpers (`packages/core/src/util/fs.ts` returning `Result` P-011) using `safeJoin` (P-012) to prevent traversal.
4. Smoke test: copy a temp tree, ensure/empty dirs, remove; traversal escape → typed error.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `fs-extra` (+types) installed; ops typecheck
- [ ] Win-safe `fs.ts` helpers wrap ops returning `Result` (P-011) with `safeJoin` (P-012)
- [ ] Smoke tests pass; used by P-062/076/192

**Tests Required:** `util` test: `it('copy tree')`, `it('ensure empty'), it('traversal reject')`.

**Dependencies:** P-034. Uses P-012 path safety.

**Handoff Notes:** Next: P-036 picomatch.

---




### P-036: Core Dependency - picomatch

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-035

**Context:** Add `picomatch` to `packages/core` — fast glob/ignore pattern matching for `.gitignore` parsing (P-083) and file-filtering during scans (P-103/P-163). Composes with the ignore helper (P-012) to power which paths enter the merged tree.

**Files to Create/Modify:**
- `packages/core/package.json` (add `picomatch`)

**Implementation Steps:**
1. `bun add picomatch --filter @repo-stitcher/core`.
2. Verify `picomatch(patterns, { dot, ignore })` typechecks (P-002).
3. Ensure the P-012 `buildIgnoreMatcher` is backed by picomatch for `.gitignore` semantics (negation, dirs).
4. Smoke test: match/negate patterns against fixture paths.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `picomatch` installed; matcher typechecks
- [ ] Backs P-012 ignore matcher (.gitignore semantics)
- [ ] Smoke tests pass; used by P-083/103/163

**Tests Required:** `util` test: `it('matches'), it('negation'), it('dot files')`.

**Dependencies:** P-035. Consumed by P-012/P-083.

**Handoff Notes:** Next: P-037 pino.

---




### P-037: Core Dependency - pino

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-036

**Context:** Add `pino` to `packages/core` — high-performance structured JSON logging with automatic secret redaction (P-010 core/log, P-265 security, P-206 settings). Structured logs feed the CLI progress render (P-199), the web event bus (P-241), and the audit log (P-187).

**Files to Create/Modify:**
- `packages/core/package.json` (add `pino` + `pino-roll`)

**Implementation Steps:**
1. `bun add pino --filter @repo-stitcher/core`.
2. Verify `pino({ level, redact })` + child loggers typecheck (P-002).
3. Wire into `core/log` (P-010): default redact paths for keys/tokens (P-206) and a transport to the CLI sortable output.
4. Smoke test: a log line with a redacted key does not contain the secret value.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `pino` installed; typed logger + child loggers
- [ ] `core/log` redacts secrets by default (P-206/P-265)
- [ ] Smoke: redaction tested; used by P-010/187/199/241

**Tests Required:** `log` test: `it('redacts secrets')`, `it('child logger')`.

**Dependencies:** P-036. Used by P-010.

**Handoff Notes:** Next: P-038 neverthrow.

---




### P-038: Core Dependency - neverthrow

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-037

**Context:** Add `neverthrow` to `packages/core` — the typed `Result<T, E>` library that enforces the no-throw contract (P-011, AGENTS no-throw rule). It backs `StitchError` flow everywhere so failures propagate as values, not exceptions, at every boundary.

**Files to Create/Modify:**
- `packages/core/package.json` (add `neverthrow`)

**Implementation Steps:**
1. `bun add neverthrow --filter @repo-stitcher/core`.
2. Verify `Result`, `ResultAsync`, `ok`, `err`, `fromPromise`, `andThen`, `mapErr` typecheck (P-002).
3. Confirm the P-011 result barrel re-exports from this installed package (single source of truth).
4. Smoke test: result chains + async fromPromise behave (guards P-011).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `neverthrow` installed; Result/ResultAsync + combinators typecheck
- [ ] Backs the P-011 result barrel (single source)
- [ ] Smoke tests pass; used across every core module

**Tests Required:** `result` test: `it('chain'), it('async frompromise')`.

**Dependencies:** P-037. Consumed by P-011.

**Handoff Notes:** Next: P-039 zod-to-json-schema.

---




### P-039: Core Dependency - zod-to-json-schema

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-038

**Context:** Add `zod-to-json-schema` to `packages/core` — converts Zod schemas (P-009/P-015) to JSON Schema used to shape AI tool arguments (P-139), expose config as JSON Schema for editor tooling, and validate REST/GraphQL I/O (P-297/298). Keeps a single typed source for every boundary.

**Files to Create/Modify:**
- `packages/core/package.json` (add `zod-to-json-schema`)

**Implementation Steps:**
1. `bun add zod-to-json-schema --filter @repo-stitcher/core`.
2. Verify `zodToJsonSchema(schema, '$ref')` typechecks (P-002) on the config schema (P-009).
3. Wire into `config/jsonSchema.ts` to emit the config JSON Schema for docs/tooling.
4. Smoke test: generated schema from a small zod object yields the expected `properties`/`required`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `zod-to-json-schema` installed; conversion typechecks
- [ ] Emits config JSON Schema (P-009) for tooling/docs
- [ ] Smoke test passes; used by P-139/297/298

**Tests Required:** `config` test: `it('json schema from zod')`.

**Dependencies:** P-038. Uses P-009/P-015.

**Handoff Notes:** Next: P-040 core dev deps (@types/node + vitest).

---




### P-040: Core Dev Dependencies - @types/node, vitest

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-039

**Context:** Add core dev dependencies: `@types/node` (Node API typings for strict mode P-002) and `vitest` (the test runner the core suite uses P-004). These make `bun --filter @repo-stitcher/core test` and `typecheck` work with strict, correct types.

**Files to Create/Modify:**
- `packages/core/package.json` (add dev deps `@types/node`, `vitest`)

**Implementation Steps:**
1. `bun add -d @types/node vitest --filter @repo-stitcher/core` (version aligned with the root P-004/P-058).
2. Verify `import { describe, it, expect } from 'vitest'` typechecks + `bun run typecheck` green.
3. Add a core `vitest.config.ts` including `bun:sqlite`-safe environment and coverage thresholds (P-259).
4. Smoke: a trivial test file runs under `bun --filter @repo-stitcher/core test`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `@types/node` + `vitest` dev deps installed
- [ ] Directions typecheck; `bun test` runs a sample in core with coverage thresholds
- [ ] Config aligns with P-004/P-058/P-259

**Tests Required:** (the runner itself) — `it('runs')`.

**Dependencies:** P-039. Aligned with P-004/P-058/P-259.

**Handoff Notes:** Next: P-041 (cli: commander). This closes the core dev-dependency block.

---




### P-041: CLI Dependency - commander

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-040

**Context:** Add `commander` to `packages/cli` — the command/flag/argument framework for the CLI epic (P-189–P-207): `init`, `add`, `merge`, `serve`, `status`, `doctor`, `license`, `deps`, and later `budget`/`plugin`/`compliance-export`. Provides typed options, subcommands, and `--help` that tie into the help registry (P-202/P-316).

**Files to Create/Modify:**
- `packages/cli/package.json` (add `commander`)

**Implementation Steps:**
1. `bun add commander --filter @repo-stitcher/cli`.
2. Verify `import { Command } from 'commander'` + `.command()/.option()/.action()` typecheck (P-002 strict).
3. Wire the root `stitch` program (P-189) to parse subcommands with typed options.
4. Smoke: `stitch --help` lists subcommands; a scaffold command parses options.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `commander` installed; typed Command/program works
- [ ] Root `stitch` program declared (P-189); `--help` + options parse
- [ ] Typecheck green

**Tests Required:** `cli` test: `it('parses subcommand options')`, `it('help lists')`.

**Dependencies:** P-040. Used by P-189; owned by aradhy.

**Handoff Notes:** Hand off to aradhy (packages/cli owner). Next: P-042 ink.

---




### P-042: CLI Dependency - ink + @inkjs/ui

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-041

**Context:** Add `ink` + `@inkjs/ui` to `packages/cli` — React-based terminal UI for interactive pickers (P-198), progress renders (P-199), and TUI panels. Built on React so web engineers can reason about terminal UI with familiar components.

**Files to Create/Modify:**
- `packages/cli/package.json` (add `ink`, `@inkjs/ui`, `react` peer for ink)

**Implementation Steps:**
1. `bun add ink @inkjs/ui --filter @repo-stitcher/cli` (+ react/react-dom as ink requires, per ink docs).
2. Verify `import { render, Text } from 'ink'` + `useInput`/`useApp` typecheck (P-002).
3. Scaffold a wrapper that renders an ink app in the CLI (non-TTY fallback to plain text, P-044).
4. Smoke: render a `<Text>` tree and assert the output string (ink `renderToString`).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `ink` + `@inkjs/ui` (+react peer) installed
- [ ] Render + `useInput` typecheck; non-TTY falls back plain
- [ ] `renderToString` smoke passes; used by P-198/199

**Tests Required:** `cli` test: `it('renders ink to string')`.

**Dependencies:** P-041. Used by P-198/199; owned by aradhy.

**Handoff Notes:** Hand off to aradhy. Next: P-043 elysia (server).

---




### P-043: CLI Dependency - elysia

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-042

**Context:** Add `elysia` to `packages/cli` — the fast Bun-native HTTP/WS framework behind `stitch serve` (P-193), exposing the REST API (P-297) and WebSocket event stream (P-241) on :3434 for the web UI and CLI client. Elysia gives typed routes + native WebSocket support.

**Files to Create/Modify:**
- `packages/cli/package.json` (add `elysia`)

**Implementation Steps:**
1. `bun add elysia --filter @repo-stitcher/cli`.
2. Verify `import { Elysia } from 'elysia'` + `.get()/.ws()/.listen()` typecheck (P-002).
3. Scaffold the serve entry (P-193) with a health route + WS echo (P-241 hook later).
4. Smoke: start server on an ephemeral port, hit `/health`, assert 200; close.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `elysia` installed; routes + ws typecheck
- [ ] `serve` entry scaffold with health + ws (P-193)
- [ ] Smoke test (ephemeral port health 200) passes

**Tests Required:** `cli` test: `it('serves health')`.

**Dependencies:** P-042. Used by P-193/241/297; owned by aradhy.

**Handoff Notes:** Hand off to aradhy. Next: P-044 picocolors.

---




### P-044: CLI Dependency - picocolors

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-043

**Context:** Add `picocolors` to `packages/cli` — lightweight terminal color formatting for status output (P-194), progress (P-199), and error UX (P-201). Minimal dependency, auto-disables when non-TTY.

**Files to Create/Modify:**
- `packages/cli/package.json` (add `picocolors`)

**Implementation Steps:**
1. `bun add picocolors --filter @repo-stitcher/cli`.
2. Verify `import pc from 'picocolors'` + `pc.green/red/bold` typecheck (P-002).
3. Add a `theme` helper (P-206) mapping semantic levels (ok/warn/err) to colors, honoring no-color env.
4. Smoke: colored string + no-color fallback.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `picocolors` installed; color helpers typecheck
- [ ] Semantic `theme` helper (P-206) + no-color respect (P-044)
- [ ] Smoke passes; used by P-194/199/201/206

**Tests Required:** `cli` test: `it('theme colors'), it('no color')`.

**Dependencies:** P-043. Used by P-206.

**Handoff Notes:** Hand off to aradhy. Next: P-045 configstore.

---




### P-045: CLI Dependency - configstore

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-044

**Context:** Add `configstore` to `packages/cli` — persistent config storage in `~/.stitch` (P-200) for user prefs, provider keys (redacted/P-206), and server settings. Kept inside the CLI so `serve`/CLI share one durable config surface (P-200/P-310).

**Files to Create/Modify:**
- `packages/cli/package.json` (add `configstore`)

**Implementation Steps:**
1. `bun add configstore --filter @repo-stitcher/cli`.
2. Verify `new Configstore(name)` + `.get/.set/.delete` typecheck (P-002).
3. Point it at the `~/.stitch` dir (P-200) and enforce redaction when logging (P-045/P-206 hook to P-010).
4. Smoke: set/get/delete a key round-trips; persists across instances.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `configstore` installed; get/set/delete typecheck
- [ ] Uses `~/.stitch` (P-200); secrets redacted (P-206)
- [ ] Smoke: round-trip + persistence

**Tests Required:** `cli` test: `it('config roundtrip')`.

**Dependencies:** P-044. Used by P-200.

**Handoff Notes:** Hand off to aradhy. Next: P-046 update-notifier.

---




### P-046: CLI Dependency - update-notifier

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-045

**Context:** Add `update-notifier` to `packages/cli` — checks for CLI updates on run and notifies (respecting a no-update flag/env for scripts P-296/305). Surfaces new versions consistently with changelog automation (P-282).

**Files to Create/Modify:**
- `packages/cli/package.json` (add `update-notifier`)

**Implementation Steps:**
1. `bun add update-notifier --filter @repo-stitcher/cli`.
2. Verify `import updateNotifier from 'update-notifier'` + `.notify()` typecheck (P-002).
3. Wire a one-shot check at CLI startup, gated by `--no-update-check`/`STITCH_NO_UPDATE` (off in CI P-296/305).
4. Smoke: notifier constructs with a fake package.json (pinned, no network in tests).

**Required MCPs/Connectors:** npm registry (runtime opt-in).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `update-notifier` installed; notify typechecks
- [ ] Gated by `--no-update-check`/env; disabled in CI (P-296/305)
- [ ] Smoke test passes offline (no real registry)

**Tests Required:** `cli` test: `it('notifier gated')`.

**Dependencies:** P-045. Used at CLI startup.

**Handoff Notes:** Hand off to aradhy. Next: P-047 react/react-dom (web).

---




### P-047: Web Dependency - react + react-dom

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-046

**Context:** Add `react` + `react-dom` (React 18) to `packages/web` — the framework for the web dashboard (P-208–P-237). React 18 + concurrent features anticipated for interactive merge-review flows (diff P-217, WS live events P-223).

**Files to Create/Modify:**
- `packages/web/package.json` (add `react`, `react-dom`, `@types/react`, `@types/react-dom`)

**Implementation Steps:**
1. `bun add react react-dom --filter @repo-stitcher/web` + `bun add -d @types/react @types/react-dom`.
2. Verify `import { render } from 'react-dom/client'` + a `<App/>` typechecks (P-002 strict).
3. Scaffold the Vite entry (P-208 mounts it) with a minimal root component.
4. Smoke: `renderToString(<App/>)` yields the expected markup.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `react`/`react-dom` (+types) installed at React 18
- [ ] Entry scaffold typechecks; Vite mounts it (P-208)
- [ ] Smoke: SSR string matches

**Tests Required:** `web` test: `it('renders root')`.

**Dependencies:** P-046. Used by P-208; owned by aradhy.

**Handoff Notes:** Hand off to aradhy. Next: P-048 vite + plugin-react.

---




### P-048: Web Dependency - vite + @vitejs/plugin-react

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-047

**Context:** Add `vite` + `@vitejs/plugin-react` to `packages/web` — the build tool and dev server (HMR on :5173 proxied to the CLI server :3434, P-193). Fast, Bun-compatible, and the basis for the static build served by the CLI (P-235).

**Files to Create/Modify:**
- `packages/web/package.json` (add `vite`, `@vitejs/plugin-react`)
- `packages/web/vite.config.ts` (new, dev-only)

**Implementation Steps:**
1. `bun add -d vite @vitejs/plugin-react --filter @repo-stitcher/web`.
2. Create `vite.config.ts` with the react plugin, the :3434 proxy (P-193), and a build `outDir` consumable by P-235.
3. Verify `bun --filter @repo-stitcher/web run dev` starts and `run build` emits dist.
4. Wire the web app entry (P-208).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `vite` + plugin-react installed; config with :3434 proxy (P-193)
- [ ] `dev` starts, `build` emits dist (P-235-ready)
- [ ] Typecheck green

**Tests Required:** (via build) — `it('builds')` in CI.

**Dependencies:** P-047. Used by P-208/235; owned by aradhy.

**Handoff Notes:** Hand off to aradhy. Next: P-049 tailwind + postcss + autoprefixer.

---




### P-049: Web Dependency - tailwindcss + postcss + autoprefixer

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-048

**Context:** Add `tailwindcss` + `postcss` + `autoprefixer` to `packages/web` — utility-first styling with PostCSS processing for the design tokens (P-209) and responsive layout (P-227). Backs the dashboard Look and the dark-mode (P-226) tokens.

**Files to Create/Modify:**
- `packages/web/package.json` (add `tailwindcss`, `postcss`, `autoprefixer`)
- `packages/web/tailwind.config.cjs`+`postcss.config.cjs` (new)

**Implementation Steps:**
1. `bun add -d tailwindcss postcss autoprefixer --filter @repo-stitcher/web`.
2. Add tailwind + postcss configs with the design-token color scales (P-209) and dark-mode variant (P-226).
3. Verify directives (`@tailwind base/components/utilities`) resolve in the entry CSS.
4. Typecheck + build green.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] tailwind/postcss/autoprefixer installed + configured
- [ ] Design tokens (P-209) + dark-mode (P-226) wired in config
- [ ] Directives resolve; build green

**Tests Required:** (via build) — `it('styles resolve')`.

**Dependencies:** P-048. Used by P-209/226/227.

**Handoff Notes:** Hand off to aradhy. Next: P-050 zustand.

---




### P-050: Web Dependency - zustand

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-049

**Context:** Add `zustand` to `packages/web` — lightweight client-side state for the dashboard: selection state (P-215), job history (P-224), and WS-connected store slices (P-223). A minimal API that composes well with React and the WS client.

**Files to Create/Modify:**
- `packages/web/package.json` (add `zustand`)

**Implementation Steps:**
1. `bun add zustand --filter @repo-stitcher/web`.
2. Verify `import { create } from 'zustand'` + a typed store typechecks (P-002).
3. Scaffold a `useSessionStore` holding merge-wizard state (P-215) as the reference store.
4. Smoke: `getState/setState` + a React hook reads the slice.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (optional state pattern review).

**Acceptance Criteria:**
- [ ] `zustand` installed; typed create + store typechecks
- [ ] `useSessionStore` scaffold (P-215) as reference store
- [ ] Smoke: state read/write via hook

**Tests Required:** `web` test: `it('store read write')`.

**Dependencies:** P-049. Used by P-215/223/224.

**Handoff Notes:** Hand off to aradhy. Next: P-051 @tanstack/react-query.

---




### P-051: Web Dependency - @tanstack/react-query

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-050

**Context:** Add TanStack Query (React Query) to `packages/web` — server-state management: caching, refetch, and invalidation for REST calls to the CLI server (P-297) and WS-snapshot polls (P-223/P-224). Complements zustand (P-050) which holds ephemeral UI state while Query handles async server data.

**Files to Create/Modify:**
- `packages/web/package.json` (add `@tanstack/react-query`)

**Implementation Steps:**
1. `bun add @tanstack/react-query --filter @repo-stitcher/web`.
2. Verify `import { QueryClient, useQuery, useMutation } from '@tanstack/react-query'` typechecks (P-002).
3. Scaffold a `QueryClientProvider` at the app root (P-208) + a `useJobs` query (P-224) feeding job history.
4. Smoke: `useQuery` returns cached data for a mocked fetch; invalidation refetches.

**Required MCPs/Connectors:** REST client (P-297) to serve (P-193).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `@tanstack/react-query` installed; query/mutation typecheck
- [ ] `QueryClientProvider` at root (P-208); `useJobs` scaffold (P-224)
- [ ] Smoke: cache + invalidation; typecheck green

**Tests Required:** `web` test: `it('query caches'), it('invalidate refetch')`.

**Dependencies:** P-050. Used by P-223/224.

**Handoff Notes:** Hand off to aradhy. Next: P-052 react-diff-viewer-continued.

---




### P-052: Web Dependency - react-diff-viewer-continued

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-051

**Context:** Add `react-diff-viewer-continued` to `packages/web` — side-by-side and inline diff rendering for the merge-review diff view (P-217) and the saved-session capture (P-230). Handles the file-by-file diff the orchestrator emits (P-244/P-217).

**Files to Create/Modify:**
- `packages/web/package.json` (add `react-diff-viewer-continued`)

**Implementation Steps:**
1. `bun add react-diff-viewer-continued --filter @repo-stitcher/web`.
2. Verify `import DiffViewer from 'react-diff-viewer-continued'` typechecks (P-002).
3. Scaffold a `DiffView` component (P-217) rendering a unified/split diff with theme tokens (P-209).
4. Smoke: render a small unified diff string and assert marker lines appear.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (diff view styling).

**Acceptance Criteria:**
- [ ] `react-diff-viewer-continued` installed; renders typecheck
- [ ] `DiffView` scaffold (P-217) with theme tokens (P-209)
- [ ] Smoke: diff markers render

**Tests Required:** `web` test: `it('renders diff')`.

**Dependencies:** P-051. Used by P-217.

**Handoff Notes:** Hand off to aradhy. Next: P-053 shiki.

---




### P-053: Web Dependency - shiki

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-052

**Context:** Add `shiki` to `packages/web` — WASM-based syntax highlighting for code in the diff view (P-052/P-217), file trees (P-213/214), and CREDITS/provenance (P-222). Theme-aware so dark mode (P-226) highlights consistently.

**Files to Create/Modify:**
- `packages/web/package.json` (add `shiki`)

**Implementation Steps:**
1. `bun add shiki --filter @repo-stitcher/web`.
2. Verify `import { codeToHtml } from 'shiki'` typechecks (P-002).
3. Scaffold a `Highlight` component wrapping `codeToHtml` with a lighter/dark theme (P-226).
4. Smoke: codeToHtml returns the expected highlighted HTML for a snippet.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `shiki` installed; codeToHtml typechecks
- [ ] `Highlight` component + theme pair (P-226)
- [ ] Smoke passes; used by P-217/213/222

**Tests Required:** `web` test: `it('highlights code')`.

**Dependencies:** P-052. Used by P-217/213.

**Handoff Notes:** Hand off to aradhy. Next: P-054 lucide-react.

---




### P-054: Web Dependency - lucide-react

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-053

**Context:** Add `lucide-react` to `packages/web` — a consistent, tree-shakeable SVG icon set for the dashboard shell (P-210), status indicators (P-221), and empty states. Keeps UI consistent with the design tokens (P-209).

**Files to Create/Modify:**
- `packages/web/package.json` (add `lucide-react`)

**Implementation Steps:**
1. `bun add lucide-react --filter @repo-stitcher/web`.
2. Verify `import { Check, X } from 'lucide-react'` typechecks (P-002).
3. Use icons in a small `StatusIcon` component (P-210/P-221 shell).
4. Smoke: render `<Check/>` produces an svg.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `lucide-react` installed; named icon imports typecheck
- [ ] `StatusIcon` scaffold (P-210/221)
- [ ] Smoke: svg renders

**Tests Required:** `web` test: `it('renders icon')`.

**Dependencies:** P-053. Used by P-210/221.

**Handoff Notes:** Hand off to aradhy. Next: P-055 @radix-ui/*.

---




### P-055: Web Dependency - @radix-ui/*

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-054

**Context:** Add Radix UI primitives (`@radix-ui/react-dialog/select/tabs/tooltip/dropdown-menu/scroll-area`) to the web package (P-047 onwards) for accessible primitives the UI needs: modals (HIL approval P-218, settings P-225), select (pickers P-211/212), tabs (migration wizard P-210/219), tooltips/dropdowns (provenance P-185, job history P-224), and scroll areas (virtualized trees P-232). Radix provides the headless, ARIA-compliant behavior layer; Tailwind (P-049) + the design tokens (P-209) provide styling.

**Files to Create/Modify:**
- `packages/web/package.json` (add `@radix-ui/*` deps)

**Implementation Steps:**
1. Add deps: `bun add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area --filter @repo-stitcher/web`.
2. Build thin wrappers (P-209 token-aware) in `packages/web/src/components/ui/` exposing the primitives with consistent props/theme (P-209/226 dark mode).
3. Wire where used: dialog for P-218/P-225, select for P-211/212, tabs for P-210/219, tooltip/dropdown for P-185/224, scroll-area for P-232.
4. Ensure tree-shaking + no a11y regressions; the wrappers carry `aria` defaults (P-231/055 axe check).
5. `radix-wrappers.test.tsx` (P-047 vitest): each wrapper renders, opens/closes, and passes axe (P-231) with no a11y violations in light/dark (P-209/226).

**Required MCPs/Connectors:** None (frontend).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `@radix-ui/*` deps added + token-aware wrappers (P-209)
- [ ] Wired into P-218/225/211/212/210/219/185/224/232
- [ ] Tree-shaken; axe a11y clean (P-231 light+dark); `radix-wrappers.test.tsx` passes

**Tests Required:** `radix-wrappers.test.tsx`:
- `it('dialog'), it('select'), it('tabs'), it('tooltip'), it('a11y clean')`

**Dependencies:** P-054. Used by P-210-232.

**Handoff Notes:** Next: P-056 consumes this. Ensure `bun run build` succeeds (P-208). No cross-package leaks (P-003).

---
### P-056: Web Dependency - react-hook-form + @hookform/resolvers

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-055

**Context:** Add `react-hook-form` + `@hookform/resolvers` to `packages/web` — performance-focused form state with Zod resolver integration for the settings forms (P-225 provider/model/keys) and merge-wizard inputs. Zod (P-015) remains the single validation source via the resolver.

**Files to Create/Modify:**
- `packages/web/package.json` (add `react-hook-form`, `@hookform/resolvers`)

**Implementation Steps:**
1. `bun add react-hook-form @hookform/resolvers --filter @repo-stitcher/web`.
2. Verify `useForm` + `zodResolver(schema)` typechecks (P-002) against a zod schema (P-009/P-015).
3. Scaffold the settings form (P-225) using `zodResolver`.
4. Smoke: mounting the form registers fields + resolver runs on submit.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] react-hook-form + resolvers installed; useForm + zodResolver typecheck
- [ ] Settings form (P-225) scaffold with zod validation
- [ ] Smoke passes; TypeScript strict green

**Tests Required:** `web` test: `it('form registers'), it('zod rejects')`.

**Dependencies:** P-055. Uses P-015 zod.

**Handoff Notes:** Hand off to aradhy. Next: P-057 sonner.

---




### P-057: Web Dependency - sonner

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-056

**Context:** Add `sonner` to `packages/web` — accessible, promise-based toast notifications for async job events (P-241/P-247): merge completed, license verdict, sandbox pass/fail. Promise-based API pairs with `useMutation` (P-051) for rich success/error toasts.

**Files to Create/Modify:**
- `packages/web/package.json` (add `sonner`)

**Implementation Steps:**
1. `bun add sonner --filter @repo-stitcher/web`.
2. Verify `import { Toaster, toast } from 'sonner'` typechecks (P-002).
3. Mount `<Toaster/>` at the app root (P-208) + a `toast.promise` helper for job mutations (P-247).
4. Smoke: deferred resolve triggers success toast capture.

**Required MCPs/Connectors:** WS events (P-241) → toast.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `sonner` installed; Toaster + toast typecheck
- [ ] `<Toaster/>` at root; `toast.promise` for jobs (P-247)
- [ ] Smoke passes; dark mode (P-226) themed

**Tests Required:** `web` test: `it('toast promise')`.

**Dependencies:** P-056. Used by P-241/247.

**Handoff Notes:** Hand off to aradhy. Next: P-058 react-arborist.

---




### P-058: Web Dependency - react-arborist

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-057

**Context:** Add `react-arborist` to `packages/web` — virtualized, keyboard-navigable file tree for the repo A/B pickers and file trees (P-213/214) and large selection state (P-215). Handles tens of thousands of nodes without freezing the merge-review UI (P-232 virtualized trees).

**Files to Create/Modify:**
- `packages/web/package.json` (add `react-arborist`)

**Implementation Steps:**
1. `bun add react-arborist --filter @repo-stitcher/web`.
2. Verify `Tree`, `NodeRenderer` types typecheck (P-002).
3. Scaffold a `FileTree` component (P-213) feeding checked/selection state (P-215).
4. Smoke: renders a fixture tree with children + selection callbacks; large-list virtualization safe.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `react-arborist` installed; Tree types typecheck
- [ ] `FileTree` scaffold (P-213) with selection state (P-215)
- [ ] Virtualized large trees (P-232); smoke passes

**Tests Required:** `web` test: `it('renders tree'), it('selects'), it('virtualizes')`.

**Dependencies:** P-057. Used by P-213/214/232.

**Handoff Notes:** Hand off to aradhy. Next: P-059 clsx + tailwind-merge.

---




### P-059: Web Dependency - clsx + tailwind-merge

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-058

**Context:** Add `clsx` + `tailwind-merge` to `packages/web` — conditional className composition with tailwind class dedupe/merge for clean component variants (P-209 tokens, P-210 shell, P-226 dark mode). A `cn()` helper becomes the standard for every styled component.

**Files to Create/Modify:**
- `packages/web/package.json` (add `clsx`, `tailwind-merge`)
- `packages/web/src/lib/cn.ts` (new — `cn` helper)

**Implementation Steps:**
1. `bun add clsx tailwind-merge --filter @repo-stitcher/web`.
2. Verify `clsx` + `twMerge` typecheck (P-002).
3. Add `cn(...inputs)` combining both (clsx → twMerge).
4. Smoke: conflicting classes merge correctly (last wins).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `clsx` + `tailwind-merge` installed; `cn` helper added
- [ ] Component-variant composition used across web (P-209/210/226)
- [ ] Smoke: merge semantics correct

**Tests Required:** `web` test: `it('cn merges')`.

**Dependencies:** P-058. Used across web.

**Handoff Notes:** Hand off to aradhy. Next: P-060 root dev deps (vitest+ui).

---




### P-060: Root Dev Dependency - vitest + @vitest/ui

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-059

**Context:** Add `vitest` + `@vitest/ui` at the monorepo root for cross-package test running and coverage (P-004 base + P-259). Enables `bun test` to execute core/cli/web suites from one place, with per-package config and coverage thresholds aggregated.

**Files to Create/Modify:**
- root `package.json` (add `vitest`, `@vitest/ui` dev)
- root `vitest.config.ts` (new — project merging, per-package coverage)

**Implementation Steps:**
1. `bun add -d vitest @vitest/ui` at root.
2. Create root `vitest.config.ts` using `projects` to include core/cli/web configs (each from P-004/P-040) + aggregate coverage (P-259 thresholds).
3. Verify `bun test` runs a trivial suite in each package.
4. Add `vitest --ui` script for the interactive UI during dev.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] vitest + @vitest/ui at root; projects config merges package suites
- [ ] Aggregate coverage thresholds (P-259) enforced
- [ ] `bun test` green across packages; `--ui` script present

**Tests Required:** (runner) — `it('runs all packages')`.

**Dependencies:** P-059. Aligned with P-004/P-040/P-259.

**Handoff Notes:** Next: P-061 root @types/bun + @types/node.

---




### P-061: Root Dev Dependency - @types/bun, @types/node

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-060

**Context:** Add `@types/bun` + `@types/node` at the monorepo root for correct typing of Bun globals (`Bun`, `bun:sqlite` P-030) and Node APIs under strict mode (P-002/P-040). Ensures `bun:sqlite`, `process.env`, and Node fs types resolve consistently in core/cli/web.

**Files to Create/Modify:**
- root `package.json` (add `@types/bun`, `@types/node` dev)
- root `tsconfig.base.json` `types` field (modify — include `bun` + `node`)

**Implementation Steps:**
1. `bun add -d @types/bun @types/node` at root.
2. Update `tsconfig.base.json` (P-002) `types: ["bun", "node"]` so global typings are available without per-file imports.
3. Verify `import { Database } from 'bun:sqlite'` (P-030) + `import { readFile } from 'node:fs/promises'` typecheck.
4. Run `bun run typecheck` across the monorepo.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] @types/bun + @types/node at root; tsconfig `types` updated (P-002)
- [ ] bun:sqlite + node:fs typings resolve; typecheck green monorepo-wide

**Tests Required:** (typecheck) — `it('types')` passes via `bun run typecheck`.

**Dependencies:** P-060. Aligned with P-002/P-030.

**Handoff Notes:** Next: P-062 tsup.

---




### P-062: Root Dev Dependency - tsup

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-061

**Context:** Add `tsup` at the monorepo root — builds `packages/core` to ESM + CJS + type declarations from `src` (P-001/P-013 boundary) for the npm publish (P-278) and CLI consumption. Fast esbuild-based bundler aligned with the stack.

**Files to Create/Modify:**
- root `package.json` (add `tsup` dev)

**Implementation Steps:**
1. `bun add -d tsup` at root.
2. Add a `build` script (P-001/278) using `tsup` with `dts: true` and dual ESM/CJS outputs for `packages/core`.
3. Verify `bun run build` emits `dist` (js + .d.ts) from the core public surface (P-011/P-013).
4. Confirm the emitted types resolve for an external import.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] tsup installed; core `build` script emits ESM+CJS+dts (P-278)
- [ ] Public-surface (P-013) types resolve; build green

**Tests Required:** (via build) — `it('builds')` in CI.

**Dependencies:** P-061. Used by P-278.

**Handoff Notes:** Next: P-063 nock / mockttp.

---




### P-063: Root Dev Dependency - nock / mockttp

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-062

**Context:** Add HTTP mocking libraries (`nock`, `mockttp`) at root — mock GitHub API (P-101), AI providers (P-144/P-27/P-28), and sandbox registry calls during tests, keeping suites hermetic and offline-safe. Enables deterministic integration tests (P-254) without external network.

**Files to Create/Modify:**
- root `package.json` (add `nock`, `mockttp` dev)
- `packages/core/test-utils/http.ts` (new — shared mock helpers)

**Implementation Steps:**
1. `bun add -d nock mockttp` at root.
2. Add shared `test-utils/http.ts` exposing `mockGet/mockPost/assertNoPending` helpers (disposable, auto-cleanup).
3. Smoke: mock a GitHub-style GET, assert the fetch/octokit call hits it and no pending mocks remain.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] nock + mockttp installed; shared mock helpers
- [ ] Mocked HTTP call verified + pending-mock assertion
- [ ] Smoke passes; used by P-101/144/254

**Tests Required:** `test-utils` test: `it('mocks http')`.

**Dependencies:** P-062. Used by P-101/144/254.

**Handoff Notes:** Next: P-064 fixture-repo generator (deep, skipping).

---




### P-064: Root Dev Dependency - fixture-repo generator

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-060

**Context:** A script that generates deterministic fixture repositories for integration testing (P-238/P-254) across languages/ecosystems (P-103), license types (P-118), and git shapes (nested dirs, binary P-082, ignores P-083, multi-origin P-079). Reused by the Git Core (P-087), Deps (P-117), License (P-130), and E2E (P-255) fixtures.

**Files to Create/Modify:**
- `scripts/generate-fixtures.ts` (new)

**Implementation Steps:**
1. `generate-fixtures.ts`: config-driven spec (a fixture manifest) producing temp repos under a cache dir (P-303-adjacent), each with commit history, tags, and the requested files/ecosystem/license.
2. Deterministic: fixed content + stable commit authors/dates (P-282) so blame/CREDITS/provenance (P-079/181) match snapshots (P-260).
3. Support the shapes tests need: empty repo, single/multi-ecosystem files (P-103), binary payload (P-082), nested `.gitignore`s (P-083), LICENSE variants (P-118/125).
4. Cleanup/`--clean` safe (P-081/085); script is linted+typed (P-003) and not shipped.
5. `generate-fixtures.test.ts` (P-060 vitest): generates each fixture, asserts determinism (two runs byte-identical).

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Config-driven fixture generation: ecosystems P-103, licenses P-118, git shapes
- [ ] Deterministic runs (P-282) aligned to snapshots (P-260/P-260 env)
- [ ] Lint/type-clean (P-003); `--clean` safe (P-085); reused by P-087/117/130/255

**Tests Required:** `generate-fixtures.test.ts`:
- `it('gen ecs'), it('gen license'), it('deterministic'), it('clean')`

**Dependencies:** P-060. Used by P-087/117/130/255.

**Handoff Notes:** Next: P-065 system dep doc - git >= 2.40.

---
### P-065: System Dependency Doc - git >= 2.40

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-064

**Context:** Document the minimum `git` version requirement (>=2.40) for `git merge --allow-unrelated-histories` (ort backend, P-072) and `git-filter-repo` (P-070). Ensures the Git Core epic (P-069–P-087) runs against a git recent enough for the merge strategy stitch relies on, surfaced by `stitch doctor` (P-068/P-195).

**Files to Create/Modify:**
- `docs/system/git-version.md` (new)
- Reference from `stitch doctor` version check (P-068) + SECURITY/AGENTS notes

**Implementation Steps:**
1. Write the version doc: why >=2.40 (ort merge backend stability, `--allow-unrelated-histories` behavior), how to verify (`git --version`), and install/upgrade notes per OS.
2. Wire a `MIN_GIT_VERSION = '2.40.0'` constant in `core` (semver compare P-019) used by doctor (P-068).
3. Add the check to `stitch doctor` (P-068/P-195): warn+instructions if below, and a clear `Result` error (P-011) if critical ops require it.
4. Cross-reference from AGENTS/TECH_STACK install docs.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `docs/system/git-version.md` documents >=2.40 + verify/install
- [ ] `MIN_GIT_VERSION` constant (P-019 semver) feeds doctor (P-068)
- [ ] Doctor warns below-min with instructions; error surfaces in `--json` (P-194)

**Tests Required:** `doctor` test: `it('flags old git')`.

**Dependencies:** P-064. Uses P-019/P-068/P-195.

**Handoff Notes:** Next: P-066 stitch doctor verifier (deep, in place).

---




### P-066: System Dependency Doc - git-filter-repo (pip)

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-065

**Context:** Document `git-filter-repo` (Python/pip) as a required system dependency and integrate it into the doctor verifier (P-068). It is the engine behind path extraction/history rewrite (P-070) and the subtree/filter provenance paths, so the doc must capture install, version, and fallback behavior.

**Files to Create/Modify:**
- `docs/system/git-filter-repo.md` (new)

**Implementation Steps:**
1. Write `docs/system/git-filter-repo.md`: purpose (P-070 filter/extract, P-079 provenance), install (`pip install git-filter-repo`) + PATH note, min version, why it must NOT be aliased over `git filter-branch` (P-282 determinism), and the check `git filter-repo --version`.
2. Add a `verify_git_filter_repo` helper in the doctor (P-068) reusing P-065's shape: capability, version, `--version` probe, typed result (P-203).
3. Note the offline/Docker fallback (P-067/P-169 image includes it) so sandbox (P-168) runs don't fail at filter-repo.
4. Update docs index (P-268/P-270) to link it with P-065/P-067.
5. `doctor.test.ts` addition: detects missing/misconfigured git-filter-repo and reports a clear fix (P-316).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `docs/system/git-filter-repo.md` with install/version/fallback (P-070/282)
- [ ] Doctor verifies it (P-068) beside P-065; Docker fallback noted (P-067/169)
- [ ] Test: missing → clear fix (P-316)

**Tests Required:** `doctor.test.ts`:
- `it('present ok'), it('missing hints fix'), it('version check')`

**Dependencies:** P-065. Used by P-068/070/079.

**Handoff Notes:** Next: P-067 system dep doc - Docker.

---
### P-067: System Dependency Doc - Docker

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-066

**Context:** Document Docker as a required system dependency for the sandbox backend (P-168), and wire its verification into the doctor (P-068). Covers install, `docker info` capability, and the fallback to the base image (P-008/P-169) when Docker is unavailable (GH Actions P-178).

**Files to Create/Modify:**
- `docs/system/docker.md` (new)

**Implementation Steps:**
1. Write `docs/system/docker.md`: purpose (P-168/169 ephemeral images), install Windows/macOS/Linux, `docker info` capability check, daemon-running requirement, and the CI fallback (P-178 GH Actions) when local Docker is missing.
2. Add `verify_docker` to the doctor (P-068): `docker info` + engine version probe, typed result (P-203) with a fix hint (P-316) if the daemon isn't running.
3. Note the base image (P-008) built on P-264 Docker CI matches what the sandbox pulls (P-169), keeping dev/prod parity.
4. Update docs index (P-268/270) linking P-065/P-066/P-067.
5. `doctor.test.ts` addition: daemon down → hint to start Docker Desktop; engine present → ok.

**Required MCPs/Connectors:** System Docker (probed).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `docs/system/docker.md` with install/capability/CI fallback (P-178/169)
- [ ] Doctor verifies daemon (P-068) beside P-066; parity with P-008/P-264
- [ ] Test: daemon down → clear hint (P-316)

**Tests Required:** `doctor.test.ts`:
- `it('daemon ok'), it('daemon down hints'), it('engine version')`

**Dependencies:** P-066. Used by P-068/168/169.

**Handoff Notes:** Next: P-068 stitch doctor - system dependency verifier.

---
### P-068: stitch doctor - System Dependency Verifier

**Owner:** inbesat | **Wave:** 0 | **Depends On:** P-067

**Context:** Implement `stitch doctor` — the CLI command (P-189-adjacent) that verifies all system dependencies are installed and functional: `git` >=2.40 (P-065), `git-filter-repo` (P-070 requirement), Docker (P-029/P-065), and, in optional modes, Ollama/local AI (P-140/P-301) and a reachable GitHub token. It's the first thing a user runs (P-195) and gates setup.

**Files to Create/Modify:**
- `packages/core/src/system/doctor.ts` (new — checks, results)
- `packages/cli/src/commands/doctor.ts` (new — reuses `core` via public API, P-013)

**Implementation Steps:**
1. `core/system/doctor.ts`: a deterministic, ordered list of `DependencyCheck { id, label, check(): Promise<Result<{pass, detail}>>, critical }`:
   - `git` (version >= P-065 min), `git-filter-repo` (P-070), `docker` (P-029 daemon reachable via `docker.ping()` P-168, non-critical w/ GH fallback P-178), optional `ollama` (P-301) + GitHub token presence (P-206) when configured.
2. Execute checks concurrently (P-031 p-limit), aggregate into a `DoctorReport` (P-194-`--json` shape).
3. Render in the CLI (P-044 colors): pass/fail + hint lines; exit nonzero if any critical check fails, else 0.
4. Wire into CLI `doctor` (P-195) and the `init` first-run (P-190).
5. `doctor.test.ts` (mocked): each check pass/fail, aggregation, critical-exit, `--json` shape, version compare (P-019).

**Required MCPs/Connectors:** Docker daemon probe (P-029/P-168), optional local AI (P-301).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Ordered check list (git/git-filter-repo/docker/optional ollama+token) with `Result`
- [ ] `DoctorReport` + CLI render (P-044) + `--json` (P-194); critical-gated exit code
- [ ] Wired to CLI `doctor` (P-195) + `init` first-run (P-190)
- [ ] `doctor.test.ts` (mocked) passes

**Tests Required:** `doctor.test.ts`:
- `it('git version')`, `it('filter repo')`, `it('docker probe')`, `it('aggregate critical')`, `it('json shape')`

**Dependencies:** P-067. Uses P-019/P-065/P-029/P-195.

**Handoff Notes:** Doctor is the setup gate — keep checks deterministic, non-interactive, and safe to run in CI.

---




### P-313: Advanced - v1.0.0 Release Checklist

**Owner:** inbesat | **Depends On:** P-312

**Context:** Prepare the 1.0.0 release. This phase is a documentation + validation phase (no new product surface): an exhaustive release checklist capturing every pre-1.0 gate — correctness (all core tests green, P-253–P-267), security (SECURITY.md P-265, secrets scan, audit), licensing completeness (P-114–P-132 incl. compliance export P-307), docs (P-268–P-282 complete + ROADMAP P-312), performance (bench P-309 within baseline), DX polish (install one-command P-190/P-195), provenance integrity (P-181–P-188), and packaging/publish (npm P-263, container P-262, extension P-300). It codifies the definition of "v1.0.0 is done."

**Files to Create/Modify:**
- `docs/release/checklist-v1.0.0.md` (new)
- `docs/release/README.md` (new, optional index)
- Wire into CONTRIBUTING (P-269) + CI release workflow (P-263)

**Implementation Steps:**
1. Draft `checklist-v1.0.0.md` with checked gate sections, each mapping to the owning phase(s) and the evidence required:
   - Correctness (P-253–P-267 green), Perf (P-309), Security (P-265 + secrets scan), License (P-114–P-132 + P-307 export), Provenance (P-181–P-188), Docs (P-268–P-282 + P-312), DX (P-195 doctor + one-command install), Package/publish (P-263 npm, P-262 container, P-300 ext).
2. Each checklist item = a checkbox with a concrete command/test to prove it (exit-0 test suites, `stitch doctor --all`, `compliance-export --verify`, bench `--ci`, secrets grep in CI output) — make it *runnable*, not vibes.
3. Add a "release-blockers" section (fail on: any red test, unverified SECURITY, missing compliance export, unknown provenance, publish mismatch).
4. Wire CONTRIBUTING (P-269) to link the checklist; add to the CI release workflow (P-263) a step asserting the checklist's key gates (tests+bench+secrets) before publish.
5. Document the versioning/CHANGELOG flow (P-282) as part of the checklist order.

**Required MCPs/Connectors:** CI (P-260) for the automated gates.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `checklist-v1.0.0.md` with runnable, evidence-backed gates per area
- [ ] Release-blockers section (tests/security/compliance/provenance/publish)
- [ ] Wired into CONTRIBUTING (P-269) + CI release workflow (P-263) automated gates
- [ ] Every item has a concrete command/test to prove it
- [ ] Versioning/CHANGELOG (P-282) integrated into the order

**Tests Required:** (validated in P-318) — checklist gates are asserted by CI.

**Dependencies:** P-312. All phases through P-267 + P-262/263.

**Handoff Notes:** Next: P-314 release retrospective. The checklist makes "v1 is done" verifiable, not aspirational — tie every gate to a runnable command.

---




### P-314: Advanced - Project Retrospective

**Owner:** inbesat | **Depends On:** P-313

**Context:** Learn from the build. This phase is a documentation phase: a written retrospective capturing what worked, what didn't, and what to change during the v1.0.0 build — process (batch elaboration, planning rigor P-001/P-002, checker 9/9 discipline), architecture wins (single source-of-truth master plan, wave-0 chunking P-004, SDK-first), pain points (epic-boundary leaps, checker only checking headers not depth, big web epic), and concrete recommendations for v1.x planning (tighten the checker depth check, smaller epics, more handoff notes, run graphify earlier for cross-phase deps).

**Files to Create/Modify:**
- `docs/release/retrospective-v1.0.0.md` (new)
- `docs/ROADMAP.md` (append "Post-1.0" notes if applicable)

**Implementation Steps:**
1. Gather inputs: git history (P-282) for scope, PROGRESS tracker, the deepen batch scripts, the checker script's limitations, and spot-checked PR/review findings.
2. Write sections: `How it went` (milestones + timeline), `What worked` (source-of-truth plan, checker verification cadence, batch-by-batch tracking, SDK-first), `What could be better` (checker misfire on depth — it reports 9/9 for all phases regardless; web epic size; epic-boundary dependency leaps requiring cross-checks; occasional mojibake/encoding friction), `Recommendations` (upgrade checker to validate *depth* per section, split large epics, strengthen cross-phase dependency index, earlier graphify for adjacency, more rigorous handoff notes).
3. Keep it actionable + honest; each recommendation has an owner-or-owned-by-consensus + a "when" (next plan).
4. Append a short "Post-1.0" note to ROADMAP (P-312) pointing at the recommendations.
5. Link from docs/README + CONTRIBUTING (P-269) so the next plan actually absorbs it.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `retrospective-v1.0.0.md` covering what worked / what didn't / recommendations
- [ ] Concrete, actionable recommendations with owners + "when"; honest about checker depth limitation
- [ ] "Post-1.0" note appended to ROADMAP (P-312); linked from README + CONTRIBUTING (P-269)
- [ ] Uses git history (P-282) + PROGRESS as evidence

**Tests Required:** (none; documentation phase) — manual consistency check vs PROGRESS.

**Dependencies:** P-313. P-282 evidence, P-312.

**Handoff Notes:** Next: P-315 (deprecation cleanup). The retrospective exists to make the *next* plan better — write it to be read by the person who writes v1.x.

---




### P-315: Advanced - Deprecation Lifecycle

**Owner:** inbesat | **Depends On:** P-314

**Context:** Retire features cleanly. This phase formalizes a deprecation lifecycle for features/config/CLI-flags that are superseded (e.g. by P-310 config migration, plugin replacements P-308): a registry of deprecated items, a 3-state cycle (deprecate → remove-after-version), deprecation warnings on use, removal scheduling tied to the version plan (P-282) + ROADMAP (P-312), and a migration guide per deprecated item (pointing to the replacement).

**Files to Create/Modify:**
- `packages/core/src/deprecations/registry.ts` (new)
- `packages/core/src/deprecations/__tests__/deprecations.test.ts` (new)
- CLI flag/command + config key deprecation wiring + docs (P-282)

**Implementation Steps:**
1. `registry.ts` — one entry per deprecated item: `{key, kind:'flag'|'command'|'configKey'|'apiField', introduced, deprecatedAt, removalVersion, message, replacement}`; items are versioned so removal is predictable (P-282).
2. Runtime: when a deprecated flag/command/config is used, emit a warning (P-194 stderr; web banner P-225) with the replacement + removal version; `--no-warn` opt-out reserved.
3. Cycle policy: `deprecate` (warn) for N minor versions → `remove` at `removalVersion` (removal = hard error P-203 telling them to migrate, never silent). Tie into P-310 migrations for config-key removal so data survives.
4. CLI: `stitch deprecations list` (registry contents + removal versions); removal candidates scanned by CI against a "will break at version" report (P-282).
5. `deprecations.test.ts`: warning on use + replacement mention, removal-version hard error, cycle enforcement (cannot remove before removalVersion), config-key deprecation chains to a P-310 migration, list output.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Registry (kind/deprecatedAt/removalVersion/replacement).
- [ ] Warn-on-use with replacement + removal version; removal = hard error (P-203)
- [ ] removalNever-before-removalVersion enforced; config-key removal chains to P-310 migration
- [ ] `stitch deprecations list`; CI "will break at version" report (P-282)
- [ ] `deprecations.test.ts` passes

**Tests Required:** `deprecations.test.ts`:
- `it('warns')`, `it('removal hard error')`, `it('cycle enforced')`, `it('config migration chain')`, `it('list')`

**Dependencies:** P-314. Versions P-282, config P-200/310, CLI P-189–P-207.

**Handoff Notes:** Next: P-316 help & docs UX. Deprecations are promises — keep them versioned, predictable, and always point users to the replacement (with a migration path for config).

---




### P-316: Advanced - Help & Docs UX

**Owner:** aradhy | **Depends On:** P-315

**Context:** Make stitch self-guiding. This phase sweeps the command/UI help surfaces so the product teaches itself: rich `--help`/examples per command (P-189–P-207), `stitch explain <concept>` (provenance, license verdict, stitch scope, sandbox, budget) returning a short Markdown answer generated from the docs (P-268–P-282), contextual first-run guidance (P-190/P-198), and web empty-states that link to the right help section (P-208–P-237). DX-first: a user should rarely need to leave stitch.

**Files to Create/Modify:**
- `packages/core/src/help/` (new — explain, help registry)
- `packages/core/src/help/__tests__/help.test.ts` (new)
- CLI `--help`/`stitch explain` + web help/empty states + docs

**Implementation Steps:**
1. `helpRegistry` — a concept→doc-snippet map (provenance, licenseVerdict, scope, sandbox, budget, RBAC, SSO, plugin, complianceExport) each with `{summary, body}` sourced from the docs; `explain(concept)` returns a short Markdown blurb + doc links.
2. CLI: augment every command's `--help` with one-line + a single runnable example (asserted by a doc-test harness in CI P-260); `stitch explain <concept>` prints the snippet (P-194 render); `stitch help` lists concepts.
3. Web (P-208–P-237): each empty-state / error (P-203) maps to a help entry; a "?" popover links to `explain`-equivalent + docs; keyboard `?` opens searchable help (fuzzy over concepts).
4. First-run (P-190/P-198): after `init`, print a 3-step "what you can do next" hint block (deterministic P-282).
5. `help.test.ts`: `explain` returns non-empty summary for every registered concept + falls back gracefully on unknown, every CLI command has a one-line + example (doc-test), web empty-state→help mapping completeness, `--help` examples are runnable (smoke).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (help/empty-state design review, optional).

**Acceptance Criteria:**
- [ ] Concept→doc help registry; `stitch explain <concept>` + help list (+ fallback on unknown)
- [ ] Every command `--help` has one-line + runnable example (doc-test in CI P-260)
- [ ] Web empty-states/errors (P-203) link to help; `?` searchable popover
- [ ] First-run (P-190/198) next-steps hint block (deterministic P-282)
- [ ] `help.test.ts` passes

**Tests Required:** `help.test.ts`:
- `it('explain concept')`, `it('fallback')`, `it('help one line example')`, `it('empty state map')`, `it('runnable smoke')`

**Dependencies:** P-315. CLI P-189–P-207, web P-208–P-237, docs P-268–P-282.

**Handoff Notes:** Next: P-317 error recovery. Help is the cheapest "feature" — invest so users self-serve (P-002) instead of filing issues.

---




### P-317: Advanced - Error Recovery

**Owner:** inbesat | **Depends On:** P-316

**Context:** Turn failures into recoveries. This phase hardens failure handling: at each pipeline stage an error (P-203) triggers a recovery path — a cached/retried step (P-303/P-139), a resumable job (P-246), a checkpointed sandbox retry (P-176), a partial-result fallback where safe (P-301), a clear "what happened + how to fix" message (P-316 help), and a `--resume-from <stage>` flag. No failure dead-ends without an actionable next step.

**Files to Create/Modify:**
- `packages/core/src/recovery/` (new — strategies, resume, checkpoint)
- `packages/core/src/recovery/__tests__/recovery.test.ts` (new)
- Pipeline (P-238) + stage wrappers + CLI `--resume-from`

**Implementation Steps:**
1. `strategy` per stage: clone (P-103) → retry + cache; deps (P-104–P-113) → cached-resolution fallback (P-179); license (P-114–P-132) → vendored-data fallback (P-119); AI (P-133–P-147) → retry/backoff (P-139) then cheap-model degrade (P-146/301, never silent); sandbox (P-168–P-180) → checkpoint retry (P-176 w/ cache P-179); merge (P-238) → resume-from previous output (P-192/P-244).
2. **Checkpoint**: each stage persists a resume-point (SQLite P-026 + P-205) so a failed job can continue from the last good stage (P-246) — determinism preserved (P-282).
3. `--resume-from <stageId>`: bypass earlier stages using their persisted outputs (valid only if output hash matches P-250/181); a mismatch → error telling them to re-run (P-203).
4. Guidance: every failure message ends with "Fix" + a verified recovery action + a link into `explain` (P-316); the run summary (P-247) marks which stages were resumed.
5. `recovery.test.ts`: per-stage strategy triggers, retry/cache fallback, checkpoint write/resume, `--resume-from` bypass + hash-mismatch guard, resumed-run summary labels, no-dead-end invariant (every handled error has a recovery verb).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** investigate (only for genuinely unexpected errors; otherwise this phase's strategies apply).

**Acceptance Criteria:**
- [ ] Per-stage recovery strategy (retry/cache/fallback/checkpoint/resume)
- [ ] Checkpoint SDK (P-026/P-205) + resumable jobs (P-246)
- [ ] `--resume-from <stageId>` bypass + output-hash guard (P-250/181)
- [ ] Every handled failure ends with actionable Fix + `explain` link (P-316); resumed stages labeled (P-247)
- [ ] No-dead-end invariant enforced; `recovery.test.ts` passes

**Tests Required:** `recovery.test.ts`:
- `it('stage strategy')`, `it('cache fallback')`, `it('checkpoint resume')`, `it('resume from')`, `it('hash mismatch')`, `it('no dead end')`

**Dependencies:** P-316. Errors P-203, retry P-139, cache P-303/179, resume P-246/238.

**Handoff Notes:** Next: P-318 project finalize (final phase). Recoverable failure is the difference between a tool people trust and one they give up on — never dead-end, always offer the next move.

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



### P-071: Git Core - tagRename Helper

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-070

**Context:** A helper that reads a repo's existing tags, renames/namespaces them under a per-source prefix (e.g., `repo-a/`), and records them for the provenance map (P-079) — so tags from A and B don't collide in the merged child (P-072) and CREDITS/SBOM attribution stays correct (P-182/183). Feeds the deterministic merge (P-282).

**Files to Create/Modify:**
- `packages/core/src/git/tagRename.ts` (new)

**Implementation Steps:**
1. `listTags(repoPath)` → `Result<string[]>` via `git tag --list` with sort (P-080 parity).
2. `renameTags(repoPath, { prefix })` → `Result<TagMap<TagId, string>>`: rewrite each `v1.2.3` → `repo-a/v1.2.3`, skip collisions (P-109-style conflict), and return the old→new map for provenance.
3. Preserve tag objects/annotations (annotated tags stay annotated); deterministic ordering (P-282).
4. Emit the mapping to the provenance foundation (P-079/181) so CREDITS (P-182) and merge commits (P-076/077) can reference renamed tags without loss.
5. `tagRename.test.ts` (fixtures P-087/064): lists, renames with prefix, skips collision, annotated preserved, mapping correct.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `listTags`/`renameTags` prefix-namespace + map (P-080 parity); deterministic (P-282)
- [ ] Annotated tags preserved; collision skipped (P-109-style)
- [ ] Mapping feeds P-079/181/182; `tagRename.test.ts` passes

**Tests Required:** `tagRename.test.ts`:
- `it('lists'), it('renames prefix'), it('collision skip'), it('annotated kept')`

**Dependencies:** P-070. Uses P-079/181/080.

**Handoff Notes:** Next: P-072 mergeRepos.

---
### P-072: Git Core - mergeRepos

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-071

**Context:** The core merge operation: after A and B are cloned (P-069), path-filtered (P-070), and prepared (P-071/P-073/074), bring both histories into a unified child repository with namespaced prefixes and correct provenance — producing the tree/commit graph C that the pipeline (P-191/P-192/P-238) then licenses (P-125), verifies in the sandbox (P-168), and pushes (P-078). Must be deterministic (P-282), atomic (P-085), and conflict-aware (P-075).

**Files to Create/Modify:**
- `packages/core/src/git/merge.ts` (new)

**Implementation Steps:**
1. Orchestrate: `mergeRepos(config, { a, b, prefix })` → `Result<MergeResult>` sequencing P-069 clone → P-070 extract (namespaced) → P-071 tag rename → subtree/merge (P-072/073) into the target worktree (P-076).
2. Conflict strategy: collect conflicts (P-075 resolver hook P-075), fail fast with typed `CONFLICT` error (P-203) unless an auto-resolver is configured (P-151 deps).
3. Atomicity: stage on a branch/worktree (P-076), verify clean (P-084) and rollback on failure (P-085) so no partial child escapes; deterministic ordering + stable author/committer (P-282/P-077).
4. Feed a `MergeResult { treeSha, commitShas, tagMap, conflictList }` into the pipeline state (P-238) + provenance (P-079/181).
5. `merge.test.ts` (fixtures P-087/064): end-to-end A+B→C, namespaced paths/tags, conflicts flagged, rollback on failure, determinism.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `mergeRepos` orchestrates P-069→070→071→073/076; namespaced A/B (P-282)
- [ ] Conflicts → typed error (P-203) + P-075 hook; atomic + rollback (P-084/085)
- [ ] `MergeResult` feeds P-238/079/181; `merge.test.ts` passes

**Tests Required:** `merge.test.ts`:
- `it('merges A+B'), it('namespaces'), it('conflict flags'), it('rollback'), it('deterministic')`

**Dependencies:** P-071. Uses P-069/070/073/075/076/238.

**Handoff Notes:** Git Core merge path ready. Next: P-073 subtreeAdd; later P-192 CLI merge.

---
### P-073: Git Core - subtreeAdd (Alternative Path)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-072

**Context:** Provide `git subtree add` as an alternative to filter-repo (P-070) when extracting a whole subdirectory/subtree by prefix is simpler or when history under a prefix must be preserved naturally. Selected by config/strategy (P-243: `git.strategy: 'filter-repo' | 'subtree'`), giving the orchestrator (P-238) a fallback path when filter-repo is unavailable or unsuitable (P-065 doctor).

**Files to Create/Modify:**
- `packages/core/src/git/subtree.ts` (new)

**Implementation Steps:**
1. Implement `subtreeAdd(parentRepo, childRepo, prefix, opts?)` → `Result<string, StitchError>` using `git subtree add --prefix=<prefix> <childRepo> <branch>` (with `--squash` when `opts.squash` is set, else preserve full history).
2. Preflight: ensure the child repo remote is fetchable and the target prefix doesn't already exist (P-012 path check); error early (P-203).
3. Wrap every `git` invocation via the simple-git wrapper (P-016) returning `ResultAsync` (P-011); map CLI errors to typed `StitchError` (P-011 codes).
4. Integrate selection into the merge strategy resolver (P-238 + P-243 config) so `doctor`/config decide filter-repo vs subtree.
5. `subtree.test.ts` (fixtures P-087/P-062): adds a prefix from a child repo (squash + history modes), rejects a pre-existing prefix, surfaces git failure as typed error, works on the strategy-selected path.

**Required MCPs/Connectors:** System `git` binary (P-065).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `subtreeAdd` works with squash and history-preserving modes
- [ ] Preflight guards prefix-exists + remote-fetch; typed errors (P-203)
- [ ] Strategy selectable via config (P-243) alongside filter-repo (P-070)
- [ ] Fixture tests pass

**Tests Required:** `subtree.test.ts`:
- `it('adds squash')`, `it('adds history')`, `it('prefix exists errors')`, `it('strategy selects')`

**Dependencies:** P-072. Uses P-016/P-011/P-243.

**Handoff Notes:** Next: P-074 cherryPickRange.

---




### P-074: Git Core - cherryPickRange

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-073

**Context:** Implement cherry-picking a range of commits from one repo into the child repo — used by the agent (P-154/P-165) to bring specific upstream fixes/features into C with full fine-grained control, and by the merge-resume path (P-246) to replay committed work. Builds on the filter-repo/subtree work (P-070/073) to select which commits land.

**Files to Create/Modify:**
- `packages/core/src/git/cherryPick.ts` (new)

**Implementation Steps:**
1. `cherryPickRange(repoPath, sourceRemote, range, opts?)` → `Result<string[], StitchError>` resolving `<from>..<to>` or a list of SHAs via `git cherry-pick <range>`.
2. Guard: verify the worktree is clean (P-084) before applying; refuse overlapping/un-pushable states (P-081 stash safety).
3. Handle per-commit conflicts (P-075): stop at the first conflict with a typed conflict error carrying the commit, then allow the resolver (P-075/P-160) to take over.
4. Revert path: on failure, `--abort` restores the pre-state (P-085) so no partial picks linger.
5. `cherryPick.test.ts` (fixtures): applies a range, stops+reports on conflict, reverts on failure, returns applied SHAs.

**Required MCPs/Connectors:** System `git` binary.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Applies a commit range; returns applied SHAs
- [ ] Preflight clean-tree (P-084) + stash safety (P-081)
- [ ] Conflict → typed conflict error + resolver handoff (P-075); abort reverts (P-085)
- [ ] Fixture tests pass

**Tests Required:** `cherryPick.test.ts`:
- `it('applies range')`, `it('conflict stops')`, `it('failure reverts')`, `it('returns shas')`

**Dependencies:** P-073. Uses P-084/075/081/085.

**Handoff Notes:** Next: P-075 conflict resolver.

---




### P-075: Git Core - Conflict Resolver

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-074

**Context:** Detect and resolve merge conflicts — auto for simple/semver-resolvable cases (textual cleanups, dependency ranges via P-109) and manual/gated for ambiguous ones routed to the AI agent (P-160 HIL) with a proposed+approve flow (P-218). Central to making a merged child repo (P-072/192) actually build.

**Files to Create/Modify:**
- `packages/core/src/git/conflict.ts` (new)

**Implementation Steps:**
1. `detectConflicts(repoPath)` → `Result<Conflict[]>` via `git status --porcelain` + `git diff --name-only --diff-filter=U`, classifying each (text/ours/theirs/binary P-082).
2. Auto-resolution tiers: (a) whitespace/trailing-newline auto-clean; (b) dependency-manifest collisions delegated to the deps merge (P-108/110/113); (c) `.gitignore` merged (P-083). Anything else → manual/gate path.
3. Manual path: produce a `ConflictResolution` proposal (from AI P-148/P-160) and submit to the HIL approve queue (P-160/P-218) — no auto-write for ambiguous hunks without explicit approval.
4. Apply resolutions via `git checkout --ours/--theirs` + staged write, then `git add`; verify resolved (re-run detect = empty).
5. `conflict.test.ts` (fixtures): detects conflicts, auto-resolves simple ones, defers ambiguous to gate, applies resolution + re-verify.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `detectConflicts` classifies text-ours/theirs/binary (P-082)
- [ ] Auto-tier: whitespace, deps (P-109), gitignore (P-083)
- [ ] Ambiguous → HIL gate (P-160/P-218); never auto-writes ambiguous without approval
- [ ] Apply + re-verify clean; fixture tests pass

**Tests Required:** `conflict.test.ts`:
- `it('detects')`, `it('auto resolves simple')`, `it('gates ambiguous')`, `it('applies reverify')`

**Dependencies:** P-074. Uses P-109/P-160/P-082/083.

**Handoff Notes:** Next: P-076 writeToWorktree.

---




### P-076: Git Core - writeToWorktree

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-075

**Context:** Write files into a git worktree for the AI agent (P-165) and the merge staging (P-238) so result writes happen on a detached/isolated tree, then get committed (P-077) or discarded (P-085). Provides a safe, checked-in-memory staging area without mutating the working copy recklessly.

**Files to Create/Modify:**
- `packages/core/src/git/worktree.ts` (new)

**Implementation Steps:**
1. `writeToWorktree(repoPath, files: Map<rel, content>, opts?)` → `Result<void, StitchError>` writing each file to a staging worktree via `git worktree add` (or a temp dir fallback).
2. Path safety: join via `safeJoin` (P-012) and reject any `..`/absolute escape; refuse writing into `.git` (P-265).
3. Optional: validate the written tree compiles via the sandbox (P-171) before final commit — write→verify→commit.
4. Cleanup: `git worktree remove` on abandon (P-085); ensure no stray untracked files.
5. `worktree.test.ts` (fixtures): writes a set of files at correct relative paths, rejects traversal, removes on abandon.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Writes files to an isolated worktree at safe relative paths (P-012, no `.git` writes)
- [ ] Writable→verify→commit path or discard (P-085) supported
- [ ] Traversal/`.git` escape rejected (P-203/P-265)
- [ ] Fixture tests pass

**Tests Required:** `worktree.test.ts`:
- `it('writes files')`, `it('rejects traversal')`, `it('discards')`, `it('git protected')`

**Dependencies:** P-075. Uses P-012/P-171/P-085.

**Handoff Notes:** Next: P-077 commit with co-author trailers.

---




### P-077: Git Core - Commit with Co-Author Trailers

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-076

**Context:** Commit the staged worktree (P-076) with proper co-author trailers, attributing each originating author from provenance (P-181) so the merged child history (P-192/P-094) preserves credit. `Co-Authored-By: Name <email>` trailers are the machine-readable attribution stitch relies on for CREDITS (P-182) and licence-compliant attribution (P-126).

**Files to Create/Modify:**
- `packages/core/src/git/commit.ts` (new)

**Implementation Steps:**
1. `commitWithTrailers(repoPath, message, coAuthors, opts?)` → `Result<string, StitchError>` resolving to the commit SHA.
2. Build the message: a conventional-commit subject (P-005) + body, then append one `Co-Authored-By: Name <email>` per co-author (deduped, ordered by origin lineage P-181).
3. Determinism: stabilize trailer order + line endings so commit hashing is reproducible (P-282), and never inject untrusted/newlines as trailers (strip CRLF, P-265).
4. Guard: refuse if the index/worktree isn't what we staged (P-084) — commit only intended files.
5. `commit.test.ts` (fixtures): writes a commit, asserts SHA + trailer lines, dedupes authors, strips injection attempts, refuses dirty-mismatch.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Commit returns SHA with deduped `Co-Authored-By` trailers from provenance (P-181)
- [ ] Deterministic trailer order/line endings (P-282); strips CRLF/newline injection (P-265)
- [ ] Refuses committing unintended/dirty state (P-084)
- [ ] Fixture tests pass

**Tests Required:** `commit.test.ts`:
- `it('commits shas')`, `it('appends trailers')`, `it('dedupes authors')`, `it('rejects injection')`, `it('refuses dirty')`

**Dependencies:** P-076. Uses P-005/P-181/P-084.

**Handoff Notes:** Next: P-078 pushToRemote.

---




### P-078: Git Core - pushToRemote

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-077

**Context:** Push the merged child repo (P-192) to its remote — creating the remote repo via GitHub API (P-092) if it doesn't exist, then pushing the target branch. Drives the end-to-end `stitch merge` → child-created-and-pushed flow (P-192/P-094) and the open-PR step (P-094).

**Files to Create/Modify:**
- `packages/core/src/git/push.ts` (new)

**Implementation Steps:**
1. `pushToRemote(repoPath, remoteUrl, branch, opts?)` → `Result<void, StitchError>`.
2. If the remote repo is missing (`@octokit/rest` P-017 `repos.get` 404), create it via `createRepoC` (P-092) — guarded by config `createIfMissing` (P-243) + RBAC (P-293 when multi-user).
3. Push the branch only if its hash is newer/different; `--force` only for explicitly-authorized updates (P-160/296 gate), never by default; refuse force to a protected branch (P-093).
4. Credentials (P-206): remote URL token sourced from config-secret, never logged (P-010/P-037 redaction).
5. `push.test.ts` (mocked octokit+nock P-101/063): creates repo when missing (within RBAC), pushes branch, refuses force on protected, doesn't leak the token in output.

**Required MCPs/Connectors:** GitHub API (P-017) + git.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Pushes target branch; creates repo (P-092) when missing + RBAC-gated (P-293)
- [ ] Refuses unauthorized force; protected-branch guard (P-093)
- [ ] Token never logged (P-206/P-037)
- [ ] Mocked tests pass

**Tests Required:** `push.test.ts`:
- `it('pushes branch')`, `it('creates repo gated')`, `it('refuses force protected')`, `it('no token leak')`

**Dependencies:** P-077. Uses P-092/P-017/P-206/293.

**Handoff Notes:** Next: P-079 blame/provenance map foundation.

---




### P-079: Git Core - Blame/Provenance Map Foundation

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-078

**Context:** Build the file→origin mapping used by provenance (P-181–P-188): track which source repo/commit/author each file in the child repo came from. This is the foundation record that CREDITS (P-182), SBOM (P-183), checksum manifest (P-186), and the UI provenance view (P-185) consume.

**Files to Create/Modify:**
- `packages/core/src/git/blameMap.ts` (new)

**Implementation Steps:**
1. `buildBlameMap(childRepoPath, sources)` → `Result<OriginMap>` mapping each child file → `{ sourceRepo, sourceRef, sha, author, license }` using `git blame --line-porcelain` on the merged tree (attributes resolved through the filter-repo/subtree mapping P-070/073).
2. Persist to the provenance store (P-030 SQLite + P-181) so downstream phases reuse it without re-blame.
3. Deterministic ordering + immutable sha keys (P-282/P-250) for reproducible exports (P-307).
4. Handle merges: a file may have multiple origins — record a list, not a single author.
5. `blameMap.test.ts` (fixtures): maps files to origin, persists to DB, reproduces deterministically, merges multiple origins.

**Required MCPs/Connectors:** System `git` (blame).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Blame map: child file → origins list (repo/sha/author/license)
- [ ] Persisted to provenance store (P-030/P-181); deterministic (P-282)
- [ ] Multi-origin merged files supported
- [ ] Fixture tests pass

**Tests Required:** `blameMap.test.ts`:
- `it('maps origin')`, `it('persists')`, `it('deterministic')`, `it('multi origin')`

**Dependencies:** P-078. Uses P-181/P-070/073.

**Handoff Notes:** Next: P-080 branch management.

---




### P-080: Git Core - Branch Management

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-079

**Context:** Manage branches in the child repo (create, delete, rename) to support the git branching model (P-313), the merge→PR flow (P-094), and the multi-user landed history (P-093). Centralizes branch ops so orchestrator (P-238) and CLI (P-192) use one safe, typed interface.

**Files to Create/Modify:**
- `packages/core/src/git/branches.ts` (new)

**Implementation Steps:**
1. Provide `createBranch(repoPath, name, fromRef?)`, `deleteBranch(repoPath, name, force?)`, `renameBranch(repoPath, oldName, newName)` → `Result<void, StitchError>`.
2. Guards: refuse deleting the currently checked-out branch or a protected branch (P-093); validate branch names (P-012 path/regex) to block injection (P-005 naming + P-265).
3. Deterministic + idempotent where possible (creating an existing branch of the same ref is a no-op, P-250).
4. Integrate the child-repo post-merge setup (P-192) to create the target branch + PR branch per P-313.
5. `branches.test.ts`: create/delete/rename, protected-refuse, current-branch-refuse, idempotent-create, name validation.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] create/delete/rename with protected (P-093) + current-branch guards
- [ ] Branch-name validation (P-012/P-265); idempotent create (P-250)
- [ ] Post-merge branch setup (P-192/P-313)
- [ ] Fixture tests pass

**Tests Required:** `branches.test.ts`:
- `it('create'), it('delete'), it('rename'), it('protected refuse'), it('name validated')`

**Dependencies:** P-079. Uses P-093/P-313.

**Handoff Notes:** Next: P-081 stash safety.

---




### P-081: Git Core - Stash Safety

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-080

**Context:** Stash and restore working changes safely around operations that could otherwise clobber uncommitted work from the AI agent (P-165) or merge stages — the safety net ensuring no user/stitch edits are lost during a merge (P-238) and that rollback (P-085) restores exactly.

**Files to Create/Modify:**
- `packages/core/src/git/stash.ts` (new)

**Implementation Steps:**
1. `safeStash(repoPath)` / `safeStashPop(repoPath)` wrapping `git stash push`/`pop` with an explicit message + index, returning `Result` (P-011).
2. Guard: stash only when `isClean` fails (P-084) — no-op if clean (idempotent P-250); snapshot the stash ref before pop for exact restore.
3. Never auto-pop over a conflict (P-075) — surface a typed error to the caller so a human/agent resolves first.
4. Log the stash ref (P-037 redacted) for audit (P-187) and recovery.
5. `stash.test.ts`: stashes dirty work, no-ops when clean, restores exact state on pop, refuses pop on conflict.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] safeStash/safeStashPop with message + index; idempotent no-op when clean (P-250)
- [ ] Never auto-pop over a conflict (P-075); exact restore
- [ ] Stash ref audit-logged (P-187)
- [ ] Fixture tests pass

**Tests Required:** `stash.test.ts`:
- `it('stashes'), it('noop clean'), it('restores exact'), it('refuses conflict pop')`

**Dependencies:** P-080. Uses P-084/075/187.

**Handoff Notes:** Next: P-082 binary skip list.

---




### P-082: Git Core - Binary Skip List

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-081

**Context:** Detect binary files via `git check-attr`/`git ls-files` and skip them from text-based processing (diff P-217, AI analysis P-148/P-163, license header scan P-124) to avoid corrupting them or wasting tokens — while still carrying them through the merge (P-192) and checksum (P-186).

**Files to Create/Modify:**
- `packages/core/src/git/binary.ts` (new)

**Implementation Steps:**
1. `isBinary(repoPath, file)` via `git check-attr -z ...` / peeking magic bytes + a configurable skip-by-extension list (P-243 `[git].binaryExts`).
2. `classifyFiles(repoPath, files)` → `{ text: [], binary: [] }` used by the agent (P-163 skip), diff (P-217), and license scan (P-124).
3. Persist skip decisions so they're deterministic per repo (P-250/P-282) and auditable (P-187).
4. Ensure binary files still enter the child tree (P-192) and checksum manifest (P-186) — only analysis is skipped.
5. `binary.test.ts`: detects binary (magic bytes + extension), classifies text/binary, persists skip, still carries bytes through merge/checksum.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `isBinary`/`classifyFiles` via check-attr + ext config (P-243)
- [ ] Text-only processing skips binary (P-163/217/124)
- [ ] Binary still merged (P-192) + checksummed (P-186); deterministic + audited
- [ ] Fixture tests pass

**Tests Required:** `binary.test.ts`:
- `it('detects magic'), it('classifies'), it('skips analysis'), it('still carries')`

**Dependencies:** P-081. Uses P-163/217/124/186.

**Handoff Notes:** Next: P-083 .gitignore merge.

---




### P-083: Git Core - .gitignore Merge

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-082

**Context:** Merge `.gitignore` files from both parent repos so the resulting child repo (P-192) keeps build artifacts and environment cruft excluded without losing either source's intent. Feeds the ignore matcher (P-012/P-036) so scans (P-103) and the merge filtering (P-192) exclude the same things.

**Files to Create/Modify:**
- `packages/core/src/git/gitignoreMerge.ts` (new)

**Implementation Steps:**
1. Collect `.gitignore` entries from all source roots (and any `.gitignore` in subdirectories P-103-style).
2. Merge to a canonical child `.gitignore`: dedupe entries, resolve conflicting patterns (later-more-specific wins when contradicting, per git rules), keep `!`negations and anchors intact, add a generated, dated header (P-282 determinism) noting origin.
3. Validate the merged set is parseable by the ignore matcher (P-012/P-036) and doesn't accidentally exclude required source files (P-084 clean check still passes after ignore-merge).
4. Deterministic output (stable order P-282); auditable (P-187).
5. `gitignoreMerge.test.ts`: merges two ignores, dedupes, preserves negation/anchor, keeps the tree clean-verify (P-084) intact.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Merged `.gitignore` with dedupe + negation/anchor preservation (P-012/P-036)
- [ ] Deterministic output (P-282) + generated header w/ origin
- [ ] Clean-tree verify (P-084) still passes post-merge
- [ ] Fixture tests pass

**Tests Required:** `gitignoreMerge.test.ts`:
- `it('merges'), it('dedupes'), it('negations'), it('clean after')`

**Dependencies:** P-082. Uses P-012/036/084/103.

**Handoff Notes:** Next: P-084 clean tree verify.

---




### P-084: Git Core - Clean Tree Verify

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-083

**Context:** Verify the git worktree is clean (no uncommitted/untracked drift) before operations that assume a known state — clone → merge (P-072), stash-safety (P-081), cherry-pick preflight (P-074), and the write→commit loop (P-076/077). Prevents silent data loss and non-deterministic merges (P-282).

**Files to Create/Modify:**
- `packages/core/src/git/clean.ts` (new)

**Implementation Steps:**
1. `isClean(repoPath, { ignoreUntracked? })` → `Result<boolean>` via `git status --porcelain` (empty = clean).
2. `assertClean(repoPath, context)` → `Result<void>` that returns a typed `DIRTY_TREE` error (P-203) carrying the offending paths when not clean.
3. Optional allowlist: treat the stitched-out dir / generated manifests as expected-ignored (P-083) so they don't false-flag.
4. Deterministic + fast (porcelain only); used as a preflight guard everywhere (P-074/081/238).
5. `clean.test.ts`: clean repo → true/ok; dirty staged+untracked → typed error with paths; allowlist respected.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `isClean`/`assertClean` via porcelain; typed `DIRTY_TREE` error w/ paths (P-203)
- [ ] Allowlist for expected files (P-083)
- [ ] Deterministic/fast; used as preflight (P-074/081/238)
- [ ] Fixture tests pass

**Tests Required:** `clean.test.ts`:
- `it('clean ok'), it('dirty errors'), it('allowlist'), it('fast porcelain')`

**Dependencies:** P-083. Used by P-074/081/238.

**Handoff Notes:** Next: P-085 rollback/abort.

---




### P-085: Git Core - Rollback/Abort

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-084

**Context:** Abort operations and restore a clean state — both the per-git-op abort (cherry-pick/merge/rebase P-074/072) and the whole-job rollback (P-245). Ensures a failed merge leaves no partial, uncommitted garbage and that `--abort`/`--reset` paths are safe and deterministic (P-282).

**Files to Create/Modify:**
- `packages/core/src/git/rollback.ts` (new)

**Implementation Steps:**
1. `abortGitOp(repoPath, kind)` → `Result<void>` dispatching `git merge --abort` / `cherry-pick --abort` / `rebase --abort` / `worktree remove` (P-076) as applicable, guarded by detecting the in-progress state.
2. `resetTo(repoPath, ref)` → hard-reset to a recorded pre-merge ref (a safe snapshot taken at P-238 start, P-250 idempotency), then `assertClean` (P-084).
3. Coordinate with job-level rollback (P-245): restore the child dir + provenance/DB markers transactional (P-030/P-187).
4. Never reset over unstashed user work — stash first (P-081)/refuse with typed error (P-203).
5. `rollback.test.ts` (fixtures): aborts a merge-op, resets to pre-ref, refuses when dirty-unstashed, coordinates job rollback markers.

**Required MCPs/Connectors:** System `git`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `abortGitOp` per-op (merge/cherry/rebase/worktree) + `resetTo(ref)` (P-250 snapshot)
- [ ] Never clobbers unstashed work (P-081); refuses with typed error (P-203)
- [ ] Coordinates job rollback (P-245) + provenance markers (P-187)
- [ ] Fixture tests pass

**Tests Required:** `rollback.test.ts`:
- `it('aborts op'), it('resets ref'), it('refuses unstashed'), it('job rollback')`

**Dependencies:** P-084. Uses P-245/P-081/238.

**Handoff Notes:** Next: P-086 performance (parallel, cache).

---




### P-086: Git Core - Performance (Parallel, Cache)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-085

**Context:** Optimize git operations with parallel execution and caching to keep merges snappy on large repos — bounded concurrency (P-031 p-limit), parallel tree/fetch over independent roots, and repo-metadata reuse (P-303 cache) so repeated `add`/merge (P-191/192/290/291) skip redundant work.

**Files to Create/Modify:**
- `packages/core/src/git/perf.ts` (new)

**Implementation Steps:**
1. `mapParallel(items, concurrency, op)` reusing P-031 p-limit across independent clones/fetches/tree builds (P-069/090).
2. Cache layer: reuse the repo-metadata cache (P-303) for refs/trees/license, keyed by sha (P-250), skipping refetch when a ref hasn't moved (P-181 consistency).
3. Shallow+blobless clones by default (P-069) to cut network; progress surfaced (P-242/P-199).
4. Keep operations deterministic despite parallelism — outcomes independent of completion order (P-282), and never parallelize ops that touch the same worktree (single-writer).
5. `perf.test.ts`: concurrency cap honored, cached ops skip rework (ref-consistency), deterministic order-independent results, single-writer guard on shared paths.

**Required MCPs/Connectors:** System `git` + cache (P-303).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Bounded parallel ops via p-limit (P-031) over independent roots
- [ ] Repo-metadata cache reuse (P-303/250) with ref-consistency (P-181)
- [ ] Shallow/blobless clones; single-writer on shared worktrees; order-independent (P-282)
- [ ] Fixture tests pass

**Tests Required:** `perf.test.ts`:
- `it('caps concurrency'), it('caches skips'), it('deterministic'), it('single writer')`

**Dependencies:** P-085. Uses P-031/303/069/090.

**Handoff Notes:** Next: P-087 git unit tests with fixtures.

---




### P-087: Git Core - Unit Tests with Fixtures

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-086

**Context:** Comprehensive unit tests for all git operations against real fixture repos (P-062/P-066-adjacent), covering clone, filter-repo, subtree, cherry-pick, conflict, worktree, commit/trailers, push (mocked), blame, branches, stash, binary, gitignore-merge, clean, rollback, and performance. This closes the Git Core epic (P-069–P-087) with the coverage the AGENTS thresholds require (core 80% stmt).

**Files to Create/Modify:**
- `packages/core/src/git/__tests__/` (consolidated fixtures + suites)
- `packages/core/test-utils/gitFixtures.ts` (new — shared temp-repo builder)

**Implementation Steps:**
1. `gitFixtures.ts`: `makeTempRepo`, `commitFiles`, `mergeReposFixture` helpers producing deterministic temp repos (P-062/P-282) cleaned up after each test (P-081/085-safe).
2. Wire the existing `*.test.ts` suites (P-069–P-086) under `git/__tests__` so `bun --filter @repo-stitcher/core test` runs them with fixtures.
3. Add coverage for edge cases: empty repos, binary-only (P-082), deep-nested ignores (P-083), multi-origin blame (P-079).
4. Verify coverage meets core thresholds (P-259) and the CI gate (P-260) runs them.

**Required MCPs/Connectors:** System `git` (fixtures are real, local, hermetic).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Shared fixture builder + consolidated suites for all git ops
- [ ] Edge-case coverage (empty/binary/nested-ignore/multi-origin)
- [ ] Runs under core test; meets coverage thresholds (P-259); CI gate (P-260) green

**Tests Required:** All suites pass; coverage gate enforced.

**Dependencies:** P-086. Uses P-062/P-259 as gate.

**Handoff Notes:** Git Core epic (P-069–P-087) complete. Next: GitHub epic P-088.

---




### P-088: GitHub - Auth (Token + App)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-087

**Context:** Create an authenticated Octokit client (P-017) supporting both Personal Access Tokens and GitHub App installation auth (P-018), then validate scopes/permissions. This is the credential foundation of the GitHub epic (P-088–P-102): every subsequent call relies on a validated, correctly-scoped client whose secrets come from config-secret (P-206) and are never logged (P-010/P-037).

**Files to Create/Modify:**
- `packages/core/src/github/auth.ts` (new)
- `packages/core/src/github/__tests__/auth.test.ts` (new)

**Implementation Steps:**
1. `createOctokit(config)` → `Result<Octokit>`: PAT mode `new Octokit({ auth: token })`; App mode via `@octokit/auth-app` `createAppAuth` on `@octokit/rest` (P-017/P-018).
2. `validateAuth(octokit)` → `Result<User>` calling `octokit.users.getAuthenticated()` and checking the scopes/roles required for the operation context (P-088 read vs P-092/P-294 write).
3. Secret source: token from `~/.stitch` config-secret (P-200/P-206), redacted by the logger (P-037); never embedded in code or logs.
4. Error mapping: 401/403/insufficient-scope → typed `StitchError` (P-203) with a hint to run `stitch login`/check scopes.
5. `auth.test.ts` (mocked octokit + nock P-101/063): PAT + App client construction, scope validation pass/fail, token redaction, error mapping.

**Required MCPs/Connectors:** GitHub API (Octokit, mocked in tests).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] PAT + App (P-018) client construction; `validateAuth` scope-gated
- [ ] Token from config-secret (P-206); never logged (P-037)
- [ ] 401/403/scope → typed error (P-203) with hint
- [ ] `auth.test.ts` (mocked) passes

**Tests Required:** `auth.test.ts`:
- `it('pat client')`, `it('app client')`, `it('validates scopes')`, `it('redacts token')`, `it('maps errors')`

**Dependencies:** P-087. Uses P-017/P-018/P-206/101.

**Handoff Notes:** Next: P-089 list/search repos.

---

### P-089: GitHub - List/Search Repos

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-088

**Context:** Enumerate and search GitHub repos the authenticated user can access — used by the CLI/web source pickers (P-191/P-211) and the batch/scheduler (P-290/291) to find A/B source repos. Composes with the auth client (P-088) and rate-limit backoff (P-096).

**Files to Create/Modify:**
- `packages/core/src/github/list.ts` (new)
- `packages/core/src/github/__tests__/list.test.ts` (new)

**Implementation Steps:**
1. `listRepos(octokit, { visibility, sort, perPage })` → `Result<RepoSummary[]>` via `octokit.repos.listForAuthenticatedUser` with pagination (P-096).
2. `searchRepos(octokit, query)` → `Result<RepoSummary[]>` via `octokit.search.repos`, surface total + matches.
3. `RepoSummary { owner, name, fullName, defaultBranch, private, license? }` typed (P-252-adjacent) for the pickers.
4. Wrap pagination in the rate-limit backoff (P-096) so bursts don't 429; persist last-success cursor where useful (P-303 cache).
5. `list.test.ts` (mocked): paginates multiple pages, search returns matches, respects rate-limit, maps 403/rate-limit to typed error (P-203).

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `listRepos`/`searchRepos` → typed `RepoSummary[]` with pagination (P-096)
- [ ] Feeds source pickers (P-191/211/290)
- [ ] `list.test.ts` (mocked) passes; errors map to P-203

**Tests Required:** `list.test.ts`:
- `it('paginates'), it('searches'), it('rate limited'), it('error maps')`

**Dependencies:** P-088. Uses P-096.

**Handoff Notes:** Next: P-090 getRepoTree.

---
### P-090: GitHub - GetRepoTree (Recursive)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-089

**Context:** Recursively fetch a repo's file tree (P-103-aware) for the file-picker and tree UI (P-213/214) and for deciding which paths to pull into the child repo (P-191). Prefer GraphQL (P-097) or the git trees API (P-090) to avoid N calls; throttle via P-096.

**Files to Create/Modify:**
- `packages/core/src/github/tree.ts` (new)
- `packages/core/src/github/__tests__/tree.test.ts` (new)

**Implementation Steps:**
1. `getRepoTree(octokit, owner, repo, { recursive, branch, cache? })` → `Result<TreeNode[]>` via `octokit.git.getTree(..., recursive)` (single call) or `repos.getContent` fallback.
2. Normalize to a flat `TreeNode[] { path, type, sha }` + build a nested structure for the arborist picker (P-213/214/058).
3. Cache per (owner,repo,ref→sha) in the repo-metadata cache (P-303) so repeated adds don't refetch; respect ref-consistency (P-181).
4. Skip ignored paths (P-083/P-012) and binary-heavy dirs pre-fetch where large (defer content to P-091).
5. `tree.test.ts` (mocked): recursive tree, nesting, cache hit/skip + ref-consistency, large-tree handling, error mapping.

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `getRepoTree` recursive (single-call) → `TreeNode[]` + nested picker shape (P-058/213)
- [ ] Cache per ref-sha (P-303/181); ignore-aware (P-083)
- [ ] `tree.test.ts` passes; error mapping (P-203)

**Tests Required:** `tree.test.ts`:
- `it('recursive'), it('nests'), it('cache skips'), it('large tree'), it('errors')`

**Dependencies:** P-089. Uses P-097/303/083.

**Handoff Notes:** Next: P-091 getFileContent/batch.

---
### P-091: GitHub - GetFileContent/Batch

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-090

**Context:** Fetch file content — individually or batched — from GitHub for the AI agent (P-148/P-152), diff analysis (P-217), and license header scans (P-124). Batching + caching keeps large merges efficient and respects rate limits (P-096).

**Files to Create/Modify:**
- `packages/core/src/github/content.ts` (new)
- `packages/core/src/github/__tests__/content.test.ts` (new)

**Implementation Steps:**
1. `getFileContent(octokit, owner, repo, path, ref)` → `Result<BlobContent>` via `octokit.repos.getContent` (decode base64; binary → P-082 skip/flag).
2. `getFileContentsBatch(octokit, spec, { concurrency })` → `Result<Map<path, BlobContent>>` using bounded p-limit (P-031) + the pending-batch diff strategy (P-040/030-adjacent).
3. Cache file bytes per (ref-sha) in the repo-metadata cache (P-303) for repeat scans (P-124/deps P-104).
4. Respect rate-limit backoff (P-096); large files truncated/streamed per config (P-243) to avoid token blowout (P-163).
5. `content.test.ts` (mocked): single + batch fetch, base64 decode, binary skip (P-082), cache reuse, rate-limit throttling.

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Single + bounded-batch (P-031) fetch; base64 decode; binary skip (P-082)
- [ ] Cache per ref-sha (P-303); rate-limit backoff (P-096)
- [ ] `content.test.ts` passes; error mapping (P-203)

**Tests Required:** `content.test.ts`:
- `it('single'), it('batch'), it('binary skip'), it('cache'), it('throttle')`

**Dependencies:** P-090. Uses P-031/096/082/303.

**Handoff Notes:** Next: P-092 createRepoC.

---
### P-092: GitHub - CreateRepoC

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-091

**Context:** Create the child repo C on GitHub (empty, then pushed to by P-078/P-192) with correct visibility, license template (P-125), and optional CI template. Guarded by scope/RBAC (P-293) and creation config (P-243 `createIfMissing`).

**Files to Create/Modify:**
- `packages/core/src/github/create.ts` (new)
- `packages/core/src/github/__tests__/create.test.ts` (new)

**Implementation Steps:**
1. `createRepoC(octokit, { owner, name, private, description, licenseTemplate? })` → `Result<{fullName, sshUrl, htmlUrl}>` via `octokit.repos.createForAuthenticatedUser` (or org variant).
2. Guard: verify name availability (P-089 search/list) + write-scope validated (P-088/P-293); if exists and `createIfMissing` false → typed `ALREADY_EXISTS` error (P-203).
3. If a license template (P-125) is selected, pass it to `repos.create` (source from the license merge P-125/126).
4. Idempotency: if the repo exists at the same ref, treat as a resume point (P-250/240).
5. `create.test.ts` (mocked): creates, rejects existing-name without createIfMissing, org variant, RBAC deny.

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `createRepoC` with visibility/description/license template (P-125)
- [ ] RBAC/scope-gated (P-088/293); `ALREADY_EXISTS` typed error (P-203)
- [ ] Idempotent resume (P-250); `create.test.ts` passes

**Tests Required:** `create.test.ts`:
- `it('creates'), it('exists errors'), it('org'), it('rbac deny')`

**Dependencies:** P-091. Uses P-125/293/250.

**Handoff Notes:** Next: P-093 branch/protect.

---
### P-093: GitHub - Branch/Protect

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-092

**Context:** Manage branches and branch protection on C (P-080/P-313): create PR branches, set required-checks/status protections (tied to sandbox P-177/P-178), and enforce the branching model from doctor/handoff (P-313). Protections prevent force-push (P-078) and unverified merges.

**Files to Create/Modify:**
- `packages/core/src/github/branches.ts` (new)
- `packages/core/src/github/__tests__/branches.test.ts` (new)

**Implementation Steps:**
1. `createBranch(octokit, owner, repo, name, fromRef)` via the git refs API (P-080 parity).
2. `protectBranch(octokit, owner, repo, branch, rules)` configuring `required_status_checks`, enforcement level, allow-force-push:false (P-078 guard).
3. `setStatus(octokit, owner, repo, sha, { context, state })` for the sandbox result (P-177) so CI-gates the merge (P-260/P-094).
4. Delete/rename branch helpers mirroring P-080.
5. `branches.test.ts` (mocked): create/protect/setStatus, force-push denied on protected, protection rules shape.

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] create/protect/status helpers (P-080 parity); force-push denied (P-078)
- [ ] Sandbox status gates merge (P-177/094)
- [ ] `branches.test.ts` passes

**Tests Required:** `branches.test.ts`:
- `it('create'), it('protect'), it('status'), it('force push denied')`

**Dependencies:** P-092. Uses P-080/177/078/313.

**Handoff Notes:** Next: P-094 openPR + CREDITS.

---
### P-094: GitHub - OpenPR + CREDITS

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-093

**Context:** Open a pull request for the merged child repo C (P-192/P-078), attaching the generated CREDITS (P-182) and a summary (from provenance P-181 + the merge report P-116/128), with the sandbox result (P-177) as a status check. The visible, reviewable deliverable of a merge.

**Files to Create/Modify:**
- `packages/core/src/github/pr.ts` (new)
- `packages/core/src/github/__tests__/pr.test.ts` (new)

**Implementation Steps:**
1. `openPR(octokit, owner, repo, { base, head, title, body })` via `octokit.pulls.create` after the branch exists (P-093/P-080).
2. Build body: deterministic summary from the merge report (P-116/P-128) + provenance/CREDITS (P-181/182) embedded or linked; stable formatting (P-282).
3. Ensure sandbox status (P-177/P-093) is posted before/with the PR so checks gate it.
4. Idempotent: skip if an open PR for the same head already exists (P-250).
5. `pr.test.ts` (mocked): opens PR with CREDITS body, posts status, skips existing open PR.

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `openPR` with CREDITS (P-182)/report body + status (P-177/093)
- [ ] Deterministic body (P-282); idempotent skip (P-250)
- [ ] `pr.test.ts` passes

**Tests Required:** `pr.test.ts`:
- `it('opens'), it('bodies credits'), it('posts status'), it('skips existing')`

**Dependencies:** P-093. Uses P-182/181/116/177.

**Handoff Notes:** Next: P-095 actions status webhook.

---
### P-095: GitHub - Actions Status Webhook

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-094

**Context:** Subscribe to and relay GitHub Actions run status for the child repo (P-078/P-092) and the GH Actions sandbox (P-178) so the CLI/web job timeline (P-241/P-224) reflects CI results (P-094 gate). Webhook → event bus (P-241) → UI.

**Files to Create/Modify:**
- `packages/core/src/github/actionsStatus.ts` (new)
- `packages/core/src/github/__tests__/actionsStatus.test.ts` (new)

**Implementation Steps:**
1. `relayWorkflowRun(octokit, owner, repo, runId)` polls/verifies `octokit.actions.listWorkflowRuns`/`getWorkflowRun` and emits a normalized event (P-241 shape) `{ runId, headSha, conclusion, status }`.
2. Webhook server path (P-193/P-043 elysia): accept GitHub `workflow_run`/`check_run` events with signature verification (P-265), map to the bus.
3. Correlate to the originating job (P-239) via head sha + ref for UI status (P-224/P-247).
4. Rate/poll discipline (P-096) + signature-verify (P-265) to avoid spoofed statuses.
5. `actionsStatus.test.ts` (mocked): polls/maps run, webhook signature verify pass/fail, correlates to job, error mapping.

**Required MCPs/Connectors:** GitHub API + webhook endpoint (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Emits normalized run events → bus (P-241); webhook sig-verified (P-265)
- [ ] Correlates to job (P-239); rate-limit (P-096)
- [ ] `actionsStatus.test.ts` passes

**Tests Required:** `actionsStatus.test.ts`:
- `it('polls maps'), it('webhook verify'), it('spoof rejects'), it('correlates')`

**Dependencies:** P-094. Uses P-241/178/043.

**Handoff Notes:** Next: P-096 rate limit backoff.

---
### P-096: GitHub - Rate Limit Backoff

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-095

**Context:** Implement exponential backoff + respect for GitHub REST/GraphQL rate limits so batch operations (P-091/290) and sockets (P-099/P-091) don't 429-spam or fail spuriously. Centralizes `X-RateLimit-Remaining/Reset` handling.

**Files to Create/Modify:**
- `packages/core/src/github/rateLimit.ts` (new)
- `packages/core/src/github/__tests__/rateLimit.test.ts` (new)

**Implementation Steps:**
1. `withRateLimit<T>(octokit, fn)` wrapper: on `octokitThrottlingplugin`/manual check of remaining+reset, sleep/resume with jittered exponential backoff (P-139 parity), then retry.
2. Respect `Retry-After`/secondary limits; cap total wait + fail loud with a typed rate-limit `StitchError` (P-203) when exhausted.
3. Thread `withRateLimit` through list/tree/content/actions (P-089/090/091/095) and the batch (P-091/290).
4. Expose remaining for the analytics panel (P-295) throttling display.
5. `rateLimit.test.ts`: backoff jitter bounds, retry succeeds, waits honor reset, exhaustion → typed error.

**Required MCPs/Connectors:** GitHub API (mocked/fake clocks).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `withRateLimit` exponential backoff + retry, `Retry-After` respected
- [ ] Exhaustion → typed `RATE_LIMIT` error (P-203); threaded through P-089–095/290
- [ ] `rateLimit.test.ts` passes

**Tests Required:** `rateLimit.test.ts`:
- `it('backoff'), it('retries'), it('waits reset'), it('exhausts cheap')`

**Dependencies:** P-095. Uses P-139.

**Handoff Notes:** Next: P-097 GraphQL trees.

---
### P-097: GitHub - GraphQL Trees

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-096

**Context:** Use GitHub's GraphQL API for efficient, nested repo trees + richer metadata (P-090 supplement) — the v4 API can return deep trees and repo fields in one query, reducing API calls for the picker (P-213/214) and ecosystem detection (P-103).

**Files to Create/Modify:**
- `packages/core/src/github/graphql.ts` (new)
- `packages/core/src/github/__tests__/graphql.test.ts` (new)

**Implementation Steps:**
1. `graphqlTree(octokit, owner, repo, { expression, depth? })` via the v4 `graphql` method with an `object(expression: ref) { ... on Tree { entries { name path oid __typename } } }` query.
2. Normalize to the same `TreeNode[]` shape as P-090 so the tree/picker layer is transport-agnostic.
3. Fallback to REST (P-090) when GraphQL returns unsupported/`NOT_FOUND` (P-203 mapping).
4. Respect the shared rate-limit wrapper (P-096) + cache (P-303).
5. `graphql.test.ts` (mocked): query shape, normalization, REST fallback, error mapping.

**Required MCPs/Connectors:** GitHub GraphQL API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `graphqlTree` v4 query → same `TreeNode[]` (P-090 parity)
- [ ] REST fallback (P-090); rate-limit (P-096); cache (P-303)
- [ ] `graphql.test.ts` passes

**Tests Required:** `graphql.test.ts`:
- `it('queries'), it('normalizes'), it('rest fallback'), it('errors')`

**Dependencies:** P-096. Used by P-090/213.

**Handoff Notes:** Next: P-098 detectRepoLicense.

---
### P-098: GitHub - DetectRepoLicense

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-097

**Context:** Detect a repo's declared license via the GitHub API (`repos.get` `license` / licenses endpoint) for the license scan (P-118) + picker display. Feeds the license-compliance epic (P-114–P-132) source attribution (P-126) and the child LICENSE decision (P-125).

**Files to Create/Modify:**
- `packages/core/src/github/license.ts` (new)
- `packages/core/src/github/__tests__/license.test.ts` (new)

**Implementation Steps:**
1. `detectRepoLicense(octokit, owner, repo)` → `Result<{ spdxId?, name?, url? }>` via `octokit.licenses.getForRepo`/`repos.get`, mapping `license.spdx_id`.
2. Normalize through SPDX (P-119/P-025) and classify known/unknown (P-123).
3. Cache per (owner,repo,sha) in the repo-metadata cache (P-303).
4. Feed the aggregated LicenseReport (P-128) for source repos.
5. `license.test.ts` (mocked): detects known/unknown, normalizes, caches, error mapping.

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `detectRepoLicense` → spdxId/name/url via API, normalized (P-119/P-025)
- [ ] Known/unknown classify (P-123); cache (P-303); feeds P-128
- [ ] `license.test.ts` passes

**Tests Required:** `license.test.ts`:
- `it('known'), it('unknown'), it('normalizes'), it('caches')`

**Dependencies:** P-097. Uses P-119/125/128.

**Handoff Notes:** Next: P-099 fork support.

---
### P-099: GitHub - Fork Support

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-098

**Context:** Support forking a source repo (P-191/211) when the user lacks write/push access, then PR-ing from the fork. Lets `stitch add` + merge work read-write against any public repo by provisioning a fork transiently (P-092/078).

**Files to Create/Modify:**
- `packages/core/src/github/fork.ts` (new)
- `packages/core/src/github/__tests__/fork.test.ts` (new)

**Implementation Steps:**
1. `ensureFork(octokit, owner, repo, { waitSiblingCache? })` → `Result<ForkInfo>` via `octokit.repos.createFork` + poll-until-ready (P-096) when the upstream isn't writable.
2. Route merge/push (P-078) to the fork and open the PR from the fork's head to upstream base (P-094).
3. Reuse an existing fork at the same upstream ref (idempotent P-250/cache P-303).
4. RBAC/scope: only fork when necessary and permitted (P-293).
5. `fork.test.ts` (mocked): creates+wais ready, reuses existing, PR from fork, RBAC deny.

**Required MCPs/Connectors:** GitHub API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `ensureFork` create+wait-ready (P-096); route push (P-078)/PR (P-094) via fork
- [ ] Reuse existing (P-250/303); RBAC-gated (P-293)
- [ ] `fork.test.ts` passes

**Tests Required:** `fork.test.ts`:
- `it('creates waits'), it('reuses'), it('pr from fork'), it('rbac deny')`

**Dependencies:** P-098. Uses P-078/094/096/293.

**Handoff Notes:** Next: P-100 GH Actions sandbox trigger.

---
### P-100: GitHub - GH Actions Sandbox Trigger

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-099

**Context:** Trigger and monitor the GitHub Actions sandbox backend (P-178) for build/verify of the child repo — dispatching a workflow that mirrors the local sandbox (P-168–P-180) and relaying results (P-177/P-095) back into the pipeline.

**Files to Create/Modify:**
- `packages/core/src/github/sandboxTrigger.ts` (new)
- `packages/core/src/github/__tests__/sandboxTrigger.test.ts` (new)

**Implementation Steps:**
1. `triggerSandbox(octokit, owner, repo, { sha, ecosystem, ref, jobId })` → dispatch `repository_dispatch`/`workflow_dispatch` (P-178 workflow) with the build args, tagging the job id for correlation (P-239).
2. Monitor run via the Actions status relay (P-095) + event bus (P-241); map the run conclusion (P-177) to sandbox pass/fail/flaky (P-176).
3. Config-selectable backend (P-178: local docker P-169 vs GH Actions); secret-safe: never pass provider keys into the workflow env (P-265/P-206).
4. Timeout/limits forwarded (P-174) to the workflow `timeout-minutes`.
5. `sandboxTrigger.test.ts` (mocked): dispatch args, correlation, conclusion→result mapping, no-secret invariant.

**Required MCPs/Connectors:** GitHub Actions API (mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Dispatch with sha/ecosystem/jobId (P-178); correlate via P-239/P-095
- [ ] Conclusion → pass/fail/flaky (P-176/177); timeout forwarded (P-174)
- [ ] No secrets in workflow env (P-265); `sandboxTrigger.test.ts` passes

**Tests Required:** `sandboxTrigger.test.ts`:
- `it('dispatches'), it('correlates'), it('maps result'), it('no secrets')`

**Dependencies:** P-099. Uses P-178/095/176/239.

**Handoff Notes:** Next: P-101 tests with mocked octokit.

---
### P-101: GitHub - Tests with Mocked Octokit

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-100

**Context:** Comprehensive unit tests for the whole GitHub epic (P-088–P-100) against a mocked Octokit (nock P-063/P-061) so suites are hermetic, offline, and deterministic — covering auth, list/search, tree, content, create, branches, PR, actions, rate-limit, GraphQL, license, fork, and sandbox-trigger, meeting core coverage thresholds (P-259).

**Files to Create/Modify:**
- `packages/core/src/github/__tests__/` (consolidated mocked suites)
- `packages/core/test-utils/githubMock.ts` (new — shared octokit/nock harness)

**Implementation Steps:**
1. `githubMock.ts`: helpers building a typed mocked `Octokit` (stubbed paginate/get/tree/content/pulls/actions) + a fixture of expected responses (P-282 determinism).
2. Consolidate P-088–P-100 suites under `github/__tests__` reusing the harness; each asserts results + error mapping (P-203).
3. Add edge cases: 401/403/rate-limit (P-096), not-found branch (P-092/P-097), pagination (P-089).
4. Verify coverage meets core thresholds (P-259) + CI gate (P-260).

**Required MCPs/Connectors:** None (all mocked).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Shared mocked-Octokit harness (P-063/061); consolidated P-088–P-100 suites
- [ ] Edge cases: auth/scopes, rate-limit, not-found, pagination
- [ ] Coverage thresholds (P-259) met; CI gate (P-260) green

**Tests Required:** All GitHub suites pass; coverage gate enforced.

**Dependencies:** P-100. Uses P-063/259 as gate.

**Handoff Notes:** Next: P-102 error mapping (closes GitHub epic).

---
### P-102: GitHub - Error Mapping

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-101

**Context:** Centralize mapping of GitHub/Octokit errors (401/403/404/409/rate-limit/network) into the typed `StitchError` space (P-011/P-203) with stable codes + user-facing hints. Ensures the CLI/web UI (P-201/P-203) and REST (P-297) surface actionable, consistent GitHub failures across the epic.

**Files to Create/Modify:**
- `packages/core/src/github/errors.ts` (new)
- `packages/core/src/github/__tests__/errors.test.ts` (new)

**Implementation Steps:**
1. `mapGitHubError(err, ctx)` → `StitchError` mapping status: 401 `AUTH_FAILED`, 403 rate-limit→`RATE_LIMIT` (P-096) else `FORBIDDEN`, 404 `NOT_FOUND`, 409 → conflict hint, network/abort → `NETWORK`.
2. Attach a stable code (P-203) + a hint (P-316) and the offending repo/scope for the UI.
3. Verify octokit's structured error (`error.status`, `error.response`) is parsed without throwing (P-011 Result).
4. Thread through every GitHub phase (P-088–P-100) via the shared wrapper.
5. `errors.test.ts`: each status maps to the right code+hint; unknown → generic; no throw.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Status→`StitchError` codes (401/403/rate-limit/404/409/network) with hints (P-316)
- [ ] Parse octokit structured errors w/o throwing (P-011)
- [ ] Threaded through P-088–P-100; `errors.test.ts` passes

**Tests Required:** `errors.test.ts`:
- `it('401'), it('rate limit'), it('404'), it('network'), it('generic')`

**Dependencies:** P-101. Aligned with P-203/P-316.

**Handoff Notes:** GitHub epic (P-088–P-102) complete. Next: P-103 ecosystem detect (Deps).

---
### P-103: Deps - Ecosystem Detect

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-102

**Context:** Detect which package ecosystems are present in a repo (package.json node, requirements/pyproject python, Cargo.toml rust, go.mod/go.sum go) so the deps pipeline (P-104–P-116) dispatches to the right parsers (P-104/105/106/107). Feeds the merge strategy (P-238) and the sandbox image selection (P-169) per ecosystem.

**Files to Create/Modify:**
- `packages/core/src/deps/ecosystem.ts` (new)

**Implementation Steps:**
1. `detectEcosystems(repoPath)` → `Result<Ecosystem[]>` scanning for the marker files (package.json, requirements*, pyproject.toml, Cargo.toml, go.mod) via glob (P-034) at root + common subdirs (P-103 tree scan P-090/103).
2. For each found ecosystem, resolve a typed `Ecosystem = 'node'|'python'|'rust'|'go'|...` with an associated manifest path + parser id (P-104–P-107).
3. Deterministic ordering (P-282) + skip ignored paths (P-083/P-012 ignore matcher).
4. Expose to the merge/sandbox: the detector result picks parsers (P-104–P-107) and sandbox base images (P-169).
5. `ecosystem.test.ts` (fixtures): detects each ecosystem, handles multi-ecosystem repos, orders deterministically, respects ignore.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `detectEcosystems` → `Result<Ecosystem[]>` via marker-file glob (P-034), ignoring P-083
- [ ] Dispatches to correct parser (P-104–P-107) + sandbox image (P-169)
- [ ] Deterministic ordering (P-282)
- [ ] Fixture tests pass

**Tests Required:** `ecosystem.test.ts`:
- `it('node'), it('python'), it('rust'), it('go'), it('multi'), it('ignores')`

**Dependencies:** P-102. Used by P-104–P-116/P-169.

**Handoff Notes:** Next: P-104 parse package.json (Deps epic).

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

**Context:** After `merge.ts` produces a `UnifiedManifest` (P-113) with resolved conflicts, the child repo C needs a lockfile that pins the exact resolved dependency graph for reproducible builds. This phase regenerates an ecosystem-appropriate lockfile for the merged manifest by shelling out to the ecosystem's own lockfile command, capturing output for provenance, and returning a typed `Result`. Because lockfile generation can be slow and network-bound, it runs inside the sandbox (P-204) and is guarded against partial failure. It is the bridge between merge-time resolution (P-109–P-113) and sandbox verification (P-204-P-210).

**Files to Create/Modify:**
- `packages/core/src/deps/lockfile.ts` (new)
- `packages/core/src/deps/lockfile.test.ts` (new)
- `packages/core/src/deps/types.ts` (add `LockfileResult`)
- `packages/core/src/deps/index.ts` (barrel export)
- `packages/core/src/deps/plugin.ts` (already stubbed interface `regenerateLockfile` — this phase provides the shared implementation)

**Implementation Steps:**
1. Add to `types.ts`:
   ```ts
   export interface LockfileResult {
     ecosystem: 'npm' | 'python' | 'cargo' | 'go'
     lockfilePath: string
     command: string              // e.g. 'bun install'
     exitCode: number
     stdout: string
     stderr: string
     createdAt: string            // ISO timestamp
   }
   ```
2. Implement `regenerateLockfile(manifest: UnifiedManifest, repoPath: string): Promise<Result<LockfileResult, StitchError>>` in `lockfile.ts`:
   - Dispatch per `manifest.ecosystem`:
     - **npm** → run `bun install --frozen-lockfile=false` in `repoPath` (creates `bun.lock` / updates `package-lock.json`). Use `execa` (already in `P-019`) or `Bun.spawn`; capture `stdout`/`stderr`.
     - **python** → run `pip-compile requirements.in` or `uv lock` — prefer `uv lock` (add `uv` as optional `P-019` devDependency) → `uv.lock`.
     - **cargo** → run `cargo generate-lockfile --manifest-path <repo>/Cargo.toml` → `Cargo.lock`.
     - **go** → run `go mod tidy` in `repoPath` → `go.sum` + updated `go.mod`.
   - Wrap all `child_process` calls in the shared `execCmd` helper (timeout 120s, env passthrough for offline flag).
   - Map non-zero exit to `err('LOCKFILE_GENERATION_FAILED', { command, exitCode, stderr })`.
3. Add offline/network guard: if `config.sandbox.allowNetwork === false`, set env `BUN_CONFIG_REGISTRY`/`GOPROXY=off`/`CARGO_NET_OFFLINE=true` so the command fails fast rather than hanging; surface that failure with a clear message.
4. Validate output: after generation, assert the expected lockfile path exists via `fs-extra.pathExists`; if missing, return `err('LOCKFILE_NOT_CREATED')`.
5. Export `regenerateLockfile` (and `LockfileResult`) from `deps/index.ts`; run `bun run typecheck`.

**Required MCPs/Connectors:** None direct. Optional: npm registry / Go proxy / crates.io are accessed only via the ecosystem CLI inside the sandbox, never through an MCP. The Docker sandbox connector (used by P-204) is a downstream concern, not here.

**Skills to Invoke:** None (pure orchestration of ecosystem CLIs). May reference `gstack-investigate` guidance if a lockfile command fails intermittently during development.

**Acceptance Criteria:**
- [ ] `regenerateLockfile(npmManifest, tmpRepo)` runs `bun install` and returns `LockfileResult` with `lockfilePath` pointing to an existing `bun.lock` and `exitCode === 0`
- [ ] Non-zero command exit returns `err('LOCKFILE_GENERATION_FAILED')` with `command`/`exitCode`/`stderr` populated
- [ ] Missing lockfile after a "successful" run returns `err('LOCKFILE_NOT_CREATED')`
- [ ] Offline flag set when `allowNetwork === false` (assert env var forwarded to child process)
- [ ] Per-ecosystem dispatch resolves the correct command (npm/python/cargo/go)
- [ ] `LockfileResult.stderr` retained for the P-116 report and provenance

**Tests Required:** `lockfile.test.ts` using `tmp` fixture dirs (created via `fs-extra` in `beforeEach`, removed in `afterEach`):
- `it('regenerates npm lockfile via bun install')` — assert `bun.lock` exists, exitCode 0
- `it('maps non-zero exit to LOCKFILE_GENERATION_FAILED')` — inject a failing command (bad manifest)
- `it('returns LOCKFILE_NOT_CREATED when lockfile missing')`
- `it('respects offline mode env')` — assert child env contains `BUN_CONFIG_REGISTRY` when `allowNetwork=false`
- `it('dispatches per ecosystem')` — mock `execCmd` to assert correct command string per ecosystem

**Dependencies:** P-113 (consumes merged `UnifiedManifest`). Follows package isolation — core-only, blocked only for inbesat.

**Handoff Notes:** Next: P-115 formalizes the `ManifestParser` plugin interface, and `regenerateLockfile` moves behind it. `LockfileResult` is surfaced to the CLI report in P-116 and stored for provenance in P-311. Note: lockfile generation is network-dependent; keep CI fixtures tiny/mocked to avoid flaky tests.

---




### P-115: Deps — Ecosystem Plugin Interface

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-114

**Context:** All four ecosystems (npm, python, cargo, go) now share a parallel shape: detect → parse → serialize → merge → regenerateLockfile. This phase codifies that shape as a formal `ManifestParser` plugin interface and registers one concrete parser per ecosystem, replacing ad-hoc dispatch in `merge.ts`/`lockfile.ts`. This enables `P-116` (report), `P-151` (auto-fix), and the CLI to work against any ecosystem uniformly, and makes adding a fifth ecosystem (e.g. Ruby/Bundler) a single-registration task.

**Files to Create/Modify:**
- `packages/core/src/deps/plugin.ts` (fill in the stub)
- `packages/core/src/deps/parsers/index.ts` (new — registry)
- `packages/core/src/deps/parsers/npm.ts` (new — wraps P-104 parse/serialize/merge)
- `packages/core/src/deps/parsers/python.ts` (new — wraps P-105)
- `packages/core/src/deps/parsers/cargo.ts` (new — wraps P-106)
- `packages/core/src/deps/parsers/go.ts` (new — wraps P-107)
- `packages/core/src/deps/plugin.test.ts` (new)

**Implementation Steps:**
1. Define the interface in `plugin.ts`:
   ```ts
   export interface ManifestParser {
     ecosystem: Ecosystem
     detect(repoPath: string): Promise<boolean>          // e.g. package.json present
     parse(content: string): Result<ParsedManifest, StitchError>
     serialize(manifest: ParsedManifest): string
     merge(manifests: ParsedManifest[]): MergeResult
     regenerateLockfile(manifest: ParsedManifest, repoPath: string): Promise<Result<LockfileResult, StitchError>>
   }
   export function registerParser(p: ManifestParser): void
   export function getParser(ecosystem: Ecosystem): ManifestParser
   export function detectEcosystem(repoPath: string): Promise<Ecosystem | null>
   ```
2. Implement `detect` per ecosystem: `package.json` → npm, `pyproject.toml`/`requirements.txt` → python, `Cargo.toml` → cargo, `go.mod` → go. Return `null` if none.
3. Implement a global in-memory registry (`Map<Ecosystem, ManifestParser>`) with `registerParser`/`getParser` (throw `UNSUPPORTED_ECOSYSTEM` on miss).
4. In `parsers/npm.ts`, wrap the existing functions from P-104/P-108/P-112/P-114: `parseContent` → `parseNpmManifest`, `serialize` → `serializePackageJson`. Repeat for python/cargo/go, delegating to their existing modules.
5. Replace hardcoded `if/switch` in `merge.ts` `unionManifests` and `lockfile.ts` `regenerateLockfile` with `getParser(ecosystem).merge(...)` / `.regenerateLockfile(...)` calls so new ecosystems need no merge/lockfile edits.
6. Export registry + interface from `deps/index.ts`; run `bun run typecheck` + `bun test`.

**Required MCPs/Connectors:** None (local registry + existing parsers). Ecosystem CLIs still run in-process via child_process.

**Skills to Invoke:** None. Extensibility pattern mirrors standard plugin/registry design; no new tools required.

**Acceptance Criteria:**
- [ ] `detectEcosystem` returns correct ecosystem for each fixture repo (npm/python/cargo/go) and `null` for empty dir
- [ ] `getParser('npm')` returns the npm parser; `getParser('ruby')` throws `UNSUPPORTED_ECOSYSTEM`
- [ ] `merge.ts` and `lockfile.ts` no longer contain per-ecosystem `switch` statements — they delegate to the registry
- [ ] Registering a new ecosystem parser (test-only fake) is picked up by `unionManifests` without editing `merge.ts`
- [ ] All existing P-104–P-114 tests still pass (interface is backward-compatible wrapper)

**Tests Required:** `plugin.test.ts`:
- `it('detects ecosystem per repo')`, `it('getParser throws on unknown')`, `it('registry collects registered parsers')`, `it('merge.ts delegates to registered parser')`
- Re-run full `packages/core/src/deps/*.test.ts` suite to confirm no regression after refactor

**Dependencies:** P-114 (each parser wraps a working `regenerateLockfile`). Pure core, no cross-owner blocking.

**Handoff Notes:** Next: P-116 report consumes any registered parser's `MergeResult`. This interface is the single extension point for new ecosystems; document it in `ARCHITECTURE.md` under "Dependency Ecosystem Plugins". Keep each parser thin (delegate) to avoid duplicating logic.

---




### P-116: Deps — Deps Report (JSON)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-115

**Context:** The user needs a single, machine-readable artifact summarizing the dependency merge outcome: what was merged, every conflict, how each was resolved (or still pending), the chosen dedupe strategy, and lockfile status. This phase produces `DependencyReport` — a JSON-serializable object fed to the CLI (`P-196`), the web UI (`P-219`), and persisted for provenance (`P-311`). It is the reporting contract for the entire deps pipeline.

**Files to Create/Modify:**
- `packages/core/src/deps/report.ts` (fill stub)
- `packages/core/src/deps/report.test.ts` (new)
- `packages/core/src/deps/types.ts` (add `DependencyReport`, `ConflictStatus`)

**Implementation Steps:**
1. Add to `types.ts`:
   ```ts
   export type ConflictStatus = 'auto-resolved' | 'needs-attention' | 'warning'
   export interface DependencyReport {
     generatedAt: string
     ecosystem: Ecosystem
     inputSources: { repoName: string; manifestPath: string }[]
     merged: UnifiedManifest
     dependencyCount: { direct: number; dev: number; peer: number; total: number }
     conflicts: (Conflict & { status: ConflictStatus; resolution?: string })[]
     dedupe: DedupeResult[]
     scripts: { merged: Record<string,string>; collisions: Conflict[] }
     lockfile: { status: 'generated' | 'failed' | 'skipped'; path?: string; command?: string; error?: string } | null
     summary: { mergeable: boolean; needsHuman: boolean; blockedBy: string[] }
   }
   ```
2. Implement `generateDepReport(result: MergeResult, lockfile: LockfileResult | null, input: { repoName: string; manifestPath: string }[]): DependencyReport`
   - Walk `result.conflicts`, classify each: if `suggestedResolution` present and applied → `status:'auto-resolved'`; else if `severity==='error'` → `status:'needs-attention'`; else → `'warning'`.
   - Count dependencies by section from `merged`.
   - Compute `summary.needsHuman` = any `needs-attention` conflict; `blockedBy` = list of such packages.
   - `mergeable = !needsHuman && lockfile?.status === 'generated'`.
3. Produce the JSON via `JSON.stringify(report, null, 2)`; ensure `toJSON` stability (sort keys for diff-ability).
4. Wire into CLI later: this phase only exports the pure builder + a `renderReportJson(report): string`.
5. Export from `deps/index.ts`; `bun run typecheck` + `bun test`.

**Required MCPs/Connectors:** None (pure data assembly over `MergeResult` + `LockfileResult`).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Report includes merged manifest, per-section dependency counts, and all conflicts with a `status` classification
- [ ] `mergeable` is `false` when a `needs-attention` conflict exists or lockfile failed
- [ ] `needsHuman`/`blockedBy` reflect the set of unresolved conflicts
- [ ] Lockfile section reflects `generated`/`failed`/`skipped` with command + error string
- [ ] `renderReportJson` output is stable (deterministic key order) and JSON-parseable
- [ ] Incremental counts are correct for a fixture with mixed direct/dev/peer deps

**Tests Required:** `report.test.ts`:
- `it('classifies auto-resolved vs needs-attention')`, `it('computes dependency counts')`, `it('sets mergeable=false on unresolved')`, `it('serializes lockfile status')`, `it('output is deterministic JSON')`

**Dependencies:** P-115 (registry produces `MergeResult`; `LockfileResult` from P-114/plugin). Core-only.

**Handoff Notes:** Next: P-117 adds fixture-based end-to-end tests over the whole report path. `DependencyReport` becomes the input to the CLI `deps report` command and the persisted provenance blob in P-311 — keep its shape versioned (`reportVersion` field) for future migration.

---




### P-117: Deps — Tests with Fixtures

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-116

**Context:** Unit tests so far exercised isolated functions. This phase builds a comprehensive fixture suite — real, minimal npm/python/cargo/go repos committed under `packages/core/src/deps/__fixtures__/` — and runs end-to-end tests through the full plugin pipeline (detect → parse → serialize → merge → lockfile). These fixtures double as golden references for the P-116 report and catch regressions when parser or merge logic evolves.

**Files to Create/Modify:**
- `packages/core/src/deps/__fixtures__/npm-basic/package.json`, `.../bun.lock`
- `packages/core/src/deps/__fixtures__/npm-conflict/package.json`
- `packages/core/src/deps/__fixtures__/python-basic/pyproject.toml`
- `packages/core/src/deps/__fixtures__/cargo-basic/Cargo.toml`
- `packages/core/src/deps/__fixtures__/go-basic/go.mod`
- `packages/core/src/deps/__tests__/endtoend.test.ts` (new)

**Implementation Steps:**
1. Create a `__fixtures__` directory with minimal valid repos:
   - `npm-basic`: `package.json` with `dependencies:{lodash:'^4.17.0'}` + a committed `bun.lock` snapshot.
   - `npm-conflict`: `package.json` with `dependencies:{react:'^17.0.0',lodash:'^4.17.21'}`.
   - `python-basic/pyproject.toml` with `[project] name/version/dependencies=['requests>=2.0']`.
   - `cargo-basic/Cargo.toml` with `[dependencies] serde = "1"`.
   - `go-basic/go.mod` with `module example.com/a` + a `require` block.
2. Write `endtoend.test.ts`:
   - `detect() → parse() → merge() → generateDepReport()` for a pair of npm fixtures (`npm-basic` + `npm-conflict`), asserting the report's `conflicts`/`depCounts`.
   - Cross-ecosystem: parse+serialize round-trip for python/cargo/go fixtures, asserting `serialize(parse(x))` normalized.
   - `regenerateLockfile` on npm fixture (marked `v2` if network-restricted) — fall back to asserting command dispatch instead.
3. Add a script `"test:deps-fix"` in `packages/core/package.json` running `bun test src/deps --coverage` with an 80% line-coverage gate on `src/deps/`.
4. Keep fixtures generated/committed, not cloned at runtime, so CI is deterministic without network.
5. Run `bun test` and fix any parser bugs surfaced by real manifests.

**Required MCPs/Connectors:** None (all fixtures local; npm registry only if lockfile test un-mocked — gate it).

**Skills to Invoke:** None. This is fixture authoring + coverage gating, not a tool dependency.

**Acceptance Criteria:**
- [ ] `__fixtures__` contains one valid repo per ecosystem, committed (not generated at runtime)
- [ ] End-to-end npm test yields a `DependencyReport` with expected conflict statuses and counts
- [ ] Round-trip serialize/parse passes for python/cargo/go fixtures
- [ ] `test:deps-fix` script runs `bun test src/deps --coverage` with ≥80% line coverage gate
- [ ] All tests deterministic (no network in CI)
- [ ] Parser bugs found by real manifests are fixed with a unit test added

**Tests Required:** `endtoend.test.ts` + existing `deps/*.test.ts` all green under the coverage gate:
- `it('full npm pipeline end-to-end')`, `it('python serialize round-trips')`, `it('cargo serialize round-trips')`, `it('go serialize round-trips')`

**Dependencies:** P-116 (report builder). Core-only, own fixtures.

**Handoff Notes:** Next: P-118 begins the License epic. The npm fixture with `react@^17`/`react@^18`-style conflict is intentionally reusable for `P-109`/`P-219` demos. If a later phase changes parser semantics, update fixtures + golden report here. Keep fixture dir committed with realistic file sizes (exclude `node_modules`).

---




### P-118: License — Scan Declared Licenses

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-117

**Context:** License compliance is a hard gate for repository composition. Before child repo C is created, repo-stitcher must know every dependency's declared license so it can enforce policy (P-120/P-121). This phase uses `license-checker` (already added in P-019) to enumerate installed packages and their declared `licenses` values, producing an ordered `DeclaredLicense[]`. This is the raw scan; normalization and policy happen in P-119+.

**Files to Create/Modify:**
- `packages/core/src/license/scan.ts` (fill stub — keep the provided skeleton)
- `packages/core/src/license/scan.test.ts` (new)
- `packages/core/src/license/index.ts` (new barrel)

**Implementation Steps:**
1. Preserve the provided `licenseChecker.init({ start: repoPath, production: true, json: true, unknown: true, excludePrivatePackages: false }, cb)` skeleton in `scan.ts`, but replace the naive `pkg.split('@')` logic with robust parsing:
   - npm keys look like `name@version`; use `parseNpmPkg` that handles scoped packages (`@scope/name@1.2.3`) correctly via last-`@` split.
   - If `info.licenses` is an array (common for dual-license), join with ` OR `.
2. Map `licenseChecker` errors to `err('LICENSE_SCAN_FAILED', String(err))` as in the stub, but also handle the `unknown: true` case where `info.licenses === 'UNKNOWN'` (deferred to P-123).
3. Normalize each `DeclaredLicense` to the shared shape; include `package`, `version`, `licenses` (string), `repository?`, `licenseFile?`, plus `path` (parent package for provenance).
4. Sort results by package name for deterministic output; dedupe by `package@version`.
5. Export `scanDeclaredLicenses` + `DeclaredLicense` from `license/index.ts`; add `bun run typecheck` + unit test.

**Required MCPs/Connectors:** None — local scan via `license-checker` over the local `node_modules`. No network access.

**Skills to Invoke:** None. `license-checker` is a dev tool, not an MCP connector.

**Acceptance Criteria:**
- [ ] `scanDeclaredLicenses(repoPath)` returns `DeclaredLicense[]` with correct `package`/`version` split for scoped packages (`@scope/name` preserved)
- [ ] Dual-license value (`['MIT','Apache-2.0']`) normalized to `"MIT OR Apache-2.0"`
- [ ] `UNKNOWN` licenses retained (not dropped) for P-123 handling
- [ ] Non-zero/throw from `license-checker` maps to `err('LICENSE_SCAN_FAILED')`
- [ ] Output sorted + deduped by `package@version`
- [ ] Deterministic across runs on the same fixture

**Tests Required:** `scan.test.ts` against a committed minimal fixture with a `node_modules` stub (or a `test:skip-if-no-network` guard):
- `it('parses scoped package names')`, `it('joins dual licenses with OR')`, `it('retains UNKNOWN')`, `it('maps checker error to LICENSE_SCAN_FAILED')`, `it('sorts and dedupes')`

**Dependencies:** P-117 (deps fixtures provide a `node_modules`-style tree). Core-only; license-checker dep from P-019.

**Handoff Notes:** Next: P-119 normalizes the raw `licenses` strings to canonical SPDX. Because real installs are network-heavy, keep fixture scans small and prefer `test:skip-if-no-network` for live full-tree scans. The `DeclaredLicense.path` field feeds P-124 deep scan and P-311 provenance.

---




### P-119: License — SPDX Normalize

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-118

**Context:** Raw declared licenses are messy: `"MIT*"`, `"The MIT License"`, `"Apache-2"`, typos, or legacy aliases. To run a compatibility matrix (P-120), every license must be normalized to a canonical SPDX identifier with a valid SPDX expression (supporting `OR`/`AND`/`WITH` operators). This phase implements normalization and validation of SPDX expressions, handling dual-license `OR` and exception `WITH` clauses.

**Files to Create/Modify:**
- `packages/core/src/license/spdx.ts` (fill stub with the provided `normalizeToSPDX`/`isValidSPDX`)
- `packages/core/src/license/spdx.test.ts` (new)
- `packages/core/src/license/scan.ts` (call `normalizeToSPDX` during scan)

**Implementation Steps:**
1. Keep the provided helpers, but harden them:
   - `normalizeToSPDX(raw)`: use `spdx-correct` first; if it returns null, fall back to trimming/normalizing case and attempt a fuzzy match against the `spdx-license-list` id set; if still unmatched, return the raw string unchanged (P-123 flags it).
   - `isValidSPDX(expr)`: use `spdx-expression-parse` (add to P-019 deps if missing) to parse the full expression — handles `(MIT OR Apache-2.0)`, `GPL-2.0 WITH Classpath-exception-2.0`, and trailing `+`. Return `false` on parse failure.
2. Implement `normalizeExpression(raw): string` that:
   - Splits on `\s+OR\s+` and `\s+AND\s+`, normalizes each operand, and rejoins preserving operators.
   - Strips parenthesization noise and redundant spaces.
3. Add `parseLicenses(expr): string[]` — returns the set of license ids in an expression (for P-120 matrix lookup).
4. Wire into `scan.ts`: set `licenses = normalizeExpression(licenses)` but preserve the raw value in a new `rawLicenses` field for provenance.
5. Export `normalizeToSPDX`, `isValidSPDX`, `normalizeExpression`, `parseLicenses` from `license/index.ts`; `bun run typecheck` + test.

**Required MCPs/Connectors:** None — pure string/SPDX processing via `spdx-correct`, `spdx-license-list`, `spdx-expression-parse`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `normalizeToSPDX('MIT')` → `'MIT'`; `normalizeToSPDX('the mit license')` → `'MIT'`
- [ ] `isValidSPDX('MIT OR Apache-2.0')` → `true`; `isValidSPDX('NotARealLicense')` → `false`
- [ ] `normalizeExpression('MIT  OR   Apache-2.0')` → `'MIT OR Apache-2.0'` (collapses whitespace)
- [ ] `parseLicenses('(MIT OR Apache-2.0)')` → `['MIT','Apache-2.0']`; `parseLicenses('GPL-3.0 WITH Classpath-exception-2.0')` → `['GPL-3.0']`
- [ ] Unrecognized raw string returned unchanged (no crash), flagged in P-123
- [ ] `scan.ts` records both `licenses` (normalized) and `rawLicenses`

**Tests Required:** `spdx.test.ts`:
- `it('normalizes common aliases')`, `it('parses AND/OR expressions')`, `it('validates WITH exception')`, `it('returns false for invalid expr')`, `it('parseLicenses extracts operands')`, `it('keeps unknown raw unchanged')`

**Dependencies:** P-118 (consume raw scan). Ensure `spdx-expression-parse` added to `core` deps.

**Handoff Notes:** Next: P-120 builds the compatibility matrix over normalized SPDX. The `rawLicenses` retention is deliberate — provenance must record what the manifest actually said, not just the normalized form.

---




### P-120: License — Compatibility Matrix

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-119

**Context:** With licenses normalized to SPDX, repo-stitcher must decide whether merging A and B into C is legally sound. This phase implements the license category model (`permissive`, `weak-copyleft`, `strong-copyleft`, `network-copyleft`, `unknown`) and the pairwise compatibility matrix, returning a `CompatibilityResult` with an allow/deny decision per combination and a policy-level verdict. This is the first substantive legal-policy gate in the pipeline.

**Files to Create/Modify:**
- `packages/core/src/license/compat.ts` (fill stub with the provided `LICENSE_CATEGORIES` and `checkCompatibility`)
- `packages/core/src/license/compat.test.ts` (new)
- `packages/core/src/license/types.ts` (add `LicensePolicy`, `CompatibilityResult`)

**Implementation Steps:**
1. Keep the provided `LICENSE_CATEGORIES` map and add missing common SPDX ids (e.g. `BlueOak-1.0.0` → permissive, `EUPL-1.2` → strong-copyleft); add a `NON_SPDX` fallback → `unknown`.
2. Define in `types.ts`:
   ```ts
   export interface LicensePolicy {
     allow: ('permissive' | 'weak-copyleft' | 'strong-copyleft' | 'network-copyleft')[]
     denyUnknown: boolean
     requireAttribution: boolean
     targetLicense: string   // desired license for C, e.g. 'MIT'
   }
   export interface CompatibilityResult { decision: 'allow' | 'deny' | 'review'; reasons: string[]; failingCategories: LicenseCategory[] }
   ```
3. Implement a category-lattice check: `checkCategory(a, b)` returns `allow` if both categories are in `policy.allow`; `review` if a strong/network-copyleft with a non-copyleft pair (needs human); `deny` if any category `not in policy.allow` or `unknown` with `denyUnknown`. Conservative default.
4. Implement `checkCompatibility(licenses: string[], policy: LicensePolicy): CompatibilityResult`:
   - Map each normalized license → category (unknown if unknown or non-SPDX).
   - Cross-check every pair via `checkCategory`; also check each single category against `policy.allow`.
   - Special-case `targetLicense`: if any dep is `network-copyleft` (AGPL/SSPL) and target is permissive → `deny` unless explicitly approved.
   - Accumulate `reasons[]` strings; set `decision`.
5. Export from `license/index.ts`; `bun run typecheck` + test.

**Required MCPs/Connectors:** None — pure category/policy logic over SPDX input. If an org policy source exists later, it plugs in here as a `LicensePolicy` override.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `checkCompatibility(['MIT'], {allow:['permissive'],...})` → `decision:'allow'`
- [ ] `MIT` + `GPL-3.0` under `allow:['permissive']` → `decision:'review'` (strong-copyleft pair needs attention) or `deny` per policy
- [ ] AGPL/SSPL with permissive target → `decision:'deny'` by default
- [ ] Unknown/non-SPDX with `denyUnknown:true` → `decision:'deny'`; `denyUnknown:false` → `review`
- [ ] `CompatibilityResult.reasons` explains each failing pair/category
- [ ] Every SPDX id in `LICENSE_CATEGORIES` maps to a valid category (no undefined)

**Tests Required:** `compat.test.ts`:
- `it('allows permissive only')`, `it('reviews strong-copyleft pair')`, `it('denies AGPL with permissive target')`, `it('handles unknown per denyUnknown')`, `it('reasons explain decision')`, `it('covers all categories map')`

**Dependencies:** P-119 (normalized SPDX). Core-only; policy defaults live in config (P-033).

**Handoff Notes:** Next: P-121 adds GPL/AGPL-specific warnings and remediation. The `CompatibilityResult` feeds the license report shown in the CLI `P-198` and web UI `P-222`, and is a hard gate before C creation (`P-205`).

---




### P-121: License — GPL/AGPL Warning

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-120

**Context:** GPL and AGPL carry linking/derivative-work obligations that are easy to violate silently in a composed repo. This phase adds targeted, actionable warnings whenever GPL-family code appears, with conservative defaults for JS/TS (any GPL dependency = warning because static linking/imports blur the boundary). It generates remediation suggestions (e.g. replace dep, isolate via subprocess, obtain permission) rather than just flagging.

**Files to Create/Modify:**
- `packages/core/src/license/gpl.ts` (fill stub)
- `packages/core/src/license/gpl.test.ts` (new)
- `packages/core/src/license/compat.ts` (call GPL warning after matrix)

**Implementation Steps:**
1. Define `GPL_REMEDIATIONS` map keyed by situation → action text:
   - replace package with permissive alternative
   - vendor under separate module + dynamic boundary
   - include GPL notice + source offering
   - obtain written permission from copyright holder
2. Implement `checkGpl(declared: DeclaredLicense[], isJsTs: boolean): GplWarning[]`:
   - Flag any license whose category is `strong-copyleft`/`network-copyleft` (GPL-2.0/3.0, AGPL, SSPL, LGPL handled as weak).
   - For JS/TS repos (detected from `manifest.ecosystem === 'npm'` or presence of `package.json`), any GPL dep → `warning` (conservative: imports count as linking).
   - For non-JS, use linking heuristic: if GPL is a direct dependency that ships source-interop (wasm/native addon), warn; else informational.
3. Set `severity: 'warning'`, `package`, `license`, `suggestion` (from `GPL_REMEDIATIONS`).
4. Integrate in `compat.ts`: after `checkCompatibility`, if decision is `review`/`deny` and GPL detected, append GPL warnings to a combined report; keep them separate from category failures.
5. Export `checkGpl`, `GplWarning`, `GPL_REMEDIATIONS` from `license/index.ts`; `bun run typecheck` + test.

**Required MCPs/Connectors:** None — local logic only.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Any GPL-2.0/3.0/AGPL in a `package.json`-based repo produces a `warning` with a remediation `suggestion`
- [ ] LGPL/MPL (weak-copyleft) do NOT trigger the GPL warning (handled as weak, permissive-if-dynamic)
- [ ] Non-JS repo with GPL as direct dep heuristic produces warning; informational otherwise
- [ ] Each warning includes `package`, `license`, `severity:'warning'`, and a non-empty `suggestion`
- [ ] Warnings integrate into the license report alongside matrix results without double-counting the same license as a hard `deny` when already warned
- [ ] No crashes for unknown license strings

**Tests Required:** `gpl.test.ts`:
- `it('warns on GPL dep in JS repo')`, `it('does not warn on LGPL')`, `it('provides remediation suggestion')`, `it('handles non-JS link heuristics')`, `it('integrates with checkCompatibility')`

**Dependencies:** P-120 (category model + matrix decide what counts as GPL-family). Core-only.

**Handoff Notes:** Next: P-122 handles dual-license expressions (MIT OR GPL-3.0), choosing the most permissive compliant option. GPL warnings should surface to the user as yellow (warn) in web UI `P-222`, never silently downgraded.

---




### P-122: License — Dual-License Handling

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-121

**Context:** Many packages are dual-licensed with an `OR` expression, e.g. `MIT OR Apache-2.0` or `Apache-2.0 OR GPL-3.0`. Under a dual license the user may choose either option, which can dramatically change compliance outcome. This phase parses `OR` expressions, evaluates each branch against policy + target license, and reports the most permissive compatible option while surfacing all valid choices.

**Files to Create/Modify:**
- `packages/core/src/license/dual.ts` (fill stub)
- `packages/core/src/license/dual.test.ts` (new)
- `packages/core/src/license/compat.ts` (use dual resolution when an `OR` expression appears)

**Implementation Steps:**
1. Implement `parseOrExpression(expr): string[]` — split on top-level `OR` (respecting parentheses) using the existing `parseLicenses` from P-119, but keep candidates ordered as written.
2. Implement `chooseDualLicense(expr, policy, targetLicense): DualDecision`:
   ```ts
   export interface DualDecision { expression: string; recommended: string; alternatives: string[]; allCompliant: boolean; reasons: string[] }
   ```
   - For each branch, call `checkCompatibility([branch], policy)`.
   - Filter to compliant branches; pick `recommended` = the most permissive compliant one (permissiveness order: permissive > weak-copyleft > strong-copyleft; tie-break lexicographic).
   - If none compliant → `allCompliant:false`, `recommended` stays the most permissive overall, flag `reasons`.
3. Handle `WITH` exception (e.g. `GPL-3.0 WITH Classpath-exception`) as a sub-clause that may relax GPL — treat as permissive-for-linking in `checkCompatibility` context; note in reasons.
4. Integrate into `checkCompatibility`: if any input contains `OR`, resolve via `chooseDualLicense` first instead of feeding the raw expression to the matrix.
5. Export from `license/index.ts`; `bun run typecheck` + test.

**Required MCPs/Connectors:** None — expression parsing pushed over the existing matrix.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `parseOrExpression('MIT OR Apache-2.0')` → `['MIT','Apache-2.0']`
- [ ] `chooseDualLicense('MIT OR GPL-3.0', allowPermissive...)` → `recommended:'MIT'`, `alternatives:['GPL-3.0']`, `allCompliant:true`
- [ ] `chooseDualLicense('GPL-3.0 OR AGPL-3.0', allowPermissiveOnly)` → `allCompliant:false`, reasons explain no permissive branch
- [ ] Nested/parenthesized `OR` handled without crashing (e.g. `(MIT OR Apache-2.0) OR BSD-3-Clause`)
- [ ] `WITH` exception relaxes GPL classification in this context, reflected in reasons
- [ ] `checkCompatibility` uses dual resolution when an `OR` is present

**Tests Required:** `dual.test.ts`:
- `it('parses OR branches')`, `it('chooses most permissive compliant')`, `it('reports no-compliant case')`, `it('handles nested parens')`, `it('treats WITH exception as relaxed')`, `it('integrates into checkCompatibility')`

**Dependencies:** P-121 (GPL warning context + category model). Core-only, no cross-owner.

**Handoff Notes:** Next: P-123 flags unknown/non-SPDX licenses for human decision. The `recommended` license candidate feeds the `LICENSE` generation for C in P-125, and the `alternatives` list is shown in web UI `P-222`.

---




### P-123: License — Unknown Detection

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-122

**Context:** Some packages have no recognizable license — `UNKNOWN`, `SEE LICENSE IN ...`, a non-SPDX string, or no `license` field at all. These cannot be evaluated by the matrix and must surface for explicit human decision (allow/deny) before the repo is composed. This phase flags all unknown/non-SPDX licenses, dedupes them, and routes them into a decision queue that blocks C creation until resolved or explicitly overridden.

**Files to Create/Modify:**
- `packages/core/src/license/unknown.ts` (fill stub)
- `packages/core/src/license/unknown.test.ts` (new)
- `packages/core/src/license/report.ts` (new — aggregate license findings into a `LicenseReport`)

**Implementation Steps:**
1. Implement `detectUnknown(declared: DeclaredLicense[]): UnknownLicense[]`:
   ```ts
   export interface UnknownLicense { package: string; version: string; rawLicense: string; path?: string; decision: 'pending' | 'allow' | 'deny' }
   ```
   - Flag where normalized SPDX is `UNKNOWN`, not `isValidSPDX`, or raw contains `SEE LICENSE`/`Custom`/`UNKNOWN`/empty.
   - Lane-ful: do NOT auto-drop; all are `decision:'pending'` by default.
2. Implement a decision store (in-memory for now; `bun:sqlite` in P-230 replaces it) `recordLicenseDecision(pkg, decision)` + `getPendingUnknown()`. Persist decisions to a JSON sidecar in the working dir so they survive a session (optional).
3. Implement `aggregateLicenseReport(declared, policy, matrixResult, dualResult)` in `report.ts` → `LicenseReport` containing: `scanned: DeclaredLicense[]`, `unknown: UnknownLicense[]`, `gplWarnings: GplWarning[]`, `matrix: CompatibilityResult`, `blocking: boolean` (true if any pending unknown or matrix `deny`).
4. Wire into the scan entry point (CLI later): scan → normalize (P-119) → matrix (P-120) → gpl (P-121) → dual (P-122) → unknown → aggregate report. Surface `blocking` so C creation (`P-205`) halts.
5. Export `detectUnknown`, `UnknownLicense`, `aggregateLicenseReport`, `LicenseReport` from `license/index.ts`; `bun run typecheck` + test.

**Required MCPs/Connectors:** None — local. The "decision queue" is plain data; no human-approval MCP is wired in this phase (CLI will present it in P-198).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `detectUnknown` flags `UNKNOWN`, empty, `SEE LICENSE IN`, and non-SPDX strings as `decision:'pending'`
- [ ] Known SPDX (e.g. `MIT`) is NOT flagged as unknown
- [ ] `recordLicenseDecision('foo','allow')` moves it out of `pending`
- [ ] `aggregateLicenseReport` sets `blocking:true` when any pending unknown or matrix `deny` exists
- [ ] Report includes scanned list, unknown list, GPL warnings, and matrix result
- [ ] Unknown licenses are never silently dropped; always surfaced or overridden

**Tests Required:** `unknown.test.ts` + `report.test.ts`:
- `it('flags unknown license strings')`, `it('does not flag valid SPDX')`, `it('records allow/deny decision')`, `it('blocking reflects pending unknown')`, `it('aggregates full license report')`

**Dependencies:** P-122 (dual resolution complete; expression handling upstream). Core-only.

**Handoff Notes:** Next: P-124 deep per-file header scan (ScanCode opt-in) for enhanced detection, and P-125 generates the LICENSE file for C from the resolved target license. Ensure the decision store is easy to swap for `bun:sqlite` persistence in P-230 without changing the `detectUnknown` shape.

---




### P-124: License - Per-File Header Scan (ScanCode Opt-in)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-123

**Context:** Declared-license scanning (P-118) only sees `package.json`/manifest `license` fields, which can be missing or misleading. For repos where the user opts in, this phase shells out to `scancode-toolkit` to inspect per-file license/copyright headers, producing a richer `DeepScanResult` that can surface findings the manifest misses (e.g. a stray GPL file inside an otherwise-MIT repo). It is strictly opt-in via `config.licensePolicy.deepScan` (default `false`) because ScanCode is a heavy Python dependency and slow on large repos.

**Files to Create/Modify:**
- `packages/core/src/license/deepScan.ts` (fill stub — keep the provided `runScanCode` signature)
- `packages/core/src/license/deepScan.test.ts` (new)
- `packages/core/src/license/types.ts` (add `DeepScanResult`, `DeepScanFile`)
- `packages/core/src/license/index.ts` (export `runScanCode`)

**Implementation Steps:**
1. Preserve the provided signature:
   ```ts
   export async function runScanCode(repoPath: string): Promise<Result<DeepScanResult, StitchError>>
   ```
   Add `DeepScanFile`/`DeepScanResult` to `types.ts`:
   ```ts
   export interface DeepScanFile { path: string; licenses: string[]; copyrights: string[] }
   export interface DeepScanResult { scanner: 'scancode' | 'none'; files: DeepScanFile[]; totalFiles: number; scannedAt: string; optIn: boolean }
   ```
2. Guard: if `config.licensePolicy.deepScan !== true`, return `ok({ scanner:'none', files:[], totalFiles:0, scannedAt: iso(), optIn:false })` immediately — no subprocess spawned.
3. Locate `scancode-toolkit` binary (`scancode` on PATH or `config.licensePolicy.scanCodePath`). If abschild:
   - On first run, print a warning and return `err('SCANCODE_MISSING', { action: 'install scancode-toolkit via pip', optInPath: config.licensePolicy.scanCodePath })`.
4. Shell out via the shared `execCmd` (from P-114): `scancode --json-pp - --license --copyright --only-findings --ignore "**/.git/**" <repoPath>` with a generous timeout (300s). Capture stdout JSON.
5. Parse stdout: map the `files[]` array (each has `path`, `licenses[].spdx_license_key`, `copyrights[].value`) into `DeepScanFile[]`, filtering out empty files.
6. Fold results: intersect per-file detected SPDX ids with the declared set from P-118; anything detected-but-not-declared is flagged as `unexpectedLicense` for the P-128 report to surface as a `needs-attention` finding.
7. Export `runScanCode`, `DeepScanFile`, `DeepScanResult` from `license/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None. `scancode-toolkit` is a local Python tool invoked via `child_process`; no online connector.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `runScanCode(repoPath)` with `deepScan:false` returns `{scanner:'none', optIn:false}` and never spawns a process
- [ ] With `deepScan:true` and a stub `scancode` binary (fixture script), returns `DeepScanResult` with parsed per-file licenses/copyrights from its JSON
- [ ] Unexpected per-file license not in the declared set is included in output for later flagging
- [ ] Missing binary maps to `err('SCANCODE_MISSING')` with actionable message
- [ ] Non-zero exit / bad JSON maps to a typed `StitchError` (e.g. `SCANCODE_FAILED`)
- [ ] `.git` and irrelevant dirs excluded (no scan explosion)

**Tests Required:** `deepScan.test.ts`:
- `it('skips when opt-in is off')` (assert no exec mocked called)
- `it('parses scancode JSON output')` — point a fake `scancode` script at a fixture that emits known JSON; assert `files`
- `it('flags unexpected per-file license')`
- `it('errors when binary missing')` — set `scanCodePath` to a nonexistent path
- `it('maps bad JSON to SCANCODE_FAILED')`

**Dependencies:** P-123 (unknown detection so per-file findings reconcile against declared set). Core-only.

**Handoff Notes:** Next: P-125 generates the LICENSE file for C from the resolved target license, using findings from this phase only when `deepScan` is on. Keep `DeepScanResult.optIn` so downstream report/UI can show the scan is shallow by default. ScanCode is never on by default — document in license guide (P-277).

---




### P-125: License - Generate LICENSE for C

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-124

**Context:** Child repo C must ship a concrete `LICENSE` file matching the resolved `targetLicense` (from `LicensePolicy` in P-120/P-127). This phase renders the official license text (MIT/Apache-2.0/GPL-3.0 plus a small embedded set) with correct copyright lines derived from provenance (P-181 source authors) and the current year, writes it to `<repoC>/LICENSE`, and validates the file renders correctly. It is the artifact that makes C's license concrete and auditable.

**Files to Create/Modify:**
- `packages/core/src/license/generate.ts` (fill stub)
- `packages/core/src/license/generate.test.ts` (new)
- `packages/core/src/license/licenses/` (new — embedded text templates: `mit.txt`, `apache-2.0.txt`, `gpl-3.0.txt`, `bsd-3-clause.txt`, `mpl-2.0.txt`)
- `packages/core/src/license/types.ts` (add `GeneratedLicense`)

**Implementation Steps:**
1. Add `GeneratedLicense` to `types.ts`:
   ```ts
   export interface GeneratedLicense { licenseId: string; path: string; year: string; holderLines: string[]; checksumSha256: string }
   ```
2. Create `licenses/` dir with embedded plain-text templates for the supported set (MIT, Apache-2.0, BSD-3-Clause, GPL-3.0, MPL-2.0). Keep `apache-2.0.txt`'s APPENDIX structure intact but omit the full notice appendix for brevity (reference URL instead) — or embed full text for fidelity; prefer full official text via a checked-in canonical copy.
3. Implement `generateLicense(licenseId: string, holders: { name: string; year?: number }[], repoPath: string): Promise<Result<GeneratedLicense, StitchError>>`:
   - Look up template by SPDX id; if unsupported, use a generic header template + `SEE LICENSE in https://spdx.org/licenses/<id>.html` fallback.
   - Compute `year` = current year (or max author year when available).
   - Build `holderLines` (dedupe, alphabetize) from the merged provenance author list (P-181) — at minimum `Copyright (c) <year> <author>`.
   - `fs-extra.outputFile(path.join(repoPath,'LICENSE'), text)`.
   - sha256 the written file into `checksumSha256` (feeding P-186 checksum manifest at provenance time).
4. Ensure the LICENSE is written at the repo root and, for npm, add a `"license": "<id>"` field to the merged `package.json` if absent (write-back via P-104 serializer).
5. Verify: re-read the file, assert it starts with expected header; return the `GeneratedLicense`.
6. Export from `license/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None. License text is embedded; no SPDX API call needed (templates vendored).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `generateLicense('MIT',[{name:'Alice'}],dir)` writes `<dir>/LICENSE` whose text begins `MIT License` and contains `Copyright (c) <year> Alice`
- [ ] Supported ids render full official text; unsupported id uses the SEE-LICENSE fallback without error
- [ ] Multiple holders are deduped and alphabetized; year defaults to current
- [ ] `checksumSha256` matches `sha256(await fs.readFile(path))`
- [ ] npm `package.json` gains a `license` field when missing
- [ ] Failure to write maps to a typed `StitchError`

**Tests Required:** `generate.test.ts`:
- `it('writes MIT license with holder')`, `it('renders each supported template')`, `it('falls back for unsupported id')`, `it('dedupes and sorts holders')`, `it('checksum matches file')`, `it('adds license field to package.json')`

**Dependencies:** P-124 (deep-scan findings, though optional for generation). Core-only.

**Handoff Notes:** Next: P-126 generates `NOTICE`/attribution. The generated `LICENSE` should be excluded from provider diff during stitching (P-075 conflict resolver) since C owns its license. Wire `checksumSha256` into the provenance checksum manifest later (P-186).

---




### P-126: License - NOTICE/Attribution

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-125

**Context:** Several licenses (Apache-2.0, BSD, AGPL) and good practice require preserving upstream copyright notices even after re-licensing C. This phase generates a `NOTICE` file that lists every source dependency with its declared license and copyright line, sourced from the P-118 scan + P-181 provenance, so C complies with attribution obligations and gives auditors a one-file summary.

**Files to Create/Modify:**
- `packages/core/src/license/notice.ts` (new)
- `packages/core/src/license/notice.test.ts` (new)
- `packages/core/src/license/generate.ts` (call notice generation as part of license generation, or keep separate entry `generateNotice`)

**Implementation Steps:**
1. Add `NoticeEntry`/`NoticeResult` to `types.ts`:
   ```ts
   export interface NoticeEntry { package: string; version: string; license: string; copyright?: string; sourceRepo?: string }
   export interface NoticeResult { path: string; entries: NoticeEntry[] }
   ```
2. Implement `generateNotice(entries: NoticeEntry[], repoPath: string): Promise<Result<NoticeResult, StitchError>>`:
   - Sort entries by package name; drop duplicates by `package@version`.
   - Render a header `
This product includes software developed by the contributors below.
` followed by grouped sections keyed by SPDX license.
   - Write to `<repoPath>/NOTICE` via `fs-extra.outputFile`.
3. Wire into `generate.ts`: after generating `LICENSE`, if `policy.requireAttribution` is true, also call `generateNotice` with entries derived from `DeclaredLicense[]` + provenance authors.
4. Preserve existing `NOTICE` content in source repos (P-083 `.gitignore` merge already handles file-level merges — THIS phase produces C's consolidated one; do not overwrite a user-modifiable existing NOTICE without a diff preview, surfaced via P-128 report).
5. Export `generateNotice`, `NoticeEntry`, `NoticeResult` from `license/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `generateNotice(entries, dir)` writes `<dir>/NOTICE` with each entry's package/version/license (and copyright when available)
- [ ] Entries sorted by package; duplicates by `package@version` removed
- [ ] `requireAttribution:true` triggers NOTICE generation after LICENSE
- [ ] `requireAttribution:false` skips generation
- [ ] Existing `NOTICE` is not silently clobbered — a diff/new-file decision is surfaced
- [ ] Content is deterministic (stable ordering)

**Tests Required:** `notice.test.ts`:
- `it('writes NOTICE with entries')`, `it('sorts and dedupes entries')`, `it('triggers from requireAttribution')`, `it('skips when attribution off')`, `it('surfaces existing NOTICE diff')`

**Dependencies:** P-125 (LICENSE generation flow to attach notice generation to). Core-only.

**Handoff Notes:** Next: P-127 implements the license policy allow/deny engine that both this NOTICE output and the earlier matrix feed into. `NoticeEntry.sourceRepo` is filled later from P-181 provenance; keep it optional so this phase is self-contained.

---




### P-127: License - Policy Allow/Deny

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-126

**Context:** All license signals (declared scan, SPDX normalize, compatibility matrix, GPL warnings, dual-license resolution, unknown detection, deep scan) must converge into a single policy verdict that gates C creation. This phase implements the `LicensePolicy` evaluation engine and the final `LicenseReport` that decides `allow`/`deny`/`review` with explicit reasons, and merges the human overrides from unknown detection (P-123) into policy evaluation.

**Files to Create/Modify:**
- `packages/core/src/license/policy.ts` (new — evaluation + aggregation)
- `packages/core/src/license/policy.test.ts` (new)
- `packages/core/src/license/types.ts` (expand `LicenseReport`)
- `packages/core/src/license/report.ts` (delegate to policy engine)

**Implementation Steps:**
1. Expand `LicenseReport` in `types.ts` to the full aggregate:
   ```ts
   export interface LicenseReport {
     declared: DeclaredLicense[]
     unknown: UnknownLicense[]
     gplWarnings: GplWarning[]
     matrix: CompatibilityResult
     dual: DualDecision[]
     deep: DeepScanResult | null
     notice?: NoticeResult
     generatedLicense?: GeneratedLicense
     verdict: 'allow' | 'deny' | 'review'
     blocking: boolean
     reasons: string[]
   }
   ```
2. Implement `evaluatePolicy(reportRef: LicenseAggregateFields, policy: LicensePolicy, overrides: Map<string, 'allow'|'deny'>): LicenseReport`:
   - Start `verdict:'allow'`, `blocking:false`.
   - For each pending unknown: if `overrides` has `allow` → treat as resolved; else set `verdict='review'` and `blocking=true` (`deny` override on a pending unknown → `verdict='deny'`).
   - Fold `matrix.decision`: if `deny` → verdict `deny`; if `review` → at least `review`.
   - Apply GPL warnings: they never downgrade below `review` when any warning exists; they add reasons.
   - Apply dual-license `allCompliant:false` findings as `deny`/`review` per policy.
   - If no pending unknowns and no deny and no mandatory review → `allow`.
3. Build `reasons[]` from every contributing gate (one line each, prefixed with gate name).
4. Implement `finalGate(report): boolean` = `report.verdict==='allow'`, used by orchestration before C creation (P-205) and by UI keep/abort (P-218).
5. Refactor `report.ts` to call `evaluatePolicy` so single source of truth; keep public shape of the existing `aggregateLicenseReport` signature.
6. Export `evaluatePolicy`, `finalGate` from `license/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None. The `overrides` map is the human decision surface, fed by CLI (P-198) / web (P-222); no MCP needed.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] All-clear report (permissive deps, no unknown) → `verdict:'allow'`, `blocking:false`, `finalGate===true`
- [ ] Pending unknown without override → `verdict:'review'`, `blocking:true`
- [ ] Pending unknown with `deny` override → `verdict:'deny'`
- [ ] Matrix `deny` → `verdict:'deny'` regardless of overrides
- [ ] GPL warning present → verdict at least `review`, with a "gpl-warning" prefixed reason
- [ ] `reasons` explains every non-allow contribution
- [ ] `finalGate` returns `report.verdict==='allow'`

**Tests Required:** `policy.test.ts`:
- `it('allows when clear')`, `it('reviews on pending unknown')`, `it('denies on deny override')`, `it('denies on matrix deny')`, `it('reviews on gpl warning')`, `it('reasons aggregate every gate')`, `it('finalGate reflects verdict')`

**Dependencies:** P-126 (NOTICE output available, attribution policy harmonized). Core-only; policy defaults in config P-033.

**Handoff Notes:** Next: P-128 serializes the full `LicenseReport` into a user-facing report data structure and starts the License tests phase. `evaluatePolicy` is the single gate the pipeline calls — keep it side-effect-free so it is trivially testable and reusable by CLI/web. Update `DECISIONS.md` ADR if policy defaults change.

---




### P-128: License - License Report Data

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-127

**Context:** With every license gate implemented (scan P-118 through policy P-127), repo-stitcher needs one serializable, UI-ready data object that the CLI (P-196/P-198), the web license panel (P-220/P-222), and the provenance record (P-311) all render from. This phase defines the concrete `LicenseReportData` shape and provides pure builders + a deterministic JSON renderer, so the same data drives a terminal table, a React panel, and a persisted report file.

**Files to Create/Modify:**
- `packages/core/src/license/report.ts` (fill stub)
- `packages/core/src/license/report.test.ts` (new)
- `packages/core/src/license/types.ts` (finalize `LicenseReportData`)

**Implementation Steps:**
1. Define the serializable shape in `types.ts`:
   ```ts
   export interface LicenseReportRow { package: string; version: string; declared: string; normalized: string; category: LicenseCategory; decision: 'allow' | 'review' | 'deny'; reason?: string }
   export interface LicenseReportData {
     reportVersion: 1
     generatedAt: string
     verdict: 'allow' | 'deny' | 'review'
     blocking: boolean
     rows: LicenseReportRow[]
     summary: { total: number; allow: number; review: number; deny: number; unknown: number; gplWarnings: number }
     dualLicenses: DualDecision[]
     gplWarnings: GplWarning[]
     unknown: UnknownLicense[]
   }
   ```
2. Implement `buildLicenseReportData(declared: DeclaredLicense[], policyEval: LicenseReport, captures: { dual: DualDecision[]; gpl: GplWarning[]; unknown: UnknownLicense[] }): LicenseReportData`:
   - Map each `DeclaredLicense` to a `LicenseReportRow` using its normalized SPDX, category (from P-120 `LICENSE_CATEGORIES`), and the decision assigned by the P-127 policy evaluation.
   - Fold dual-license/GPL/unknown arrays into `rows` (dual packages get one row showing the recommended branch; GPL-warned get `reason`).
   - Compute `summary` counts from rows.
3. Implement `renderLicenseReportJson(data): string` = `JSON.stringify(data, null, 2)` with deterministic key order (build object literal in fixed order).
4. Keep `report.ts` purely functional — no I/O — so it is trivially testable; the CLI/UI packages call these builders.
5. Export `buildLicenseReportData`, `renderLicenseReportJson`, `LicenseReportRow`, `LicenseReportData` from `license/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — pure data assembly over the P-127 policy verdict and scan captures.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `buildLicenseReportData` maps every declared license to a `LicenseReportRow` with correct normalized/category/decision
- [ ] Dual-license, GPL-warning, and unknown packages each appear in rows with an explanatory `reason` where relevant
- [ ] `summary` counts match the rows (allow/review/deny/unknown/gplWarnings)
- [ ] `renderLicenseReportJson` is deterministic and parses back to the same object
- [ ] `reportVersion:1` present for future migration
- [ ] No network/I/O in the builders

**Tests Required:** `report.test.ts`:
- `it('builds rows from declared set')`, `it('annotates dual/gpl/unknown rows')`, `it('computes summary counts')`, `it('renders deterministic JSON')`, `it('round-trips through JSON.parse')`

**Dependencies:** P-127 (policy verdict + aggregate). Core-only.

**Handoff Notes:** Next: P-129 formalizes the deep-scan plugin so alternative scanners can also feed rows. This exact `LicenseReportData` is what web P-220/P-222 and CLI P-196/P-198 render — do not rename fields without a contract bump; version via `reportVersion`.

---




### P-129: License - Deep-Scan Plugin

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-128

**Context:** Per-file scanning (P-124) currently hardcodes ScanCode. To support future scanners (FOSSA, Snyk, custom) without rewriting the scan pipeline, this phase defines a `LicenseScanner` plugin interface with ScanCode as the default implementation, a registry, and a dispatch helper so `runDeepScan` calls whichever scanner is configured.

**Files to Create/Modify:**
- `packages/core/src/license/plugin.ts` (fill stub)
- `packages/core/src/license/plugin.test.ts` (new)
- `packages/core/src/license/deepScan.ts` (refactor to use the plugin registry)

**Implementation Steps:**
1. Define the interface in `plugin.ts`:
   ```ts
   export interface LicenseScanner {
     id: string
     scan(repoPath: string, config: DeepScanConfig): Promise<Result<DeepScanResult, StitchError>>
   }
   export function registerScanner(s: LicenseScanner): void
   export function getScanner(id: string): LicenseScanner
   export function runDeepScan(repoPath: string, config: DeepScanConfig): Promise<Result<DeepScanResult, StitchError>>
   ```
2. Implement the registry (`Map<string, LicenseScanner>`) with `registerScanner`/`getScanner` (throw on unknown id).
3. Refactor `deepScan.ts`: move the ScanCode invocation into `scan.ts`-style `ScanCodeScanner implements LicenseScanner`, keeping the existing `runScanCode` behavior as `getScanner('scancode').scan(...)`.
4. Implement `runDeepScan(repoPath, config)` dispatcher:
   - If `config.scanner` not set or `deepScan !== true` → return `ok({ scanner:'none', ... })` (same no-op as P-124).
   - Else `getScanner(config.scanner).scan(repoPath, config)`.
5. Add a test-only fake scanner registration to prove `runDeepScan` dispatches by id.
6. Export `LicenseScanner`, `registerScanner`, `getScanner`, `runDeepScan` from `license/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None. Future external scanners (FOSSA/Snyk) would be implemented as plugins and could use their own HTTP connectors then; this phase defines the seam.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `getScanner('scancode')` returns the default scanner; `getScanner('unknown')` throws
- [ ] `runDeepScan` with `deepScan:false` returns the `none` no-op without spawning a subprocess
- [ ] Registering a fake scanner makes `runDeepScan` dispatch to it (assert its `scan` called with repoPath+config)
- [ ] `scanCode` behavior unchanged from P-124 (existing tests still pass)
- [ ] `config.scanner` selects among registered scanners
- [ ] All output is `Result`-typed

**Tests Required:** `plugin.test.ts`:
- `it('registers and retrieves scanners')`, `it('throws on unknown scanner id')`, `it('dispatches by id via runDeepScan')`, `it('no-ops when deepScan off')`, `it('scancode default preserved')`

**Dependencies:** P-128 (report data consumes scanner output). Core-only.

**Handoff Notes:** Next: P-130 adds the full License test suite. Keep the scanner interface minimal so FOSSA/Snyk plugins (later, P-287 AI connector analog) only implement `scan`. Document supported scanner ids in the license guide P-277.

---




### P-130: License - Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-129

**Context:** License enforcement is a hard gate — a bug here could let incompatible code into C. This phase consolidates the license modules (scan → normalize → matrix → gpl → dual → unknown → policy → report) into a comprehensive test suite with realistic fixture repos covering the full decision space, plus a coverage gate so the pipeline stays trustworthy as it grows.

**Files to Create/Modify:**
- `packages/core/src/license/__tests__/*.test.ts` (fill/expand)
- `packages/core/src/license/__tests__/fixtures/` (new — fixture repos: `mit-repo`, `gpl-repo`, `dual-repo`, `unknown-repo`, `mixed-repo`)
- `packages/core/package.json` (add `"test:license"` script with coverage threshold)

**Implementation Steps:**
1. Create fixture repos under `__tests__/fixtures/`:
   - `mit-repo/package.json` → `{ license:'MIT', deps:{ lodash: { version, license:'MIT' } } }`
   - `gpl-repo/package.json` → one dep `license:'GPL-3.0'`
   - `dual-repo` → dep `license:['MIT','Apache-2.0']`
   - `unknown-repo` → dep with no license field (expect `UNKNOWN`)
   - `mixed-repo` → MIT + GPL-3.0 (expect `review`)
   - Optionally a `scancode.json` sample + a stub `scancode` bin for P-124/P-129.
2. Add `__tests__/license.suite.ts` that runs the full pipeline per fixture and asserts the expected `LicenseReportData`:
   - `mit-repo` → `verdict:'allow'`, `blocking:false`
   - `mixed-repo` → `verdict:'review'` (GPL warning present)
   - `dual-repo` → recommended `MIT`, `allCompliant:true`
   - `unknown-repo` → pending unknown surfaced, `blocking:true`
   - scancode fixture → `DeepScanResult` parsed (using stub bin) with unexpected per-file finding
3. Add `test:license` script: `bun test src/license --coverage` with an 80% line / 70% branch gate enforced via the vitest coverage config block (reuse P-004 thresholds).
4. Add property-style tests for the compatibility matrix: for a cartesian sample of category pairs, assert the result is `allow` | `review` | `deny` and never throws (table-driven).
5. Run `bun test src/license --coverage` and fix any module surfaced by fixtures.

**Required MCPs/Connectors:** None — all fixtures local; ScanCode stub is a local script.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] One committed fixture per decision case (allow/review/deny/dual/unknown/deep)
- [ ] Full-pipeline suite asserts the expected `verdict`/`blocking` per fixture
- [ ] `test:license` runs `--coverage` with ≥80%/70% line/branch gate and passes
- [ ] Matrix property test enumerates category pairs without throwing
- [ ] All existing license module tests still pass (no regression)
- [ ] Deterministic, network-free

**Tests Required:** `__tests__/license.suite.ts` + `compat.test.ts` property table:
- `it('mit-repo allows')`, `it('mixed-repo reviews on gpl')`, `it('dual-repo picks MIT')`, `it('unknown-repo blocks')`, `it('deep-scan parses stub output')`, `it('matrix never throws for any category pair')`

**Dependencies:** P-129 (deep-scan plugin + report data feed suite). Core-only.

**Handoff Notes:** Next: P-131 begins the AI Provider epic. These fixtures are also reusable by web P-220/P-222 panel tests and CLI integration tests — keep them committed and stable. Bump coverage thresholds only via explicit agreement in `DECISIONS.md`.

---




### P-131: AI Provider - ChatProvider Interface

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-130

**Context:** Multi-provider AI is required for resilient stitching (OpenRouter primary, Anthropic + Ollama secondary). All agent logic (tool loop P-140, streaming P-136) must talk to one interface so providers are swappable at runtime. This phase defines the `ChatProvider` interface and the shared `ChatMessage`/`ToolSchema`/`ChatResponse`/`TokenUsage` types — the contract every provider implementation and the tool-loop adhere to.

**Files to Create/Modify:**
- `packages/core/src/ai/provider.ts` (fill stub — keep the provided `ChatProvider` skeleton)
- `packages/core/src/ai/types.ts` (new — shared types)
- `packages/core/src/ai/index.ts` (new barrel)
- `packages/core/src/ai/provider.test.ts` (new — contract tests for implementors)

**Implementation Steps:**
1. Preserve the provided `ChatProvider` interface in `provider.ts` (name, model, `chat` returning `AsyncIterable<ChatResponse>`, `countTokens`).
2. Move shared types into `ai/types.ts` (keep `ChatMessage`, `ToolSchema`, `ChatResponse`, plus):
   ```ts
   export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
   export interface TokenUsage { input: number; output: number; total: number }
   export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error'
   export interface ProviderError { kind: 'rate_limit' | 'auth' | 'timeout' | 'network' | 'invalid_request' | 'unknown'; message: string; providerName: string; retryable: boolean }
   ```
3. Add the required interface members:
   - `readonly provider: string` (e.g. `'openrouter'`)
   - `readonly id: string` (stable provider id)
   - `isRetryable(err: ProviderError): boolean` default helper.
4. Write a `conformsToChatProvider(impl): void` runtime guard used by the registry (P-134) to validate a provider implements the contract (checks method presence/shape).
5. Export all types + `conformsToChatProvider` from `ai/index.ts`; `bun run typecheck` — the interface must be importable by cli/web.

**Required MCPs/Connectors:** The interface itself is connector-agnostic. Document in this phase's handoff that OpenRouter (via `openai` SDK), Anthropic (`@anthropic-ai/sdk`), and Ollama are the concrete backends but no call happens here.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `ChatProvider` interface compiles and is exported from `ai/index.ts` with all members (name, model, provider, chat, countTokens)
- [ ] `ChatMessage`/`ToolSchema`/`ChatResponse`/`TokenUsage`/`ToolCall`/`ProviderError` all exported
- [ ] `chat` is typed as `AsyncIterable<ChatResponse>` (streaming-capable)
- [ ] `conformsToChatProvider` accepts a valid mock and rejects a malformed object
- [ ] No provider implementation or API call in this phase (interface only)
- [ ] `ProviderError.retryable` semantics documented for P-138 retry

**Tests Required:** `provider.test.ts`:
- `it('interface compiles via conformsToChatProvider(mock)')`, `it('rejects malformed provider')`, `it('types stream as AsyncIterable')`

**Dependencies:** P-130 (license tests close before AI epic). Core-only.

**Handoff Notes:** Next: P-132 implements `OpenAICompatibleProvider` (covers OpenRouter + OpenAI + Ollama via base URL). Any provider added later must pass `conformsToChatProvider`. Keep `finishReason` values frozen — the tool loop P-140 branches on them.

---




### P-132: AI Provider - OpenAICompatibleProvider

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-131

**Context:** OpenRouter, OpenAI, and Ollama all expose an OpenAI-compatible chat/completions endpoint. One `OpenAICompatibleProvider` class (wrapping the `openai` SDK from P-027) covers all three by varying `baseURL`, `apiKey`, and model. This is the primary provider for OpenRouter. It must normalize tool calls, stream responses, and surface typed `ProviderError`s.

**Files to Create/Modify:**
- `packages/core/src/ai/openaiCompatible.ts` (fill stub — keep the OpenRouter default base URL)
- `packages/core/src/ai/openaiCompatible.test.ts` (new)
- `packages/core/src/ai/index.ts` (export `OpenAICompatibleProvider`)

**Implementation Steps:**
1. Add a constructor config type (in `provider.ts` or a new `config.ts`):
   ```ts
   export interface OpenAICompatibleConfig { provider: string; model: string; apiKey: string; baseUrl?: string; defaultHeaders?: Record<string,string> }
   ```
   - Default `baseUrl` for `provider==='openrouter'` is `https://openrouter.ai/api/v1`; allow override for OpenAI (`api.openai.com/v1`) and Ollama (`http://localhost:11434/v1`).
2. Implement `class OpenAICompatibleProvider implements ChatProvider`:
   - `chat(messages, tools, options)`:
     - Build `messages` mapped to the OpenAI chat format; map `ToolSchema[]` → OpenAI function defs.
     - Call `this.client.chat.completions.create({ model, messages, tools, stream: true, ... })` when `options?.stream !== false`; iterate the stream emitting `ChatResponse` chunks; buffer `tool_calls` deltas across chunks (the OpenAI stream splits tool calls into deltas).
     - If `options?.stream === false`, use a single non-streamed call and return a one-element async iterable.
   - Normalize `finishReason` (OpenAI `stop`/`tool_calls`/`length` → internal names) and `usage` (prompt/completion tokens) into `TokenUsage`.
   - Map SDK errors to `ProviderError` via a shared `mapSdkError(err, provider)` (rate_limit on 429/`rate_limit`, auth on 401, timeout/network on fetch errors; `retryable` set for 429/timeout/network).
   - `countTokens(messages)` — approximate heuristic (chars/4) for pre-flight; real counts come from `usage` if the provider returns them.
3. Guard `apiKey` never logged; use `logger.redact`.
4. Wire `defaultHeaders` for OpenRouter `HTTP-Referer`/`X-Title` (optional, for dashboard attribution) without hardcoding.
5. Export `OpenAICompatibleProvider`, `OpenAICompatibleConfig` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** OpenRouter API (primary), OpenAI API (secondary), Ollama local (optional) — all via the `openai` SDK over HTTPS; none are MCP connectors. API key comes from env/config (P-134), never committed.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `chat` with stream returns an `AsyncIterable` yielding `ChatResponse` chunks that accumulate into a full completion
- [ ] Tool-call deltas buffered correctly across chunks (test with mocked nock stream fragments)
- [ ] Non-stream mode returns single-element iterable with full content + usage
- [ ] `finishReason`/`usage` normalized to internal values
- [ ] 429 → `ProviderError{kind:'rate_limit', retryable:true}`; 401 → `auth, retryable:false`
- [ ] OpenRouter default base URL is used when `provider==='openrouter'`; override respected
- [ ] apiKey never appears in logs (assert logger.redact interception, not the value)

**Tests Required:** `openaiCompatible.test.ts` (mock the `openai` client via nock or dependency injection):
- `it('streams chat completion')`, `it('buffers tool call deltas')`, `it('non-stream returns single chunk')`, `it('normalizes finish reason + usage')`, `it('maps 429 to retryable rate limit')`, `it('uses openrouter default base url')`

**Dependencies:** P-131 (interface). Core-only.

**Handoff Notes:** Next: P-133 adds `AnthropicProvider` using `@anthropic-ai/sdk`. Keep the stream-buffering helper here reusable for Anthropic's own `tool_use` blocks. The base-url override is what enables Ollama/OpenAI — document in provider setup guide P-276.

---




### P-133: AI Provider - AnthropicProvider

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-132

**Context:** Anthropic is a secondary but important provider, with a different message/tool protocol (`tool_use`/`tool_result` content blocks). This phase implements `AnthropicProvider` wrapping `@anthropic-ai/sdk` (P-028), converting the internal `ChatMessage`/`ToolSchema` format ↔ Anthropic's block format, and normalizing streaming + tool calls + errors — while exposing the same `ChatProvider` interface so the tool loop never branches on provider.

**Files to Create/Modify:**
- `packages/core/src/ai/anthropic.ts` (fill stub)
- `packages/core/src/ai/anthropic.test.ts` (new)
- `packages/core/src/ai/index.ts` (export `AnthropicProvider`)

**Implementation Steps:**
1. Add config:
   ```ts
   export interface AnthropicConfig { model: string; apiKey: string; baseUrl?: string; maxTokens?: number }
   ```
   - Default `maxTokens` 4096; baseUrl override supported for proxies/testing.
2. Implement `class AnthropicProvider implements ChatProvider`:
   - `chat(messages, tools, options)`:
     - Convert `ChatMessage[]` → Anthropic messages: `role:'assistant'` with `toolCallId` → `tool_use` content blocks; `role:'tool'` → `tool_result` blocks; system messages collected into the top-level `system` field.
     - Convert `ToolSchema[]` → Anthropic `tools` (name/description/input_schema).
     - Call `client.messages.create({ model, max_tokens, system, messages, tools, stream: true })`.
     - Iterate the SSE stream; for `content_block_delta` of type `text_delta` emit content; for `tool_use` accumulate the partial JSON (Anthropic streams tool input as a JSON string delta). On `message_delta` capture `stop_reason`/`usage`.
     - Normalize `stop_reason` (`end_turn`→`stop`, `tool_use`→`tool_calls`, `max_tokens`→`length`) and `usage.input_tokens`/`output_tokens` → `TokenUsage`.
   - `countTokens(messages)` — heuristic (chars/4), consistent with P-132.
   - Map SDK errors via `mapSdkError` (Anthropic `OverloadedError`/429 → retryable `rate_limit`; `AuthenticationError` → `auth`).
3. Guard apiKey never logged (logger.redact).
4. Export `AnthropicProvider`, `AnthropicConfig` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Anthropic API (`@anthropic-ai/sdk`) over HTTPS; not an MCP connector. Tested offline via injected fake client.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `chat` streams text deltas accumulating into full content
- [ ] Internal `tool` role messages convert to `tool_result` blocks; assistant toolCallId converts to `tool_use`
- [ ] Tool-call partial JSON accumulated across stream deltas into `Record<string,unknown>`
- [ ] `stop_reason`/`usage` normalized to internal `finishReason`/`TokenUsage`
- [ ] System messages placed in the top-level `system` field, not in `messages`
- [ ] 429/overloaded → retryable `ProviderError`; auth error → non-retryable
- [ ] Internal format round-trips (chat→anthropic→internal)

**Tests Required:** `anthropic.test.ts` (inject a fake messages client):
- `it('streams text deltas')`, `it('converts tool role to tool_result')`, `it('accumulates tool_use json')`, `it('normalizes stop reason + usage')`, `it('moves system to top-level system')`, `it('maps overloaded to retryable')`

**Dependencies:** P-132 (stream/error mapping conventions). Core-only.

**Handoff Notes:** Next: P-134 builds the registry + config that selects this provider at runtime. Keep the internal⇄Anthropic converters isolated to this file so future providers reuse `ai/index.ts` types unchanged.

---




### P-134: AI Provider - Provider Registry + Config

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-133

**Context:** The system must pick a provider at runtime from config (env vars + `stitch.toml`), so users can switch OpenRouter↔Anthropic↔Ollama without code changes. This phase implements `ProviderConfig` (zod-validated, P-009/`supportsTools` aware), the `providerRegistry`, and `createProvider(config)` that instantiates the correct provider, validates it against the `ChatProvider` contract, and stashes the choice for the tool loop.

**Files to Create/Modify:**
- `packages/core/src/ai/registry.ts` (fill stub — keep provided `createProvider`/`providerRegistry`)
- `packages/core/src/ai/registry.test.ts` (new)
- `packages/core/src/ai/config.ts` (new — zod `ProviderConfig`)
- `packages/core/src/ai/index.ts` (export registry + config)

**Implementation Steps:**
1. Define zod `ProviderConfig` in `config.ts`:
   ```ts
   export const ProviderConfigSchema = z.object({
     provider: z.enum(['openrouter','openai','anthropic','ollama','mock']),
     model: z.string().min(1),
     apiKey: z.string().min(1).optional(),
     baseUrl: z.string().url().optional(),
     maxTokens: z.number().int().positive().optional(),
     preferStreaming: z.boolean().default(true),
     temperature: z.number().min(0).max(2).optional()
   })
   export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
   ```
   - Resolve `apiKey` from config, falling back to env (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — never stored, only referenced at runtime.
2. Keep `providerRegistry = new Map<string, () => ChatProvider>()`; prepopulate with factory lambdas for `openrouter`/`openai` (→ `OpenAICompatibleProvider`), `anthropic` (→ `AnthropicProvider`), `ollama` (→ `OpenAICompatibleProvider` with ollama base URL), `mock` (→ MockProvider, P-144).
3. Implement `createProvider(config: ProviderConfig): ChatProvider`:
   - If `config.provider === 'ollama'` and apiKey missing, allow empty key (Ollama needs none).
   - Look up factory; call it; then `conformsToChatProvider(instance)` (P-131); throw `INVALID_PROVIDER` if it fails.
   - Attach the resolved `ProviderConfig` for the audit log (P-145) to reference later.
4. Export `createProvider`, `providerRegistry`, `ProviderConfig`/schema from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** No direct connector here. Provider API keys are read from env/config and passed to the concrete providers (P-132/P-133). Never log keys.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `createProvider({provider:'openrouter',model:'...',apiKey:'sk-...'})` returns an `OpenAICompatibleProvider` with OpenRouter base URL
- [ ] `anthropic` returns `AnthropicProvider`; `ollama` returns `OpenAICompatibleProvider` with localhost base URL; `mock` returns mock
- [ ] Missing apiKey for openrouter/anthropic resolves from env or throws `AUTH_REQUIRED` config error
- [ ] Malformed config fails zod validation with a clear error
- [ ] `createProvider` rejects an implementation that fails `conformsToChatProvider`
- [ ] Keys never appear in logger output

**Tests Required:** `registry.test.ts`:
- `it('creates openrouter provider')`, `it('creates anthropic provider')`, `it('creates ollama with no key')`, `it('creates mock provider')`, `it('resolves api key from env')`, `it('fails on invalid config')`, `it('rejects non-conforming provider')`

**Dependencies:** P-133 (Anthropic provider exists). Core-only.

**Handoff Notes:** Next: P-135 model registry + validation. Ensure `providerRegistry` allows late registration (plugins in P-287 AI connector) — factories are lambdas, so third-party providers can `registerProvider` without editing core. Document key env vars in `.env.example` (P-009) and provider guide P-276.

---




### P-135: AI Provider - Model Registry

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-134

**Context:** Different stitching tasks (dependency fix, component generation, gap detection) suit different models; and cost/safety matter (block Gemini-3 tool-calling default, P-143). This phase provides a central `ModelSpec` registry (curated, plus runtime overrides) and helpers `getModel` / `getRecommendedFor` that route each task to the best model, validating model capability (context window, tool support, cost) before a call.

**Files to Create/Modify:**
- `packages/core/src/ai/models.ts` (fill stub — keep `getModel`/`getRecommendedFor`)
- `packages/core/src/ai/models.test.ts` (new)
- `packages/core/src/ai/registry.ts` (wire model validation into `createProvider`)

**Implementation Steps:**
1. Keep the `ModelSpec` shape and populate a curated `MODELS` array (id = `provider/model`):
   ```ts
   export interface ModelSpec { id: string; provider: string; contextWindow: number; supportsTools: boolean; maxOutput: number; /**
cost per 1M input / 1M output tokens in USD */ cost: { input: number; output: number }; recommendedFor: string[] }
   ```
   Include OpenRouter models (e.g. `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, `google/gemini-2.5-pro` flagged `supportsTools:false` for the default tool gate per P-143), plus anthropic-native and ollama local entries.
2. Implement `getModel(id): ModelSpec` — lookup by id; throw `UNKNOWN_MODEL` if absent.
3. Implement `getRecommendedFor(task: AgentTask): ModelSpec` — match `task` against `recommendedFor` tags; fallback to a configurable default; consider `config.ai.preferredModel` override (P-009).
4. Add `assertModelCapable(model, {needsTools:boolean, contextNeeded:number}): void` — throws `MODEL_INCAPABLE` if `supportsTools===false` for a tools task or `contextWindow < contextNeeded`.
5. Wire into `registry.createProvider`: before returning a provider, resolve & validate the model via `getModel`/`assertModelCapable` (unless `config.model` is an unknown plugin-provided id — then skip validation with a warning, to stay extensible).
6. Export `MODELS`, `getModel`, `getRecommendedFor`, `assertModelCapable`, `ModelSpec` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None. Curated model metadata is local; cost fields feed P-137 and P-302 budgets.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `getModel('anthropic/claude-3.5-sonnet')` returns a `ModelSpec` with populated fields
- [ ] `getModel('nope')` throws `UNKNOWN_MODEL`
- [ ] `getRecommendedFor('resolve_deps')` returns a model whose `recommendedFor` includes that task
- [ ] `assertModelCapable(model, {needsTools:true})` throws when `supportsTools===false`
- [ ] Gemini model flagged `supportsTools:false` is rejected for tool tasks by default (P-143 consistency)
- [ ] `createProvider` validates the requested model is capable for its configured task

**Tests Required:** `models.test.ts`:
- `it('resolves known model')`, `it('throws on unknown')`, `it('recommends per task')`, `it('rejects tools-incapable model')`, `it('gemini blocked for tools by default')`

**Dependencies:** P-134 (registry wiring). Core-only.

**Handoff Notes:** Next: P-136 streaming support. Keep `MODELS` exported so CLI/web can render a model picker (P-225 settings). Cost fields must stay accurate for P-302 cost budgets — update via PR when model pricing changes.

---




### P-136: AI Provider - Streaming Support

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-135

**Context:** The web UI needs progressive AI output (P-216 AI thinking stream) rather than waiting for a full response. This phase provides a uniform streaming layer over any `ChatProvider`: `streamChat` returning an `AsyncIterable<ReasoningChunk>`, buffering tool calls across chunks, and emitting `reasoning` events over the WS/SSE channel. It decouples UI streaming from provider-specific stream formats.

**Files to Create/Modify:**
- `packages/core/src/ai/stream.ts` (fill stub — keep `streamChat`)
- `packages/core/src/ai/stream.test.ts` (new)
- `packages/core/src/ai/types.ts` (add `ReasoningChunk`)

**Implementation Steps:**
1. Add to `types.ts`:
   ```ts
   export type ReasoningChunk =
     | { type: 'text'; text: string }
     | { type: 'tool_call'; toolCall: ToolCall }
     | { type: 'done'; finishReason: FinishReason; usage?: TokenUsage }
     | { type: 'error'; error: ProviderError }
   ```
2. Implement `streamChat(provider: ChatProvider, messages: ChatMessage[], tools: ToolSchema[], opts?: { onReasoning?: (r: ReasoningChunk) => void; signal?: AbortSignal }): AsyncIterable<ReasoningChunk>`:
   - Wrap `provider.chat(...)`; for each `ChatResponse` yield `{type:'text'}`/`{type:'tool_call'}` chunks.
   - Maintain an internal `toolAccumulator: Map<id, ToolCall>` — when a provider streams partial tool-call deltas (P-132/P-133 already normalized to complete `ToolCall`s within a single ChatResponse), merge by id.
   - At `finishReason`, yield `{type:'done', finishReason, usage}` then stop.
   - On provider error, yield `{type:'error', error}` once (not each chunk) and stop.
   - Call `opts.onReasoning` for each yielded chunk (side channel for WS push) — surfaces `reasoning` events without the consumer iterating.
   - Respect `opts.signal` (abort) by throwing/cancelling the underlying stream iterable.
3. Expose a convenience `streamChatToString(provider,...): Promise<string>` for CLI TUI fallback (concatenates text chunks).
4. Export `streamChat`, `ReasoningChunk`, `streamChatToString` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — abstracts whatever backend the provider targets (OpenRouter/Anthropic/Ollama). Streaming transport to web is via the CLI server (Elysia) WS/SSE, not MCP.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Yields `text` chunks concatenating to full content; final `done` carries finishReason + usage
- [ ] Partial tool calls from multiple `ChatResponse`s merge into one `ToolCall` by id
- [ ] `onReasoning` invoked for every chunk (including `done`/`error`)
- [ ] Provider error yields exactly one `error` chunk then stops
- [ ] `AbortSignal` cancels the stream without leaving the iterable hanging
- [ ] `streamChatToString` returns concatenated text

**Tests Required:** `stream.test.ts` (with a fake provider emitting text + split tool deltas):
- `it('streams text and done')`, `it('merges split tool calls')`, `it('emits onReasoning per chunk')`, `it('yields single error chunk')`, `it('aborts via signal')`, `it('streamChatToString concatenates')`

**Dependencies:** P-135 (model validation upstream; streaming works for any conforming provider). Core-only.

**Handoff Notes:** Next: P-137 token/cost estimation. `ReasoningChunk.type:'text'` is exactly what web P-216 consumes; keep chunk types frozen. `onReasoning` is the hook the CLI/WS plumbing uses to push live progress (P-193/P-241).

---




### P-137: AI Provider - Token/Cost Estimate

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-136

**Context:** Users need to know (and control) how much each AI-driven stitch will cost before and during execution. This phase computes token counts and dollar estimates from `ModelSpec.cost` (P-135) and measured `TokenUsage`, and aggregates a running cost tracker so the web UI (P-216) and CLI can show live cost and pre-flight approval. It feeds the cost-budget gate in P-302.

**Files to Create/Modify:**
- `packages/core/src/ai/cost.ts` (fill stub for `estimateCost`/`countTokens`)
- `packages/core/src/ai/cost.test.ts` (new)
- `packages/core/src/ai/index.ts` (export cost helpers)

**Implementation Steps:**
1. Implement `countTokens(messages: ChatMessage[]): number` — deterministic heuristic (for non-stream pre-flight): sum of `Math.ceil(content.length/4)` per message (+ small per-message overhead), consistent with provider-local approximations. Provide `countTokensAccurate(messages, provider)` that calls `provider.countTokens` when available.
2. Implement `estimateCost(model: ModelSpec, usage: TokenUsage): { input: number; output: number; total: number }`:
   - `input = usage.input * model.cost.input / 1_000_000`; `output = usage.output * model.cost.output / 1_000_000`; `total = input+output` (USD).
3. Implement `class CostTracker { constructor(model); add(usage): void; get totalTokens(): TokenUsage; get totalCost(): number; get calls(): number }` — thread-safe accumulator for the tool loop (P-140).
4. Implement `estimateCallCost(model, messages, tools?)`: estimate input tokens via `countTokens`, guess output tokens from `model.maxOutput` cap (warning: worst-case), return `{ estimate, worstCase }`.
5. Wire pre-flight: `shouldRequestApproval(estimatedCost, budget)` returns true when `estimatedCost.total > budget.autoApprove <= limit`.
6. Export `countTokens`, `estimateCost`, `CostTracker`, `estimateCallCost`, `shouldRequestApproval` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — pure math over `ModelSpec.cost` + `TokenUsage`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `countTokens` returns a positive deterministic integer for a message list
- [ ] `estimateCost` computes input/output/total from `ModelSpec.cost` (e.g. model cost 3/15 → 1M-in/1M-out, usage 1M/1M → total `$18.00`)
- [ ] `CostTracker.add` accumulates tokens/cost/calls; `get*` reflect the sum
- [ ] `estimateCallCost` caps worst-case at `model.maxOutput`
- [ ] `shouldRequestApproval` respects the auto-approve/limit budget thresholds
- [ ] All results are numbers (no NaN) for valid inputs

**Tests Required:** `cost.test.ts`:
- `it('counts tokens heuristically')`, `it('estimates cost from model spec')`, `it('accumulates in cost tracker')`, `it('caps worst case at maxOutput')`, `it('budget approval gate')`

**Dependencies:** P-136 (stream path provides actual `TokenUsage` for tracking). Core-only.

**Handoff Notes:** Next: P-138 retry/backoff. `CostTracker` instance is created per pipeline job (P-238) and reported in job metrics (P-247) + web cost panel; budget enforcement lands in P-302. Keep model cost fields in-sync with P-135.

---




### P-138: AI Provider - Retry/Backoff

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-137

**Context:** Provider APIs are flaky — rate limits (429), transient 5xx, and timeouts are common, and a robust stitch must retry retryable failures with backoff rather than fail a whole job. This phase implements a generic, configurable retry wrapper around provider calls that honors `ProviderError.retryable` (P-131), applies exponential backoff with jitter, respects max attempts/circuit state, and feeds the audit log (P-145) with each attempt.

**Files to Create/Modify:**
- `packages/core/src/ai/retry.ts` (fill stub — keep `withRetry`/`backoffDelay`)
- `packages/core/src/ai/retry.test.ts` (new)
- `packages/core/src/ai/index.ts` (export retry helpers)

**Implementation Steps:**
1. Keep `backoffDelay(attempt, baseMs, capMs)`:
   ```ts
   export function backoffDelay(attempt: number, baseMs: number = 1000, capMs: number = 30000): number
   ```
   - Pure exponential: `min(capMs, baseMs * 2**attempt)` plus a random jitter in `[0, baseMs*0.25)` to avoid thundering herd. Deterministic when `jitter=0` (for tests).
2. Implement `withRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<Result<T, StitchError>>`:
   ```ts
   export interface RetryOpts { attempts: number; baseMs?: number; capMs?: number; retryable: (e: unknown) => boolean; jitter?: boolean; onAttempt?: (info: RetryInfo) => void; signal?: AbortSignal }
   export interface RetryInfo { attempt: number; error: unknown; delayMs: number }
   ```
   - Loop up to `attempts`: call `fn`; on success return `ok(v)`. On error: if `!retryable(e)` or attempt is last → return `err(e)`. Else compute delay, sleep via `await sleep(delayMs)` (respecting `signal` to abort early), call `onAttempt`, retry.
   - Wrap `sleep` to reject if `signal` aborts → surface `err('ABORTED')`.
3. Add a convenience `retryProviderCall(providerMethod, ...)` that wires `retryable` to `ProviderError.retryable` for the AI path specifically.
4. Export `withRetry`, `backoffDelay`, `retryProviderCall`, `RetryOpts`, `RetryInfo` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local timing/retry logic around whatever provider call is passed in.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `backoffDelay` grows exponentially, caps at `capMs`, and is deterministic with `jitter:false`
- [ ] `withRetry` retries retryable failures up to `attempts` times; returns `ok` on eventual success
- [ ] Non-retryable error returns `err` after the FIRST attempt (no retry)
- [ ] Final failure returns `err` with the last error
- [ ] `onAttempt` records each retry with attempt index + delay
- [ ] `signal` abort during sleep returns `err('ABORTED')` immediately
- [ ] `retryProviderCall` uses `ProviderError.retryable`

**Tests Required:** `retry.test.ts` (fake async fns):
- `it('succeeds after N retries')`, `it('does not retry non-retryable')`, `it('exhausts attempts then errors')`, `it('caps backoff delay')`, `it('honors abort signal')`, `it('reports attempt info')`

**Dependencies:** P-137 (cost pre-flight; retry wraps measured calls). Core-only.

**Handoff Notes:** Next: P-139 Zod+JSON tool adapter. Defaults (`attempts:3`, `baseMs:1000`, `capMs:30000`, `jitter:true`) should be overridable per provider via config (P-134). Keep `retryable` close to `ProviderError` so providers can extend (e.g. mark specific status codes retryable).

---




### P-139: AI Provider - Zod+JSON Tool Adapter

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-138

**Context:** Tool schemas are authored in zod (already a core dep, P-015), but providers need JSON Schema and return tool-call arguments as JSON that must be validated against the zod schema before executing. This phase builds the adapter: zod schema → JSON Schema (via `zod-to-json-schema`, P-039) for the provider, and returned JSON args → validated typed args for the executor, surfacing a structured error if the model produced invalid arguments.

**Files to Create/Modify:**
- `packages/core/src/ai/toolAdapter.ts` (fill stub — keep `zodToJsonSchema`/`parseToolArgs`)
- `packages/core/src/ai/toolAdapter.test.ts` (new)
- `packages/core/src/ai/loop.ts` (import adapter for execution — wired fully in P-140)

**Implementation Steps:**
1. Keep `zodToJsonSchema(schema)` → wraps `zodToJsonSchema(z.object(schema), 'tool')` from `zod-to-json-schema`; map `z.infer` to a JSON Schema object usable by providers.
2. Implement `parseToolArgs<T>(schema: Record<string, z.ZodTypeAny>, raw: unknown): Result<T, StitchError>`:
   - Coerce `raw` (providers may return args as a JSON string or object): `typeof raw === 'string'` → `JSON.parse` (wrap parse error → `err('TOOL_ARGS_INVALID_JSON')`).
   - `z.object(schema).safeParse(parsed)` → on success `ok(data)`; on failure build a readable `err('TOOL_ARGS_VALIDATION')` enumerating `z.issue` paths/messages.
3. Implement `toolSchemaToProvider(schema)` → `ToolSchema` with `{ name, description, parameters: jsonSchema }` for the `ChatProvider` contract (P-131).
4. Add a `strict: boolean` option to `parseToolArgs` — when `strict:true`, `z.StrictObject` drops unknown keys from model output to prevent provider-injected extra args from breaking execution.
5. Export `zodToJsonSchema`, `parseToolArgs`, `toolSchemaToProvider` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — pure schema transformation/validation.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `zodToJsonSchema({foo:z.string()})` yields JSON Schema with `type:'object'`, `required:['foo']`, and correct property
- [ ] `parseToolArgs` accepts an object matching the schema → `ok(typed)`
- [ ] Given a JSON string args → parsed and validated
- [ ] Mismatched args return `err('TOOL_ARGS_VALIDATION')` with issue paths (e.g. `/foo`)
- [ ] Invalid JSON string → `err('TOOL_ARGS_INVALID_JSON')`
- [ ] `strict:true` strips unknown keys without failing
- [ ] `toolSchemaToProvider` produces the `ToolSchema` contract shape

**Tests Required:** `toolAdapter.test.ts`:
- `it('converts zod to json schema')`, `it('parses valid object args')`, `it('parses string args')`, `it('reports validation issues')`, `it('rejects invalid json')`, `it('strips unknown in strict mode')`, `it('produces ToolSchema contract')`

**Dependencies:** P-138 (retry around calls using adapter output). Core-only.

**Handoff Notes:** Next: P-140 tool-loop executor consumes `parseToolArgs`. The strict strip is important for safety (P-155 run_build, P-158 validation). Keep error codes stable (`TOOL_ARGS_INVALID_JSON` / `TOOL_ARGS_VALIDATION`) — web P-218 and CLI surface them.

---




### P-140: AI Provider - Tool-Loop Executor

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-139

**Context:** The agent needs to iterate: call the model, execute any tool calls on the local repo (git/deps/license/agent-tools), feed results back, and continue until the model stops or the loop caps. This phase implements the `ToolLoop` state machine — the execution core that all agent tools (P-148+) plug into — with retry (P-138), cost tracking (P-137), tool-call validation (P-139), and a hard loop cap (task with P-164 later).

**Files to Create/Modify:**
- `packages/core/src/ai/loop.ts` (fill stub — keep `runToolLoop`)
- `packages/core/src/ai/loop.test.ts` (new)
- `packages/core/src/ai/types.ts` (add `LoopConfig`, `LoopResult`)

**Implementation Steps:**
1. Add to `types.ts`:
   ```ts
   export interface ToolDefinition { name: string; description: string; schema: Record<string, z.ZodTypeAny>; execute: (args: any, ctx: ToolContext) => Promise<Result<unknown, StitchError>>; autonomy: 'auto' | 'gated' }
   export interface ToolContext { cwd: string; config: ConfigSchema; logger: Logger; costTracker: CostTracker; git: GitFacade; deps: DepsFacade; license: LicenseFacade }
   export interface LoopConfig { maxIterations: number; cost?: CostTracker; retry?: RetryOpts; signal?: AbortSignal; onReasoning?: (r: ReasoningChunk) => void }
   export interface LoopResult { finishReason: FinishReason; iterations: number; toolCalls: ToolCall[]; messages: ChatMessage[]; finalContent?: string; error?: ProviderError }
   ```
2. Implement `runToolLoop(provider, tools, initialMessages, config): Promise<Result<LoopResult, StitchError>>`:
   - Maintain `messages` (append assistant/tool turns).
   - Loop up to `config.maxIterations`: call `streamChat` (P-136) with `tools` (converted via P-139); buffer text for `finalContent`; collect `tool_call` chunks.
   - If a `done` with `finishReason:'stop'` → return `ok` with result.
   - If `tool_calls`: for each, `parseToolArgs` (P-139); on success call the matching `tool.execute(args, ctx)` inside `withRetry` (P-138); append a `role:'tool'` message with the `Result` (serialize `ok` value / `err` message + code). If an unknown tool name → append a synthetic `err('UNKNOWN_TOOL')` result so the loop can recover rather than crash.
   - Enforce `maxIterations`: when exceeded → return `err('LOOP_LIMIT')` (aligns with P-164 caps).
   - Track `costTracker.add(usage)` per call (P-137).
   - Propagate `config.signal` through `streamChat`.
3. Only `gated` tools (P-157) pause for approval at their execute boundary (surface via `onReasoning({type:'gated'...})` — actual HIL queue in P-160; here just invoke `execute` for non-gated, and for gated route to a provided `approvalGate` callback defaulting to `allow`.
4. Export `runToolLoop`, `ToolDefinition`, `ToolContext`, `LoopConfig`, `LoopResult` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — orchestrates the selected `ChatProvider` (OpenRouter/Anthropic/Ollama) locally.

**Skills to Invoke:** None (execution core; agent tools in P-148 invoke specific skills).

**Acceptance Criteria:**
- [ ] Runs a fake provider: model returns one tool call → executes `tool.execute` with parsed args → feeds result → model returns `stop`; `LoopResult` has `finishReason:'stop'`, `iterations===2`, non-empty `messages`
- [ ] Invalid args from the model → `TOOL_ARGS_VALIDATION` returned to the loop as a `tool` result (loop continues)
- [ ] Unknown tool name → `UNKNOWN_TOOL` result appended, loop continues
- [ ] `maxIterations` exceeded → `err('LOOP_LIMIT')`
- [ ] `costTracker` receives usage per call
- [ ] `gated` tools pass through the `approvalGate` (default allow)
- [ ] `signal` aborts the loop cleanly

**Tests Required:** `loop.test.ts` (fake provider scripted with tool calls then stop):
- `it('executes tool calls and finishes')`, `it('recovers from invalid args')`, `it('recovers from unknown tool')`, `it('caps at max iterations')`, `it('tracks cost')`, `it('routes gated tools')`, `it('aborts on signal')`

**Dependencies:** P-139 (adapter). Core-only.

**Handoff Notes:** Next: P-141 prompt templates. This is THE integration point all agent tools register into; the `ToolDefinition.autonomy` field is what P-157 policy engine reads. Keep `ToolContext` facades (git/deps/license) thin so they can be mocked in tests.

---




### P-141: AI Provider - Prompt Templates

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-140

**Context:** Deterministic, curated prompts are critical for consistent stitching quality and to keep model output within contract. This phase centralizes all system/user prompt templates (system preamble, dependency-fix, component-gen, gap-detection) in one typed module so prompts are inspectable, versioned, and testable — and never f-string'd ad hoc in agent code.

**Files to Create/Modify:**
- `packages/core/src/ai/prompts.ts` (fill stub — keep template map)
- `packages/core/src/ai/prompts.test.ts` (new)
- `packages/core/src/ai/prompts/` directory with `system.md`, `resolve-deps.md`, `generate-component.md`, `detect-gaps.md` (plain-text templates with `{{placeholders}}`)

**Implementation Steps:**
1. Create a `prompts/` directory of plain-text `.md` templates using `{{placeholder}}` tokens:
   - `system.md`: role + hard constraints (only use provided tools, return JSON where asked, never invent file paths, respect autonomy gates).
   - `resolve-deps.md`: instructs model to call `resolve_dependency_closure`/`fix_dependency` and return a structured plan.
   - `generate-component.md`: instructs calling `propose_component` and returning the proposed implementation JSON.
   - `detect-gaps.md`: instructs calling `detect_gaps` and summarizing findings.
2. Implement `render(partialOrName, vars: Record<string,string|number>): string`:
   - Load template by name; replace all `{{key}}` with `vars[key]`; throw `err('PROMPT_MISSING_VAR')` if a referenced `{{key}}` has no value (strict), so missing context is caught at dev-time.
3. Provide typed builders for each use:
   - `systemPrompt(config): string`
   - `resolveDepsPrompt(manifestSummary: string): {system, user}`
   - `generateComponentPrompt(spec): {system, user}`
   - `detectGapsPrompt(treeSummary): {system, user}`
4. Export `render`, `systemPrompt`, `resolveDepsPrompt`, `generateComponentPrompt`, `detectGapsPrompt` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — offline template rendering.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `render('system', {})` returns the full system template text
- [ ] Missing placeholder in strict mode throws `err('PROMPT_MISSING_VAR')`
- [ ] Typed builders return `{system, user}` message pairs ready for the loop
- [ ] Templates mention only real tool names (cross-check with tool registry docs)
- [ ] No hardcoded secrets/keys in templates
- [ ] Templates are plain markdown files (editable without code), loaded via `import`/`fs`

**Tests Required:** `prompts.test.ts`:
- `it('renders template with vars')`, `it('throws on missing var')`, `it('builds resolve-deps prompt')`, `it('builds generate-component prompt')`, `it('builds detect-gaps prompt')`

**Dependencies:** P-140 (loop consumes prompts). Core-only.

**Handoff Notes:** Next: P-142 context window management. Keep templates versioned (a `promptVersion` field on builders) so the audit log (P-145) can record which prompt set produced an output — critical for reproducibility. Add new task templates as agent tools grow (P-148+).

---




### P-142: AI Provider - Context Window Management

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-141

**Context:** Models have finite context windows (P-135 `contextWindow`); long stitching sessions can overflow, causing truncation or errors. This phase manages context: estimating current token usage (P-137), trimming/summarizing history when near the limit, and including only relevant repo context (diff/paths) to stay under `contextWindow * safetyFactor`.

**Files to Create/Modify:**
- `packages/core/src/ai/context.ts` (fill stub — keep `manageContext`/`trimMessages`)
- `packages/core/src/ai/context.test.ts` (new)
- `packages/core/src/ai/loop.ts` (invoke `manageContext` before each model call)

**Implementation Steps:**
1. Implement `estimateWindowUsage(messages, model): number` — sum `countTokens` (P-137) over messages + static tool-schema overhead (estimate per tool).
2. Implement `trimMessages(messages, model, opts): { messages: ChatMessage[]; dropped: number }` strategy (keep system + latest, drop oldest middle turns):
   - Protect the first `system` message (never drop).
   - While `estimateWindowUsage > contextWindow * safetyFactor` (default 0.8), remove the oldest non-system message, counting `dropped`.
   - If a single oversized message remains, truncate its `content` to ~`maxOutput` chars with an `[truncated]` marker.
3. Implement `manageContext(provider, messages, ctx): Promise<ChatMessage[]>` — returns the trimmed/reordered array; surface a `onContextTrim` callback (for logging how much was dropped).
4. Author a `addRepoContext(messages, contextBlocks, model)` that stuffs only the highest-value context (dependency diff, affected file list, current config) up to a priority cap, dropping low-value blocks when over budget.
5. Wire into `loop.ts` just before each `streamChat` call; record `dropped`/trim in the audit log (P-145).
6. Export `estimateWindowUsage`, `trimMessages`, `manageContext`, `addRepoContext` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local token budget math.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `trimMessages` keeps the system message and drops oldest non-system first until under budget
- [ ] Over-long single message is truncated with a marker
- [ ] `manageContext` returns a message array that is under the model budget (per estimate)
- [ ] `onContextTrim` reports the number dropped
- [ ] `addRepoContext` keeps high-priority blocks and drops low-value ones over budget
- [ ] Result re-estimates under `contextWindow * safetyFactor`

**Tests Required:** `context.test.ts`:
- `it('drops oldest non-system first')`, `it('truncates oversized message')`, `it('fits under budget')`, `it('reports dropped count')`, `it('prioritizes repo context blocks')`

**Dependencies:** P-141 (prompts feed messages). Core-only.

**Handoff Notes:** Next: P-143 blocks Gemini-3 tool-calling by default. The `safetyFactor` and per-tool overhead are configurable; keep defaults conservative for cost+correctness (P-137). This logic is what prevents flaky long jobs (ties into P-176 flaky detection and P-248 tracing).

---




### P-143: AI Provider - Block Gemini-3 Tool-Calling Default

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-142

**Context:** Some models (notably certain Gemini-3 variants) had unreliable tool-calling behavior that produced malformed or unsafe tool-call arguments. Per the AI autonomy decision, tool-calling is blocked-by-default on those models unless explicitly enabled in config. This phase enforces that default at the model-registry + registry level, so tasks requiring tools refuse to run on a blocked model unless the user opts in.

**Files to Create/Modify:**
- `packages/core/src/ai/models.ts` (add `toolCallingBlocked` / `blockToolCallingFor` logic)
- `packages/core/src/ai/block.ts` (new — policy + helper)
- `packages/core/src/ai/block.test.ts` (new)
- `packages/core/src/ai/registry.ts` (wire block check into `createProvider`)

**Implementation Steps:**
1. Add to `ModelSpec`: `toolCalling: 'allowed' | 'blocked-by-default' | 'unknown'` (default `'allowed'`; set `'blocked-by-default'` for the affected Gemini-3 ids).
2. Implement `isToolCallingBlocked(model: ModelSpec, config: { overrideToolModels?: string[] }): boolean`:
   - `true` iff `model.toolCalling === 'blocked-by-default'` AND the model id is NOT in `config.overrideToolModels`.
   - Explicit opt-in via `overrideToolModels` (in `stitch.toml` `[ai]` section, P-009) lifts the block.
3. Implement `enforceToolCallPolicy(model, config): Result<void, StitchError>`:
   - If a tools task resolves to a blocked model without override → `err('TOOL_CALLING_BLOCKED', { model: model.id, remedy: 'add to [ai].overrideToolModels to opt in' })`.
4. Wire into `registry.createProvider`: when the requested task needs tools and `assertModelCapable` passes, additionally call `enforceToolCallPolicy`; gate tool-enabled tasks (via `LoopConfig.allowTools` default reflecting this policy).
5. Export from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — policy/config logic.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] A `blocked-by-default` model id returns `isToolCallingBlocked === true` without override
- [ ] Same model with id in `overrideToolModels` returns `false`
- [ ] `enforceToolCallPolicy` on blocked model returns `err('TOOL_CALLING_BLOCKED')` with remedy
- [ ] `createProvider` refuses a tools task on the blocked Gemini-3 model unless overridden
- [ ] Non-affected models unaffected (`toolCalling:'allowed'`)
- [ ] No crash for unknown/future models (`toolCalling:'unknown'` → conservative `blocked` warning, no hard block)

**Tests Required:** `block.test.ts`:
- `it('blocks gemini-3 by default')`, `it('allows when overridden')`, `it('enforce returns typed error')`, `it('registry rejects tools on blocked model')`, `it('unknown models warn not block')`

**Dependencies:** P-142 (context budget; policy integrated with registry). Core-only.

**Handoff Notes:** Next: P-144 mock provider. Keep the block configurable in `stitch.toml` `[ai]`; document prominently in provider setup guide (P-276). This is a safety default — do not silently relax it.

---




### P-144: AI Provider - Mock Provider

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-143

**Context:** All AI tests must run offline deterministically, and the dev TUI/web need a provider that never hits the network. This phase implements `MockProvider` implementing `ChatProvider` (P-131) with scriptable behavior: it can play back a scripted sequence of text + tool calls (for loop tests P-147), echo a canned reply, or fail in a controllable way — with zero network.

**Files to Create/Modify:**
- `packages/core/src/ai/mock.ts` (fill stub — keep `MockProvider`)
- `packages/core/src/ai/mock.test.ts` (new)
- `packages/core/src/ai/index.ts` (export `MockProvider`, `registerProvider('mock')`)

**Implementation Steps:**
1. Implement `class MockProvider implements ChatProvider`:
   - Constructor `(config: { script?: MockStep[]; failWith?: ProviderError; echoContent?: string; name?: string; model?: string })`.
   - Define `MockStep = { kind: 'text'; text: string } | { kind: 'tool_call'; toolCall: ToolCall } | { kind: 'finish'; finishReason: FinishReason; usage?: TokenUsage }`.
   - `chat(messages, tools)` returns an `AsyncIterable<ChatResponse>` that:
     - If `failWith` set → throw `failWith` on first iteration (tests P-138 retry).
     - Else yield each `script` step in order (text → `content`; tool_call → `toolCalls`), then a `done` with `finishReason`.
     - If no script → yield a single `done` with `finishReason:'stop'` and empty content.
   - `countTokens(messages)` returns `messages.reduce((n,m)=>n+Math.ceil(m.content.length/4),0)`.
2. Provide `mockProvider.calls` counter + `lastMessages` accessor (tests assert what was sent).
3. Register `mock` in the registry (P-134) so `createProvider({provider:'mock',...})` works, and ensure `assertModelCapable`/`enforceToolCallPolicy` treat mock as always-allowed (skip tool block for mock).
4. Export `MockProvider`, `MockStep`, and the factory from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — fully offline.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Plays back scripted text + tool_call + finish in order
- [ ] `failWith` throws the given `ProviderError` (retry tests can consume it)
- [ ] No script → yields `done`/`stop`
- [ ] `calls` increments per `chat` invocation; `lastMessages` returns what was sent
- [ ] `countTokens` returns positive count
- [ ] Registry resolves `mock` with no key and no model-eligibility gate
- [ ] Never performs network I/O

**Tests Required:** `mock.test.ts`:
- `it('plays back script')`, `it('throws configured error')`, `it('defaults to stop')`, `it('counts calls and records messages')`, `it('registerable via createProvider')`

**Dependencies:** P-143 (mock bypasses tool-calling block for tests). Core-only.

**Handoff Notes:** Next: P-145 audit log. Tests across all AI modules use `MockProvider` — keep its `MockStep` shape stable since block/module tests depend on it. Add convenience `mockScriptFromText(text)` for one-shot echo in dev flows.

---




### P-145: AI Provider - AI Call Audit Log

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-144

**Context:** Every AI call should be auditable: which provider/model, prompt version, context size, tokens, cost, latency, and outcome — for cost accounting (P-137/P-302), debugging (P-248 tracing), and compliance (P-307). This phase implements a structured audit log backed by `bun:sqlite` (P-030), written asynchronously so it never blocks the hot loop.

**Files to Create/Modify:**
- `packages/core/src/ai/audit.ts` (fill stub — keep `AiAuditLog`)
- `packages/core/src/ai/audit.test.ts` (new)
- `packages/core/src/ai/loop.ts` (record each call in the log)
- `packages/core/src/db/sqlite.ts` (reuse the P-230 SQLite helper, or a minimal local one)

**Implementation Steps:**
1. Define the audit record:
   ```ts
   export interface AiCallAudit { id: string; ts: string; provider: string; model: string; promptVersion: string; task: string; inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number; finishReason: FinishReason; error?: ProviderError; toolNames: string[] }
   ```
2. Implement `class AiAuditLog`:
   - Open/create `stitch.db` `ai_calls` table (id TEXT PK, ts, provider, model, prompt_version, task, input_tokens, output_tokens, cost_usd, latency_ms, finish_reason, error TEXT, tool_names TEXT).
   - `record(call: AiCallAudit): void` — insert row; run inside a transaction batched every N calls (`flushEvery=10`) or on process signal, to avoid slowing the loop; errors here are non-fatal (log-and-continue).
   - `query({ task?, model?, since?, limit? }): Promise<AiCallAudit[]>` — for cost dashboard (P-247) and UI (P-225).
   - `costTotal(since?): Promise<number>` — SUM(cost_usd).
3. Wire into `loop.ts`: wrap each provider call — measure `latencyMs`, read `usage`/`cost`, attach `promptVersion` from P-141 builders, and `audit.record(...)` in a `finally` so failures are also logged (with `error`).
4. Use the logger's redaction so `error.message` may not leak keys (logger.redact applied at render).
5. Export `AiAuditLog`, `AiCallAudit` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local `bun:sqlite` (P-030 dep).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `record` inserts a row (with redacted-safe fields) into `ai_calls`
- [ ] Batched `flushEvery` writes rows without blocking the loop path
- [ ] `query` filters by task/model/since and returns rows
- [ ] `costTotal` sums `cost_usd` correctly
- [ ] Failures are logged with `error` populated (never crashes the loop)
- [ ] `promptVersion` and `toolNames` recorded on success
- [ ] No keys/secrets appear in stored `error`/logs

**Tests Required:** `audit.test.ts` (temp `:memory:` or tmp dir db):
- `it('records a call')`, `it('batches writes')`, `it('queries rows')`, `it('sums cost')`, `it('records failures')`, `it('stores prompt version and tools')`

**Dependencies:** P-144 (loop emits real calls to log). Core-only; depends on `bun:sqlite` P-030/P-230 helper.

**Handoff Notes:** Next: P-146 runtime provider switch. The audit log is the source for web cost panel (P-225) and compliance export (P-307) — keep the schema append-only (add columns, don't rename). `flushEvery` tuned to balance durability vs latency.

---




### P-146: AI Provider - Runtime Provider Switch

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-145

**Context:** A single provider (OpenRouter) can go down or rate-limit mid-job. To keep stitches resilient, the system must be able to switch providers at runtime without restarting — failing over to Anthropic or a local Ollama model (P-301) when the primary errors. This phase implements the switch: provider failover ordering, live swap of the active provider, and surfacing the current provider to UI/CLI.

**Files to Create/Modify:**
- `packages/core/src/ai/switch.ts` (fill stub — keep `ProviderManager`/`switchProvider`)
- `packages/core/src/ai/switch.test.ts` (new)
- `packages/core/src/ai/registry.ts` (expose active provider state)
- `packages/core/src/ai/loop.ts` (consume active provider; support mid-loop failover)

**Implementation Steps:**
1. Implement a `ProviderManager`:
   ```ts
   export class ProviderManager {
     constructor(primary: ChatProvider, failoverOrder: ChatProvider[])
     get active(): ChatProvider
     setActive(p: ChatProvider): void
     switchToNext(reason: string): ChatProvider | null  // null if no failover left
   }
   ```
   - `failoverOrder` built from config `[ai].failover` (e.g. `['openrouter','anthropic','ollama']`, dropping any without a key).
2. Implement `switchProvider(manager, reason): Result<ChatProvider, StitchError>`:
   - Move to next provider in `failoverOrder` that passes `conformsToChatProvider` + model policy (P-135/P-143); set active; record the switch (reason, from→to, ts) in the audit log (P-145).
   - If none left → `err('NO_FAILOVER')`.
3. Wire into `loop.ts`: wrap the per-iteration `streamChat` in a failover guard — on retryable `ProviderError` after `withRetry` (P-138) exhausts, try `switchToNext(reason)` and continue the loop on the new provider (restart current turn with same messages). Cap overall failover switches per job to FAIlover retry budget.
4. Add an `onProviderSwitch` callback so CLI/web can show "switched to anthropic" (P-216/P-218).
5. Export `ProviderManager`, `switchProvider` from `ai/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** OpenRouter / Anthropic / Ollama as configured — switch happens locally between connector-backed providers.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `ProviderManager.active` is the primary initially; `switchToNext` returns the failover provider
- [ ] `switchProvider` records reason/from/to via audit log and returns the new provider
- [ ] Exhausting failover list returns `err('NO_FAILOVER')`
- [ ] Loop retries a failed turn on the next provider and completes (fake failing primary + working failover)
- [ ] `onProviderSwitch` fires with reason
- [ ] Failover respects model policy (won't switch to a tools-blocked model for a tool task)

**Tests Required:** `switch.test.ts`:
- `it('starts on primary and switches')`, `it('records audit on switch')`, `it('returns NO_FAILOVER when empty')`, `it('recovers turn on failover')`, `it('fires onProviderSwitch')`

**Dependencies:** P-145 (audit of switches). Core-only.

**Handoff Notes:** Next: P-147 loop tests. Keep failover budget per job (e.g. max 2 switches) to avoid infinite bouncing; surface active provider in job status (P-247) and web header.

---




### P-147: AI Provider - Loop Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-146

**Context:** The tool loop (P-140) is the heart of autonomy — a regression there corrupts behavior everywhere. This phase glues every AI module into deterministic integration tests over the full loop (prompts → context → model → tool adapter → retry → cost → audit → switch) using `MockProvider`, plus a coverage gate, so the whole AI stack is verified together without network.

**Files to Create/Modify:**
- `packages/core/src/ai/__tests__/ai.suite.ts` (new — full integration)
- `packages/core/src/ai/__tests__/fixtures/tool-defs.ts` (shared fake tools)
- `packages/core/package.json` (add `"test:ai"` script with coverage)

**Implementation Steps:**
1. Create `__tests__/fixtures/tool-defs.ts` exporting two fake tools (`read_file`, `apply_patch`) implementing `ToolDefinition` and touching only in-memory state (no filesystem), used across tests.
2. Write `ai.suite.ts` with scenario tests driven by `MockProvider` scripts:
   - **Happy tool loop:** script: `tool_call(read_file)` → `finish(stop)`; assert `read_file` executed with parsed args, loop `finishReason:'stop'`, `messages` contains the `tool` reply.
   - **Multi-tool + retry:** first provider call fails with a `ProviderError{retryable:true}`; `withRetry` then `MockProvider` succeeds; assert retries recorded.
   - **Failover:** primary fails retryable, `ProviderManager.switchToNext` moves to mock #2 which completes; assert switch + audit recorded.
   - **Context trim:** feed `N` large messages over budget; assert `trimMessages` dropped oldest non-system and loop still ran under budget.
   - **Tool block (P-143):** attempt a tools task on the blocked Gemini-3 mock; assert `enforceToolCallPolicy` → `TOOL_CALLING_BLOCKED`.
   - **Loop limit:** script that never stops → assert `LOOP_LIMIT`.
   - **Cost/audit:** after any run, assert `CostTracker` sums and `AiAuditLog` rows exist with cost/latency.
3. Add `test:ai` script: `bun test src/ai --coverage` with ≥80% line / 70% branch gate via the shared coverage config.
4. Ensure all tests run with `MockProvider` (zero network); any test needing a real provider is skipped unless env `STITCH_AI_LIVE=1`.
5. Run `bun test src/ai --coverage`; fix integration issues surfaced by the suite.

**Required MCPs/Connectors:** None — all mocked/offline. Optional live run behind `STITCH_AI_LIVE=1`.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Full-suite scenarios execute against `MockProvider` with zero network
- [ ] Happy path, retry, failover, context-trim, tool-block, loop-limit, cost/audit all asserted
- [ ] `test:ai` runs `--coverage` with ≥80%/70% gate and passes
- [ ] Any provider-switch mid-loop is recorded (manager + audit)
- [ ] Prompt version propagated to audit in every scenario
- [ ] Live-provider tests skipped unless `STITCH_AI_LIVE=1`

**Tests Required:** `__tests__/ai.suite.ts`:
- `it('happy loop executes tool')`, `it('retries on retryable error')`, `it('fails over to next provider')`, `it('trims context under budget')`, `it('enforces gemini tool block')`, `it('caps loop iterations')`, `it('tracks cost and audits calls')`

**Dependencies:** P-146 (failover in loop). Core-only.

**Handoff Notes:** Next: P-148 begins Agent Tools (select_files is the first). This suite is the regression net for the whole AI stack — run it after any change in `core/src/ai/*`. The mock tool fixtures here mirror the real tool contracts P-148+ will implement.

---




### P-148: Agent Tools - select_files

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-147

**Context:** The agent must decide which files from source repos A and B to bring into child repo C. `select_files` lets the model propose a concrete file selection (by path, grouped per original repo and with an optional glob/project filter), and returns a structured plan the merge pipeline (P-072/P-076) can execute. It is the first Agent Tool and establishes the `ToolDefinition` pattern (name/schema/execute/autonomy) the rest of the epic follows.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/select_files.ts` (new)
- `packages/core/src/agent/tools/select_files.test.ts` (new)
- `packages/core/src/agent/tools/index.ts` (new — tool registry barrel)
- `packages/core/src/agent/types.ts` (add `FileSelection`, `SelectedFile`)

**Implementation Steps:**
1. Define shapes in `types.ts`:
   ```ts
   export interface SelectedFile { repo: 'A' | 'B'; path: string; reason?: string }
   export interface FileSelection { files: SelectedFile[]; filter?: { glob?: string; excludeDirs?: string[] }; notes?: string }
   ```
2. Define the tool in `select_files.ts`:
   ```ts
   export const selectFilesTool: ToolDefinition = {
     name: 'select_files',
     description: 'Propose which files from source repos A and B to include in child repo C.',
     schema: {
       repo: z.enum(['A','B']),
       paths: z.array(z.string()).min(1).max(2000),
       filter: z.object({ glob: z.string().optional(), excludeDirs: z.array(z.string()).optional() }).optional(),
       reason: z.string().optional()
     },
     autonomy: 'auto',
     execute: async (args, ctx) => {
       // validate paths exist in the respective repo's scanned file list
       const listing = ctx.git.listFiles(ctx.cwd, args.repo)
       const missing = args.paths.filter(p => !listing.includes(p))
       if (missing.length) return err('SELECT_PATH_NOT_FOUND', { missing })
       return ok({ files: args.paths.map(p => ({ repo: args.repo, path: p, reason: args.reason })), filter: args.filter })
     }
   }
   ```
   - Validate each `path` exists against the repo A/B file listing (from the P-090/P-103 scan) before returning `ok`.
3. Apply `filter.glob` (picomatch, P-036) to expand/validate a selection when a glob is provided instead of explicit paths.
4. Return `err('SELECT_PATH_NOT_FOUND')` with the missing paths indicate; never return `ok` for nonexistent files.
5. Register in `tools/index.ts` via a `registerAgentTool` map consumed by the loop (P-140).
6. Export `selectFilesTool`, `FileSelection`, `SelectedFile` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — operates on local repo file listings (from P-103 scan / P-090 tree).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Tool zod schema validates `repo` ∈ {A,B}, non-empty `paths`, optional `filter`/`reason`
- [ ] Existing paths resolve to `ok` with `SelectedFile[]` carrying `repo`+`path`
- [ ] Nonexistent path returns `err('SELECT_PATH_NOT_FOUND')` with the missing list
- [ ] Glob filter expands to matching files via picomatch
- [ ] Registerable and executable through the P-140 loop with `autonomy:'auto'`
- [ ] Max 2000 paths enforced (schema) to bound memory/UI

**Tests Required:** `select_files.test.ts` (fixture repo A/B listings):
- `it('selects existing files')`, `it('rejects missing path')`, `it('expands glob filter')`, `it('validates schema')`, `it('runs through loop registry')`

**Dependencies:** P-147 (loop + ToolDefinition established). Core-only.

**Handoff Notes:** Next: P-149 resolve_dependency_closure. The returned `SelectedFile[]` is exactly what the merge writer (P-076) and provenance mapper (P-181) consume — keep `path` relative and `repo` explicit. Large real repos may exceed 2000 files; loop in batches from the UI.

---




### P-149: Agent Tools - resolve_dependency_closure

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-148

**Context:** Adding a subset of files from A/B to C requires that every dependency those files reference is also present, or the result won't build. `resolve_dependency_closure` computes the transitive closure of imports across the selected files using the deps parsers (P-104–P-107) and identifies missing packages/files so the agent can pull them in. This prevents broken stitches at build time.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/resolve_deps.ts` (new)
- `packages/core/src/agent/tools/resolve_deps.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `DepClosure`)

**Implementation Steps:**
1. Add `DepClosure`:
   ```ts
   export interface DepClosure { required: string[]; missing: string[]; satisfied: string[]; byFile: Record<string, string[]> }
   ```
2. Implement `resolveDependenciesForFiles(selection: SelectedFile[], ctx): Promise<Result<DepClosure, StitchError>>`:
   - For each selected file, parse imports via the ecosystem parser (npm → `package.json` deps; python/cargo/go by their manifest + import statements via madge/dependency-cruiser P-021/P-022 when JS).
   - Build a set of `required` packages; `satisfied` = already in C's merged manifest (P-108); `missing` = required but absent.
   - `byFile` maps each file to its required packages.
3. Define the tool `resolve_dependency_closure`:
   ```ts
   const resolveDepsTool: ToolDefinition = { name:'resolve_dependency_closure', description:'Compute transitive dependency closure for selected files and report missing packages.', schema:{ files: z.array(z.object({repo:z.enum(['A','B']), path:z.string()})) }, autonomy:'auto', execute: async (args,ctx) => ok(await resolveDependenciesForFiles(args.files, ctx)) }
   ```
4. Keep it read-only (no mutation): reports `missing` so the model then calls `add_dependency`/`fix_dependency` (P-151) to satisfy them.
5. Hand `missing` lists with severity hints (transitive-only vs direct) for the fixer.
6. Export `resolveDependenciesForFiles`, `resolveDepsTool`, `DepClosure` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — uses local madge/dependency-cruiser and deps parsers.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Returns `satisfied` for packages present in merged manifest, `missing` otherwise
- [ ] `byFile` maps each file to its package requirements
- [ ] Import resolution works for JS (madge), npm (package.json), and reports findings for python/cargo/go manifest deps
- [ ] Tool is read-only (no file writes)
- [ ] Missing transitive-only deps flagged distinctly from direct deps
- [ ] Empty selection returns empty closure (not an error)

**Tests Required:** `resolve_deps.test.ts` (fixtures with a file importing a dep C doesn't have):
- `it('reports satisfied vs missing')`, `it('maps byFile closures')`, `it('flags transitive vs direct')`, `it('is read-only')`, `it('handles empty selection')`

**Dependencies:** P-148 (selection shape). Core-only.

**Handoff Notes:** Next: P-150 detect_gaps. The `missing` set feeds both `fix_dependency` (P-151) and the gap detector; keep it deterministic and pure so manifests can be compared across runs.

---




### P-150: Agent Tools - detect_gaps

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-149

**Context:** Beyond missing deps, a composed repo can have other breakages: missing config files, missing env vars a module reads, missing test scaffolding, or a config that doesn't match the merged values (P-113). `detect_gaps` runs a battery of read-only checks over the current child-repo staging state and returns a structured list of gaps with severity, so the agent (or user) can decide what to fix.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/detect_gaps.ts` (new)
- `packages/core/src/agent/tools/detect_gaps.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `Gap`, `GapKind`)

**Implementation Steps:**
1. Add types:
   ```ts
   export type GapKind = 'missing_dep' | 'missing_file' | 'missing_env' | 'config_mismatch' | 'missing_test' | 'broken_import'
   export interface Gap { kind: GapKind; file?: string; package?: string; detail: string; severity: 'error' | 'warning' }
   ```
2. Implement `detectGaps(ctx, opts: { focus?: GapKind[] }): Promise<Result<Gap[], StitchError>>` running read-only checks:
   - **missing_dep** — reuse P-149 `resolveDependenciesForFiles` over the selected set; high severity.
   - **missing_file** — scan stage for `README.md`, `tsconfig.json`, `.env.example`, `<eco>_config` referenced by imports (picomatch against staged listing).
   - **missing_env** — find `process.env.X` / `import.meta.env.X` usages vs declared vars in `.env.example` (P-009) — warning.
   - **config_mismatch** — compare merged config (P-113) values to any per-file config; warning.
   - **missing_test** — for each new module, check a sibling `*.test.ts` exists; warning.
   - **broken_import** — for each selected file, verify every relative import resolves to an existing staged file; error.
3. Order output by severity (errors first), dedupe identical gaps.
4. Define the tool `detect_gaps` (read-only, `autonomy:'auto'`).
5. Export `detectGaps`, `detectGapsTool`, `Gap`, `GapKind` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local fs + deps manifests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Returns errors for broken imports and missing deps first, warnings after
- [ ] `missing_env` flags `process.env.X` not in `.env.example`
- [ ] `missing_test` flags modules without a sibling test
- [ ] `config_mismatch` flags merged-vs-file config drift
- [ ] Duplicate gaps deduped; result sorted by severity
- [ ] Read-only (no writes)

**Tests Required:** `detect_gaps.test.ts` (staged fixture missing a dep/env/test):
- `it('detects missing dep')`, `it('detects missing env')`, `it('detects missing test')`, `it('flags broken import')`, `it('sorts error first and dedupes')`

**Dependencies:** P-149 (closure feeds missing_dep check). Core-only.

**Handoff Notes:** Next: P-151 fix_dependency (auto). Gaps from this phase are the workload the auto-fix tools (P-151–P-153) consume; keep `GapKind` immutable to avoid breaking downstream matchers.

---




### P-151: Agent Tools - fix_dependency (auto)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-150

**Context:** When `detect_gaps`/`resolve_dependency_closure` report a missing dependency, the agent should often be able to fix it automatically (add the package to C's merged manifest at a compatible version). This phase implements `fix_dependency` — an `autonomy:'auto'` tool that, given a package + desired range (or "latest compatible"), updates the merged manifest (P-108/P-113) through the ecosystem serializer (P-115) and validates the new range resolves (P-109).

**Files to Create/Modify:**
- `packages/core/src/agent/tools/fix_dependency.ts` (new)
- `packages/core/src/agent/tools/fix_dependency.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `FixResult`)

**Implementation Steps:**
1. Add `FixResult`:
   ```ts
   export interface FixResult { action: 'added' | 'updated' | 'unchanged'; package: string; version: string; section: 'dependencies' | 'devDependencies' | 'peerDependencies'; }
   ```
2. Implement `applyDependencyFix(manifest, pkg, range, section, resolver): Result<FixResult, StitchError>`:
   - Normalize `range` (`'latest'` → resolve `latest` via P-019 semver / registry; `'auto'` → pick the version already pinning the dep in A or B, else `'^'+latest`).
   - Update the target section in the merged `UnifiedManifest`; set `action:'added'` (new) or `'updated'` (changed version) or `'unchanged'` (already satisfied).
   - Return the change (the writer applies it to disk).
3. Define the tool `fix_dependency`:
   ```ts
   const fixDependencyTool: ToolDefinition = { name:'fix_dependency', description:'Add or update a dependency in child repo C manifest at a compatible version.', schema:{ package: z.string().min(1), range: z.string().optional(), section: z.enum(['dependencies','devDependencies','peerDependencies']).default('dependencies') }, autonomy:'auto', execute: async (args,ctx) => { validate against resolver; return applyDependencyFix(...) } }
   ```
   - `execute` must NOT require human approval (auto) but MUST roll back cleanly on failure (no partial manifest corruption — serialize only on success).
4. After fix, re-run a quick `resolve_dependency_closure` (P-149) to confirm the dep moves from `missing`→`satisfied`.
5. Export `applyDependencyFix`, `fixDependencyTool`, `FixResult` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — registry resolution best-effort offline (semver range; no network in tests). If a live registry hit is needed, it runs in sandbox (P-170), not here.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Adding a new package sets `action:'added'` and the correct version/range
- [ ] Updating an existing package sets `'updated'` and bumps the range; satisfied → `'unchanged'`
- [ ] `'latest'`/`'auto'` range resolved deterministically
- [ ] Serialization only on success (no partial/corrupt manifest)
- [ ] Post-fix closure confirms moved to `satisfied`
- [ ] Auto autonomy — no approval gate

**Tests Required:** `fix_dependency.test.ts`:
- `it('adds new dependency')`, `it('updates existing')`, `it('unchanged when satisfied')`, `it('resolves auto range')`, `it('validates with resolver')`, `it('confirms via closure')`

**Dependencies:** P-150 (gaps to fix). Core-only.

**Handoff Notes:** Next: P-152 edit_config (auto). `fix_dependency` must prefer preserving A/B's original range choice (per resolve) to honor "as-authored" provenance; document chosen range in the audit trail (P-181).

---




### P-152: Agent Tools - edit_config (auto)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-151

**Context:** Composing repos often requires editing config files (tsconfig paths, aliases, `.env.example`, global config) so the merged code resolves. `edit_config` lets the agent apply a targeted, validated change to a config file under C automatically — with a before/after diff, an optional validation hook, and clean rollback on failure, so changes are reversible.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/edit_config.ts` (new)
- `packages/core/src/agent/tools/edit_config.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `ConfigEdit`)

**Implementation Steps:**
1. Add types:
   ```ts
   export interface ConfigEdit { path: string; op: 'set' | 'append' | 'merge' | 'remove'; key: string; value?: unknown; }
   ```
   - `key` is a dot-path (e.g. `compilerOptions.paths["@x/*"]`).
2. Implement `applyConfigEdit(path, edit, ctx): Promise<Result<ConfigEditResult, StitchError>>`:
   - Parse the file by extension: `.json`/`.jsonc` → JSON5-ish parse (strip comments); `.toml` → `@iarna/toml`; `.yaml/.yml` → yaml (P-032); `.env*` → simple key=value lines.
   - Resolve `key` via a safe getter/setter over the parsed object (no `__proto__`/prototype pollution — reject dangerous keys).
   - Apply `op`; serialize back preserving formatting where possible; write via `ctx.git.writeFile` (P-076) producing a staged change.
   - Run an optional `validate?: (parsed) => Result<void,string>` hook; on failure roll back to the prior content and return `err`.
   - Return `{ path, before, after, diff }` where `diff` is a unified diff string (for P-217 display).
3. Define the tool `edit_config` (`autonomy:'auto'`). Path must be within C stage root (reject path traversal).
4. Keep a short undo stack (last edit per path) supporting `revert` (wired fully in P-161).
5. Export `applyConfigEdit`, `editConfigTool`, `ConfigEdit` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local config parsing/serialization.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `set` on a jsonc config writes the value and returns a diff
- [ ] `merge` merges nested objects without clobbering siblings
- [ ] `remove` deletes a key
- [ ] Dangerous keys (`__proto__`, `prototype`) rejected
- [ ] Path traversal outside the stage root rejected
- [ ] Failed validation rolls back content and returns `err`
- [ ] Undo stack records the change for revert

**Tests Required:** `edit_config.test.ts`:
- `it('sets a key')`, `it('merges nested')`, `it('removes a key')`, `it('rejects dangerous key')`, `it('rejects traversal')`, `it('rolls back on failed validation')`, `it('records undo')`

**Dependencies:** P-151 (fix tool established auto pattern). Core-only.

**Handoff Notes:** Next: P-153 move_file (auto). The diff string returned here is reused by the web Diff Viewer (P-217); keep `.jsonc` comment stripping stable to avoid corrupting user files.

---




### P-153: Agent Tools - move_file (auto)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-152

**Context:** Merged files may need to be relocated (e.g. to avoid path collisions or to match a new directory layout in C). `move_file` auto-moves a staged file from A/B into its final C location, updating any relative import references in the same commit so the move doesn't break imports. It is a safe, bounded refactor with a dry-run mode.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/move_file.ts` (new)
- `packages/core/src/agent/tools/move_file.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `MovePlan`)

**Implementation Steps:**
1. Add `MovePlan`:
   ```ts
   export interface MovePlan { from: string; to: string; dryRun?: boolean; importRewrites: { file: string; oldRef: string; newRef: string }[] }
   ```
2. Implement `planMove(from, to, stagedFiles, ctx): Result<MovePlan, StitchError>`:
   - Ensure `from` exists in stage and `to` not colliding (unless `--overwrite`).
   - Compute which staged files import `from` (via madge/dependency-cruiser for JS, or textual relative-path scan) to produce `importRewrites`.
   - If `dryRun` → return the plan unchanged (no writes).
3. Implement `executeMove(plan, ctx): Promise<Result<void, StitchError>>`:
   - `ctx.git.move(from, to)`; then apply `importRewrites` with a content-aware replace; commit as one atomic change.
   - On any failure, roll back both the move and rewrites (P-161 revert).
4. Define the tool `move_file` (`autonomy:'auto'`). Reject `to` outside stage root.
5. Export `planMove`, `executeMove`, `moveFileTool`, `MovePlan` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local git + import scanning.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `planMove` returns import rewrites for dependent files; `dryRun` writes nothing
- [ ] `executeMove` moves the file and applies rewrites atomically
- [ ] Rewrites only touch files actually importing `from`
- [ ] Collision aborts (error) unless overwrite
- [ ] Failure rolls back move + rewrites
- [ ] Path traversal rejected

**Tests Required:** `move_file.test.ts` (staged fixture with an importer):
- `it('plans move with rewrites')`, `it('dry run writes nothing')`, `it('executes move and rewrites')`, `it('aborts on collision')`, `it('rolls back on failure')`

**Dependencies:** P-152 (atomic apply + rollback pattern). Core-only.

**Handoff Notes:** Next: P-154 propose_component (gated). Keep import-rewrite matching conservative — only rewrite known relative refs, never substring-match unrelated text.

---




### P-154: Agent Tools - propose_component (gated)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-153

**Context:** Generating a *net-new* component (a whole new file/module, not a tweak) is a high-impact action that the autonomy policy (P-157) treats as `gated` — it must pause for human approval before writing. `propose_component` drafts the new component (code + tests + registration points) and returns it for approval rather than writing directly. It is the primary demonstration of the human-in-the-loop (HIL) design.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/propose_component.ts` (new)
- `packages/core/src/agent/tools/propose_component.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `ComponentProposal`)

**Implementation Steps:**
1. Add `ComponentProposal`:
   ```ts
   export interface ComponentProposal { name: string; path: string; summary: string; code: string; tests: string; registration?: { file: string; snippet: string }; rationale: string }
   ```
2. Implement `draftComponent(spec: { name; language; framework; purpose; targetDir }, ctx): Promise<Result<ComponentProposal, StitchError>>`:
   - Build a `ComponentProposal` — the code scaffold is produced from a template (framework-aware) and the model's intent; `tests` scaffolds a sibling spec.
   - Validate the proposed `path` is inside C stage and non-colliding; keep the draft in-memory ONLY (no disk write).
3. Define the tool `propose_component` with `autonomy:'gated'`:
   - `execute` returns `ok(proposal)` but the loop's HIL gate (P-160/P-157) intercepts: when `autonomy==='gated'`, the proposal is NOT written until an explicit `approve_component` action from a human (web P-218 approve/reject, CLI P-198 picker).
   - When approved, `ctx.git.writeFile(proposal.path, proposal.code)` + write tests + registration snippet.
4. The `execute` itself only crafts + returns; a separate `applyProposal(proposal, ctx)` (exported, called post-approval) does the writes.
5. Export `draftComponent`, `proposeComponentTool`, `applyProposal`, `ComponentProposal` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local templating + git. Human-approval is the CLI/Web UI, not an MCP.

**Skills to Invoke:** May reference `ui-styling`/project conventions for the component template, but writing is deferred until approval.

**Acceptance Criteria:**
- [ ] `autonomy:'gated'` on the tool
- [ ] `execute` returns a `ComponentProposal` (code+tests+registration) WITHOUT writing files
- [ ] Proposed path validated inside stage, non-colliding
- [ ] No disk write until `applyProposal` is invoked post-approval
- [ ] Collision or disallowed path aborts with error
- [ ] Rationale/summary included for the approval UI

**Tests Required:** `propose_component.test.ts`:
- `it('drafts proposal without writing')`, `it('marks gated autonomy')`, `it('applyProposal writes files')`, `it('rejects collision path')`, `it('includes rationale')`

**Dependencies:** P-153 (atomic write/rollback for apply). Core-only.

**Handoff Notes:** Next: P-155 run_build (sandbox). The HIL queue in P-160 reads `autonomy:'gated'`; keep proposal JSON stable for the web Diff/Approve gate (P-218). Draft scaffold must follow `CODE_STYLE`/TECH_STACK so approved code passes P-204 build as-is.

---




### P-155: Agent Tools - run_build (sandbox)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-154

**Context:** `fix_dependency`/`edit_config`/`move_file`/`propose_component` change the child repo; the agent must verify those changes still build and test before finalizing. `run_build` executes the C build/test inside the sandbox (P-168+) and returns the outcome + logs, so the loop can iterate on failures. It is the read-only verification that closes the agent loop.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/run_build.ts` (new)
- `packages/core/src/agent/tools/run_build.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `BuildOutcome`)

**Implementation Steps:**
1. Add `BuildOutcome`:
   ```ts
   export interface BuildOutcome { pass: boolean; command: string; exitCode: number; durationMs: number; logs: { stdout: string[]; stderr: string[] }; flaky: boolean }
   ```
2. Implement `runBuildForStage(ctx, cmd: BuildCmd): Promise<Result<BuildOutcome, StitchError>>`:
   - Determine the ecosystem command: npm → `bun run build` + `bun test`; python → `python -m build` + `pytest`; cargo → `cargo build` + `cargo test`; go → `go build ./...` + `go test ./...` (from P-115 parser metadata).
   - Call the SANDBOX runner (P-171 build / P-172 test) — never run on the host. If `config.sandbox.docker` unavailable → use GH Actions fallback (P-175) or return `err('SANDBOX_UNAVAILABLE')`.
   - Capture stdout/stderr (bounded, e.g. last 500 lines); record `exitCode`, `durationMs`; set `flaky` via P-176 repeat detection (run twice, pass if any pass).
   - Return the outcome; the loop reads `pass` and, if false, can call `detect_gaps` again to plan a fix.
3. Define the tool `run_build` (`autonomy:'auto'` but `verifyOnly` — read-only on C's tree; the sandbox applies the staged diff, not the host).
4. Export `runBuildForStage`, `runBuildTool`, `BuildOutcome` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker sandbox connector (P-168) and/or GitHub Actions (P-175) — no direct host build. This is the connector seam where the sandbox is invoked.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Build/test run via the sandbox runner, never on host
- [ ] `pass` reflects exit code; logs bounded and captured
- [ ] Flaky detection repeats the run
- [ ] `SANDBOX_UNAVAILABLE` returned when no Docker + no GH fallback
- [ ] Command chosen per ecosystem
- [ ] Read-only on the host tree (diff applied in sandbox)

**Tests Required:** `run_build.test.ts` (mock sandbox runner):
- `it('reports pass/fail with logs')`, `it('selects build cmd per ecosystem')`, `it('detects flaky')`, `it('errors when sandbox unavailable')`, `it('bounded logs')`

**Dependencies:** P-154 (verifies its approved output). Sandbox modules P-168/P-171/P-172 provide the runner; stub used here until they land.

**Handoff Notes:** Next: P-156 ask_user. The build outcome is what drives the loop's iterate-or-stop decision; keep `BuildOutcome.flaky` so the loop doesn't loop forever on a flaky test (ties to P-176/P-267).

---




### P-156: Agent Tools - ask_user

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-155

**Context:** Despite autonomy, some decisions are genuinely ambiguous or risky and require the human (e.g. which license to pick, whether to include a large vendored subtree, how to resolve an unresolvable conflict). `ask_user` is a `gated` tool that suspends the agent loop and presents a structured question to the human via the CLI TUI (P-198) or web (P-218), then resumes with the answer.

**Files to Create/Modify:**
- `packages/core/src/agent/tools/ask_user.ts` (new)
- `packages/core/src/agent/tools/ask_user.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `UserQuestion`, `UserAnswer`)

**Implementation Steps:**
1. Add types:
   ```ts
   export interface UserQuestion { id: string; prompt: string; options?: string[]; defaultValue?: string; freeForm?: boolean }
   export interface UserAnswer { id: string; value: string; ts: string }
   ```
2. Implement `askUser(question, ctx): Promise<Result<UserAnswer, StitchError>>`:
   - For CLI: route to the Ink picker / prompt (P-198) via `ctx.config.cli.interactive`.
   - For web/server: enqueue into the HIL queue (P-160) and wait; must support timeout + abort (returns `err('USER_TIMEOUT')` or `err('ABORTED')` if the human cancels).
   - Resume the loop with the answer appended as a `tool` result message.
3. Define the tool `ask_user` (`autonomy:'gated'`): schema `{ prompt, options?, defaultValue?, freeForm? }`; `execute` returns the `UserAnswer` once resolved.
4. Add `ctx.config.ai.maxAskTimeoutMs` (default 120s) to bound waiting.
5. Ensure the answer is audited (P-145) for provenance but not echoed with secrets.
6. Export `askUser`, `askUserTool`, `UserQuestion`, `UserAnswer` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — human via CLI/Web UI. No MCP.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `autonomy:'gated'`
- [ ] Returns `UserAnswer` when the human answers
- [ ] `USER_TIMEOUT` if `maxAskTimeoutMs` exceeded
- [ ] Cancellation → `err('ABORTED')`
- [ ] Options/freeForm both supported; answer recorded for audit
- [ ] Loop resumes cleanly with the answer

**Tests Required:** `ask_user.test.ts` (fake user responder):
- `it('returns chosen option')`, `it('returns free form answer')`, `it('times out')`, `it('aborts on cancel')`, `it('records audit')`

**Dependencies:** P-155 (build verified before ambiguous asks). Core-only.

**Handoff Notes:** Next: P-157 autonomy policy engine. Keep `UserQuestion` ser/de-stable for the web gate; freeForm answers must never contain/leak keys. The HIL queue (P-160) is the backing store this waits on.

---




### P-157: Agent Tools - Autonomy Policy Engine

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-156

**Context:** Which tools may act without approval vs which must pause? The hybrid autonomy model (auto-fix mechanical issues, human-approve net-new generation) needs a single policy engine. This phase implements the `AutonomyPolicy` that reads tool `autonomy` flags (auto/gated), applies configurable overrides, and decides at runtime whether a tool execution requires a human gate. It is the enforcement point for the whole agent loop.

**Files to Create/Modify:**
- `packages/core/src/agent/policy.ts` (fill stub — keep `AutonomyPolicy`/`evaluate`)
- `packages/core/src/agent/policy.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `AutonomyOverride`, `PolicyDecision`)
- `packages/core/src/agent/loop.ts` (invoke policy before tool execution)

**Implementation Steps:**
1. Add types:
   ```ts
   export type Autonomy = 'auto' | 'gated'
   export interface AutonomyOverride { tool: string; mode: Autonomy }        // per-tool override
   export interface PolicyDecision { action: 'allow' | 'ask' | 'deny'; reason: string }
   export interface AutonomyPolicyConfig { overrides: AutonomyOverride[]; defaultMode: Autonomy; denyTools: string[] }
   ```
2. Implement `class AutonomyPolicy`:
   - `evaluate(toolName: string, toolAutonomy: Autonomy, ctx): PolicyDecision`:
     - If `toolName` in `denyTools` → `deny` (never run).
     - If a per-tool `override` exists → use its `mode`.
     - Else use `toolAutonomy` (from `ToolDefinition`).
     - `auto` → `allow`; `gated` → `ask` (requires HIL).
     - Special: `run_build` is always `allow` (verify-only); `propose_component`/`ask_user` are `gated` by default.
   - Deterministic, injectable (no global state) for tests.
3. Provide `defaultAutonomyPolicy(): AutonomyPolicy` with the config applied (P-009 `[agent]` section): default `auto`, gated list `['propose_component','ask_user']`, deny list empty.
4. Wire into `agent/loop.ts` (P-140): before any tool `execute`, call `policy.evaluate(tool.name, tool.autonomy, ctx)`; on `deny` return `err('TOOL_DENIED')`; on `ask` route to the HIL queue (P-160); on `allow` execute.
5. Log every decision to the audit trail (P-145) with reason.
6. Export `AutonomyPolicy`, `defaultAutonomyPolicy`, `AutonomyOverride`, `PolicyDecision` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — pure policy logic; HIL routing is internal.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `auto` tool → `action:'allow'` (no gate)
- [ ] `gated` tool → `action:'ask'`
- [ ] Tool in `denyTools` → `action:'deny'` regardless of other flags
- [ ] Per-tool override changes the effective mode
- [ ] Loop denies/asks/executes per the policy verdict
- [ ] Decisions logged with reason
- [ ] Deterministic (same inputs → same decision)

**Tests Required:** `policy.test.ts`:
- `it('allows auto tool')`, `it('asks on gated tool')`, `it('denies blacklisted tool')`, `it('applies override')`, `it('loop honors verdict')`, `it('logs decision')`

**Dependencies:** P-156 (gated tools defined). Core-only.

**Handoff Notes:** Next: P-158 tool result validation. The policy is the single place autonomy rules live — anyone changing the hybrid model edits this + config, not the tools. Keep `defaultMode` conservative; document overrides in config ref (P-275).

---




### P-158: Agent Tools - Tool Result Validation

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-157

**Context:** Tools mutate the working tree and return results; a malformed or unsafe result (path traversal, oversized output, invalid JSON that would corrupt the loop) must be caught before it propagates. This phase adds a validation layer over every tool `execute` result and every tool-provided `args` (using the P-139 adapter), and enforces a max output size + structural contract so the loop never consumes garbage.

**Files to Create/Modify:**
- `packages/core/src/agent/validation.ts` (new)
- `packages/core/src/agent/validation.test.ts` (new)
- `packages/core/src/agent/loop.ts` (wrap tool results with validation)

**Implementation Steps:**
1. Define validators:
   ```ts
   export function validateToolResult<T>(tool: ToolDefinition, result: Result<unknown, StitchError>): Result<T, StitchError> {
     if (result.isErr()) return result  // err passthrough
     const val = result.value
     if (val && typeof val === 'object' && typeof (val as any).__proto__ === 'object' && (val as any).constructor === Object) {}
     const size = JSON.stringify(val ?? null)?.length ?? 0
     if (size > MAX_TOOL_RESULT_BYTES) return err('TOOL_RESULT_TOO_LARGE', { size, max: MAX_TOOL_RESULT_BYTES })
     const parsed = z.any().safeParse(val)  // structural sanity
     return ok(val as T)
   }
   ```
   - `MAX_TOOL_RESULT_BYTES = 1_000_000` (1MB) default, configurable.
2. Implement `sanitizeToolArgs(args, schema)` — re-validate `args` through `parseToolArgs` (P-139) AND reject prototype-pollution keys (recursive) and `path` fields containing `..` traversal into a `STRICT_PATH_SAFE` list of allowed path-looking fields.
3. Add `MAX_TOOL_ARGS_DEPTH` (e.g. 16) to bound recursion, preventing pathological nested args.
4. Wire into `loop.ts`: after `policy.evaluate` (P-157) and before `execute`, validate `args`; after `execute`, validate result shape/size. On failure return the `err` as the tool response (loop continues) + audit (P-145).
5. Export `validateToolResult`, `sanitizeToolArgs`, `MAX_TOOL_RESULT_BYTES` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `err` results pass through unchanged
- [ ] Oversized `ok` result returns `err('TOOL_RESULT_TOO_LARGE')` with size/max
- [ ] `sanitizeToolArgs` rejects `__proto__`/`prototype` keys recursively
- [ ] Path fields with `..` are rejected/dropped per `STRICT_PATH_SAFE`
- [ ] Args/result validated before/after execute in the loop
- [ ] Depth bound prevents recursion blowup
- [ ] Validation failures recorded in audit

**Tests Required:** `validation.test.ts`:
- `it('passes err through')`, `it('rejects oversized result')`, `it('sanitizes proto keys')`, `it('rejects traversal paths')`, `it('bounds depth')`, `it('loop validates before execute')`

**Dependencies:** P-157 (policy precedes validation). Core-only.

**Handoff Notes:** Next: P-159 state machine. Keep `MAX_TOOL_RESULT_BYTES` in config (P-009) so large-repo tools can raise it; the structural contract here is what makes the reasoning stream (P-162) safe to render.

---




### P-159: Agent Tools - Agent State Machine

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-158

**Context:** The agent isn't a single function — it transitions through explicit states (idle, planning-tool-calls, gated-waiting, iterating, done, error). A formal state machine makes this observable, resumable, and testable, and prevents illegal transitions (e.g. executing a tool while awaiting a resumed provider). This phase implements the agent `StateMachine`.

**Files to Create/Modify:**
- `packages/core/src/agent/state.ts` (new — `AgentState`, `AgentStateMachine`)
- `packages/core/src/agent/state.test.ts` (new)
- `packages/core/src/agent/loop.ts` (drive loop via the state machine)

**Implementation Steps:**
1. Define states + transitions:
   ```ts
   export type AgentState =
     | 'idle' | 'loading' | 'preparing' | 'tool_executing' | 'waiting_approval' | 'waiting_user' | 'streaming' | 'iterating' | 'done' | 'error'
   ```
   - Legal transitions via an adjacency map; `transition(to)` throws `err('ILLEGAL_TRANSITION', {from,to})` on invalid moves.
2. Implement `class AgentStateMachine { get state(): AgentState; transition(to): void; canTransition(to): boolean; onChange?: (s)=>(...) }` with an `onChange` hook used by UI/WS (P-216) to render live status.
3. Wire into `loop.ts`:
   - `idle → "starting"` at loop entry.
   - Before a tool execute → `tool_executing`; while `gated` awaiting approval → `waiting_approval`; while awaiting `ask_user` → `waiting_user`.
   - `streaming` while consuming provider chunks.
   - `done` on `finishReason:'stop'`; `error` on fatal (after retries/failover exhausted).
   - Reject transitions that would execute while `waiting_*` (guards the HIL pause integrity).
4. Persist current state so a job can resume (P-240) — store in the P-239 job record via a `state` column.
5. Export `AgentState`, `AgentStateMachine`, `LEGAL_TRANSITIONS` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — internal orchestration state.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] All valid transitions permitted; illegal ones throw `ILLEGAL_TRANSITION`
- [ ] `onChange` fires on every transition
- [ ] Loop drives through `tool_executing` / `waiting_approval` / `waiting_user` / `streaming` / `done` correctly
- [ ] Cannot execute a tool while in `waiting_*`
- [ ] State persists for resume
- [ ] Fatal error → `error` state, not stuck `iterating`

**Tests Required:** `state.test.ts`:
- `it('transitions legally')`, `it('rejects illegal transition')`, `it('fires onChange')`, `it('guards waiting states')`, `it('loop reaches done')`, `it('persists state')`

**Dependencies:** P-158 (validation before state transitions complete). Core-only.

**Handoff Notes:** Next: P-160 HIL approval queue. The `waiting_approval`/`waiting_user` states are exactly what the HIL queue (P-160) resolves; keep state names frozen as web P-216 maps them.

---




### P-160: Agent Tools - HIL Approval Queue

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-159

**Context:** When the policy (P-157) decides `ask` for a gated tool (propose_component / ask_user), the request must be parked, presented to a human, and resolved (approve/reject) before the loop resumes — potentially across the CLI or web surface. This phase implements a persistent `HilQueue` (backed by `bun:sqlite` P-230 helper) so approval requests survive restarts and the loop awaits them via P-140/156.

**Files to Create/Modify:**
- `packages/core/src/agent/hil.ts` (new — `HilQueue`, `HilRequest`, `HilResolution`)
- `packages/core/src/agent/hil.test.ts` (new)
- `packages/core/src/agent/loop.ts` (await queue instead of inline allow)

**Implementation Steps:**
1. Add types:
   ```ts
   export type HilKind = 'component' | 'question' | 'permission'
   export interface HilRequest { id: string; kind: HilKind; toolName: string; createdAt: string; payload: unknown; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; agentState?: AgentState }
   export interface HilResolution { id: string; resolution: 'approved' | 'rejected'; by: string; ts: string; note?: string }
   ```
2. Implement `class HilQueue` (SQLite-backed):
   - `enqueue(req): string` — insert pending; overwrite duplicate by toolName if a prior is still pending.
   - `pending(): HilRequest[]` / `resolve(id, res): void` — set status, append resolution; fire an `onResolved` event.
   - `waitForResolution(id, timeoutMs): Promise<Result<HilResolution, StitchError>>` — resolves when `resolve` called (event emitter / polling with interval), or `err('USER_TIMEOUT')`/`err('ABORTED')` on cancel/timeout.
   - `listForUser(): HilRequest[]` — for web P-218 / CLI P-198 to render pending gates.
3. Wire into `loop.ts`: on `policy → ask`, create a `HilRequest` (kind from tool), `transition('waiting_approval')`, `await queue.waitForResolution(id)` — then approve → apply (e.g. `applyProposal` from P-154) or reject → append rejection as tool result + continue.
4. `ask_user` (P-156) reuses the same queue with `kind:'question'`.
5. Expose the resolved action so web/CLI can re-submit already-approved payloads after a crash (idempotent via `id`).
6. Export `HilQueue`, `HilRequest`, `HilResolution`, `HilKind` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — human gate is CLI/Web UI reading the queue; no MCP.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `enqueue` persists a pending `HilRequest`; duplicate pending by toolName is overwritten
- [ ] `waitForResolution` resolves when `resolve` is called, times out, or aborts
- [ ] Loop parks in `waiting_approval` until resolution
- [ ] Approve triggers the tool's apply; reject appends rejection and continues
- [ ] Queue survives process restart (SQLite)
- [ ] `listForUser` surfaces pending gates for UI/CLI

**Tests Required:** `hil.test.ts`:
- `it('enqueues and overwrites pending')`, `it('resolves via wait')`, `it('times out')`, `it('aborts on cancel')`, `it('loop parks then approves')`, `it('persists across restart')`

**Dependencies:** P-159 (state machine provides `waiting_approval`). Core-only; uses P-230 SQLite helper.

**Handoff Notes:** Next: P-161 revert. The `id` is the idempotency key — web P-218 approve/reject posts by it; audit the resolution (P-145). Keep payload `Record<string,unknown>` ser/de-stable.

---




### P-161: Agent Tools - Revert a Tool Action

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-160

**Context:** Autonomy is safe only if mistakes are reversible. Every mutating tool (`edit_config`, `move_file`, `fix_dependency`, `propose_component` apply, `merge` writes) records enough to undo itself (before-state). This phase implements a unified undo stack + a `revert_last` capability that rolls back the most recent tool action to its prior state, and a per-phase `revertToolAction(tool, context)`.

**Files to Create/Modify:**
- `packages/core/src/agent/revert.ts` (new — `UndoStack`, `revertLastToolAction`)
- `packages/core/src/agent/revert.test.ts` (new)
- `packages/core/src/agent/types.ts` (add `UndoRecord`)

**Implementation Steps:**
1. Add `UndoRecord`:
   ```ts
   export interface UndoRecord { id: string; ts: string; tool: string; kind: 'file_write' | 'file_move' | 'config_edit' | 'dep_fix' | 'manifest' | 'proposal_apply'; before: unknown; after: unknown; paths: string[] }
   ```
2. Implement `class UndoStack (maxDepth=50)`:
   - `push(rec)`; `undo(): Result<UndoRecord, StitchError>` — pop and invoke the matching reverter.
   - Reverter registry keyed by `kind`:
     - `file_write`/`config_edit` → restore `before` content to `paths`.
     - `file_move` → move back from `after` location to `before` path (re-run import rewrites inversely, P-153).
     - `dep_fix` → restore the manifest sections from `before`.
     - `proposal_apply` → delete the created files + registration snippet.
   - Each revert uses `ctx.git.writeFile`/`move` (P-076/P-073) so it lands as a reversible commit.
3. Wire into the loop: after each successful mutating tool (P-151/152/153/154/108 merge), `undoStack.push(...)`. Provide the tool `revert_last` (`autonomy:'gated'`) that calls `undo()` after a short confirmation (defensive).
4. Persist the stack in the job store (P-239) so a crash mid-multi-tool is reverted on resume or manually.
5. Export `UndoStack`, `revertLastToolAction`, `UndoRecord` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `push` records before/after; `undo` restores prior state for each kind
- [ ] `file_move` reverted including inverse import rewrites
- [ ] `proposal_apply` deletes created files
- [ ] Depth capped at 50
- [ ] Reverts land as git changes (reversible commits)
- [ ] `revert_last` is gated and requires confirmation
- [ ] Stack persists across restart

**Tests Required:** `revert.test.ts` (fixture with edits/moves):
- `it('undoes config edit')`, `it('undoes file move incl rewrites')`, `it('undoes dep fix')`, `it('deletes proposal files')`, `it('caps depth')`, `it('gated revert_last')`

**Dependencies:** P-160 (HIL resolution for revert confirmation). Core-only.

**Handoff Notes:** Next: P-162 reasoning stream. Undo is the safety net that makes 'auto' tools acceptable — record generous `before` snapshots (content + metainfo). Consider tying `maxDepth` to P-164 loop cap.

---




### P-162: Agent Tools - Reasoning Stream

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-161

**Context:** Users need to see *why* the agent is acting — its step-by-step reasoning, tool intents, and decisions — not just final output. This phase produces a live `ReasoningEvent` stream (via the P-136 `ReasoningChunk` and the WS/SSE bridge to web P-216 and CLI P-199), so every tool call, policy decision, and state transition is surfaced in the UI with context.

**Files to Create/Modify:**
- `packages/core/src/agent/reasoning.ts` (new — `ReasoningStream`, `ReasoningEvent`)
- `packages/core/src/agent/reasoning.test.ts` (new)
- `packages/core/src/agent/loop.ts` (emit events throughout the loop)

**Implementation Steps:**
1. Add `ReasoningEvent` (union):
   ```ts
   export type ReasoningEvent =
     | { type: 'plan'; text: string }
     | { type: 'tool_call'; tool: string; args: unknown; gate: 'auto' | 'gated' }
     | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
     | { type: 'policy'; decision: PolicyDecision; tool: string }
     | { type: 'state'; from: AgentState; to: AgentState }
     | { type: 'failover'; from: string; to: string; reason: string }
     | { type: 'cost'; totalCost: number; tokens: TokenUsage }
     | { type: 'complete'; finishReason: FinishReason }
   ```
2. Implement `class ReasoningStream { emit(e): void; subscribe(cb): () => void; dump(): ReasoningEvent[] }` — a pub/sub hub. The WS bridge (P-241/193) subscribes and forwards; CLI TUI renders progressively.
3. Wire into `loop.ts`:
   - `policy` event before each eval; `tool_call`/`tool_result` around each execute; `state` on every transition (P-159); `failover` on P-146 switch; `cost` per call (P-137); `plan` when building a prompt (P-141); `complete` at end.
   - Errors emit a `tool_result` with `ok:false` + summary.
4. Provide `reasoningText(ev): string` — a one-line human renderer used by CLI P-199 and web console.
5. Export `ReasoningStream`, `ReasoningEvent`, `reasoningText` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — internal event hub; transported to web via WS (P-193/P-241).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `emit`/`subscribe` deliver events; `dump` returns the full ordered list
- [ ] Loop emits policy/tool_call/tool_result/state/failover/cost/complete
- [ ] Failed tool calls emit `tool_result.ok:false` with summary
- [ ] `reasoningText` produces a readable one-liner per event type
- [ ] No events lost (all emitted before completion)
- [ ] Events carry enough context for UI rendering

**Tests Required:** `reasoning.test.ts`:
- `it('delivers subscribed events')`, `it('dumps ordered events')`, `it('loop emits all types')`, `it('flags tool failures')`, `it('renders reasoning line')`

**Dependencies:** P-161 (undo events). Core-only; P-136 chunk types reused.

**Handoff Notes:** Next: P-163 error handling. The reasoning stream is the primary UX surface — dedupe `state`/`policy` bursts so the UI isn't spammed; buffer `dump()` for post-hoc job review (audit).

---




### P-163: Agent Tools - Error Handling

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-162

**Context:** Errors flow through the agent from providers (P-138/P-146), tools, git, deps, and sandbox — and must be categorized so the loop can decide: retry now, switch provider, ask the user, or fail the job. This phase implements centralized `AgentError` classification + a friendly surface that maps every `StitchError`/`ProviderError` to a user-actionable message with a suggested next step.

**Files to Create/Modify:**
- `packages/core/src/agent/errors.ts` (new — `AgentErrorHandler`, `classifyError`)
- `packages/core/src/agent/errors.test.ts` (new)
- `packages/core/src/agent/loop.ts` (route errors through the handler)

**Implementation Steps:**
1. Define `ErrorClass`:
   ```ts
   export type ErrorClass = 'retryable' | 'provider' | 'config' | 'tool' | 'sandbox' | 'git' | 'auth' | 'fatal'
   ```
2. Implement `classifyError(e): { cls: ErrorClass; message: string; retryable: boolean; recoverable: boolean }`:
   - `ProviderError.retryable` → `retryable` (retry via P-138 / failover via P-146).
   - `TOOL_*` codes → `tool` (loop continues, P-158).
   - `AUTH_*`/401 → `auth` (recoverable — prompt user for key via `ask_user`).
   - `SANDBOX_*` → `sandbox` (recoverable — fallback).
   - `GIT_*` → `git` (recoverable with guidance).
   - `CONFIG_*` → `config` (fatal-ish, needs human fix).
   - everything else → `fatal` (fail job).
   - `recoverable = cls !== 'fatal' && cls !== 'config'`.
3. Implement `handleError(e, ctx, loop): Promise<Result<RecoveryAction, StitchError>>` → `RecoveryAction = { action: 'retry' | 'failover' | 'ask' | 'abort' | 'continue'; detail?: string }`:
   - `retryable` → `retry` (with P-138 budget); exhausted → `failover` (P-146); exhausted → `abort`.
   - `auth` → `ask` (prompt for key via P-156).
   - `tool` → `continue` (hand result to loop).
   - `sandbox` → `abort` with fallback suggestion.
   - `fatal`/`config` → `abort`.
4. Provide `friendlyError(e): string` mapping codes to human sentences (feeds CLI P-201 and web P-228).
5. Wire into `loop.ts` catch-all: `classifyError` → emit `tool_result`/reasoning (P-162) → `handleError` → action.
6. Export `classifyError`, `handleError`, `friendlyError`, `ErrorClass`, `RecoveryAction` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `retryable` classifies as `retryable`+`recoverable`
- [ ] `auth` errors → `recoverable`, `fatal`/`config` → not recoverable
- [ ] `handleError` maps class → retry/failover/ask/continue/abort
- [ ] Loop never crashes on unknown error (routes to `abort` with friendly message)
- [ ] `friendlyError` produces actionable text per code
- [ ] Retry → failover → abort chain terminates

**Tests Required:** `errors.test.ts`:
- `it('classifies provider/tool/auth/sandbox/fatal')`, `it('routes auth to ask')`, `it('retry to failover to abort')`, `it('continues on tool error')`, `it('no crash on unknown')`, `it('friendly message mapping')`

**Dependencies:** P-162 (events for error surfacing). Core-only.

**Handoff Notes:** Next: P-164 loop cap. Keep `ErrorClass` union stable — web P-228 error boundary and CLI P-201 render from `friendlyError`. Ensure all `StitchError` codes get a friendly mapping (add a fallback template).

---




### P-164: Agent Tools - Loop Cap

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-163

**Context:** An agent loop that never terminates wastes money and could mutate the tree indefinitely. A hard iteration cap (and token/cost budget from P-137) bounds every agent run, surfacing a clear `LOOP_LIMIT`/`COST_LIMIT` stop so users control spend. This phase enforces the cap at the loop-limit boundary, configurable per task.

**Files to Create/Modify:**
- `packages/core/src/agent/cap.ts` (new — `LoopCap` guard)
- `packages/core/src/agent/cap.test.ts` (new)
- `packages/core/src/agent/loop.ts` (consult cap each iteration)

**Implementation Steps:**
1. Define `LoopCap`:
   ```ts
   export interface LoopCap { maxIterations: number; maxTokens?: number; maxCostUsd?: number }
   ```
2. Implement `class LoopCapGuard { constructor(cap: LoopCap); check(iterations: number, ctx: LoopContext): Result<void, StitchError> }`:
   - If `iterations > cap.maxIterations` → `err('LOOP_LIMIT')`.
   - If `cap.maxTokens` set and `ctx.costTracker.get totalTokens > maxTokens` → `err('TOKEN_LIMIT')`.
   - If `cap.maxCostUsd` set and `ctx.costTracker.get totalCost > maxCostUsd` → `err('COST_LIMIT')`.
3. Default cap from config (`[agent] maxIterations` default 20, `maxTokens` 0=off, `maxCostUsd` 0=off), overridable per task via `LoopConfig.cap`.
4. Wire into `loop.ts`: at top of each iteration call `guard.check(...)`; on `err`, transition `error`, emit reasoning (P-162), and return the error with the cap type + current usage so the user sees why it stopped.
5. On limit, DO NOT auto-enable more budget — surface `ask_user` if `autoRaiseBudget: true`, else stop.
6. Export `LoopCapGuard`, `LoopCap` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Exceeding `maxIterations` returns `err('LOOP_LIMIT')`
- [ ] Exceeding `maxTokens`/`maxCostUsd` returns `TOKEN_LIMIT`/`COST_LIMIT`
- [ ] Guard consulted each iteration; loop stops on limit
- [ ] Defaults from config; per-task override
- [ ] Limit stop surfaces current usage + reason
- [ ] `autoRaiseBudget` opt-in gate (default off)

**Tests Required:** `cap.test.ts`:
- `it('caps iterations')`, `it('caps tokens')`, `it('caps cost')`, `it('reads defaults from config')`, `it('stops loop on limit with usage')`, `it('autoRaiseBudget off by default')`

**Dependencies:** P-163 (error handling of cap errors). Core-only.

**Handoff Notes:** Next: P-165 git-core integration. The cap is the hard spend guard for P-302 budgets too — keep caps in config so operators can raise them per environment. Emit a `complete`-style event on cap stop so UI shows non-error termination.

---




### P-165: Agent Tools - Git-Core Integration

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-164

**Context:** Agent tools (select_files, move_file, edit_config) must perform real git operations on the child-repo stage (merge writes P-072/P-076, commits with co-author trailers P-077, and history/provenance P-079). This phase connects the agent `ToolContext.git` facade to the git-core modules (P-069–P-087), so every mutation is a proper git change rather than raw fs writes, and provenance is captured at each step.

**Files to Create/Modify:**
- `packages/core/src/agent/gitFacade.ts` (new — `GitFacade` implementation)
- `packages/core/src/agent/gitFacade.test.ts` (new)
- `packages/core/src/agent/loop.ts` (supply the real facade to `ToolContext`)

**Implementation Steps:**
1. Implement `class GitFacade implements ToolContext['git']` wrapping core git modules:
   - `writeFile(relPath, content, { stage?: boolean })` → `writeToWorktree` (P-076) + add.
   - `move(from, to)` → subtree/path move (P-073/P-153).
   - `listFiles(repo)` → scan listing (P-103/P-090 cache).
   - `commit(message, coAuthors)` → `commitWithCoAuthors` (P-077) adding author trailers from provenance (P-181).
   - `mergeSources()` → `mergeRepos` (P-072) + `conflictResolver` (P-075).
   - `stageStatus()` → clean-tree check (P-084).
   - `rollback()` → `rollbackAbort` (P-085).
2. Wire into `loop.ts`: build `ToolContext` with this real facade (replacing the test/mock one). All tools then operate on real git state.
3. Add provenance tagging at each commit: co-author trailer + a `Stitch-Origin` footer recording source repo/path (feeds P-181 blame map).
4. Guard: tools only mutate within the stage root (facade validates `relPath` no traversal, reusing P-158).
5. Ensure `asset` binary skip (P-082) so large binaries aren't committed accidentally by tools.
6. Export `GitFacade` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local `simple-git`/git-filter-repo (P-016/P-066).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `GitFacade.writeFile/move/commit/listFiles` operate on real git state
- [ ] Commits carry co-author + `Stitch-Origin` provenance trailers
- [ ] `rollback` reverts a failed multi-step mutation
- [ ] Tools validated against traversal outside stage root
- [ ] Binary skip list respected (P-082)
- [ ] Loop uses the real facade (no mock in production path)

**Tests Required:** `gitFacade.test.ts` (temp git repos via fixture generator P-064):
- `it('writes and commits')`, `it('moves files')`, `it('adds provenance trailers')`, `it('rolls back')`, `it('rejects traversal')`, `it('skips binaries')`

**Dependencies:** P-164 (loop integration). Core git modules P-069–P-087.

**Handoff Notes:** Next: P-166 deps/license integration. The `Stitch-Origin` footer is the seam into provenance (P-181/182); keep it structured (JSON in trailer body) so P-311 can parse it.

---




### P-166: Agent Tools - Deps/License Integration

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-165

**Context:** Agent tools like `fix_dependency`, `detect_gaps`, and the merge pipeline (P-151/P-150) must reuse the real deps (P-104–P-117) and license (P-118–P-130) modules rather than re-implementing logic. This phase supplies the deps/license facades into `ToolContext`, so the loop's checks and fixes are validated by the actual parsers/resolvers/policy engine.

**Files to Create/Modify:**
- `packages/core/src/agent/depsLicenseFacade.ts` (new — `DepsFacade`, `LicenseFacade`)
- `packages/core/src/agent/depsLicenseFacade.test.ts` (new)
- `packages/core/src/agent/loop.ts` (supply real facades)

**Implementation Steps:**
1. Implement `class DepsFacade implements ToolContext['deps']`:
   - `union(a, b)` → `unionManifests` (P-108).
   - `resolve(pkg, range)` → semver resolver (P-109) / peer handling (P-110).
   - `dedupe(manifest)` → dedupe/nest (P-111).
   - `mergeScripts(a,b)` → scripts merge (P-112).
   - `lockfile(manifest, repoPath)` → regenerate (P-114).
   - `report(...)` → `DependencyReport` (P-116).
2. Implement `class LicenseFacade implements ToolContext['license']`:
   - `scan(repoPath)` → scan (P-118).
   - `normalize(expr)` → SPDX (P-119).
   - `compat(licenses, policy)` → matrix (P-120) + GPL (P-121) + dual (P-122) + unknown (P-123).
   - `policy(declared, policy, overrides)` → verdict (P-127).
   - `reportData(declared, policy)` → `LicenseReportData` (P-128).
3. Wire into `loop.ts`: `ToolContext.deps/license` = these real facades. `fix_dependency` (P-151) now resolves via real P-109; `detect_gaps` (P-150) flags real missing deps; the merge pipeline flags real license conflicts that `ask_user`/HIL gates (P-160) surface.
4. Add a `complianceGate()` on `LicenseFacade` returning `{ blocking, report }` so the loop can halt C creation on a blocking license verdict (ties to P-205).
5. Export `DepsFacade`, `LicenseFacade` from `agent/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — orchestrates local deps/license modules.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `DepsFacade.union/resolve/dedupe/lockfile/report` delegate to real modules
- [ ] `LicenseFacade.scan/normalize/compat/policy/reportData` delegate to real modules
- [ ] `fix_dependency` resolves via real resolver; results match module outputs
- [ ] License blocking surfaces via `complianceGate`
- [ ] Loop path uses real facades, not mock
- [ ] Results consistent with standalone module tests

**Tests Required:** `depsLicenseFacade.test.ts`:
- `it('deps union/resolve match modules')`, `it('license scan/compat match modules')`, `it('complianceGate blocks on deny')`, `it('loop uses real facades')`

**Dependencies:** P-165 (git facade supplies repo stage). Deps P-104–P-117, License P-118–P-130.

**Handoff Notes:** Next: P-167 E2E agent test. This closes the loop: agent mutations are validated by the same parser/resolver/policy that gates composition — keep facade methods thin (delegate) so a dep change never needs two code paths.

---




### P-167: Agent Tools - E2E Agent Test

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-166

**Context:** After all agent-tool modules (P-148–P-166), the whole system must prove it can take two real fixture repos, run an agent loop with tools, produce a valid child repo C that builds and tests, and pass the license/compliance gate — end to end, offline. This phase builds that E2E suite using the fixture generator (P-064) and the mock/real facades, and asserts the full path from selection → dependency closure → fixes → build → compliance → commit.

**Files to Create/Modify:**
- `packages/core/src/agent/__tests__/agent.e2e.test.ts` (new)
- `packages/core/src/agent/__tests__/fixtures/` (two tiny JS repos A and B)
- `packages/core/package.json` (add `"test:agent:e2e"` script)
- `packages/core/src/agent/index.ts` (barrel all agent modules)

**Implementation Steps:**
1. Create fixture repos A and B (via P-064 generator or committed): each a small JS repo with a couple of files, a dependency, and a passing test.
2. Build an orchestration harness in the test: `runAgentE2E({ repoA, repoB, selection, config })` that:
   - Initializes a `ToolContext` with real `GitFacade`/`DepsFacade`/`LicenseFacade` (P-165/166) in a temp stage.
   - Runs the loop (P-140) with a `MockProvider` scripted to: select_files → resolve_dependency_closure → fix_dependency (missing) → run_build (sandbox stub passes) → stop.
   - Asserts the staged C: selected files present, missing dep fixed and in manifest, build/tests pass (via stub sandbox), license report `allow`.
3. Scenario assertions:
   - Happy end-to-end: child repo complete + compliance gate `allow`.
   - License block: inject a GPL dep → assert HIL `ask` surfaces a `waiting_approval` request (does not silently create C).
   - Loop cap: endless tool calls → `LOOP_LIMIT`.
   - Revert: after a bad edit, `revert_last` restores prior manifest.
4. Add `test:agent:e2e` script running `bun test src/agent --coverage` with the core coverage gate; ensure runs offline (real git but no network registry — use fixture deps).
5. Run the suite; fix integration bugs surfaced (this is the regression net that validates all prior phases wire together).
6. Export all agent modules from `agent/index.ts`.

**Required MCPs/Connectors:** None — offline; sandbox build is stubbed (real sandbox verified in P-168+).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Happy path: valid C built from A+B, dep fixed, build+test pass, compliance `allow`
- [ ] License block parks an HIL `waiting_approval` (doesn't create C)
- [ ] Endless tool loop hits `LOOP_LIMIT`
- [ ] Revert restores prior state after a bad edit
- [ ] Uses real facades (git/deps/license) with mock provider only
- [ ] Runs offline; `test:agent:e2e` passes coverage gate

**Tests Required:** `agent.e2e.test.ts`:
- `it('happy end-to-end compose')`, `it('blocks on license with HIL')`, `it('caps endless loop')`, `it('reverts bad edit')`

**Dependencies:** P-166 (facades). Deps, License, Git, AI modules all real.

**Handoff Notes:** Next: P-168 begins Sandbox (Docker client). This E2E is the gate to declare Agent Tools done — it proves the autonomous loop + HIL + compliance produce safe, valid child repos. Keep fixtures committed for determinism.

---




### P-168: Sandbox - Docker Client

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-167

**Context:** All build/test verification (agent `run_build` P-155, and C creation) must run inside an isolated, reproducible sandbox so repo-stitcher never executes untrusted merged code on the host. This phase creates the `SandboxClient` abstraction over Docker using `dockerode` (P-029), providing a thin, testable wrapper for the container lifecycle operations the rest of the Sandbox epic builds on.

**Files to Create/Modify:**
- `packages/core/src/sandbox/client.ts` (new — `SandboxClient`, `ContainerSpec`)
- `packages/core/src/sandbox/client.test.ts` (new)
- `packages/core/src/sandbox/index.ts` (barrel)

**Implementation Steps:**
1. Add `ContainerSpec`:
   ```ts
   export interface ContainerSpec { image: string; workingDir: string; bindMounts?: { host: string; container: string }[]; env?: Record<string,string>; cmd?: string[]; memory?: number; cpus?: number; networkDisabled?: boolean }
   ```
2. Implement `class SandboxClient` wrapping `dockerode`:
   - `isAvailable(): Promise<boolean>` — ping the Docker daemon; return `false` (not throw) when Docker is unavailable (drives the P-175 GH fallback).
   - `pull(image, {platform?}): Promise<Result<void, StitchError>>` — pull image with streaming progress; map to `err('DOCKER_PULL_FAILED')` on failure.
   - `run(spec, opts { timeoutMs, signal }): Promise<Result<ContainerRun, StitchError>>` — create/start container, stream logs live via `container.logs`/attach, wait for exit, collect `ContainerRun { exitCode, stdout, stderr, durationMs }`, then remove the container (bounded by `timeoutMs`, `signal` abort).
   - `rm(containerOrId): Promise<void>` — force-remove (cleanup safety).
   - `stats(containerId)` → CPU/memory (for P-174 limits + P-173 capture).
3. Inject the `dockerode` instance (constructor) so tests can supply a fake; default to a real instance.
4. Respect `config.sandbox.networkAllow` — when `false`, start containers with `NetworkMode:'none'` (P-174 offline).
5. Export `SandboxClient`, `ContainerSpec`, `ContainerRun` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker daemon (`dockerode` over its socket/TCP). GH Actions is the fallback connector (P-175); no MCP.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `isAvailable()` returns true with a live daemon, false (no throw) when unavailable
- [ ] `pull` streams progress and maps failures to `DOCKER_PULL_FAILED`
- [ ] `run` creates/starts/waits/collects logs and removes the container
- [ ] `run` respects `timeoutMs` and `signal` (abort kills/removes)
- [ ] `networkAllowed===false` sets `NetworkMode:'none'`
- [ ] dockerode injectable for tests (fake client)
- [ ] Cleanup guaranteed even on timeout/abort

**Tests Required:** `client.test.ts` (fake dockerode):
- `it('detects availability')`, `it('pulls image')`, `it('runs and collects')`, `it('enforces timeout')`, `it('aborts via signal')`, `it('disables network')`, `it('always cleans up')`

**Dependencies:** P-167 (agent E2E ready to consume). dockerode from P-029.

**Handoff Notes:** Next: P-169 per-ecosystem images, using this client's pull/run. Keep `ContainerRun` log fields bounded (cap at N lines) to avoid memory blowup; `isAvailable` is the key guard that triggers GH fallback in P-175.

---




### P-169: Sandbox - Ephemeral Image per Ecosystem

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-168

**Context:** Each ecosystem (npm/go/cargo/python) needs a consistent base image with its toolchain pre-installed so build/test behave identically everywhere. This phase defines and materializes an ephemeral image per ecosystem, either pulling a pinned public base or building a local `Dockerfile` (P-008), and caches the image id so rebuilds reuse it (P-178 layer cache later).

**Files to Create/Modify:**
- `packages/core/src/sandbox/images.ts` (new — `imageFor`, `ensureImage`)
- `packages/core/src/sandbox/images.test.ts` (new)
- `packages/core/src/sandbox/Dockerfile.npm`, `Dockerfile.python`, `Dockerfile.cargo`, `Dockerfile.go` (P-008 base, extended)

**Implementation Steps:**
1. Define a registry:
   ```ts
   export const ECOSYSTEM_IMAGES: Record<Ecosystem, string> = {
     npm: 'node:22-alpine', python: 'python:3.12-slim', cargo: 'rust:1.80-alpine', go: 'golang:1.23-alpine'
   }
   ```
   - For npm use the bun-ready node image; note bun availability for the lockfile path.
2. Implement `ensureImage(ecosystem, client): Promise<Result<string, StitchError>>`:
   - Check config `config.sandbox.overrideImage[ecosystem]` first (user-provided tag).
   - Else if `config.sandbox.buildLocal` and a `Dockerfile.<eco>` exists → build via `client.buildImage` (map `DOCKER_BUILD_FAILED`).
   - Else `client.pull(ECOSYSTEM_IMAGES[eco])`.
   - Cache resolved image id in memory + in `bun:sqlite` (`sandbox_images` table, P-230 helper) keyed by `ecosystem|tag|platform` so subsequent runs skip pull.
3. Return the final image tag/id; keep the ephemeral mark (tagged `:stitch-ephemeral-<hash>`) so cleanup (P-177) can prune.
4. Provide `imageFor(ecosystem)` pure lookup for P-168 `ContainerSpec`.
5. Export `ensureImage`, `imageFor`, `ECOSYSTEM_IMAGES` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker Hub/registry via dockerode; GH Actions runners define their own images (P-175) — this is the Docker path.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `imageFor` returns the pinned tag per ecosystem
- [ ] `ensureImage` honors `overrideImage`, falls back to pull or local build
- [ ] Resolved image cached (in-memory + sqlite) so repeated calls skip network
- [ ] Build/pull failures map to typed `StitchError`
- [ ] Image tagged for later cleanup
- [ ] Deterministic per `ecosystem|tag|platform`

**Tests Required:** `images.test.ts` (fake client):
- `it('defaults images per ecosystem')`, `it('overrides from config')`, `it('pulls when not cached')`, `it('builds local dockerfile')`, `it('caches across calls')`, `it('maps pull failure')`

**Dependencies:** P-168 (client). P-008 base Dockerfile.

**Handoff Notes:** Next: P-170 install deps. Pin image tags to exact versions for reproducibility; cache invalidation strategy lands in P-178. The ephemeral tagging is what P-177 cleanup prunes.

---




### P-170: Sandbox - Install Deps

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-169

**Context:** Before building/testing C, its dependencies must be installed inside the sandbox. This phase implements `installDeps` which mounts the staged C into a container and runs the ecosystem install command, capturing output, honoring offline mode (P-174), and returning a typed result that the build/test steps (P-171/P-172) gate on.

**Files to Create/Modify:**
- `packages/core/src/sandbox/install.ts` (new — `installDeps`)
- `packages/core/src/sandbox/install.test.ts` (new)

**Implementation Steps:**
1. Define `InstallSpec` (extends `ContainerSpec`): `{ ecosystem, repoPath, lockfileName?, networkAllowed? }`.
2. Implement `installDeps(ecosystem, repoPath, opts, client): Promise<Result<InstallResult, StitchError>>`:
   - Determine command per ecosystem: npm → `bun install` (mirrors P-114) or `npm ci` if a committed lockfile; python → `pip install -r requirements.txt` (or `uv sync –extra-index` when pyproject); cargo → `cargo fetch`; go → `go mod download`.
   - Build `ContainerSpec` with `imageFor(ecosystem)`, bind-mount `repoPath` → `/workspace` (read-write for install), `workingDir:'/workspace'`, and `NetworkMode:'none'` when `networkAllowed===false`.
   - `client.run(...)`; return `ok({ exitCode, dirty: false, installed: true, logs })` when `exitCode===0`; else `err('DEP_INSTALL_FAILED', { exitCode, stderr })`.
3. When offline and the install needs network (no cache), surface `err('DEP_INSTALL_OFFLINE_BLOCKED')` rather than hanging; the agent (P-166) or fallback (P-175 GH Actions has network) handles it.
4. Keep a concise summary of installed package count from stdout for logging.
5. Export `installDeps`, `InstallSpec`, `InstallResult` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker (container) + package registry inside container when network allowed.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Correct install command per ecosystem
- [ ] Fixture mounts `/workspace` and runs in the right working dir
- [ ] Successful exit → `ok`; non-zero → `err('DEP_INSTALL_FAILED')`
- [ ] Offline mode + network-needing install → `DEP_INSTALL_OFFLINE_BLOCKED`
- [ ] Bind-mount is read-write for install
- [ ] Uses `imageFor(ecosystem)`

**Tests Required:** `install.test.ts` (fake client with scripted exit):
- `it('installs npm deps')`, `it('installs go modules')`, `it('fails on non-zero exit')`, `it('blocks when offline and needed')`, `it('selects command per eco')`

**Dependencies:** P-169 (image). Deps P-114 command knowledge.

**Handoff Notes:** Next: P-171 run build. `installDeps` result gates whether build proceeds; the `dirty:false` flag anticipates P-181 provenance checks (install must not leak host files).

---




### P-171: Sandbox - Run Build

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-170

**Context:** The central verification: does merged C actually build? This phase implements `runBuild`, which runs the ecosystem build command inside the sandbox container (after install P-170), captures artifacts/logs, and returns `BuildResult` with a pass/fail verdict — the outcome the agent loop and web UI depend on.

**Files to Create/Modify:**
- `packages/core/src/sandbox/build.ts` (new — `runBuild`)
- `packages/core/src/sandbox/build.test.ts` (new)

**Implementation Steps:**
1. Define `BuildResult`:
   ```ts
   export interface BuildResult { pass: boolean; command: string; exitCode: number; durationMs: number; logs: { stdout: string[]; stderr: string[] }; outputDir?: string }
   ```
2. Implement `runBuild(ecosystem, repoPath, opts, client): Promise<Result<BuildResult, StitchError>>`:
   - Build command per ecosystem: npm → `bun run build`; python → `python -m build`; cargo → `cargo build --release` (or `--debug` for speed); go → `go build ./...`.
   - Container mount `/workspace` (read-only for source, with a writable `/buildout` for artifacts); `workingDir:'/workspace'`.
   - `client.run(...)`; on completion, if an `outputDir` (e.g. `dist`/`target`) exists, copy it out to a host staging dir via `client.copyFrom(id, '/workspace/dist', target)`.
   - `pass = exitCode===0`; return the `BuildResult` (do not `err` on build failure — the loop needs the verdict to iterate, P-163).
3. Only fail (typed `err`) on infrastructure errors (timeout, container crash, missing image), not on the app's build exit code.
4. Cap logs at last 500 lines to bound memory (P-173 detail).
5. Export `runBuild`, `BuildResult` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker container execution.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Correct build command per ecosystem
- [ ] 0 exit → `pass:true`; non-zero → `pass:false` (NOT an `err`)
- [ ] Infrastructure failure (timeout/crash) → typed `err`
- [ ] Artifacts copied out when `outputDir` present
- [ ] Logs bounded to last 500 lines
- [ ] Reads staged C from `/workspace`

**Tests Required:** `build.test.ts` (fake client):
- `it('passes on zero exit')`, `it('fails verdict on non-zero')`, `it('errors on infra failure')`, `it('copies artifacts')`, `it('selects command per eco')`, `it('bounds logs')`

**Dependencies:** P-170 (install must pass). Agent `run_build` P-155 stub now points here.

**Handoff Notes:** Next: P-172 run tests. This is the verification `run_build` (P-155) and the pipeline's build gate (P-238) call. Keep `BuildResult` shape frozen — web P-220 sandbox panel + progress P-199 render it.

---




### P-172: Sandbox - Run Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-171

**Context:** Merged C must not only build but pass its own test suite. This phase implements `runTests`, executing the ecosystem test command inside the sandbox and returning a structured `TestResult` (pass/fail, counts, failure list, logs) that gates finalizing C and feeds flaky detection (P-176).

**Files to Create/Modify:**
- `packages/core/src/sandbox/test.ts` (new — `runTests`)
- `packages/core/src/sandbox/test.test.ts` (new)

**Implementation Steps:**
1. Define `TestResult`:
   ```ts
   export interface TestResult { pass: boolean; command: string; exitCode: number; durationMs: number; passed: number; failed: number; skipped: number; failures: { name: string; message: string; file?: string }[]; logs: { stdout: string[]; stderr: string[] } }
   ```
2. Implement `runTests(ecosystem, repoPath, opts, client): Promise<Result<TestResult, StitchError>>`:
   - Command per ecosystem: npm → `bun test` (or `npm test`); python → `pytest -q`; cargo → `cargo test --release` (or debug); go → `go test ./...`.
   - `JUNIT`/`json` reporter flag where supported to parse counts (e.g. `bun test --reporter junit`, `pytest --junitxml`); else parse stdout regex for passed/failed/skipped.
   - Container mount as P-171; `NetworkMode:'none'` when offline.
   - Parse `TestResult.failures` (name/message/file) from reporter output, bounded.
   - `pass = exitCode===0`; verdict failure is a normal result (not `err`); infra failure → typed `err`.
3. Return counts (0 when unparseable but exit 0 → trust exit code).
4. Export `runTests`, `TestResult` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker container execution.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Correct test command per ecosystem
- [ ] Parses passed/failed/skipped from reporter output; falls back to exit code
- [ ] Failures list populated with name/message/file when parseable
- [ ] Verdict non-zero → `pass:false` (not `err`)
- [ ] Infra failure → typed `err`
- [ ] Offline mode honored
- [ ] Output bounded

**Tests Required:** `test.test.ts` (fake client with sampled reporter stdout):
- `it('reports passing suite')`, `it('reports failing suite with failures')`, `it('falls back to exit code')`, `it('errors on infra')`, `it('selects command per eco')`, `it('honors offline')`

**Dependencies:** P-171 (build/container conventions). Agent loop verification.

**Handoff Notes:** Next: P-173 capture logs/artifacts. `TestResult.failures[].file` ties to the provenance (P-181) so a failing test can be attributed to a source file; keep test-runner json/junit support documented per ecosystem.

---




### P-173: Sandbox - Capture Logs/Artifacts

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-172

**Context:** Debugging failures and completing provenance (P-181/SBOM P-183) requires the logs and build/test artifacts produced inside sandbox containers. This phase formalizes capture: live log streaming into a bounded ring buffer, artifact extraction to a host archive dir keyed by run id, and persistence of both in the job record so failures are reproducible post-hoc.

**Files to Create/Modify:**
- `packages/core/src/sandbox/capture.ts` (new — `CaptureManager`)
- `packages/core/src/sandbox/capture.test.ts` (new)
- `packages/core/src/sandbox/client.ts` (add `copyFrom`, streaming log hook)

**Implementation Steps:**
1. Implement `class CaptureManager`:
   - `bindRun(runId)` → returns a `{ stream: (line) => void }` that appends to a bounded ring buffer (default cap 10_000 lines, configurable) keyed by `runId`.
   - `capture(client, runId, containerId, { format?: 'docker' | 'json' }): Promise<{ logs: string[]; sizeBytes: number }>` — drains `client.logs(containerId)` live into the buffer; raise `SANDBOX_LOG_LIMIT` if cap exceeded (but keep latest).
   - `extractArtifacts(client, runId, containerId, containerPaths: string[], hostDir): Promise<Result<string[], StitchError>>` — `client.copyFrom` each path into `<hostDir>/<runId>/`; return extracted host paths.
2. Persist capture metadata (runId, log offset, artifact host paths) as part of `JobRecord.artifacts` (P-239/248 tracing).
3. Wire into `client.run`: accept an optional `onLog(line)` callback and `capture` the live stream via P-168 so both P-171/P-172 and this manager see logs.
4. Provide `hostArtifactPath(runId, name)` helper for web P-221 (sandbox results) and trace viewer (P-248).
5. Guard: artifact names/dirs sanitized (no traversal), total extracted bytes bounded (config `sandbox.maxArtifactBytes`, default 100MB).
6. Export `CaptureManager`, `hostArtifactPath` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker container logs/filesystem.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Live log streaming appends to bounded ring buffer (latest kept on overflow)
- [ ] `extractArtifacts` copies to `<hostDir>/<runId>/` and returns paths
- [ ] Run metadata stored for tracing
- [ ] Artifact paths sanitized; extraction bound by `maxArtifactBytes`
- [ ] `client.run` accepts `onLog` and streams to capture
- [ ] Reproducible post-hoc via stored logs + artifacts

**Tests Required:** `capture.test.ts`:
- `it('streams into bounded buffer')`, `it('caps at log limit')`, `it('extracts artifacts')`, `it('sanitizes artifact paths')`, `it('binds onLog to run')`

**Dependencies:** P-172 (tests emit logs to capture). 

**Handoff Notes:** Next: P-174 timeout/limits. Captured logs are the input to flaky detection (P-176) — keep timestamps per line (ISO) so re-run diffing is possible. Bound memory via ring buffer, not truncation.

---




### P-174: Sandbox - Timeout/Limits

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-173

**Context:** A merged repo could contain infinite loops, huge allocations, or network spins — the sandbox must enforce hard resource limits so a runaway build can't hang or starve the host. This phase implements per-run timeouts, CPU/memory caps, output/disk bounds, and network on/off control, applied at the container level.

**Files to Create/Modify:**
- `packages/core/src/sandbox/limits.ts` (new — `applyLimits`, `LimitsConfig`)
- `packages/core/src/sandbox/limits.test.ts` (new)
- `packages/core/src/sandbox/client.ts` (optionally set OOM). 
- `packages/core/src/sandbox/index.ts`

**Implementation Steps:**
1. Define `LimitsConfig`:
   ```ts
   export interface LimitsConfig { timeoutMs: number; memMb: number; cpuCount: number; outputLines: number; maxArtifactBytes: number; networkAllowed: boolean }
   ```
   - Defaults (config P-009): `timeoutMs 300_000`, `memMb 1536`, `cpuCount 2`, `outputLines 10_000`, `maxArtifactBytes 100MB`, `networkAllowed true`.
2. Implement `applyLimits(spec: ContainerSpec, cfg: LimitsConfig): ContainerSpec` — sets `spec.memory`, `spec.cpus` from cfg, `NetworkMode` based on `networkAllowed`, and attaches `HostConfig` resources via dockerode.
3. Implement `enforceTimeout(fn, timeoutMs, signal): Promise<Result<ContainerRun, StitchError>>`:
   - Wraps `client.run`; on timeout, `client.kill(id)` + `client.rm(id)` then return `err('SANDBOX_TIMEOUT', { timeoutMs })`.
   - Combine with `signal` (user/loop abort) — both produce `SANDBOX_ABORTED`.
4. Provide `defaultLimits(config): LimitsConfig` and a `strictLimits()` variant (for untrusted code) with tight timeouts + no network.
5. Wire `outputLines` bound into P-173 `CaptureManager` (shared constant).
6. Export `applyLimits`, `enforceTimeout`, `defaultLimits`, `strictLimits`, `LimitsConfig` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker HostConfig/Limits API.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `applyLimits` sets memMb/cpus/NetworkMode on the spec
- [ ] `enforceTimeout` kills + removes on timeout and returns `SANDBOX_TIMEOUT`
- [ ] Signal abort → `SANDBOX_ABORTED`
- [ ] `strictLimits` yields tight timeouts + `networkAllowed:false`
- [ ] `outputLines` bound shared with capture
- [ ] Defaults from config

**Tests Required:** `limits.test.ts`:
- `it('applies memory/cpu/network')`, `it('kills on timeout')`, `it('aborts on signal')`, `it('strict limits')`, `it('defaults read config')`, `it('bounds output')`

**Dependencies:** P-173 (output binding). 

**Handoff Notes:** Next: P-175 GH Actions fallback. These limits prevent the "runaway build" class of sandbox bug; expose failures distinctly (timeout vs OOM vs abort) so P-163 can route them.

---




### P-175: Sandbox - GH Actions Fallback

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-174

**Context:** Docker isn't always available (CI images lacking the daemon, sandboxed hosts, user machines without Docker). When `SandboxClient.isAvailable()` is false, repo-stitcher falls back to running the build/test verification on GitHub Actions via a templated workflow (P-100). This phase implements that fallback path and the decision logic that selects Docker vs GH Actions.

**Files to Create/Modify:**
- `packages/core/src/sandbox/fallback.ts` (new — `runViaGitHubActions`)
- `packages/core/src/sandbox/fallback.test.ts` (new)
- `packages/core/src/sandbox/runner.ts` (new — `runVerification` dispatcher selecting sandbox)
- `packages/core/src/sandbox/runner.test.ts` (new)
- `templates/github-build.yml` (workflow template) — touch P-100

**Implementation Steps:**
1. Implement `fallbackSelection(config): 'docker' | 'github' | 'unavailable'`:
   - `config.sandbox.mode === 'github'` → `github`; `=== 'docker'` → `docker` (error if daemon down); `'auto'` (default) → `isAvailable() ? docker : github`.
   - If neither and mode forces → `unavailable` (caller errors `SANDBOX_UNAVAILABLE`).
2. Implement `runViaGitHubActions(ecosystem, repoPath, action, opts): Promise<Result<BuildResult|TestResult, StitchError>>`:
   - Stage C → push to a temp private branch (P-078/P-092) or use the existing workflow trigger (P-100).
   - Render `templates/github-build.yml` with the ecosystem `run_build`/`run_test` steps and only the needed inputs (paths, node/python/go versions).
   - Trigger via `createWorkflowDispatch` (Octokit, P-100), poll `workflow run` status + `jobs` logs via `download logs` (P-095/P-096), parse into the same `BuildResult`/`TestResult`.
   - Timeout/bounds from P-174; map GH API errors to `GITHUB_*` codes.
3. Implement `runVerification(kind, ecosystem, repoPath, opts)` dispatcher used by P-171/P-172/agent `run_build`:
   - Resolve `fallbackSelection`; call Docker `runBuild`/`runTests` OR GH fallback; if `unavailable` → `err('SANDBOX_UNAVAILABLE')`.
4. Keep the GH path behind a flag (`config.ci.path`) and only when the user has GitHub auth (P-088).
5. Export `fallbackSelection`, `runViaGitHubActions`, `runVerification` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** GitHub API (workflow dispatch, run logs) via Octokit — P-088/P-095/P-096/P-100.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `auto` selects docker when available, github when not
- [ ] Forced `github` works; forced `docker` with no daemon → `SANDBOX_UNAVAILABLE` error only when no GH path
- [ ] GH workflow template renders correct ecosystem steps
- [ ] Workflow dispatch + log pull yields `BuildResult`/`TestResult` same shape as Docker path
- [ ] GH path gated on auth; without auth and no Docker → `SANDBOX_UNAVAILABLE`
- [ ] `runVerification` returns same result shape regardless of backend

**Tests Required:** `fallback.test.ts` + `runner.test.ts` (mock Octokit + fake client):
- `it('selects backend')`, `it('runs via github actions')`, `it('parses gh logs to BuildResult')`, `it('errors when unavailable')`, `it('same shape both paths')`, `it('gates on auth')`

**Dependencies:** P-174 (limits carry to GH) + GitHub P-088/P-095/P-096/P-100.

**Handoff Notes:** Next: P-176 pass/fail + flaky. Keep both backends returning identical `BuildResult`/`TestResult` — every downstream consumer (agent, UI, pipeline) must not care which ran. Document GH fallback latency expectations.

---




### P-176: Sandbox - Pass/Fail + Flaky Detection

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-175

**Context:** A single green run isn't proof; flaky tests (P-267) or network hiccups can cause false positives/false negatives. This phase implements the verdict logic on top of `BuildResult`/`TestResult`: a `pass`/`fail` verdict with a repeat-run flaky check that re-runs failed (or all) tests a bounded number of times and reports `flaky:true` when results are unstable, so the agent/pipeline doesn't loop forever on noise.

**Files to Create/Modify:**
- `packages/core/src/sandbox/verdict.ts` (new — `assessVerdict`, `checkFlaky`)
- `packages/core/src/sandbox/verdict.test.ts` (new)
- `packages/core/src/sandbox/runner.ts` (call verdict after run)

**Implementation Steps:**
1. Implement `assessVerdict(run: BuildResult | TestResult, threshold?: { repeat: number }): Verdict`:
   ```ts
   export interface Verdict { pass: boolean; flaky: boolean; attempts: { exitCode: number; pass: boolean }[]; stableSince: 'first' | 'last' | 'none' }
   ```
   - Base `pass` from the run.
2. Implement `checkFlaky(ecosystem, repoPath, kind, opts, client): Promise<Result<Verdict, StitchError>>`:
   - If base run passed → re-run once (`repeat=1`) to confirm stability (cheap) — mark `flaky` if it flips.
   - If base run failed → re-run the failing tests up to `opts.repeat` (default 2); if any attempt passes → `flaky:true`, `pass:false` (still not safe to declare success), `stableSince:'last'` if last passed.
   - Compare captured logs (P-173) across attempts to detect timing-dependent tests.
3. Wire `runVerification` to always run `checkFlaky` (off by default via `config.sandbox.flakyCheck` default `false`; `true` enables it) and attach the `Verdict` to the result.
4. Expose `flakySameFileSeen` heuristics — when a test file fails intermittently, add a `warning` to the result for UI (P-220).
5. Export `assessVerdict`, `checkFlaky`, `Verdict` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker or GH backend (re-runs via `runVerification`).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `assessVerdict` yields `pass:true/false` from exit code
- [ ] Passing base with flip on re-run → `flaky:true`
- [ ] Failing base that passes on retry → `flaky:true, pass:false`
- [ ] `repeat` bounds re-runs; flaky disabled by default
- [ ] Logs compared across attempts for timing heuristics
- [ ] Warning surfaced when same file intermittently fails

**Tests Required:** `verdict.test.ts` (fake runner with scripted outcomes):
- `it('passes cleanly')`, `it('flags flaky on flip')`, `it('retries failing')`, `it('bounds repeats')`, `it('disabled by default')`, `it('warns on flaky file')`

**Dependencies:** P-175 (backend dispatch to re-run). 

**Handoff Notes:** Next: P-177 cleanup. `Verdict.flaky` is what the agent loop (P-155) and pipeline (P-238) read to decide whether to stop retrying; keep `repeat` small (1–3) to bound cost/latency.

---




### P-177: Sandbox - Cleanup

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-176

**Context:** Every container, image, volume, and temp dir created during a run must be reliably removed — leaks accumulate and waste disk/security surface. This phase implements deterministic cleanup: force-remove containers/images/networks/volumes created by the sandbox, prune the ephemeral tag (P-169), clear temp dirs, and always run on success/failure/abort via a `finally`-style guarantee.

**Files to Create/Modify:**
- `packages/core/src/sandbox/cleanup.ts` (new — `cleanupSandbox`, `CleanupTracker`)
- `packages/core/src/sandbox/cleanup.test.ts` (new)
- `packages/core/src/sandbox/runner.ts` (wrap run in try/finally + tracker)

**Implementation Steps:**
1. Implement `class CleanupTracker`:
   - `track({ kind: 'container'|'image'|'volume'|'network'|'tempDir', id })`.
   - `cleanup(client): Promise<void[]>` — force-remove each tracked resource (`client.rm(id, force)`, `image remove`, volume/network remove, `fs.rm(tempDir, recursive)`), collecting any errors (degrade to warning, never throw).
2. Implement `cleanupSandbox(client, tracker, opts): Promise<void>`:
   - Remove all tracked containers (kill+rm force), then tracked images (prune only those with the `stitch-ephemeral-` tag), volumes, networks.
   - Remove the temp workspace dir(s) recorded by the runner.
   - If `config.sandbox.pruneImages` (default `false`), optionally `client.pruneImages()` — kept conservative to avoid nuking cached dev images.
3. Wire into `runner.ts`: create a `CleanupTracker` per run; `try { ...run } finally { await cleanupSandbox(...) }` so success, failure, and abort all clean up.
4. Log cleanup summary (removed N, errors M) to the audit log (P-145) + tracing (P-248) for visibility.
5. Export `CleanupTracker`, `cleanupSandbox` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker cleanup APIs.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `track` accumulates resources; `cleanup` force-removes all
- [ ] Ephemeral-tagged images pruned; non-ephemeral preserved (unless `pruneImages`)
- [ ] Temp dirs removed recursively
- [ ] Always runs in `finally` (on success, failure, abort)
- [ ] Cleanup errors degrade to warnings (don't throw/abort the run)
- [ ] Summary logged

**Tests Required:** `cleanup.test.ts` (fake client tracking removals):
- `it('removes tracked containers')`, `it('prunes ephemeral images only')`, `it('removes temp dirs')`, `it('runs in finally on failure')`, `it('degrades errors to warnings')`, `it('logs summary')`

**Dependencies:** P-176 (verdict path must cleanup too). 

**Handoff Notes:** This completes the Sandbox epic (P-168–P-177). Next: P-178 layer cache + P-179 secret-safe sandbox + P-180 tests. Cleanup is non-negotiable for the sandbox's safety story — the `finally` guarantee is the contract every runner path must preserve.

---




### P-178: Sandbox - Layer Cache

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-177

**Context:** Pulling/base images and re-installing deps on every run is slow and wasteful. Layer caching reuses already-pulled image layers and caches the install step so repeat runs for the same `ecosystem|lockfile-hash` skip network and reinstall. This phase adds a cache keyed on the stage content + ecosystem, stored in `bun:sqlite` and Docker's layer cache, with invalidation when the manifest/lockfile changes.

**Files to Create/Modify:**
- `packages/core/src/sandbox/cache.ts` (new — `SandboxCache`, `cacheKey`, `restoreCache`, `saveCache`)
- `packages/core/src/sandbox/cache.test.ts` (new)
- `packages/core/src/sandbox/install.ts` (use cache)
- `packages/core/src/sandbox/runner.ts` (attach cache to run)

**Implementation Steps:**
1. Implement `cacheKey(ecosystem, repoPath, { includeLock, includeFiles? }): Promise<string>`:
   - Hash (`sha256`) of the ecosystem lockfile + manifest + optionally a shortlist of staged source file hashes (P-186 checksum helper). `includeFiles` gated by config (`sandbox.cacheKeyFullTree`, default `false`) to bound cost.
2. Implement `class SandboxCache` (SQLite `sandbox_cache` table: `cache_key TEXT PK, kind, created_at, meta JSON`):
   - `get(ecosystem, repoPath): Promise<{ hit: boolean; cacheKey: string; imageTag?: string }>` — checks for an install marker for `cacheKey`.
   - `put(ecosystem, repoPath, { imageTag }): Promise<void>` — records the cache entry with the Docker image layer tag used (P-169).
3. Wire into `install.ts`: compute `cacheKey`; if `get` hits → reuse the cached installed image tag (skip `cargo/pip/npm install`), if miss → install + `put`.
4. Invalidate on content change automatically (key includes lockfile hash). Provide `sandbox cache clear` (CLI, later P-190) to force eviction.
5. Log cache hit/miss to tracing (P-248) for perf visibility.
6. Export `SandboxCache`, `cacheKey` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** Docker (image layers) + registry (first pull only).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `cacheKey` stable for same content, changes when lockfile/manifest changes
- [ ] Install-hit reuses cached image, skipping reinstall
- [ ] Install-miss installs then records cache entry
- [ ] Key includes lockfile hash; `includeFiles` gated
- [ ] Cache evictable via CLI
- [ ] Hit/miss logged for tracing

**Tests Required:** `cache.test.ts`:
- `it('computes stable key')`, `it('changes key on lockfile change')`, `it('hit skips install')`, `it('miss installs and records')`, `it('evicts via clear')`, `it('logs hit/miss')`

**Dependencies:** P-177 (cleanup won't evict cached layers). 

**Handoff Notes:** Next: P-179 secret-safe sandbox. Caching the install layer is safe (no secrets), but ensure the image never persists env keys — P-179 guards that. Keep `cacheKey` files-only by default to avoid re-running on unrelated source churn.

---




### P-179: Sandbox - Secret-Safe Sandbox

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-178

**Context:** Sandboxed code (merged from untrusted repos) must never see host secrets (API keys, tokens) nor have secrets leaked into logs, images, or artifacts. This phase enforces secret-safety: never bind-mount host secrets into the container, scrub any secret accidentally appearing in captured logs/artifacts, and disallow `--env` passthrough of sensitive vars unless explicitly gated.

**Files to Create/Modify:**
- `packages/core/src/sandbox/secrets.ts` (new — `isSecretKey`, `scrubSecrets`, `safeEnv`)
- `packages/core/src/sandbox/secrets.test.ts` (new)
- `packages/core/src/sandbox/client.ts` (apply safeEnv + scrub)
- `packages/core/src/sandbox/capture.ts` (scrub captured logs)

**Implementation Steps:**
1. Implement `isSecretKey(name): boolean` — matches `/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|API_TOKEN|AUTH|CREDENTIAL|PRIVATE)/i` (and `*_KEY`).
2. Implement `safeEnv(rawEnv: Record<string,string>, policy: 'block'|'mask'|'allow-list'): Record<string,string>`:
   - `block` (default): strip all secret-keyed vars from container env.
   - `mask`: pass through, but in logs replace value with `****`.
   - `allow-list`: only pass keys explicitly in `config.sandbox.allowedEnv`.
3. Implement `scrubSecrets(text, knownKeys=[]): string` — replace occurrences of any in-scope secret values with `[REDACTED]` (using the logger's redact list, P-010); applied to captured logs (P-173) and gathered artifacts metadata.
4. Wire into `client.run`: apply `safeEnv` to `spec.env` before start; `capture` scrubs each log line. Artifacts are not scanned (only metadata) by default (bounded); note a `SecretScanWarning` if a suspected secret appears in artifact *names* — full content scan is opt-in (`sandbox.secretScanArtifacts`).
5. Never pass host `env` wholesale to containers; always via `safeEnv`.
6. Export `isSecretKey`, `safeEnv`, `scrubSecrets` from `sandbox/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local policy + redaction.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `safeEnv('block')` strips all secret-keyed vars
- [ ] `safeEnv('mask')` masks values in logs
- [ ] `safeEnv('allow-list')` passes only allowed keys
- [ ] `scrubSecrets` replaces secret values with `[REDACTED]` in log text
- [ ] `client.run` applies `safeEnv` and `capture` scrubs
- [ ] Host env never passed wholesale
- [ ] Secret-scan warning on suspicious artifact name

**Tests Required:** `secrets.test.ts`:
- `it('blocks secret keys')`, `it('masks values')`, `it('allow-lists keys')`, `it('scrubs log text')`, `it('never passes host env wholesale')`, `it('warns on suspicious artifact name')`

**Dependencies:** P-178 (cached images must stay clean). 

**Handoff Notes:** Next: P-180 sandbox tests. Secret-safety is a core security guarantee (aligns SECURITY.md) — keep `block` as default; document allow-list escape hatch in config ref P-275.

---




### P-180: Sandbox - Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-179

**Context:** The Sandbox epic (P-168–P-179) touches Docker, which is often unavailable in CI. This phase consolidates sandbox tests behind fakes (fake dockerode, fake Octokit) plus a Docker-gated integration suite, adds a coverage gate, and verifies the full sequence: availability → image → install → build → test → capture → limits → fallback → verdict → cleanup → cache → secrets — all offline-capable.

**Files to Create/Modify:**
- `packages/core/src/sandbox/__tests__/fake-docker.ts` (new — shared fake client)
- `packages/core/src/sandbox/__tests__/sandbox.unit.test.ts` (new)
- `packages/core/src/sandbox/__tests__/sandbox.docker.test.ts` (new — `test.skipIf(!DOCKER)` integration)
- `packages/core/package.json` (add `"test:sandbox"`)

**Implementation Steps:**
1. Build `fake-docker.ts`: a `FakeDockerode` implementing `ping/create/start/logs/wait/remove/kill/copyFrom` with scripted behaviors (exit codes, log lines, failures), OR a lightweight in-memory runner to avoid a real container in unit tests.
2. Write `sandbox.unit.test.ts` covering every module without Docker:
   - client (availability/pull/run/timeout/abort), images (pull/build/cache), install (per-eco), build (pass/fail/infra), test (parse), capture (bounded), limits, cache (SQLite), secrets, verdict, cleanup, fallback (fake Octokit).
3. Write `sandbox.docker.test.ts` gated by `describe.skipIf(!process.env.DOCKER)` running a real tiny container (e.g. `node:22-alpine` `echo`) validating actual daemon interaction; skipped in CI without Docker.
4. Add `test:sandbox`: `bun test src/sandbox --coverage` with ≥80% line / 70% branch gate.
5. Ensure every unit test uses fakes (no network); a real Docker integration run is opt-in.
6. Run `bun test src/sandbox --coverage`; fix gaps surfaced.

**Required MCPs/Connectors:** Docker only for the opt-in integration; otherwise none.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `FakeDockerode` supports scripted behaviors for all client ops
- [ ] Unit suite covers every sandbox module with zero network/Docker
- [ ] Docker suite is `skipIf` gated (works offline)
- [ ] `test:sandbox` passes the coverage gate
- [ ] Fallback uses fake Octokit
- [ ] Cache tested in-memory/SQLite temp

**Tests Required:** `sandbox.unit.test.ts` + `sandbox.docker.test.ts`:
- `it('runs full sandbox flow with fake')`, `it('covers each module')`, `it('docker integration (gated)')`, `it('coverage gate')`

**Dependencies:** P-179 (secrets in sanitized run). 

**Handoff Notes:** Next: P-181 begins Provenance (source repo/commit/author per file). The fake-docker harness is reused by agent E2E (P-167) and pipeline tests; keep it stable and documented.

---




### P-181: Provenance - Track Source Repo/Commit/Author per File

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-180

**Context:** Every file in child repo C must be traceable to its origin: the source repo (A/B), the exact source commit, and the original author. This is the moral and legal core of provenance (attribution, SBOM, CREDITS, re-licensing). This phase builds the `ProvenanceMap`: for each staged file, record `{ repo, remoteUrl, sourceCommit, sourcePath, sourceAuthor, copiedAt, stitchedBy }`, sourced from git blame/log (P-079/P-077) at merge time.

**Files to Create/Modify:**
- `packages/core/src/provenance/map.ts` (new — `buildProvenanceMap`, `ProvenanceMap`, `FileOrigin`)
- `packages/core/src/provenance/map.test.ts` (new)
- `packages/core/src/provenance/index.ts` (barrel)
- `packages/core/src/agent/gitFacade.ts` (emit origin at commit, P-165)

**Implementation Steps:**
1. Define `FileOrigin`:
   ```ts
   export interface FileOrigin { file: string /* relative path in C */; repo: 'A'|'B'; remoteUrl?: string; sourceCommit: string; sourcePath: string; sourceAuthor?: string; sourceEmail?: string; copiedAt: string; stitchedBy: 'agent'|'manual' }
   ```
2. Implement `buildProvenanceMap(ctx, mergedFiles: MergeManifest): Promise<Result<ProvenanceMap, StitchError>>`:
   - For each staged file, use the `Stitch-Origin` trailer/commit metadata captured during merge (P-165) + git `blame`/`log` (P-079) to determine `sourceCommit`/`sourceAuthor`/`sourcePath`.
   - When a file came unchanged from A, attribute to A's commit; when merged/edited by the agent, note `stitchedBy:'agent'` and the source commit it derived from.
   - Handle removed-by-teleport (P-070 filter-repo) mapping back to the original A path.
3. Store the map in-memory for the session + persist to `bun:sqlite` (`provenance` table) so CREDITS (P-182), SBOM (P-183), and the UI (P-185) read one source.
4. Add a `getOrigin(file): FileOrigin | undefined` lookup used by web file tooltip (P-185) and license per-file (P-124).
5. Resolve ambiguity by logging a warning when a file can't be attributed (falls back to `stitchedBy:'manual'` + `repo:'unknown'`) — surfaced in P-182 CREDITS as "unattributed".
6. Export `buildProvenanceMap`, `FileOrigin`, `ProvenanceMap` from `provenance/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local git (simple-git/git-filter-repo).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Each staged file gets a `FileOrigin` with source commit + author
- [ ] Unchanged-from-A files attributed to A with original path
- [ ] Agent-edited files marked `stitchedBy:'agent'` with source derivation
- [ ] Unattributable files logged + flagged
- [ ] Map persisted in SQLite; `getOrigin` works
- [ ] `sourceCommit` is the real A/B commit (verified via git)

**Tests Required:** `map.test.ts` (two fixture git repos merged):
- `it('attributes A file to A commit')`, `it('marks agent edits')`, `it('maps teleported path')`, `it('flags unattributed')`, `it('persists and queries')`

**Dependencies:** P-180 (sandbox tests close). Git core P-070/P-076/P-079.

**Handoff Notes:** Next: P-182 CREDITS.md. The ProvenanceMap is the single source for attribution everywhere — build it early and keep `getOrigin` the query path. Guard email/PII: store `sourceEmail` only if configured (P-009 `provenance.recordEmail`).

---




### P-182: Provenance - CREDITS.md

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-181

**Context:** A human- and audit-readable `CREDITS.md` in child repo C credits every upstream contributor and source repo, satisfying attribution and giving newcomers context. This phase generates `CREDITS.md` from the `ProvenanceMap` (P-181): grouped by source repo, listing files, commits, and authors, with an attribution fallback for unattributed files.

**Files to Create/Modify:**
- `packages/core/src/provenance/credits.ts` (new — `generateCredits`, `CreditsOptions`)
- `packages/core/src/provenance/credits.test.ts` (new)
- `packages/core/src/license/notice.ts` (optionally reference CREDITS)

**Implementation Steps:**
1. Define `CreditsOptions`: `{ repoNameA?: string; repoNameB?: string; includeEmails?: boolean; header?: string }`.
2. Implement `generateCredits(map: ProvenanceMap, opts): Promise<Result<string, StitchError>>`:
   - Group origins by `repo` then by `remoteUrl`; within each group list `sourcePath` files with their `sourceCommit` (short hash) and author (`name`; email only if `includeEmails`).
   - Render a deterministic Markdown doc:
     - Title + generated timestamp + C description.
     - Per-source-repo section: `## <repo>` with repo URL, and a table `| File in C | Source commit | Author |`.
     - An `## Unattributed` section for `stitchedBy:'manual'`/`repo:'unknown'` files.
     - A `## Notes` section listing any agent-stitched files (transparency).
   - Sort by repo then file path for stable output.
3. Write to `<repoC>/CREDITS.md` via `fs-extra.outputFile`; return the content string too (for P-185 preview + P-222 web).
4. Validate no secrets/PII unless `includeEmails`; strip `sourceEmail` default.
5. Export `generateCredits`, `CreditsOptions` from `provenance/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — renders from local provenance map.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Renders deterministic, grouped-by-repo CREDITS with file/sourceCommit/author table
- [ ] Emails included only when `includeEmails`
- [ ] Unattributed files in a dedicated section
- [ ] Agent-stitched files listed in Notes
- [ ] Output stable across runs (same map → same text)
- [ ] Written to `<repoC>/CREDITS.md` and returned as string

**Tests Required:** `credits.test.ts`:
- `it('renders grouped credits')`, `it('omits emails by default')`, `it('adds unattributed section')`, `it('writes and returns content')`, `it('stable output')`

**Dependencies:** P-181 (map source). 

**Handoff Notes:** Next: P-183 SBOM. CREDITS is the human read; SBOM (P-183) is the machine/legal one. Keep table columns stable — web P-222 CREDITS preview and CI checks parse it.

---




### P-183: Provenance - SBOM (CycloneDX/SPDX)

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-182

**Context:** Regulatory and supply-chain tooling expects a machine-readable Software Bill of Materials. This phase generates an SBOM for the composed app containing both direct/transitive deps (from the deps merge, P-108/P-116) and the source-file provenance (P-181), in CycloneDX JSON (primary) and SPDX (optional), so the merged app carries verifiable component metadata.

**Files to Create/Modify:**
- `packages/core/src/provenance/sbom.ts` (new — `generateSbom`, `SbomFormat`)
- `packages/core/src/provenance/sbom.test.ts` (new)
- `packages/core/src/provenance/types.ts`

**Implementation Steps:**
1. Implement `generateSbom({ deps: DependencyReport, provenance: ProvenanceMap, metadata: { name; version; ecosystem } }, opts { format: 'cyclonedx'|'spdx'|'both' }): Promise<Result<string, StitchError>>`:
   - **CycloneDX (JSON)**: populate `components` (one per direct/transitive dep — name, version, `purl`, `licenses` from P-128) plus `components` entries or `properties` for `FileOrigin`s (as `source-repo`, `source-commit`).
   - **SPDX (tag-value/JSON)**: `packages` list with `SPDXID`, `versionInfo`, `licenseConcluded` from policy, `externalRefs` purl; provenance files as `files` with `artifactOf` attribution.
2. Use the ecosystem `purl` (P-115 parser has ecosystem; build purl from name/version/eco).
3. Map the P-128 `LicenseReportData` verdict into `licenseConcluded`/`licenseDeclared` per component.
4. Write to `<repoC>/sbom.cyclonedx.json` (and/or `.spdx.json`); include a `created` timestamp + `tool` = repo-stitcher + version.
5. Validate output against a minimal JSON schema; return `err('SBOM_INVALID')` if malformed.
6. Export `generateSbom`, `SbomFormat` from `provenance/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local assembly from deps + provenance.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] CycloneDX JSON lists each dep with purl + license; provenance files included
- [ ] SPDX lists packages with SPDXID/versionInfo/licenseConcluded
- [ ] purl built from name/version/eco
- [ ] `licenseConcluded` reflects policy verdict
- [ ] Written to `<repoC>/sbom.cyclonedx.json` + optional SPDX
- [ ] Validates against schema; `SBOM_INVALID` on malformed

**Tests Required:** `sbom.test.ts` (fixture dep report + provenance):
- `it('builds cyclonedx with deps+licenses')`, `it('builds spdx packages')`, `it('forms purls')`, `it('maps license verdict')`, `it('validates schema')`

**Dependencies:** P-182 (CREDITS done). Deps P-108/P-116/P-128.

**Handoff Notes:** Next: P-184 git notes. SBOM is consumed by compliance export (P-307) and web P-220; keep CycloneDX primary (broader tooling support), SPDX optional.

---




### P-184: Provenance - Git Notes

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-183

**Context:** Provenance should ride along in git itself, not only scratch storage. `git notes` attach a structured provenance blob to each commit in C without rewriting history — the canonical, reviewable provenance record that travels with the repo. This phase writes a `stitch-prov` git note on the merge commit containing the `ProvenanceMap`/SBOM reference.

**Files to Create/Modify:**
- `packages/core/src/provenance/gitnotes.ts` (new — `writeGitNotes`, `readGitNotes`)
- `packages/core/src/provenance/gitnotes.test.ts` (new)
- `packages/core/src/provenance/map.ts` (attach note on finalize)

**Implementation Steps:**
1. Implement `writeGitNotes(repoPath, commitRef, noteObj: Record<string,unknown>, opts { namespace?: string }): Promise<Result<string, StitchError>>`:
   - Namespace `refs/notes/stitch-prov` (configurable).
   - `git notes --ref=<ns> add -m <json> <commit>` via simple-git raw (P-016); if a note already exists, `append`/merge JSON fragments.
   - Content: `{ schemaVersion, provenanceRef: <sbomFilename>, mapChecksum: sha256(map), generatedAt, statistics: { files, repos } }` (keep the full map as a file, note references it — keeps notes small).
2. Implement `readGitNotes(repoPath, commitRef, ns?): Promise<Result<Record<string,unknown>|undefined, StitchError>>`:
   - `git notes --ref=<ns> show <commit>`; parse JSON; return `undefined` if no note (not an error).
3. Wire into `map.ts` finalize / pipeline: after building the map + writing SBOM, call `writeGitNotes` on the merge commit; on failure, warn (non-blocking but surfaced in P-184 UI/audit).
4. Provide `fetchAllProvenanceNotes(repoPath)` to enumerate notes for audits (P-187).
5. Export `writeGitNotes`, `readGitNotes` from `provenance/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local git notes.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `writeGitNotes` attaches a JSON note under the configured namespace
- [ ] Appending to an existing note merges fragments without loss
- [ ] `readGitNotes` parses JSON or returns `undefined` (no note)
- [ ] Note references the SBOM + map checksum (small note)
- [ ] Failure to write warns (non-blocking) — surfaced
- [ ] Notes readable via git tooling

**Tests Required:** `gitnotes.test.ts` (temp git repo):
- `it('writes a note')`, `it('appends to existing')`, `it('reads note json')`, `it('returns undefined when absent')`, `it('warns on failure')`

**Dependencies:** P-183 (SBOM ref). Git core.

**Handoff Notes:** Next: P-185 UI provenance view. Notes are the durable transport; keep them small (reference, not inline map). Document `refs/notes/stitch-prov` in ARCHITECTURE.

---




### P-185: Provenance - UI Provenance View

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-184

**Context:** Users must be able to inspect where every file came from without leaving the app. This phase exposes the provenance map to the web UI and CLI: a per-file origin lookup (tooltip/panel) and a full provenance explorer screen, served via the CLI's Elysia server (P-193) as a read-only endpoint. The UI renders it; this phase defines the data contract + endpoint.

**Files to Create/Modify:**
- `packages/core/src/provenance/api.ts` (new — `provenanceRoutes`, `serializeProvenanceMap`)
- `packages/core/src/provenance/api.test.ts` (new)
- (later web P-221/P-229 render it) — this phase produces the contract + route handlers.

**Implementation Steps:**
1. Implement `serializeProvenanceMap(map)` → a plain-JSON form for transport: `{ files: FileOrigin[], stats: { total, byRepo: Record<string,number>, agentEdited: number, unattributed: number } }`.
2. Implement `provenanceRoutes(ctx, { getMap }): Elysia.Routes` registering:
   - `GET /api/provenance` → full map.
   - `GET /api/provenance/file` (query `path`) → `getOrigin(path)` for the file panel.
   - `GET /api/credits` → the generated CREDITS.md content (P-182).
3. `FileOrigin` omits `sourceEmail` unless config says include (privacy, P-181).
4. Wire into the CLI server (P-193) so web can fetch; add the contract types to `packages/shared` (P-315 later) — for now define in core and re-export.
5. Add acceptance for the endpoint returning 404 on unknown path and 200 with the origin.
6. Export `provenanceRoutes`, `serializeProvenanceMap` from `provenance/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — served over the CLI Elysia HTTP/WS.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `serializeProvenanceMap` yields plain JSON with stats
- [ ] `/api/provenance` returns the full map
- [ ] `/api/provenance/file?path=` returns the origin for an existing path, `404` for unknown
- [ ] `/api/credits` returns the CREDITS content
- [ ] Email hidden unless configured
- [ ] Contract types exported for web import

**Tests Required:** `api.test.ts` (route handler with fake ctx/getMap):
- `it('serves full map')`, `it('serves file origin')`, `it('404s unknown file')`, `it('serves credits')`, `it('hides email by default')`

**Dependencies:** P-184 (git notes durable record). 

**Handoff Notes:** Next: P-186 checksum manifest. The API contract here is what web P-221/229 consume — keep JSON field names stable and document in ARCHITECTURE/shared types.

---




### P-186: Provenance - Checksum Manifest

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-185

**Context:** To prove later that C's files are exactly what was composed (integrity, tamper-evidence, release auditing), a checksum manifest records the SHA-256 of every staged file at completion. This phase generates and persists that manifest, and exposes a `verifyChecksums` to detect drift.

**Files to Create/Modify:**
- `packages/core/src/provenance/checksums.ts` (new — `buildChecksumManifest`, `verifyChecksums`)
- `packages/core/src/provenance/checksums.test.ts` (new)
- `packages/core/src/provenance/map.ts` (attach checksum manifest path)

**Implementation Steps:**
1. Implement `buildChecksumManifest(repoPath, opts): Promise<Result<ChecksumManifest, StitchError>>`:
   ```ts
   export interface ChecksumEntry { path: string; sha256: string; sizeBytes: number }
   export interface ChecksumManifest { generatedAt: string; algorithm: 'sha256'; entries: ChecksumEntry[]; manifestSha256: string }
   ```
   - Walk staged files (respect `opts.ignore` globs: `.git`, `node_modules`, `dist`, generated) via a streaming `createHash`.
   - Sort entries by path; compute `manifestSha256` over the sorted JSON.
   - Write `<repoC>/checksums.sha256` in a stable format.
2. Implement `verifyChecksums(repoPath, manifest): Promise<Result<{ valid: boolean; mismatches: string[] }, StitchError>>`:
   - Re-hash each entry's file; return mismatched paths; `valid=false` on any mismatch or missing file.
3. Chain into finalization: after merge + build success, `buildChecksumManifest`; reference its `manifestSha256` in the git note (P-184) and SBOM (P-183).
4. Parallelize hashing with bounded concurrency (`p-limit`, P-031) for large repos; bound memory (stream, not `readFile` whole).
5. Export `buildChecksumManifest`, `verifyChecksums`, `ChecksumManifest` from `provenance/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local fs hashing.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Manifest lists sha256+size per staged file, sorted, streamed
- [ ] `manifestSha256` stable over the same tree
- [ ] Writes `<repoC>/checksums.sha256` in stable format
- [ ] `verifyChecksums` returns mismatches; `valid=false` on drift/missing
- [ ] Ignore globs respected
- [ ] Bounded memory, concurrency-limited

**Tests Required:** `checksums.test.ts` (temp tree):
- `it('builds sorted manifest')`, `it('stable manifest sha')`, `it('writes file')`, `it('verifies clean')`, `it('detects tampered file')`, `it('respects ignore globs')`

**Dependencies:** P-185 (API contract stable). 

**Handoff Notes:** Next: P-187 audit log. The checksum manifest is the tamper-evidence anchor — store it alongside CREDITS/SBOM and reference in both the git note (P-184) and release checklist (P-318).

---




### P-187: Provenance - Audit Log

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-186

**Context:** A complete, append-only audit trail of every stitch action (who/what/when, source repos, commits, verifications, license verdicts, checksums) is required for trust + compliance. This phase implements the provenance audit log (distinct from AI-call audit P-145): an append-only `bun:sqlite` record of pipeline events, exposed for review and export (ties to P-307 compliance export).

**Files to Create/Modify:**
- `packages/core/src/provenance/audit.ts` (new — `ProvenanceAudit`, `AuditRecord`)
- `packages/core/src/provenance/audit.test.ts` (new)
- `packages/core/src/orchestration/pipeline.ts` (emit audit events — later hook)

**Implementation Steps:**
1. Define `AuditRecord`:
   ```ts
   export type AuditAction = 'init'|'clone'|'merge'|'resolve_conflict'|'install'|'build'|'test'|'license_verdict'|'sbom'|'checksum'|'git_notes'|'commit'|'push'|'approve'|'reject'|'rollback'|'publish'
   export interface AuditRecord { id: string; ts: string; action: AuditAction; actor: string; jobId?: string; detail: Record<string,unknown>; ok: boolean }
   ```
2. Implement `class ProvenanceAudit` (SQLite `provenance_audit` table, append-only):
   - `append(rec)` — insert; never update/delete (append-only). Assign `id` (uuid) + `ts`.
   - `query({ action?, since?, jobId?, actor?, limit? }): Promise<AuditRecord[]>`.
   - `exportJson(): Promise<string>` — full dump for compliance (P-307) / debugging (P-248).
3. `detail` values are sanitized (no secrets — reuse logger.redact/scrub P-179) before store.
4. Wire the key pipeline hooks (clone, merge, result of build/test, license_verdict, sbom, checksum, git_notes, commit, push, approve/reject) — the orchestration pipeline (P-238) calls `audit.append`; agent HIL approvals/rejects (P-160) also record.
5. Provide `fullAudit(): Promise<AuditRecord[]>` for the web audit view and CLI `stitch audit` (P-187 later — CLI command in P-196 area).
6. Export `ProvenanceAudit`, `AuditRecord`, `AuditAction` from `provenance/index.ts`; `bun run typecheck`.

**Required MCPs/Connectors:** None — local SQLite.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `append` writes append-only rows (no update/delete)
- [ ] `query` filters by action/since/jobId/actor
- [ ] `detail` sanitized (no secrets)
- [ ] Key pipeline actions recorded
- [ ] HIL approvals/rejects recorded
- [ ] `exportJson` produces a compliance-ready dump; `fullAudit` enumerates

**Tests Required:** `audit.test.ts` (temp SQLite):
- `it('appends records')`, `it('is append only')`, `it('queries filters')`, `it('sanitizes details')`, `it('records approvals')`, `it('exports json')`

**Dependencies:** P-186 (checksum anchored). 

**Handoff Notes:** Next: P-188 provenance tests. This audit is the backbone of compliance export (P-307) and the release checklist (P-318); keep the schema append-only and `detail` generic (JSON) so new actions need no migration.

---




### P-188: Provenance - Tests

**Owner:** inbesat | **Wave:** 1 | **Depends On:** P-187

**Context:** Provenance is the trust layer (attribution, SBOM, checksums, audit) — a bug here undermines the whole compliance story. This phase consolidates provenance (P-181–P-187) into a comprehensive test suite with fixture repos, verifies end-to-end attribution through merge→map→CREDITS→SBOM→git-notes→checksums→audit, and adds a coverage gate.

**Files to Create/Modify:**
- `packages/core/src/provenance/__tests__/provenance.suite.test.ts` (new)
- `packages/core/src/provenance/__tests__/fixtures/` (two committed tiny JS repos A/B)
- `packages/core/package.json` (add `"test:provenance"`)

**Implementation Steps:**
1. Create fixture repos A/B (committed, with known authors/commits via `git` at fixture-build time, or committed with fixed IDs).
2. Write `provenance.suite.test.ts` running the full chain in a temp git working tree:
   - Clone/merge A+B via git-core (P-072/P-076) capturing commit metadata.
   - `buildProvenanceMap` → assert every staged file has `FileOrigin` with the right repo/commit/author.
   - `generateCredits` → assert output groups by repo and lists files/commits.
   - `generateSbom` → parse CycloneDX, assert deps + purl + provenance entries.
   - `writeGitNotes` + `readGitNotes` → round-trip the provenance reference.
   - `buildChecksumManifest` + tamper a file → `verifyChecksums` reports it.
   - `ProvenanceAudit` → append + query a representative action set.
3. Scenario assertions:
   - Attribution is deterministic across two runs (same map).
   - SBOM license `licenseConcluded` matches the policy verdict for a fixture.
   - Checksum drift on perturbation detected.
   - Audit append-only (update attempt rejected).
4. Add `test:provenance`: `bun test src/provenance --coverage` with ≥80% line / 70% branch gate.
5. Run the suite; fix cross-module issues (this validates P-181–P-187 wire together).

**Required MCPs/Connectors:** None — local git + fs + sqlite.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Full chain (merge→map→credits→sbom→notes→checksums→audit) runs end-to-end on fixtures
- [ ] Attribution deterministic across runs
- [ ] SBOM license matches policy verdict
- [ ] Tampered file detected by checksum verify
- [ ] Audit is append-only
- [ ] `test:provenance` passes coverage gate

**Tests Required:** `provenance.suite.test.ts`:
- `it('attribution full chain')`, `it('deterministic map')`, `it('sbom license matches verdict')`, `it('detects tampering')`, `it('audit append only')`

**Dependencies:** P-187 (audit tail). Full Provenance epic ready.

**Handoff Notes:** This completes the Provenance epic (P-181–P-188). Next: P-189 begins CLI. Keep the fixture repos committed/deterministic — they're also reused by CLI `stitch add/merge` integration tests (P-204).

---




### P-189: CLI - Commander + Global Options

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-188

**Context:** The `stitch` CLI is the primary interface. This phase sets up the Commander entrypoint (P-041) with global options (verbose, config path, yes/assume-yes, offline, cwd, token), the help/version metadata, and the subcommand registry that the rest of the CLI epic (P-190–P-207) fills in. It establishes error-handling + exit-code conventions shared by every command.

**Files to Create/Modify:**
- `packages/cli/src/index.ts` (new — entrypoint)
- `packages/cli/src/cli.ts` (new — `buildCLI(program)` + global opts)
- `packages/cli/src/globals.ts` (new — parsed global options shape)
- `packages/cli/src/index.test.ts` (new)
- `packages/cli/package.json` (bin `stitch` → `src/index.ts`)

**Implementation Steps:**
1. Configure the `Commander` program in `cli.ts`:
   - `name: 'stitch'`, `description`, `version` read from package.json.
   - Global options (on the root, inherited):
     - `-V, --verbose` (increase log verbosity)
     - `-c, --config <path>` (override config file, P-200)
     - `-y, --yes` (assume yes for prompts, P-156/HIL non-interactive)
     - `--offline` (no network; sandbox/P-146 respect it)
     - `-C, --cwd <dir>` (working dir override, P-205)
     - `--no-color` (theme, P-206)
   - Command list stub: `init`, `add`, `merge`, `serve`, `status`, `doctor`, `license`, `deps`, `audit`, plus later `progress`, etc.
2. Build `parseGlobal(opts)` → typed `GlobalOptions`; attach a `logger` (P-010) and shared error handler.
3. Register a global `program.onCommandNotFound` → friendly message + exit 1.
4. `index.ts` calls `buildCLI().parseAsync(process.argv)` and maps the final `Result` to process exit code: `0` success, `1` known error (printed via `friendlyError` P-163), `2` usage error.
5. `--help`/`--version` work without config (lazy-load heavy modules).
6. Test: `index.test.ts` asserts version, unknown-command exit, global flag parse.

**Required MCPs/Connectors:** None — pure CLI shell; underlying commands wire connectors.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `stitch --version` prints the package version; `--help` lists subcommands
- [ ] Global flags parse into `GlobalOptions`
- [ ] Unknown command → friendly error + exit 1
- [ ] Exit codes: 0 success / 1 known error / 2 usage
- [ ] `-y/--yes` and `--offline` reach command handlers
- [ ] Heavy modules lazily loaded (fast startup)

**Tests Required:** `index.test.ts`:
- `it('prints version')`, `it('lists help')`, `it('unknown command exits 1')`, `it('parses global flags')`, `it('maps exit codes')`

**Dependencies:** P-188 (provenance done; CLI consumes core).

**Handoff Notes:** Next: P-190 `stitch init`. This is the wiring skeleton every CLI command follows (parse globals → resolve config → call core → map exit). Keep `cli.ts` free of business logic.

---




### P-190: CLI - stitch init

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-189

**Context:** `stitch init` scaffolds a new stitch project: creates the config file (`stitch.toml`, P-200), `.env.example`, `.gitignore`, and an optional initial `README` — and by default configures the AI provider (OpenRouter) by prompting for/validating an API key. It's the onboarding door for the whole tool.

**Files to Create/Modify:**
- `packages/cli/src/commands/init.ts` (new)
- `packages/cli/src/commands/init.test.ts` (new)
- `packages/cli/src/templates/stitch.toml`, `templates/.env.example`, `templates/.gitignore` (new template assets)

**Implementation Steps:**
1. Implement `init(opts: GlobalOptions, args): Promise<Result<void, StitchError>>`:
   - Default target dir = `opts.cwd` or `./`; create dir if missing.
   - If `stitch.toml` exists → ask to overwrite (`-y` skips prompt); refuse silently without `--force`.
   - Write `stitch.toml` from template with sensible defaults (P-009 schema: `[ai] provider='openrouter'`, `[sandbox]`, `[licenses]`, `[agent]`).
   - Write `.env.example` listing `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, etc. (no values); write `.gitignore` covering `node_modules`, `.env`, `dist`, `*.db`.
   - If `--provider` given and `--no-key-prompt` not set, prompt for the key (via P-156/Ink, or stdin in `-y`) and validate by a lightweight `GET` style check; on success write a line to `~/.stitch/config` (P-200) without echoing the key (stored encrypted or via env reference).
   - Print a success summary + next steps (`stitch add <repo> <paths>`).
2. Respect `--offline`: skip key validation (only local scaffold).
3. Make templates exact strings (no secrets), committed.
4. Export `init` and register in `cli.ts`.

**Required MCPs/Connectors:** None on init (no AI calls); provider key validation is a config-time HTTP check, skipped offline.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Writes `stitch.toml`, `.env.example`, `.gitignore` fresh in target dir
- [ ] Existing `stitch.toml` prompts; `--force`/`-y` overwrites
- [ ] Provider key validated and stored (not echoed) when not offline
- [ ] Offline skips validation, still scaffolds
- [ ] Success summary printed; exit 0
- [ ] No secrets in written templates

**Tests Required:** `init.test.ts` (temp dir, fake prompt):
- `it('scaffolds files')`, `it('refuses without force on existing')`, `it('validates and stores key')`, `it('offline skips validate')`, `it('prints summary')`

**Dependencies:** P-189 (entrypoint). Config P-200/P-009.

**Handoff Notes:** Next: P-191 `stitch add`. Keep init idempotent and fast; the `.env.example` + `stitch.toml` written here are exactly what P-200 resolves. Never write the raw key to a scaffolded committed file.

---




### P-191: CLI - stitch add <repo> <paths...>

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-190

**Context:** `stitch add <repo> <paths...>` records which repo and which paths/globs the user wants to bring into the child. It resolves the source (local path or GitHub URL), fetches the tree/listing (via git clone P-069 or Octokit P-090), validates the requested paths exist, records the selection (via `select_files` P-148), and stores it in the project config for a later `stitch merge`.

**Files to Create/Modify:**
- `packages/cli/src/commands/add.ts` (new)
- `packages/cli/src/commands/add.test.ts` (new)

**Implementation Steps:**
1. Define args: `add <source> <paths...>` where `source` is a local dir path or `owner/repo` GitHub ref, `paths` are file/glob patterns.
2. Implement `add(opts, args): Promise<Result<void, StitchError>>`:
   - Resolve `source`: if GitHub (`owner/repo`) → `cloneRepo` shallow (P-069) into `~/.stitch/cache/<slug>` (slugified per P-108/P-205 path rules); if local → use directly.
   - `listFiles(source)` (P-103) → expand `paths` (picomatch P-036); if no explicit paths match → `err('NO_PATHS_MATCH')` with suggestions; validate all match (or use `--allow-empty`).
   - Build `FileSelection` (P-148) and append to the project's `sources` config array (P-200 json store); persist.
   - Print the resolved repo + file count + next-step hint.
3. Deduplicate: re-adding same (repo,path) is a no-op warning, not error.
4. Support `--branch`/`--ref` for GitHub to pin the source commit (feeds P-181 provenance).
5. Respect `--offline` (local repos only) and `--cwd`.
6. Export `add` and register.

**Required MCPs/Connectors:** GitHub (clone/tree) via Octokit+simple-git for remote sources; none for local.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Local dir resolves and expands paths/globs to existing files
- [ ] GitHub `owner/repo` cloned (shallow) and paths validated
- [ ] No match → `err('NO_PATHS_MATCH')` unless `--allow-empty`
- [ ] Selection persisted in project config; dedup no-op
- [ ] `--branch` pins source commit
- [ ] Offline restricts to local

**Tests Required:** `add.test.ts` (temp local repo + fake git config):
- `it('adds local paths')`, `it('resolves globs')`, `it('errors on no match')`, `it('dedupes re-add')`, `it('pins branch')`, `it('offline local only')`

**Dependencies:** P-190 (init/config). Git P-069/P-103, selection P-148.

**Handoff Notes:** Next: P-192 `stitch merge`. The `sources` array written here is the input to merge; keep `source`+`paths`+`ref` stable in config for provenance.

---




### P-192: CLI - stitch merge

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-191

**Context:** The core command: `stitch merge` executes the full pipeline — clone/fetch selected sources, run the agent (or reconcile file selection + deps + licenses), build in sandbox, generate provenance, and produce child repo C — streaming progress. It orchestrates the core pipeline (P-238) from the CLI, honoring the human-in-the-loop gates (P-160).

**Files to Create/Modify:**
- `packages/cli/src/commands/merge.ts` (new)
- `packages/cli/src/commands/merge.test.ts` (new)

**Implementation Steps:**
1. Define args: `merge [--out <dir>] [--dry-run] [--yes] [--jobs <n>]`.
2. Implement `merge(opts, args): Promise<Result<void, StitchError>>`:
   - Load project config `sources` (P-200); if empty → `err('NOTHING_TO_STITCH')`.
   - Build the pipeline config (P-243) from options.
   - Drive `runPipeline` (P-238 core) with a progress callback that renders to the CLI (P-199 progress) and wires HIL requests (P-160) to the Ink picker (P-198).
   - On license/`ask` gates: present via Ink (P-198) unless `--yes` (auto-approve auto tools; `--yes` still requires explicit for deny-incompatible, else abort with clear message).
   - On success: write C to `--out` (default `<cwd>/stitch-out`), print path + summary (repo, files, deps, licenses, SBOM, CREDITS).
   - `--dry-run` runs everything through build+verdict without writing C, printing a plan.
   - Map final `Result` to exit code (P-189).
3. Propagate `--offline` → sandbox offline + no AI/registry.
4. Wire progress events (P-162/P-199) to a simple live line renderer (`
` updates) in non-TTY mode.
5. Export `merge` and register.

**Required MCPs/Connectors:** All underlying connectors via core (Git, GitHub, Docker/GH sandbox, AI provider).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Runs the full pipeline with selected sources; writes C on success
- [ ] Progress rendered live; HIL gates surface via Ink (or `--yes` auto-handles auto tools)
- [ ] `--dry-run` builds+verdicts but does not write C
- [ ] `--offline` respected
- [ ] Summary printed; exit codes correct
- [ ] Empty sources → `NOTHING_TO_STITCH`

**Tests Required:** `merge.test.ts` (fake pipeline + fixture sources, `--yes`):
- `it('merges to out dir')`, `it('dry run no write')`, `it('surfaces HIL gates')`, `it('offline mode')`, `it('errors on empty sources')`, `it('exit codes')`

**Dependencies:** P-191 (sources). Core pipeline P-238, HIL P-160, progress P-199.

**Handoff Notes:** Next: P-193 `stitch serve`. This is the highest-complexity CLI command — keep it a thin orchestrator over core; the actual pipeline state machine lives in core P-238.

---




### P-193: CLI - stitch serve (Elysia)

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-192

**Context:** The web UI (P-208+) is a browser client; `stitch serve` starts the local server (Elysia, P-043) that hosts the REST + WebSocket API (provenance P-185, job progress, AI stream P-216, static web build P-235) on `localhost` with the port from config (default 3434). This phase implements the server bootstrap and the WS channel, and serves the built web assets when present.

**Files to Create/Modify:**
- `packages/cli/src/server/app.ts` (new — build Elysia app)
- `packages/cli/src/commands/serve.ts` (new)
- `packages/cli/src/server/ws.ts` (new — WS hub)
- `packages/cli/src/commands/serve.test.ts` (new)

**Implementation Steps:**
1. In `app.ts`, create the Elysia app (`.listen(port)`):
   - Register REST: `/health`, `/api/provenance` (+ file/credits, P-185), `/api/jobs` (P-247), `/api/settings` (P-225), static serving from `packages/web/dist` when it exists (P-235) else a friendly "run web build" HTML.
   - Register WS at `/ws`: `UseWs` (Elysia WS plugin) exposing an event hub — forwards reasoning/progress (P-162), job events (P-241), and HIL requests (P-160) to clients; clients post approvals.
2. In `serve.ts`: `serve(opts)` — validate port free; start; print URL; handle SIGINT (graceful stop, flush audit P-187).
   - `--host` option (default `127.0.0.1`), `--no-web` to skip static.
3. `ws.ts`: a small typed hub `{ publish(topic, msg), subscribe(client) }` used by pipelines and the web client (P-223).
4. CORS: allow `http://localhost:5173` during dev (Vite P-208) via config.
5. Test the server with a real HTTP fetch against ephemeral port; assert `/health` + a WS echo.

**Required MCPs/Connectors:** None direct; HTTP/WS server only. (Separate MCP server is P-299, later.)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `/health` returns ok; `--host`/`--port` honored (default 3434)
- [ ] WS `/ws` forwards published events to subscribed clients
- [ ] Static web served when `dist` exists; friendly fallback otherwise
- [ ] REST routes (/api/*) respond
- [ ] SIGINT gracefully closes server + flushes audit
- [ ] Dev CORS allows Vite origin

**Tests Required:** `serve.test.ts` (ephemeral port + fetch):
- `it('health endpoint')`, `it('ws echo')`, `it('static fallback')`, `it('graceful shutdown')`, `it('cors headers')`

**Dependencies:** P-192 (merge) + core provenance/progress.

**Handoff Notes:** Next: P-194 `stitch status`. `serve` is what powers the whole web surface; the WS hub here is the transport web P-223 connects to. Keep `/health` dependency-free (always responds).

---




### P-194: CLI - stitch status

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-193

**Context:** Users need a quick read on project state: which sources are added, whether config is valid, pending jobs/HIL gates, recent audit activity, and sandbox availability. `stitch status` prints a dashboard from the project config + local state (SQLite) without running a pipeline.

**Files to Create/Modify:**
- `packages/cli/src/commands/status.ts` (new)
- `packages/cli/src/commands/status.test.ts` (new)

**Implementation Steps:**
1. Implement `status(opts): Promise<Result<void, StitchError>>`:
   - Load config (P-200); print: config path, provider, model, project dir.
   - Sources: list each added `repo` + path/glob count (from config `sources`).
   - Pending HIL: query `HilQueue.pending()` (P-160) count per kind.
   - Jobs: `ProvenanceAudit`/job store (P-239) — last N action timestamps + any running job (P-247).
   - Sandbox: `SandboxClient.isAvailable()` (P-168) → `docker: available | unavailable (gh-fallback enabled|disabled)`.
   - Verdict of last merge (if a `checksums.sha256` exists (P-186), run `verifyChecksums` and show `verified|drift`).
2. Render with color (P-206) in a TTY; plain text otherwise.
3. Exit 0 always (informational); `--json` emits a structured object for scripting.
4. Keep it read-only (no mutation).
5. Export `status` and register.

**Required MCPs/Connectors:** Docker check only (pings daemon), plus SQLite query.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Prints config/sources/pending-HIL/jobs/sandbox correctly
- [ ] `--json` emits structured status object
- [ ] Sandbox availability reflected (docker vs gh fallback)
- [ ] Checksum verify shown when present
- [ ] Read-only; exit 0
- [ ] Color in TTY, plain in non-TTY

**Tests Required:** `status.test.ts` (temp configured project):
- `it('renders status summary')`, `it('emits json')`, `it('shows sandbox availability')`, `it('shows checksum verify')`, `it('read only exit 0')`

**Dependencies:** P-193 (config/store infra). Core state queries.

**Handoff Notes:** Next: P-195 `stitch doctor`. Keep `status` read-only and fast; it's the first thing users run to sanity-check a project. `--json` is the contract for scripting/CI health checks.

---




### P-195: CLI - stitch doctor

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-194

**Context:** `stitch doctor` diagnoses environment health: required system deps (git ≥2.40, git-filter-repo, Docker, node, bun), config validity against the zod schema (P-009), provider key presence, and sandbox availability — with a pass/warn/fail report and remediation hints. It's the environment checker matching P-068 (system dependency verifier).

**Files to Create/Modify:**
- `packages/cli/src/commands/doctor.ts` (new)
- `packages/cli/src/commands/doctor.test.ts` (new)
- `packages/cli/src/checks/system.ts` (new — version checks)

**Implementation Steps:**
1. Implement `system.ts` checks:
   - `gitVersion(): Promise<string|undefined>` — `git --version`, parse `x.y.z`, compare ≥2.40 (P-065).
   - `gitFilterRepoPresent(): Promise<boolean>` — `git filter-repo --version`.
   - `dockerAvailable(): Promise<boolean>` — `SandboxClient.isAvailable()` (P-168) or `docker info`.
   - `bunVersion()`/`nodeVersion()`.
2. Implement `doctor(opts): Promise<Result<void, StitchError>>`:
   - Run each check; categorize `pass|warn|fail` with remediation hints.
   - Validate config (load + `zod.safeParse` P-009): invalid → `fail` with the issue list.
   - Provider key presence: if `[ai].provider === 'openrouter'` and no key resolvable → `warn` (merge will prompt) or `fail` with `--strict`.
   - Print a table; `--json` structured output; exit 0 unless `--strict` and any fail.
3. Use only safe commands (never execute untrusted input), time-bounded.
4. Export `doctor`, `runDoctorChecks`, register.

**Required MCPs/Connectors:** Docker ping + local process version checks.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Detects/validates git ≥2.40, git-filter-repo, Docker, bun/node
- [ ] Config validated against zod schema; invalid → fail + issues
- [ ] Provider key presence reported (warn/fail)
- [ ] `--json` structured result; exit 0 unless `--strict` fail
- [ ] Checks bounded/timeout-safe
- [ ] Remediation hints printed

**Tests Required:** `doctor.test.ts` (fake exec for versions):
- `it('checks system deps')`, `it('validates config')`, `it('reports provider key')`, `it('json output')`, `it('strict exit')`

**Dependencies:** P-194 (status infra). P-068 P-065-P-067.

**Handoff Notes:** Next: P-196 `stitch license`. Doctor is the preflight gate PR/CI uses (`--json --strict`); keep check functions pure + injectable for tests.

---




### P-196: CLI - stitch license

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-195

**Context:** Users must inspect and act on the license posture of C before finalizing. `stitch license` runs the license pipeline (P-118–P-128) over the current selection, prints the `LicenseReportData` (per-package table, verdict, GPL warnings, dual/unknown list), and lets the user record allow/deny decisions for unknown licenses (interactive), which gate the merge (P-192/P-205).

**Files to Create/Modify:**
- `packages/cli/src/commands/license.ts` (new)
- `packages/cli/src/commands/license.test.ts` (new)

**Implementation Steps:**
1. Implement `license(opts, args): Promise<Result<void, StitchError>>`:
   - Load sources + deps (P-108/P-116), run `buildLicenseReportData` (P-128) with policy (P-127).
   - Render a table: package | version | declared | normalized | category | decision.
   - Show `verdict` + `blocking`; list GPL warnings, dual options, and pending unknowns.
   - If interactive and there are pending unknowns (P-123): prompt each with `allow|deny|skip` via Ink (P-198), record into the overrides map/config (P-160/P-156), re-evaluate, and show updated verdict.
   - `--json` emits the full `LicenseReportData`.
2. `--allow <license-id>` / `--deny <license-id>` flags for non-interactive decisions.
3. Never allow a `deny` override to silently pass a hard matrix `deny` (P-120) — that stays denied (P-163).
4. Write decisions to the project config so P-192 merge honors them.
5. Export `license` and register.

**Required MCPs/Connectors:** None — runs local license modules.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Prints per-package table + verdict + blocking
- [ ] Lists GPL/dual/unknown sections
- [ ] Interactive prompt resolves pending unknowns; decisions persisted
- [ ] `--allow`/`--deny` flags work non-interactively
- [ ] Hard matrix `deny` cannot be overridden to allow
- [ ] `--json` emits `LicenseReportData`

**Tests Required:** `license.test.ts` (fixture deps, fake prompts):
- `it('renders table + verdict')`, `it('persists unknown decisions')`, `it('applies allow/deny flags')`, `it('won't override hard deny')`, `it('json output')`

**Dependencies:** P-195 (CLI infra). License epic P-118–P-128, HIL P-160.

**Handoff Notes:** Next: P-197 `stitch deps`. The decisions persisted here are what P-127 overrides consume at merge; keep `allow/deny` ids exact SPDX (validate via P-119).

---




### P-197: CLI - stitch deps

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-196

**Context:** Users need to preview the dependency merge before committing to a full stitch. `stitch deps` runs the deps pipeline (P-104–P-117) over the selected sources and prints the `DependencyReport` (P-116): merged manifest, conflicts + resolutions, dedupe strategy, scripts, lockfile status — so the user can inspect/approve conflict resolution interactively.

**Files to Create/Modify:**
- `packages/cli/src/commands/deps.ts` (new)
- `packages/cli/src/commands/deps.test.ts` (new)

**Implementation Steps:**
1. Implement `deps(opts, args): Promise<Result<void, StitchError>>`:
   - Load sources, run `unionManifests` (P-108) → resolve conflicts (P-109/P-111) → `generateDepReport` (P-116).
   - Render the report: dependency sections + counts, conflicts table (package | severity | resolution | status), dedupe notes, scripts collisions, lockfile status.
   - For conflicts with multiple resolutions, prompt the user (interactive Ink) to pick a resolution; persist the chosen resolution to config (honored by P-192 merge).
   - `--json` emits the `DependencyReport`.
   - `--lockfile` triggers a lockfile regeneration (P-114) in a sandbox/offline-aware way and reports the result.
2. Non-interactive (CI) uses `--auto` to auto-apply the resolver's chosen resolution for `review`-level conflicts (P-151) and fails on `error`-level ones.
3. Export `deps` and register.

**Required MCPs/Connectors:** None for reporting; `--lockfile` uses the sandbox/registry (P-114/P-170) — Docker or GH.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Prints merged manifest + counts + conflicts table
- [ ] Interactive conflict resolution persisted to config
- [ ] `--auto` auto-resolves review conflicts, fails on error
- [ ] `--lockfile` triggers regeneration and reports
- [ ] `--json` emits `DependencyReport`
- [ ] Exit codes reflect unresolvable conflicts

**Tests Required:** `deps.test.ts` (fixture manifests, fake prompts):
- `it('renders report')`, `it('persists resolution')`, `it('auto resolves review')`, `it('fails on error conflict')`, `it('lockfile flag')`, `it('json output')`

**Dependencies:** P-196 (CLI infra + license decisions influence). Deps epic P-104–P-117.

**Handoff Notes:** Next: P-198 Ink interactive picker (completes the CLI epic's interactive surface, used by license/deps/merge questions). The persisted resolutions here make merge (P-192) non-interactive when `--auto`/`--yes`.

---




### P-198: CLI - Ink Interactive Picker

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-197

**Context:** Merge, license, deps, and agent ask-user (P-157) all surface interactive decisions. This phase builds the shared Ink-based interactive picker component used across the CLI: single-select, multi-select, confirm (yes/no), and free-text input — each renderable in TTY or non-TTY (auto-fallback to `--yes`/`--auto`/stdin). It standardizes prompt UX and keyboard handling.

**Files to Create/Modify:**
- `packages/cli/src/ui/picker.tsx` (new — Ink components)
- `packages/cli/src/ui/prompt.ts` (new — imperative wrappers `askSelect/askConfirm/askText`)
- `packages/cli/src/ui/prompt.test.ts` (new)

**Implementation Steps:**
1. Build Ink components in `picker.tsx`:
   - `<Select options onSelect>` — arrow-key nav, enter to pick, wrap-around.
   - `<MultiSelect options onDone>` — space to toggle, enter to confirm.
   - `<Confirm message default>` — y/n.
   - `<TextInput placeholder onSubmit>` — type + enter.
   - All render a theme-aware frame (P-202) with a visible cursor/focus.
2. Build `prompt.ts` imperative wrappers returning `Promise<T>`:
   - `askSelect(message, options, opts)` → renders component, waits for selection.
   - `confirm(message, { default, ify })` → if non-TTY resolved from `--yes`/`--auto` or abort.
   - `promptText(message, { secret })` → for keys (secret echo hidden, P-190).
3. Non-TTY fallback: when `!process.stdout.isTTY` or `opts.yes`, `confirm` → `opts.yes ? true : false` (unless `require` → throw `HIL_ABORT`, P-160/P-203); prompts auto-pick default.
4. Provide cancelled/`esc` handling → reject with typed `StitchError` code (P-163).
5. Test wrappers with a fake Ink renderer (override `render` to feed keystrokes) and non-TTY paths.

**Required MCPs/Connectors:** None — local render only (init/store prompts at P-190/P-156 separate).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Select/multi/confirm/text all rendered with keyboard nav
- [ ] Non-TTY auto-resolves from `--yes`/`--auto`
- [ ] Secret text input doesn't echo
- [ ] Esc/cancel → typed StitchError
- [ ] Theme-aware rendering (P-202 tokens)
- [ ] Reusable across merge/license/deps (P-192/196/197)

**Tests Required:** `prompt.test.ts`:
- `it('select navigates')`, `it('multiselect toggles')`, `it('confirm yes no')`, `it('nontty auto yes')`, `it('secret hidden')`, `it('cancel errors')`

**Dependencies:** P-197. Theme P-202, errors P-203, HIL P-160.

**Handoff Notes:** Next: P-199 progress rendering. This is the single source of interactive UX — any command that prompts routes through `prompt.ts`, so behavior (incl. `-y`) stays consistent.

---




### P-199: CLI - Progress Rendering

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-198

**Context:** Long pipelines (deps, sandbox build, AI generation, merge, provenance) need live progress without noisy spam. This phase builds the progress renderer: a step list with statuses (queued→running→done/failed) + elapsed time, spinners, and a compact log line, driven by core events (P-162). Auto-cleans on TTY; falls back to sequential plain lines off-TTY.

**Files to Create/Modify:**
- `packages/cli/src/ui/progress.tsx` (new)
- `packages/cli/src/ui/progress.test.ts` (new)

**Implementation Steps:**
1. Define an event contract consumed from core (P-162 event stream):
   - `{type:'step', id, label}`, `{type:'status', id, status, detail}`, `{type:'log', level, msg}`, `{type:'done', summary}`.
2. Implement `progress.tsx` Ink component:
   - Maintains ordered step list; renders active step with a spinner, done steps as `✔`, failed as `✘` (theme P-202).
   - Shows elapsed `mm:ss` per step and a total.
   - Throttles re-render to ~30fps for large log bursts.
   - On non-TTY, prints a discrete `→ step: detail` line per transition (no redraw).
3. Provide `startProgress(stream)` → controller `{update(ev), finish()}`, wiring the P-162 subscription. Terminate cleanly (clear, print summary) on finish.
4. Respect `--silent`/`--verbose` (P-206) to suppress logs vs show all.
5. Test with a fake event pump; assert TTY renders step states and non-TTY emits lines in order.

**Required MCPs/Connectors:** None — consumes local event stream.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Step list with spinner + elapsed time rendered on TTY
- [ ] Non-TTY emits ordered plain transition lines
- [ ] Event stream (P-162) drives updates; finish clears cleanly
- [ ] Honors `--silent`/`--verbose`
- [ ] Throttles heavy log bursts (no jank)
- [ ] Errors surface per-step without crashing

**Tests Required:** `progress.test.ts` (fake pump):
- `it('renders step states')`, `it('emits lines off tty')`, `it('finishes cleanly')`, `it('silent mode')`, `it('throttles bursts')`

**Dependencies:** P-198 (Ink infra). Events P-162, logs P-206.

**Handoff Notes:** Next: P-200 config + file resolver. Keep the renderer decoupled from pipeline logic — it only renders the P-162 stream. Merge/serve (P-192/193) both use it.

---




### P-200: CLI - Config + File Resolution

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-199

**Context:** Every command needs the project config. This centralizes discovery + parsing: locate `stitch.toml` (cwd or `--config`), parse TOML→config, merge with defaults, the user-level `~/.stitch/config` (provider keys via env/encrypted), and a `--json` config emit. It wraps P-009 zod schema and gives every other CLI command a single `loadConfig()`.

**Files to Create/Modify:**
- `packages/cli/src/config.ts` (new — `loadConfig`, `writeConfig`, `configPaths`)
- `packages/cli/src/config.test.ts` (new)
- `packages/cli/src/config-schema.ts` (new — imports P-009 schema, extends CLI-side bits)

**Implementation Steps:**
1. `configPaths(opts)`: find project file — `opts.config` if set, else nearest `stitch.toml` walking up from `opts.cwd`/cwd (stop at FS root or a `.git` boundary).
2. `loadConfig(opts): Promise<AppConfig>`:
   - Parse TOML (Bun `Bun.file` + a TOML parser, e.g. `@iarna/toml`), `zod.safeParse` against P-009 schema; on fail → `err('CONFIG_INVALID', issues)` (P-203).
   - Merge with `defaultConfig()` constants.
   - Load user-level `~/.stitch/config` for provider keys (env-name refs or decrypted), overlay env vars (`STITCH_*`, `OPENROUTER_API_KEY`, etc.).
   - Resolve relative paths in config against the config file's dir.
3. `writeConfig(dir, cfg)`: serialize the AppConfig to `stitch.toml` (used by init P-190, license/deps decision persistence P-196/197).
4. `--config-json`/config command: `emitConfig(opts)` prints the merged effective config as JSON (for debugging/CI).
5. Cache per-process (memoize by path) to avoid repeated IO.
6. Test: discovery walking, invalid→error, default merge, env overlay, path resolution.

**Required MCPs/Connectors:** None — local TOML/zod/env.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Finds project config via `--config` or upward walk
- [ ] Invalid config → `CONFIG_INVALID` with issues
- [ ] Defaults merged; env vars overlay; keys resolved
- [ ] Relative paths resolved against config dir
- [ ] `writeConfig` round-trips (init/persist)
- [ ] `emitConfig` prints effective JSON; cached per-process

**Tests Required:** `config.test.ts`:
- `it('discovers upward')`, `it('fails invalid')`, `it('merges defaults')`, `it('overlays env')`, `it('resolves paths')`, `it('round trips write')`

**Dependencies:** P-199. Config zod P-009, init P-190.

**Handoff Notes:** Next: P-201 editor integration. All commands obtain config through `loadConfig` — never parse TOML ad-hoc. Keep the user-level store decoupled (it's the only one holding key refs).

---




### P-201: CLI - Editor Integration

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-200

**Context:** For power users editing config, licenses overrides, or dep resolutions, `stitch config`/`merge --edit` should open the real file in `$EDITOR`. This phase adds editor integration: open `stitch.toml` (or a decision file) in `$VISUAL`/`$EDITOR`/default, watch for save, re-parse the result, and validate it on close — giving instant feedback on mistakes.

**Files to Create/Modify:**
- `packages/cli/src/editor.ts` (new — `openInEditor`)
- `packages/cli/src/commands/config.ts` (new — `stitch config [--edit]`)
- `packages/cli/src/editor.test.ts` (new)
- `packages/cli/src/commands/config.test.ts` (new)

**Implementation Steps:**
1. `editor.ts`:
   - Determine editor: `$VISUAL` → `$EDITOR` → platform default (`code`/`vi`/`notepad`).
   - `openInEditor(path, opts): Promise<{saved:boolean, mtime}>` — launch editor detached, await its exit; if file changed while open, return saved.
   - Safely quote/escape the path (P-205), never shell-inject.
2. `config.ts`:
   - `stitch config` prints the resolved config path + effective JSON (P-200 emit).
   - `stitch config --edit` opens `stitch.toml` in the editor; on save, re-run `loadConfig` and surface `CONFIG_INVALID` with line-ish issues (fall back to path), looping: allow retry in editor.
   - `--no-loop` edits once then validates (CI-safe).
3. Handle no-editor/unset: `err('NO_EDITOR')` with hint.
4. Wire `--edit` into `merge --preflight` (optional: opens dep resolutions for review before committing). Keep optional to avoid blocking automation.
5. Test with a mock `spawn` editor that writes a known file; assert re-parse + loop behavior.

**Required MCPs/Connectors:** None — local process spawn.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Resolves `$VISUAL`/`$EDITOR`/default and opens file
- [ ] Re-parses + validates after save; loops on invalid
- [ ] `--no-loop` edits once then validates
- [ ] `NO_EDITOR` handled with hint
- [ ] Escapes args safely (no injection)
- [ ] `config --edit` returns valid config or typed error

**Tests Required:** `editor.test.ts`/`config.test.ts`:
- `it('opens and edits')`, `it('rescues parser restart on invalid')`, `it('no loop mode')`, `it('no editor error')`, `it('safe arg quoting')`

**Dependencies:** P-200 (config load/write). Errors P-203.

**Handoff Notes:** Next: P-202 theme + color. Keep editor calls async/time-bounded (don't block the server on `serve`). The re-parse loop reuses `loadConfig` so validation is identical everywhere.

---




### P-202: CLI - Theme + Color

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-201

**Context:** Consistent, accessible CLI visuals. This phase defines the theme token set (colors beyond basic ANSI, semantic roles: primary/success/warn/error/muted) supporting dark/light detection and `NO_COLOR`/`--no-color`, and applies it across Ink components (P-198/P-199) and plain text. Enables programmatic custom colors and a `--color <mode>` override.

**Files to Create/Modify:**
- `packages/cli/src/theme.ts` (new — token definitions + resolve)
- `packages/cli/src/theme.test.ts` (new)
- `packages/cli/src/color.ts` (new — ANSI helpers, `stripColor`, `supportsColor`)

**Implementation Steps:**
1. `color.ts`:
   - `supportsColor(stream, env)`: TTY + no `NO_COLOR` + no `--no-color`; honor `TERM=dumb`, `FORCE_COLOR`.
   - `stripColor(str)`: strip ANSI (used at boundaries).
   - Small `rgbToAnsi256`/`truecolor` helpers.
2. `theme.ts`:
   - Semantic tokens: `primary`, `success`, `warn`, `error`, `muted`, `hl`, `border`, `spinner`.
   - `resolveTheme(env, opts)`: returns the token→ANSI map; `dark`/`light` detection (respect `COLORTERM`, tput bg query, or explicit `--color dark|light|auto`, default auto).
   - Expose named hex values so themes are tunable in config (`[cli] primary='#7c3aed'`).
3. Apply tokens in P-198 picker + P-199 progress (replace hardcoded colors).
4. Plain-text commands (status P-194, doctor P-195) colorize via the same tokens and honor `--no-color`.
5. Test: supportsColor matrix (TTY/NO_COLOR/FORCE), stripColor, resolveTheme dark/light + overrides.

**Required MCPs/Connectors:** None — terminal queries only.

**Skills to Invoke:** ui-ux-pro-max (accessibility of terminal color) — optional.

**Acceptance Criteria:**
- [ ] Semantic tokens resolve for dark/light/auto + explicit override
- [ ] `NO_COLOR`/`--no-color`/`TERM=dumb` disable color
- [ ] Tokens applied uniformly in picker, progress, status, doctor
- [ ] `stripColor` works for piped output
- [ ] `[cli]` config hex overrides honored
- [ ] All terminal output still readable when stripped

**Tests Required:** `theme.test.ts`:
- `it('resolves dark and light')`, `it('no color env')`, `it('strips ansi')`, `it('custom primary')`, `it('force color')`

**Dependencies:** P-201. Subcomponents P-198/P-199.

**Handoff Notes:** Next: P-203 error messages + exit codes. The theme is the single style source — no stray hardcoded ANSI codes elsewhere. Keep contrast accessible (warn/error ≥4.5:1).

---




### P-203: CLI - Error Messages + Exit Codes

**Owner:** aradhy | **Wave:** 1 | **Depends On:** P-202

**Context:** Great CLIs fail gracefully. This phase unifies error formatting (the `friendlyError` presentation of P-163's typed `StitchError`), defines the full exit-code map, adds `--trace`, and ensures every command's failure reads as an actionable message with the right code. It's the error contract the whole CLI epic already relied on.

**Files to Create/Modify:**
- `packages/cli/src/errors.ts` (new — `ExitCode` enum, `printStitchError`, `ExitError`)
- `packages/cli/src/errors.test.ts` (new)

**Implementation Steps:**
1. Define `ExitCode` enum (documented in help):
   - `0` success, `1` general/known error, `2` usage error, `3` config invalid (P-200), `4` path/`NOTHING_TO_STITCH`, `10` HIL abort (P-160), `20` license denied (P-120/P-196), `30` sandbox unavailable (P-168), `40` AI provider failure (P-139), `50` dependency unresolvable (P-197).
   - Map code strings → numeric in `exitFor(err)`.
2. `printStitchError(err, {verbose})`:
   - Render: `✘ <code>: <message>` in error color (P-202), a one-line remediation hint when available, and in `--verbose` a full stack/path + cause chain.
   - Omit stack in normal mode; include in `--trace`.
3. Central exit: in `index.ts` catch the final `Result`/error and `process.exit(exitFor(err))`; unknown → 70 internal.
4. Ensure Commader usage errors map to `2` and print help hint.
5. Provide `toHuman(code)` map used to make suggested next steps (e.g. license → `run stitch license`).
6. Test the formatting + code mapping across representative errors.

**Required MCPs/Connectors:** None — pure presentation.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Exit codes: 0/1/2 + typed codes (config, HIL, license, sandbox, AI, deps)
- [ ] `printStitchError` shows code + message + hint; stack only in `--trace`/verbose
- [ ] Unknown error → 70 with stack
- [ ] Commander usage → 2
- [ ] Mapping used consistently by every command
- [ ] Hints actionable ("run stitch license")

**Tests Required:** `errors.test.ts`:
- `it('maps exit codes')`, `it('formats with hint')`, `it('trace shows stack')`, `it('usage exit 2')`, `it('unknown exit 70')`

**Dependencies:** P-202 (theme). Typed errors P-163.

**Handoff Notes:** Next: P-204 optimization flags. This is the single error/exit entrypoint — every command maps through `exitFor`; keep hints data-driven from a static table (easy to translate later).

---




### P-204: CLI - Optimization Flags

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-203

**Context:** Performance knobs for big stitches. `stitch merge`/`serve` accept `--jobs <n>` (parallel sandbox/build jobs), `--memory <mb>` (sandbox/agent limits), `--timeout <s>` (operation cap), `--max-files <n>` and `--max-size <mb>` (selection caps), plus `--concurrency` for AI/dep calls. This phase parses, validates, and threads these into the pipeline config (P-243) and sandbox (P-168/P-176).

**Files to Create/Modify:**
- `packages/cli/src/commands/merge.ts` (modify — add flags)
- `packages/cli/src/commands/serve.ts` (modify — add flags)
- `packages/cli/src/flags.ts` (new — parse/validate shared perf flags)
- `packages/cli/src/flags.test.ts` (new)

**Implementation Steps:**
1. Define a shared `perfFlags` option set (added to merge/serve):
   - `--jobs <n>` (default from config `[perf].jobs` or cpu count)
   - `--memory <mb>` (cap, default config)
   - `--timeout <s>` (whole-op cap; 0=unlimited)
   - `--max-files <n>` (selection cap → `err('EXCEEDS_MAX_FILES')` if exceeded, P-205)
   - `--max-size <mb>` (selection byte cap → `EXCEEDS_MAX_SIZE`)
   - `--concurrency <n>` (AI/dep async calls)
2. `flags.ts`:
   - `parsePerfFlags(raw, defaults)` — validate ranges (jobs≥1, memory>0, timeout≥0, concurrency≥1); out-of-range → `err('BAD_OPTION', msg)` usage (exit 2, P-203).
   - Produce a typed `PerfConfig` merged with config defaults.
3. Thread `PerfConfig` into `runPipeline` config (P-243): jobs→sandbox queue (P-176), memory/timeout→`SandboxOpts` (P-176), concurrency→agent tool pool (P-157/P-141), caps→selection (P-148).
4. Surface effective settings to progress/`--json` so users see what was applied.
5. Test parse/validate + merge into pipeline config.

**Required MCPs/Connectors:** None — config plumbing (sandbox caps honored later by dockerode).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Flags parsed + validated (bad → exit 2)
- [ ] Threaded into merge/serve pipeline config
- [ ] Jobs/memory/timeout/concurrency honored where implemented
- [ ] max-files/max-size caps enforced → typed errors
- [ ] Defaults from `[perf]` config; effective values visible
- [ ] `--timeout 0` = unlimited

**Tests Required:** `flags.test.ts`:
- `it('parses valid flags')`, `it('rejects out of range')`, `it('merges defaults')`, `it('enforces caps')`, `it('timeout zero unlimited')`

**Dependencies:** P-203 (exit codes). Pipeline config P-243, sandbox P-176.

**Handoff Notes:** Next: P-205 file/naming conventions + regex validation. Centralize perf parsing in `flags.ts` so merge/serve/agent agree; keep caps strictly enforced as a hard guardrail pre-run.

---




### P-205: CLI - File/Naming Conventions + Regex Validation

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-204

**Context:** Safe, predictable output naming and path handling. This phase defines and validates the file/naming conventions: output dir default (`stitch-out`), package/component folder slugification (P-108/P-110), safe path segments (no `..`, absolute, reserved, control chars), and a regex validator reused wherever names are generated (components P-146/P-155, repos P-191, sandbox mounts P-175). It's the guard against path traversal and collisions.

**Files to Create/Modify:**
- `packages/cli/src/paths.ts` (new — `slugify`, `safeJoin`, `validateName`)
- `packages/cli/src/paths.test.ts` (new)

**Implementation Steps:**
1. `paths.ts`:
   - `validateName(name)`: must match `^[a-z][a-z0-9-_]*$` (or configurable), reject leading digits, whitespace, reserved words (`.`, `..`, device names), control chars → returns boolean or throws `err('INVALID_NAME', name, reason)`.
   - `slugify(name)`: lowercase, ascii-fold, replace runs of non-alnum → `-`, trim, ensure starts alpha, cap length (default 64), dedupe with a `used` set → `slugify(name, used)`.
   - `safeJoin(base, ...parts)`: each part must not be absolute, must not contain `..`/`:\`/control; resolve and verify the result stays within `base` (realpath containment check).
   - `defaultOutDir(cwd)`: `<cwd>/stitch-out` (used by merge P-192 absent `--out`).
2. Wire validators into:
   - Component generation (P-155/P-146) folder + file names.
   - Source slug + output layout (P-191/P-205).
   - Sandbox mount paths (P-175) — reject anything not `safeJoin`-clean.
   - Agent `move_file`/`edit_config` targets (P-150/P-152).
3. Apply a global path deny-list (`/etc`, `/usr`, `C:\Windows`, home-config) for writes outside the project to prevent rogue agent edits.
4. Test slugify edge cases + traversal/absolute rejection.

**Required MCPs/Connectors:** None — fs.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `validateName` rejects invalid/reserved/control names
- [ ] `slugify` deterministic, dedupe via `used`
- [ ] `safeJoin` blocks absolute/`..`/containment escape
- [ ] Default out dir `<cwd>/stitch-out`
- [ ] Validators applied to generation, mount, agent tool targets
- [ ] Global write deny-list enforced

**Tests Required:** `paths.test.ts`:
- `it('validates names')`, `it('slugifies with dedupe')`, `it('rejects traversal')`, `it('containment check')`, `it('default out dir')`, `it('deny list')`

**Dependencies:** P-204 (flags cap → naming collisions). P-108/P-110 slug.

**Handoff Notes:** Next: P-206 log filtering. This is the security+determinism guardrail for generated names and paths; reuse `validateName`/`safeJoin` everywhere a path or name is created.

---




### P-206: CLI - Log Filtering + Verbose/Silent

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-205

**Context:** Log noise control. This phase builds the CLI logger: level filtering (`silent|error|warn|info|debug|trace`), source namespaces, `-V/--verbose` and `-q/--silent`, per-module toggles (e.g. `--log deps=debug,sandbox=warn`), color decision (P-202), and redaction of secrets (API keys, tokens) in all log output. It's the sink for the core logger (P-010) and P-162 events.

**Files to Create/Modify:**
- `packages/cli/src/log.ts` (new — `createLogger`, `parseLogFilter`)
- `packages/cli/src/log.test.ts` (new)

**Implementation Steps:**
1. `log.ts`:
   - Levels ordered; default `info`, `-q`→`silent` (+level error?), `-V`→`debug`/`trace`.
   - `parseLogFilter('deps=debug,ai=warn')` → map module→level; global default.
   - `createLogger({level, moduleFilter, theme, redact})` returns `{debug,info,warn,error,child(module)}`.
   - Redact: replace known key patterns (`api[_-]?key`, `token`, `secret`, `password`), via config key list (P-200) + common env names, with `***`. Never print secrets.
2. Wire `child(module)` so core modules (P-010) log through the CLI filter; events (P-162) with `level >= threshold` render.
3. Support `--log` repeatable flag on all commands (parse in `cli.ts` P-189 global set).
4. `--silent` suppresses all non-error output (still exits codes + writes files); errors still shown unless `--quiet-error`.
5. JSON mode: `--log-json` emits structured NDJSON logs (CI/`serve`).
6. Test level filtering, module filter, redaction, json.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Levels + `-q`/`-V` honored; `--log` per-module toggles
- [ ] Secrets redacted (`***`) in every log line
- [ ] `child(module)` filtering works
- [ ] `--silent` suppresses non-error; errors still shown
- [ ] `--log-json` NDJSON structured logs
- [ ] Color follows P-202/no-color

**Tests Required:** `log.test.ts`:
- `it('filters levels')`, `it('module filter')`, `it('redacts secrets')`, `it('silent mode')`, `it('json logs')`, `it('child modules')`

**Dependencies:** P-205. Core logger P-010, events P-162, theme P-202.

**Handoff Notes:** Next: P-207 CLI audit. This is the single logging entrypoint; never `console.log` ad-hoc in commands — route through `createLogger` so filtering + redaction always apply.

---




### P-207: CLI - stitch audit

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-206

**Context:** Compliance/DR needs a view into what the tool did. `stitch audit` surfaces the `ProvenanceAudit` (P-187) and execution logs: who/what ran, sources touched, files written, SBOM/checksum state, HIL decisions, AI calls. It's the CLI read side of the audit log plus a `--export <format>` (json/markdown) for sharing and a `--from/--to` time filter.

**Files to Create/Modify:**
- `packages/cli/src/commands/audit.ts` (new)
- `packages/cli/src/commands/audit.test.ts` (new)

**Implementation Steps:**
1. Implement `audit(opts, args)`:
   - Query `ProvenanceAudit` (P-187) with optional `--from <ts>` / `--to <ts>` / `--actor` (machine/user) filters.
   - Render chronological table: timestamp | actor | event kind | target | detail | verdict/result, colored by kind (P-202).
   - Group summary counts by event kind; show last merge summary if present (P-186 checksum verified state).
2. `--export json` → full `AuditRecord[]` as JSON; `--export md` → a markdown compliance report (headers + tables) for pasting into PRs.
3. `--follow`/`-f` tail mode (optional): watch the SQLite audit (P-187) for new records until interrupted (used with `serve`).
4. Filter AI-only noise with `--no-ai` (hide P-145 audit rows) for a compliance-focused view.
5. Never mutate; exit 0.
6. Test query + filters + json/md export.

**Required MCPs/Connectors:** SQLite read (P-187).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Chronological audit table with filters (`--from/--to/--actor`)
- [ ] `--export json` and `--export md` render correctly
- [ ] `--no-ai` hides AI rows; `--follow` tails new records
- [ ] Last merge + checksum status shown
- [ ] Read-only; exit 0
- [ ] Color by kind; plain off-TTY

**Tests Required:** `audit.test.ts` (seeded temp sqlite):
- `it('renders table')`, `it('filters time and actor')`, `it('exports json')`, `it('exports md')`, `it('no ai filter')`, `it('read only')`

**Dependencies:** P-206 (logger). Audit P-187, checksums P-186.

**Handoff Notes:** This completes the CLI epic (P-189–P-207). Next: P-208 begins the Web epic (web build integration into `serve`). Audit is the compliance read-side — keep it read-only and export-friendly for audits.

---




### P-208: Web - Vite+Tailwind Scaffold

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-207 (CLI epic); serves via P-193

**Context:** The web frontend (`packages/web`) is the visual surface of repo-stitcher, replacing terminal-only interaction for merge/review flows. This phase scaffolds the Vite + React 18 + TypeScript strict + Tailwind single-page app, establishes the build that `stitch serve` (P-193) serves from `dist`, and wires the dev server (Vite on 5173) with API proxying to `serve`.

**Files to Create/Modify:**
- `packages/web/package.json` (new — deps: react 18, vite, tailwind, zustand, tanstack-query, ws client, ramda/picomatch-lite)
- `packages/web/vite.config.ts` (new)
- `packages/web/tailwind.config.js` (new)
- `packages/web/index.html` (new)
- `packages/web/src/main.tsx`, `src/App.tsx`, `src/styles.css` (new)
- `packages/web/tsconfig.json` (strict)

**Implementation Steps:**
1. Scaffold `packages/web` with Vite React-TS template; enforce `"strict": true` TS.
2. Configure Tailwind (v3) with content globs over `src`; base `styles.css` with Tailwind directives + token variables (P-209).
3. `vite.config.ts`: `react` + `@` alias to `src`; dev server on `5173`, `server.proxy` `'/api'` + `'/ws'` → `http://127.0.0.1:3434` (P-193) with `ws: true` for the WS proxy.
4. `main.tsx`: `createRoot` render `App`; `App.tsx` renders the shell placeholder (P-210) or a loading state; wire a `QueryClientProvider` (TanStack) + Zustand store provider (P-215).
5. Add `build` → `vite build` (output `dist`), `dev`, `lint`, `typecheck` scripts. Confirm `dist` is produced and `serve` (P-193) serves it (manual smoke).
6. Add a smoke test: `vitest` renders `App` without crashing; assert build succeeds in CI.

**Required MCPs/Connectors:** None — local dev/build.

**Skills to Invoke:** ui-ux-pro-max / ui-styling (Tailwind conventions) — recommended.

**Acceptance Criteria:**
- [ ] Vite + React 18 + TS strict + Tailwind scaffold builds (`dist` produced)
- [ ] Dev server on 5173 proxies `/api` + `/ws` → `serve` (3434)
- [ ] `App` renders shell placeholder; QueryClient + store mounted
- [ ] `@` alias + `lint`/`typecheck`/`build` scripts work
- [ ] `serve` serves `dist` (manual smoke)
- [ ] Smoke test renders without crash

**Tests Required:** `src/App.test.tsx` (vitest + RTL):
- `it('renders shell placeholder')`, `it('mounts providers')`

**Dependencies:** P-207 (serve + dist P-193 ready). Tokens P-209 next.

**Handoff Notes:** Next: P-209 design tokens. This is the foundational web package every component imports from; keep TS strict + alias consistent and never commit `dist`. The `serve`-proxy contract (paths `/api`, `/ws`) is fixed here.

---




### P-209: Web - Design Tokens

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-208

**Context:** Consistent visual language. This phase defines the design tokens — color scales (with dark-mode-ready variants, P-226), typography, spacing, radii, shadows, and a component-safe semantic layer — as CSS custom properties + TS token objects. It establishes the design-system foundation the whole web surface uses, mirroring the CLI theme (P-202) for a cohesive product.

**Files to Create/Modify:**
- `packages/web/src/theme/tokens.css` (new — CSS vars)
- `packages/web/src/theme/tokens.ts` (new — typed token export)
- `packages/web/tailwind.config.js` (modify — map colors/spacing to tokens)

**Implementation Steps:**
1. Define a 10-step neutral palette + a brand primary (configurable via `[web]`/P-200, default to match provider accent, e.g. `#7c3aed`) + semantic roles (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--primary`, `--success`, `--warning`, `--danger`).
2. Expose both light and dark token sets (CSS `[data-theme=dark]` overrides, P-226) with accessible contrast ratios.
3. Typography scale (display/title/body/caption) tied to a chosen font (Inter via `@fontsource`), with line-heights.
4. Spacing scale (`--space-1..8`), radius (`--radius-sm/md/lg`), shadow tokens.
5. Export `tokens.ts` mirroring the same values as typed consts so JS components share the scale.
6. Wire Tailwind `theme.extend` to the tokens (`colors: theme.colors`, `spacing`) so utilities resolve from tokens.
7. Add a token reference screen (optional dev-only) and a contrast test for the semantic pairs.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (palette + contrast design); design-consultation for the system — optional.

**Acceptance Criteria:**
- [ ] Semantic tokens defined in CSS vars + TS consts
- [ ] Light/dark sets with accessible contrast (≥4.5:1 text)
- [ ] Typography/spacing/radius/shadow scales present
- [ ] Tailwind extended from tokens; utilities reflect them
- [ ] Primary configurable via `[web]`
- [ ] Contrast test on semantic pairs

**Tests Required:** `theme/tokens.test.ts`:
- `it('defines all semantic roles')`, `it('contrast light vars')`, `it('contrast dark vars')`, `it('spacing monotonic')`

**Dependencies:** P-208. Config P-200.

**Handoff Notes:** Next: P-210 shell layout. Tokens are the single source for all color/space on web; components reference tokens (never raw hex) so dark mode (P-226) and theming stay trivial.

---




### P-210: Web - Shell Layout

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-209

**Context:** The app chrome that hosts every screen. This phase builds the shell layout: top nav (brand, run status, dark toggle, settings), a left sidebar (stepped flow: Sources → Select → Stitch → Review → Results), and a main content region; it also provides the routing scaffold (React Router) and the placeholder screens each later phase fills (pickers, trees, review, results).

**Files to Create/Modify:**
- `packages/web/src/shell/AppShell.tsx` (new)
- `packages/web/src/shell/Stepper.tsx` (new — left step nav)
- `packages/web/src/shell/Sidebar.tsx` (new)
- `packages/web/src/router.tsx` (new — routes to placeholder screens)
- `packages/web/src/pages/*.tsx` (placeholder: `SourcesPage`, `SelectPage`, `MergePage`, `ReviewPage`, `ResultsPage`)
- `packages/web/src/shell/*.test.tsx` (new)

**Implementation Steps:**
1. `router.tsx`: React Router routes to the five step pages; guard with a `RouteErrorBoundary` (P-228).
2. `AppShell.tsx`: flex layout — header (brand `stitch`, live run status from `RunStatusStore` (P-216/224), dark toggle hook P-226, settings link P-225), `Sidebar` (steps with active state from current route), `<main>` renders routed page.
3. `Stepper.tsx`: ordered steps with `visited/active/locked` states, driven by `router` location + a `flowStore` (P-215) — clicking a completed step navigates; locked steps block.
4. `Sidebar.tsx`: host a collapsible "sources + selection summary" mini-status (counts from store).
5. Pages are minimal placeholders (title + "coming in phase X") so the app runs today.
6. Test: route rendering, step active/locked transitions, placeholder pages mount.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-styling (shadcn layout patterns) — optional.

**Acceptance Criteria:**
- [ ] Header/sidebar/main shell renders; routes work
- [ ] Stepper reflects active/visited/locked from route+store
- [ ] Locked steps block navigation; completed steps clickable
- [ ] Placeholder pages mount for all five steps
- [ ] Dark toggle + settings wired to later phases
- [ ] Shell tests pass

**Tests Required:** `shell/*.test.tsx`:
- `it('renders shell')`, `it('stepper active states')`, `it('locked blocks nav')`, `it('routes placeholders')`

**Dependencies:** P-209. Store P-215, WS P-223 (later), dark P-226.

**Handoff Notes:** Next: P-211 repo A picker. The shell is the stable container; pages slot in as they land. Keep step id ↔ route key mapping centralized in `router.tsx` for the stepper.

---




### P-211: Web - Repo A Picker

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-210

**Context:** The user picks the FIRST source repo (A). This phase builds the repo-picker screen: a list of known/local repos, "add from GitHub" (owner/repo + ref), and "add local path", listing files for selection (P-213). It calls the CLI's repo-resolution endpoints (`/api/repos/sources`, POST `/api/repos/from-url`) served by `serve` (P-193), and stores the chosen repo+ref in the selection store (P-215).

**Files to Create/Modify:**
- `packages/web/src/pages/SourcesPage.tsx` (modify placeholder)
- `packages/web/src/components/RepoPicker.tsx` (new)
- `packages/web/src/components/RepoSourceForm.tsx` (new)
- `packages/web/src/api/repos.ts` (new — fetch wrappers)
- `packages/web/src/pages/SourcesPage.test.tsx` (new)

**Implementation Steps:**
1. `api/repos.ts`: `listSources()` GET `/api/repos/sources`; `addSourceUrl({ownerRepo, ref})` POST `/api/repos/from-url`; `addSourcePath({path})` POST `/api/repos/local` (each returns a normalized source record + optional branch).
2. `RepoPicker.tsx`: list known sources (from store P-215) with status; a form to add GitHub (owner/repo + ref/`--branch`) or local path; shows error surface (P-228) on API failure (`repository not found`, `no branches`).
3. `RepoSourceForm.tsx`: validate input (owner/repo pattern, ref format) before POST; disable submit while pending; show spinner.
4. On success, the source is appended to the store (P-215) and stepper advances to "Select Repo A files" (P-213).
5. Distinguish "A" vs "B" slots — this screen manages the A slot; P-212 manages B (shared component, differing slot + store key).
6. Test: renders sources, form validation, API success appends + advances, API error surfaces.

**Required MCPs/Connectors:** None direct — calls `serve` REST.

**Skills to Invoke:** ui-ux-pro-max (form + empty states).

**Acceptance Criteria:**
- [ ] Lists known sources from store + API
- [ ] GitHub owner/repo + ref validated; local path supported
- [ ] API success appends to store + advances stepper
- [ ] API/fetch errors surface without crashing
- [ ] A-slot bound; B-slot shares component (P-212)
- [ ] Tests pass

**Tests Required:** `SourcesPage.test.tsx` (mocked fetch):
- `it('renders sources')`, `it('validates owner repo')`, `it('adds from url')`, `it('adds local path')`, `it('advances on success')`, `it('surfaces error')`

**Dependencies:** P-210. Store P-215, serve API P-193.

**Handoff Notes:** Next: P-212 repo B picker. Keep RepoPicker slot-agnostic (`prop slot: 'A'|'B'`) — P-212 reuses it with the B store key. The `/api/repos/*` contract is set here.

---




### P-212: Web - Repo B Picker

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-211

**Context:** Second source repo (B). This phase reuses the P-211 `RepoPicker` component bound to the B slot + B store key, and adds B-specific behavior: the merge flow needs *two* sources, so the UI tracks A+B completion and enables the "Continue to select files" step only when both are present; it also supports "swap A/B".

**Files to Create/Modify:**
- `packages/web/src/pages/SourcesPage.tsx` (modify — render two `RepoPicker`s)
- `packages/web/src/store/selection.ts` (extend — `sourcesA`, `sourcesB`, `canProceed`)
- `packages/web/src/store/selection.test.ts` (new)

**Implementation Steps:**
1. Modify `SourcesPage` to render two `RepoPicker` instances (`slot="A"` and `slot="B"`), each bound to the matching store sub-key.
2. Extend `selection` store: `sourcesA: Source[]`, `sourcesB: Source[]`, plus derived `canProceedSourceSelection = sourcesA.some(chosen ref) && sourcesB.some(chosen ref)`.
3. Add a "swap A/B" control: exchanges `sourcesA`/`sourcesB` and their selected refs (used when user set sources in the wrong order).
4. Stepper (P-210): enable the "Select" step only when `canProceedSourceSelection`; otherwise show a lock hint. The A/B order is stored so the merge (P-192) gets correct `source` for A and B (provenance P-181 tracks per-slot origin).
5. When either slot changes, clear downstream selection state that depended on the old refs (P-215 files/resolutions) to avoid stale trees.
6. Test store transitions + swap behavior + step gating.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (layout of paired sources).

**Acceptance Criteria:**
- [ ] Two pickers for A/B; each bound to its store key
- [ ] `canProceedSourceSelection` only true with both refs
- [ ] "Select" step locked until both; hint shown
- [ ] Swap A/B works and persists; stale selection cleared on change
- [ ] Store tests pass

**Tests Required:** `store/selection.test.ts`:
- `it('tracks a and b')`, `it('canProceed gate')`, `it('swap a b')`, `it('clears stale on change')`

**Dependencies:** P-211. Store P-215.

**Handoff Notes:** Next: P-213 file tree A. The A/B symmetry is fully enforced here; everything downstream keys off `sourcesA/sourcesB` refs, so swapping stays consistent with provenance (P-181).

---




### P-213: Web - File Tree A

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-212

**Context:** The user selects WHICH files from repo A to bring over. This phase builds the file-tree component and the A selection screen: fetch the tree for A (via `/api/repos/<id>/tree` from `serve`, which uses `listFiles` P-103), show an expandable tree with checkbox selection, show file metadata (size, type), and persist the selection set in the store (P-215) for merge.

**Files to Create/Modify:**
- `packages/web/src/components/FileTree.tsx` (new)
- `packages/web/src/components/TreeNode.tsx` (new)
- `packages/web/src/pages/SelectPage.tsx` (modify placeholder → tree for slot A)
- `packages/web/src/api/tree.ts` (new)
- `packages/web/src/components/FileTree.test.tsx` (new)

**Implementation Steps:**
1. `api/tree.ts`: `getTree(repoId, ref)` GET `/api/repos/<repoId>/tree?ref=` → `{path,type,size,blobSha}[]` (flattened); confirm with `listFiles` (P-103).
2. `TreeNode.tsx`: render a single node row — expand toggle (dir), checkbox (selectable file), icon, name, size; collapse/expand all; supports "select folder" (checks all descendant files, P-148 selection logic).
3. `FileTree.tsx`: load tree from API, build a virtualized tree (reuse a tanstack/`react-window` list for big repos), maintain `expanded` set + `checked` map in component, emit changes to `selection` store (P-215) as `FileSelection` (P-148).
4. Show a header with counts (`N files, M selected, X KB`) and a "select all" toggle.
5. Fetch errors (tree too large, nonexistent ref) surface as an inline alert (P-228).
6. Test: expand/collapse, single + folder select, counts, API error.

**Required MCPs/Connectors:** None — calls `serve` REST (tree via P-103).

**Skills to Invoke:** ui-ux-pro-max (density + keyboard a11y for tree).

**Acceptance Criteria:**
- [ ] Fetch + render expandable tree for A (virtualized for large repos)
- [ ] Single file + folder (descendants) selection
- [ ] Counts header + select all
- [ ] Selection persisted to store as `FileSelection` (P-148)
- [ ] API errors surface inline
- [ ] Tests pass

**Tests Required:** `FileTree.test.tsx` (mocked tree):
- `it('expands collapses')`, `it('selects file')`, `it('selects folder')`, `it('shows counts')`, `it('error surface')`

**Dependencies:** P-212 (A ref). Tree P-103, selection P-148/215.

**Handoff Notes:** Next: P-214 file tree B. `FileTree` is slot-agnostic; P-214 binds it to B. Keep `getTree` returning flattened entries and let the component derive hierarchy (one source of truth).

---




### P-214: Web - File Tree B

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-213

**Context:** File selection for repo B (mirror of A). This phase binds the P-213 `FileTree` component to the B slot/B store key and adds split-view UX: a side-by-side A/B tree layout so the user compares both sources' selections at once, plus per-slot selection summaries and a combined "Continue to merge" gate.

**Files to Create/Modify:**
- `packages/web/src/pages/SelectPage.tsx` (modify — split view A/B)
- `packages/web/src/components/SplitTreeView.tsx` (new)
- `packages/web/src/store/selection.ts` (extend — `selectionA`, `selectionB`)

**Implementation Steps:**
1. Extend store with `selectionA`/`selectionB` (each a `FileSelection` P-148 keyed by path).
2. `SplitTreeView.tsx`: layout two `FileTree`s (A and B) side-by-side with independent scroll; on small widths it stacks (P-227 responsive).
3. `SelectPage.tsx`: render `SplitTreeView`; header shows combined counts (`A: n files · B: m files`); a sticky footer has "Continue to Merge" enabled only when `selectionA` and `selectionB` are non-empty (else explain why).
4. Cross-highlight: if a path exists in both trees, optionally highlight it (conflict preview for P-217/P-219) with a toggle.
5. Persist both selections to store so MergePage (P-216) and merge (P-192) use them.
6. Test: split render, per-slot counts, continue gating, cross-highlight toggle.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (comparison layout).

**Acceptance Criteria:**
- [ ] A/B trees render side-by-side (stack on small widths)
- [ ] Per-slot selection counts in header
- [ ] "Continue to Merge" gated on both non-empty
- [ ] Cross-path highlight toggle works
- [ ] Selections persisted for merge
- [ ] Tests pass

**Tests Required:** `SelectPage.test.tsx`:
- `it('renders both trees')`, `it('counts per slot')`, `it('gates continue')`, `it('cross highlight toggle')`

**Dependencies:** P-213. Selection P-215.

**Handoff Notes:** Next: P-215 selection state (central store). The A/B selection contract (path→FileSelection) is finalized here; keep the store keys stable for merge P-192/provenance P-181.

---




### P-215: Web - Selection State

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-214

**Context:** Single source of truth for UI state. This phase centralizes all selections, run status, and flow state in a typed Zustand store, providing the derived selectors (can-proceed gates) every screen + the merge pipeline use. It's the contract that keeps A/B trees, stepper, and merge consistent (and matches the `FileSelection`/decision shapes from core P-148/P-160).

**Files to Create/Modify:**
- `packages/web/src/store/index.ts` (new — combine slices)
- `packages/web/src/store/sources.ts`, `store/selection.ts`, `store/run.ts`, `store/flow.ts` (new slices)
- `packages/web/src/store/selectors.ts` (new — derived)
- `packages/web/src/store/*.test.ts` (new)

**Implementation Steps:**
1. Define typed state slices:
   - `sources`: `sourcesA`/`sourcesB` (refs, status) — from P-211/212.
   - `selection`: `selectionA`/`selectionB` (`Record<path, SelectedEntry>` P-148) — from P-213/214.
   - `run`: `RunStatus` (idle/running/approved/rejected/succeeded/failed), `currentStep`, `progress` events (P-216), AI stream state.
   - `flow`: `steps` metadata + `activeStep`, `visited` (powers P-210 stepper).
2. `selectors.ts` derived: `canProceedSources`, `canProceedSelection`, `canStartMerge`, `fileCount(slot)`, `conflictPaths(A∩B)` (for P-217).
3. Actions: `setSources`, `togglePath(slot,path)`, `setSelection`, `setRunStatus`, `advanceStep`, `reset` (used when sources change, P-212).
4. Ensure immutability (Zustand default) and devtools middleware for debugging.
5. Test each slice + selectors (including A∩B conflict computation).

**Required MCPs/Connectors:** None — client store only.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Sources/selection/run/flow slices typed + persisted via Zustand
- [ ] Derived selectors: can-proceed gates, fileCounts, conflictPaths
- [ ] Actions mutate and trigger re-renders correctly
- [ ] A∩B conflict paths computed for P-217
- [ ] Reset clears downstream on source change
- [ ] Tests pass

**Tests Required:** `store/*.test.ts`:
- `it('sources slice')`, `it('selection toggle')`, `it('run status')`, `it('selectors can proceed')`, `it('conflict paths')`, `it('reset')`

**Dependencies:** P-214. Core selection P-148, HIL P-160.

**Handoff Notes:** Next: P-216 AI thinking stream. This store is the fixed UI contract; all phases P-216→P-228 read/write these slices. Keep types in `store/types.ts` shared with API responses.

---




### P-216: Web - AI Thinking Stream

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-215

**Context:** Users watch the agent reason. This phase surfaces the streaming AI reasoning (P-142/P-162) in the UI: a live "thinking" panel during merge showing token-level reasoning, current tool calls (select_files/detect_gaps/resolve_deps/edit_config... from P-148–P-157), and progress — consumed via the WS channel (P-223+P-193) or SSE. It's the transparency surface for the merge step.

**Files to Create/Modify:**
- `packages/web/src/components/ThinkingStream.tsx` (new)
- `packages/web/src/components/ToolCallRow.tsx` (new)
- `packages/web/src/page/MergePage.tsx` (modify placeholder → thinking + trigger merge)
- `packages/web/src/hooks/useMergeStream.ts` (new — WS/SSE subscription)
- `packages/web/src/components/ThinkingStream.test.tsx` (new)

**Implementation Steps:**
1. `useMergeStream.ts`: connect to the WS hub (P-193 `UseWs`) with auto-reconnect (P-223 later, but stub the reconnect now); subscribe to `server:event` messages; parse into `ThinkingEvent {type:'reasoning', id, text}` | `{type:'tool', toolName, args, status}` | `{type:'progress', step, status}`.
2. `ThinkingStream.tsx`: virtualized/log-growing list of reasoning tokens + tool rows; a "thinking" indicator when reasoning active (P-142); cap rendering (e.g. last 2000 tokens) to avoid perf issues.
3. `ToolCallRow.tsx`: render each tool call as a chip with name + collapsed args + status (running → spinner P-020 color, done → check, failed → cross + retry hint). Click expands JSON args.
4. `MergePage.tsx`: a "Run Merge" button (gated on `canStartMerge` P-215) that POSTs `/api/merge` (P-192) and streams results; shows the thinking stream + final summary (files/deps/licenses) on success; surfaces denied (P-160/P-120) states.
5. Respect dark mode (P-226) and reduced-motion.
6. Test with a mocked WS event pump (reasoning, tool call, progress, done).

**Required MCPs/Connectors:** WS to `serve` (P-193).

**Skills to Invoke:** ui-ux-pro-max (streaming/typing UI).

**Acceptance Criteria:**
- [ ] Live reasoning + tool calls render from stream
- [ ] Reasoning indicator + tool status states
- [ ] Cap on rendered tokens; expandable tool args
- [ ] Merge button gated; POST `/api/merge`; summary/denied states
- [ ] Auto-reconnect stub (P-223 later)
- [ ] Tests pass with mocked events

**Tests Required:** `useMergeStream`/`ThinkingStream.test.tsx`:
- `it('renders reasoning')`, `it('renders tool status')`, `it('caps tokens')`, `it('merge button gate')`, `it('denied state')`

**Dependencies:** P-215. WS P-223, reasoning P-142/162, merge P-192.

**Handoff Notes:** Next: P-217 diff viewer. This is the transparency layer — keep tool-call rendering reusable (also used in review P-218). The event JSON shape is set by P-162; don't hardcode differing shapes.

---




### P-217: Web - Diff Viewer

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-216

**Context:** Before approving, users need to SEE what changed. This phase builds the diff viewer showing proposed stitch changes (new files from A/B, merged manifests, modified configs) in a unified/split diff with syntax highlighting, side-by-side and per-file navigation. It's the review surface feeding the Approve/Reject gate (P-218).

**Files to Create/Modify:**
- `packages/web/src/components/DiffViewer.tsx` (new)
- `packages/web/src/components/DiffHunk.tsx` (new)
- `packages/web/src/hooks/useProposedDiff.ts` (new — fetch `/api/merge/proposed-diff` P-192 dry-run)
- `packages/web/src/components/DiffViewer.test.tsx` (new)

**Implementation Steps:**
1. `useProposedDiff.ts`: GET `/api/merge/proposed-diff` (uses `--dry-run` P-192) → array of `{path, kind:add|modify|delete, oldText?, newText}`.
2. `DiffHunk.tsx`: render a single file's hunks — line numbers, `+/-/ctx` coloring (P-209 tokens), syntax highlight via `shiki`/`prism` (lazy-load languages on file ext).
3. `DiffViewer.tsx`: file list rail (added/modified/deleted grouped) + main diff pane; unified/split toggle; "whitespace off" toggle (ignore eol/ws); click rail file → pane jumps; line counts + total changed.
4. Provide "copy hunk"/"view raw" per file; fetch/parse errors inline (P-228).
5. Ensure perf: virtualize long diffs; lazy-load heavy highlighters.
6. Test: renders added/deleted/modified correctly, toggle behaviors, highlighting, error surface.

**Required MCPs/Connectors:** None — `serve` REST (dry-run P-192).

**Skills to Invoke:** ui-ux-pro-max (code readability + diff ergonomics).

**Acceptance Criteria:**
- [ ] Renders add/modify/delete with line numbers + syntax highlight
- [ ] Unified/split + whitespace-ignore toggles
- [ ] File rail navigation; counts + totals
- [ ] View raw / copy hunk
- [ ] Virtualized for large diffs; errors inline
- [ ] Tests pass

**Tests Required:** `DiffViewer.test.tsx`:
- `it('renders kinds')`, `it('toggles unified split')`, `it('toggles whitespace')`, `it('navigates files')`, `it('errors inline')`

**Dependencies:** P-216. Dry-run P-192, tokens P-209.

**Handoff Notes:** Next: P-218 approve/reject gate. The diff data shape (`/api/merge/proposed-diff`) is fixed here; the Approve/Reject gate renders this viewer locked, letting the user accept per-file or whole. Keep the viewer decoupled from merge mutation.

---




### P-218: Web - Approve/Reject Gate

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-217

**Context:** The human-in-the-loop approval point. After the diff review, the user approves or rejects the proposed merge (whole-merge), or narrows to per-file accept/exclude, before child repo C is written. This phase builds the gate UI around the P-217 diff viewer, dispatches the decision to core (P-160 HIL approve/reject via `serve`), and routes to Results or a rejection explanation. It's the web face of the HIL gate (P-160/P-156).

**Files to Create/Modify:**
- `packages/web/src/pages/ReviewPage.tsx` (new — gate screen)
- `packages/web/src/components/ApprovalBar.tsx` (new)
- `packages/web/src/api/merge.ts` (extend — `approveMerge`, `rejectMerge`)
- `packages/web/src/pages/ReviewPage.test.tsx` (new)

**Implementation Steps:**
1. `api/merge.ts`: POST `/api/merge/approve` `{include: string[], exclude: string[], note}` → finalizes C (P-192); POST `/api/merge/reject` `{reason}` → aborts with reason recorded (P-187 audit, P-160).
2. `ReviewPage.tsx`: header shows A/B sources + counts; renders `DiffViewer` (P-217) in a locked "review" mode; footer `ApprovalBar`:
   - Primary **Approve & Create C** (enabled when no blocking issues, P-160) → confirm dialog → POST approve.
   - **Reject** → textarea for reason → POST reject → shows rejection summary.
   - Per-file: a checkbox row to exclude a file from the merge (adjusts `include`), recomputing totals.
3. Blocking conditions (from license P-220/deps P-219/sandbox P-221) prevent approve with an inline explanation + link to the relevant panel.
4. On success: route to Results (P-221/P-222); on reject: show reason + offer to edit selection (back to Select).
5. Test: approve posts include/exclude, reject posts reason, blocking blocks approve, routing on success.

**Required MCPs/Connectors:** None — `serve` REST (HIL P-160).

**Skills to Invoke:** ui-ux-pro-max (decision UI + confirmation dialogs).

**Acceptance Criteria:**
- [ ] Approve finalizes C with adjusted include/exclude; confirm dialog
- [ ] Reject records reason and shows summary
- [ ] Blocking conditions prevent approve with explanation
- [ ] Per-file exclude updates counts
- [ ] Routes to Results/reject path correctly
- [ ] Tests pass

**Tests Required:** `ReviewPage.test.tsx` (mocked API):
- `it('approve posts include exclude')`, `it('reject posts reason')`, `it('blocking blocks approve')`, `it('per file exclude')`, `it('routes on success')`

**Dependencies:** P-217. HIL P-160, merge P-192, audit P-187.

**Handoff Notes:** Next: P-219 deps conflict panel. The gate is the single write path to finalize C from the web; keep `include/exclude` faithful so core's `FileSelection` matches what the user saw.

---




### P-219: Web - Deps Conflict Panel

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-218

**Context:** Users must resolve dependency conflicts before approving. This phase renders the dependency conflict review (from core P-116/P-109/P-111) as an interactive panel: a table of conflicts with proposed resolutions, per-conflict resolution pickers, dedupe/summary stats, and a "resolve all" action — persisting decisions back so merge (P-192) honors them. It's the web version of `stitch deps` (P-197).

**Files to Create/Modify:**
- `packages/web/src/components/DepsPanel.tsx` (new)
- `packages/web/src/components/ConflictRow.tsx` (new)
- `packages/web/src/api/deps.ts` (new)
- `packages/web/src/components/DepsPanel.test.tsx` (new)

**Implementation Steps:**
1. `api/deps.ts`: GET `/api/deps/report` (P-116/P-197) → `DependencyReport`; POST `/api/deps/resolve` `{package, resolution}` (persist to config, P-200).
2. `DepsPanel.tsx`: header (dep counts + verdict P-203-ish), a summary (dedupes, scripts, lockfile), and a conflict table: rows = package + severity (P-203 colors P-209) + upstream versions + resolution options.
3. `ConflictRow.tsx`: per-row a `<select>` of allowed resolutions (from P-111 resolver); "apply" persists via POST; a row-level "use suggested" loads the resolver's choice (P-151); shows a "resolved ✓" state.
4. "Resolve all" applies suggested resolutions to all `review`-level conflicts and reports `error`-level ones as blocking (must be handled manually → explains the Approve block P-218).
5. Emits a `depsResolved` store flag that P-218 reads for its approve gate.
6. Test: report render, per-row resolve persists, resolve all, blocking error conflicts.

**Required MCPs/Connectors:** None — `serve` REST (deps P-116/P-197).

**Skills to Invoke:** ui-ux-pro-max (data table density).

**Acceptance Criteria:**
- [ ] Renders dep report stats + conflict table with severities
- [ ] Per-row resolution persists to config
- [ ] "Resolve all" applies review-level suggested; error-level blocks
- [ ] `depsResolved` flag gates approve (P-218)
- [ ] Resolved state shown per row
- [ ] Tests pass

**Tests Required:** `DepsPanel.test.tsx`:
- `it('renders conflicts')`, `it('per row resolve')`, `it('resolve all')`, `it('error blocks')`, `it('flags approve gate')`

**Dependencies:** P-218. Deps P-116/P-109/P-111/P-197, config P-200.

**Handoff Notes:** Next: P-220 license panel. The persisted resolutions here are the same config P-192/P-197 read; keep the report shape flat for the table and stable for the API.

---




### P-220: Web - License Panel

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-219

**Context:** License compliance is a hard gate. This panel renders the license posture of the proposed C (from core P-128 `LicenseReportData`): per-package declared/normalized/license/decision, the overall verdict, GPL warnings, dual-license options, and pending unknowns that need an allow/deny decision (P-123/P-127). Users make decisions here that feed the approve gate (P-218) and merge (P-196).

**Files to Create/Modify:**
- `packages/web/src/components/LicensePanel.tsx` (new)
- `packages/web/src/components/LicenseUnknownRow.tsx` (new)
- `packages/web/src/api/licenses.ts` (new)
- `packages/web/src/components/LicensePanel.test.tsx` (new)

**Implementation Steps:**
1. `api/licenses.ts`: GET `/api/licenses/report` (P-128) → `LicenseReportData`; POST `/api/licenses/decide` `{licenseId, verdict: allow|deny}` (persist to policy/overrides, P-127/P-124 overrides config).
2. `LicensePanel.tsx`: verdict banner (pass/warn/block, colors P-209/P-203), a package table (declared → normalized → category → decision), sections for GPL warnings (P-120), dual-license options (P-122), and pending unknowns (P-123).
3. `LicenseUnknownRow.tsx`: for each pending unknown, `allow`/`deny`/`skip` buttons that POST the decision, mark resolved, and refresh the verdict.
4. Hard matrix `deny` rows cannot be flipped to allow (P-120) — shown locked with an explanation (P-196 parity).
5. Emits `licensesClear` flag: approve (P-218) requires all blocks resolved and no hard denies outstanding.
6. Test: report render, unknown decision posts + updates, locked hard-deny, verdict banner, approve gating.

**Required MCPs/Connectors:** None — `serve` REST (license P-128).

**Skills to Invoke:** ui-ux-pro-max (compliance clarity + severity color).

**Acceptance Criteria:**
- [ ] Verdict banner + package table + GPL/dual/unknown sections render
- [ ] Unknown decisions POST + update verdict; resolved state
- [ ] Hard matrix deny locked (can't allow)
- [ ] `licensesClear` gates approve
- [ ] Test coverage

**Tests Required:** `LicensePanel.test.tsx`:
- `it('renders report')`, `it('decides unknown')`, `it('locks hard deny')`, `it('verdict banner')`, `it('gates approve')`

**Dependencies:** P-219. License P-128/P-120/P-122/P-123/P-127/P-196.

**Handoff Notes:** Next: P-221 sandbox results. The decision persistence in this panel matches `stitch license` (P-196) — same config keys, so CLI and web agree. Never present a hard-deny as allowed.

---




### P-221: Web - Sandbox Results

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-220

**Context:** Users need to see that the merged C actually builds/tests. This phase renders sandbox results (P-177/P-172/P-173): build status, test results (pass/fail counts), captured logs/artifacts, resource usage, and the pass/fail + verify verdict that gates approval. It's the web read of the sandbox run.

**Files to Create/Modify:**
- `packages/web/src/components/SandboxPanel.tsx` (new)
- `packages/web/src/components/BuildLog.tsx` (new)
- `packages/web/src/api/sandbox.ts` (new)
- `packages/web/src/components/SandboxPanel.test.tsx` (new)

**Implementation Steps:**
1. `api/sandbox.ts`: GET `/api/sandbox/result/<jobId>` (P-177) → `SandboxResult {build, tests, logs, artifacts, limits, verdict}`; GET `/api/sandbox/capabilities` (docker vs gh fallback P-168/P-178).
2. `SandboxPanel.tsx`: `capabilities` header (docker | gh-fallback | unavailable); build card (status + duration + exit); tests card (passed/failed/skipped counts + failures list with snippets); a `limits` line (timeout/mem P-176); overall `verdict: pass|fail|warn` with the verifying badge (P-150-style).
3. `BuildLog.tsx`: collapsible flat log viewer (scrollable, line-addressed, colored by level P-209) for build/test output; download raw log link.
4. Artifacts section lists produced files (P-174) with download.
5. Emits `sandboxPass` flag; P-218 approve requires it (a fail is blocking unless a warn is explicitly acknowledged).
6. Test: capabilities render, build/test cards, log viewer, verdict, artifact list, approve gating.

**Required MCPs/Connectors:** None — `serve` REST (sandbox P-177/P-178).

**Skills to Invoke:** ui-ux-pro-max (log + test-result clarity).

**Acceptance Criteria:**
- [ ] Capabilities header (docker/gh/unavailable)
- [ ] Build + test cards, failures with snippets, limits
- [ ] Log viewer + download; artifacts listed with download
- [ ] verdict pass/fail/warn; `sandboxPass` gates approve
- [ ] Tests pass

**Tests Required:** `SandboxPanel.test.tsx`:
- `it('renders capabilities')`, `it('build tests cards')`, `it('renders logs')`, `it('artifacts')`, `it('verdict gates approve')`

**Dependencies:** P-220. Sandbox P-168–P-178.

**Handoff Notes:** Next: P-222 CREDITS preview. The result shape comes from core P-177/P-178; keep it stable for the grid. A sandbox failure should never pass the gate silently.

---




### P-222: Web - CREDITS Preview

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-221

**Context:** Transparency into attribution before shipping. This phase renders the provenance CREDITS (P-182) and provenance map (P-181) as a preview: author/repo/commit attribution per file (grouped by source repo), the generated `CREDITS.md` content, and a link to the full SBOM (P-183). Users confirm the attribution looks right before finalizing (P-218).

**Files to Create/Modify:**
- `packages/web/src/components/CreditsPreview.tsx` (new)
- `packages/web/src/components/ProvenanceTable.tsx` (new)
- `packages/web/src/api/provenance.ts` (new)
- `packages/web/src/components/CreditsPreview.test.tsx` (new)

**Implementation Steps:**
1. `api/provenance.ts`: GET `/api/provenance/credits` (P-182) → `{text, groups}`; GET `/api/provenance/map` (P-181) → `Record<path, FileOrigin{repo, commit, author}>`; GET `/api/provenance/sbom` (P-183) → SBOM JSON.
2. `ProvenanceTable.tsx`: a table per-source-repo group: file path | commit | author; filter input by path/author; counts.
3. `CreditsPreview.tsx`: tabs — "CREDITS.md" (the generated text, monospace, copy button), "Per-file attribution" (the table), "SBOM" (JSON/pretty view). Footer shows total files + repos.
4. A checkbox "attribution looks correct" sets `creditsConfirmed` (P-218 approve gate condition for provenance completeness).
5. Test: groups render, filter, credits text, sbom view, confirmation flag.

**Required MCPs/Connectors:** None — `serve` REST (P-181/182/183).

**Skills to Invoke:** ui-ux-pro-max (provenance tabular clarity).

**Acceptance Criteria:**
- [ ] CREDITS text + per-file table (grouped by repo) + SBOM tabs
- [ ] Filter by path/author; copy credits
- [ ] Confirmation checkbox gates approve (provenance complete)
- [ ] Counts footer
- [ ] Tests pass

**Tests Required:** `CreditsPreview.test.tsx`:
- `it('renders groups')`, `it('filters')`, `it('copies credits')`, `it('sbom view')`, `it('confirmation flag')`

**Dependencies:** P-221. Provenance P-181/182/183.

**Handoff Notes:** Next: P-223 WS client + reconnect (now implement the real transport). The `/api/provenance/*` contract is set here; CREDITS correctness (P-182) is what ships in C.

---




### P-223: Web - WS Client + Reconnect

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-222

**Context:** The real-time transport for streams, job events, and HIL. This phase implements the production WebSocket client (the P-216 stub becomes real): a typed WS client that connects to `serve`'s `/ws` hub (P-193), auto-reconnects with backoff, buffers events while disconnected, re-subscribes on reconnect, and exposes typed subscriptions used by ThinkingStream (P-216), JobHistory (P-224), and HIL. It's the core of live UI updates.

**Files to Create/Modify:**
- `packages/web/src/lib/ws.ts` (new — client class)
- `packages/web/src/hooks/useWsTopic.ts` (new — typed hook per topic)
- `packages/web/src/lib/ws.test.ts` (new)

**Implementation Steps:**
1. `ws.ts`:
   - `class WsClient` — connect(url), `subscribe<T>(topic, cb)`, `publish(topic,msg)`, `close()`, `onStatus(cb)`.
   - Reconnect: exponential backoff (e.g. 500ms→30s, jittered), reset on open.
   - Buffer: while offline, queue `publish`es; on reconnect, flush + re-subscribe (`hello {topics}` to `serve` P-193) so no job events missed.
   - Heartbeat: ping/pong or message-id ACK to detect stale connections.
   - Message envelope: `{id, topic, payload, ts}` (matches P-193 hub).
2. `useWsTopic<T>(topic)`: React hook returning `{events: T[], last, status, send(msg)}`, isolating re-renders.
3. Wire it into `useMergeStream` (P-216) and expose a singleton `WsClient` for JobHistory (P-224) + HIL (P-218).
4. Dispatch `connectionStatus` to a store slice so the shell can show "reconnecting" (P-210).
5. Test: connect/disconnect, subscribe+publish round-trip, reconnect buffers+flushes, re-subscribe, heartbeat stale detection.

**Required MCPs/Connectors:** WS to `serve` (P-193).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Connects to `/ws`; typed subscribe/publish
- [ ] Auto-reconnect with backoff; buffers publishes while down
- [ ] Re-subscribes topics on reconnect; no missed job events
- [ ] Heartbeat detects stale connection
- [ ] `useWsTopic` hook isolates re-renders; status surfaced in shell
- [ ] Tests pass

**Tests Required:** `ws.test.ts` (in-memory WS server):
- `it('round trips')`, `it('reconnects')`, `it('buffers while down')`, `it('resubscribes')`, `it('heartbeat stale')`

**Dependencies:** P-222. WS hub P-193, events P-162.

**Handoff Notes:** Next: P-224 job history. This is the single realtime transport — both ThinkingStream (P-216) and JobHistory (P-224) consume it; keep the envelope fields fixed so HIL messages (P-218) fit the same subscription.

---




### P-224: Web - Job History

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-223

**Context:** Users want to see prior runs. This phase builds a job-history list: past merges/verifications (from `ProvenanceAudit` P-187 + job store P-239) with status, duration, timestamp, and a link to re-open the result (sandbox result P-221, CREDITS P-222, diffs P-217). Live updates flow via the WS client (P-223) as new jobs complete.

**Files to Create/Modify:**
- `packages/web/src/pages/HistoryPage.tsx` (new)
- `packages/web/src/components/JobRow.tsx` (new)
- `packages/web/src/api/jobs.ts` (new)
- `packages/web/src/pages/HistoryPage.test.tsx` (new)

**Implementation Steps:**
1. `api/jobs.ts`: GET `/api/jobs` (P-247) → `JobSummary[] {id, kind (merge|verify...), status, started, finished?, durationMs, result?}`; GET `/api/jobs/<id>` → detail (provenance P-181, sandbox P-177, checksums P-186).
2. `JobRow.tsx`: status icon (running spinner P-216/colored P-209), kind, timestamp, duration, and expand-to-detail (result summary + links to sandbox result/credits/diff when present).
3. `HistoryPage.tsx`: initial list from API, then live-updates on WS `job:*` events (P-223) — prepend new, patch status of running, mark done. Filter by kind + status; a "re-run" button re-POSTs the job (P-192 with saved sources).
4. Empty/error states (P-228); virtualized list for large history.
5. Test: list render, live WS update, filters, re-run, empty/error.

**Required MCPs/Connectors:** None — `serve` REST + WS.

**Skills to Invoke:** ui-ux-pro-max (list + live status).

**Acceptance Criteria:**
- [ ] Job history list from API; live updates via WS
- [ ] Expandable detail linked to sandbox/credits/diff
- [ ] Filter by kind/status; re-run a job
- [ ] Empty/error states + virtualized
- [ ] Tests pass

**Tests Required:** `HistoryPage.test.tsx` (mocked jobs + WS):
- `it('renders history')`, `it('live ws update')`, `it('filters')`, `it('rerun')`, `it('empty error')`

**Dependencies:** P-223. Jobs P-247, audit P-187, WS P-223.

**Handoff Notes:** Next: P-225 settings. The job detail links cross-reference the earlier panels; keep `JobSummary` fields stable (they back `stitch status` P-194 too).

---




### P-225: Web - Settings

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-224

**Context:** Users configure the tool from the UI. This phase builds the Settings page: AI provider + model (P-134), theme (P-202/P-226), license policy (allow/deny defaults P-127), sandbox defaults (P-176), network/offline (P-146), and provider-key status (read-only) — persisted to config via `serve` (P-200/P-193). Changes apply to subsequent runs.

**Files to Create/Modify:**
- `packages/web/src/pages/SettingsPage.tsx` (new)
- `packages/web/src/components/settings/*.tsx` (per-section)
- `packages/web/src/api/settings.ts` (new)
- `packages/web/src/pages/SettingsPage.test.tsx` (new)

**Implementation Steps:**
1. `api/settings.ts`: GET `/api/settings` (P-200 effective config) and PATCH `/api/settings` `{patch}` (validated + persisted, P-200 `writeConfig`); provider-key status `{set: boolean}` (masked, no value leaked).
2. Section components:
   - **AI**: provider select (openrouter/anthropic/ollama P-134), model select (P-135 registry), streaming toggle, token budget (P-143) — all read/write config.
   - **Appearance**: theme (light/dark/auto P-226), CLI theme color (P-202 parity).
   - **Licenses**: default allow/deny policy + overrides (P-127/P-124) list with add/remove.
   - **Sandbox**: default timeout/memory/jobs (P-176/P-204) + capability indicator (P-178).
   - **Network**: offline toggle (P-146).
3. Each section: load current value, edit, "save" PATCHes + shows success/validation error (P-228); unsaved-changes guard navigating away.
4. Settings changes reflect in the shell immediately (dark P-226) and persist for next runs.
5. Test load/save per section, validation errors, unsaved guard, provider-key masked status.

**Required MCPs/Connectors:** None — `serve` REST (config P-200).

**Skills to Invoke:** ui-ux-pro-max (settings forms).

**Acceptance Criteria:**
- [ ] AI/appearance/license/sandbox/network sections load + save
- [ ] Provider/model registry from P-134/P-135; streaming/budget
- [ ] License policy overrides editable
- [ ] Unsaved-changes guard; validation errors shown
- [ ] Provider-key status masked (no leak)
- [ ] Tests pass

**Tests Required:** `SettingsPage.test.tsx`:
- `it('loads sections')`, `it('saves ai')`, `it('edits license policy')`, `it('unsaved guard')`, `it('validates')`, `it('masks key status')`

**Dependencies:** P-224. Config P-200, provider P-134/135.

**Handoff Notes:** Next: P-226 dark mode. Settings is the config-write surface; always PATCH through `serve` so CLI and web stay consistent (one config file). Never render key values.

---




### P-226: Web - Dark Mode

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-225

**Context:** Theme-aware app. This phase implements dark mode end-to-end: `data-theme` attribute switching (P-209 token sets), OS-prefers-color-scheme detection with auto option (P-225), persistent choice, and a shell toggle — while ensuring every component uses tokens (no hardcoded colors) so both themes are correct and accessible (contrast P-209).

**Files to Create/Modify:**
- `packages/web/src/theme/ThemeProvider.tsx` (new)
- `packages/web/src/hooks/useTheme.ts` (new)
- `packages/web/src/shell/ThemeToggle.tsx` (new)
- `packages/web/src/theme/ThemeProvider.test.tsx` (new)

**Implementation Steps:**
1. `ThemeProvider.tsx`: reads persisted theme (`auto|light|dark`, stored per P-225 settings), applies `data-theme` to `<html>`; listens to `matchMedia('(prefers-color-scheme: dark)')` in `auto` mode and updates live.
2. `useTheme.ts`: `{theme, setTheme, resolved (light|dark)}`; `setTheme` persists via settings API/PATCH (P-225) + localStorage fallback.
3. `ThemeToggle.tsx`: in the shell header (P-210) — cycles light/dark/auto (or a two-state toggle honoring the auto default); accessible (`aria-pressed`, focus) and keyboard.
4. Audit every existing web component (P-208→P-225) for hardcoded colors; replace with P-209 tokens so dark is complete (a checklist + a grep guard via lint/test).
5. Ensure both themes meet contrast (P-209 test rerun under `data-theme=dark`).
6. Test: switching applies attribute, auto follows OS change, persistence, toggle accessible.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None (uses tokens P-209).

**Acceptance Criteria:**
- [ ] `data-theme` switches light/dark/auto; persists
- [ ] Auto follows OS `prefers-color-scheme` live
- [ ] Shell toggle cycles; accessible + keyboard
- [ ] All components token-based (no hardcoded colors) — grep guard
- [ ] Contrast passes under both themes
- [ ] Tests pass

**Tests Required:** `ThemeProvider.test.tsx`:
- `it('applies theme attribute')`, `it('auto follows os')`, `it('persists choice')`, `it('toggle accessible')`

**Dependencies:** P-225. Tokens P-209, shell P-210.

**Handoff Notes:** Next: P-227 responsive. Done right, dark mode is "flip tokens" — if any component shows color bugs, it's a token violation, not a theme problem. Keep the toggle visible on all route shells.

---




### P-227: Web - Responsive

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-226

**Context:** Usable across screens — desktop workbench and narrow/mobile review. This phase makes the shell and all panels responsive: breakpoint-aware navigation (sidebar collapses to a stepper bar / drawer on small widths P-210), split views stack (P-214), diff/panels become full-width single columns, and touch targets + scroll areas are mobile-safe. Verified via viewport-based component tests + a manual pass at common breakpoints.

**Files to Create/Modify:**
- `packages/web/src/shell/AppShell.tsx` (modify — responsive nav)
- `packages/web/src/components/SplitTreeView.tsx` (modify — stack on narrow)
- `packages/web/src/styles.css` (modify — breakpoint utilities)
- `packages/web/src/shell/AppShell.responsive.test.tsx` (new)

**Implementation Steps:**
1. Breakpoint scale (P-209 spirit, e.g. sm/md/lg) via Tailwind; audit shell: `Sidebar` (P-210) becomes a bottom stepper bar or slide-in drawer below `lg`; header stays compact (collapse brand + icon-only toggle).
2. `SplitTreeView` (P-214): below `md`, render A and B as stacked/accordion sections instead of side-by-side.
3. Diff/detail panels (P-217/219/220/222): below `md`, full-width single column; tables become horizontally scrollable cards; log viewer keeps min-height with scroll.
4. Touch: bump interactive targets to ≥44px in compact mode; ensure scroll containers have `overscroll-behavior` + momentum (iOS).
5. Add a `useViewport`/matchMedia-driven store hint so components share breakpoint state instead of duplicated CSS-only logic.
6. Test: render at mobile/narrow/desktop mock widths (jsdom + matchMedia), assert stacking + nav forms + touch target.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (responsive patterns).

**Acceptance Criteria:**
- [ ] Nav adapts (drawer/stepper bar) below breakpoint
- [ ] Split views stack on narrow; panels full-width scroll
- [ ] Touch targets ≥44px in compact; scroll containers smooth
- [ ] Shared breakpoint hint via store
- [ ] Viewport tests at mobile/narrow/desktop pass

**Tests Required:** `AppShell.responsive.test.tsx`:
- `it('compact nav form')`, `it('stacks split view')`, `it('touch targets')`, `it('desktop unchanged')`

**Dependencies:** P-226. Shell P-210, split P-214, tokens P-209.

**Handoff Notes:** Next: P-228 error boundaries (closes the Web epic). Keep responsive logic data-driven (store breakpoint) so it's testable and consistent; avoid per-component media-query soup.

---




### P-228: Web - Error Boundaries

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-227

**Context:** The app must never white-screen. This phase adds typed error handling across the web surface: a root React error boundary (render crashes), per-route boundaries, data-fetch/API error surfaces (reusable Alert/toast so P-211–P-227 fetch errors show consistently), and friendly error messages mapped from the CLI/core error codes (P-203). It closes the Web epic's robustness contract.

**Files to Create/Modify:**
- `packages/web/src/components/ErrorBoundary.tsx` (new)
- `packages/web/src/components/Alert.tsx` (new)
- `packages/web/src/lib/errors.ts` (new — map core codes → UI message)
- `packages/web/src/router.tsx` (modify — wire boundary)
- `packages/web/src/components/ErrorBoundary.test.tsx` (new)

**Implementation Steps:**
1. `ErrorBoundary.tsx`: class boundary capturing render errors → shows a fallback (icon, message, "reload" + "copy error id" buttons) and logs via logger (P-206/207) with an error id for tracing (P-248). Route-aware: a nested boundary per route page so one failing panel doesn't kill the whole app.
2. `errors.ts`: `toUiError(code, raw)` mapping core/CLI codes (P-203 / P-163: config, license, sandbox, ai, deps, hil_abort...) → `{title, message, recovery}` (e.g. license→"run stitch license"), respecting theme/color.
3. `Alert.tsx`: a reusable inline/`toast` alert component (severity P-209 colors) used as the standard error surface — replaces ad-hoc error markup across P-211–P-227, and a `use`-able toast host.
4. Wire `ErrorBoundary` at root + per route in `router.tsx` (P-210); fetch wrappers (`api/*`) throw typed errors → the boundary/alert renders `toUiError`.
5. Add a dev-only "throw test" to verify boundary recovers without unmounting the shell (P-210).
6. Test: render-error boundary recovers+logs child fails; toUiError mapping; Alert severities.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None (reuses patterns).

**Acceptance Criteria:**
- [ ] Root + per-route boundaries; one panel failure keeps the rest alive
- [ ] Fallback shows icon/message/reload/copy-id; logs error id
- [ ] `toUiError` maps core codes to actionable UI messages
- [ ] `Alert` standardizes all error surfaces (replaces ad-hoc)
- [ ] Fetch errors route through toUiError
- [ ] Tests pass

**Tests Required:** `ErrorBoundary.test.tsx`:
- `it('boundary catches render error')`, `it('per route isolation')`, `it('maps core codes')`, `it('alert severities')`

**Dependencies:** P-227. Errors P-203/163, tokens P-209.

**Handoff Notes:** Next: P-229 onboarding tour. This is the standard error substrate for the rest of the web surface; never render raw stack/JSON to users — always `toUiError`.

---




### P-229: Web - Onboarding Tour

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-228

**Context:** First-run guidance. This phase adds an onboarding tour (Tooltip-component-driven spotlight on the key screens) plus an empty-state hero: when no sources are configured, the Sources page shows a friendly explainer with a "show me how" tour cue. It's dismissible, respects reduced-motion (P-226/P-209), and only appears until dismissed/complete.

**Files to Create/Modify:**
- `packages/web/src/components/tour/Tour.tsx` (new — spotlight + tooltip host)
- `packages/web/src/components/tour/steps.ts` (new — step definitions)
- `packages/web/src/pages/SourcesPage.tsx` (modify — empty state + tour trigger)
- `packages/web/src/store/tour.ts` (new — dismissed flag, persisted)
- `packages/web/src/components/tour/Tour.test.tsx` (new)

**Implementation Steps:**
1. `steps.ts`: ordered step definitions `{target: selector, title, body, placement, nextLabel}` covering: add source A, add source B, select files, review diff, approve/create, view results/history.
2. `Tour.tsx`: a spotlight overlay highlighting `target` element + a tooltip card (P-209 tokens) with prev/next/skip; keyboard (esc skip, arrows/shortcuts) + focus trap; respects `prefers-reduced-motion` (fade not slide).
3. `tour.ts` store: `{dismissed: boolean, completed: boolean, step: number}` persisted (localStorage + P-225 settings), `start()/next()/skip()/complete()`.
4. `SourcesPage.tsx`: when `!store.sourcesA.length && !store.sourcesB.length` and not dismissed → render an empty-state hero (illustration, 3 bullets: "Pick A, pick B, click merge") with a "Take the tour" primary button; tour also auto-queues one time.
5. A config flag (`[web] tour=false`) disables; `?tour=1` forces on for demos.
6. Test: empty state renders, tour advances, skip/dismiss persists, reduced-motion respected.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (onboarding/microcopy).

**Acceptance Criteria:**
- [ ] Empty-state hero + "take the tour" on fresh Sources page
- [ ] Spotlight steps navigate correctly; prev/next/skip
- [ ] Dismiss/complete persists; keyboard + focus trap
- [ ] Reduced-motion respected
- [ ] `[web] tour=false` / `?tour=1` honored
- [ ] Tests pass

**Tests Required:** `Tour.test.tsx`:
- `it('empty state hero')`, `it('advances steps')`, `it('skip persists')`, `it('focus trap')`, `it('reduced motion')`

**Dependencies:** P-228. Store P-215, shell P-210, config P-200.

**Handoff Notes:** Next: P-230 session export/import. Keep tour steps strongly coupled to real UI selectors so they don't rot; add a test that asserts each target selector resolves on its page.

---




### P-230: Web - Session Export/Import

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-229

**Context:** Users need to save/share work-in-progress selections. This phase adds export/import of the session state (sources A/B + selections + resolutions + decisions) as a JSON bundle: export via `/api/session/export`, import via `/api/session/import` (server validates the bundle, P-200/P-215 store restore). This preserves picks across machines and lets teams share reproducible selections.

**Files to Create/Modify:**
- `packages/web/src/api/session.ts` (new)
- `packages/web/src/components/SessionBar.tsx` (new — export/import buttons)
- `packages/web/src/pages/SourcesPage.tsx` (modify — mount SessionBar)
- `packages/web/src/api/session.test.ts` (new)

**Implementation Steps:**
1. `api/session.ts`:
   - `exportSession()` GET `/api/session/export` → `SessionBundle {version, exportedAt, sources:{A,B}, selection:{A,B}, resolutions, licenseDecisions}` (subset of the P-215 store + P-109/P-127 decisions).
   - `importSession(bundle)` POST `/api/session/import` → validates version + shape (zod P-009/P-215), restores store via `/api`, returns conflicts/warnings (e.g. refs that no longer resolve).
2. `SessionBar.tsx`: an "Export" button downloads the bundle JSON (browser Blob); an "Import" file-picker reads a JSON, calls import, and on success populates the store + stepper (P-210) then routes to Select/Merge.
3. Handle mismatched refs: importer keeps a mapping and warns on unresolved (P-228 alert) rather than failing hard.
4. Add a version field and a coerce routine so older bundles import with defaults (P-200).
5. Test export shape, import validation, ref-mismatch warning, version coercion.

**Required MCPs/Connectors:** None — `serve` REST (store via P-215/P-200).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Export downloads JSON bundle with version + sources/selection/resolutions/decisions
- [ ] Import validates + restores; populates store + stepper
- [ ] Ref-mismatch warns (doesn't fail)
- [ ] Version coercion for older bundles
- [ ] Tests pass

**Tests Required:** `session.test.ts`:
- `it('exports bundle')`, `it('imports valid')`, `it('warns ref mismatch')`, `it('coerces version')`

**Dependencies:** P-229. Store P-215, config P-200.

**Handoff Notes:** Next: P-231 a11y. The bundle shape must round-trip the store exactly — keep a single zod schema shared between export/import (P-200) so it can't drift.

---




### P-231: Web - A11y

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-230

**Context:** Accessible by default. This phase hardens the web surface for keyboard/screen-reader/reduced-motion users: semantic landmarks, ARIA for the tree/diff/tabs/stepper, focus management (skip link, focus traps), visible focus, color-contrast compliance (P-209 both themes), and reduced-motion. It adds an automated a11y test layer (axe) + a keyboard pass over interactive panels.

**Files to Create/Modify:**
- `packages/web/src/a11y/index.ts` (new — `focusRing`, `skipLink`, focus helpers)
- `packages/web/src/shell/AppShell.tsx` (modify — skip link, landmarks)
- `packages/web/src/components/FileTree.tsx` (modify — tree ARIA: role=tree/treeitem, keyboard)
- `packages/web/src/components/DiffViewer.tsx` (modify — tabs ARIA, focus)
- `packages/web/.eslintrc` / `a11y.test.tsx` (new — axe scans)

**Implementation Steps:**
1. `a11y/index.ts`: `SkipLink` component, `visibleFocus` global style hook, and a `useFocusTrap` for dialogs/tour (P-229) + modal confirm (P-218).
2. `AppShell.tsx`: `<main>` landmark + skip-to-content link; header/sidebar semantic regions; ensure heading hierarchy.
3. `FileTree.tsx`: `role=tree`/`treeitem` with `aria-selected`, `aria-expanded`, roving tabindex, arrow-key navigation (up/down/left/right), and `aria-label` saying repo/ref context.
4. `DiffViewer.tsx` + panel tabs: proper `role=tablist/tab/tabpanel`, arrow-key tab switching, focus restored on active diff file.
5. Keyboard pass: every interactive element reachable + operable by keyboard; `:focus-visible` ring visible (P-209 no-color).
6. Automated: add `axe` scan in tests over the key screens (Sources, Select, Review, History, Settings) under both themes; fix violations. Add an eslint `jsx-a11y` rule gate.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** ui-ux-pro-max (a11y guidelines) — yes.

**Acceptance Criteria:**
- [ ] Skip link + semantic landmarks; logical heading order
- [ ] Tree role/aria + roving-tabindex + arrow-key nav
- [ ] Tabs role/aria + keyboard switching + focus restoration
- [ ] Visible `:focus-visible` everywhere; focus traps work
- [ ] axe scan clean on key screens (both themes); jsx-a11y gate passes
- [ ] Tests pass

**Tests Required:** `a11y.test.tsx` (axe):
- `it('axe clean sources')`, `it('axe clean select')`, `it('tree keyboard')`, `it('tabs keyboard')`

**Dependencies:** P-230. Tokens P-209, components P-210–P-222.

**Handoff Notes:** Next: P-232 virtualized trees. Treat a11y as a hard gate (failing axe blocks merge approval UX tier). Keep the tree keyboard model consistent with native tree widgets.

---




### P-232: Web - Virtualized Trees

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-231

**Context:** Big repos must not choke the UI. This phase replaces any eager tree rendering (P-213/214) with a proper infinite/virtualized tree: only visible nodes render, expanded subtrees are loaded on demand via the flat `/api/repos/<id>/tree` (P-213) + localized expansion, keyboard navigation stays fast, and touch scroll is smooth. Bounded memory + `requestIdleCallback` for metadata hydration.

**Files to Create/Modify:**
- `packages/web/src/components/FileTree.tsx` (modify — virtualization + incremental load)
- `packages/web/src/hooks/useVirtualTree.ts` (new — flatten/expand incremental)
- `packages/web/src/components/FileTree.virtual.test.tsx` (new)

**Implementation Steps:**
1. `useVirtualTree.ts`: holds the flat node map; `visibleNodes` = filtered by `expanded` set + a window/slice; `toggle(nodeId)` expands and pulls that node's children (already in the map from P-213's flat fetch) — no new fetch per expand; support "lazy load dir children" via a `ref=` fetch when a dir is huge (server paging, P-103).
2. `FileTree.tsx`: render only the visible slice with a fixed-row height (or dynamic via `react-virtual`/`@tanstack/react-virtual`) — on scroll, rows recycle; keep `checkbox`/expand state in the map.
3. Preserve a11y (P-231) under virtualization: roving tabindex works because focus travels with the focused node index; `aria-posinset`/`aria-setsize` on large folders.
4. Add search/filter: a "find file" box filters the map (debounced) and scrolls to the first match, reusing virtualization.
5. Profile guard: with a 100k-node fixture, render/scroll stays < 30fps drops and heap bounded.
6. Test: slice rendering, expand pulls children, scroll recycles, filter scrolls, a11y attributes maintained.

**Required MCPs/Connectors:** None — same tree API.

**Skills to Invoke:** None (perf patterns).

**Acceptance Criteria:**
- [ ] Only visible rows render (virtualized); expand/collapse via map
- [ ] Huge dirs lazy-fetch children with paging
- [ ] Keyboard (P-231) intact under virtualization; aria setsize
- [ ] Search filter debounced, scrolls to match
- [ ] 100k-node fixture stays smooth + memory-bounded
- [ ] Tests pass

**Tests Required:** `FileTree.virtual.test.tsx`:
- `it('renders visible slice')`, `it('expand fetches')`, `it('recycles scroll')`, `it('filter scroll')`, `it('perf gate')`

**Dependencies:** P-231. Tree P-213/214, a11y P-231.

**Handoff Notes:** Next: P-233 E2E (Playwright). Virtualization is the perf core of selection UX — keep the flat-map + window model, don't reintroduce whole-tree DOM. Reuse it for the SBOM/provenance table if those grow.

---




### P-233: Web - E2E (Playwright)

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-232

**Context:** Prove the whole flow works headlessly. This phase adds Playwright E2E tests covering the critical web paths: on-board (P-229) → add A/B (P-211/212) → select files (P-213/214) → run merge + thinking (P-216) → review diff (P-217) → approve/create (P-218) → view results (P-221/222/224). It spins up `stitch serve` (P-193) against fixture repos and drives the real browser, capturing screenshots on failure.

**Files to Create/Modify:**
- `packages/web/e2e/merge.flow.spec.ts` (new)
- `packages/web/e2e/selection.spec.ts` (new)
- `packages/web/e2e/helpers.ts` (new — serve bootstrap + fixtures)
- `packages/web/playwright.config.ts` (new)

**Implementation Steps:**
1. `playwright.config.ts`: webServer launches `stitch serve --fixtures` (a test-only mode that serves the committed fixture repos P-188) on a test port; baseURL `http://127.0.0.1:<port>`; project for chromium (webkit/firefox optional); `screenshot: 'only-on-failure'`, trace on.
2. `helpers.ts`: `serveWithFixtures()` starts/waits for `/health` (P-193); fixture repos committed under `e2e/fixtures/repos/{a,b}` (reuse provenance P-188 fixtures).
3. `selection.spec.ts`: add local source A `fixtures/repos/a`, add B, expect two pickers populated (P-211/212); expand trees (P-213/214) and check a few files; assert counts + "Continue to Merge" enabled (P-215).
4. `merge.flow.spec.ts`: the full happy path — select files, "Run Merge", wait for done (P-216), review diff (P-217), approve + create C (P-218), land on Results showing sandbox verdict + CREDITS (P-221/222).
5. Add one unhappy path: reject with reason → shows rejection summary (P-218).
6. Assert key selectors stable; use the real `data-testid`s introduced across P-211–P-222. Run headless in CI (P-236 web CI) and locally with `--headed` for demos.

**Required MCPs/Connectors:** None (local fixtures + serve). Docker optional if sandbox verification included (else stub).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Playwright config boots `serve` with fixtures; chromium default
- [ ] Selection spec adds A/B + checks files + gating
- [ ] Merge-flow spec drives the entire happy path to C created + results shown
- [ ] Reject path asserted
- [ ] Screenshots + trace on failure
- [ ] Runs headless in CI

**Tests Required:** `e2e/merge.flow.spec.ts`, `e2e/selection.spec.ts` (Playwright):
- `test('add sources + select files')`, `test('full merge to results')`, `test('reject flow')`

**Dependencies:** P-232. Serve P-193, fixtures P-188, components P-211–P-222.

**Handoff Notes:** Next: P-234 i18n (optional). E2E pins the real UX contract — keep selectors stable and rerun on any web change. These specs are the acceptance run for the whole Web epic.

---




### P-234: Web - i18n (Optional)

**Owner:** aradhy | **Wave:** 3 (optional, Waves 1–2 unaffected) | **Depends On:** P-233

**Context:** Optional localization. This phase adds a lightweight i18n layer for UI strings: a string catalog (default en) with a type-safe `t(key)` + interpolation, locale detection (navigator + config override), RTL-aware layout where needed, and a language switch in Settings (P-225). Marked optional — no hard dependency; if skipped, strings stay inline.

**Files to Create/Modify:**
- `packages/web/src/i18n/index.ts` (new — provider + `t`)
- `packages/web/src/i18n/en.ts`, `i18n/es.ts` (new — sample catalogs)
- `packages/web/src/settings/i18n Section` (modify — Language select)
- `packages/web/src/i18n/index.test.ts` (new)

**Implementation Steps:**
1. `index.ts`: `I18nProvider` (context) + `useT()` returning `t(key, params?)`; keys typed via `[key: Keys]` from `en.ts` so missing translations are compile-time errors in TS strict.
2. `en.ts` defines the default catalog of ~all user-facing strings (backfills as used); `es.ts` a partial sample (fallback to `en` for missing keys).
3. Locale: `navigator.language` at boot, overridable by `[web] locale` (P-200) or the Settings language select (P-225); persist choice.
4. RTL: set `dir` on `<html>` for RTL locales; audit layout for `flex`/`margin` directional mistakes (use logical properties where feasible).
5. Wrap the highest-traffic strings (shell P-210, empty states P-229, errors P-228, settings P-225) as the validation set; the rest migrate opportunistically.
6. Test: `t` interpolation, missing-key fallback, locale detection + override, RTL dir.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Type-safe `t(key, params?)` with typed catalog (TS strict)
- [ ] Locale detection + config/settings override + persistence
- [ ] Missing keys fall back to en
- [ ] RTL sets `dir`; key strings localized (shell/empty/error/settings)
- [ ] No hard dependency: skipping leaves app intact
- [ ] Tests pass

**Tests Required:** `i18n/index.test.ts`:
- `it('interpolates')`, `it('falls back missing')`, `it('detects locale')`, `it('rtl dir')`

**Dependencies:** P-233. Config P-200, settings P-225.

**Handoff Notes:** Next: P-235 static build served by CLI. Keep catalog typed so refactors of string keys are safe; if you skip this phase (optional), remove the provider and keep inline strings.

---




### P-235: Web - Static Build Served by CLI

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-234

**Context:** Production wiring: `stitch serve` must serve the built web app (P-193 already stubs this). This phase hardens it: `serve` serves `packages/web/dist` (built by `vite build` P-208), sets SPA fallback (client routes P-210 resolve even on direct `serve` navigation), serves the `/api/*` + `/ws` under the same origin without a separate dev proxy, gzips/`Content-Encoding`, sets cache headers, and adds a build-version banner (hash) so users/cache know the running build.

**Files to Create/Modify:**
- `packages/cli/src/server/static.ts` (new — static + SPA fallback)
- `packages/cli/src/commands/serve.ts` (modify — serve dist)
- `packages/cli/src/server/app.ts` (modify — mount static + build banner)
- `packages/cli/src/server/static.test.ts` (new)

**Implementation Steps:**
1. `static.ts`: `mountStatic(app, {distDir, indexBanner})` — serve files from `distDir` with correct MIME, gzip/brotli if precompressed, `Cache-Control` (immutable for hashed assets, `no-cache` for `index.html`), and an SPA fallback returning `index.html` for non-`/api` GET routes.
2. `serve.ts` (modify): locate `dist` — default next to the installed web build or `packages/web/dist`; if missing → serve the friendly "build the web app first" HTML (P-193 path) unless `--no-web`.
3. `app.ts` (modify): embed build hash from `dist` (e.g. `BUILD_META.json` emitted by vite P-208) into responses/headers (`X-Stitch-Build`), and into the served `index.html` banner; `serve` prints it at boot.
4. Ensure `/api/*` and `/ws` are matched BEFORE the SPA fallback (order: API/WS routes, then static, then fallback) so hydration client routes coexist with the API on one origin.
5. Test: MIME/caching, SPA fallback for a deep client route, gzip headers, build banner present, missing-dist fallback, API still served before fallback.

**Required MCPs/Connectors:** None — pure serve (Elysia).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Serves `dist` with correct MIME + caching (immutable hashed / no-cache index)
- [ ] SPA fallback resolves client routes on direct nav
- [ ] `/api/*` + `/ws` matched before fallback (same origin)
- [ ] Build hash banner in headers + printed; gzip where precompressed
- [ ] Missing dist → friendly build-first fallback
- [ ] Tests pass

**Tests Required:** `static.test.ts` (ephemeral serve + fetch):
- `it('serves hashed asset cached')`, `it('spa fallback')`, `it('api before fallback')`, `it('build banner')`, `it('missing dist fallback')`

**Dependencies:** P-234. Serve P-193, web build P-208.

**Handoff Notes:** Next: P-236 web tests. The single-origin production wiring (API + WS + SPA) is completed here — that's what the deployed/served app uses; keep route ordering deliberate (API → static → fallback).

---




### P-236: Web - Tests

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-235

**Context:** Consolidate the web test story. This phase establishes the web unit/integration test harness (vitest + RTL), a `bun test web` runner, coverage gate, and CJI integration — running component tests (P-208–P-234) + axe (P-231) and optionally the Playwright suite (P-233, tagged separately for CI VM). It's the quality gate that closes the Web epic.

**Files to Create/Modify:**
- `packages/web/vitest.config.ts` (new)
- `packages/web/src/test/setup.ts` (new — RTL + matchMedia mock)
- `packages/web/package.json` (add `test`, `test:cov`, `test:e2e`)
- `packages/web/src/test/harness.test.ts` (new — verifies setup)
- CI: web test job

**Implementation Steps:**
1. `vitest.config.ts`: jsdom env, `@` alias, setup file, coverage provider (v8) with thresholds (e.g. lines ≥75%, branches ≥65%, functions ≥70%). Collect from `src`.
2. `setup.ts`: `@testing-library/jest-dom`; mock `matchMedia` (for P-226/P-227/P-229), `ResizeObserver`, `IntersectionObserver` (virtual tree P-232), and `URL.createObjectURL`.
3. Runner scripts: `test` (unit+integration), `test:cov` (with gate), `test:e2e` (Playwright P-233). Root `bun run test` invokes web via the workspace (P-258 dispatch).
4. Add `src/test/harness.test.ts` asserting the mocks are active (matchMedia works, renders) so a broken setup fails loudly.
5. Wire a CI job: install → `bun install --frozen-lockfile` → `typecheck` → `lint` → `test:cov`; optional `test:e2e` job (Chromium install). Failing coverage/lint/typecheck fails CI.
6. Add a "no `console.error` in tests" lint to catch swallowed errors (ties to P-228).

**Required MCPs/Connectors:** None (npm registry for test deps).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] vitest + RTL harness with shared mocks (matchMedia/ResizeObserver/IO)
- [ ] Coverage thresholds enforced; failing → red
- [ ] `test`/`test:cov`/`test:e2e` scripts work; root dispatches
- [ ] CI job runs typecheck+lint+test:cov; optional e2e job
- [ ] `console.error` in tests flagged
- [ ] Harness self-test passes

**Tests Required:** `harness.test.ts` + full suite under thresholds.

**Dependencies:** P-235. Component tests P-208–P-234, axe P-231.

**Handoff Notes:** Next: P-237 web perf pass (closes Web epic). This harness is the standard; add any new web component with tests here. Keep mocks centralized in `setup.ts` so breakage surfaces early.

---




### P-237: Web - Perf Pass

**Owner:** aradhy | **Wave:** 2 | **Depends On:** P-236

**Context:** Fast shell, smooth interaction. This phase runs a performance pass: bundle-size budget (lazy-load routes/heavy deps like syntax highlighter P-217, SBOM visualizer), core-web-vitals targets (LCP/CLS on the shell), and interaction smoothness on the biggest screens (virtualized tree P-232 scroll, live merge streaming P-216 without jank). Uses a build/profile harness to measure and fix regressions, closing the Web epic.

**Files to Create/Modify:**
- `packages/web/vite.config.ts` (modify — `build.rollupOptions` manualChunks + `React.lazy` routes)
- `packages/web/src/router.tsx` (modify — lazy-load routes)
- `packages/web/perf/perf.spec.ts` (new — Playwright perf assertions)
- `packages/web/package.json` (add `analyze` / `perf`)

**Implementation Steps:**
1. **Bundle**: add `manualChunks` (vendor: react/react-dom/zustand/tanstack; diff: a `diff-vendor` chunk lazily loaded with the DiffViewer P-217; syntax: lazy `shiki` on-demand). Route-based `React.lazy` (P-210 router) so heavy pages load only when visited. Set a budget: initial JS ≤ ~250KB gzip; enforce via `rollup-plugin-visualizer`/CI check (`analyze`).
2. **Shell vitals**: ensure `index.html` is minimal (critical CSS inline), tokens applied without a flash (P-226 theme resolved before first paint), fonts `font-display: swap`. Assert LCP on the shell placeholder is fast.
3. **Interaction**: with the 100k-node fixture (P-232), assert virtualized tree scroll stays smooth (frame-budget check in perf.spec). For streaming (P-216), batch render updates (throttle to rAF, cap tokens as P-216).
4. `perf.spec.ts`: Playwright routes capture `performance` entries (LCP/CLS/INP where supported) for the shell + tree scroll; assert budgets; run in CI as a separate `perf` job.
5. Profile with devtools/bundled report to document the biggest contributors; keep a `PERF.md` note of budgets + measured values.
6. Test budget/CI gate + at least the shell LCP/tree smoothness assertions.

**Required MCPs/Connectors:** None (local build/measure).

**Skills to Invoke:** ui-ux-pro-max (perf) — optional; benchmark skill — optional.

**Acceptance Criteria:**
- [ ] Lazy-loaded routes/heavy deps; initial JS within budget (CI-enforced)
- [ ] Shell LCP fast (critical CSS, swap fonts, no theme flash)
- [ ] Tree scroll smooth at 100k nodes (frame budget)
- [ ] Streaming batched without jank
- [ ] `perf.spec.ts` asserts vitals; CI `perf` job
- [ ] Budgets + measurements recorded

**Tests Required:** `perf/perf.spec.ts`:
- `test('initial bundle budget')`, `test('shell lcp')`, `test('tree scroll smooth')`

**Dependencies:** P-236. Router P-210, diff P-217, tree P-232, stream P-216.

**Handoff Notes:** This closes the Web epic (P-208–P-237). Next: P-238 begins the Orchestration epic (pipeline state machine). Keep the upload-chunk budget enforced in CI — a red budget PR is the signal to lazy-load, not to raise the limit.

---




### P-238: Orchestration - Pipeline State Machine

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-237

**Context:** The heart of merge execution. This phase defines and implements the pipeline state machine that sequences every stage of a stitch: load config → fetch sources → select files → detect deps → resolve deps → license scan/verdict → agent (AI review/generation) → sandbox build/test → provenance → finalize C. Explicit states, transitions, guard rules, and per-stage result records make the pipeline deterministic, resumable (P-240), cancel-safe (P-246), and observable (P-241).

**Files to Create/Modify:**
- `packages/core/src/pipeline/states.ts` (new — state enum + transition table)
- `packages/core/src/pipeline/stateMachine.ts` (new — executor)
- `packages/core/src/pipeline/runPipeline.ts` (new — entry wrapping stages)
- `packages/core/src/pipeline/__tests__/stateMachine.test.ts` (new)

**Implementation Steps:**
1. `states.ts`: define `PipelineStage` enum (`config`, `sources`, `selection`, `deps`, `licenses`, `agent`, `sandbox`, `provenance`, `finalize`) + `StageStatus` (`pending`, `running`, `passed`, `skipped`, `failed`, `blocked`, `awaiting_hil`) and the allowed transition table (which source status → which next states; no illegal jumps).
2. `stateMachine.ts`:
   - A `PipelineState { stage, status, attempts, lastError, startedAt, finishedAt, meta }[]` + guards.
   - `transition(state, to, ctx)` validates against the table; throws `err('ILLEGAL_TRANSITION')` (P-163) otherwise.
   - Step handlers registered: each `(ctx) => Promise<StageResult>`; executor runs stages sequentially (or parallel where flagged) honoring `--jobs` (P-204) and `offline`.
   - Emits events to the event bus (P-241) for each transition (P-162 shape).
   - Handles `blocked` on license/hil (P-160) — pauses, waits for decision, resumes at that stage.
3. `runPipeline.ts`: wires the concrete stages to their modules (deps P-113, license P-131, agent P-167, sandbox P-177, provenance P-187), builds `PipelineCtx`, drives the machine, returns a `PipelineResult` (per-stage records + final C path + summary).
4. Idempotency hooks: stage results cached (P-250) so a resume (P-240) reuses passed stages.
5. Test transitions: happy path to finalize; illegal transition rejected; block→resume path; a failing stage → `failed` with recoverable re-entry.

**Required MCPs/Connectors:** None direct — orchestrates all core modules.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Stage/status enums + transition table implemented and enforced
- [ ] Stages run sequentially (parallel honor `--jobs`); offline respected
- [ ] Events emitted per transition (P-241 shape)
- [ ] Blocked (HIL/license) pauses and resumes
- [ ] Stage results cached for resume (P-240)
- [ ] Happy path + illegal-transition + failure tests pass

**Tests Required:** `stateMachine.test.ts`:
- `it('happy path')`, `it('rejects illegal transition')`, `it('blocks and resumes')`, `it('fails then retries')`

**Dependencies:** P-237. Deps/agent/sandbox/provenance modules, events P-241, errors P-163.

**Handoff Notes:** Next: P-239 job queue (SQLite). The machine is the deterministic core — keep transitions table-only (no hidden state) so it's testable and resumable. It's what merge P-192 and web P-216 drive.

---




### P-239: Orchestration - Job Queue (SQLite)

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-238

**Context:** Durable, concurrent job handling. This phase implements the job queue in SQLite (bun:sqlite, P-026): create jobs (each wrapping a `PipelineCtx` P-238), persist lifecycle states, support concurrent workers with a pick/lease/commit pattern, and provide the query API that `stitch status` (P-194), web JobHistory (P-224), and metrics (P-247) use. It decouples enqueue from execution for resumability.

**Files to Create/Modify:**
- `packages/core/src/jobs/queue.ts` (new)
- `packages/core/src/jobs/schema.ts` (new — SQLite DDL)
- `packages/core/src/jobs/types.ts` (new)
- `packages/core/src/jobs/__tests__/queue.test.ts` (new)

**Implementation Steps:**
1. `schema.ts`: `jobs(id TEXT PK, kind TEXT, status TEXT, config_json TEXT, created_at, started_at, finished_at, result_json, error_json, lease_owner, lease_expires_at)` + indexes on `(status)`, `(created_at)`.
2. `types.ts`: `JobRecord {id, kind, status: 'queued'|'running'|'succeeded'|'failed'|'cancelled'|'paused', ctx, result?, error?, timestamps}`.
3. `queue.ts`:
   - `enqueue(job)` INSERT queued.
   - `claim(id, owner, ttlMs)` — atomic UPDATE guarded by `lease_expires_at`; returns ok if acquired (prevents double-run).
   - `finish(id, result)` / `fail(id, error)` / `cancel(id)` / `pause(id)`, each guarded by status checks + emits event (P-241).
   - `pollReady(owner, opts)` — pick the oldest `queued` not leased, up to `--jobs` (P-204) concurrency.
   - Query helpers: `list({kind,status,from,to,limit})`, `get(id)`, job IDs = slug + timestamp (P-205).
4. Concurrency safety: all transitions via a single DB connection with `BEGIN IMMEDIATE`; lease expiry enables crash-recovery (stale `running` → requeue on startup, P-240).
5. Test: enqueue/claim/finish lifecycle, concurrent claims don't double-run, cancel/pause, stale lease requeue, list/filter queries.

**Required MCPs/Connectors:** bun:sqlite (local).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] SQLite schema + indexes; jobs persisted with lease fields
- [ ] claim is atomic (no double-run under concurrency)
- [ ] finish/fail/cancel/pause guarded + emit events
- [ ] Stale `running` re-queued on startup (crash recovery)
- [ ] list/get/filter queries power status/history/metrics
- [ ] Tests pass

**Tests Required:** `queue.test.ts`:
- `it('lifecycle')`, `it('no double run')`, `it('cancel pause')`, `it('stale requeue')`, `it('queries')`

**Dependencies:** P-238. SQLite P-026, events P-241, errors P-163.

**Handoff Notes:** Next: P-240 resume jobs. The queue is the durable spine — treat claim/lease as the concurrency authority; all pipeline execution flows through it so cancel/resume/metrics have a single home.

---




### P-240: Orchestration - Resume Jobs

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-239

**Context:** Long/complex merges shouldn't restart from zero. This phase adds job resume: on restart (crash, `--resume <id>`, or HIL pause P-160), a job re-enters the pipeline state machine (P-238) at the last incomplete stage, reusing cached passed-stage results (P-250) and SQLite-persisted ctx (P-239). It also records a resume marker in the audit log (P-187).

**Files to Create/Modify:**
- `packages/core/src/jobs/resume.ts` (new)
- `packages/core/src/jobs/queue.ts` (modify — `getResumableContext`)
- `packages/core/src/jobs/__tests__/resume.test.ts` (new)

**Implementation Steps:**
1. In `schema.ts`/queue: ensure every job stores per-stage `stage_status` + the pipeline ctx JSON so state is fully reconstructable mid-run.
2. `resume.ts`:
   - `checkpoint(jobId, pipelineState)` — persist stage statuses after each transition (called by machine P-238).
   - `resumableCtx(jobId)` — load last `PipelineState`, rebuild `PipelineCtx` from stored config (P-243) + stage results.
   - `resume(jobId, opts)` — load, mark `running`, hand the machine the saved state; using cached passed stages (P-250), skip ahead to the first `pending/failed` stage.
3. Startup sweep: on `serve`/CLI boot, scan queue for `running` jobs with expired lease → mark `paused` and queue for resume (crash recovery, P-239) unless `--no-resume`.
4. Emit `job:resumed` event (P-241) + `ResumeRecord` in audit (P-187) with `fromStage`, `reason` (crash|manual|hil).
5. Guard: only resume jobs with a valid persisted ctx and a lease owned by no-one or self; refuse if stage deps changed (P-243 config hash mismatch → restart from config).
6. Test: checkpoint persists; resume re-enters at right stage reusing cache; crash sweep marks+queues; config-hash mismatch forces restart.

**Required MCPs/Connectors:** None — SQLite + machine.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Stage statuses + ctx persisted per transition (checkpoint)
- [ ] Resume re-enters at first incomplete stage, reusing passed-stage cache
- [ ] Crash sweep (expired lease) marks + queues resume
- [ ] `job:resumed` event + audit record (fromStage/reason)
- [ ] Config-hash mismatch → restart from config
- [ ] Tests pass

**Tests Required:** `resume.test.ts`:
- `it('checkpoints')`, `it('resumes at stage')`, `it('crash sweep')`, `it('config mismatch restarts')`

**Dependencies:** P-239. Machine P-238, cache P-250, audit P-187.

**Handoff Notes:** Next: P-241 event bus → WS. Checkpoint granularity = per-stage (not per-line) keeps it simple; resume correctness depends on P-250 caching being reliable.

---




### P-241: Orchestration - Event Bus → WS

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-240

**Context:** A single typed event spine. This phase implements the in-process event bus that every core module publishes to (P-162 shape), and bridges it to the WebSocket hub (P-193) so the web surface (ThinkingStream P-216, JobHistory P-224) and CLI progress (P-199) subscribe from one place. It formalizes topic names, payload schemas, ordering, and a subscriber registry.

**Files to Create/Modify:**
- `packages/core/src/events/bus.ts` (new)
- `packages/core/src/events/topics.ts` (new — topic map + payload types)
- `packages/cli/src/server/wsBridge.ts` (new — bus→WS forwarding)
- `packages/core/src/events/__tests__/bus.test.ts` (new)

**Implementation Steps:**
1. `topics.ts`: typed topics — `pipeline.stage`, `job.*` (created/started/updated/resumed/cancelled/failed/succeeded), `agent.reasoning`, `agent.tool` (P-162), `license.*`, `deps.*`, `sandbox.*`, `progress` (P-242). Each with a zod payload type (P-009 spirit).
2. `bus.ts`:
   - `Bus` — `publish(topic, payload)`, `subscribe(topic, handler)` returning unsubscribe; synchronous delivery in publish order (per topic; allow async handlers for WS).
   - `filter` helpers + `wildcard` topic matching (`job.*`).
   - A single shared `bus` singleton for the process; modules import it (P-162/etc. route here, not ad-hoc events).
3. `wsBridge.ts` (CLI): subscribes the shared `bus` to the WS hub (P-193); a `server:event` message = `{topic, payload, ts}`; implements the client `hello {topics}` re-subscription (P-223) by tracking active topics.
4. Backpressure: if WS buffer grows (slow client), drop/coalesce `/progress`-type payloads (P-242) rather than block the bus.
5. Test: publish/deliver order, per-topic + wildcard subscription, unsubscribe, async handler, bus→WS forwarding with backpressure coalescing.

**Required MCPs/Connectors:** WS hub via P-193 (CLI side).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Typed bus with publish/subscribe + wildcard + unsubscribe
- [ ] All core modules route events here (no ad-hoc)
- [ ] wsBridge forwards bus→WS with `{topic,payload,ts}`; hello re-subscription
- [ ] Backpressure coalesces progress payloads
- [ ] Tests pass

**Tests Required:** `bus.test.ts`:
- `it('order')`, `it('wildcard')`, `it('unsubscribe')`, `it('async handler')`, `it('ws forward backpressure')`

**Dependencies:** P-240. Events P-162, WS P-193/223.

**Handoff Notes:** Next: P-242 progress aggregation. The bus is the single event spine — never publish to WS directly from a module; always via the bus. Keep topic names + payloads stable (they're the CLI/web contract).

---




### P-242: Orchestration - Progress Aggregation

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-241

**Context:** Coherent progress from noisy events. This phase adds a progress aggregator that reduces raw bus events (P-241) into a stable, throttled progress model: per-stage percent (weighted by stage), overall percent, ETA, current activity label, and phase grouping — consumed by CLI progress (P-199) and web ThinkingStream (P-216) via the WS bridge. It prevents flicker and puts meaningful numbers on screen.

**Files to Create/Modify:**
- `packages/core/src/events/progress.ts` (new — aggregator)
- `packages/core/src/events/progress.test.ts` (new)

**Implementation Steps:**
1. Define `ProgressModel { jobId, overall: {percent, etaMs, phase}, stages: [{id, label, percent, status}], activity: string }` with stage weights (e.g. deps 0.15, agent 0.4, sandbox 0.3, provenance 0.1 — configurable P-243).
2. `progress.ts`:
   - Subscribes to `pipeline.stage` (P-241), `agent.tool`/`agent.reasoning`, `deps.*`, `sandbox.*`, `license.*` and maps each to stage contribution.
   - Maintains `stagePercent` map keyed by stage id; `overall = Σ weight*stagePercent`.
   - ETA: rolling estimate from throughput (e.g. sandbox fraction done vs elapsed), clamped.
   - Emits `progress` topic (P-241) throttled to a cadence (default 200ms) + always on stage change.
3. `activity`: latest meaningful label (e.g. "generating component xyz", "installing deps npm"), with a priority ordering so it's informative not stale.
4. Handle skipped stages (weight redistributed) and HIL-paused (0% activity "awaiting approval").
5. Test: weighting math, throttle cadence, skipped redistribution, ETA clamping, activity priority.

**Required MCPs/Connectors:** None — pure aggregation.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Per-stage + overall percent from weighted contributions
- [ ] Emits `progress` throttled + on changes; no flicker
- [ ] ETA estimate clamped; skipped weights redistributed
- [ ] Activity label priority correct; HIL-paused shows "awaiting approval"
- [ ] Tests pass

**Tests Required:** `progress.test.ts`:
- `it('weighted percent')`, `it('throttles')`, `it('redistributes skipped')`, `it('eta clamp')`, `it('activity priority')`

**Dependencies:** P-241. Events P-162, stage weights P-243.

**Handoff Notes:** Next: P-243 per-job config. Progress is the user-facing telemetry contract (# and label must be trustworthy — a lying ETA erodes trust); keep weights/config-driven.

---




### P-243: Orchestration - Per-Job Config

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-242

**Context:** Each merge job can override project defaults. This phase implements per-job configuration: a `JobConfig` merged from (project config P-200) ← (CLI/API flags P-204/P-192) ← (API body P-192), validated by the zod schema (P-009/P-084), plus a config hash for resume-validity (P-240). Every pipeline stage reads its knob from this resolved JobConfig (single source), enabling reproducible + auditable runs.

**Files to Create/Modify:**
- `packages/core/src/jobs/jobConfig.ts` (new)
- `packages/core/src/jobs/jobConfig.test.ts` (new)

**Implementation Steps:**
1. Define `JobConfig` shape extending AppConfig (P-200) with per-run fields: `outDir`, `sources` (resolved refs), `selection`, `ai {provider, model, budget, stream}`, `sandbox {jobs,memory,timeout,verify}` (P-204), `licenses {policy, allow,deny}`, `perf {jobs,concurrency}`, `progress {weights,cadence}` (P-242), `flags {offline,dryRun,allowGeneration}`.
2. `resolveJobConfig({project, flags, overrides})`: deep-merge in precedence order; `zod.safeParse` against a `JobConfigSchema`; on fail → `err('CONFIG_INVALID', issues)` (P-203/P-009). Freeze the merged result (deep-readonly) so stages can't mutate it.
3. `configHash(cfg)`: SHA-256 (P-026) of canonical JSON of the *pipeline-relevant* subset — stored with the job (P-239) for resume validity (P-240).
4. Emit `job.config-resolved` event with `{hash, effectiveCfg}` (redacted of keys P-206) when a job is created.
5. Provide `section<T>(cfg, key)` typed accessor so stages read e.g. `section(cfg,'sandbox').timeout`.
6. Test: precedence merge, invalid → error, freeze read-only, hash stable + changes on knob change, redacted emit.

**Required MCPs/Connectors:** None — local config/zod.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] JobConfig merged project←flags←overrides with correct precedence
- [ ] Validated by zod; invalid → `CONFIG_INVALID`
- [ ] Frozen (read-only) at runtime; stages use `section` accessors
- [ ] `configHash` stable + sensitive to changes (resume validity)
- [ ] Redacted config-resolved event
- [ ] Tests pass

**Tests Required:** `jobConfig.test.ts`:
- `it('precedence')`, `it('invalid errors')`, `it('freeze')`, `it('hash')`, `it('redacted emit')`

**Dependencies:** P-242. Config P-200, schema P-009, errors P-203.

**Handoff Notes:** Next: P-244 dry-run. JobConfig is the single read source for every stage — never let a stage parse flags/project directly. The hash ties resume (P-240) validity to config stability.

---




### P-244: Orchestration - Dry-Run

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-243

**Context:** Preview before commit. This phase implements dry-run mode (`--dry-run` P-192, web `/api/merge/proposed-diff` P-217): the full pipeline runs through sandbox build/test + verdicts, but C is NOT written and AI generation is disabled (only review/propose, per HIL P-160) — producing a proposed plan: files to create, deps resolutions, license verdict, diffs, sandbox result. It's the safe "what would happen" mode.

**Files to Create/Modify:**
- `packages/core/src/pipeline/dryRun.ts` (new)
- `packages/core/src/pipeline/dryRun.test.ts` (new)

**Implementation Steps:**
1. In `runPipeline` (P-238), branch on `cfg.flags.dryRun`:
   - Run config→sources→selection→deps→licenses (verdict, no write).
   - Agent: run in `review/propose-only` — generate a `ProposedPlan` (new/modify/delete ops + rationale) but never write (P-160 auto-approve is off; generation gated).
   - Sandbox: build/test a **plan preview** (ideally the real build in a scratch overlay, or a dependency-resolution-only check when `--dry-run --no-build`); report would-be verdict.
   - Provenance: compute anticipated SBOM/CREDITS/checksums without writing.
   - **Finalize: skipped** — no C written, no lockfile/commit mutation.
2. `dryRun.ts`: `buildDryRunPlan(ctx)` returns `DryRunPlan {stages, proposedDiffs, deps, licenseVerdict, sandboxPreview, provenancePreview, outDir}`; `planJson()` for `/api/merge/proposed-diff` (P-217) and CLI `--json`.
3. Guarantee no side effects: sandbox uses ephemeral volumes (P-169) discarded after; no `stitch-out` touch, no audit-mutating reads (read-only), no registry writes (use cache P-179).
4. Emit `job.dry-run-plan` event with the JSON plan (P-241) so web/CLI render consistently.
5. Test: dry-run leads to `finalize` skipped, no C written, proposed plan present, Diffs correct for a fixture, sandbox preview without persistence.

**Required MCPs/Connectors:** Sandbox ephemeral (P-169/P-178) only.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Dry-run runs stages through sandbox verdict but skips finalize (no C)
- [ ] AI in review/propose-only (no generation)
- [ ] Proposed plan (diffs/deps/license/sandbox/provenance previews) produced
- [ ] No side effects: ephemeral volumes, no writes, read-only audit
- [ ] `planJson` serves P-217/192 `--json`
- [ ] Tests pass

**Tests Required:** `dryRun.test.ts`:
- `it('skips finalize')`, `it('no generation')`, `it('builds plan')`, `it('no side effects')`, `it('plan json')`

**Dependencies:** P-243. Machine P-238, sandbox P-169, HIL P-160.

**Handoff Notes:** Next: P-245 rollback whole job. Dry-run is the preview contract behind web diff review (P-217) and `stitch merge --dry-run`; keep it strictly side-effect-free so it's safe to run on any project.

---




### P-245: Orchestration - Rollback Whole Job

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-244

**Context:** If a finalized C (or any stage write) is wrong, users/CI can roll it back to the last good state. This phase implements job-level rollback: before finalize, a snapshot (the outDir index + checksums P-186 + manifest) is recorded; rollback restores that snapshot, removes generated files, reverts any config/lockfile touches, and logs a `RollbackRecord` in audit (P-187). It's transactional best-effort for the whole job.

**Files to Create/Modify:**
- `packages/core/src/jobs/rollback.ts` (new)
- `packages/core/src/jobs/rollback.test.ts` (new)

**Implementation Steps:**
1. Pre-finalize snapshot in `finalize` (P-238): capture `outDir` file index + hashes (via checksum manifest P-186) + any config/lockfile paths the job may touch, store `{jobId, snapshotId, index, configHashes}` in SQLite (P-239 job row / side table).
2. `rollback.ts`:
   - `snapshotPathIndex(outDir)`: walk files, record relpath+sha256.
   - `rollbackJob(jobId, {reason})`: load snapshot → for each generated file not in snapshot, `unlink` (P-205-safe paths); for changed files, restore from a pre-merge backup copy; revert config/lockfile via recorded hashes (restore prior blobs from a `~/.stitch/backups` store); set job status `rolled_back`; emit `job.rolled-back` event; append `RollbackRecord {jobId, snapshotId, reason, filesRemoved, filesRestored}` to audit (P-187).
3. Safety: refuse rollback if outDir has been modified since snapshot (hash drift) unless `--force`; never delete paths outside the snapshot's root (P-205 containment); back up originals before overwrite.
4. Provide dry-run of rollback: `rollback --dry-run` lists files that would be removed/restored without mutating.
5. Test: snapshot+restore, removal of generated files, config/lockfile revert, drift-avoidance + force, dry-run list, audit record.

**Required MCPs/Connectors:** None — fs + SQLite.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Pre-finalize snapshot (index + hashes) recorded
- [ ] Rollback removes generated files, restores originals, reverts config/lockfile
- [ ] Drift detection blocks unless `--force`; P-205 containment enforced
- [ ] `rollback --dry-run` lists without mutating
- [ ] `job.rolled-back` event + audit `RollbackRecord`
- [ ] Tests pass

**Tests Required:** `rollback.test.ts`:
- `it('snapshot restores')`, `it('removes generated')`, `it('reverts config')`, `it('drift blocks force ok')`, `it('dry run list')`, `it('audit record')`

**Dependencies:** P-244. Checksums P-186, audit P-187, paths P-205.

**Handoff Notes:** Next: P-246 cancel. Rollback is the safety net for finalize — always snapshot before writing C so any run can be undone; keep it best-effort but never data-losing beyond the snapshot scope.

---




### P-246: Orchestration - Cancel

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-245

**Context:** Users must stop a run they no longer want. This phase implements cooperative cancellation: a `cancel(id, {reason})` that requests the running pipeline to stop at the next safe checkpoint — canceling the sandbox container (P-168), aborting AI calls (P-163 token/abort signal, P-147), releasing job lease (P-239), and marking `cancelled` (not `failed`). Interrupt (Ctrl-C/SIGINT) also triggers graceful cancel.

**Files to Create/Modify:**
- `packages/core/src/jobs/cancel.ts` (new)
- `packages/core/src/pipeline/cancel signals` (modify — abort machinery)
- `packages/core/src/jobs/cancel.test.ts` (new)

**Implementation Steps:**
1. Thread an `AbortSignal`/`CancellationToken` through `PipelineCtx` (P-238). Every long operation (AI stream P-142, sandbox run P-177, dep install P-170) accepts the token and aborts on signal; stages check `token.isCancellationRequested` at boundaries (not mid-critical-write).
2. `cancel.ts`:
   - `cancelJob(id, {reason})` — set status `cancelling` in queue (P-239), fire the token, await stage cleanup; on completion set `cancelled` (guard: if already completed → error). Emit `job.cancelled` {reason} (P-241).
   - `cancelSandbox` P-168: `container.stop`/kill + cleanup (P-177) on cancel.
   - Tie to SIGINT/SIGTERM handlers in `index.ts` (P-189) and `serve` (P-193): first signal = graceful cancel of running jobs + flush audit (P-187), second = hard exit.
3. Discriminate statuses: `cancelled` ≠ `failed`; resume (P-240) refuses cancelled jobs (must re-enqueue fresh).
4. Audit: `CancelRecord {jobId, reason, stagesCompleted}` (P-187).
5. Test: cancel mid-AI/mid-sandbox aborts cleanly + status cancelled, already-done → error, SIGINT graceful path, resume refuses cancelled.

**Required MCPs/Connectors:** Container control (dockerode P-168) for sandbox kill.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] CancellationToken threaded through long ops (AI/sandbox/dep-install)
- [ ] `cancel` → `cancelling` → `cancelled`; emits event with reason
- [ ] Cancelled ≠ failed; resume refuses cancelled
- [ ] SIGINT graceful (cancel running + flush audit); second = hard exit
- [ ] Audit `CancelRecord`
- [ ] Tests pass

**Tests Required:** `cancel.test.ts`:
- `it('cancels mid op')`, `it('already done errors')`, `it('sigint graceful')`, `it('resume refuses cancelled')`

**Dependencies:** P-245. Sandbox P-168/177, AI P-142/147/163, queue P-239.

**Handoff Notes:** Next: P-247 metrics. Cancel must be cooperative and exactly-once (never double-fire the token mid-cleanup); every long op being abort-aware keeps cancel fast and safe.

---




### P-247: Orchestration - Metrics

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-246

**Context:** Observable and comparable. This phase adds run metrics: per-job stage timings, counts (files/deps/tokens/licenses), reuse (P-250) hits, and resource usage (sandbox CPU/mem P-176, token cost P-143) — persisted in SQLite (P-239 job row) and exposed via `/api/jobs/<id>/metrics` + `stitch status --json` (P-194). Enables tuning (P-204) and regression detection.

**Files to Create/Modify:**
- `packages/core/src/jobs/metrics.ts` (new)
- `packages/core/src/jobs/metrics.test.ts` (new)

**Implementation Steps:**
1. Define `JobMetrics {jobId, stages: {stage, started, finished, durationMs, reusedFromCache}[], counts: {files, deps, tokensIn, tokensOut, licenseDecisions, checks}, resources: {sandboxCpuMs, sandboxMemMb, sandboxJobs}$, cost: {estimatedUsd, provider}}`, each source driven by events (P-241) + counters.
2. `metrics.ts`:
   - A `MetricsCollector` subscribes to the bus (P-241), timestamps stage transitions (from `pipeline.stage`), tallies counts (from `agent.tool` P-162, `deps.*`, `license.*`), records token/cost (P-143), and captures sandbox resource reads (P-176).
   - `finalizeMetrics(jobId)` persists to the job row at `succeeded/failed` (P-239).
   - Query `getMetrics(jobId)`, `listMetrics({kind, from, to})` for trends.
3. Wire: `/api/jobs/<id>/metrics` (serve P-193) and `--json` in `stitch status` (P-194) + JobHistory detail (P-224).
4. Cost-sensitive: token/cost aggregated (P-143) with totals; guard against overflow/clamp.
5. Test: timings collected, counts accurate from events, token/cost aggregation, persistence + query, resource capture.

**Required MCPs/Connectors:** None — bus + SQLite + sandbox read.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Stage timings + counts + token/cost + sandbox resource metrics collected
- [ ] Persisted at job end; queryable per-job and trend list
- [ ] Served via `/api/jobs/<id>/metrics` + `status --json`
- [ ] Cost aggregated (P-143) without overflow
- [ ] Tests pass

**Tests Required:** `metrics.test.ts`:
- `it('collects timings')`, `it('tallies counts')`, `it('aggregates token cost')`, `it('persists queries')`, `it('resources')`

**Dependencies:** P-246. Events P-241, tokens P-143, job P-239, sandbox P-176.

**Handoff Notes:** Next: P-248 tracing (continues Orchestration). Metrics are the tuning/comparison data for P-204 and health; keep them event-sourced so they're consistent with what the UI showed.

---




### P-248: Orchestration - Tracing

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-247

**Context:** Debugging distributed-ish async pipelines needs spans, not just logs. This phase adds lightweight tracing: nested spans (job → stage → tool/sandbox/sandbox-op), each with start/end/duration/attrs, linked to the event bus (P-241) and surfaced as a waterfall in logs (P-206 `--verbose`), in `/api/jobs/<id>/trace`, and attached to errors (P-203 error id). OpenTelemetry-optional export (JSON) for external tooling.

**Files to Create/Modify:**
- `packages/core/src/tracing/tracer.ts` (new)
- `packages/core/src/tracing/spans.ts` (new — span types + Waterfall renderer)
- `packages/core/src/tracing/tracer.test.ts` (new)

**Implementation Steps:**
1. `spans.ts`: `Span {id, parentId, name, kind: 'job'|'stage'|'tool'|'sandbox'|'ai'|'fs', startedAt, finishedAt?, durationMs?, attrs, status}`, `Trace {root, spans}`; a `Waterfall` text renderer (indent by depth).
2. `tracer.ts`:
   - An async-context tracer: `tracer.startSpan(name, {parent, kind})` returns a span + `span.finish(status, attrs)`; carries a current span via async-local storage so nested ops auto-parent.
   - Emits `trace.span` events (P-241) so the web trace view (P-224) can stream.
   - `traceCollector(jobId)` buffers spans per job → `getTrace(jobId)`, exported JSON (OTLP-ish flat list + parentId).
   - Sampling: full by default; `trace.ratio` in config (P-243) to sample for prod.
3. Instrument key points: pipeline stage entry/exit (P-238), each agent tool (P-148–P-157), sandbox run (P-177), AI stream calls (P-142), and fs snapshots (P-245).
4. Surface: `--trace`/`--verbose` (P-203/P-206) prints the waterfall; `/api/jobs/<id>/trace` serves JSON; errors embed `traceId`/`spanId` (P-203 error id).
5. Test: nesting/parenting from async context, finish status/attrs, buffering per job, waterfall render, JSON export.

**Required MCPs/Connectors:** None — local + event bus.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Nested spans auto-parent via async context
- [ ] Span events emitted; per-job collector buffers + JSON export
- [ ] Instrumented: stage, tools, sandbox, AI, fs snapshot
- [ ] Waterfall in `--verbose`/`--trace`; served via `/api/jobs/<id>/trace`
- [ ] Errors embed traceId/spanId
- [ ] Config sampling honored; tests pass

**Tests Required:** `tracer.test.ts`:
- `it('nests spans')`, `it('finish attrs')`, `it('per job buffer')`, `it('waterfall render')`, `it('json export')`

**Dependencies:** P-247. Events P-241, errors P-203.

**Handoff Notes:** Next: P-249 concurrency. Tracing ties async debugging together — keep spans cheap (no allocations in hot loops) and sampling config-driven.

---




### P-249: Orchestration - Concurrency

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-248

**Context:** Parallelism where safe. This phase implements concurrency control for the pipeline and jobs: a bounded worker/semaphore pool for sandbox builds + AI calls (respecting `--jobs`/`--concurrency` P-204, sandbox host limits P-176), per-ecosystem parallelism, and safe parallel stage execution where stages are independent (P-238). Guards against resource exhaustion with a global cap.

**Files to Create/Modify:**
- `packages/core/src/concurrency/pool.ts` (new)
- `packages/core/src/concurrency/pool.test.ts` (new)

**Implementation Steps:**
1. `pool.ts`: a semaphore-based `Pool(limit)` with `run(fn)` queuing tasks, optional priority, timeout per task, and `drain()`; implements `acquire/release` + a `tryAcquire` for preflight (avoid deadlock).
2. Global cap: a process-wide `Limits` resolves `min(configured jobs, host cpu, sandbox host cap from P-176)` and is shared across pools so sandbox + AI + dep-install compete for one budget.
3. Wire into parallel stage execution (P-238): stages with `parallel: true` (e.g. multiple independent sandbox verifies P-189? — actually select deps-resolve per ecosystem P-112) use distinct pools; `--concurrency` (P-204) sizes the AI pool (P-157/P-141).
4. Ordering fairness: FIFO by default; priority queue for HIL/approve (P-160) so approvals aren't starved behind long builds.
5. Cancellation (P-246) drains in-flight tasks: tasks check the token before start; running acquire-waiters reject promptly.
6. Test: bounded concurrency, priority ordering, timeout, global cap resolution, cancel-drain.

**Required MCPs/Connectors:** None — runtime only.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Semaphore pool with bounded concurrency + priority + timeout
- [ ] Global cap = min(configured, host cpu, sandbox host cap); shared budget
- [ ] Parallel stages use distinct pools; `--concurrency` sizes AI pool
- [ ] HIL/approve prioritized (not starved)
- [ ] Cancel drains in-flight + rejects waiters promptly
- [ ] Tests pass

**Tests Required:** `pool.test.ts`:
- `it('bounds concurrency')`, `it('prioritizes')`, `it('timeouts')`, `it('global cap')`, `it('cancel drains')`

**Dependencies:** P-248. Perf P-204, sandbox P-176, machine P-238.

**Handoff Notes:** Next: P-250 idempotency. Concurrency is the resource governor — all parallelism must flow through the shared `Limits` so sandbox/AI never exceed host capacity regardless of config.

---




### P-250: Orchestration - Idempotency

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-249

**Context:** Re-runs must not duplicate work or produce drift. This phase implements idempotency for pipeline stages and jobs: a content-addressed cache keyed by (stage, config-hash P-243, relevant input hashes) so re-running a stage with unchanged inputs reuses the cached result (P-240 resume); double-submit of a job with the same signature returns the existing job; and finalize is safe to re-run (no duplicate writes/commits). It also dedupes `stitch add`-style selections (P-191).

**Files to Create/Modify:**
- `packages/core/src/jobs/idempotency.ts` (new)
- `packages/core/src/jobs/idempotency.test.ts` (new)

**Implementation Steps:**
1. Cache store (SQLite P-026 or `~/.stitch/cache` files P-198? — use a content-addressed dir): key = `sha256(canonical({stage, jobConfigHash (P-243), inputs}))` → value blob (stage result JSON + referenced artifact paths). `getCache(key)`, `putCache(key, result)`, `hasCache`.
2. Stage wrapper in machine (P-238): before running a stage, compute key from its declared inputs; if present and inputs match (verify input hashes) → reuse; else run + cache. Only cache pure/verifiable stages (deps, license, provenance, sandbox-verdict-by-lockfile); never cache AI generation (P-146 gated) or fs writes.
3. Job idempotency: `enqueue` dedupes — if a `queued`/`running` job with identical `kind+configHash+sources` exists within a window, return that `{id, duplicate:true}` (prevent accidental double-merge, P-239).
4. Finalize safe re-run: finalize (P-238/P-245) checks the outDir — if C already exists with same checksums (P-186) and the resumed job is a no-op diff (P-244), skip re-writing and report `unchanged`.
5. Eviction: LRU by last-access; `--no-cache` flag (P-204) disables for debugging.
6. Test: cache hit/miss, mixed (cache/non-cache stages), input-change invalidates, enqueue dedupe, finalize no-op re-run.

**Required MCPs/Connectors:** None — local store.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Content-addressed stage cache with input-hash verification
- [ ] Only pure/verifiable stages cached (never AI/fs-writes)
- [ ] Job enqueue dedupes identical signatures
- [ ] Finalize re-run detects unchanged C and skips
- [ ] LRU eviction + `--no-cache`
- [ ] Tests pass

**Tests Required:** `idempotency.test.ts`:
- `it('cache hit')`, `it('input change invalidates')`, `it('mixed stages')`, `it('enqueue dedupe')`, `it('finalize no op')`

**Dependencies:** P-249. Config hash P-243, resume P-240, checksums P-186.

**Handoff Notes:** Next: P-251 orchestration tests. Idempotency is what makes resume (P-240) cheap and re-runs stable — keep the cache key precise (include every input that matters) or you'll silently serve stale results.

---




### P-251: Orchestration - Tests

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-250

**Context:** Prove orchestration works together. This phase consolidates the orchestration epics (P-238–P-250) into an integration test suite: a full pipeline on fixture repos (P-188) run via the state machine + job queue, exercising resume-after-crash, cancel-mid-sandbox, dry-run, rollback, idempotent re-run, metrics/tracing capture, and concurrency under load. It's the acceptance gate for the whole orchestration layer.

**Files to Create/Modify:**
- `packages/core/src/orchestration/__tests__/orchestration.suite.test.ts` (new)
- `packages/core/package.json` (add `test:orchestration`)

**Implementation Steps:**
1. Build a harness: temp working dir, fixture repos A/B (reuse P-188), a stubbed AI provider (P-146 mock) for deterministic agent stages, and a sandbox stub (P-180 tests) that verifies quickly.
2. Suite scenarios:
   - **Full happy path**: enqueue → machine runs → finalize writes C → status `succeeded`; assert C files + CREDITS + SBOM + checksums exist (P-181–P-186).
   - **Resume after crash**: force a simulated crash (throw mid-sandbox, then re-boot) → job re-queued → resume reuses cache (P-240/P-250) and lands `succeeded`.
   - **Cancel mid-sandbox**: start, cancel → status `cancelled`, no partial finalize, audit has CancelRecord (P-246).
   - **Dry-run**: no finalize, produces plan (P-244).
   - **Rollback**: finalize then rollback → C removed/restored, RollbackRecord in audit (P-245).
   - **Idempotent re-run**: enqueue same job twice → single execution return (P-250).
   - **Concurrency**: N parallel jobs under a small `--jobs` all complete without resource errors (P-249); metrics + trace non-empty (P-247/P-248).
3. Each scenario asserts DB state (P-239) + audit (P-187) + filesystem invariants.
4. Add `test:orchestration` with coverage gate; wire into CI (P-257).
5. Test the suite runs green + stable (no flakes from timing — use generous timeouts + deterministic stubs).

**Required MCPs/Connectors:** Local only (stub AI/sandbox).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Full happy-path pipeline to C on fixtures, invariants asserted
- [ ] Resume-after-crash reuses cache and lands succeeded
- [ ] Cancel-mid-sandbox → cancelled, no partial finalize, audit record
- [ ] Dry-run no finalize; rollback restores; idempotent dedupe
- [ ] Concurrency N-jobs under `--jobs` passes; metrics+trace captured
- [ ] Suite green + stable; CI-wired

**Tests Required:** `orchestration.suite.test.ts`:
- `it('happy path')`, `it('resume crash')`, `it('cancel sandbox')`, `it('dry run')`, `it('rollback')`, `it('idempotent')`, `it('concurrency')`

**Dependencies:** P-250. Fixtures P-188, machine P-238, queue P-239.

**Handoff Notes:** This completes the Orchestration epic (P-238–P-251). Next: P-252 CLI↔Web contract, then the Testing epic (P-253+). Keep the suite deterministic by stubbing AI/sandbox — real providers are out of scope here.

---




### P-252: Orchestration - CLI↔Web Contract

**Owner:** aradhy + inbesat | **Wave:** 3 | **Depends On:** P-251

**Context:** CLI and web must agree on the API. This phase formalizes the CLI↔Web contract: a shared, versioned API surface (paths, request/response zod schemas P-009, event/topic names P-241, WS envelope) consumed by both `serve` (P-193) and the web client — with a generator that emits the TypeScript client from a single OpenAPI/Zod source so they can't drift. It also adds a contract conformance test (CLI `--json` versus web client expectations).

**Files to Create/Modify:**
- `packages/core/src/api/contract.ts` (new — zod schemas for all `/api/*`)
- `packages/core/src/api/openapi.ts` (new — OpenAPI doc generator)
- `packages/cli/src/api/openapi.serve.ts` (modify — mount `/api-docs` + validate)
- `packages/web/src/api/client.generated.ts` (generated — TS client)
- `contract.conform.spec.ts` (new)

**Implementation Steps:**
1. `contract.ts`: define zod schemas (P-009 spirit) for every endpoint the web uses: `/api/repos/*`, `/api/deps/*`, `/api/licenses/*`, `/api/sandbox/*`, `/api/provenance/*`, `/api/jobs/*`, `/api/settings`, `/api/session/*`, `/api/merge/*` (P-193/P-211–P-230). Paths + query params + request/response bodies typed.
2. `openapi.ts`: generate an OpenAPI 3 doc from the schemas (paths, components) on the fly; `serve` (P-193) mounts it at `/api-docs` (Swagger UI optional) + `/api-docs.json`.
3. `client.generated.ts`: a codegen (from the OpenAPI doc) producing a typed fetch client (or use `openapi-typescript`), checked into `packages/web`, replacing the hand-rolled `api/*.ts` wrappers (P-211–P-230) — keep the same function names/shapes for minimal churn.
4. Runtime validation: `serve` validates inbound bodies against the zod schemas (rejects → 422 P-203-mapped) and outbound (dev/Debug) to catch contract drifts early.
5. `contract.conform.spec.ts`: for a set of endpoints, call `serve` (ephemeral, P-193) and assert the response matches the schema, and that the generated client types accept it (compile-time) — a single source both sides trust.
6. Test: contract validation pass/fail, client generation output typechecks, conformance test green.

**Required MCPs/Connectors:** None — compile-time + local server.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Single zod schema source for all `/api/*` endpoints
- [ ] OpenAPI doc generated + mounted (`/api-docs`, `/api-docs.json`)
- [ ] Generated TS client replaces hand-rolled wrappers (same shapes)
- [ ] Serve validates in/out; drift caught early (422 / dev assertion)
- [ ] Conformance test: real serve responses satisfy schema + client types
- [ ] Tests pass

**Tests Required:** `contract.conform.spec.ts`:
- `it('health conforms')`, `it('jobs conforms')`, `it('merge propose conforms')`, `it('invalid body 422')`

**Dependencies:** P-251. Serve P-193, zod P-009.

**Handoff Notes:** Next: P-253 unit conventions (Testing epic). The contract is the anti-drift backbone — one schema source, generated client, runtime validation. Keep `client.generated.ts` regenerated on endpoint changes (CI check).

---




### P-253: Testing - Unit Conventions

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-252

**Context:** Consistent, fast, reliable unit tests across the monorepo. This phase codifies unit-test conventions: Bun test layout, naming, the AAA pattern, deterministic time/random, no network/fs side effects (use mocks/fixtures), coverage thresholds (P-236-style per package), and shared test helpers (mock providers P-146, temp-dir helpers, fake bus P-241). Establishes the runner dispatch + a lint rule that catches `it.only`/skipped needing justification.

**Files to Create/Modify:**
- `Packages`-level `bunfig.toml` test config (new)
- `packages/core/src/test/helpers.ts`, `packages/cli/src/test/helpers.ts`, `packages/web/src/test/setup.ts` (align)
- `AGENTS.md` / `CONTRIBUTING.md` testing section (new — conventions doc)
- `test.guard.test.ts` (new — asserts conventions)

**Implementation Steps:**
1. Define conventions in a `TESTING.md`/doc + `AGENTS.md`:
   - Layout: colocated `__tests__` or `*.test.ts` next to source; Bun `bun test`.
   - Naming: `describe('Module')` / `it('does X when Y')`; AAA (arrange/act/assert) with clear boundaries; one behavioral assertion per `it` where possible.
   - Determinism: inject clocks/rng (never `Math.random`/`Date.now` directly); freeze with `vi.useFakeTimers`.
   - Isolation: no real network/fs — mock `fetch`, use `mkdtemp` helpers for fs, mock providers (P-146), fake event bus (P-241).
   - Coverage: per-package thresholds (core lines≥80/branch≥70; keep P-236 web).
2. Shared `helpers.ts`: `tempDir()`, `withTempDir`, `mockOpenRouter()`, `fakeBus()`, `mkFixtureRepo()` (P-188 reuse), `tokenFreeze`, `expectNotes`.
3. Root dispatch: root `bun run test` runs each package's suite (P-258-adjacent) via workspace; a `test:unit` aggregate.
4. A `test.guard.test.ts` (repo-level) verifies: no `it.only`/`test.only` committed, no `.skip` without a linked issue (lint), and that `helpers` don't hit the network.
5. CI: unit job runs fast (parallel packages), deterministic (seeded), with the coverage gates (P-257).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Conventions documented (TESTING.md/AGENTS.md) + enforced
- [ ] Shared helpers (tempDir, mock providers, fakeBus, fixtures) in place
- [ ] Deterministic (no time/rng sinks), no network/fs side effects in units
- [ ] Per-package coverage thresholds configured
- [ ] `it.only`/unjustified `.skip` lint-blocked; guard test enforces
- [ ] Root unit dispatch works; CI-wired

**Tests Required:** `test.guard.test.ts` + per-package suites under thresholds.

**Dependencies:** P-252. Mocks P-146/P-241, fixtures P-188.

**Handoff Notes:** Next: P-254 integration fixtures. Conventions make the suite reliable at scale; keep helpers in `src/test` (not a root `test-utils`) so packages own their mocks and can diverge when needed.

---




### P-254: Testing - Integration Fixtures

**Owner:** inbesat + aradhy | **Wave:** 3 | **Depends On:** P-253

**Context:** Realistic, reproducible integration data. This phase builds the integration fixture corpus: committed mini-repos A/B (P-188 reused + extended) with real git history, known-dependency packages touching each ecosystem (P-112), license scenarios (P-120/P-121/P-122/P-123), a deterministic lockfile set, and network/mock fixtures for providers P-146 + sandbox P-180. Fixtures are versioned and immutable so integration tests stay stable.

**Files to Create/Modify:**
- `packages/core/test-fixtures/` (new — repos, manifests, licenses, sbom, lockfiles)
- `packages/cli/test-fixtures/` (new — configs, sessions)
- `packages/web/cypress/playwright fixtures` (P-233 reuse)
- `test-fixtures/README.md` (new — index + provenance of fixtures)
- `fixtures.verify.test.ts` (new — integrity check)

**Implementation Steps:**
1. Extend the P-188 A/B fixture repos with richer content: multiple files + dirs, an `npm`/`bun` manifest with a known deps graph, per-file commit history with distinct authors for provenance (P-181/182), a couple of nested dirs for tree tests (P-213), and a conflicting-version pair for deps (P-109/P-111) + a flagged license (P-120) + a dual (P-122) + an unknown (P-123).
2. Add ecosystem manifests: `package.json` (bun/npm), plus fixture `pyproject.toml`/`requirements.txt` if a py ecosystem is in scope (P-112), and a lockfile set.
3. License fixtures: small synthetic packages with known license fields (including GPL-3.0, MIT, BSD-2-Clause, unknown/absent, dual SPDX) matching P-119/P-120/P-123.
4. A list of **expected outcomes** per fixture (e.g. "A∩B conflict → review verdict", "GPL → warn") recorded in `test-fixtures/README.md` so tests assert intent, not accident.
5. `fixtures.verify.test.ts`: hash-checks every fixture file against a committed manifest (P-186-style) so nobody edits a fixture silently and breaks downstream tests; regenerates the manifest on change with a note.
6. Versioning: fixtures immutable within a version; a `FIXTURE_VERSION` const bump when intent changes (self-documenting).

**Required MCPs/Connectors:** None — local repo creation (git) once.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] A/B repos extended (tree, deps, authors, conflicts, licenses)
- [ ] Ecosystem manifests + lockfile fixtures present
- [ ] License fixtures cover normal/GPL/dual/unknown
- [ ] Expected-outcomes documented per fixture
- [ ] Integrity verify test + immutable versioning
- [ ] Reused by integration/E2E (P-254/255/256/251)

**Tests Required:** `fixtures.verify.test.ts`:
- `it('hashes match manifest')`, `it('licenses parse as intended')`, `it('conflict present')`

**Dependencies:** P-253. Fixtures P-188, ecosystems P-112, license P-119–P-123.

**Handoff Notes:** Next: P-255 E2E CLI. Fixtures are shared truth across unit/integration/E2E — edit only via the verify+regenerate workflow, never in-place silently.

---




### P-255: Testing - E2E CLI

**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-254

**Context:** Prove the shipped CLI binary works end-to-end. This phase adds CLI end-to-end tests that run the real `stitch` binary (built, P-189) against the integration fixtures (P-254) through real filesystem + git + (stubbed) sandbox: `init` → `add A`/`add B` → `license` → `deps` → `merge --yes` → verify C + provenance, plus error/exit-code paths (P-203) and `--json` output stability (P-194/P-247). Asserted via exit codes + emitted files + audit logs, not internals.

**Files to Create/Modify:**
- `packages/cli/e2e/cli.spec.ts` (new)
- `packages/cli/e2e/helpers.ts` (new — build + temp project)
- `packages/cli/e2e/config` (new — sandbox stub)
- CI: CLI E2E job

**Implementation Steps:**
1. `helpers.ts`: `buildCli()` (bun build → dist bin), `withProject(fixtures)` (temp dir + copy fixtures + stub `.stitch` config disabling network AI via mock provider P-146 and sandbox-verify via P-180 stub).
2. Flow test (`cli.spec.ts`):
   - `init` → assert `stitch.toml` created (P-190).
   - `add <a>` + `add <b>` → assert sources recorded (P-191).
   - `license --yes` → assert exit 0 + decisions persisted (P-196).
   - `deps --json` → assert report contains the expected conflict resolution (P-197/P-254 expectation).
   - `merge --yes --out <tmp>` → assert exit 0, C dir has expected files, CREDITS + SBOM + checksums present (P-192/P-181–P-186).
   - Re-`merge` → idempotent (P-250) exits without duplicate.
3. Error/exit tests: empty sources `NOTHING_TO_STITCH` exit 4 (P-192/P-203), invalid config exit 3, license-hard-deny blocked exit 20 (P-196), sandbox-unavailable exit 30 (P-195) when stub marked unavailable.
4. `--json` stability: `status --json`, `audit --json`, `deps --json`, `merge --dry-run --json` match the P-252 schema (conformance).
5. Run headless/CI; real git, real fs, stubbed network+sandbox for determinism; generous timeouts.
6. Test the suite passes + stable.

**Required MCPs/Connectors:** Stubbed sandbox + mock AI (no network).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Full init→add→license→deps→merge→verify flow on fixtures passes
- [ ] C + CREDITS + SBOM + checksums produced; audit populated
- [ ] Re-merge idempotent
- [ ] Error/exit-code paths match P-203 (4/3/20/30)
- [ ] `--json` outputs conform to P-252 schema
- [ ] Runs headless in CI; stable (no flakes)

**Tests Required:** `cli.spec.ts`:
- `it('full flow')`, `it('idempotent re merge')`, `it('exit codes')`, `it('json conform')`

**Dependencies:** P-254. CLI commands P-189–P-207, fixtures P-254, contract P-252.

**Handoff Notes:** Next: P-256 E2E Web. CLI E2E is the ground-truth acceptance of the shipped tool; keep it network-free (stub) so it's deterministic in any CI.

---




### P-256: Testing - E2E Web

**Owner:** aradhy | **Wave:** 3 | **Depends On:** P-255

**Context:** Prove the served web app end-to-end with a real browser against the CLI+core (not mocks). This phase runs Playwright (P-233) against `stitch serve` (P-193) with the integration fixtures (P-254) + stubbed provider/sandbox, covering the full happy path (P-233 merge.flow) plus persistence/refresh (session/provenance P-230/P-222), job history live-update (P-224), HIL approve/reject (P-218), and error/empty states (P-228/P-229). It asserts the real API schema (P-252).

**Files to Create/Modify:**
- `packages/web/e2e/full.spec.ts` (new — beyond P-233 flow)
- `packages/web/e2e/helpers.ts` (extend — serve with fixtures + stubs)
- `packages/web/e2e/hil.spec.ts` (new)
- CI: Web E2E job (Chromium)

**Implementation Steps:**
1. Extend `e2e/helpers.ts`: `serveWithFixtures()` boots real `stitch serve` (P-193) with `~/.stitch` stubbed (mock AI provider P-146 + sandbox stub P-180); waits `/health`; cleans up after.
2. `full.spec.ts` — happy path + persistence:
   - Onboarding (P-229) → add A/B local fixtures (P-211/212) → select files (P-213/214) → Run Merge → thinking stream (P-216) visible → review diff (P-217) → approve → C created → Results shows sandbox verdict + CREDITS (P-221/222).
   - Reload page → sources/selection persisted (P-230 session/store) and job history lists the completed run (P-224).
3. `hil.spec.ts` — human-in-the-loop: configure a job that pauses at a license unknown (P-220) → "awaiting approval" state → user decides → resumes → completes; + a reject path (P-218) that records the rejection and shows the summary.
4. Assert live WS updates (P-223): the thinking stream ticks without navigation (real bus→WS P-241/P-193).
5. Validate a couple of responses against the P-252 schema (contract conformance through the browser path).
6. Headless in CI (Chromium); screenshots+trace on failure (P-233); stable timeouts.

**Required MCPs/Connectors:** Stubbed provider/sandbox; real serve+core.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Full happy path drives real serve+core+web to C created + results
- [ ] Persistence across reload; job history populated
- [ ] HIL pause→decide→resume + reject paths pass
- [ ] WS live updates observed (no navigation)
- [ ] Responses conform to P-252 schema
- [ ] Headless CI green + stable

**Tests Required:** `full.spec.ts`, `hil.spec.ts`:
- `test('happy path + persist')`, `test('hil resolve + reject')`, `test('ws live')`

**Dependencies:** P-255. Serve P-193, fixtures P-254, contract P-252, HIL P-160.

**Handoff Notes:** Next: P-257 CI matrix. Web E2E is the acceptance of everything below it (web+CLI+core+orchestration) working as one shipped app — keep it stubbed-only for determinism.

---




### P-257: Testing - CI Matrix

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-256

**Context:** Reliable builds across environments. This phase formalizes the CI matrix: OS (linux/win/mac), Node/Bun versions, and the pipeline order (typecheck → lint → unit (P-253) → integration (P-254) → coverage → CLI E2E (P-255) → Web E2E (P-256) → bundle/perf (P-237)), with caching, artifact retention, and a flaky-retry policy. CI becomes the enforced gate for every PR (P-258-dependent) and nightly for perf/E2E.

**Files to Create/Modify:**
- `.github/workflows/ci.yml` (new — or package-tool CI)
- `.github/workflows/nightly.yml` (new — perf + E2E full)
- `bunfig` CI cache config
- `ci.matrix.test.ts` (new — validates job config invariants)

**Implementation Steps:**
1. `ci.yml` matricing: `os: [ubuntu-latest, windows-latest, macos-latest]` × `bun: [latest, lts]`; each with the ordered jobs:
   - Install (`bun install --frozen-lockfile`, cache `~/.bun/install/cache`).
   - `typecheck` (all packages) → `lint` (eslint P-258) → `unit` (bun test per package, P-253) with coverage threshold.
   - `integration` (P-254 fixture verify + orchestration suite P-251).
   - `cli-e2e` (P-255) and `web-e2e` (P-256) — on ubuntu (Docker sandbox stub; fix the OS subset for speed, run full matrix on nightly).
2. Caching: Bun install cache + `~/.stitch/cache` (P-250) keyed by lockfile hash; artifacts (E2E screenshots/traces P-233/P-256, coverage reports) uploaded on failure.
3. Flaky policy: retry (max 1-2) only on known-flaky E2E with `--last-failed`; a `flaky` tag to quarantine + nightly triage.
4. `nightly.yml`: full OS×Bun matrix + perf (P-237) + full E2E + bundle budgets; posts a report to a status check/issue.
5. `ci.matrix.test.ts` (repo-level): asserts the workflow YAML declares required jobs, no `it.only` (P-253), lockfile present, and that coverage budgets exist — so CI config can't rot.
6. Add a `concurrency: cancel-in-progress` + timeout per job (P-246 spirit) to avoid leaked runs.

**Required MCPs/Connectors:** CI runners; Docker for sandbox (stubbed in tests).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] OS×Bun matrix with ordered jobs (typecheck→lint→unit→integration→e2e)
- [ ] Bun + stitch caches keyed; failure artifacts (screenshots/traces/coverage) uploaded
- [ ] Flaky retry policy + quarantine tag; nightly full matrix + perf
- [ ] `concurrency` cancel-in-progress + job timeouts
- [ ] Config invariants test passes
- [ ] CI green on PR gate

**Tests Required:** `ci.matrix.test.ts`:
- `it('declares required jobs')`, `it('no focused tests')`, `it('lockfile present')`, `it('coverage budgets')`

**Dependencies:** P-256. E2E P-255/256, unit P-253, coverage P-236.

**Handoff Notes:** Next: P-258 lint+type gates (continues Testing). CI is the enforced contract for the repo — keep the matrix fast on PR (subset OS for e2e) and exhaustive nightly; a red CI is a PR must-fix, never merge-around.

---




### P-258: Testing - Lint+Type Gates

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-257

**Context:** Static quality as a hard gate. This phase configures ESLint + TS strict typechecking across all packages with a shared config, adds repo-wide lint/typecheck scripts, enforces the gates in CI (P-257/CI), and wires common rules (no `any`, no unused, import boundaries, `no-secrets`, security rules for the crypto/shell-safe modules P-026/P-205). Failures block merge (P-258 is the pre-merge gate).

**Files to Create/Modify:**
- `eslint.config.js` (root — shared flat config)
- `packages/*/eslint.config.js` + `tsconfig.json` (strict extensions)
- `.github` CI job additions (lint+typecheck gate) / root scripts
- `lint.guard.test.ts` (new — asserts config invariants)

**Implementation Steps:**
1. Root `eslint.config.js`: flat config with `typescript-eslint` recommended + strict overrides, `jsx-a11y` (web P-231), `import` ordering, `@typescript-eslint/no-explicit-any` as error, `no-unused-vars` error; a custom rule/plugin `no-path-traversal` guard for unsafe `fs` targets (ties P-205); `eslint-plugin-no-secrets` for keys in source (P-206 redaction parity).
2. `tsconfig.json` root + per-package: `"strict": true` (already P-041), `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` optional where feasible, `noEmit` for checks.
3. Root scripts: `lint` (`eslint .`), `lint:fix`, `typecheck` (`tsc -b` or per-package) — used by CI (P-257) and `test.guard`/`ci.matrix` (P-253/P-257).
4. Import-boundary rule: core must not import cli/web; cli may import core; web may import core (no circular/illegal) — enforces the package architecture.
5. `lint.guard.test.ts`: asserts the configs exist, strict is on, `no-explicit-any` is error, boundary rule present, and `lint:fix` doesn't leave changes on a sample file (idempotent).
6. CI: add lint+typecheck as a required pre-merge gate job (P-257 order), plus a pre-commit hook (husky/lefthook) for `lint:fix` on staged TS.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Shared flat ESLint config strict (no any, no unused, import order, no-secrets, path-traversal guard)
- [ ] TS strict + noUncheckedIndexedAccess per package; typecheck works
- [ ] Import-boundary rule enforces core←cli←web layering
- [ ] Root `lint`/`typecheck` scripts; CI pre-merge gate + pre-commit hook
- [ ] `lint.guard.test.ts` passes (config invariants, `lint:fix` idempotent)
- [ ] All existing code passes lint/typecheck

**Tests Required:** `lint.guard.test.ts`:
- `it('strict on')`, `it('no any error')`, `it('boundary rule')`, `it('fix idempotent')`

**Dependencies:** P-257. TS P-041, paths P-205, secrets P-206.

**Handoff Notes:** Next: P-259 coverage. Lint+type are the cheap gates caught before any test runs — treat them as merge-blocking, never a suggestion. Boundary rule keeps packages decoupled (P-041).

---




### P-259: Testing - Coverage

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-258

**Context:** Know what's tested. This phase wires unified coverage across packages: per-package thresholds (P-253), a combined repo coverage report, a coverage-delta gate (no PR may reduce coverage below threshold/baseline), and a dashboard/`codecov`-style report for visibility. It also excludes generated/boilerplate files (client.generated P-252, vite config) from thresholds with justification.

**Files to Create/Modify:**
- `packages/*/vitest/bun config` (coverage add)
- Root `coverage.config.ts` (new — thresholds + merge)
- `coverage.guard.test.ts` (new — asserts thresholds apply)
- CI coverage job (modify P-257)

**Implementation Steps:**
1. Per-package coverage config: core (lines≥80, branches≥70, functions≥75), cli (lines≥75, branches≥65), web (P-236 existing), with excludes: generated client (P-252), `vite.config`, `eslint.config`, test helpers.
2. Root `coverage.config.ts`: aggregates per-package reports into one (sum files, or publish per-package + a summary JSON); declares the **delta gate** — a PR must not drop total lines% below the baseline or reduce total by >0.5pt versus base (computed by the CI compare job).
3. Scripts: `test:cov` per package, `coverage:report` aggregates to `coverage/`, `coverage:gate` runs the delta check against the base ref.
4. CI (P-257): the coverage job uploads the report artifact and fails the PR if the delta gate or thresholds miss; includes a baseline stored in `coverage/baseline.json` regenerated by maintainers.
5. `coverage.guard.test.ts`: asserts each package declares thresholds, excludes are justified (a file list), and the delta-gate script exists and fails correctly on a synthetic negative delta.
6. Hard-to-test branches (rare error paths) get an `istanbul-ignore` comment + a tracked list; coverage of those is reported but not counted.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Per-package thresholds + excludes (generated/boilerplate justified)
- [ ] Unified report aggregation + delta gate (no coverage regression)
- [ ] `test:cov`/`coverage:report`/`coverage:gate` scripts
- [ ] CI coverage job with artifact + baseline compare; merge-blocking
- [ ] `coverage.guard.test.ts` passes (config + synthetic negative delta)
- [ ] Hard-to-test branches tracked + istanbul-ignored

**Tests Required:** `coverage.guard.test.ts`:
- `it('declares thresholds')`, `it('excludes justified')`, `it('delta gate fails negative')`

**Dependencies:** P-258. Unit P-253, CI P-257.

**Handoff Notes:** Next: P-260 merge snapshots. Coverage is a floor, not a target — drive new tests by risk, and keep the delta gate strict so the suite can't silently erode.

---




### P-260: Testing - Merge Snapshots

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-259

**Context:** Guard the merge output deterministically. This phase adds snapshot tests for merge: given fixture inputs (P-254), the generated C tree + provenance + checksums + deps resolution must match a committed snapshot (P-181–P-186/P-250). A changed output fails loudly so accidental regressions (field renames, wrong attribution, moved files) are caught. Snapshot updates are deliberate (reviewed diff).

**Files to Create/Modify:**
- `packages/core/src/pipeline/__tests__/merge.snapshot.test.ts` (new)
- `snapshots/` (new — committed expected outputs per fixture)
- `snapshots/README.md` (new — update policy)

**Implementation Steps:**
1. Define snapshot capture: for each fixture scenario (P-254), run `runPipeline` (P-238, stub AI + sandbox P-180) and serialize: the output file tree (rel paths + sizes + hashes P-186), `CREDITS.md` text (P-182), SBOM JSON (P-183), checksum manifest (P-186), and the deps `DependencyReport` (P-116) — a deterministic, sorted representation.
2. Commit snapshots under `snapshots/<scenario>/` + a `.json` index. Tests compare freshly-generated output to the committed snapshot; mismatch → fail with a clear diff of what changed (file added/removed/renamed, attribution changed, etc.).
3. Normalize non-deterministic fields before compare: timestamps (P-253 clock inject), job ids, absolute paths (relative-ize), and sort keys so runs are stable.
4. Update policy: when an intentional change alters output, run `update-snapshots` (a script) and include the snapshot diff in the same PR — the review **is** the approval of behavior change (P-250 idempotency parity).
5. Guard: a `snapshots.lock` hash (P-186) so the snapshot corpus can't be silently edited; update regenerates + records what changed.
6. Test the snapshot suite passes deterministically (run twice → identical) and that a forced perturbation fails.

**Required MCPs/Connectors:** Stubbed AI/sandbox (P-180); local fs.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Snapshot captures C tree + CREDITS + SBOM + checksums + deps report deterministically
- [ ] Non-deterministic fields normalized before compare
- [ ] Mismatch fails with a clear change diff
- [ ] `update-snapshots` script; snapshot diff reviewed in-PR; lock-hash guard
- [ ] Suite deterministic (run-twice identical); perturbation fails
- [ ] Tests pass

**Tests Required:** `merge.snapshot.test.ts`:
- `it('matches snapshot ascii')`, `it('deterministic twice')`, `it('perturbation fails')`

**Dependencies:** P-259. Pipeline P-238, provenance P-181–P-186, fixtures P-254.

**Handoff Notes:** Next: P-261 deps property tests. Snapshots pin the entire merge contract; keep them deterministic (clock/hash normalization) or they'll flake and erode trust in the gate.

---




### P-261: Testing - Deps Property Tests

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-260

**Context:** Deps merging is a rules engine with combinatorial edge cases (P-104–P-117). This phase adds property-based (fast-check) tests: given generated-but-valid manifests, the merge/resolution functions must satisfy invariants — union is superset, no duplicate resolution keys, version resolution respects semver constraints (P-107/P-109), dedupe never drops a conflicting pin silently, and the report is internally consistent (P-116). Any counterexample shrinks to a minimal failing manifest.

**Files to Create/Modify:**
- `packages/core/src/deps/__tests__/deps.property.test.ts` (new)
- `packages/core/src/deps/__tests__/arbitraries.ts` (new — manifest generators)

**Implementation Steps:**
1. `arbitraries.ts`: generate valid package manifests — arbitrary package names (dotted scoped), versions as semver-ish (P-107), dependency maps with ranges, duplicate-name cross-manifest collisions, peer/optional ranges — via `fast-check` combinators with a max-depth/size budget.
2. Invariants to assert (property tests):
   - **Union superset**: `unionManifests(A,B)` (P-108) ⊇ each input (no declared dep silently dropped).
   - **Deterministic**: same inputs → same output (P-250-style).
   - **Resolution validity**: for a chosen resolution, every version satisfies its resolved semver range (P-109/P-107).
   - **No dup keys**: `DependencyReport` has unique package keys (P-116).
   - **Conflict completeness**: any version-mismatch pair is either resolved or surfaced as a conflict (never silently one side dropped, P-111).
   - **Dedupe safety**: dedupe (P-111) only unifies compatible versions or reports; incompatible stays flagged.
3. Shrink-to-minimal: on violation, `fast-check` shrinks to the smallest manifest; seed set from a fixed seed + recorded for CI repro.
4. Add a regression corpus of hand-picked adversarial cases (missing ranges, `*`+pin, workspace aliases) alongside.
5. CI: includes the property suite with a fixed-seed determinism run (P-253) + a larger randomized run on nightly (P-257).
6. Test the suite passes (no invariant violations) and that a seeded counterexample reproduces stably.

**Required MCPs/Connectors:** None — pure functions.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Manifest arbitrary generators (scoped names, semver ranges, collisions, peer/optional)
- [ ] Invariants asserted (superset, deterministic, resolution-valid, no-dup-keys, conflict-complete, dedupe-safe)
- [ ] Shrink-to-minimal + fixed-seed repro for CI
- [ ] Adversarial regression corpus included
- [ ] CI fixed-seed + nightly randomized run
- [ ] Suite green

**Tests Required:** `deps.property.test.ts`:
- `property('union superset')`, `property('resolution valid')`, `property('no dup keys')`, `property('conflict complete')`, `property('dedupe safe')`

**Dependencies:** P-260. Deps P-104–P-117.

**Handoff Notes:** Next: P-262 perf benchmarks. Property tests catch combinatorial deps bugs unit tests miss; keep the generators close to real manifests or the invariants prove nothing.

---




### P-262: Testing - Perf Benchmarks

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-261

**Context:** Guard performance regressions. This phase adds benchmark harnesses for the hot paths: dep-merge on large manifests (P-108–P-116), file-tree listing over large repos (P-103/P-213 virtualization feeding), sandbox/verify latency, and web bundle size (P-237). Benchmarks run on nightly (P-257) with baseline comparison and a regression budget that fails CI if exceeded; results recorded in a `PERF.md`.

**Files to Create/Modify:**
- `bench/` (root — harness + per-area benches)
- `bench/merge.manifest.bench.ts`, `bench/tree.bench.ts`, `bench/sandbox.bench.ts`, `bench/web.bundle.bench.ts` (new)
- `bench/baselines.json` (new — committed baselines)
- `PERF.md` (new — budgets + recent results)
- CI nightly perf job (P-257 modify)

**Implementation Steps:**
1. Harness: `bun bench` or a small `bench/run.ts` that runs each scenario N times, measures (ms, ops/sec, R² for stability), and writes normalized results (`p50/p95`).
2. Benches:
   - **Dep-merge**: 10k-dep synthetic manifests via P-261 arbitraries (fixed seed) → time `unionManifests`+resolve+report (P-108/P-111/P-116). Budget p50 < threshold.
   - **Tree listing**: a 100k-file synthetic tree on disk → time `listFiles` (P-103) + the web client hydration path. Budget as above.
   - **Sandbox verify**: measure `sandbox.verify` on a small fixture via stub/docker if present (P-177) — gate only the overhead, not network.
   - **Web bundle**: Vitest-based build + size assertions (P-237) reusing the rollup budget.
3. `baselines.json`: committed p50 baselines; the gate fails when a bench exceeds baseline by >X% (e.g. 20%) or an absolute budget. A PR touching a hot module must run the relevant bench locally + may update baseline with justification.
4. `PERF.md`: documents budgets, how to run (`bun run perf`), recent results table, and the regression policy.
5. Nightly job (P-257): runs all benches on clean CI and posts a delta report (status check); a budget violation posts/creates an issue for triage.
6. Test/demo: run the harness once to establish baselines; assert `run perf` exits 0 within budget.

**Required MCPs/Connectors:** Sandbox bench may need docker (optional/stub-able).

**Skills to Invoke:** benchmark skill — optional.

**Acceptance Criteria:**
- [ ] Bench harness (ms/p50/p95, determinism) + 4 bench areas
- [ ] Committed `baselines.json`; regression gate (relative + absolute budget)
- [ ] Synthetic-data inputs reused from P-261 arbitraries / tree generator
- [ ] `PERF.md` documents budgets + run instructions + policy
- [ ] Nightly perf job posts delta report / triage issue
- [ ] `run perf` green within budget

**Tests Required:** bench files:
- `bench('merge manifest')`, `bench('tree')`, `bench('sandbox overhead')`, `bench('web bundle')` (+ gate assertions)

**Dependencies:** P-261. Deps P-108–P-116, tree P-103, sandbox P-177, bundle P-237.

**Handoff Notes:** Next: P-263 release pipeline. Perf, like coverage, is a floor — use the nightly deltas to catch regrations before they ship; never raise budgets without a measured, explained reason.

---




### P-263: Testing - Release Pipeline

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-262

**Context:** Repeatable, auditable releases. This phase builds the release pipeline: version bump (semver P-013), changelog generation (P-004/Conventional Commits), package publish (core to npm, CLI as binary), OCI image build/publish (P-264 links), provenance/SBOM tagging (P-183), checksum + signature generation for the installer (P-279), and a GitHub release with assets. All gated by the full CI (P-257) passing on the release branch.

**Files to Create/Modify:**
- `.github/workflows/release.yml` (new)
- `scripts/release/` (new — bump, changelog, checksum, publish scripts)
- `CHANGELOG.md` (new)
- `scripts/release/release.test.ts` (new)

**Implementation Steps:**
1. `scripts/release/bump.ts`: read conventional commits since last tag, `semver.inc` (P-013) by type (feat → minor, fix → patch, breaking → major), update package version via workspace (P-041/P-005), generate `CHANGELOG.md` grouped (Added/Changed/Fixed/etc.).
2. `release.yml` (workflow on tag `v*` or a `release` dispatch):
   - Guard: require CI green (P-257) + lint/typecheck/coverage gates + release checklist on PR.
   - Build artifacts: `bun build` CLI binaries for linux/darwin/win (P-279-installer input), `bun publish` core to npm (P-278), build + tag the OCI image (P-264).
   - Provenance: attach SBOM (P-183) + checksums (P-186) + a signed digest (minisign/`gh attest`, using a protected secret) as release assets; write a `ReleaseRecord` to audit (P-187).
   - Create the GitHub Release with the changelog + asset links; tag with `v<ver>`.
3. Determinism: builds from locked lockfile (`--frozen-lockfile`), reproducible registry of published tarball hashes.
4. Dry-run mode: `release --dry-run` builds/sums and prints the plan without publishing (counterpart of P-244).
5. `release.test.ts`: unit-test bump/changelog/sum logic with a synthetic git history; verify the workflow YAML declares the guard.
6. Rollback/patch path: a documented quick-patch (bump patch + republish) reusing the pipeline.

**Required MCPs/Connectors:** GitHub (releases), npm registry (publish), container registry (P-264).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Conventional-commit → semver bump + changelog generation
- [ ] Release workflow gated on green CI + builds CLI binaries + publishes core + tags OCI image + SBOM/checksums/signature assets + GitHub release
- [ ] `ReleaseRecord` in audit; deterministic (frozen lockfile, hashes)
- [ ] `release --dry-run` plans without publishing
- [ ] `release.test.ts` + workflow guard assertions pass

**Tests Required:** `release.test.ts`:
- `it('bumps by type')`, `it('generates changelog')`, `it('sums assets')`, `it('workflow guard')`

**Dependencies:** P-262. Semver P-013, release (P-278), image (P-264), SBOM P-183.

**Handoff Notes:** Next: P-264 Docker CI. The release pipeline is the durable path to users — keep it fully gated and reproducible; every release records provenance (P-183/187) so artifacts are auditable.

---




### P-264: Testing - Docker CI

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-263

**Context:** Containerized, consistent testing + shipping. This phase adds Docker-based CI: a hermetic build image (pinned bun/node), the sandbox runner image (P-169/178 as part of the image set), a containerized test job (unit/e2e run in the image for environment parity P-254/255/256), and multi-arch OCI image build/publish for the server+CLI (feeds P-263 release). This normalizes environments and eases the sandbox (P-168) story.

**Files to Create/Modify:**
- `Dockerfile.test` (new — hermetic test image)
- `Dockerfile` (new — runtime image: serve + web dist + CLI)
- `docker-compose.test.yml` (new — or GH Actions `container`)
- `.dockerignore` (new)
- `packages/sandbox/src/image.ts` (modify/ref — build the P-169 runner image via this Dockerfile set)

**Implementation Steps:**
1. `Dockerfile.test`: FROM pinned `oven/bun:<ver>`; copy lockfile + install `--frozen-lockfile`; copy sources; `CMD` runs typecheck+lint+test (P-258/P-253) — used by CI (P-257) so all jobs share exact toolchain.
2. `Dockerfile` (runtime): stage 1 builds web (P-208 dist) + core/cli; stage 2 minimal runtime (bun) copies `dist` + cli binary + `serve` entry; exposes the serve port; `HEALTHCHECK` hits `/health` (P-193).
3. Sandbox runner image (`Dockerfile.sandbox`): the ephemeral per-ecosystem image (P-169/P-178) built from `sandbox/` with the pinned toolchains (bun/node/py as scoped); `image.ts` (P-181? Actually sandbox P-168/169) `docker build`s it once + caches layers (P-179).
4. Multi-arch: `docker buildx build --platform linux/amd64,linux/arm64 --push` for the runtime image tag `stitch:<ver>` (P-263 release) + nightly build.
5. CI job: run the suite inside `Dockerfile.test` (environment parity across OS matrix P-257) and build the runtime image + run the sandbox-runner smoke (P-180) inside Docker.
6. `docker-compose.test.yml`: optional local `docker compose up test` running the same image for reproducible local QA.

**Required MCPs/Connectors:** Docker daemon; container registry (push).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Hermetic test image (pinned bun) runs typecheck/lint/test; CI uses it
- [ ] Runtime image multi-stage (web dist + cli + serve) with healthcheck
- [ ] Sandbox runner image built + layer-cached (P-169/P-179/P-180 smoke)
- [ ] Multi-arch buildx image built/pushed on release + nightly
- [ ] `docker-compose.test.yml` for local parity
- [ ] Docker CI job green

**Tests Required:** Docker CI jobs (smoke): image builds, `docker run image /health` 200, sandbox-runner smoke (P-180).

**Dependencies:** P-263. Sandbox P-168/169/178/179/180, release P-263.

**Handoff Notes:** Next: P-265 security audit. Docker gives environment parity for tests and a real runtime artifact; keep images pinned + scanned (P-265) so CI doesn't ship a vulnerable base.

---




### P-265: Testing - Security Audit

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-264

**Context:** Security by default, verified. This phase adds a security audit layer: dependency vulnerability scanning (OSV/`bun audit`), secrets-archaeology + source scanning (P-206 no-secrets parity, `git log` for leaked keys), license-policy spot-checks (P-127), a hardened-build SLSA-ish attestation on release (P-263), and a supply-chain check on publish (P-278). It produces a `SECURITY.md` + triage trie and runs on nightly + release.

**Files to Create/Modify:**
- `SECURITY.md` (new — reporting + supported versions)
- `scripts/security/audit.sh|ts` (new — vulnerability + secrets + deps scan)
- `.github/workflows/security.yml` (new — nightly + release gate)
- `security.test.ts` (new — asserts scanning config)

**Implementation Steps:**
1. Dependency scan: `bun audit`/OSV (P-013-gated) over the monorepo lockfile; parse advisories, fail on `high/critical` unfixed, allowlist with justification (dated, tracked issues). Wired into CI (P-257) as a gate + nightly for newer advisories.
2. Secrets scan: a script greps source + committed history (`git log -p`) for key patterns (P-206 redaction list) and high-entropy strings; fails on hits (with the risk: developer may need history rewrite + key rotation, documented in SECURITY.md). Runs on release + nightly.
3. License spot-check: run the P-127 policy over lockfile (P-116 report) and fail on un-allowlisted hard-deny (P-120) in shipped artifacts.
4. Supply-chain/attestation: on release (P-263), generate build provenance (P-183 SBOM + `gh attest`/SLSA) attesting to the build; verify the published tarball hash matches (P-186 checksums).
5. `SECURITY.md`: responsible-disclosure section (report to security@), supported versions, and a security triage policy (P-266-quality dashboard ties in).
6. `security.test.ts`: asserts the scan scripts exist + have the right allowlist format + fail modes, and that `SECURITY.md` has the required sections.

**Required MCPs/Connectors:** Vulnerability DB (OSV/registry); `gh` attest (release); no external at scan-parse time.

**Skills to Invoke:** cso skill — optional/recommended for the audit run.

**Acceptance Criteria:**
- [ ] Dep-vuln scan (high/critical fail, allowlist justified) in CI + nightly
- [ ] Secrets archaeology (+ history) fails on hits; rotation documented
- [ ] License policy spot-check on shipped artifacts
- [ ] Release provenance/attestation + tarball hash verify (supply chain)
- [ ] `SECURITY.md` (disclosure + versions + triage)
- [ ] `security.test.ts` passes

**Tests Required:** `security.test.ts`:
- `it('scan config')`, `it('allowlist format')`, `it('secmd sections')`, `it('submit script fails')`

**Dependencies:** P-264. Deps P-013/P-116, license P-127/120, release P-263.

**Handoff Notes:** Next: P-266 quality dashboard. Security is a release gate, not a suggestion — treat any high/critical unfixed advisory as a blocking issue with a tracked exception. Run it on every release (P-263).

---




### P-266: Testing - Quality Dashboard

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-265

**Context:** One view of health. This phase builds a quality dashboard aggregating every gate: lint/typecheck (P-258), coverage (P-259), unit/integration (P-253/254), E2E (P-255/256), perf (P-262), security (P-265), flake rate (P-267), and release state (P-263) — into a weighted score persisted and trended (SQLite P-026), exposed via `stitch health` (P-194-adjacent CLI) and the web (P-224-adjacent). It surfaces regressions across runs.

**Files to Create/Modify:**
- `packages/core/src/quality/dashboard.ts` (new)
- `packages/core/src/quality/dashboard.test.ts` (new)
- CLI `stitch health` (modify or new command)
- Web health/metrics view (P-224 extension, optional)

**Implementation Steps:**
1. Define the `QualityReport` shape: per-area `{area, score0-100, status: pass|warn|fail, detail[]}` — lint, typecheck, coverage (P-259 delta), tests (unit+integration+E2E pass), perf (P-262 budget), security (P-265), flake (P-267 rate), release-readiness.
2. `dashboard.ts`:
   - `collectQuality(opts)` — runs/reuses the latest gate results (from CI reports on disk, or computes locally) and normalizes each to 0-100 (e.g. coverage% → score, flake% inverted, budgets mapped).
   - Weighted composite (e.g. tests 30%, coverage 15%, lint 15%, perf 15%, security 25%) → `overall`.
   - Persists a `QualitySnapshot` (timestamped) to SQLite (P-026) for trending; `trend(area, {from,to})` and `regression()` flags drops > threshold.
3. `stitch health`: CLI surfaces the latest snapshot (`--json` P-194 parity) + trend; `--gate` exits nonzero if the composite (or any `fail`) breaks CI (P-257 gate tie-in).
4. Web: a `/health`-style view (P-224 job-history extension) charts the trend over runs (reuse P-237 chart budget / P-209 tokens).
5. `dashboard.test.ts`: score normalization, weighting, persistence + trending, regression detection, gate exit logic.

**Required MCPs/Connectors:** None — SQLite + CI report files.

**Skills to Invoke:** health skill — optional (uses this).

**Acceptance Criteria:**
- [ ] QualityReport per-area normalization + weighted composite
- [ ] Snapshot persisted (SQLite) + trend + regression detection
- [ ] `stitch health [--json] [--gate]` works; web trend view
- [ ] `--gate` exit reflects fail/regression (CI tie-in)
- [ ] Tests pass

**Tests Required:** `dashboard.test.ts`:
- `it('normalizes scores')`, `it('weights composite')`, `it('trends + regression')`, `it('gate exit')`

**Dependencies:** P-265. Gates P-258–P-265, SQLite P-026, jobs P-224/194.

**Handoff Notes:** Next: P-267 flake triage (closes the Testing epic). The dashboard is the single health signal for CI/release — keep it data-driven from the same reports the gates use so the score can't lie.

---




### P-267: Testing - Flake Triage

**Owner:** inbesat | **Wave:** 3 | **Depends On:** P-266

**Context:** Flaky tests erode trust and CI. This phase adds flake triage: capture test timing/failures from CI (P-257), tag + quarantine `@flaky` tests (retry-then-quarantine policy), track a flake rate per test (P-266 feeds it), and provide a `flake` CLI/script to list + unquarantine once fixed (require consecutive passes with evidence). The goal is a <1% flake rate with visible owners.

**Files to Create/Modify:**
- `packages/core/src/quality/flake.ts` (new)
- `scripts/flake/*` (new — collect, quarantine, report)
- CI job additions (P-257) to record timing + flake metadata
- `flake.test.ts` (new)

**Implementation Steps:**
1. Collect metadata: the CI runner posts a `JUnit`/JSON of each test (name, duration, exit, flakes: retry count) to a store (SQLite P-026 via a small API or artifact ingestion on nightly P-257).
2. `flake.ts`:
   - `recordRun(results)` — ingest; compute per-test pass rate over a window (e.g. last N runs).
   - `classify(test)` — if pass-rate < 0.99 over window OR failed-then-passed (retry) > 1 → mark `@flaky`.
   - `quarantine`/`unquarantine` — flaky → moves to a `quarantine` mode (skipped in PR CI by default but runs nightly with a report, P-257).
   - `report()` — list flaky with owner + evidence (screenshots/trace links P-233/256).
3. Retry policy: PR CI retries once (`--last-failed` P-257) then quarantines if it flakes again; nightlies always run quarantined tests.
4. Unquarantine flow: a test must pass K consecutive nightly runs (e.g. 5) to be re-enabled; a `flake --unquarantine <test>` with evidence gate.
5. Integrate the rate into `QualityReport` (P-266 flake area) so it affects the health score + `--gate`.
6. `flake.test.ts`: classification, quarantine/unquarantine transitions, report shape, rate contribution.

**Required MCPs/Connectors:** None — local store (CI metadata ingest via artifacts).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] CI records per-test timing/flakes; ingested to store
- [ ] Classification (<99% or retry-flake → @flaky) + quarantine (PR-skip, nightly-run)
- [ ] Unquarantine requires K consecutive nightly passes + evidence
- [ ] Flake rate feeds P-266 health + `--gate`
- [ ] `flake` CLI lists/quarantines/unquarantines with owners
- [ ] Tests pass

**Tests Required:** `flake.test.ts`:
- `it('classifies')`, `it('quarantines')`, `it('unquarantine gate')`, `it('rate feeds score')`

**Dependencies:** P-266. CI P-257, snapshot P-260.

**Handoff Notes:** This closes the Testing epic (P-253–P-267). Next: P-268 begins the Docs epic (README). Flake triage keeps the gate honest — quarantine early, require evidence to restore, and let the dashboard (P-266) reflect the real rate.

---




### P-268: Docs - README

**Owner:** inbesat (root) | **Depends On:** P-267

**Context:** The front door. This phase writes the root `README.md`: a concise, accurate summary of what repo-stitcher is (compose two repos into one with AI-assisted stitch), a screencap/GIF teaser (web P-237 shell), install + first-run (QUICKSTART P-269 link), feature list mapped to epics, a CLI/web quick example, links to ARCHITECTURE/CONTRIBUTING/LICENSE/SECURITY, and badges (build, coverage, security, version). It reflects the shipped state so it never promises unbuilt features (sync P-259/P-268 release).

**Files to Create/Modify:**
- `README.md` (new)

**Implementation Steps:**
1. Structure: hero (name + tagline + demo GIF), badges, TL;DR, Why/What, Install (pinned instructions P-279), Quick start (3 commands: `stitch init`, `stitch add A`, `stitch add B`, `stitch merge`), Feature highlights (table: composition, AI stitch, licenses, provenance, sandbox, web/CLI) linking to each epic's landing section/docs, Architecture link (P-270), Docs links (CLI P-273/web P-274/config P-275/providers P-276/license P-277), Contributing (P-271), Security (P-265 `SECURITY.md`), License (P-127 output).
2. Accuracy gate: every claim in README is backed by a shipped phase or links to the roadmap issue; a `docs.accuracy.test.ts`-style check (CI, P-257) verifies referenced files/paths exist and the version badge matches package.json (P-263).
3. Use the built web (P-208) screenshot, not mockups; regenerate the GIF on release (P-263) via a script so it stays current.
4. Keep it concise (target < 2000 words); follow the project writing conventions (P-004 spirit, no AI-slop filler).
5. Troubleshooting: link to doctor (P-195) and common errors (P-203).
6. Test: README lint (markdown), all links resolve, badges current.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None (or document-generate skill referencing this — optional).

**Acceptance Criteria:**
- [ ] All standard sections present; concise + accurate
- [ ] Demo GIF from real build; badges current (build/coverage/security/version)
- [ ] Every claim backed by shipped phase/link (accuracy gate)
- [ ] Links to QUICKSTART/ARCHITECTURE/CONTRIBUTING/SECURITY/LICENSE
- [ ] Markdown lint + link check pass; version matches
- [ ] Written in project voice (no filler)

**Tests Required:** CI doc checks: markdownlint, link checker, README version == package.json.

**Dependencies:** P-267. QUICKSTART P-269, release P-263.

**Handoff Notes:** Next: P-269 QUICKSTART. README is the accuracy contract — keep it in sync with releases (P-263 bump) and never document aspirational features as live.

---




### P-269: Docs - QUICKSTART

**Owner:** inbesat | **Depends On:** P-268

**Context:** Get a working stitch in 5 minutes. This phase writes `docs/quickstart.md` (or `QUICKSTART.md`): prerequisites (git ≥2.40 P-065, bun, optional docker P-168), install (P-279), the minimal happy path with copy-paste commands, first-merge expectations (what you'll see: diff P-217, license P-220, sandbox P-221, CREDITS P-222), a troubleshooting table (P-203 codes → fix), and pointers to the deeper guides. It's verifiable by running the documented steps (CLI E2E P-255).

**Files to Create/Modify:**
- `docs/quickstart.md` (new)
- Docs landing links (index) (new)

**Implementation Steps:**
1. Walk through, commands that actually work (verified against P-255 E2E flow): install → `stitch init` (P-190) → `stitch doctor` (P-195) → `stitch add /path/to/A` + `stitch add /path/to/B` (P-191) → `stitch license --yes` (P-196 optional) → `stitch merge` (P-192) browse `--out`.
2. Show the web path (P-208–P-237): `stitch serve` → open localhost → pick → merge → review → approve.
3. Demystify the gates: what blocks a merge (license P-220, deps P-219, sandbox P-221) and how `--yes`/`stitch license` interact (P-160/P-196).
4. Include a "what should I see now" section (files in C: CREDITS P-182, SBOM P-183, checksums P-186).
5. Troubleshooting table mapping common `EXIT` codes (P-203: 2/3/4/10/20/30/40/50) to the remedy.
6. `quickstart.spec`-style CI: a script runs the documented commands on the fixtures and fails if the doc drifts from reality (ties P-255).

**Required MCPs/Connectors:** None (uses existing commands).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] 5-minute path with verified commands (CI re-runs them P-255 tie)
- [ ] CLI + web paths both covered
- [ ] Gates demystified (`--yes`/license/deps/sandbox)
- [ ] "What you should see" (CREDITS/SBOM/checksums) accurate
- [ ] Troubleshooting exit-code → remedy table complete
- [ ] CI quickstart-check passes

**Tests Required:** CI: `docs/quickstart` command sequence executes clean on fixtures.

**Dependencies:** P-268. Commands P-189–P-207, gates P-218–P-221, exit codes P-203.

**Handoff Notes:** Next: P-270 ARCHITECTURE. QUICKSTART is the onboarding path — it must stay byte-accurate with the CLI; the CI re-run keeps it from rotting.

---




### P-270: Docs - ARCHITECTURE

**Owner:** inbesat | **Depends On:** P-269

**Context:** How it fits together. This phase writes `docs/architecture.md`: the system diagram (monorepo packages, core ↔ cli ↔ web ↔ sandbox, orchestration, provenance), the pipeline data flow (P-238), module boundaries + ownership (P-041: core=P-00x, cli=aradhy, web=aradhy), the event bus/WS topology (P-241/P-193), persistence (SQLite P-026/P-239), and key invariants (idempotency P-250, license gating P-127/120, sandbox isolation P-168, provenance P-181). It's the map maintainers use to navigate.

**Files to Create/Modify:**
- `docs/architecture.md` (new)
- `docs/architecture.md` diagram assets (mermaid or image)

**Implementation Steps:**
1. Diagram: a Mermaid/markdown diagram of packages: `core` (git, deps, licenses, agent, sandbox, provenance, jobs) ← `cli` (commander P-189) + `web` (P-208) via `serve` (P-193); `sandbox` (docker P-168) and external providers (AI P-134, git P-065); orchestration layer (P-238 queue/events).
2. Sections:
   - **Package layout + ownership**: table of `packages/*`, owner (P-041), purpose, key exports (P-272 links).
   - **Pipeline flow**: stage-by-stage (P-238) with the state machine + blocking gates (HIL P-160, license P-220, sandbox P-221).
   - **Data & transport**: event topics (P-241), WS envelope (P-223), REST contract (P-252), SQLite stores (P-026 job/provenance/audit/trace/quality).
   - **Key invariants + failure modes**: idempotency (P-250), resume (P-240), rollback (P-245), cancel (P-246), security (P-265).
3. Keep the diagram source-controlled (rendered in CI or via the diagram skill) so it can't drift; reference the exact module names/paths.
4. Cross-link: ARCHITECTURE <-> CORE API (P-272), CONTRACT (P-252), and the epic docs.
5. A `diagram.spec`-style CI check that the mermaid asset is referenced (P-257 doc lint) + renders (if a renderer is wired).
6. Review: both owners (inbesat/aradhy) sign off on boundaries since P-041 ownership is documented here.

**Required MCPs/Connectors:** None (diagram skill optional).

**Skills to Invoke:** diagram skill — optional (render the mermaid to SVG/PNG).

**Acceptance Criteria:**
- [ ] Package/ownership + pipeline + data/transport + invariants sections accurate
- [ ] Diagram source-controlled + renders; referenced, not stale (CI check)
- [ ] Matches actual module names/paths (no invented APIs)
- [ ] Cross-links to API/contract/epic docs
- [ ] Owners reviewed (P-041 boundaries)
- [ ] Doc lint passes

**Tests Required:** CI doc lint + diagram reference/render check.

**Dependencies:** P-269. Pipeline P-238, ownership P-041, contract P-252.

**Handoff Notes:** Next: P-271 CONTRIBUTING. ARCHITECTURE is the maintainer map — keep diagrams in-repo (not external hosts) and authority-backed by the P-041 ownership table.

---




### P-271: Docs - CONTRIBUTING

**Owner:** inbesat | **Depends On:** P-270

**Context:** Lower the contributor barrier. This phase writes `CONTRIBUTING.md`: how to set up (bun install, P-041), the branch/PR workflow, the git conventions (Conventional Commits P-013, P-004), the required checks per PR (typecheck P-258, lint P-258, unit P-253, coverage P-259, E2E P-255/256 — all gated by CI P-257), how to run docs checks, how to add a phase/feature (issue → plan → implement → test), code-review expectations (P-041 ownership), and the security reporting path (P-265).

**Files to Create/Modify:**
- `CONTRIBUTING.md` (new)

**Implementation Steps:**
1. Sections: setup (Prereqs P-065/P-041, `bun install`, running tests), the dev loop (edit → typecheck → lint → test → CI), branch/commit conventions (Conventional Commits P-013, no `it.only` P-253, no secrets P-206/P-265), PR checklist (gates pass, snapshot update P-260, changelog P-263, docs update), reviewer guide (P-041 owner signs off their package; Security-sensitive: sandbox P-168, license P-127, path-safety P-205), adding a new feature (spec issue P-004 → design doc → phases → implement), testing expectations (fixtures P-254, property tests P-261, flake P-267), and the code of-conduct/SECURITY (P-265) links.
2. Make it copy-paste-actionable: exact commands (not prose), a minimal `Makefile`/`bun run` script reference.
3. CI/gha gates must match what's documented (the PR checklist == CI P-257 jobs) — a `contrib.guard.test.ts` asserts the workflow defines the listed checks.
4. Keep the "releasing" section pointing to P-263 (not duplicating).
5. `contrib.guard.test.ts`: asserts CONTRIBUTING exists + references the required gates + matches CI names; assert no "TODO later" placeholders (P-258 lint).
6. Test: guard passes.

**Required MCPs/Connectors:** None (GitHub PRs implied).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Setup, dev-loop, branch/commit, PR-checklist, reviewer, feature-add, test-edits, security sections present + actionable
- [ ] Commands correct (used in README/quickstart P-268/269 consistency)
- [ ] PR checklist == CI gates (guard test enforces)
- [ ] Points to release (P-263) rather than duplicating
- [ ] No placeholder/TODO filler (lint)
- [ ] Tests pass

**Tests Required:** `contrib.guard.test.ts`:
- `it('references gates')`, `it('matches ci jobs')`, `it('no placeholders')`

**Dependencies:** P-270. Gates P-258–P-259/253/255/256, CI P-257, commits P-013.

**Handoff Notes:** Next: P-272 Core API docs. CONTRIBUTING is the contract for contributors — keep the PR checklist literally equal to CI so review and automation agree.

---




### P-272: Docs - Core API Docs

**Owner:** inbesat | **Depends On:** P-271

**Context:** Programmatic users need the core API. This phase writes `docs/api/core.md` documenting the stable public API surface of `@repo-stitcher/core`: the exported functions/classes (git P-065–P-076, deps P-104–P-117, licenses P-118–P-131, agent P-148–P-167, sandbox P-168–P-180, provenance P-181–P-188, pipeline/jobs P-238–P-247) with signatures, return types, and usage examples from real code. Generated in part from the type definitions so it stays in sync.

**Files to Create/Modify:**
- `docs/api/core.md` (new)
- `packages/core` typedoc baseline (new — optional `typedoc.json`)

**Implementation Steps:**
1. Define the "public boundary": ground types + entrypoint exports are those marked `@public` / not `@internal`; everything else is consigned to the documented "internal" section.
2. Use a doc generator (TypeDoc) over `packages/core/src/index.ts` to produce signatures + TS examples; commit `docs/api/core.md` as the curated reference (tags `@example` with tested snippets).
3. Hand-write the prose/overview + the idiomatic usage patterns (merge pipeline P-238, license verdict P-128, provenance builder P-181) and a migration/caveats section (breaking changes coordinate with semver P-263).
4. Type-surface check: `api.extract.test.ts` (CI P-257) asserts that the set of documented exports matches the actual public `@public` exports (so docs can't silently omit a new API).
5. Cross-link individual epics' docs and ARCHITECTURE (P-270); keep the version-stamped `as-of vX` header syncing with release (P-263).
6. Test: TypeDoc generates without errors; api.extract matches.

**Required MCPs/Connectors:** None (local TypeDoc).

**Skills to Invoke:** document-generate skill — optional.

**Acceptance Criteria:**
- [ ] All `@public` core exports documented with signatures + tested examples
- [ ] Internal surface marked/consigned; overview + caveats sections
- [ ] TypeDoc generate clean; `api.extract` test enforces doc coverage
- [ ] Idiomatic usage examples from real code
- [ ] Version-stamped, synced with releases
- [ ] Tests/lint pass

**Tests Required:** `api.extract.test.ts` (documented exports == public exports) + TypeDoc clean.

**Dependencies:** P-271. Core modules P-041+ (all epic entries), TypeDoc.

**Handoff Notes:** Next: P-273 CLI ref. The core API doc's "stable boundary" is what external users rely on; keep `@public` markers deliberate — adding public surface is a semver-minor (P-013/P-263) event.

---




### P-273: Docs - CLI Ref

**Owner:** aradhy | **Depends On:** P-272

**Context:** Every command documented. This phase writes `docs/api/cli.md`: the full reference for every `stitch` subcommand (P-189–P-207) — synopsis, global options (P-189), per-command options/flags (P-204), arguments, examples, exit codes (P-203), and related commands. Generated from the Commander definitions (P-189) so it matches the `--help` exactly, plus hand-written prose where needed.

**Files to Create/Modify:**
- `docs/api/cli.md` (new)
- `packages/cli/scripts/docs.ts` (new — extract options from Commander prog)

**Implementation Steps:**
1. `docs.ts`: introspect the Commander program (P-189) — recursively walk commands + options (name/alias/description/default/required) and emit a markdown table per command (statement of truth from the code).
2. `cli.md`: front-matter (version, scope) + the global-options section (P-189) + one section per subcommand: `init` (P-190), `add` (P-191), `merge` (P-192), `serve` (P-193), `status` (P-194), `doctor` (P-195), `license` (P-196), `deps` (P-197), `audit` (P-207), (progress/theme P-198–P-206 as flags), each with a synopsis, options/table, 1-2 runnable examples, exit codes, and "see also" links.
3. Enrich generated tables with manual notes (behaviors P-203 edge cases, `--yes` semantics, offline P-146).
4. Consistency test: `cli.docs.test.ts` (CI P-257) runs `docs.ts` and diffs against `cli.md` — fails if they diverge (same generator-authority as P-252).
5. `--help` matching: assert the doc's option set equals `prog.outputHelp` lines (single source).
6. Test: doc matches generated truth; every subcommand present.

**Required MCPs/Connectors:** None (introspection).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Every `stitch` subcommand documented (synopsis, options, examples, exit codes)
- [ ] Options/args extracted from Commander (P-189) — code as authority
- [ ] `--help` matches doc; `cli.docs.test` diffs green
- [ ] Examples runnable (P-255 checked)
- [ ] Global options + `--json`/exit codes documented (P-203/194/247)
- [ ] Version front-matter synced

**Tests Required:** `cli.docs.test.ts` (docs == introspected Commander; all subcommands present).

**Dependencies:** P-272. CLI P-189–P-207, exit codes P-203.

**Handoff Notes:** Next: P-274 Web docs. Derive CLI docs from the Commander tree so they never drift from `--help`; hand-written prose only adds behavior nuance, not the flag list.

---




### P-274: Docs - Web Docs

**Owner:** aradhy | **Depends On:** P-273

**Context:** Users understand the browser UI. This phase writes `docs/web.md`: how the web app works (P-208–P-237), how to run it (dev P-208, built/served P-235, `stitch serve` P-193), the screen-by-screen flow (Sources → Select → Merge/Thinking → Review → Results/History — P-211–P-224), the HIL gates (P-218/license P-220), session export/import (P-230), settings (P-225), dark mode (P-226), and a11y (P-231). Includes annotated UI walkthroughs tied to the real built app.

**Files to Create/Modify:**
- `docs/web.md` (new)
- `docs/web-screens/` (new — screenshots from the built app)

**Implementation Steps:**
1. Overview: what the web adds over the CLI; architecture note (served by `serve` P-193, WS P-223, contract P-252).
2. Running: dev mode (vite P-208), production (`stitch serve` P-193), Docker runtime image (P-264); the `--host`/port/cors options (P-193).
3. Screen-by-screen: for each — serve purpose, key controls, and how it maps to a core action: Sources (P-211/212), Select files (P-213/214), Run Merge + AI thinking (P-216), Review diff (P-217), Approve/Reject (P-218), Deps (P-219), License (P-220), Sandbox (P-221), CREDITS (P-222), History (P-224), Settings (P-225), Session (P-230).
4. Screenshots: capture from the real built app (P-208) at each screen; scripted (Playwright P-233/256) so they stay current; a `web.screens.test` regenerates + diffs.
5. Responsibilities: which gates can't be bypassed in UI (blocking P-218/P-220), the dark-mode/a11y guarantees (P-226/P-231).
6. Test: script regenerates screens; doc references files that exist (P-257 doc lint).

**Required MCPs/Connectors:** None (local built app for screenshots).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] How-to-run (dev/built/serve), architecture note
- [ ] Screen-by-screen covering P-211–P-230 with real controls
- [ ] Gates-can't-bypass + dark/a11y guarantees documented
- [ ] Screenshots scripted (Playwright), regenerated + diffed, current
- [ ] Doc lint (links/files) passes
- [ ] Matches shipped UI (P-237)

**Tests Required:** CI: `web.screens` regenerates + diffs; doc file/link lint.

**Dependencies:** P-273. Web P-208–P-237, serve P-193.

**Handoff Notes:** Next: P-275 Config ref. Keep web screenshots scripted (playwright) so the doc image set can't silently drift from the UI; reference the real `data-testid`s (P-233).

---




### P-275: Docs - Config Ref

**Owner:** aradhy + inbesat | **Depends On:** P-274

**Context:** Every knob documented. This phase writes `docs/config.md`: the complete reference for the `stitch.toml` config (P-200/P-243) — every field, its type, default, and section (`[ai]`, `[sandbox]`, `[licenses]`, `[agent]`, `[perf]`, `[web]`, `[progress]`, `[trace]`) — generated from the zod schema (P-009) so it can't drift, plus prose on precedence (P-243), env overrides (P-200), provider keys (P-276), and example configs.

**Files to Create/Modify:**
- `docs/config.md` (new)
- `packages/core/scripts/config-docs.ts` (new — emit markdown from zod schema)

**Implementation Steps:**
1. `config-docs.ts`: walk the zod `AppConfig`/`JobConfig` schemas (P-009/P-243) — for each field emit name, type (TS), zod default, description (from `.describe()`), env-var mapping, and section grouping — producing a markdown table per section.
2. `config.md`: front-matter (version) + sections:
   - How configs are located/merged (P-200 discovery, P-243 precedence) + env overrides (`STITCH_*` + provider keys P-200/P-276).
   - Field reference per section (generated) with the `[ai]` (P-134/143), `[sandbox]` (P-176/204), `[licenses]` (P-127), `[agent]` (P-157/146), `[perf]` (P-204), `[web]` (P-226/209/229), `[progress]` (P-242), `[trace]` (P-248) fields.
   - TOML syntax notes + 2-3 runnable example configs (minimal/production/docker P-264) validated by `config.spec` (P-200 parse).
3. Consistency test: `config.docs.test.ts` (CI P-257) diffs generated output vs the committed `config.md` (schema is the authority, P-252 parity).
4. Version-stamped; invalid example prevented (test parses them, P-200).
5. Test: schema↔doc diff green, examples parse+validate.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Every config field documented (type/default/description/env) generated from zod
- [ ] Precedence/discovery + env overrides explained (P-200/243)
- [ ] Section reference complete (ai/sandbox/licenses/agent/perf/web/progress/trace)
- [ ] Example configs validated (parse+validate, P-200)
- [ ] Schema↔doc diff green (CI)
- [ ] Version-stamped

**Tests Required:** `config.docs.test.ts` (diff + example parse).

**Dependencies:** P-274. Config schema P-009/P-243, precedence P-243.

**Handoff Notes:** Next: P-276 Provider setup guide. Derive the config reference from the zod schema so it stays authoritative; examples are tested, so they always load.

---




### P-276: Docs - Provider Setup Guide

**Owner:** inbesat | **Depends On:** P-275

**Context:** Get AI working. This phase writes `docs/providers.md`: how to configure each AI provider (P-134 — OpenRouter primary, Anthropic, Ollama local) — getting the API key (P-190 prompt / env P-200), the model registry (P-135), streaming/token budget (P-143/P-146), offline (P-146), fallback (P-140), and cost notes (P-143/P-247). Includes troubleshooting (keys missing → `doctor` P-195, quota → error P-139/P-203, streaming off). It's the on-ramp to the AI features.

**Files to Create/Modify:**
- `docs/providers.md` (new)
- `docs/providers/` screenshots (optional)

**Implementation Steps:**
1. Per provider:
   - **OpenRouter** (primary P-134): sign up, get key, set `OPENROUTER_API_KEY` or `stitch init` prompt (P-190), config `[ai]` block; model list (P-135) + the Gemini-3 block note (P-144); streaming (P-142) + budget (P-143).
   - **Anthropic** (P-133): key setup, model (via P-139 registry), streaming.
   - **Ollama** (local, P-140/P-146-shared): install/run `ollama serve`, model pull, base URL + streaming.
2. Key management: env precedence (P-200), never committing keys (P-206/P-265), masked status in settings (P-225/`doctor` P-195).
3. Fallback/`switch-provider` (P-147/P-140): how to set the active provider + automatic fallback on failure (P-140) + cost/token behavior (P-143/P-247).
4. Offline mode (P-146): what works without network (deps, license, provenance; no AI generation).
5. Troubleshooting table: error codes (P-203 AI 40), quota/rate-limit, missing model, streaming disabled, local Ollama not running.
6. Test: a `provider.docs.spec` runs `doctor` (P-195) against fixture envs and asserts the config shown matches the doc examples (P-200/Toml parse).

**Required MCPs/Connectors:** None (docs; examples are config-parse-level).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Each provider covered (OpenRouter/Anthropic/Ollama): key, model registry, streaming, budget
- [ ] Key management (env precedence, no-commit, masked status) documented
- [ ] Fallback/switch (P-147/140) + cost notes
- [ ] Offline behavior (P-146) documented
- [ ] Troubleshooting error-code table (P-203 AI 40 / quota / ollama)
- [ ] Doc examples parse (P-200); tests pass

**Tests Required:** `provider.docs` CI check (examples parse + `doctor --config-json` matches).

**Dependencies:** P-275. Providers P-133/134/135/140/142/143/144/146/147, doctor P-195.

**Handoff Notes:** Next: P-277 License guide (finishes the Docs epic start). Providers is the AI on-ramp — keep key-handling guidance strict (never commit) and aligned with `doctor` output (P-195) so the doc shows the real current state.

---




### P-277: Docs - License Guide

**Owner:** inbesat | **Depends On:** P-276

**Context:** Compliance made clear. This phase writes `docs/licenses.md`: how license handling works end-to-end (scan P-118/P-131, SPDX normalize P-119, matrix verdict P-120, GPL warning P-121, dual P-122, unknown P-123, per-file P-124, generate LICENSE P-125, NOTICE P-126, policy P-127, CLI P-196, web P-220) — with the decision flow, the allow/deny policy config (P-127), how to resolve unknowns, what blocks a merge (hard deny P-120), and the SBOM/CREDITS outputs (P-182/183). Written in non-lawyer language with concrete "what to do" steps.

**Files to Create/Modify:**
- `docs/licenses.md` (new)

**Implementation Steps:**
1. The model: what "verdict" means (P-118 registry → P-119 SPDX → P-120 matrix), the three roles (declared/normalized/licensed).
2. Decision flow: pass → proceed; warn (GPL P-121, dual P-122) → review; unknown (P-123) → decide (allow/deny/skip via CLI P-196 or web P-220); hard-deny (P-120 matrix) → blocks merge.
3. Policy: the `[licenses]` allow/deny/lists (P-127) + overrides (P-124 diff/P-196 decisions) + how to add a custom policy; per-file headers (P-124, optional ScanCode P-131).
4. Outputs: generated LICENSE (P-125), NOTICE/attribution (P-126), SBOM licenseConcluded (P-183), CREDITS (P-182) — where they land in C and how to review them.
5. Common scenarios: upstream GPL app + MIT lib, dual-license lib, missing license metadata, vendored files (P-124) — each with a short "in 3 steps" resolution.
6. Disclaimer note (not legal advice) + point to `stitch license --json` (P-196/P-128) for the machine-readable truth.
7. Test: license guide examples are consistent with a real `LicenseReportData` fixture (P-254/P-128) — a `license.docs.spec` asserts the described verdicts match the code on the fixture.

**Required MCPs/Connectors:** None (fixture-driven).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Verdict model + decision flow (pass/warn/unknown/hard-deny) clear
- [ ] Policy config (P-127) + overrides + per-file (P-124) documented
- [ ] Outputs (LICENSE/NOTICE/SBOM/CREDITS) + where they land
- [ ] Common scenarios with 3-step resolutions
- [ ] Non-lawyer tone + disclaimer + `--json` pointer
- [ ] Doc examples match real fixture verdicts (CI)

**Tests Required:** `license.docs` CI (described verdicts == code verdicts on fixture P-254).

**Dependencies:** P-276. License epic P-118–P-131, policy P-127, outputs P-125/126/182/183.

**Handoff Notes:** Next: P-278 Publish Core (release + installer open the next batch). The license guide is the compliance voice — keep verdict statements backed by the real matrix (P-120) and verify the described outcomes against a fixture so docs never over-promise.

---




### P-278: Docs - Publish Core

**Owner:** inbesat | **Depends On:** P-277

**Context:** `@repo-stitcher/core` becomes a real npm package. This phase formalizes publishing the core package: package.json metadata (module/`exports` map, `types`/typesVersions, engines marked Bun ≥, provenance field), a prepublish build (`tsc`/bun build → dist), a **publish dry-run** that checks the tarball contents + size and runs a smoke import, and the actual `npm publish` via CI (P-263), with a supply-chain attestation (P-265) and an SBOM bundled.

**Files to Create/Modify:**
- `packages/core/package.json` (modify — publish metadata)
- `packages/core/tsconfig.build.json` + build script (new)
- `packages/core/src/index.ts` (finalize stable public exports, P-272 `@public`)
- `scripts/publish/core.ts` (new — dry-run + smoke)
- `publish.core.test.ts` (new)

**Implementation Steps:**
1. `package.json`: `"name": "@repo-stitcher/core"`, `"version"` (P-263-inc), `"type": "module"`, `"main": "./dist/index.js"`, `"module"`, `"types": "./dist/index.d.ts"`, `"exports"` map with `import`/`types`; `"engines": { "bun": ">=1.1", "node": ">=20" }`; `"files": ["dist", "sbom.json", "LICENSE", "NOTICE", "README"]`; `"publishConfig": { "provenance": true }`.
2. Build: `tsconfig.build.json` (emit only, exclude tests/fixtures P-254) → `bun run build` compiles `src` → `dist` (JS + `.d.ts`), plus bundling an `sbom.json` (P-183) and checksums (P-186) into the package.
3. `publish/core.ts`:
   - `--dry-run`: `npm pack --dry-run`-style — enumerate `files`, assert no `src` leaks, no secrets (P-206), size < budget, then run a **smoke**: install the packed tarball into a temp project and `import { ... }` a couple of public symbols (P-272) to prove it loads.
   - `--publish`: `npm publish` (auth via CI secrets), runs after CI gates (P-263/P-265), tags the SBOM + attestation.
4. Version gate: refuse publish if `package.json` version == last published (P-263 bump required); refuse if `index.ts` public exports changed without bump (P-272 api.extract).
5. `publish.core.test.ts`: dry-run on a synthetic build asserts the file set, smoke import success, size budget, and the export-vs-version gate.
6. Document the publish in CONTRIBUTING (P-271 release reference → P-263) + ARCHITECTURE (P-270 package ownership).

**Required MCPs/Connectors:** npm registry (publish); tarball import smoke local.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Package metadata complete (exports/types/engines/provenance), build → dist
- [ ] SBOM + checksums bundled in the package
- [ ] Dry-run: correct file set, no src/secrets leak, size budget, smoke-import passes
- [ ] Publish gated on CI + version-bump + export-change gate (P-272)
- [ ] Supply-chain attestation (P-265) + audit record (P-187)
- [ ] Tests pass

**Tests Required:** `publish.core.test.ts`:
- `it('file set')`, `it('no leak')`, `it('smoke import')`, `it('version gate')`, `it('size budget')`

**Dependencies:** P-277. Release P-263, public API P-272, SBOM P-183.

**Handoff Notes:** Next: P-279 Installer/Homebrew. The publish path is the durable supply of the core lib — dry-run before every real publish and never auto-publish without the P-272 API-gate.

---




### P-279: Docs - Installer/Homebrew

**Owner:** aradhy | **Depends On:** P-278

**Context:** Easy installs for the CLI. This phase provides an installer + packaging: a cross-platform `install` script (curl | sh / PowerShell) that fetches the release binary (P-263) and validates the checksum + signature (P-186/P-263/P-265); a Homebrew formula for macOS/Linux (binary tap) `brew install repo-stitcher`; and (optional) a `winget`/`choco` manifest for Windows. Each path pins a version and verifies integrity.

**Files to Create/Modify:**
- `scripts/install/install.sh`, `scripts/install/install.ps1` (new)
- `homebrew/repo-stitcher.rb` (new — formula/tap)
- `winget/repo-stitcher.yaml` (optional)
- `install.verify.test.ts` (new)

**Implementation Steps:**
1. `install.sh` (POSIX) + `install.ps1` (PowerShell):
   - Detect OS/arch → select the release asset URL (P-263 built binaries) for the matching platform.
   - Download to temp, fetch the checksums (P-186) + signature (P-263 `gh attest`/minisign), verify, extract to `~/.stitch/bin` (or `$LOCALAPPDATA`), add a PATH hint, and print verification result.
   - Idempotent; `--version` to pin an exact release; fail loudly on checksum mismatch.
2. Homebrew formula: `repo-stitcher.rb` — `desc`, `version`, `url` to the release tarball (P-263 asset), `sha256` (P-186), `bottle`? or `brew install repo-stitcher/tap/repo-stitcher`; `depends_on :bun` optional note when run via bun instead of the binary.
3. Integrity-first: install script refuses on checksum/signature mismatch (never `curl | sh` blind — verify before executing).
4. `install.verify.test.ts`: runs the parse/checksum logic on a synthetic release layout (fake sha256/signature) across the supported OS/arch matrix; asserts correct asset selection + mismatch refusal + version pinning.
5. Docs: link from README (P-268) install section + QUICKSTART (P-269); a `/releases/latest`-style check keeps the formula version current (P-263 releases update it).
6. Test the install dry paths (offline verification of checksum logic) — do not download live in the suite.

**Required MCPs/Connectors:** GitHub releases (asset fetch at user install-time); none in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `install.sh` + `install.ps1`: OS/arch detect, download, checksum+signature verify before run, PATH hint, idempotent, version-pin
- [ ] Homebrew formula (binary, sha256-pinned); optional winget manifest
- [ ] Refuses on checksum/signature mismatch
- [ ] `install.verify.test.ts` covers OS/arch matrix + mismatch + pin
- [ ] Linked from README/QUICKSTART; formula version kept current at release (P-263)
- [ ] Tests pass

**Tests Required:** `install.verify.test.ts`:
- `it('selects asset by os arch')`, `it('mismatch refuses')`, `it('version pin')`, `it('path hint')`

**Dependencies:** P-278. Release P-263, checksums P-186.

**Handoff Notes:** Next: P-280 Docker Publish. Fail-safe installs are the trust door for users — always verify before executing downloaded binaries and pin exact versions.

---




### P-280: Docs - Docker Publish

**Owner:** inbesat | **Depends On:** P-279

**Context:** Ship the container image. This phase formalizes publishing the OCI image (P-264 runtime image) to a registry: tags (`latest`, `vX.Y.Z`, commit-sha), multi-arch (amd64/arm64) via buildx, SBOM (P-183) + attestation attached (P-265/263), a signed digest, and a `docker pull` smoke test. It documents the image in README (P-268) + web docs (P-274) and feeds the release (P-263).

**Files to Create/Modify:**
- `scripts/publish/docker.ts` (new)
- `.github/workflows/docker-publish.yml` (new — or fold into P-263 release)
- `docs/containers.md` (new — usage/registry/tags)
- `docker.publish.test.ts` (new)

**Implementation Steps:**
1. `docker.ts`:
   - `--dry-run`: resolve the target tags (`latest`, `v<ver>` from P-263, `<sha>`), compute the multi-arch matrix, print the push plan (matching P-264 buildx platforms), and run a local `docker build --platform ... --load` smoke on one arch + `docker run image /health` (P-193) to prove it boots.
   - `--publish`: `docker buildx build --push --platform linux/amd64,linux/arm64 --tag repo-stitcher:latest --tag repo-stitcher:v<ver> ...`; attach SBOM (P-183) + `cosign`/`gh attest` signature; print the signed digest.
2. Tag hygiene: `latest` always points to the newest release; `v<ver>` immutable; `<sha>` for debug. Never push un-gated builds (CI P-263 guard, no secrets in image P-206).
3. Registry: default Docker Hub `repo-stitcher/repo-stitcher`; configurable `--registry` for self-hosted (mirrors P-281 policy).
4. Smoke: post-publish CI pulls the tagged image and asserts `/health` returns 200 + SBOM present (P-265).
5. `docs/containers.md`: registry, tags, `docker run` (volume for config/cache, port for serve P-193), compose sample (P-264), and the build/publish authorizing.
6. `docker.publish.test.ts`: unit-test tag resolution + matrix + dry-run plan without a real registry (mock docker CLI output).

**Required MCPs/Connectors:** Docker registry (push); buildx.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Tag scheme (latest/vX/sha) + multi-arch matrix resolved; dry-run plan + local smoke boots `/health`
- [ ] Push builds amd64+arm64 with SBOM + signed digest
- [ ] `latest` tracks newest release; CI-gated; no secrets in image
- [ ] Post-push smoke pull + `/health` 200 + SBOM (P-265)
- [ ] `docs/containers.md` accurate (run/compose/registry)
- [ ] Tests pass (mock docker)

**Tests Required:** `docker.publish.test.ts`:
- `it('resolves tags')`, `it('matrix')`, `it('dry run plan')`, `it('smoke plan')`

**Dependencies:** P-279. Docker image P-264, release P-263, SBOM P-183.

**Handoff Notes:** Next: P-281 Versioning Policy. Docker publishing is the runtime delivery — keep tags policy-driven (P-281) and always signed/SBOM'd so the image is auditable (P-265).

---




### P-281: Docs - Versioning Policy

**Owner:** inbesat | **Depends On:** P-280

**Context:** Predictable releases. This phase writes `docs/versioning.md`: the versioning policy — SemVer (P-013) for the public `@repo-stitcher/core` API (P-272) with explicit breaking-change rules, independent versioning for core vs CLI vs web (P-041 ownership) vs the config schema (P-009/P-243), the contract (P-252) compatibility rules, deprecation policy (deprecate → warn → remove windows), and the release cadence. It gives the maintainers a shared, documented decision rule for every bump.

**Files to Create/Modify:**
- `docs/versioning.md` (new)
- `versioning.spec.test.ts` (new)

**Implementation Steps:**
1. Scope the units that version independently: `@repo-stitcher/core` (API P-272), `stitch` CLI (its own semver, releases P-263), `web` (aligned with CLI serve), the **config schema** (a `schemaVersion` with migration path P-200/P-243), and the **WS/HTTP contract** (P-252, a separate `apiVersion`).
2. Rules:
   - **Core public API (P-272 `@public`)**: any breaking change → new **major**; require the P-272 api.extract diff + a documented migration; deprecation: mark `@deprecated` in two minors' warning window before removal (P-281 policy).
   - **Config schema**: additive changes → patch/minor; removing/renaming a field → major + a migration shim (P-200 load old + warn).
   - **Contract (P-252)**: additive endpoints OK in minor; removing/renaming endpoint or changing a response shape → breaking bump + versioned endpoint (e.g. `/api/v2`) with overlap window.
   - **CLI**: command/flag removal is semver-major; additive flags minor.
3. Cadence + channels: `latest` stable, `beta`/`rc` pre-release tags, nightly builds (P-257) never tagged latest.
4. Backport/LTS note (if any): fixed-version windows for critical security (P-265).
5. Compatibility matrix: which config/API/contract versions work with which CLI/core (a table maintained at each release P-263).
6. `versioning.spec.test.ts`: asserts the doc rules are consistent with the versions in the repo (e.g. apiVersion bumps when a breaking contract change is flagged); a release (P-263) checks the doc's compatibility matrix is updated.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Versioning scopes + semver rules documented for core/CLI/web/config/contract
- [ ] Deprecation policy (mark→warn window→remove) explicit
- [ ] Contract/config breaking-change rules + `/api/v2`/migration paths
- [ ] Cadence + channels (latest/beta/rc/nightly) defined
- [ ] Compatibility matrix maintained at release (CI check)
- [ ] `versioning.spec` assertions pass

**Tests Required:** `versioning.spec.test.ts` (doc rules ↔ repo version consistency).

**Dependencies:** P-280. Semver P-013, contract P-252, public API P-272.

**Handoff Notes:** Next: P-282 Changelog Automation. Versioning is the shared decision rule — document it early so bump debates resolve by policy, and keep the matrix machine-checked at release.

---




### P-282: Docs - Changelog Automation

**Owner:** inbesat | **Depends On:** P-281

**Context:** Changelogs write themselves. This phase automates `CHANGELOG.md` generation from Conventional Commits (P-013/P-004) at release (P-263): parse merged PRs/commits, group by type (Added/Changed/Fixed/Deprecated/Security/US/deps), resolve scopes (core/cli/web/deps/sandbox), link to issues/PRs, highlight breaking changes (P-281), and auto-create the per-release section with the version + date. It replaces hand-editing and keeps history accurate.

**Files to Create/Modify:**
- `scripts/release/changelog.ts` (new — generator)
- `CHANGELOG.md` (modify — replaced by generated output)
- `Changelog templates` (new — grouped sections)
- `changelog.test.ts` (new)

**Implementation Steps:**
1. `changelog.ts`:
   - Read commit log since the last tag (P-013/Conventional) — parse `type(scope): subject`, body for `BREAKING`/`Refs`/`Co-authored`.
   - Group: `Added` (feat), `Changed`, `Fixed` (fix), `Deprecated` (`BREAKING`+`!`), `Removed`, `Security`, `Deps` (deps scope P-013), `docs/tests/ci` → a curated `Internal`/`Maintenance` collapsed section (or excluded with a `#skip`).
   - Emit per-release: `## [vX.Y.Z] - YYYY-MM-DD` with bullets `- <subject> ([#123](...))` + a `### Breaking` callout from `BREAKING` (P-281).
   - Deterministic ordering (semantic type then commit date); a `--dry-run` prints the next section for review (P-244-spirit).
2. Wire into `release.yml` (P-263): generate the section, append/prepend to `CHANGELOG.md`, commit it with the bump, and include it in the GitHub Release body (P-263).
3. `changelog.test.ts`: with a synthetic git log, assert grouping, scope mapping, breaking detection, PR-linking, and deterministic output; `--dry-run` correctness.
4. Guard: a lint (P-258) enforces Conventional Commit format on PR titles so the generator is reliable; a `changelog.sync` check fails CI if the top unreleased section is stale relative to commits (P-257).
5. Note the P-282 policy: humans review the generated `Breaking`/`Security` sections; automation drafts, maintainers approve.

**Required MCPs/Connectors:** None (git log local).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Generator parses Conventional Commits, groups by type/scope, links PRs, flags breaking (P-281)
- [ ] Per-release section with version + date; deterministic output
- [ ] Wired into release (P-263): generates, commits, uses in Release body; `--dry-run`
- [ ] PR-title lint enforces Conventional format; stale-changelog CI check
- [ ] Humans approve Breaking/Security; docs/Maintenance collapsed
- [ ] Tests pass

**Tests Required:** `changelog.test.ts`:
- `it('groups by type')`, `it('detects breaking')`, `it('links prs')`, `it('deterministic')`, `it('dry run')`

**Dependencies:** P-281. Conventional Commits P-013/P-004, release P-263.

**Handoff Notes:** Next: P-283 begins the Advanced epic (Plugin System). Changelog automation keeps release (P-263) honest; the PR-title lint is the input guarantee — enforce it so the generator stays accurate.

---




### P-283: Advanced - Plugin System

**Owner:** inbesat | **Depends On:** P-282 (docs epic end); core plugin contract

**Context:** Extensible beyond built-ins. This phase designs and implements a plugin system for repo-stitcher: a plugin contract exposing hooks into the pipeline (ecosystem detection/merge P-112, sandbox provisioning/verify P-168/177, AI tool registration P-148–P-157, formatter/lint adapters, provenance/sbom providers P-181–P-183), a plugin registry (config `plugins = [...]`, P-200), lifecycle (load → validate → run), and a dev experience (plugd sandbox + docs). It's the mechanism behind ecosystem plugins (P-284–P-292) and third-party integrations.

**Files to Create/Modify:**
- `packages/core/src/plugins/contract.ts` (new — hook interfaces)
- `packages/core/src/plugins/registry.ts` (new — load/validate/manage)
- `packages/core/src/plugins/manager.ts` (new — lifecycle orchestration in pipeline P-238)
- `packages/core/src/plugins/__tests__/plugins.test.ts` (new)

**Implementation Steps:**
1. `contract.ts`: define `StitchPlugin` interface with versioned hooks:
   - `detect(ctx): Ecosystem|undefined` (P-112 ecosystem).
   - `mergeDeps(ctx, manifests)`: hook to extend P-108–P-117 for a custom ecosystem.
   - `sandbox { provisionImage(ctx) , verify(ctx) }`: hook into P-168–P-177 image/verify.
   - `agentTools(): AgentToolDef[]`: register new agent tools into P-148–P-157 loop.
   - `provenanceProviders()`: extend P-181–P-183 (custom sbom/attribution).
   - `lifecycle { onStage(ctx), onError(err) }`.
   - Each hook has a version + capability tag; plugins declare a `name`, `version`, `hooks`, and a manifest (P-009 schema).
2. `registry.ts`: load from `[plugins]` config entries (paths or npm packages, P-200); resolve, import (Bun), `validate` against the contract (reject version-mismatch/unknown capabilities with a typed error P-163); expose `getPlugin(name)`, `list()`.
3. `manager.ts`: at pipeline build (P-238), gather enabled plugins, sort by declared priority/dependencies (a plugin may `dependsOn` another), and wire their hooks into the stages/resolver/tool-loop/sandbox; emit `plugin.registered` events (P-241) + trace (P-248).
4. Sandbox-free dev: plugins are constrained to a sandboxed context for third-party (limited fs/network, P-205 path-safety); built-in plugins run trusted.
5. `plugins.test.ts`: load+validate (good/bad/version-mismatch), priority ordering + dependency, hook wiring into a stub pipeline (P-238 stub), error isolation (one plugin failing doesn't kill the pipeline, P-163/P-228), registry queries.
6. Docs hook in ARCHITECTURE (P-270) + a `docs/plugins.md` how-to (P-283-contract) linking the P-284+ examples.

**Required MCPs/Connectors:** None (plugin load via Bun import; third-party in sandbox).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Versioned plugin contract (ecosystem/sandbox/agent/provenance/lifecycle hooks)
- [ ] Registry: config-load, import, validate (typed errors), query
- [ ] Manager: priority/dependency sort, hook wiring into pipeline stages/tool-loop/sandbox, events+trace
- [ ] Third-party plugins sandboxed (P-205); error isolation (one failure ≠ pipeline fail)
- [ ] `plugins.test.ts` passes
- [ ] ARCHITECTURE + `docs/plugins.md` document it

**Tests Required:** `plugins.test.ts`:
- `it('loads and validates')`, `it('version mismatch')`, `it('priority deps')`, `it('wires hooks')`, `it('isolates errors')`

**Dependencies:** P-282 (docs epic end). Pipeline P-238, ecosystem P-112, sandbox P-168, agent tools P-148, provenance P-181.

**Handoff Notes:** Next: P-284 Go ecosystem plugin. The plugin contract is the extension spine — version it carefully (P-281) and keep third-party execution sandboxed. Built-ins are the reference implementations for P-284–P-292.

---




### P-284: Advanced - Plugin: Go Ecosystem

**Owner:** aradhy | **Depends On:** P-283

**Context:** Stitch Go projects. This phase implements the Go ecosystem plugin (as a reference P-283 plugin + built-in): detect `go.mod` (P-112), parse dependency graph (P-104/109), handle `go.sum`/lockfile (P-114), resolve version conflicts via go semantics (P-111), license-scan+SPDX the Go modules (P-119), and provision a Go sandbox image + verify build/test (`go build`/`go test`, P-177). Registers an agent tool to fix `go.mod` conflicts (P-151/153).

**Files to Create/Modify:**
- `packages/core/src/plugins/ecosystems/go/` (new)
  - `detect.go.ts`, `deps.go.ts`, `license.go.ts`, `sandbox.go.ts`, `agent.go.ts`
- `sandbox/images/go.Dockerfile` (new — pinned Go)
- `packages/core/src/plugins/__tests__/go.test.ts` (new)

**Implementation Steps:**
1. `detect.go.ts`: detect on a `go.mod` present; parse module path + `go` directive (P-112) to classify ecosystem `go`.
2. `deps.go.ts`: parse `go.mod` requires (module→version) into the UnifiedDeps graph (P-108); read `go.sum` as the lock (P-114) for resolution; implement go's MVS-style resolution (P-109/P-111) — pick the highest required major-version per module, surface `go.mod`-only conflicts for review.
3. `license.go.ts`: use the module's `go.mod`/`LICENSE` / the Go proxy metadata to derive declared licenses → SPDX normalize (P-119) → feed the verdict (P-120).
4. `sandbox.go.ts`: `provisionImage` uses `go.Dockerfile` (pinned `golang:1.2x`), installs module deps + runs `go build ./...` + `go test ./...` (P-170/177) with output captured (P-174); honors limits (P-176).
5. `agent.go.ts`: register a `fix_go_dep` agent tool (P-151/153 pattern) that proposes adjusting a `go.mod` require/version with reasoning.
6. `go.test.ts`: with a fixture `go.mod`/`go.sum` (P-254), assert detection, parse, MVS resolution, license verdict, and sandbox verify via a stubbed docker (P-180).

**Required MCPs/Connectors:** Optional Go proxy (network) for real verify; stub in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Detects `go.mod`; parses deps + `go.sum` lock (P-112/104/114)
- [ ] Go MVS-style resolution (P-109/111) with surfaced conflicts
- [ ] License derive→SPDX→verdict via Go metadata (P-119/120)
- [ ] Go sandbox image (pinned) provisions `go build`+`go test` (P-177) with capture + limits
- [ ] `fix_go_dep` agent tool registered (P-151/153)
- [ ] `go.test.ts` passes (fixture + stub sandbox P-180)

**Tests Required:** `go.test.ts`:
- `it('detects')`, `it('parses deps')`, `it('mvs resolves')`, `it('license verdict')`, `it('sandbox verify stub')`, `it('agent tool')`

**Dependencies:** P-283. Deps P-104–P-117, license P-118–P-131, sandbox P-168–P-180, tools P-151/153.

**Handoff Notes:** Next: P-285 Rust ecosystem plugin. The Go plugin is the reference template for the other ecosystems (P-285/286/287) — follow its detect→deps→license→sandbox→agent shape.

---




### P-285: Advanced - Plugin: Rust Ecosystem

**Owner:** aradhy | **Depends On:** P-284

**Context:** Stitch Rust projects. This phase implements the Rust ecosystem plugin: detect `Cargo.toml` (P-112), parse `[dependencies]`/`[dev-dependencies]` into the graph (P-104/109), use `Cargo.lock` as the lock (P-114) + resolve via cargo's resolver semantics (P-109/111), license-scan crates from `cargo metadata` (P-119), provision a Rust sandbox (`cargo build`/`cargo test`, P-177), and register a `fix_cargo_dep` agent tool (P-151/153). Mirror of P-284 for Rust.

**Files to Create/Modify:**
- `packages/core/src/plugins/ecosystems/rust/` (new — detect/deps/license/sandbox/agent)
- `sandbox/images/rust.Dockerfile` (new — pinned rust toolchain)
- `packages/core/src/plugins/__tests__/rust.test.ts` (new)

**Implementation Steps:**
1. `detect.rust.ts`: detect `Cargo.toml`; parse package metadata + edition (P-112).
2. `deps.rust.ts`: parse `Cargo.toml` dep entries (name, version req, features, optional/dev) → UnifiedDeps (P-108); `Cargo.lock` as the lock (P-114) with its package graph; resolve via cargo resolver (P-109/111) — handle features + optional deps surface.
3. `license.rust.ts`: from `cargo metadata` (package `license`/`license_file`) derive declared → SPDX (P-119) → verdict (P-120).
4. `sandbox.rust.ts`: `rust.Dockerfile` pinned (e.g. `rust:1-slim` + minimal), `cargo build`/`cargo test` (P-170/177), capture (P-174), limits (P-176).
5. `agent.rust.ts`: `fix_cargo_dep` tool (P-151/153) proposing a dep edit with rationale.
6. `rust.test.ts`: fixture `Cargo.toml`/`Cargo.lock` (P-254), assert detect/parse/resolve/license/sandbox-stub/agent.

**Required MCPs/Connectors:** Optional crates.io for real verify; stub in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Detects `Cargo.toml`; parses deps + `Cargo.lock` (P-112/104/114)
- [ ] Cargo-resolver semantics (P-109/111) incl. features/optional
- [ ] License via `cargo metadata`→SPDX→verdict (P-119/120)
- [ ] Rust sandbox image (pinned) `cargo build`+`cargo test` (P-177) capture+limits
- [ ] `fix_cargo_dep` agent tool (P-151/153)
- [ ] `rust.test.ts` passes

**Tests Required:** `rust.test.ts`:
- `it('detects')`, `it('parses deps')`, `it('resolves features')`, `it('license')`, `it('sandbox stub')`, `it('agent tool')`

**Dependencies:** P-284. Deps P-104–P-117, license P-118–P-131, sandbox P-168–P-180, tools P-151/153.

**Handoff Notes:** Next: P-286 Python ecosystem plugin. Keep the Rust plugin consistent with the Go reference (P-284) shape so the three ecosystems behave identically for users.

---




### P-286: Advanced - Plugin: Python Ecosystem

**Owner:** aradhy | **Depends On:** P-285

**Context:** Stitch Python projects. This phase implements the Python ecosystem plugin: detect `pyproject.toml`/`requirements.txt`/`setup.py` (P-112), parse dependencies into the graph (P-104/109), use `uv.lock`/`poetry.lock`/`pip freeze` as the lock (P-114) + resolve via uv/poetry semantics (P-109/111), license-scan packages (P-119), provision a Python sandbox (`python -m build`/`pytest`, P-177), and register a `fix_py_dep` agent tool (P-151/153). Mirror of P-284/285 for Python.

**Files to Create/Modify:**
- `packages/core/src/plugins/ecosystems/python/` (new — detect/deps/license/sandbox/agent)
- `sandbox/images/python.Dockerfile` (new — pinned uv+py)
- `packages/core/src/plugins/__tests__/python.test.ts` (new)

**Implementation Steps:**
1. `detect.python.ts`: detect `pyproject.toml` (preferred) or `requirements.txt`/`setup.py`; parse project metadata (P-112) — prefer `pyproject` `[project]`/`[tool.poetry]`.
2. `deps.python.ts`: parse the detected manifest into UnifiedDeps (P-108); recognize `uv.lock`/`poetry.lock` (P-114) as the lock for resolution; resolve compatible versions (P-109/111) — PEP 508 specifier handling, extras-surface.
3. `license.python.ts`: from package metadata/`PYPI`-derived declared → SPDX (P-119) → verdict (P-120).
4. `sandbox.python.ts`: `python.Dockerfile` pinned (uv + python 3.x), `uv sync/install` then `python -m build` + `pytest` (P-170/177), capture (P-174), limits (P-176).
5. `agent.python.ts`: `fix_py_dep` tool (P-151/153) proposing a dep edit + reason.
6. `python.test.ts`: fixture `pyproject.toml` + lock (P-254), assert detect/parse/resolve/license/sandbox-stub/agent.

**Required MCPs/Connectors:** Optional PYPI for real verify; stub in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Detects `pyproject`/`requirements`/`setup.py`; parses deps + lock (uv/poetry) (P-112/104/114)
- [ ] PEP-508 resolution (P-109/111), extras surfaced
- [ ] License via package metadata→SPDX→verdict (P-119/120)
- [ ] Python sandbox image (pinned uv) build+pytest (P-177) capture+limits
- [ ] `fix_py_dep` agent tool (P-151/153)
- [ ] `python.test.ts` passes

**Tests Required:** `python.test.ts`:
- `it('detects pyproject')`, `it('parses deps')`, `it('resolves pep508')`, `it('license')`, `it('sandbox stub')`, `it('agent tool')`

**Dependencies:** P-285. Deps P-104–P-117, license P-118–P-131, sandbox P-168–P-180, tools P-151/153.

**Handoff Notes:** Next: P-287 AI connector plugin (Advanced continues). The three languages round out the first-class ecosystems; each follows the shared plugin template so maintenance stays uniform.

---




### P-287: Advanced - Plugin: AI Connector

**Owner:** inbesat | **Depends On:** P-286

**Context:** Bring your own AI. This phase implements an AI-provider plugin connector (demonstrating the plugin system's provider-extension hook): a spec for third-party/self-hosted providers to implement via the plugin contract — a `ChatProvider` (P-133-interface-shaped) defined at the edge outside the built-in OpenRouter/Anthropic/Ollama (P-140). It includes a generic OpenAI-compatible adapter (P-133), streaming (P-142), retry/backoff (P-139), tool-calling (P-141), and local (Ollama-style P-140) support — all pluggable.

**Files to Create/Modify:**
- `packages/core/src/plugins/providers/ai-connector.ts` (new — contract + generic adapter)
- `packages/core/src/plugins/providers/example.connector.ts` (new — reference)
- `packages/core/src/plugins/__tests__/ai.connector.test.ts` (new)

**Implementation Steps:**
1. Extend the plugin contract (P-283) with an `aiProvider` capability: a plugin may export `chatProvider(cfg): ChatProvider` conforming to the P-133 interface (chat, stream P-142, tools P-141, costs P-143).
2. `ai-connector.ts`:
   - A generic **OpenAI-compatible** adapter (base URL + key) implementing ChatProvider via the OpenAI wire format — covers many self-hosted/gateway providers out of the box (P-133 parity).
   - Registration: `registry.registerProvider(name, factory)` so `[ai] provider = <name>` in config (P-134) resolves to the plugin, with fallback to built-ins (P-140).
   - Provider resolution at job config (P-243): `[ai] provider` may name a plugin provider; validate it exists (P-163 typed error if unknown).
3. Bundled `serve` docs/schema: the provider is surfaced in `doctor` (P-195) + config ref (P-275) as a first-class entry.
4. Example reference plugin (`example.connector.ts`) with a minimal local HTTP provider + mock for tests (P-146-style).
5. `ai.connector.test.ts`: register + resolve a custom provider, stream/tool/retry (P-139/141/142) against a fake server, fallback on failure (P-140), unknown-provider error, config (P-243) resolution.

**Required MCPs/Connectors:** Optional real provider for manual; fake server in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `aiProvider` plugin capability extends the P-283 contract
- [ ] OpenAI-compatible generic adapter (base URL+key) as ChatProvider (P-133)
- [ ] `[ai] provider` (P-134/P-243) resolves plugin providers; fallback (P-140); unknown → typed error
- [ ] Streaming/tools/retry/cost (P-139/141/142/143) work through the adapter
- [ ] Reference example connector + mock tests (P-146)
- [ ] `ai.connector.test.ts` passes; surfaced in doctor/config-ref

**Tests Required:** `ai.connector.test.ts`:
- `it('registers and resolves')`, `it('openai adapter')`, `it('streams')`, `it('fallback')`, `it('unknown errors')`, `it('config resolution')`

**Dependencies:** P-286. Providers P-133/134/139/140/141/142/143, contract P-283.

**Handoff Notes:** Next: continues the Advanced epic (P-288+). The AI connector makes third-party providers first-class; keep the ChatProvider interface exactly the P-133 shape so plugins and built-ins are interchangeable.

---




### P-288: Advanced - Template Library

**Owner:** aradhy | **Depends On:** P-287

**Context:** Reusable stitching recipes. This phase builds a template library: curated, versioned pipeline templates (e.g. "web app + API", "react lib + shared utils", "CLI tool composition", "monorepo foundation") that pre-configure selection rules, ecosystem handling, license policy, sandbox verify, and agent presets (P-289). Users start from a template via `stitch init --template <name>` / the web (P-225 settings) instead of from scratch.

**Files to Create/Modify:**
- `packages/core/src/templates/` (new — registry + loader)
- `templates/` (new — json/toml template definitions)
- `packages/core/src/templates/__tests__/templates.test.ts` (new)
- CLI `init --template` + docs

**Implementation Steps:**
1. Template schema (P-009): `{name, version, description, tags, settings: {selection?, ecosystems?, licensePolicies?, presets?, sandbox?, agent?}}` — a subset that overrides `JobConfig` (P-243) with sensible defaults per use-case.
2. `templates/` corpus: define 4-6 templates — each specifying preferred ecosystems (P-112), license allow/deny leans (P-127), sandbox verify mode (P-177), agent preset (P-289), and example `init` scaffold.
3. Loader/registry: `templates.ts` loads from the bundle (`templates/`), validates against the schema, `listTemplates(tag)`, `applyTemplate(name, baseCfg)` → merged JobConfig (P-243), version-gated (P-281: template changes bump version; old template still loadable with warning).
4. Wire: `stitch init --template <name>` (P-190 scaffold), web settings (P-225) presets, and `doctor`/status show the active template badge (P-194/195).
5. `templates.test.ts`: validate corpus, apply merges of overrides, version fallback for older template, list/tag filters, and that templates produce a valid JobConfig (P-243 parse).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Template schema (P-009) + 4-6 versioned templates in bundle
- [ ] Loader validates, lists/filters by tag, applies to JobConfig (P-243)
- [ ] `stitch init --template` + web settings presets
- [ ] Version-gated: old templates load with warning (P-281)
- [ ] Active template surfaced in status/doctor
- [ ] Tests pass

**Tests Required:** `templates.test.ts`:
- `it('validates corpus')`, `it('applies preset')`, `it('version fallback')`, `it('list tags')`, `it('valid jobconfig')`

**Dependencies:** P-287. JobConfig P-243, init P-190, settings P-225, presets P-289.

**Handoff Notes:** Next: P-289 smart presets. Templates are the opinionated suitors into the same JobConfig (P-243) — keep them thin overlays, not a parallel config system.

---




### P-289: Advanced - Smart Presets

**Owner:** inbesat | **Depends On:** P-288

**Context:** One-click governance. This phase adds smart presets: named `JobConfig`-override bundles (P-243) for common intents — **`Licensed`** (strict licensing, P-127), **`Fast`** (skip optional verify, higher concurrency P-204), **`Sandboxed`** (maximum isolation P-168), **`Debug`** (verbose + no cache P-206/P-250), **`Offline`** (P-146) — selectable on CLI (`--preset`), web (P-225), and referenced by templates (P-288). They encode tested, safe defaults and can be layered/excluded by explicit flags.

**Files to Create/Modify:**
- `packages/core/src/presets.ts` (new — definitions + resolution)
- `packages/core/src/__tests__/presets.test.ts` (new)
- CLI `--preset` + web settings (modify)

**Implementation Steps:**
1. Define presets as `{name, description, tags, patch: DeepPartial<JobConfig>, excludes?: (flag)[]}`:
   - `Licensed` → `licenses.strict`, require verify, block unknowns not decided (P-127/123).
   - `Fast` → `perf.jobs=max(2,host/2)`, `sandbox.verify=false` for read-only/quick runs, `agent.stream=false` (P-142), no provenance deep-scan (P-131).
   - `Sandboxed` → force Docker-app-only (no GH fallback P-178), max limits (P-176), no host-mount writes outside project (P-205).
   - `Debug` → `log.level=trace` (P-206), `idempotency.noCache=true` (P-250), full trace (P-248).
   - `Offline` → `flags.offline=true` (P-146), registry cache-only (P-179/180).
2. `presets.ts`: `resolvePresets(names, cfg)` → applies layered patches in order to JobConfig (P-243); an explicit flag named in `excludes` overrides a preset's value (explicit > preset > config, P-243 precedence); validates the result still passes the schema (P-009).
3. Wire: `--preset <name>` global/multi on CLI (P-189), web settings preset multi-select (P-225), templates reference presets (P-288).
4. Document in config ref (P-275) + ARCHITECTURE (P-270) as the governance surface.
5. `presets.test.ts`: patch application + layering, explicit-overrides-preset, excludes, schema validity, unknown preset error (P-163).

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] 5 presets defined as validated JobConfig overlays (Licensed/Fast/Sandboxed/Debug/Offline)
- [ ] Layered resolution; explicit flag > preset > config (P-243); `excludes` honored
- [ ] CLI `--preset` + web settings multi-select + templates reference
- [ ] Result-validates against schema (P-009)
- [ ] Documented in config-ref/architecture
- [ ] Tests pass (unknown → typed error)

**Tests Required:** `presets.test.ts`:
- `it('applies layered')`, `it('explicit wins')`, `it('excludes')`, `it('schema valid')`, `it('unknown errors')`

**Dependencies:** P-288. JobConfig P-243, CLI P-189, settings P-225.

**Handoff Notes:** Next: P-290 batch stitch. Presets are turnkey governance — keep precedence (explicit > preset > config) single and documented so users can always override safely.

---




### P-290: Advanced - Batch Stitch

**Owner:** inbesat | **Depends On:** P-289

**Context:** Compose many repos at once. This phase adds batch stitching: `stitch batch <applies a config/recipe>` that composes multiple source repos (not just A+B) into C via a declared recipe (list of `<source>` + selection + per-repo settings), running pipeline jobs (P-238) with fan-out (P-249 concurrency) and aggregating the result (common C + provenance across all sources). It's the multi-source generalization of merge (P-192).

**Files to Create/Modify:**
- `packages/core/src/batch/batch.ts` (new)
- `packages/core/src/batch/recipe.ts` (new — recipe schema + loader)
- `packages/core/src/batch/__tests__/batch.test.ts` (new)
- CLI `stitch batch` + web (extend)

**Implementation Steps:**
1. `recipe.ts`: `StitchRecipe {name, outDir, sources: [{repo|path, ref?, selection?}], settings?: JobConfig overrides (P-243/presets P-289), jobs?: n}` validated by zod (P-009); load from a file (`recipe.toml`) or inline.
2. `batch.ts`:
   - Expand the recipe into N sub-pipeline jobs (one per source) (P-238) — each produces intermediate provenance + deps + license (P-181–P-188).
   - Run with fan-out bounded by `jobs` (P-249); aggregate into a **combined C**: union the file selections (dedupe paths P-250/P-205), merge dep graphs across all sources (P-108/P-116), global license verdict across the union (P-120/P-128), combined provenance map + CREDITS + SBOM (P-181–P-183).
   - Overall sandbox verify on the combined C (P-177) once aggregated.
   - Emit combined job events (P-241) + progress (P-242) + metrics (P-247).
3. Failure handling: one source failing → by default whole batch `failed` with the failing source's stage listed (P-163); `--continue-on-error` harvests successes and reports the failures.
4. Idempotency: re-running a batch with same recipe + inputs reuses per-source caches (P-250).
5. `batch.test.ts`: a 3-source fixture recipe → assert combined C, aggregated deps/license/provenance, fan-out concurrency bound, continue-on-error, cache reuse.

**Required MCPs/Connectors:** Stub AI/sandbox (P-180) in tests; real in use.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Recipe schema + loader; validated (P-009)
- [ ] Fan-out N jobs (P-249) → combined C with deduped files + merged deps + global license + combined provenance/SBOM/CREDITS
- [ ] Combined sandbox verify (P-177); combined events/progress/metrics
- [ ] One-fails → batch failed with stage; `--continue-on-error` harvests
- [ ] Idempotent re-run (cache P-250)
- [ ] Tests pass

**Tests Required:** `batch.test.ts`:
- `it('combined c')`, `it('aggregates deps')`, `it('global license')`, `it('fan out bound')`, `it('continue on error')`, `it('cache reuse')`

**Dependencies:** P-289. Pipeline P-238, deps P-116, license P-128, provenance P-181–P-188, concurrency P-249.

**Handoff Notes:** Next: P-291 scheduled merges. Batch composes at scale reusing the single-source pipeline — keep the aggregation deterministic (sorted, hashed P-186) so results are reproducible.

---




### P-291: Advanced - Scheduled Merges

**Owner:** inbesat | **Depends On:** P-290

**Context:** Keep C fresh. This phase adds scheduled/recurring merges: define a schedule (cron/interval) per recipe (P-290) to re-run batch merges when source repos update (poll refs P-069/P-090), producing a new C (or updating in place with changelog), notifying via webhooks (P-296). Managed through the job store (P-239), a scheduler daemon in `serve` (P-193), and the web (P-224).

**Files to Create/Modify:**
- `packages/core/src/schedule/scheduler.ts` (new)
- `packages/core/src/schedule/schedule.ts` (new — cron parse + store)
- `packages/core/src/schedule/__tests__/schedule.test.ts` (new)
- `serve` scheduler + web schedule UI

**Implementation Steps:**
1. `schedule.ts`: schedule definition `{id, recipe (or recipeRef), cron, enabled, refresh: {pollIntervalMin?, refs?}, notify: webhookIds}` persisted in SQLite (P-026/P-239); a cron parser (validate + next-fire computation).
2. `scheduler.ts`: the daemon (started by `serve` P-193 boot) — every poll tick, check each enabled schedule:
   - Detect upstream change: resolve source refs (git ls-remote P-069/P-090) and compare to the last merged commit (provenance P-181); skip if unchanged (idempotent P-250).
   - On change: dispatch a batch job (P-290) into the queue (P-239), run it, then fire the configured webhook (P-296) with the result summary + a diff/delta of what changed.
   - Emit `schedule.run` events/trace (P-241/P-248) + a `ScheduleRecord` in audit (P-187).
3. Overlap guard: skip a due run if the same schedule already has a `running` job (P-246/P-239 lease) to avoid concurrent merges of one recipe.
4. Web (P-224) schedule list/edit/enable/disable + CLI `stitch schedule` (add/list/rm); surfaced in status (P-194).
5. `schedule.test.ts`: cron parse/next-fire, change-detection skip-unchanged, dispatch+webhook on change, overlap guard, persist/CRUD.

**Required MCPs/Connectors:** git ls-remote (P-069/090) for ref poll; webhooks (P-296).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Schedule schema + cron parse/next-fire persisted (P-026)
- [ ] Scheduler daemon detects upstream change, skips unchanged (idempotent P-250), dispatches batch (P-290), fires webhook (P-296)
- [ ] Overlap guard (no concurrent same-schedule)
- [ ] Events/trace + `ScheduleRecord` audit (P-187/P-241/248)
- [ ] Web schedule UI + CLI `stitch schedule` + status view
- [ ] Tests pass

**Tests Required:** `schedule.test.ts`:
- `it('cron parse')`, `it('skips unchanged')`, `it('dispatches on change')`, `it('overlap guard')`, `it('crud persist')`

**Dependencies:** P-290. Git ref P-069/090, jobs P-239, webhooks P-296.

**Handoff Notes:** Next: P-292 multi-user server mode. Schedules keep composed C in sync; rely on ref-poll change detection (P-181 provenance) so unchanged sources don't churn rebuilds.

---




### P-292: Advanced - Multi-User Server Mode

**Owner:** inbesat | **Depends On:** P-291

**Context:** Teams run one shared server. This phase adds multi-user server mode: `serve --multi-user` / a deployment where multiple users/workspaces share one instance — isolated per-user workspaces (own project dirs P-200), per-user job queues (P-239), sessions (P-230), and audit scopes (P-187), with authentication (SSO P-306 or local) and a users store. Single-user local `serve` (P-193) remains the default; multi-user is opt-in for teams (P-294 workspaces layer on it).

**Files to Create/Modify:**
- `packages/core/src/multiuser/users.ts` (new — user + workspace store)
- `packages/core/src/multiuser/tenant.ts` (new — per-user scoping)
- `packages/core/src/multiuser/auth.ts` (new — session/token)
- `packages/core/src/multiuser/__tests__/multiuser.test.ts` (new)
- `serve` multi-user wiring + web login (extend P-225)

**Implementation Steps:**
1. `users.ts`: `users(id, email, role, workspaceDirs)` + `workspaces(id, ownerId, name, rootDir, configs)` in SQLite (P-026); create on first login; each user owns a root `workspaceDirs` containing their projects.
2. `tenant.ts`: scope every store query/operation by `workspaceId` — jobs (P-239), provenance (P-181–P-187), audit (P-187), schedules (P-291), plugins (P-283 per-workspace). A `TenantContext` is threaded through pipeline contexts (P-238/P-243 jobConfig) so one server instance isolates data paths at the filesystem + DB level (P-205).
3. `auth.ts`: local auth (email+hashed password, P-206 secrets) + token/session issuance (HTTP-only cookie + CSRF for web P-193); SSO extension point (P-306). RBAC (P-293) gates operations.
4. `serve --multi-user`: boot with auth + tenants enabled (P-193 params); the web shows a login + per-user workspace switcher (P-225/P-294).
5. Storage isolation: per-workspace dirs (config P-200, cache P-250, sqlite DBs) so a tenant can't read another's (P-205/P-265).
6. `multiuser.test.ts`: user/workspace creation, tenant-scoped isolation (two users can't see each other's jobs/audit), auth flow (login/token/CSRF), RBAC deny, path isolation.

**Required MCPs/Connectors:** Optional SSO (P-306); local auth otherwise.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Users + workspaces persisted (P-026); first-login provision
- [ ] TenantContext scopes jobs/provenance/audit/schedules/plugins per workspace
- [ ] Local auth + token/CSRF + SSO extension point (P-306)
- [ ] `serve --multi-user` opt-in; web login + workspace switcher
- [ ] Storage isolation (dirs + DB per tenant, P-205/265)
- [ ] Tests pass

**Tests Required:** `multiuser.test.ts`:
- `it('creates workspace')`, `it('tenant isolates')`, `it('auth flow')`, `it('rbac deny')`, `it('path isolate')`

**Dependencies:** P-291. Jobs P-239, audit P-187, storage P-026/205, auth P-306.

**Handoff Notes:** Next: P-293 RBAC. Multi-user isolates by tenant; security (P-265) and tenant isolation are the trust core — never leak across tenants even on a bug (path-safe P-205 + scoped SQL).

---




### P-293: Advanced - RBAC

**Owner:** inbesat | **Depends On:** P-292

**Context:** Who can do what. This phase implements role-based access control on the multi-user server (P-292): roles (owner, admin, editor, viewer, auditor), permissions per resource (project, job, config, license policy, secrets, audit, schedules, webhooks), and enforcement in the REST API (P-297 web guard) + CLI (--as-user). It's the governance layer for team operation.

**Files to Create/Modify:**
- `packages/core/src/multiuser/rbac.ts` (new — roles/permissions/evaluate)
- `packages/core/src/multiuser/rbac.test.ts` (new)
- API middleware + CLI `--as-user` (wire)

**Implementation Steps:**
1. `rbac.ts`: define `Role` (owner/admin/editor/viewer/auditor), `Permission` set (e.g. project.read/write/delete, job.run/cancel, config.edit, license.policy.edit, secrets.read/rot, audit.read, schedule.manage, webhook.manage), and `rolePermissions: Map<Role, Permission[]>`.
2. `evaluate(user, permission, resource)` — returns allow/deny; supports resource-scoped (editor on workspace A != workspace B, P-292 tenant) + ownership special-case (owner of a project can edit it).
3. Enforce:
   - API middleware (P-297/REST + P-193 web routes): decode the session (P-292 auth), evaluate the required permission for the route, deny → 403 (P-203-mapped) with an audit deny record (P-187).
   - CLI: `--as-user <user>` (admin) runs with that role so scripts/CI are governed; validates against the server RBAC.
   - RBAC-denied actions also blocked at the service layer (not only middleware) so callers can't bypass (defense-in-depth P-265).
4. Role assignment: owner can assign roles; matrix surfaced in web (P-225/294 settings) + `stitch rbac` CLI + a `docs/security.md` table (P-265).
5. `rbac.test.ts`: role→permission mapping, resource-scoped eval, ownership override, API deny → 403 + audit deny, service-layer enforcement, assign flow.

**Required MCPs/Connectors:** None (local auth from P-292).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Roles + permission matrix + resource-scoped/ownership eval
- [ ] API (REST/WS) 403 on deny + audit deny record (P-187)
- [ ] Service-layer enforcement (no middleware-only bypass)
- [ ] CLI `--as-user` (admin) governed; role assignment flow
- [ ] Web + CLI surface + security doc (P-265)
- [ ] Tests pass

**Tests Required:** `rbac.test.ts`:
- `it('role perms')`, `it('resource scoped')`, `it('ownership')`, `it('api 403')`, `it('service deny')`, `it('assign')`

**Dependencies:** P-292. Auth P-292, REST P-297, audit P-187.

**Handoff Notes:** Next: P-294 team workspaces. RBAC is the governance contract — enforce at the service layer (not just middleware) and record every deny in audit (P-187) for accountability.

---




### P-294: Advanced - Team Workspaces

**Owner:** inbesat | **Depends On:** P-293

**Context:** Organize team work. This phase adds team workspaces on the multi-user server (P-292): named groups of members with roles (P-293), shared projects/recipes (P-290), shared schedules (P-291), and a workspace landing page (web P-225 extension). It wraps the P-292 workspace model with team membership, invitations, and per-workspace dashboards/history (P-224).

**Files to Create/Modify:**
- `packages/core/src/workspaces/team.ts` (new)
- `packages/core/src/workspaces/__tests__/team.test.ts` (new)
- web workspace UI + CLI `stitch workspace`

**Implementation Steps:**
1. Extend the workspace model (P-292): `teamWorkspace(id, name, members: [userId+role], createdBy, projects:[] , schedules:[])`; a `Membership` store (invite flow: create invite → accept → role).
2. Team features: shared recipes (P-290) + templates (P-288) at workspace scope; shared schedules (P-291); a shared audit scope for the team (P-187 filtered by workspaceId + membership); team-wide quality dashboard (P-266) + metrics (P-247) rollup.
3. Invitation flow: owner/admin invites (email/token), viewer-only by default until a role is granted (P-293 governs the grant); audit the grant event (P-187).
4. Web: a workspace landing (projects/schedules/members/activity — reusing P-224/P-225), a member management panel (roles via P-293), and workspace switcher (P-292). CLI: `stitch workspace create/add-member/remove-member/list`.
5. Tenant isolation maintained: a member only sees workspaces they belong to (P-292/P-205).
6. `team.test.ts`: create/invite/accept, membership role enforcement (P-293), shared resource visibility by membership, invite audit, removal revokes.

**Required MCPs/Connectors:** None (local auth P-292).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Team workspace + membership/invite flow (role via P-293)
- [ ] Shared recipes/templates/schedules at workspace scope
- [ ] Shared audit + team dashboard (P-266) + metrics rollup (P-247)
- [ ] Web landing/member mgmt/workspace switcher + CLI `stitch workspace`
- [ ] Tenant isolation by membership (P-292/P-205)
- [ ] Tests pass

**Tests Required:** `team.test.ts`:
- `it('create invite accept')`, `it('role enforce')`, `it('shared visibility')`, `it('invite audit')`, `it('remove revokes')`

**Dependencies:** P-293. Workspaces P-292, recipes P-290, schedules P-291, RBAC P-293.

**Handoff Notes:** Next: P-295 analytics dashboard. Team workspaces make multi-user product-grade; keep membership + role changes audited (P-187) and isolation strict (P-292/P-205).

---




### P-295: Advanced - Analytics Dashboard

**Owner:** inbesat | **Depends On:** P-294

**Context:** Understand usage. This phase adds an analytics dashboard over the stored telemetry/metrics (P-247/266): usage trends (jobs per workspace/day, compute, AI token spend P-143/P-281), success/failure rates, stage timings (P-242), flake (P-267), and provenance volume (P-181–P-188) — rendered in the web (P-224/294) and exported (`stitch analytics --json`, CSV). Privacy-aware (P-305 opt-in telemetry does not feed this unless enabled; the dashboard only aggregates server-local data).

**Files to Create/Modify:**
- `packages/core/src/analytics/dashboard.ts` (new)
- `packages/core/src/analytics/__tests__/analytics.test.ts` (new)
- web Analytics view (P-224 extension) + CLI `stitch analytics`

**Implementation Steps:**
1. `dashboard.ts`:
   - `usageTrend(timeRange, {workspaceId?, area?})` — group jobs (P-239) by day + area; counts + durations (P-247) + token/cost (P-143) + provenance volume (counts from P-188 tables/audit P-187).
   - `healthTrend` — success/failure/flake from CI reports + P-266 snapshots.
   - `stageHistograms` — per-stage timings (P-242/P-248 spans) p50/p95.
   - Returns typed `AnalyticsReport` (zod, P-009); scoped to the caller's workspace + role (P-293/P-294).
2. Aggregation from SQLite (P-026) job/metrics/audit; time-bucketed, cached (P-250-style memo) to avoid hot-path recompute; cost from P-143 totals.
3. Web: an Analytics tab in the workspace (P-294) reusing P-224 list + P-209 chart tokens (P-237 bundling) + date-range filter; CSV/`--json` export (CSV: `stitch analytics --format csv`).
4. Privacy: this dashboard is **server-local** telemetry (jobs the server ran); the external telemetry opt-in (P-305) is separate and off by default — document the boundary clearly (P-265/SECURITY).
5. `analytics.test.ts`: usage/health/stage aggregation accuracy, time-bucket, workspace+role scoping, CSV/json export, cache invalidation on new job.

**Required MCPs/Connectors:** None (SQLite aggregates).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Usage/health/stage analytics aggregated (jobs P-239, metrics P-247, tokens P-143, provenance P-188, audits P-187)
- [ ] Time-bucketed + cached; typed `AnalyticsReport` (P-009)
- [ ] Workspace + role scoped (P-293/294)
- [ ] Web Analytics view (P-224/P-209 charts) + CLI `analytics --json|--csv`
- [ ] Clearly separate from opt-in external telemetry (P-305) — off by default
- [ ] Tests pass

**Tests Required:** `analytics.test.ts`:
- `it('usage trend')`, `it('stage histograms')`, `it('scope by role')`, `it('exports')`, `it('caches')`

**Dependencies:** P-294. Metrics P-247, tokens P-143, audit P-187, RBAC P-293.

**Handoff Notes:** Next: P-296 outgoing webhooks. Analytics is insight over already-stored data — keep it local/private (unlike P-305 opt-in) and role-scoped so it never leaks cross-tenant.

---




### P-296: Advanced - Outgoing Webhooks

**Owner:** inbesat | **Depends On:** P-295

**Context:** Push events to your stack. This phase implements outgoing webhooks: register endpoints (per workspace P-294) that receive event notifications (job succeeded/failed P-241, scheduled-merge P-291, HIL request P-160, license-block P-120, security/critical P-265) as signed payloads (HMAC P-026) with retry + dead-letter, surfaced in web (P-225) + CLI `stitch webhook`. Deliveries are recorded in audit (P-187) + dashboard (P-295).

**Files to Create/Modify:**
- `packages/core/src/webhooks/out.ts` (new)
- `packages/core/src/webhooks/__tests__/webhooks.test.ts` (new)
- web settings + CLI + audit integration

**Implementation Steps:**
1. `out.ts`:
   - `registerWebhook(workspaceId, {url, events[], secret})` persisted (SQLite P-026, secret hashed P-206).
   - `dispatch(event)`: for each webhook whose events include the topic (P-241), build a signed payload `{topic, payload, ts, nonce}` with HMAC-SHA256 (P-026) over a canonical body; POST with `X-Stitch-Signature`.
   - Retry: exponential backoff (reuse P-139 backoff) up to N attempts, then move to a **dead-letter** queue (P-239-style store) + mark the webhook `failing`; a redeliver endpoint.
   - Nonce + ts for replay protection (P-265); timeout on delivery (P-176-spirit).
2. Wire events: subscribe the bus (P-241) at `serve` (P-193) and route `job.*`, `schedule.run`, `hil.request` (P-160), `license.block`, `security.critical` to `dispatch`.
3. Surface: web settings webhook CRUD + delivery history (P-225); CLI `stitch webhook add/list/rm/redeliver`; delivery records feed analytics (P-295) + audit (P-187).
4. `webhooks.test.ts`: register, signed dispatch (verify HMAC), retry/backoff → dead-letter + redeliver, timeout, replay (bad nonce/ts) reject, event-filter mismatch skip.

**Required MCPs/Connectors:** Outbound HTTP POST to user endpoints.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Webhook CRUD persisted (secret hashed P-206); event-filtered dispatch
- [ ] HMAC-signed payload (P-026) + nonce/ts replay protection (P-265)
- [ ] Retry/backoff → dead-letter + redeliver + timeout
- [ ] Events wired: job/schedule/HIL/license/security
- [ ] Web + CLI surface; deliveries in audit (P-187) + analytics (P-295)
- [ ] Tests pass

**Tests Required:** `webhooks.test.ts`:
- `it('registers signs')`, `it('hmac verify')`, `it('retry dead letter')`, `it('replay reject')`, `it('filter skip')`

**Dependencies:** P-295. Events P-241, audit P-187, HMAC P-026, backoff P-139.

**Handoff Notes:** Next: P-297 REST API. Webhooks push events out; keep deliveries audited (P-187) and replay-protected so integrations can trust them as records.

---




### P-297: Advanced - REST API

**Owner:** inbesat | **Depends On:** P-296

**Context:** A first-class programmatic API. This phase finalizes the REST API (`/api/*`) as a documented, versioned, RBAC-guarded (P-293) public surface built on the OpenAPI contract (P-252): unified resources — projects, jobs, provenance, licenses, deps, sandbox, schedules, webhooks, analytics, sessions, config — with full CRUD + filters + pagination, rate limiting (P-301-adjacent), and generated clients (P-252). It supersedes scattered endpoints with a coherent, versioned contract (`/api/v1`).

**Files to Create/Modify:**
- `packages/core/src/api/resources/*` (new — per-resource route handlers)
- `packages/cli/src/server/api.ts` (modify — mount v1 + versioning)
- `packages/core/src/api/__tests__/rest.test.ts` (new)
- OpenAPI (P-252) + generated client rebuild

**Implementation Steps:**
1. Define a coherent resource model + routes under `/api/v1` (P-252 contract + versioned): `projects` (CRUD, config P-200), `jobs` (list/get/cancel/resume P-239/240/246, metrics P-247), `provenance` (map/credits/sbom/audit P-181–P-188), `licenses` (report/decide P-128/196), `deps` (report/resolve P-116/197), `sandbox` (status/result P-177/178), `schedules` (P-291), `webhooks` (P-296), `analytics` (P-295), `sessions` (P-230), `settings`/`config` (P-200/275).
2. Unify conventions: URL structure, query filters (cursor + `limit`, `from/to` for time), envelope + error shape (P-203 code/fields), pagination, hypermedia links optional, idempotency keys (P-250) on mutating POSTs.
3. Mount with RBAC middleware (P-293) per-route permission; rate limiting + auth (P-292); validate every request/response via the P-252 zod (422 mapped P-203).
4. Versioning: `/api/v1` stable; a breaking change → `/api/v2` with overlapping window (P-281) — never mutate v1 shapes.
5. OpenAPI (P-252) regenerates + the typed client (P-252) rebuilds so all resources are typed end-to-end; `docs/api/rest.md` (P-272-style) documents it.
6. `rest.test.ts`: CRUD per resource (happy + not-found + conflict), filters/pagination, RBAC 403, idempotency-key dedupe, /v1 vs /v2 routing, validation 422 + contract (P-252) conformance.

**Required MCPs/Connectors:** None (serve).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `/api/v1` coherent resource model (projects/jobs/provenance/licenses/deps/sandbox/schedules/webhooks/analytics/sessions/settings) with CRUD+filters+pagination
- [ ] RBAC (P-293) + auth (P-292) + rate limit; zod validation (422, P-252)
- [ ] Idempotency keys (P-250) on mutating POSTs
- [ ] Versioned (`/api/v1` fixed; `/v2` for breaking, P-281)
- [ ] OpenAPI + generated client rebuilt; `docs/api/rest.md`
- [ ] Tests pass

**Tests Required:** `rest.test.ts`:
- `it('project crud')`, `it('job lifecycle')`, `it('filters pagination')`, `it('rbac 403')`, `it('idempotency key')`, `it('v1 v2 routing')`, `it('validation 422')`

**Dependencies:** P-296. Contract P-252, RBAC P-293, jobs P-239, config P-200.

**Handoff Notes:** Next: P-298 GraphQL API. REST is the coherent default API — version religiously (P-281), validate via P-252, and guard everything with RBAC so teams/clients share one governed surface.

---




### P-298: Advanced - GraphQL API

**Owner:** inbesat | **Depends On:** P-297

**Context:** Flexible queries over the stitch surface. This phase adds an optional GraphQL API (`/graphql`) alongside REST (P-297), exposing the same resources (projects, jobs, provenance, licenses, deps, sandbox, schedules, analytics, audit) with nested queries + mutations, subscriptions for live events (via WS P-241→), RBAC (P-293) applied per-field via authorization directives, and a schema that reuses the P-252 zod types as SDL. It targets rich-dashboard/CLI-internal callers; REST (P-297) remains the default.

**Files to Create/Modify:**
- `packages/core/src/graphql/` (new — schema + resolvers + directives)
- `packages/cli/src/server/graphql.ts` (modify — mount /graphql)
- `packages/core/src/graphql/__tests__/graphql.test.ts` (new)

**Implementation Steps:**
1. SDL schema: mirror REST resources (P-297) — `Query` (job, jobs(filter), provenance, licenseReport, analytics, audit), `Mutation` (runMerge, cancelJob, decideLicense, resolveDeps, schedule, webhook), `Subscription` (event(topics), job(id) updates). Reuse core typed resolvers (P-297 handlers) so REST/GraphQL share logic, not duplicate it.
2. Field-level RBAC (P-293): `@auth(permission: ...)` + `@tenant(workspaceScoped: true)` directives resolved via the tenant context (P-292) — a query requesting a denied field errors with `FORBIDDEN` (P-203-mapped), never returns it.
3. N+1 avoidance: DataLoader-style batching for common joins (job→metrics→provenance) using the existing SQLite query shapes (P-026/P-239); depth limits + query complexity caps to prevent abuse (rate-limit parity P-297).
4. Subscriptions: back a `Subscription` root from the event bus (P-241) through the WS hub (P-193/P-223 envelope) so GraphQL subscriptions and the existing web WS align.
5. Introspection + curated `schema.graphql` committed; generated client typing optional (graphql-codegen) consistent with P-252.
6. `graphql.test.ts`: query/mutation resolver correctness, N+1 batching, RBAC field denial, depth/`complexity` limit, subscription event delivery, validation errors.

**Required MCPs/Connectors:** WS (P-193) for subscriptions.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] SDL mirrors REST resources; resolvers reuse P-297 logic
- [ ] Field-level RBAC directives + tenant-scoping (P-293/292)
- [ ] DataLoader batching (no N+1); depth + complexity caps
- [ ] Subscriptions via event bus (P-241) over WS (P-193)
- [ ] Committed schema + introspection; optional typed client
- [ ] Tests pass

**Tests Required:** `graphql.test.ts`:
- `it('queries')`, `it('mutations')`, `it('rbac field')`, `it('no n plus 1')`, `it('limits')`, `it('subscriptions')`

**Dependencies:** P-297. REST P-297, RBAC P-293, events P-241, WS P-193.

**Handoff Notes:** Next: P-299 MCP Server. GraphQL is optional/flexible access — reuse REST resolver bodies so behaviors can't diverge between the two surfaces.

---




### P-299: Advanced - MCP Server for OpenCode

**Owner:** inbesat | **Depends On:** P-298

**Context:** Let OpenCode drive stitching. This phase implements a Model Context Protocol (MCP) server exposing stitch as an OpenCode tool: MCP tools `stitch.describe_project`, `stitch.run_merge`, `stitch.approve`, `stitch.check_license`, `stitch.list_jobs`, `stitch.get_provenance`, plus resources/context (active project, config) and prompts — so an OpenCode agent can inspect and trigger stitching conversationally. Built on the REST API (P-297) + RBAC (P-293) for safe remote/agent use.

**Files to Create/Modify:**
- `packages/core/src/mcp/server.ts` (new)
- `packages/core/src/mcp/tools.ts` (new — tool definitions + handlers)
- `packages/core/src/mcp/__tests__/mcp.test.ts` (new)
- `serve --mcp` (enable) + CLI `stitch mcp` (stdio transport)

**Implementation Steps:**
1. `tools.ts`: define MCP tools (per MCP spec) mapping to REST (P-297) operations:
   - `stitch.describe_project` (P-200 config + sources), `stitch.run_merge` (P-290/192, returns jobId + summary), `stitch.approve`/`reject` (HIL P-160/218), `stitch.check_license` (P-196/128 verdict), `stitch.resolve_dep_conflict` (P-197), `stitch.list_jobs` (P-239), `stitch.get_provenance` (P-181/182/183), `stitch.cancel_job` (P-246).
   - Each: name, `inputSchema` (zod P-009), `handler(ctx)` that calls the shared service layer (not the HTTP layer) so it inherits RBAC (P-293) + tenant (P-292) + audit (P-187).
2. `server.ts`:
   - Registry of the tools + `resources` (`stitch://project/config`, `stitch://project/last-merge`) + `prompts` (e.g. "init a stub project").
   - **Transport**: stdio (CLI `stitch mcp`) and optional streamable-HTTP (via `serve` P-193 mount `/mcp`) for remote agents.
   - Protocol negotiation (MCP initialize), capabilities, protocol-version guard.
3. Safety: every tool is an allowed, non-destructive-by-default action (no arbitrary fs writes — writes go through the pipeline P-238 with HIL (P-160) gating like `approve`); RBAC governs which roles may invoke mutating tools (P-293); sensitive outputs (keys P-206) never returned.
4. Integrate docs (P-272-style `docs/mcp.md`): install via `stitch mcp` (registers with the OpenCode/Claude config), capabilities table, example prompts.
5. `mcp.test.ts`: tool discovery + `inputSchema` validity, handler calls hit the service layer (RBAC enforced), stdio transport e2e (send MCP JSON → response), protocol handshake, secret non-leakage, RBAC deny.

**Required MCPs/Connectors:** MCP stdio + optional HTTP (P-193 serve).

**Skills to Invoke:** None (customize-opencode skill if wiring the OpenCode/MCP config — optional).

**Acceptance Criteria:**
- [ ] MCP tools/resources/prompts defined; zod input schemas; shared service-layer handlers
- [ ] stdio transport (`stitch mcp`) + optional HTTP (`serve /mcp`)
- [ ] Protocol handshake + capabilities + version guard
- [ ] Mutable tools RBAC + HIL-gated + auto non-destructive; no key leakage (P-206)
- [ ] `docs/mcp.md` (install/capabilities/examples)
- [ ] Tests pass

**Tests Required:** `mcp.test.ts`:
- `it('tool discovery')`, `it('handlers rbac')`, `it('stdio e2e')`, `it('handshake')`, `it('no secrets')`, `it('deny')`

**Dependencies:** P-298. REST P-297, RBAC P-293, HIL P-160.

**Handoff Notes:** Next: P-300 VS Code extension. MCP makes stitch an OpenCode tool without a browser; keep tools non-destructive and governed by the same RBAC/audit as the REST surface.

---




### P-300: Advanced - VS Code Extension

**Owner:** aradhy | **Depends On:** P-299

**Context:** Stitch inside the editor. This phase ships a VS Code extension: a panel (sidebar) that talks to a local `stitch serve` (P-193) via the REST/WS client (P-223/P-297) — add sources, inspect selection, run merge, review diffs (P-217-render in the editor), approve, view provenance/CREDITS — plus commands (init/add/merge/status) and tree decorations for stitched files. It packages the web-like UX into the editor for users who live in VS Code.

**Files to Create/Modify:**
- `extensions/vscode/` (new — extension)
  - `package.json` (contributes: commands, views, tree), `src/extension.ts`, `src/panel/`, `src/tree.ts`
- `extensions/vscode/src/__tests__/ext.test.ts` (new)
- Docs + release wiring (P-263 marketplace publish optional)

**Implementation Steps:**
1. Extension bootstrap: `activationEvents` on command/workspace; a `StitchClient` wrapping REST (P-297) + WS (P-223) to a configurable `serve` URL (default `http://127.0.0.1:3434`); status bar (server reachable + active job P-247 progress).
2. Commands: `stitch.init`, `stitch.addSource` (quick-pick local/owner repo → POST P-297/P-191), `stitch.runMerge`, `stitch.approve`, `stitch.status` (P-194 JSON → render), `stitch.credentials` (set token for multi-user P-292).
3. Sidebar panel (Webview): a trimmed render of the source→select→merge→review→result flow reusing the last C + provenance via REST (P-297) — lighter than the full web (P-208–P-237) but consistent look (VS Code theme tokens, P-209-adjacent).
4. Diff review in-editor: on `proposed-diff` (P-244/P-217), open VS Code built-in diff editors (Original = source A/B file, Modified = proposed C) for review before `approve` (P-160).
5. Tree decoration: files in `stitch-out` (P-192) tagged with a "stitched" icon + tooltip showing origin repo/commit (P-181 provenance).
6. `ext.test.ts`: unit-test StitchClient (mock REST/WS), command handlers (mock Workbench), diff-editor dispatch, status bar; `package.json` manifest validity (contributes/publishConfig). Marketplace publish optional via P-263 secrets.

**Required MCPs/Connectors:** Local `serve`; VS Code API mocks in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Extension activates; StitchClient (P-297+P-223) to configurable serve; status bar
- [ ] Commands: init/addSource/runMerge/approve/status/credentials
- [ ] Sidebar Webview trimmed flow; consistent theme tokens
- [ ] Diff review via built-in diff editors (P-244/217) pre-approve
- [ ] Tree decoration w/ provenance origin (P-181)
- [ ] `ext.test.ts` + manifest validity pass; marketplace publish optional

**Tests Required:** `ext.test.ts`:
- `it('client rest')`, `it('ws live')`, `it('commands')`, `it('diff dispatch')`, `it('status bar')`, `it('manifest')`

**Dependencies:** P-299. REST P-297, WS P-223, diff P-244/217, serve P-193.

**Handoff Notes:** Next: P-301 offline/local models. The extension is an editor-native client of the same server — keep it a thin client (reuse REST/WS), don't reimplement pipeline logic.

---




### P-301: Advanced - Offline/Local Models

**Owner:** inbesat | **Depends On:** P-300

**Context:** Privacy/no-network AI. This phase strengthens local-model support: Ollama (P-140) and generic OpenAI-compatible local endpoints (P-287 adapter) as first-class, plus a **fully offline** mode (P-146-complete) — local embeddings/LLM for the agent (P-148–P-157), no external calls, and an offline-first registry/sandbox cache (P-179/180) so deps/license/sandbox work with no internet. Private-by-default: nothing leaves the machine (P-265/P-305).

**Files to Create/Modify:**
- `packages/core/src/providers/offline.ts` (new — offline resolver + gates)
- `packages/core/src/providers/__tests__/offline.test.ts` (new)
- config/provider wiring + docs (P-276 provider guide)

**Implementation Steps:**
1. `offline.ts`:
   - `isFullyOffline(cfg)` — true when `flags.offline=true` (P-146) AND the active provider is Ollama/local (P-140/P-287) with a reachable local endpoint.
   - Offline provider bundle: use the local model for all agent tool cheap-calls (P-148–P-157 detect/fix/edit over generation P-146), a deterministic fallback for feature generation when no local model handles it (or skip with a clear message, P-163) — never silently degrade finalize.
   - Offline deps/license: resolve from a local registry cache (P-179) + vendored license data (P-118/119) so `deps`/`license` stages run with no network; provenance (P-181–P-188) is inherently local.
2. Startup check (`doctor` P-195): verify the local endpoint responds + the model is present; offline mode is asserted + surfaced in status (P-194).
3. Sandbox offline (P-176/180): `Sandboxed`-adjacent — the verify uses pre-cached images only (no image pull P-169) so it doesn't need the registry; signals a cached-layers-only restriction.
4. Preflight: `stitch merge --offline` runs a capability gate (P-244-dry-run) confirming every stage that will run has offline inputs; a clear error (P-203) names the first missing offline resource if not.
5. `offline.test.ts`: offline detection, per-stage offline readiness (deps/license/sandbox/agent), doctor report, capability-gate preflight pass/fail, no silent finalize degrade.

**Required MCPs/Connectors:** Ollama/local endpoint (optional); offline cache P-179/180.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `isFullyOffline` + offline provider bundle (Ollama P-140 / local P-287)
- [ ] Agent uses local/cheap tools; generation gated (P-146), never silently degrades finalize
- [ ] Offline deps/license from local cache (P-179) + vendored license data
- [ ] Sandbox cached-images-only (no pull) offline
- [ ] Doctor (P-195) + status (P-194) surface offline state; preflight gate (P-244) names gaps
- [ ] Tests pass

**Tests Required:** `offline.test.ts`:
- `it('detects offline')`, `it('stage readiness')`, `it('doctor report')`, `it('preflight gate')`, `it('no silent degrade')`

**Dependencies:** P-300. Offline P-146, Ollama P-140, adapter P-287, cache P-179/180.

**Handoff Notes:** Next: P-302 cost budgets. Offline mode is the privacy guarantee — make it explicit, surfaced, and never silently degrade output quality without telling the user.

---




### P-302: Advanced - Cost Budgets

**Owner:** inbesat | **Depends On:** P-301

**Context:** Keep AI spend in bounds. This phase implements cost budgets: per-project/workspace (P-294) monthly+per-run caps on AI spend (from P-143 token/cost tracking + P-247 metrics), with hard-stop and soft-warn thresholds, configurable per cosumer (P-256/297/299), a pause policy (schedule P-291 jobs auto-suspend when over), and dashboard surfacing (P-295 analytics + P-247). Alerts via webhooks (P-296) + audit (P-187). It's the financial governance for teams.

**Files to Create/Modify:**
- `packages/core/src/costs/budget.ts` (new)
- `packages/core/src/costs/__tests__/budget.test.ts` (new)
- config `[cost]` + `serve` enforcement + web/CLI + webhooks

**Implementation Steps:**
1. `budget.ts`:
   - `BudgetCfg { monthlyUsd?, perJobUsd?, warnAt?: 0.8, hardStop?: boolean, scope: project|workspace }` (P-243 JobConfig `[cost]` + workspace-level P-294).
   - Tracking: accumulate spend from the P-143 cost ledger + P-247 job metrics into a rolling monthly bucket per scope (SQLite P-026), plus current-job running total.
   - `checkAndAllow(scope, estCostUsd)` — returns `allow | warn | block`: warn persists a `CostAlert` (P-187 audit + P-296 webhook), block aborts the job start or (for long jobs) the next stage (P-246 cancel-aware) with a `COST_BUDGET` typed error (P-203).
2. Enforcement points: at job start (P-238) and before each AI call (P-142/P-143) — a shared `costGate` the provider layer consults; stream can be cut if the running total crosses the hard stop mid-generation (P-163 abort).
3. Pause policy: for scheduled merges (P-291), over-budget → auto-pause with a `CostAlert` and resume when the cycle rolls (configurable).
4. Surfacing: web settings (P-225) budget editor + a Cost panel in analytics (P-295); CLI `stitch budget` (set/report; `--json` P-194). Over-budget alerts to webhooks (P-296).
5. `budget.test.ts`: accumulation, warn/block thresholds, hard-stop mid-run, scope precedence (job ≤ project ≤ workspace), pause policy, error + alert + audit.

**Required MCPs/Connectors:** None (local ledger).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Budget config (monthly/per-job, warn/hard-stop, scope) in `[cost]`+workspace
- [ ] Spend accumulated from P-143/P-247; checkAndAllow allow/warn/block
- [ ] Hard-stop enforced at job start + before AI calls + mid-stream abort (P-203 COST_BUDGET)
- [ ] Scheduled-merges (P-291) auto-pause over budget + resume on roll
- [ ] Surfaced: web (P-225/295), CLI `budget`, webhooks (P-296), audit/alert (P-187)
- [ ] Tests pass

**Tests Required:** `budget.test.ts`:
- `it('accumulates')`, `it('warn block')`, `it('hard stop midrun')`, `it('scope precedence')`, `it('pause policy')`

**Dependencies:** P-301. Cost P-143/247, config P-243, schedules P-291, webhooks P-296.

**Handoff Notes:** Next: P-303 repo-metadata cache. Cost budgets are the financial safety valve — enforce before spend, not after, and never let a runaway generation exceed the hard stop silently.

---




### P-303: Advanced - Repo-Metadata Cache

**Owner:** inbesat | **Depends On:** P-302

**Context:** Speed up repeated repo access. This phase adds a repo-metadata cache: persist per-repo metadata (tree listings P-103, commit SHAs P-069/P-090, ref heads, license declarations P-118/P-119, SBOM/provenance P-181–P-183) in a content-addressed, TTL'd store (SQLite P-026 + disk P-205) keyed by repo+ref+content-hash (P-250) — so `stitch add` (P-191) + merge (P-192) + batch (P-290) + schedules (P-291) don't re-fetch unchanged trees/refs, especially in the offline/cached mode (P-301).

**Files to Create/Modify:**
- `packages/core/src/cache/repoMeta.ts` (new)
- `packages/core/src/cache/repoMeta.test.ts` (new)
- Git/Octokit (P-069/090) + tree (P-103) + license (P-118) integration

**Implementation Steps:**
1. `repoMeta.ts`:
   - Key = `sha256(owner/repo + ref + type)` with a content-hash for the resource; store entries `{key, type (tree|refs|license|sbom), value (JSON/binary), fetchedAt, ttlMs, refResolution}`.
   - `get(type, repo, ref)` → stale check + ref re-resolution (a ref may move; `getRefHead` re-polls and invalidates TTL by head change) — **ref-consistency**: cache is only valid while ref→sha matches (P-181 provenance).
   - `set(type, repo, ref, sha, value)` + `invalidate(repo, ref)`.
   - Eviction: LRU + TTL; `--no-cache` (P-250) bypasses.
2. Integrate:
   - Tree listing (P-103) cached per (repo,sha) — safe because sha is immutable content.
   - Ref heads (P-069 old-remote / P-090) — cached with short TTL + re-poll on schedule/merge (P-291).
   - License declarations (P-118/119) cached per (repo,sha) for the scan.
   - Provenance (P-181–P-183) reuses the sha-resolved metadata so map/sbom don't refetch.
3. Offline: in fully-offline mode (P-301), the cache is the source of truth for already-seen refs; missing → preflight gap (P-301/P-244).
4. `repoMeta.test.ts`: get/set/invalidate, ref-consistency (head change invalidates tree cache), TTL + LRU eviction, no-cache bypass, offline-read path.

**Required MCPs/Connectors:** Git/Octokit (P-069/090) for refs; cache local.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Content-addressed repo-metadata cache (tree/refs/license/sbom) with TTL+LRU
- [ ] Ref-consistency: cache valid only while ref→sha matches (P-181); head-change invalidates
- [ ] Tree (P-103) + refs (P-069/090) + license (P-118/119) + provenance (P-181–P-183) integrated
- [ ] Offline (P-301) reads from cache; missing → preflight gap
- [ ] `--no-cache` bypass (P-250)
- [ ] Tests pass

**Tests Required:** `repoMeta.test.ts`:
- `it('get set')`, `it('ref consistency')`, `it('ttl lru')`, `it('offline read')`, `it('no cache')`

**Dependencies:** P-302. Git P-069, tree P-103, license P-118, cache P-250, offline P-301.

**Handoff Notes:** Next: P-304 K8s sandbox. The repo-metadata cache cuts repeated network cost — always key by immutable sha so cache correctness never depends on a moving ref.

---




### P-304: Advanced - K8s Sandbox

**Owner:** inbesat | **Depends On:** P-303

**Context:** Sandbox at cluster scale. This phase adds a Kubernetes backend for the sandbox (P-168), in addition to local Docker (P-169) + GH Actions (P-178): run verify/build jobs as Kubernetes Jobs/Pods with resource limits (P-176), image pull policy honoring the cache (P-179/P-303), namespaces per tenant (P-292), and pod eviction/timeout handling (P-176/246). It targets teams that want cluster-backed, isolated compute.

**Files to Create/Modify:**
- `packages/core/src/sandbox/k8s/` (new — client, job-runner, limits, cleanup)
- `packages/core/src/sandbox/__tests__/sandbox.k8s.test.ts` (new)
- config `[sandbox].backend='k8s'` + backend registry

**Implementation Steps:**
1. Backend registry: `getSandboxBackend(cfg)` resolves `docker` (P-169) | `gh` (P-178) | `k8s` (new); `k8s` requires a kubeconfig + namespace.
2. `k8s/`:
   - `client.ts` — thin k8s API client (or a validated `@kubernetes/client-node`-free HTTP client to the API server via kubeconfig context; keep it minimal + auth via the context token/cert).
   - `run.ts` — `provisionBuildJob(ecosystem, opts)` creates a Pod/Job from the sandbox runner image (P-169/P-264), requests limits/memory (P-176 from JobConfig P-243), sets `imagePullPolicy: IfNotPresent` unless `--no-cache` (P-250/P-179), `activeDeadlineSeconds` from timeout (P-176), and a per-tenant namespace (P-292)/label `stitch.io/tenant`, `stitch.io/job`.
   - `watch.ts` — stream pod phase/logs (P-174) to the P-241 event bus + capture exit; map container exit codes to pass/fail (P-177/P-180).
   - `cleanup.ts` — GC completed/evicted pods by TTL + job hook (P-188 spirit); honor `privilege`-guard (no privileged, no hostPath, P-265).
3. Cancellation (P-246) maps to deleting the Job/Pod; limits prevent host exhaustion (P-249).
4. `sandbox.k8s.test.ts`: with a mocked k8s API (fake HTTP), assert pod spec (limits/timeout/namespace/labels/imagePullPolicy), log streaming→events, exit-code mapping, cleanup TTL, cancel-delete, RBAC/tenant namespace. No real cluster needed.

**Required MCPs/Connectors:** Optional real kube API; mocked in tests.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Backend registry adds `k8s` alongside docker (P-169)/gh (P-178); config-driven (P-243)
- [ ] Pod/Job spec: limits P-176, timeout, tenant namespace (P-292), labels, imagePullPolicy (cache P-179/303), non-privileged/hostPath-safe (P-265)
- [ ] Log streaming → bus (P-241/P-174); exit-code mapping (P-177/180)
- [ ] Cleanup TTL + cancel→delete (P-246)
- [ ] Tests pass (mocked k8s HTTP)

**Tests Required:** `sandbox.k8s.test.ts`:
- `it('builds pod spec')`, `it('streams logs')`, `it('exit mapping')`, `it('cleanup ttl')`, `it('cancel deletes')`, `it('tenant ns')`

**Dependencies:** P-303. Sandbox P-168–P-180, limits P-176, tenants P-292.

**Handoff Notes:** Next: P-305 telemetry opt-in. K8s brings cluster isolation at scale — keep it non-privileged, tenant-scoped, and budget-limited (P-176) so a bad pod can't escape or exhaust the cluster.

---




### P-305: Advanced - Telemetry Opt-In

**Owner:** inbesat | **Depends On:** P-304

**Context:** Privacy-first product analytics. This phase implements an **opt-in** telemetry channel (separate from the local analytics dashboard P-295): when the user/org explicitly enables it, anonymized aggregate events (feature usage, error signatures P-203/P-163 unscoped, timing P-247, not source code/provenance/AI payloads — P-265 privacy) are sent with a stable anonymous install id, subject to a data policy, with clear opt-out + `na` (never) default. It's off unless enabled.

**Files to Create/Modify:**
- `packages/core/src/telemetry/telemetry.ts` (new)
- `packages/core/src/telemetry/__tests__/telemetry.test.ts` (new)
- config `[telemetry]` + prompt UI (init P-190 / first-run) + docs

**Implementation Steps:**
1. `[telemetry] enabled: 'auto'|'yes'|'never'` (P-200) default `'never'`. When `'auto'`, prompt once at first run with a clear consent screen (CLI P-198 / web P-225) then remember; `'never'` sends nothing.
2. `telemetry.ts`:
   - **Privacy scope**: only events = `{type: 'feature'|'error'|'timing'|'job_outcome', installId (anonymous hash P-026), os, arch, version, eventName, durationMs?, no identifiers}` — **no** repo names, paths, source, provenance, AI payload, license data, or config values (P-206/P-265).
   - Batches + sends with retry/backoff (P-139) to an endpoint; drops on `never`; local queue (P-026) bounded; `telemetry.clear()` wipes.
   - An **error-signature** mode: hash the P-203 error code + message template (no values).
3. Wire: emit feature/timing/outcome events keyed off the P-241 bus (at `serve` P-193 + CLI entry P-189); never send in fully-offline mode (P-301).
4. Controls: CLI `stitch telemetry` (status/enable/disable/clear); web settings (P-225) toggle; environment `STITCH_TELEMETRY=off` + `--no-telemetry`; documented in `docs/telemetry.md` (what's sent, storage, opt-out) + SECURITY (P-265).
5. `telemetry.test.ts`: never-sends default, consent flow, scrubbing (no identifiers leak even if a developer mis-fires), batching/retry, clear, offline no-send.

**Required MCPs/Connectors:** Outbound telemetry endpoint (only when enabled).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Default `never`; `auto` prompts consent once; consent remembered
- [ ] Strict privacy scope (feature/error/timing/outcome only; anonymous id; no code/provenance/AI/config) — scrub test
- [ ] Batch + retry/backoff (P-139); bounded local queue; `clear()`
- [ ] Never sends in offline (P-301); `STITCH_TELEMETRY=off`/`--no-telemetry`
- [ ] CLI `telemetry` + web toggle (P-225) + `docs/telemetry.md` + SECURITY (P-265)
- [ ] Tests pass

**Tests Required:** `telemetry.test.ts`:
- `it('never default')`, `it('consent')`, `it('scrubs')`, `it('batch retry')`, `it('clear')`, `it('offline no send')`

**Dependencies:** P-304. Config P-200, events P-241, offline P-301, all phases P-005-gated-by-P-004 (feature tracking).

**Handoff Notes:** Next: P-306 SSO. Telemetry is trust — keep it strictly opt-in, strictly anonymous-scoped, and clearly documented (P-265) so users never doubt what leaves the machine.

---




### P-306: Advanced - SSO

**Owner:** inbesat | **Depends On:** P-305

**Context:** Enterprise login. This phase adds SSO authentication for the multi-user server (P-292): OIDC/SAML providers (Google, GitHub, Okta, Azure AD, Keycloak, generic OIDC) via a pluggable IdP adapter, JWT/opaque session management, role mapping from IdP claims to RBAC roles (P-293), and team auto-provisioning on first SSO login (P-294). Local auth (P-292) remains available; SSO is the enterprise path.

**Files to Create/Modify:**
- `packages/core/src/auth/sso.ts` (new)
- `packages/core/src/auth/idps/` (new — oidc.ts, saml.ts stub, adapters)
- `packages/core/src/auth/__tests__/sso.test.ts` (new)
- `serve` auth wiring + web login (P-225/292) + config `[auth]`

**Implementation Steps:**
1. `[auth] provider: 'local'|'oidc'|'saml'` + per-IdP settings (issuer, clientId, secret, redirect, `claims.role`, `claims.team`). Local (P-292) stays default; multiple providers allowed.
2. `sso.ts`:
   - OIDC flow (authorization code + PKCE): discovery via the issuer's `.well-known`; token validation; map sub/email/name + the configured role/team claims (P-006-spirit) into a `User` (P-292) + initial `Role` (P-293).
   - Group-based: IdP `groups` claim → role mapping table so `admin-group` → `admin` etc.
   - **Auto-provision**: on first login, create the user + default team workspace (P-294) with mapped role; if the user already exists, refresh claims/role (not silently re-grant to a higher role than their local one allows unless configured — P-293 safety).
   - Session: issue an opaque session/token (P-202-store) + refresh from IdP expiry; logout ends the local session (IdP back-channel optional).
3. RBAC: `RequireRole`/SSO-role sync at login into the P-293 model; audit every login/role-change (P-187).
4. Web login (P-225/P-292) shows provider buttons; CLI `stitch login --provider` for scripted SSO (P-297 client token).
5. `sso.test.ts`: OIDC code+PKCE happy path (mock IdP), claim→role mapping incl. groups, auto-provision + existing-user refresh, role-scope safety (no over-grant), logout, login audit, SAML adapter stub (validation contract if OIDC not used).

**Required MCPs/Connectors:** IdP OIDC discovery/token endpoints (mocked in tests).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `[auth]` provider local/oidc/saml; OIDC code+PKCE + discovery; SAML adapter stub
- [ ] Claim→role (incl. groups) mapping; auto-provision team (P-294)
- [ ] Existing-user refresh without over-grant (P-293 safety)
- [ ] Session/token + refresh + logout; RBAC at login; login/role audit (P-187)
- [ ] Web login buttons + CLI `login --provider`
- [ ] Tests pass

**Tests Required:** `sso.test.ts`:
- `it('oidc pkce')`, `it('claim role')`, `it('groups')`, `it('autoprovision')`, `it('no overgrant')`, `it('logout audit')`

**Dependencies:** P-305. Auth P-292, RBAC P-293, teams P-294.

**Handoff Notes:** Next: P-307 compliance export. SSO is enterprise trust — map roles conservatively (never auto-elevate) and audit all auth transitions (P-187) to keep governance intact.

---




### P-307: Advanced - Compliance Export

**Owner:** inbesat | **Depends On:** P-306

**Context:** Ship an audit-ready bundle. This phase adds a compliance export: a single, signed, dated bundle assembling everything stakeholders need for review — license posture (P-120/128), provenance map + CREDITS (P-181/182), SBOM (P-183), checksums (P-186), audit summary (P-187), NOTICE (P-126), generated LICENSE(s) (P-125), policy decisions (P-127), and the active config (P-200) — as a set of files + a manifest + an HMAC signature (P-026). Exported via CLI `stitch compliance-export` and web (P-224), per workspace (P-294).

**Files to Create/Modify:**
- `packages/core/src/compliance/export.ts` (new)
- `packages/core/src/compliance/__tests__/compliance.test.ts` (new)
- CLI + web surface + docs (P-277 license guide appendix)

**Implementation Steps:**
1. Assemble the bundle in a temp dir: CREDITS.md (P-182), SBOM (P-183), checksums (P-186), NOTICE (P-126), LICENSE (P-125), `<report>.json` = LicenseReportData (P-128) + policy + overrides (P-127/124), audit-summary (P-187 filtered to the workspace, no secrets P-206), and an `export-manifest.json` (schema version, exportedAt, job/source refs, scope P-294, tool version P-282).
2. Sign: HMAC-SHA256 (P-026) over the canonical manifest (secret from config P-200, never exported); each file also checksummed (P-186) into `MANIFEST.checksums`; the export is immutable after creation (read-only dir, P-205).
3. CLI `stitch compliance-export [--out dir] [--scope workspace] [--since]` → writes the dir + prints the manifest/signature + exit 0; `--verify <dir>` re-checks checksums + signature. Web export button in the workspace compliance view (P-295).
4. Determinism: files sorted, pinned order, stable JSON keys (P-282 changelog determinism parity) so exports are diffable across runs.
5. `compliance.test.ts`: assemble completeness (all expected files present + valid), manifest correctness, HMAC sign/verify round-trip, checksum verify (tamper detected), scope filter (workspace only), no secrets in export.

**Required MCPs/Connectors:** None (local).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Bundle assembles all compliance artifacts (CREDITS/SBOM/checksums/NOTICE/LICENSE/report/audit/manifest) with no secrets (P-206)
- [ ] HMAC signature + per-file checksums (P-186/P-026); immutable output
- [ ] CLI `compliance-export` (+ `--verify`) + web export button (P-295)
- [ ] Deterministic output (diffable)
- [ ] Scope-filtered per workspace (P-294); docs appendix (P-277)
- [ ] Tests pass

**Tests Required:** `compliance.test.ts`:
- `it('assembles complete')`, `it('manifest valid')`, `it('sign verify')`, `it('tamper detected')`, `it('scoped')`, `it('no secrets')`

**Dependencies:** P-306. Provenance P-181–P-188, license P-125/126/127/128, audit P-187.

**Handoff Notes:** Next: P-308 plugin marketplace (Advanced continues). Compliance export is the reusable review artifact — keep it deterministic, signed, and scoped so auditors can trust the bundle as-is.

---




### P-308: Advanced - Plugin Marketplace

**Owner:** inbesat | **Depends On:** P-307

**Context:** Extend stitch with plugins. This phase builds a plugin marketplace: a backend (P-297 service) that lists/curates community & first-party plugins (new tool adapters P-148, generators P-146, sandbox backends P-304-style, license policies P-127, IdP adapters P-306), plus a local plugin manager (`stitch plugin add/list/remove/update`) with content-addressed versions (P-303/P-250), signature verification (P-307/P-026), and a curated allowlist. Plugins run in the plugin host with a declared permission manifest.

**Files to Create/Modify:**
- `packages/core/src/plugins/` (new — gateway, manager, host, manifest)
- `packages/core/src/plugins/__tests__/plugins.test.ts` (new)
- REST (P-297) plugin endpoints + CLI `plugin` subcommands

**Implementation Steps:**
1. `manifest`: every plugin ships `manifest.json` — `{id, name, version, entry (default export), apiVersion, permissions[], runtime:'node'|'bun', scope:['tool'|'generator'|'sandbox'|'licensePolicy'|'idp']}`. Permissions are declared explicitly (e.g. `network`, `fs:read:out`, `env:read`), governing the host sandbox.
2. `gateway.ts` — resolves a plugin's `scope` + `permissions`; `manager.ts` — `add` (fetches content-address by version P-303, verifies signature P-307/P-026), `list`, `remove`, `update`; store per-workspace (P-294) or user, in the DB (P-026) + disk (P-205).
3. `host.ts` — runs plugin `entry` in the declared runtime with the declared permission grants enforced (when scope=tool, routes the agent tool call P-148→host; best-effort isolation since plugins are trusted-from-allowlist by default; **caveat**: untrusted execution is out of scope — the allowlist + signature is the trust boundary).
4. Marketplace service: `bundles/listPlugins`, `getPlugin`, `checkVersion` on the REST (P-297) + ws (P-223); require auth (P-292/306). Curated allowlist = signed, pinned plugin manifest hashes (P-307/250).
5. Surfacing: web marketplace view (P-225/P-295) + CLI `plugin`; installed-plugin audit + revoke on signature change.
6. `plugins.test.ts`: add/verify-signature/update/list/remove, permission enforcement, scope routing, allowlist rejection of unsigned plugin, marketplace endpoints (mock), audit of installs.

**Required MCPs/Connectors:** Marketplace REST endpoints (mocked locally).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Plugin manifest (apiVersion, permissions, runtime, scope); host runs entry under declared grants
- [ ] Manager add/list/remove/update with content-addressing (P-303/250) + signature verify (P-307/026)
- [ ] Marketplace REST endpoints (P-297) + auth; curated pinned allowlist
- [ ] Web marketplace view + CLI `plugin`; install audit + revoke on signature change
- [ ] Untrusted execution out of scope — allowlist+signature is the trust boundary
- [ ] Tests pass

**Tests Required:** `plugins.test.ts`:
- `it('add verify')`, `it('update')`, `it('remove list')`, `it('permissions')`, `it('allowlist reject')`, `it('marketplace')`, `it('audit')`

**Dependencies:** P-307. Content-address P-250, provisioning P-003, plugins run, REST P-297.

**Handoff Notes:** Next: P-309 benchmarks suite. The trust boundary is *allowlist + signature* — never run unsigned/unknown plugins; keep the host's permission enforcement strict.

---




### P-309: Advanced - Benchmarks Suite

**Owner:** inbesat | **Depends On:** P-308

**Context:** Measure and guard the pipeline. This phase adds a benchmarks suite: a fixture-based perf test harness for the core pipeline stages — clone/scan tree (P-103), dependency resolve (P-104–P-113), license scan (P-114–P-132), AI provider calls P-133–P-147 (latency/tokens/cost P-143), sandbox verify (P-168–P-180), merge (P-238–P-252) — with a CI regex gate (P-260 perf tests) so regressions fail the build, plus a baseline store (P-026) for trend reporting (P-295).

**Files to Create/Modify:**
- `packages/core/src/bench/` (new — fixtures, runner, baseline)
- `packages/core/src/bench/__tests__/base.test.ts` (new)
- CI job + `flux.yaml`-spect (perf) + docs

**Implementation Steps:**
1. `bench/fixtures/` — synthetic repo sets (small/medium: a few hundred files; large: 5k+ files) deterministically generated (P-282) to keep perf tests hermetic + fast.
2. `runner.ts` — runs each stage in isolation with a warm cache (P-303/Eden-Sandbox-P-179) and records wall-time/p95/memory + AI cost (P-143/P-302) for provider stages; output JSON baseline-comparable.
3. `baseline.ts` — store baselines (SQLite P-026) per env-id (os/arch/version, P-305-scope but local here); `--compare` flags regressions over a threshold (default +15%).
4. CI gate (P-260 perf): on core PRs, run `bench --ci` (small/medium only; large on nightly via P-291 schedule) and fail if a baseline is exceeded; report in the PR (P-268/269).
5. Trend surfacing: a Perf tab in analytics (P-295) reading the baseline store.
6. `base.test.ts`: fixture determinism + hermeticity, isolation (cache cleared between sections), baseline write/compare/regression detect, CI gate fail/pass.

**Required MCPs/Connectors:** Sandbox images (P-169) for bench runs.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Hermetic deterministic fixtures (small/medium/large)
- [ ] Per-stage runner w/ warm cache + wall/p95/memory + AI cost (P-143/302)
- [ ] Baseline store (P-026) + env-scoped baselines + `--compare` (regress > +15%)
- [ ] CI gate (P-260) fails on regression; large on nightly (P-291)
- [ ] Perf tab in analytics (P-295)
- [ ] `base.test.ts` passes

**Tests Required:** `base.test.ts`:
- `it('fixtures hermetic')`, `it('isolation')`, `it('baseline compare')`, `it('regression detect')`, `it('ci gate')`

**Dependencies:** P-308. Performance P-260, cache P-303, cost P-143/302.

**Handoff Notes:** Next: P-310 config migration. Guard performance with explicit baselines, not vibes — a hermetic suite keeps regressions visible in CI before they ship.

---




### P-310: Advanced - Config Migration

**Owner:** inbesat | **Depends On:** P-309

**Context:** Ship config upgrades safely. This phase adds a versioned config migration system for `stitch.json`/`.stitchrc` (vector P-200): a schema-version field, a migration runner (transform old shape → current zod schema P-009), a dry-run + backup path, and a deprecation/renaming registry — so config changes between versions (P-282) migrate users without breaking them.

**Files to Create/Modify:**
- `packages/core/src/config/migrations/` (new — registry, runner)
- `packages/core/src/config/migrations/__tests__/migrate.test.ts` (new)
- load path (P-200) + CLI `config` subcommands

**Implementation Steps:**
1. `registry` — ordered migration modules `m<NNNN>_<desc>.ts`, each `{fromVersion, toVersion, up(cfg) => cfg}`; missing `up` for a jump = error; schema-version stored in config (`version`) + default.
2. `runner` — on load (P-200): read version → if newer than known → fail with an error telling them to upgrade (P-203); if older → apply each migration sequentially, then `zod`-validate (P-009) the result; unknown keys are preserved but warned (deprecation registry emits rename suggestions).
3. Safety: `--dry-run` prints the diff without writing; `--backup` writes a dated snapshot (P-205) before writing; migrations are deterministic (P-282) and each is unit-tested against fixture configs.
4. CLIs: `stitch config migrate --dry-run`, `--apply`, `--backup`, `--check-version`; web: a migration banner (P-225) when an old config is detected, offering dry-run/apply in-session.
5. `migrate.test.ts`: sequential up, skip-if-current, future-version error, unknown-key preserve + warn, dry-run no-write, backup snapshot, deterministic idempotent result.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Versioned migration registry + sequential runner; future-version error (P-203)
- [ ] `--dry-run` (diff, no write) + `--backup` snapshot (P-205); deterministic + idempotent (P-282)
- [ ] Deprecation/renaming registry warns on unknown keys
- [ ] CLI `config migrate` + web migration banner (P-225)
- [ ] Cada migration unit-tested; `migrate.test.ts` passes

**Tests Required:** `migrate.test.ts`:
- `it('sequential up')`, `it('future version erro')`, `it('dry run')`, `it('backup')`, `it('deprecation warn')`, `it('idempotent')`

**Dependencies:** P-309. Config P-200, zod P-009, versions P-282.

**Handoff Notes:** Next: P-311 internationalization core. Config migrations are permanent upgrades that must never lose user data — always dry-run/backup, deterministic, and idempotent.

---




### P-311: Advanced - Internationalization Core

**Owner:** inbesat | **Depends On:** P-310

**Context:** Localize the product. This phase adds the i18n core: a translation registry + message extraction for the web UI (P-208–P-237) and CLI (P-189–P-207), locale detection (browser + env + config override P-200), fallback chains, and date/number/plural formatting with locale-aware output. English is the source language; this ships the *infrastructure* + English + a small starter locale (e.g. Spanish) as proof.

**Files to Create/Modify:**
- `packages/core/src/i18n/` (new — registry, extractor, formatter)
- `packages/core/src/i18n/__tests__/i18n.test.ts` (new)
- Web + CLI string extraction + config `[i18n]`

**Implementation Steps:**
1. `registry` — a keyed message catalog per locale (`en.ts`, `es.ts`) with typed keys (P-252-adjacent) + a `resolve(locale, key, params)` with fallback `en` and a sentinel for missing keys.
2. `extractor` — a dev script that scans web/CLI JSX/strings for message keys, warns on missing translations, and generates/validates catalog files (lint-guard in CI P-260).
3. Locale resolution:
   - Web: browser `navigator.language` → cookie → `config [i18n].locale` override (P-200); sets `lang` attribute.
   - CLI: `LC_ALL`/`LANG` env → `--locale` flag → config override; uses locale for dates/numbers/plurals.
4. Formatting: `formatDate`, `formatNumber`, `formatPlural` wrapping `Intl` (P-009 runtime is Bun with full ICU).
5. `i18n.test.ts`: resolve + fallback + missing-key sentinel, extraction completeness (all keys translated or warned), locale detection precedence, Intl date/number/plural correctness, config override.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Typed message registry + en + starter locale (es); fallback chain + missing-key sentinel
- [ ] Extractor dev script + CI lint guard (P-260) for missing translations
- [ ] Locale detection (web browser/cookie, CLI env/flag, config P-200 override)
- [ ] `Intl`-based date/number/plural formatting; `lang` attribute set
- [ ] `[i18n]` config; English source + starter locale proof
- [ ] `i18n.test.ts` passes

**Tests Required:** `i18n.test.ts`:
- `it('resolve fallback')`, `it('missing sentinel')`, `it('extraction')`, `it('locale detect')`, `it('intl format')`

**Dependencies:** P-310. Web P-208–P-237, CLI P-189–P-207, config P-200.

**Handoff Notes:** Next: P-312 roadmap doc. i18n is infrastructure+proof — never block a feature on missing translations; fall back to English and flag for extraction.

---




### P-312: Advanced - Roadmap Doc

**Owner:** inbesat | **Depends On:** P-311

**Context:** Communicate where stitch is going. This phase publishes a public roadmap document consolidating the phased plan (MASTER_PLAN/PROGRESS) into a readable, dated roadmap: what shipped, what's in progress, what's planned (bucketed by milestone), and the decision principles that guide the product (P-002/P-005, UX P-208, licensing P-114, security P-265). Drives transparency + contributor alignment.

**Files to Create/Modify:**
- `docs/ROADMAP.md` (new)
- `docs/README.md` index + link (modify)
- Optional: generated from MASTER_PLAN/PROGRESS via a small script

**Implementation Steps:**
1. Structure: `# Roadmap` → `## Shipped` (list of completed milestones/epics w/ links, driven from PROGRESS + git history P-282), `## In Progress` (current epic + phases), `## Planned` (upcoming epic buckets w/ rationale), `## Principles` (decision principles incl. security P-265, license P-114, UX P-208).
2. Milestone buckets: `M1 Core stitch` (deps/license/AI/sandbox/provenance + CLI/web), `M2 Team` (orchestration/testing/docs + multi-user/RBAC/SSO), `M3 Advanced` (plugins/bench/config-migrate/i18n/marketplace/cache/k8s).
3. Signposts: every planned item links to its MASTER_PLAN phase id (or is derived), with a `last-updated` stamp; kept deterministic + sortable (P-282).
4. Cool-off: no promised dates (maintainer reality); instead "next milestone likely = <bucket>" + a "help wanted" note pointing to contributing docs (P-269).
5. `docs/README.md` gains a Roadmap link; a generation script (`packages/core/src/docs/roadmap.ts` or `scripts/gen-roadmap.ts`) emits it from MASTER_PLAN for consistency.

**Required MCPs/Connectors:** None.

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] ROADMAP.md with Shipped/In Progress/Planned/Principles sections, dated
- [ ] Milestone buckets (M1 core, M2 team, M3 advanced) with rationale; no date promises
- [ ] Links to MASTER_PLAN phases + PROGRESS + EPIC history; deterministic (P-282)
- [ ] Generation script derives it from MASTER_PLAN; README index link added
- [ ] "Help wanted" note → contributing (P-269)

**Tests Required:** (manual/CI) — assert ROADMAP is non-stale via the generator: `scripts/gen-roadmap.ts --check` matches committed file.

**Dependencies:** P-311. MASTER_PLAN/PROGRESS, P-282.

**Handoff Notes:** Next: P-313+ release checklist & retrospective (final batch). The roadmap turns a huge task list into a readable story — always derive from source-of-truth plan files so it can't drift.

---




### P-318: Advanced - Project Finalize

**Owner:** inbesat | **Depends On:** P-317

**Context:** Close the plan. This phase finalizes the repo-stitcher project deliverables: run the full verification battery (all test suites P-253–P-267 + bench P-309 within baseline + SECURITY/audit P-265 + `stitch doctor --all` P-195 + compliance export `--verify` P-307), mark all phases complete in PROGRESS.md, deduplicate the known duplicate `P-055` header in PHASES_DETAILED.md (the file currently holds 320 headers while MASTER_PLAN defines 319 unique phases), regenerate/diff ROADMAP (P-312), and stash a clean v1.0.0 release snapshot per the checklist (P-313).

**Files to Create/Modify:**
- `project-plans/PROGRESS.md` (modify — mark all complete)
- `project-plans/PHASES_DETAILED.md` (modify — dedupe `P-055`)
- `docs/ROADMAP.md` (regenerate via P-312 generator)
- Release snapshot (P-262/263) output

**Implementation Steps:**
1. **Dedupe P-055**: locate the duplicate `### P-055` header block, merge/keep the canonical (most complete) body, and re-run `check_phase_detail.ps1` to confirm the file reports exactly **319 unique phases** (fix the header-count drift from 320 after confirming which P-055 is canonical).
2. Full battery: run all suites (P-253–P-267), `bench --ci` (P-309), SECURITY/git-leaks scan (P-265), `stitch doctor --all` (P-195), and `stitch compliance-export --verify` (P-307) — all must pass.
3. Mark every phase done in PROGRESS.md (batches 5–25); append final status block (319/319 unique phases elaborated, 9/9 each).
4. Regenerate `docs/ROADMAP.md` via the P-312 generator + `--check` for drift; commit the diff.
5. Produce the v1.0.0 release snapshot (npm package P-263 + container P-262 + extension P-300) per checklist P-313; run the checklist item commands to prove readiness.
6. Append the retrospective (P-314) "Post-1.0" link; final `git log` (P-282) + tag v1.0.0 (P-263).

**Required MCPs/Connectors:** CI (P-260) full battery; package registries (P-262/263).

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] All suites + bench baseline (P-309) + SECURITY (P-265) + doctor (P-195) + compliance `--verify` (P-307) pass
- [ ] `P-055` duplicate resolved; PHASES_DETAILED reports exactly 319 unique phases (verified by checker)
- [ ] PROGRESS.md marks 319/319 complete + final status block
- [ ] ROADMAP (P-312) regenerated + `--check` clean
- [ ] v1.0.0 release snapshot + checklist (P-313) runnable gates pass; CHANGELOG/tag (P-282/263)
- [ ] Retrospective "Post-1.0" link present (P-314)

**Tests Required:** Full CI battery + `check_phase_detail.ps1` (319 unique, 9/9) + `bench --ci` + `compliance-export --verify`.

**Dependencies:** P-317. All prior phases.

**Handoff Notes:** Project complete. Hand off: verify 319/319 unique phases at 9/9, a passing full battery, a clean v1.0.0 snapshot, and a deduped phase file. This is the point where PROGRESS.md should be synced and the repository tagged. Recommend absorbing P-314 recommendations before starting v1.x.

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
### P-321: Eval Harness - Source 20 Repo Pairs

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-320

**Context:**
Curate 20 diverse repository pairs (5 per ecosystem: JavaScript/TypeScript, Python, Go, Rust) from real public repositories. Each pair represents a valid merge scenario with varying difficulty: from simple utility merges to cross-cutting service extractions. Pairs must have compatible licenses (per P-127 policy), pinned commit SHAs (P-322), and documented expected outcomes in a per-pair README. These become the benchmark corpus (P-321) against which all agent improvements are measured.

**Files to Create/Modify:**
- `eval/corpus/README.md`
- `eval/corpus/pairs.json`
- `eval/corpus/pair-*/README.md`
- `eval/corpus/pair-*/repo-a-url.txt`
- `eval/corpus/pair-*/repo-b-url.txt`
- `eval/corpus/pair-*/expected-outcome.md`

**Implementation Steps:**
1. Select 5 real-world repo pairs per ecosystem (JS/TS, Python, Go, Rust) with permissive licenses
2. For each pair, record repo URLs, pinned commit SHAs, and the subdirectory paths to extract
3. Write per-pair README documenting the merge intent, expected conflicts, and success criteria
4. Generate eval/corpus/pairs.json manifest with all pair metadata (schema per P-320)
5. Verify each pair is clonable and the selected paths exist at the pinned SHAs
6. Run license check (P-127) on all repos to ensure policy compliance
7. Commit corpus to repo under eval/corpus/ with git-lfs for any large fixtures if needed

**Required MCPs/Connectors:** GitHub API (for repo metadata), local git

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] 20 repo pairs committed (5 per ecosystem: JS/TS, Python, Go, Rust)
- [ ] Each pair has pinned SHAs and documented expected outcome
- [ ] Pairs pass license policy check (P-127)
- [ ] pairs.json validates against corpus schema (P-320)

**Tests Required:**
- eval/test_corpus.py::test_pair_count - asserts 20 pairs
- eval/test_corpus.py::test_per_ecosystem_balance - 5 per ecosystem
- eval/test_corpus.py::test_sha_pinned - all SHAs are 40-char hex
- eval/test_corpus.py::test_license_compliant - all repos pass policy

**Dependencies:** P-320 (corpus schema), P-118/P-127 (license scan), P-103 (ecosystem detect)

**Handoff Notes:** Next: P-322 pins fixture SHAs for reproducibility.

---

### P-322: Eval Harness - Pin Fixture SHAs

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-321

**Context:**
Lock every corpus pair to exact commit SHAs so re-running the evaluation produces identical inputs regardless of upstream changes. This ensures reproducibility of P-327 baseline and all future regression runs. The pinning is recorded in pairs.json and verified by the harness runner (P-323).

**Files to Create/Modify:**
- `eval/corpus/pairs.json (updated with verified SHAs)`
- `eval/scripts/verify_shas.py`

**Implementation Steps:**
1. For each of the 20 pairs, fetch the current HEAD SHA of both repos at the pinned commit
2. Update pairs.json with the verified repo_a_sha and repo_b_sha fields
3. Create eval/scripts/verify_shas.py that validates all SHAs still resolve on remote
4. Add a CI step (P-328) that runs SHA verification on schedule to detect upstream drift
5. Document the re-pinning procedure in eval/corpus/README.md for when upstreams advance

**Required MCPs/Connectors:** GitHub API (for SHA verification)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] All 20 pairs have verified 40-char commit SHAs in pairs.json
- [ ] verify_shas.py exits 0 when all SHAs resolve, non-zero on drift
- [ ] CI can run verification without authentication (public repos)

**Tests Required:**
- eval/test_shas.py::test_all_shas_verified
- eval/test_shas.py::test_drift_detection

**Dependencies:** P-321 (corpus pairs), P-323 (harness runner uses pins)

**Handoff Notes:** Next: P-323 builds the harness runner that consumes pinned SHAs.

---

### P-323: Eval Harness - Harness Runner

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-322

**Context:**
Implement stitch eval run <corpus-path> -- a headless CLI command that executes the full agent loop (Epic 6/7) against every corpus pair without any CLI/Web UI involvement. The runner clones both repos, extracts paths via filter-repo (P-070), runs the AI agent tools (P-148-P-167), invokes the sandbox (P-168-P-180), and collects per-pair results as JSON. This is the automation backbone for P-327 baseline and P-328 CI gate.

**Files to Create/Modify:**
- `packages/cli/src/commands/eval.ts`
- `packages/core/src/eval/runner.ts`
- `packages/core/src/eval/types.ts`

**Implementation Steps:**
1. Define EvalConfig, EvalPair, EvalResult types in eval/types.ts (Zod schemas)
2. Implement EvalRunner.run(corpusPath, options) orchestrating: clone -> extract -> agent loop -> sandbox -> collect
3. Add stitch eval run CLI command in cli/commands/eval.ts with flags: --corpus, --parallel, --output-dir
4. Wire the runner to reuse existing core modules: git (P-069-P-072), agent (P-148-P-167), sandbox (P-168-P-180)
5. Emit per-pair EvalResult JSON to --output-dir with: pair_id, build_pass, rubric_score, resolve_rate, tokens, cost, duration
6. Support --parallel N to run multiple pairs concurrently (bounded by P-031 p-limit)
7. Add timeout/heartbeat per pair (P-174) and graceful cancellation on SIGINT

**Required MCPs/Connectors:** GitHub API, Docker (sandbox), OpenRouter/Anthropic/Ollama (AI providers)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] stitch eval run eval/corpus executes all 20 pairs headless
- [ ] Per-pair result JSON written with all required fields
- [ ] --parallel N respects concurrency bound (P-031)
- [ ] Runner reuses existing core modules without duplication

**Tests Required:**
- core/test_eval_runner.py::test_single_pair
- core/test_eval_runner.py::test_parallel_execution
- core/test_eval_runner.py::test_result_schema_valid
- cli/test_eval_cmd.py::test_cli_invocation

**Dependencies:** P-322 (pinned SHAs), P-070 (extract), P-148-P-167 (agent tools), P-168-P-180 (sandbox)

**Handoff Notes:** Next: P-324 adds build-pass scoring via sandbox reuse.

---

### P-324: Eval Harness - Build-Pass Scoring

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-323

**Context:**
Reuse the Epic 8 sandbox runner (P-168-P-180) to score binary build/test pass for each corpus pair. After the agent loop produces a merged child repo, the harness invokes the sandbox (local Docker or GH Actions fallback P-178) to run the ecosystem-appropriate build and test commands. The build-pass boolean (plus logs/artifacts P-173) is recorded in the per-pair EvalResult. This must match a manual docker run on at least 3 spot-checked pairs.

**Files to Create/Modify:**
- `packages/core/src/eval/scoring.ts`
- `packages/core/src/sandbox/runner.ts (reuse)`

**Implementation Steps:**
1. Extend EvalResult with build_pass: boolean, build_logs: string[], test_logs: string[]
2. In EvalRunner, after agent loop completes, invoke SandboxRunner.run(childRepoPath, ecosystem)
3. Map ecosystem (P-103) to sandbox image (P-169) and build/test commands
4. Capture sandbox output: exit code -> build_pass, stdout/stderr -> logs, artifacts -> output dir
5. Validate against 3 manually spot-checked pairs: harness build_pass == manual docker run result
6. Record build duration and resource usage for cost correlation (P-330)

**Required MCPs/Connectors:** Docker (local), GitHub Actions (fallback P-178)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Harness records build_pass per pair from sandbox run
- [ ] Spot-check: 3/3 pairs match manual docker run result
- [ ] Logs and artifacts saved to output dir (P-173)

**Tests Required:**
- core/test_scoring.py::test_build_pass_recorded
- core/test_scoring.py::test_spot_check_matches

**Dependencies:** P-323 (harness runner), P-168-P-180 (sandbox), P-103 (ecosystem detect), P-169 (images)

**Handoff Notes:** Next: P-325 defines human rubric for semantic correctness.

---

### P-325: Eval Harness - Human Rubric Schema

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-324

**Context:**
Define a SemanticRubric Zod schema for human evaluation of merge quality beyond build-pass. The rubric scores 1-5 on: (1) wiring correctness -- does the merged code correctly connect A's exports to B's imports and vice versa; (2) unnecessary/unrelated changes -- did the agent make gratuitous edits; (3) respects existing code patterns -- style, naming, architecture consistency. A notes field captures qualitative observations. Schema is reviewed by both owners and trialed on 3 pairs before baseline run.

**Files to Create/Modify:**
- `packages/core/src/eval/rubric.ts`
- `eval/rubric/README.md`

**Implementation Steps:**
1. Define SemanticRubric Zod schema with fields: wiring_correctness (1-5), unnecessary_changes (1-5), respects_patterns (1-5), notes (string)
2. Write eval/rubric/README.md with scoring guidelines and examples for each level
3. Create a trial scoring worksheet (Google Sheet / local JSON) for both owners to independently score 3 pairs
4. Validate inter-rater reliability on trial pairs; adjust rubric if Cohen's kappa < 0.6
5. Freeze rubric schema for P-326 rater tool and P-327 baseline

**Required MCPs/Connectors:** None (local schema)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] SemanticRubric Zod schema defined and exported
- [ ] Rubric guidelines doc with examples for each 1-5 level
- [ ] Both owners reviewed and approved rubric
- [ ] Trial on 3 pairs yields inter-rater kappa >= 0.6

**Tests Required:**
- core/test_rubric.py::test_schema_valid
- core/test_rubric.py::test_trial_kappa

**Dependencies:** P-324 (build-pass exists), P-326 (rater tool consumes schema)

**Handoff Notes:** Next: P-326 builds the rater review tool.

---

### P-326: Eval Harness - Rater Review Tool

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-325

**Context:**
Build a lightweight CLI (and optional web) tool that presents the diff for a corpus pair alongside the SemanticRubric checklist, allowing a rater to score each dimension and save the human score to the pair's EvalResult. Target: both owners can independently score the same pair in under 10 minutes. The tool reads the harness output diff, shows it side-by-side with the rubric, and writes human_score + human_notes back to the result JSON.

**Files to Create/Modify:**
- `packages/cli/src/commands/eval_rate.ts`
- `packages/web/src/pages/EvalRate.tsx (optional)`

**Implementation Steps:**
1. Implement stitch eval rate <pair-id> --result-dir CLI: loads diff + result JSON, renders rubric prompts
2. Add interactive prompts for each rubric dimension (1-5) + notes field
3. Save human score to result.human_score (object matching SemanticRubric) and result.human_rater
4. (Optional) Build web page EvalRate.tsx with same functionality for browser-based rating
5. Validate: both owners score same pair independently in <10 min, scores persisted correctly

**Required MCPs/Connectors:** None (local diff + JSON)

**Skills to Invoke:** ui-styling (if web page built).

**Acceptance Criteria:**
- [ ] stitch eval rate loads diff + rubric, captures 1-5 scores + notes
- [ ] Scores saved to result JSON with rater identity
- [ ] Both owners complete rating in <10 min per pair
- [ ] (Optional) Web page functional with same UX

**Tests Required:**
- cli/test_eval_rate.py::test_cli_captures_scores
- cli/test_eval_rate.py::test_json_persistence

**Dependencies:** P-325 (rubric schema), P-323/P-324 (harness + scoring produce diffs/results)

**Handoff Notes:** Next: P-327 runs the full baseline evaluation.

---

### P-327: Eval Harness - Baseline Run

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-326

**Context:**
Execute the full evaluation corpus (P-321-P-326) end-to-end to establish the first baseline numbers. This is the single most important checkpoint in the 366-phase plan. The run produces: (1) build-pass rate (% of 20 pairs where sandbox build+test passes), (2) human-rubric average (mean of 3 dimensions across both raters), (3) resolve rate (% pairs where build-pass AND rubric avg >= 4). All numbers documented in DECISIONS.md as the go/no-go gate for the rest of the roadmap -- particularly whether Epic 17 (Cross-Language Resolution) is warranted.

**Files to Create/Modify:**
- `DECISIONS.md (ADR updated with baseline results)`
- `eval/results/baseline-<timestamp>.json`

**Implementation Steps:**
1. Run stitch eval run eval/corpus --parallel 4 --output-dir eval/results/baseline-<ts>
2. Wait for all 20 pairs to complete (expected 30-60 min depending on sandbox)
3. Run stitch eval rate for each pair (both owners independently)
4. Compute composite metrics: build_pass_rate, rubric_avg, resolve_rate
5. Document baseline numbers + failure taxonomy (P-331 preliminary) in DECISIONS.md ADR-016 update
6. Make go/no-go decision: if import-resolution failures are top-2 category -> proceed to Epic 17; else skip

**Required MCPs/Connectors:** All: GitHub, Docker, AI providers, sandbox

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Full corpus run completes (all 20 pairs produce results)
- [ ] Both owners rate all pairs (40 ratings total)
- [ ] Baseline metrics computed and recorded in DECISIONS.md
- [ ] Go/no-go decision for Epic 17 documented with rationale

**Tests Required:**
- eval/test_baseline.py::test_all_pairs_completed
- eval/test_baseline.py::test_metrics_documented

**Dependencies:** P-321-P-326 (full harness stack)

**Handoff Notes:** Next: P-328 adds CI regression gate; P-331 formalizes failure taxonomy; Epic 17 decision.

---

### P-328: Eval Harness - CI Regression Gate

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-327

**Context:**
Add a CI job that blocks merge to main if the corpus composite score drops more than a configurable threshold vs. the last tagged baseline (P-327). The gate runs a lightweight subset of the corpus (e.g., 5 representative pairs) on every PR to keep CI time reasonable, while the full corpus runs on tag/release. An intentionally broken PR (e.g., degraded prompt) must be caught by this gate.

**Files to Create/Modify:**
- `.github/workflows/eval-regression.yml`
- `packages/core/src/eval/ci_gate.ts`

**Implementation Steps:**
1. Create GitHub Actions workflow eval-regression.yml triggered on PR to main
2. Job runs stitch eval run eval/corpus --subset representative --output-dir eval/results/pr-<run_id>
3. Implement ci_gate.ts that loads PR results + latest baseline, computes delta on composite score
4. Fail the job if composite_score < baseline_composite - threshold (threshold configurable, default 5%)
5. Add a test PR that deliberately degrades a prompt to verify gate catches it
6. Document threshold tuning procedure in eval/corpus/README.md

**Required MCPs/Connectors:** GitHub Actions, Docker (sandbox in CI)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] CI workflow runs eval subset on every PR to main
- [ ] Gate fails when composite score drops > threshold vs baseline
- [ ] Test PR with broken prompt is blocked
- [ ] Full corpus still runs on tag/release (separate workflow)

**Tests Required:**
- core/test_ci_gate.py::test_gate_passes_on_good
- core/test_ci_gate.py::test_gate_fails_on_regression

**Dependencies:** P-327 (baseline exists), P-323 (harness runner), P-324 (scoring)

**Handoff Notes:** Next: P-329 adds per-ecosystem breakdown reporting.

---

### P-329: Eval Harness - Per-Ecosystem Breakdown

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-328

**Context:**
Extend the harness reporting to split all metrics (build-pass, rubric, resolve rate, tokens, cost, duration) by ecosystem: JavaScript/TypeScript, Python, Go, Rust. This reveals whether one ecosystem is dragging the average down and directly informs Epic 17 investment decisions. Reports are emitted as JSON and rendered in the CI summary and EVAL.md (P-333).

**Files to Create/Modify:**
- `packages/core/src/eval/report.ts`
- `eval/report/ecosystem_breakdown.json`

**Implementation Steps:**
1. Extend EvalResult with ecosystem: 'js' | 'python' | 'go' | 'rust' (from P-103)
2. In report.ts, aggregate results by ecosystem: mean/median for each metric
3. Emit ecosystem_breakdown.json with per-ecosystem stats and pair-level detail
4. Add CI summary markdown table showing per-ecosystem build-pass / rubric / resolve rate
5. Update EVAL.md template (P-333) to include breakdown section

**Required MCPs/Connectors:** None (local aggregation)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Results include per-ecosystem aggregates for all metrics
- [ ] CI summary shows markdown table with 4 ecosystems
- [ ] EVAL.md template has breakdown section

**Tests Required:**
- core/test_report.py::test_ecosystem_aggregation
- core/test_report.py::test_ci_summary_table

**Dependencies:** P-328 (CI gate), P-103 (ecosystem detect), P-333 (EVAL.md)

**Handoff Notes:** Next: P-330 adds cost/token tracking per run.

---

### P-330: Eval Harness - Cost/Token Tracking Per Run

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-329

**Context:**
Log tokens consumed and estimated cost per corpus pair per run, correlating against success metrics. This reuses the AI provider audit log (P-145) and token/cost estimate (P-137) infrastructure. The report shows cost-per-successful-merge, not just cost-per-attempt, enabling budget planning (P-302) and model selection decisions. Data is emitted in EvalResult and aggregated in the ecosystem breakdown (P-329).

**Files to Create/Modify:**
- `packages/core/src/eval/cost.ts`
- `packages/core/src/ai/audit.ts (reuse P-145)`

**Implementation Steps:**
1. In EvalRunner, wrap each agent loop iteration with audit log capture (P-145): prompt tokens, completion tokens, model, provider
2. Compute cost using provider pricing (P-137): cost = prompt_tokens * input_price + completion_tokens * output_price
3. Add tokens_total, cost_usd fields to EvalResult per pair
4. Aggregate in report.ts (P-329): mean/median cost and tokens per ecosystem, per success/failure
5. Expose cost data in CI summary and EVAL.md; add alert if single run exceeds P-302 budget
6. Document pricing assumptions and update procedure in eval/cost/README.md

**Required MCPs/Connectors:** AI providers (OpenRouter, Anthropic, Ollama) for token counts

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Each EvalResult includes tokens_total and cost_usd
- [ ] Report shows cost-per-successful-merge by ecosystem
- [ ] CI summary includes cost metrics
- [ ] Budget alert triggers if run exceeds P-302 threshold

**Tests Required:**
- core/test_cost.py::test_tokens_recorded
- core/test_cost.py::test_cost_calculation
- core/test_cost.py::test_budget_alert

**Dependencies:** P-329 (reporting), P-137 (token estimate), P-145 (audit log), P-302 (cost budgets)

**Handoff Notes:** Next: P-331 formalizes failure taxonomy; P-332 corpus expansion process; P-333 publishes EVAL.md.

---
### P-320: Eval Harness - Corpus Schema

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-318

**Context:**
Define the `EvalPair` Zod schema that structures the evaluation corpus metadata. Each pair entry includes: repo A/B URLs, pinned commit SHAs, subdirectory paths to extract, expected ecosystem (js/python/go/rust), license metadata (SPDX IDs), and human-annotated expected outcome category. This schema validates the hand-written corpus manifest (`pairs.json`) and is consumed by the harness runner (P-323), SHA verifier (P-322), and reporting (P-329).

**Files to Create/Modify:**
- `packages/core/src/eval/schema.ts`
- `eval/corpus/schema.json`

**Implementation Steps:**
1. Define `EvalPair` Zod schema with fields: pair_id (string), repo_a_url, repo_b_url, repo_a_sha, repo_b_sha (40-char hex), extract_paths_a (string[]), extract_paths_b (string[]), ecosystem (enum: js|python|go|rust), license_a, license_b (SPDX IDs), expected_outcome (enum: clean|conflicts|license_block|semantic_drift)
2. Generate JSON Schema from Zod and save to `eval/corpus/schema.json` for external validation
3. Add a validation script `eval/scripts/validate_corpus.py` that loads `pairs.json` and validates against schema
4. Write a hand-written example pair in `eval/corpus/pair-example/` demonstrating all fields
5. Ensure schema is backwards-compatible for future corpus expansions (P-332)

**Required MCPs/Connectors:** None (local schema validation)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `EvalPair` Zod schema defined with all required fields
- [ ] JSON Schema emitted and saved to eval/corpus/schema.json
- [ ] Validation script exits 0 on valid pairs.json, non-zero with clear errors on invalid
- [ ] Example pair passes validation

**Tests Required:**
- core/test_eval_schema.py::test_schema_valid
- core/test_eval_schema.py::test_example_pair_validates
- core/test_eval_schema.py::test_invalid_rejected

**Dependencies:** P-318 (project finalize), used by P-321, P-322, P-323, P-329

**Handoff Notes:** Next: P-321 sources the 20 repo pairs using this schema.

---

### P-331: Eval Harness - Failure Taxonomy

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-327

**Context:**
Classify every failed pair from the baseline run (P-327) into a structured failure taxonomy. Categories: import-resolution (cross-file/module import failures), semver-conflict (dependency version clashes), license-block (policy rejection), loop-cap-exceeded (agent iteration limit), sandbox-timeout, semantic-wrong-but-builds (code compiles but logic incorrect). This taxonomy directly informs whether Epic 17 (Cross-Language Resolution) is warranted — if import-resolution is a top-2 category, invest; else defer.

**Files to Create/Modify:**
- `packages/core/src/eval/taxonomy.ts`
- `eval/taxonomy/failure_categories.json`
- `DECISIONS.md (updated with baseline taxonomy results)`

**Implementation Steps:**
1. Define `FailureCategory` enum with the 6 categories above + `unknown`
2. For each failed pair in P-327 baseline, assign primary and secondary failure categories based on logs, diffs, and rater notes
3. Produce `failure_categories.json` with pair_id, primary_category, secondary_category, confidence, notes
4. Compute category frequency distribution and add to DECISIONS.md baseline entry
5. Create a decision rule: if import-resolution >= 20% of failures OR top-2 category -> Epic 17 green; else Epic 17 deferred

**Required MCPs/Connectors:** None (local analysis of baseline artifacts)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] All 20 baseline pairs classified (pass pairs get 'none', fail pairs get category)
- [ ] Category frequencies computed and documented in DECISIONS.md
- [ ] Epic 17 go/no-go decision rule explicitly stated with data

**Tests Required:**
- core/test_taxonomy.py::test_all_pairs_classified
- core/test_taxonomy.py::test_decision_rule_applied

**Dependencies:** P-327 (baseline run complete), P-330 (cost data for correlation)

**Handoff Notes:** Next: P-332 defines corpus expansion process; P-333 publishes EVAL.md; Epic 17 decision made.

---

### P-332: Eval Harness - Corpus Expansion Process

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-331

**Context:**
Document a repeatable process for third-party contributors to add new repo pairs to the evaluation corpus. Includes: format requirements (schema from P-320), license check (P-127), minimum diversity rules (must cover a new ecosystem, difficulty tier, or failure mode not already represented), and the submission workflow (PR to `eval/corpus/` with automated validation). This ensures the corpus grows organically without diluting benchmark signal.

**Files to Create/Modify:**
- `eval/corpus/CONTRIBUTING.md`
- `eval/scripts/validate_contribution.py`
- `.github/workflows/eval-corpus-pr.yml`

**Implementation Steps:**
1. Write `eval/corpus/CONTRIBUTING.md` with: pair selection criteria, schema compliance, license verification steps, diversity rules (must add new ecosystem/difficulty/failure-mode coverage), PR template
2. Create `validate_contribution.py` that runs: schema validation (P-320), license check (P-127), clonability test, SHA pinning, and diversity check against existing corpus
3. Add GitHub Actions workflow that runs validation on every PR to `eval/corpus/`
4. Document maintainer review checklist: difficulty calibration, license confirm, diversity confirmation

**Required MCPs/Connectors:** GitHub API (for PR automation), GitHub Actions

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] CONTRIBUTING.md complete with all criteria and PR template
- [ ] Validation script catches schema/license/diversity violations
- [ ] CI workflow runs on corpus PRs and blocks invalid submissions
- [ ] A new contributor could add a pair by following the doc alone

**Tests Required:**
- eval/test_expansion.py::test_valid_contribution_passes
- eval/test_expansion.py::test_invalid_rejected
- eval/test_expansion.py::test_diversity_check

**Dependencies:** P-320 (schema), P-321 (existing corpus), P-331 (taxonomy informs diversity rules)

**Handoff Notes:** Next: P-333 publishes the public EVAL.md methodology document.

---

### P-333: Eval Harness - Publish EVAL.md

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-332

**Context:**
Produce a public-facing methodology document `EVAL.md` that explains: what the corpus measures, current baseline scores (from P-327), how to reproduce the evaluation locally, the rubric definition (P-325), failure taxonomy (P-331), and how to interpret results. This becomes the reference for users, contributors, and future model evaluations. Linked from README and updated on every tagged release.

**Files to Create/Modify:**
- `EVAL.md`
- `docs/eval-methodology.md (alias)`

**Implementation Steps:**
1. Write EVAL.md with sections: Overview, Corpus Composition (20 pairs table), Evaluation Methodology (harness, sandbox, human rubric), Baseline Results (build-pass, rubric, resolve rate, cost), Failure Taxonomy (P-331), Per-Ecosystem Breakdown (P-329), Cost Analysis (P-330), How to Run Locally, How to Contribute Pairs (P-332), Versioning & Updates
2. Include current baseline numbers from P-327 with timestamp and git commit
3. Add EVAL.md to repo root and link from README.md
4. Set up a release workflow step that regenerates EVAL.md from latest CI results on tag push

**Required MCPs/Connectors:** None (documentation)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] EVAL.md published at repo root with all required sections
- [ ] Baseline numbers match P-327 DECISIONS.md entry
- [ ] Linked from README.md
- [ ] Release workflow updates it automatically on tag

**Tests Required:**
- docs/test_eval_md.py::test_sections_present
- docs/test_eval_md.py::test_baseline_numbers_match

**Dependencies:** P-332 (expansion process), P-327 (baseline), P-329 (breakdown), P-330 (cost), P-331 (taxonomy)

**Handoff Notes:** Epic 16 (Eval Harness) complete. Epic 17 (Cross-Language Resolution) decision made via P-331.

---

### P-334: Cross-Language Resolution - Research Spike: LSP Viability

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-331

**Context:**
CONDITIONAL PHASE: Only execute if P-331 failure taxonomy shows import-resolution failures as a top-2 category. Time-boxed (2 days) evaluation of LSP servers: tsserver (TS/JS), pyright (Python), gopls (Go), rust-analyzer (Rust). Assess startup cost, JSON-RPC stability when scripted, licensing (all are MIT/Apache-2 compatible), and accuracy on fixture repos. Findings written as an ADR in DECISIONS.md with go/no-go per language. If any language is no-go, fallback to tree-sitter heuristics (P-020/P-021/P-022).

**Files to Create/Modify:**
- `DECISIONS.md (ADR for LSP spike results)`
- `eval/lsp_spike/findings.md`

**Implementation Steps:**
1. Set up test harness launching each LSP server via stdio and sending initialize + textDocument/definition requests
2. Measure cold-start latency, request latency, memory footprint for each LSP on sample repos
3. Test JSON-RPC stability: send 100 sequential requests, measure error rate and recovery
4. Verify licensing: all four LSPs are MIT/Apache-2, no GPL contamination risk
5. Run accuracy test: compare LSP go-to-definition results against ground truth on fixture repos
6. Document findings per language in DECISIONS.md ADR with go/no-go recommendation

**Required MCPs/Connectors:** Local LSP binaries (tsserver, pyright, gopls, rust-analyzer)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Spike completed within 2 days
- [ ] Per-language findings documented with latency, stability, accuracy metrics
- [ ] ADR written with clear go/no-go per language
- [ ] If any no-go, fallback plan (tree-sitter) documented

**Tests Required:**
- eval/test_lsp_spike.py::test_latency_measured
- eval/test_lsp_spike.py::test_stability_100_requests

**Dependencies:** P-331 (taxonomy decision gate), P-020/P-021/P-022 (tree-sitter fallback)

**Handoff Notes:** Next: P-335 builds generic LSP client if spike is go.

---

### P-335: Cross-Language Resolution - Generic LSP Client

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-334

**Context:**
Build a reusable JSON-RPC client for Language Server Protocol over stdio. Provides request/response correlation, timeout handling, notification handling, and graceful shutdown. This is the foundation for all per-language resolvers (P-336–P-339). The client is language-agnostic and tested against a real tsserver instance.

**Files to Create/Modify:**
- `packages/core/src/resolve/lsp-client.ts`
- `packages/core/src/resolve/lsp-client.test.ts`

**Implementation Steps:**
1. Implement `LSPClient` class: spawn LSP process via stdio, send initialize, handle capabilities negotiation
2. Add `request(method, params)` with correlation IDs, promise-based response handling, configurable timeout
3. Handle server notifications (window/logMessage, telemetry/event) via callback registry
4. Implement graceful shutdown: send shutdown request, wait for exit, kill on timeout
5. Add connection health check and auto-reconnect on pipe break
6. Test against real tsserver: initialize + textDocument/definition on a sample TS file

**Required MCPs/Connectors:** Local LSP binaries (tsserver for testing)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] `LSPClient` initializes, sends request, receives response within timeout
- [ ] Handles multiple concurrent requests with correct correlation
- [ ] Graceful shutdown cleans up process
- [ ] Test passes against real tsserver

**Tests Required:**
- core/test_lsp_client.py::test_initialize
- core/test_lsp_client.py::test_definition_request
- core/test_lsp_client.py::test_concurrent_requests
- core/test_lsp_client.py::test_graceful_shutdown

**Dependencies:** P-334 (spike go decision), P-336–P-339 (per-language resolvers)

**Handoff Notes:** Next: P-336 implements TS/JS resolver using this client.

---

### P-336: Cross-Language Resolution - TS/JS Resolver

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-335

**Context:**
Implement TypeScript/JavaScript import resolution using tsserver (primary) with fallback to TypeScript compiler API directly (lighter weight, no separate process). Resolves a known cross-file import chain in a fixture repo with 100% accuracy. The resolver implements the `DependencyResolver` interface (P-341) and tags each resolved edge with confidence: `lsp-high` or `heuristic-medium`.

**Files to Create/Modify:**
- `packages/core/src/resolve/ts-resolver.ts`
- `packages/core/src/resolve/types.ts (add DependencyResolver interface)`
- `packages/core/src/resolve/ts-resolver.test.ts`

**Implementation Steps:**
1. Define `DependencyResolver` interface in types.ts: resolve(filePath, importSpec) -> Result<ResolvedImport[]>
2. Implement `TSResolver` using LSPClient (P-335) to call tsserver textDocument/definition
3. Add fallback: use `typescript` compiler API `getDefinitionAtPosition` for simpler cases
4. Normalize results to `ResolvedImport { sourceFile, targetFile, confidence: 'lsp-high' | 'heuristic-medium' }`
5. Test on fixture repo with: relative imports, alias imports (paths), node_modules, re-exports
6. Verify 100% accuracy on ground-truth fixture

**Required MCPs/Connectors:** Local tsserver, typescript compiler API

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] TSResolver implements DependencyResolver interface
- [ ] Resolves cross-file import chain in fixture with 100% accuracy
- [ ] Fallback to compiler API works when tsserver unavailable
- [ ] Edges tagged with confidence (lsp-high / heuristic-medium)

**Tests Required:**
- core/test_ts_resolver.py::test_relative_imports
- core/test_ts_resolver.py::test_alias_imports
- core/test_ts_resolver.py::test_node_modules
- core/test_ts_resolver.py::test_fallback_accuracy

**Dependencies:** P-335 (LSP client), P-341 (interface), P-342 (confidence tagging)

**Handoff Notes:** Next: P-337 Python resolver.

---

### P-337: Cross-Language Resolution - Python Resolver

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-336

**Context:**
Implement Python import resolution using pyright LSP (primary) with jedi fallback. Same accuracy bar as TS resolver: resolves a known cross-file import chain in a Python fixture repo with 100% accuracy. Handles: relative imports, absolute package imports, namespace packages, conditional imports.

**Files to Create/Modify:**
- `packages/core/src/resolve/python-resolver.ts`
- `packages/core/src/resolve/python-resolver.test.ts`

**Implementation Steps:**
1. Implement `PythonResolver` using LSPClient with pyright (pip install pyright)
2. Add fallback: use `jedi` library for Script.get_definitions() when pyright unavailable
3. Handle Python-specifics: sys.path, virtualenv detection, pyproject.toml [tool.pyright] config
4. Normalize to same `ResolvedImport` with confidence tagging
5. Test on fixture with: relative/absolute imports, submodules, conditional imports (TYPE_CHECKING)
6. Verify 100% accuracy on ground-truth fixture

**Required MCPs/Connectors:** Local pyright, jedi (Python packages)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] PythonResolver implements DependencyResolver
- [ ] Resolves fixture import chain with 100% accuracy
- [ ] Fallback to jedi works when pyright unavailable
- [ ] Confidence tagging consistent with TS resolver

**Tests Required:**
- core/test_python_resolver.py::test_relative_imports
- core/test_python_resolver.py::test_absolute_imports
- core/test_python_resolver.py::test_conditional_imports
- core/test_python_resolver.py::test_fallback_accuracy

**Dependencies:** P-335 (LSP client), P-336 (pattern), P-342 (confidence tagging)

**Handoff Notes:** Next: P-338 Go resolver.

---

### P-338: Cross-Language Resolution - Go Resolver

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-337

**Context:**
Implement Go import resolution using gopls LSP. Same accuracy bar: resolves a known cross-file import chain in a Go fixture repo with 100% accuracy. Handles: module-relative imports, vendor directory, go.work multi-module workspaces, build tags.

**Files to Create/Modify:**
- `packages/core/src/resolve/go-resolver.ts`
- `packages/core/src/resolve/go-resolver.test.ts`

**Implementation Steps:**
1. Implement `GoResolver` using LSPClient with gopls (go install golang.org/x/tools/gopls@latest)
2. Handle Go-specifics: module path from go.mod, GOPATH/vendor, go.work workspace, build tags
3. Normalize to `ResolvedImport` with confidence tagging (gopls = lsp-high)
4. Test on fixture with: module imports, vendor, multi-module workspace, build constraints
5. Verify 100% accuracy on ground-truth fixture

**Required MCPs/Connectors:** Local gopls binary

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] GoResolver implements DependencyResolver
- [ ] Resolves fixture import chain with 100% accuracy
- [ ] Handles go.work and vendor correctly
- [ ] Confidence tagging consistent

**Tests Required:**
- core/test_go_resolver.py::test_module_imports
- core/test_go_resolver.py::test_vendor
- core/test_go_resolver.py::test_workspace

**Dependencies:** P-335 (LSP client), P-337 (pattern), P-342 (confidence tagging)

**Handoff Notes:** Next: P-339 Rust resolver (best-effort).

---

### P-339: Cross-Language Resolution - Rust Resolver (Best-Effort)

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-338

**Context:**
Implement Rust import resolution using rust-analyzer LSP. Flagged explicitly as lower-confidence/optional given rust-analyzer's heavier startup cost and complexity of Rust's module system (mod.rs, inline mods, macros, cfg flags). Accuracy bar may be relaxed; documented as best-effort in ARCHITECTURE.md. If startup cost is prohibitive, fallback to tree-sitter heuristic (P-020) is primary.

**Files to Create/Modify:**
- `packages/core/src/resolve/rust-resolver.ts`
- `packages/core/src/resolve/rust-resolver.test.ts`

**Implementation Steps:**
1. Implement `RustResolver` using LSPClient with rust-analyzer (rustup component add rust-analyzer)
2. Handle Rust-specifics: crate root detection, mod.rs/inline modules, macros, cfg attributes, edition
3. Normalize to `ResolvedImport` with confidence tagging (rust-analyzer = lsp-high if working, else heuristic-medium)
4. Test on fixture with: crate imports, mod tree, macros, conditional compilation
5. Document accuracy relaxation and fallback priority in ARCHITECTURE.md

**Required MCPs/Connectors:** Local rust-analyzer binary

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] RustResolver implements DependencyResolver
- [ ] Resolves basic crate imports in fixture
- [ ] Fallback to tree-sitter documented as primary for complex cases
- [ ] ARCHITECTURE.md updated with best-effort note

**Tests Required:**
- core/test_rust_resolver.py::test_basic_imports
- core/test_rust_resolver.py::test_fallback_documented

**Dependencies:** P-335 (LSP client), P-338 (pattern), P-340 (heuristic fallback), P-020 (tree-sitter)

**Handoff Notes:** Next: P-340 heuristic fallback; P-341 unified interface; P-342 confidence tagging.

---
### P-340: Cross-Language Resolution - Heuristic Fallback

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-339

**Context:**
Implement the fallback path when LSP is unavailable, times out, or returns errors. The fallback uses the existing tree-sitter based heuristics (P-020/P-021/P-022) to resolve imports via AST traversal and pattern matching. The resolver must degrade gracefully: no hard failure when LSP is absent, and edges resolved via fallback are tagged with `heuristic-medium` confidence (P-342). This ensures the agent loop (Epic 7) continues functioning even in environments without LSP binaries.

**Files to Create/Modify:**
- `packages/core/src/resolve/heuristic-fallback.ts`
- `packages/core/src/resolve/heuristic-fallback.test.ts`

**Implementation Steps:**
1. Implement `HeuristicResolver` that uses tree-sitter queries (P-020) to find import statements and resolve them via filesystem traversal and pattern matching
2. Handle common patterns per language: JS/TS (relative, aliases, node_modules), Python (relative, absolute), Go (module path), Rust (crate::module)
3. Return `ResolvedImport` with confidence `heuristic-medium` for all fallback-resolved edges
4. Integrate into the per-language resolvers (P-336-P-339) as the `onLSPFailure` handler
5. Add configuration to disable LSP entirely and force heuristic-only mode (for CI/containers without LSP)

**Required MCPs/Connectors:** None (local tree-sitter, filesystem)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] HeuristicResolver resolves imports when LSP unavailable
- [ ] All edges tagged heuristic-medium confidence
- [ ] Config flag forces heuristic-only mode
- [ ] No crash when LSP binary missing

**Tests Required:**
- core/test_heuristic_fallback.py::test_js_resolution
- core/test_heuristic_fallback.py::test_python_resolution
- core/test_heuristic_fallback.py::test_go_resolution
- core/test_heuristic_fallback.py::test_rust_resolution
- core/test_heuristic_fallback.py::test_lsp_failure_triggers_fallback

**Dependencies:** P-339 (per-language resolvers), P-020/P-021/P-022 (tree-sitter), P-342 (confidence tagging)

**Handoff Notes:** Next: P-341 defines unified resolver interface.

---

### P-341: Cross-Language Resolution - Unified Resolver Interface

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-340

**Context:**
Define the `DependencyResolver` contract that all per-language resolvers (P-336-P-340) implement. This interface allows the agent tools (Epic 7, specifically `resolve_dependency_closure` P-149) to swap resolver implementations at runtime without code changes. The interface includes: `resolve(filePath, importSpec)`, `getCapabilities()`, `healthCheck()`, and `shutdown()`. A registry selects the appropriate resolver based on detected ecosystem (P-103).

**Files to Create/Modify:**
- `packages/core/src/resolve/types.ts (DependencyResolver interface)`
- `packages/core/src/resolve/registry.ts`

**Implementation Steps:**
1. Define `DependencyResolver` interface in types.ts with methods: resolve(), getCapabilities(), healthCheck(), shutdown()
2. Implement `ResolverRegistry` that maps ecosystem -> resolver instance (singleton per session)
3. Register all resolvers: TS (P-336), Python (P-337), Go (P-338), Rust (P-339), Heuristic (P-340)
4. Add `getResolver(ecosystem)` factory with fallback chain: LSP -> Heuristic -> None
5. Expose `registry.getCapabilities()` for diagnostics (which LSPs are available)
6. Ensure all resolvers implement the interface correctly via integration tests

**Required MCPs/Connectors:** None (local)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] DependencyResolver interface defined and exported
- [ ] ResolverRegistry selects correct resolver per ecosystem
- [ ] Fallback chain works: LSP -> Heuristic -> None
- [ ] All 5 resolvers pass interface compliance tests

**Tests Required:**
- core/test_resolver_registry.py::test_interface_compliance
- core/test_resolver_registry.py::test_ecosystem_selection
- core/test_resolver_registry.py::test_fallback_chain

**Dependencies:** P-340 (heuristic fallback), P-336-P-339 (per-language resolvers), P-103 (ecosystem detect)

**Handoff Notes:** Next: P-342 adds resolution confidence tagging.

---

### P-342: Cross-Language Resolution - Resolution Confidence Tagging

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-341

**Context:**
Every resolved import edge must carry a confidence tag: `lsp-high` (LSP returned a definition), `heuristic-medium` (tree-sitter fallback resolved it), or `unresolved` (no resolver succeeded). This metadata feeds directly into Epic 18's composite confidence score (P-349) and is surfaced in CREDITS.md (P-182) and the web UI provenance view (P-185). The tag is added by the unified registry (P-341) based on which resolver succeeded.

**Files to Create/Modify:**
- `packages/core/src/resolve/types.ts (add ConfidenceTag type)`
- `packages/core/src/resolve/registry.ts (tag injection)`

**Implementation Steps:**
1. Add `ConfidenceTag` type: 'lsp-high' | 'heuristic-medium' | 'unresolved'
2. Extend `ResolvedImport` to include `confidence: ConfidenceTag`
3. Modify `ResolverRegistry.resolve()` to inject tag based on which resolver returned a result
4. LSP resolvers (P-336-P-339) return `lsp-high`; Heuristic (P-340) returns `heuristic-medium`; no result -> `unresolved` with empty target
5. Add confidence distribution logging for debugging and Epic 18 consumption

**Required MCPs/Connectors:** None (local)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Every ResolvedImport has confidence tag
- [ ] Tags correctly assigned: LSP=high, Heuristic=medium, None=unresolved
- [ ] Confidence distribution logged per resolver run
- [ ] Epic 18 (P-349) can consume tags for composite scoring

**Tests Required:**
- core/test_confidence_tagging.py::test_lsp_tag
- core/test_confidence_tagging.py::test_heuristic_tag
- core/test_confidence_tagging.py::test_unresolved_tag

**Dependencies:** P-341 (registry), P-336-P-340 (resolvers), P-349 (composite scoring consumes tags)

**Handoff Notes:** Next: P-343 integrates into resolve_dependency_closure tool.

---

### P-343: Cross-Language Resolution - Integrate into resolve_dependency_closure

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-342

**Context:**
Replace/augment the existing `resolve_dependency_closure` tool implementation (P-149) with the new LSP-backed resolver stack. The tool now uses the unified registry (P-341) to resolve imports across all supported languages. Re-run the Epic 16 corpus (P-327) to verify the import-resolution failure category (P-331) shrinks measurably. This is the validation that Epic 17 investment paid off.

**Files to Create/Modify:**
- `packages/core/src/tools/resolve-dependency-closure.ts`
- `packages/core/src/tools/resolve-dependency-closure.test.ts`

**Implementation Steps:**
1. Update `resolve_dependency_closure` tool to use `ResolverRegistry` (P-341) instead of ad-hoc logic
2. Tool now accepts `ecosystem` parameter (from P-103) and delegates to appropriate resolver
3. Return value includes `resolved_edges[]` with confidence tags (P-342)
4. Re-run full Epic 16 corpus (P-327) and compare import-resolution failure rate before/after
5. Document improvement in DECISIONS.md: baseline vs post-Epic-17 import-resolution failure %
6. If improvement < 10% absolute, document why and consider whether further LSP investment warranted

**Required MCPs/Connectors:** All: LSP binaries, GitHub, Docker, AI providers

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] resolve_dependency_closure tool uses new resolver stack
- [ ] Returns resolved edges with confidence tags
- [ ] Epic 16 corpus re-run shows measurable reduction in import-resolution failures
- [ ] DECISIONS.md updated with before/after metrics

**Tests Required:**
- core/test_resolve_tool.py::test_uses_new_registry
- core/test_resolve_tool.py::test_corpus_improvement

**Dependencies:** P-342 (confidence tagging), P-149 (original tool), P-327 (corpus baseline), P-331 (taxonomy)

**Handoff Notes:** Next: P-344 adds LSP warm-server caching for performance.

---

### P-344: Cross-Language Resolution - LSP Warm-Server Caching

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-343

**Context:**
Avoid re-paying LSP startup cost per file by keeping a warm server per session/ecosystem. The `LSPClient` (P-335) is extended with a connection pool: one persistent process per ecosystem per agent session. Second+ resolution calls in the same session target <200ms latency. Implements idle timeout (configurable, default 5 min) and max concurrent requests per server.

**Files to Create/Modify:**
- `packages/core/src/resolve/lsp-client.ts (extend with pooling)`
- `packages/core/src/resolve/lsp-pool.ts`
- `packages/core/src/resolve/lsp-pool.test.ts`

**Implementation Steps:**
1. Implement `LSPPool` managing one `LSPClient` per ecosystem per session
2. Pool creates server on first `getClient(ecosystem)` call, reuses for subsequent calls
3. Add idle timeout: if no requests for 5 min, shutdown server (configurable via env)
4. Add max concurrent requests per server (default 10) with queue
5. Health check: periodic `textDocument/hover` ping, auto-reconnect on failure
6. Benchmark: cold start vs warm request latency; target <200ms warm

**Required MCPs/Connectors:** Local LSP binaries

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] LSPPool reuses servers across requests in same session
- [ ] Warm request latency <200ms (vs cold start 1-3s)
- [ ] Idle timeout shuts down unused servers
- [ ] Auto-reconnect on pipe failure

**Tests Required:**
- core/test_lsp_pool.py::test_reuse
- core/test_lsp_pool.py::test_warm_latency
- core/test_lsp_pool.py::test_idle_timeout
- core/test_lsp_pool.py::test_health_check

**Dependencies:** P-335 (LSP client), P-343 (tool integration)

**Handoff Notes:** Next: P-345 resolver accuracy tests (fixture-based).

---

### P-345: Cross-Language Resolution - Resolver Accuracy Tests

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-344

**Context:**
Comprehensive fixture-based tests for the entire resolver stack (P-335-P-344) per ecosystem. Each ecosystem has a fixture repo with known import graph ground truth. Tests verify: resolution accuracy >= 95% on ground truth, confidence tags correct, fallback behavior correct, performance targets met. Coverage thresholds per AGENTS.md §3 met for `core/resolve/`.

**Files to Create/Modify:**
- `packages/core/src/resolve/__tests__/fixtures/`
- `packages/core/src/resolve/__tests__/accuracy.test.ts`
- `packages/core/test-utils/resolve-fixtures.ts`

**Implementation Steps:**
1. Create fixture repos per ecosystem (JS, Python, Go, Rust) with known import graphs: relative, aliases, node_modules/crates.io, re-exports, conditional imports
2. Write ground truth JSON per fixture: file -> import -> expected target file
3. Implement `resolve-fixtures.ts` helper to run resolvers against fixtures and compare to ground truth
4. Test accuracy threshold: >= 95% of ground truth edges resolved correctly
5. Verify confidence tags: LSP edges = lsp-high, fallback edges = heuristic-medium
6. Verify fallback: kill LSP mid-test, ensure heuristic takes over without crash
7. Verify performance: warm requests <200ms, cold <3s
8. Enforce coverage thresholds (AGENTS.md §3) for core/resolve/

**Required MCPs/Connectors:** Local LSP binaries, tree-sitter

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Fixture repos with ground truth for all 4 ecosystems
- [ ] Accuracy >= 95% on ground truth per ecosystem
- [ ] Confidence tags correct per resolver path
- [ ] Fallback behavior verified (LSP kill -> heuristic continues)
- [ ] Performance targets met
- [ ] Coverage thresholds met for core/resolve/

**Tests Required:**
- core/test_resolver_accuracy.py::test_js_accuracy
- core/test_resolver_accuracy.py::test_python_accuracy
- core/test_resolver_accuracy.py::test_go_accuracy
- core/test_resolver_accuracy.py::test_rust_accuracy
- core/test_resolver_accuracy.py::test_fallback_behavior
- core/test_resolver_accuracy.py::test_performance

**Dependencies:** P-344 (warm caching), P-340 (heuristic), P-336-P-339 (per-language resolvers)

**Handoff Notes:** Epic 17 (Cross-Language Resolution) complete. Next: Epic 18 (Confidence Scoring) P-346.

---

### P-346: Confidence Scoring - SemanticConfidence Schema

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-345

**Context:**
Define the `SemanticConfidence` Zod schema that represents the composite confidence score (0-100) for a proposed component or merge decision. Fields: `composite_score` (0-100), `components` object with per-factor scores (sandbox_pass, self_confidence, resolver_confidence, license_risk, test_coverage), `rationale` (string explaining the score), `flags` (array of warning strings), and `contributing_factors` (key-value map of raw inputs). Schema reviewed against P-325 rubric for compatibility.

**Files to Create/Modify:**
- `packages/core/src/confidence/schema.ts`
- `packages/core/src/confidence/schema.test.ts`

**Implementation Steps:**
1. Define `SemanticConfidence` Zod schema with all fields above
2. Add `ConfidenceComponent` type for each factor: sandbox_pass (0/1), self_confidence (0-100), resolver_confidence (0-100 from P-342 tags), license_risk (0-100 from P-127), test_coverage (0-100)
3. Define weighting formula: composite = w1*sandbox + w2*self + w3*resolver + w4*license + w5*tests (weights configurable, defaults documented in DECISIONS.md)
4. Add validation: composite_score = round(weighted_sum), clamp 0-100
5. Export schema and TypeScript types for CLI/Web consumption

**Required MCPs/Connectors:** None (local schema)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] SemanticConfidence Zod schema defined with all fields
- [ ] Weighting formula documented with default weights
- [ ] Schema validates example scores correctly
- [ ] Compatible with P-325 rubric dimensions

**Tests Required:**
- core/test_confidence_schema.py::test_schema_valid
- core/test_confidence_schema.py::test_weighting_formula
- core/test_confidence_schema.py::test_clamp_bounds

**Dependencies:** P-345 (resolver stack complete), P-325 (rubric), P-342 (resolver confidence), P-127 (license), P-176 (sandbox)

**Handoff Notes:** Next: P-347 designs self-critique prompt for agent.

---

### P-347: Confidence Scoring - Self-Critique Prompt Design

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-346

**Context:**
Design a second-pass prompt where the agent re-reads its own proposed diff (from `propose_component` P-154) and rates its confidence on the same dimensions as the human rubric (P-325): wiring correctness, unnecessary changes, pattern respect. Output is structured JSON matching the `SemanticConfidence` components (excluding sandbox/license which are external). Manually inspect 10 self-critiques for plausibility before automating.

**Files to Create/Modify:**
- `packages/core/src/confidence/self-critique.ts`
- `packages/core/src/ai/prompts/self-critique.txt`

**Implementation Steps:**
1. Write self-critique prompt template: input = proposed diff + context; output = JSON with self_confidence (0-100), wiring_self_score (1-5), unnecessary_changes_self_score (1-5), patterns_self_score (1-5), self_rationale, self_flags
2. Implement `SelfCritique` tool call that invokes the AI provider (P-131) with this prompt
3. Parse and validate output against `SemanticConfidence` components schema (P-346)
4. Manually run on 10 historical proposals: compare agent self-scores to human rubric scores (P-326)
5. Adjust prompt until self-scores correlate plausibly (not necessarily high, but directionally correct)
6. Document prompt version and calibration notes in `docs/confidence-prompt.md`

**Required MCPs/Connectors:** AI providers (OpenRouter/Anthropic/Ollama via P-131)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Self-critique prompt produces valid JSON matching schema
- [ ] 10 manual inspections show plausible correlation with human rubric
- [ ] Prompt version documented
- [ ] Tool integrates with AI provider loop (P-140)

**Tests Required:**
- core/test_self_critique.py::test_prompt_output_valid
- core/test_self_critique.py::test_manual_correlation

**Dependencies:** P-346 (schema), P-131/P-140 (AI provider + tool loop), P-154 (propose_component), P-325 (rubric)

**Handoff Notes:** Next: P-348 builds assess_confidence tool.

---

### P-348: Confidence Scoring - Tool assess_confidence

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-347

**Context:**
Build the `assess_confidence` structured-output tool that is invoked automatically after every `propose_component` (P-154) call. It runs: (1) self-critique (P-347), (2) fetches sandbox result (P-176), (3) fetches resolver confidence (P-342), (4) fetches license risk (P-127), (5) fetches test coverage (P-259), then computes composite `SemanticConfidence` (P-346). Runs on 100% of proposals in Epic 16 corpus without manual triggering.

**Files to Create/Modify:**
- `packages/core/src/tools/assess-confidence.ts`
- `packages/core/src/tools/assess-confidence.test.ts`

**Implementation Steps:**
1. Implement `assessConfidence(proposalId)` tool that orchestrates all confidence factors
2. Call self-critique tool (P-347) -> self_confidence component
3. Query sandbox result for proposal -> sandbox_pass component (0/1)
4. Query resolver registry for proposal's imports -> resolver_confidence component (from P-342 tags)
5. Query license scan for proposal's files -> license_risk component (from P-127)
6. Query test coverage for proposal's files -> test_coverage component (from P-259)
7. Compute composite via `SemanticConfidence` schema (P-346) weighting formula
8. Persist result to proposal metadata and job event bus (P-241)

**Required MCPs/Connectors:** AI providers, Sandbox (P-176), Resolver (P-341), License (P-127), Test infra (P-259)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] assess_confidence tool runs automatically after every propose_component
- [ ] All 5 components populated and composite computed
- [ ] Result persisted to proposal + event bus
- [ ] Runs on 100% of Epic 16 corpus proposals without manual trigger

**Tests Required:**
- core/test_assess_confidence.py::test_auto_invocation
- core/test_assess_confidence.py::test_all_components_populated
- core/test_assess_confidence.py::test_composite_calculation
- core/test_assess_confidence.py::test_event_bus_emission

**Dependencies:** P-347 (self-critique), P-346 (schema), P-176 (sandbox), P-342 (resolver), P-127 (license), P-259 (coverage)

**Handoff Notes:** Next: P-349 defines composite scoring model and weighting.

---

### P-349: Confidence Scoring - Composite Scoring Model

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-348

**Context:**
Finalize the weighting formula for the composite confidence score and document it transparently — not a black box. Default weights: sandbox_pass 30%, self_confidence 25%, resolver_confidence 20%, license_risk 15%, test_coverage 10%. Weights are configurable via `~/.stitch/config.json` and the rationale for each weight is documented in DECISIONS.md. The model is calibrated against the Epic 16 corpus (P-327) human rubric scores (P-354) in the next phase.

**Files to Create/Modify:**
- `packages/core/src/confidence/scoring.ts`
- `packages/core/src/confidence/scoring.test.ts`
- `DECISIONS.md (weight rationale documented)`

**Implementation Steps:**
1. Implement `computeComposite(components, weights?)` with default weights as above
2. Add config schema in `core/src/config/schema.ts` for `confidence.weights` object
3. Document weight rationale in DECISIONS.md: sandbox=outcome proxy, self=agent internal, resolver=technical correctness, license=compliance risk, tests=regression safety
4. Add `explain(score)` function that returns human-readable breakdown of composite
5. Verify scoring is deterministic (same inputs -> same score)

**Required MCPs/Connectors:** None (local computation)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] computeComposite implements documented weighting formula
- [ ] Weights configurable via ~/.stitch/config.json
- [ ] DECISIONS.md documents rationale for each weight
- [ ] explain() returns readable breakdown
- [ ] Deterministic: same inputs -> same output

**Tests Required:**
- core/test_scoring_model.py::test_default_weights
- core/test_scoring_model.py::test_custom_weights
- core/test_scoring_model.py::test_explain_output
- core/test_scoring_model.py::test_deterministic

**Dependencies:** P-348 (assess_confidence tool), P-346 (schema), P-354 (calibration next)

**Handoff Notes:** Next: P-350 defines threshold policy; P-351 adds CREDITS.md confidence section.

---
### P-350: Confidence Scoring - Threshold Policy

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-349

**Context:**
Define a configurable threshold policy where composite confidence scores below a threshold force human review even for tools normally in the auto-approval list (per SECURITY.md §6.1). The threshold is set in `~/.stitch/config.json` under `confidence.auto_approve_threshold` (default 75). Scores below threshold route the proposal to the HIL approval queue (P-160) with a confidence breakdown. Default threshold justified in DECISIONS.md based on P-354 calibration data.

**Files to Create/Modify:**
- `packages/core/src/confidence/threshold.ts`
- `packages/core/src/config/schema.ts (add confidence.threshold)`

**Implementation Steps:**
1. Add `confidence.auto_approve_threshold` to config schema (default 75, range 0-100)
2. Implement `shouldAutoApprove(confidence)` that returns false if composite < threshold
3. Integrate with HIL approval queue (P-160): low-confidence proposals get `requires_human_review: true`
4. Add CLI flag `--confidence-threshold` to override per-run
5. Document threshold rationale in DECISIONS.md: calibrated from P-354 correlation data

**Required MCPs/Connectors:** None (local config + queue)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Config schema includes auto_approve_threshold
- [ ] Proposals below threshold routed to HIL queue (P-160)
- [ ] CLI override flag works
- [ ] Default threshold documented with calibration basis

**Tests Required:**
- core/test_threshold.py::test_default_threshold
- core/test_threshold.py::test_override_flag
- core/test_threshold.py::test_hil_routing

**Dependencies:** P-349 (composite model), P-160 (HIL queue), P-354 (calibration)

**Handoff Notes:** Next: P-351 adds confidence section to CREDITS.md.

---

### P-351: Confidence Scoring - CREDITS.md Confidence Section

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-350

**Context:**
Extend the generated CREDITS.md (P-182) to include per-file/component confidence scores and flag lists. Each entry in the credits table gets an additional `confidence` column showing the composite score and a `flags` column listing any warnings (e.g., 'low_resolver_confidence', 'license_risk'). This makes confidence visible to downstream consumers of the merged repo without opening the web UI.

**Files to Create/Modify:**
- `packages/core/src/provenance/credits.ts`
- `packages/core/src/provenance/credits.test.ts`

**Implementation Steps:**
1. Modify CREDITS.md generator to accept `SemanticConfidence` per file/component (from P-348)
2. Add `confidence` column to the credits table with composite score (0-100)
3. Add `flags` column with comma-separated warning strings from confidence.flags
4. For files without confidence data (legacy), show 'N/A' with note
5. Ensure generated markdown renders correctly in GitHub/GitLab
6. Test with a sample merge that has mixed confidence levels

**Required MCPs/Connectors:** None (local generation)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] CREDITS.md includes confidence and flags columns
- [ ] Scores match assess_confidence output (P-348)
- [ ] Flags correctly rendered from confidence.flags
- [ ] Markdown renders correctly on GitHub

**Tests Required:**
- core/test_credits_confidence.py::test_columns_present
- core/test_credits_confidence.py::test_scores_match
- core/test_credits_confidence.py::test_flags_rendered

**Dependencies:** P-350 (threshold), P-182 (CREDITS.md), P-348 (assess_confidence)

**Handoff Notes:** Next: P-352 adds web UI confidence badges.

---

### P-352: Confidence Scoring - Web UI Confidence Badges

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-351

**Context:**
Display confidence scores and flags inline in the web UI diff viewer (P-217) and provenance view (P-185). Low-confidence components visually distinct without opening a separate panel. Uses the design tokens (P-209) for consistent color coding: green (≥80), yellow (60-79), red (<60). Tooltip on hover shows full confidence breakdown.

**Files to Create/Modify:**
- `packages/web/src/components/ConfidenceBadge.tsx`
- `packages/web/src/pages/DiffViewer.tsx (modify)`
- `packages/web/src/pages/ProvenanceView.tsx (modify)`

**Implementation Steps:**
1. Create `ConfidenceBadge` component: accepts score (0-100) + flags, renders colored badge per design tokens
2. Color thresholds: green ≥80, yellow 60-79, red <60 (configurable via theme)
3. Integrate into DiffViewer: show badge per changed file/component in file list
4. Integrate into ProvenanceView: show badge per provenance entry
5. Add tooltip with full breakdown: sandbox, self, resolver, license, tests
6. Ensure a11y: badge has aria-label with score, color not sole indicator (text + icon)
7. Responsive: badge scales on mobile (P-227)

**Required MCPs/Connectors:** None (frontend)

**Skills to Invoke:** ui-styling, ui-ux-pro-max.

**Acceptance Criteria:**
- [ ] ConfidenceBadge component renders with correct colors
- [ ] DiffViewer shows badge per file
- [ ] ProvenanceView shows badge per entry
- [ ] Tooltip shows full breakdown
- [ ] A11y compliant (aria-label, not color-only)

**Tests Required:**
- web/test_confidence_badge.tsx::test_colors
- web/test_confidence_badge.tsx::test_tooltip
- web/test_confidence_badge.tsx::test_a11y
- web/test_diff_viewer.tsx::test_confidence_integration

**Dependencies:** P-351 (CREDITS confidence), P-209 (design tokens), P-217 (diff viewer), P-185 (provenance view)

**Handoff Notes:** Next: P-353 adds CLI confidence summary.

---

### P-353: Confidence Scoring - CLI Confidence Summary

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-352

**Context:**
Add a one-line confidence summary to `stitch merge` and `stitch status` output. Shows: `Confidence: 87% (sandbox:✓ self:92 resolver:78 license:95 tests:88) [flags: low_resolver]` Visible in default (non-verbose) output so users always see confidence without extra flags. Uses picocolors (P-044) for color coding matching web UI thresholds.

**Files to Create/Modify:**
- `packages/cli/src/commands/merge.ts (modify output)`
- `packages/cli/src/commands/status.ts (modify output)`
- `packages/cli/src/ui/confidence-summary.ts`

**Implementation Steps:**
1. Create `formatConfidenceSummary(confidence)` that returns colored one-line string
2. Integrate into `stitch merge` final output: print summary after merge completes
3. Integrate into `stitch status`: show confidence for running/completed jobs
4. Color code with picocolors: green/yellow/red per thresholds (P-352)
5. Flags displayed in brackets after score
6. Respect `--no-color` and `--verbose` (verbose shows full breakdown)

**Required MCPs/Connectors:** None (CLI output)

**Skills to Invoke:** ui-styling.

**Acceptance Criteria:**
- [ ] stitch merge shows one-line confidence summary
- [ ] stitch status shows confidence for jobs
- [ ] Colors match web UI thresholds
- [ ] Flags displayed, --no-color respected
- [ ] Verbose mode shows full breakdown

**Tests Required:**
- cli/test_merge_confidence.py::test_summary_output
- cli/test_status_confidence.py::test_status_output
- cli/test_confidence_summary.py::test_color_coding

**Dependencies:** P-352 (web UI badges), P-044 (picocolors), P-192 (merge cmd), P-194 (status cmd)

**Handoff Notes:** Next: P-354 runs calibration check against human rubric.

---

### P-354: Confidence Scoring - Calibration Check

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-353

**Context:**
Compare the agent's self-reported confidence (P-347/P-348) against the human rubric scores (P-326) across the full Epic 16 corpus (P-327). Compute correlation coefficient (Pearson/Spearman) between self-confidence and human rubric average. If correlation is weak (<0.5), this is a critical finding documented in DECISIONS.md and triggers P-355 recalibration. Results inform whether self-critique is a reliable signal or needs redesign.

**Files to Create/Modify:**
- `packages/core/src/confidence/calibration.ts`
- `eval/calibration/report.json`
- `DECISIONS.md (calibration results)`

**Implementation Steps:**
1. Collect self-confidence scores from all `assess_confidence` runs on Epic 16 corpus (P-327)
2. Collect human rubric averages from P-326 ratings for same proposals
3. Compute Pearson and Spearman correlation coefficients
4. Generate `eval/calibration/report.json` with: correlation, scatter plot data, per-ecosystem breakdown
5. Document findings in DECISIONS.md: if correlation < 0.5, flag as critical and require P-355
6. If correlation ≥ 0.5, document as validated and proceed

**Required MCPs/Connectors:** None (local analysis)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Correlation coefficients computed for full corpus
- [ ] Report JSON generated with scatter data
- [ ] DECISIONS.md updated with calibration findings
- [ ] Critical flag if correlation < 0.5

**Tests Required:**
- core/test_calibration.py::test_correlation_computed
- core/test_calibration.py::test_report_generated
- core/test_calibration.py::test_critical_flag

**Dependencies:** P-353 (CLI summary), P-327 (baseline corpus), P-326 (human rubric), P-347 (self-critique)

**Handoff Notes:** Next: P-355 recalibrates if needed; P-356 adds tests and CONFIDENCE.md docs.

---

### P-355: Confidence Scoring - Prompt/Weight Recalibration

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-354

**Context:**
If P-354 calibration reveals weak correlation (<0.5), adjust the self-critique prompt (P-347) and/or the composite scoring weights (P-349) to improve alignment with human judgment. This is an iterative loop: adjust -> re-run corpus subset -> re-measure correlation -> repeat until correlation ≥ 0.5 or documented reason why not. Changes tracked in DECISIONS.md with versioned prompt/weights.

**Files to Create/Modify:**
- `packages/core/src/ai/prompts/self-critique.txt (versioned)`
- `packages/core/src/config/schema.ts (confidence.weights versioned)`
- `DECISIONS.md (recalibration log)`

**Implementation Steps:**
1. If P-354 correlation ≥ 0.5: document as validated, no changes needed
2. If correlation < 0.5: iterate prompt tuning (add examples, change framing, add chain-of-thought)
3. Iterate weight adjustment: shift weight from weak factors to stronger correlates
4. After each iteration, re-run calibration on corpus subset (5 pairs) for fast feedback
5. When correlation ≥ 0.5 achieved, freeze prompt version and weights, document in DECISIONS.md
6. If after 5 iterations correlation still < 0.5, document as known limitation and proceed with human-review fallback (P-350 threshold)

**Required MCPs/Connectors:** AI providers (for prompt testing)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Recalibration loop executed if needed
- [ ] Correlation ≥ 0.5 achieved or documented limitation
- [ ] Final prompt version and weights frozen and documented
- [ ] DECISIONS.md has full recalibration log

**Tests Required:**
- core/test_recalibration.py::test_iteration_improves_correlation
- core/test_recalibration.py::test_final_frozen

**Dependencies:** P-354 (calibration), P-347 (prompt), P-349 (weights), P-350 (fallback threshold)

**Handoff Notes:** Next: P-356 adds tests and CONFIDENCE.md documentation.

---

### P-356: Confidence Scoring - Tests + CONFIDENCE.md Docs

**Owner:** inbesat | **Wave:** 1.5 | **Depends On:** P-355

**Context:**
Unit tests for the composite scoring model (P-349) and public documentation `CONFIDENCE.md` explaining what the score means and doesn't mean. The doc explicitly states the score is a heuristic, not a correctness guarantee. Includes: score interpretation guide, factor descriptions, threshold policy, calibration methodology, limitations. Linked from README and EVAL.md.

**Files to Create/Modify:**
- `packages/core/src/confidence/scoring.test.ts`
- `packages/core/src/confidence/threshold.test.ts`
- `CONFIDENCE.md`

**Implementation Steps:**
1. Add unit tests for scoring model: edge cases (all zeros, all 100s, missing components), weight variations, threshold boundary (74 vs 75), explain() output format
2. Write CONFIDENCE.md with sections: Overview, Score Interpretation (0-100 bands), Factor Descriptions, Threshold Policy, Calibration Methodology, Limitations (explicit: not a correctness guarantee), How to Improve Scores, Version History
3. Link CONFIDENCE.md from README.md and EVAL.md (P-333)
4. Add CI check that CONFIDENCE.md exists and has required sections

**Required MCPs/Connectors:** None (local tests + docs)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Unit tests cover scoring edge cases and threshold boundary
- [ ] CONFIDENCE.md published with all required sections
- [ ] Explicit disclaimer: score is heuristic, not correctness guarantee
- [ ] Linked from README and EVAL.md

**Tests Required:**
- core/test_confidence_docs.py::test_scoring_edge_cases
- core/test_confidence_docs.py::test_threshold_boundary
- docs/test_confidence_md.py::test_sections_present
- docs/test_confidence_md.py::test_disclaimer_present

**Dependencies:** P-355 (recalibration complete), P-349 (scoring), P-350 (threshold), P-354 (calibration)

**Handoff Notes:** Epic 18 (Confidence Scoring) complete. Next: Epic 19 (MCP-First Distribution) P-357.

---

### P-357: MCP-First Distribution - MCP Server Scaffold

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-356

**Context:**
Create the MCP server package (`packages/mcp/`) that wraps the core public API (P-252 CLI/Web contract) as an MCP server. Minimal scaffold: server starts, responds to `initialize` from a real MCP client (Claude Code, OpenCode, Cursor). Uses the existing Elysia server (P-043) as the HTTP transport base with MCP protocol handling. This is the foundation for all MCP tools.

**Files to Create/Modify:**
- `packages/mcp/package.json`
- `packages/mcp/src/server.ts`
- `packages/mcp/src/transport.ts`
- `packages/mcp/src/tools/registry.ts`

**Implementation Steps:**
1. Create `packages/mcp/` with package.json: name `@repo-stitcher/mcp`, depends on `@repo-stitcher/core`, `elysia`, `@modelcontextprotocol/sdk`
2. Implement `MCPServer` class: handles `initialize`, `tools/list`, `tools/call` per MCP spec
3. Use Elysia (P-043) for HTTP/WebSocket transport; support stdio transport for local clients
4. Create tool registry pattern: tools register via `registry.register(toolDef, handler)`
5. Wire core public API: `createStitchJob`, `getJobStatus`, `subscribeJobEvents`, `mergeManifests`, `scanLicenses`, `runSandboxBuild` as initial tool set
6. Add `bun run mcp:server` script to start server on port 3435 (configurable)
7. Test: connect with `mcp-cli` or Claude Code, call `initialize`, verify response

**Required MCPs/Connectors:** Core public API (P-252), Elysia server (P-043)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] packages/mcp/ scaffold created with correct dependencies
- [ ] Server starts and responds to initialize
- [ ] Tool registry works with core API tools
- [ ] stdio and HTTP transports functional
- [ ] Connectable from real MCP client

**Tests Required:**
- mcp/test_server.ts::test_initialize
- mcp/test_server.ts::test_tools_list
- mcp/test_server.ts::test_stdio_transport

**Dependencies:** P-356 (confidence complete), P-252 (contract), P-043 (Elysia), P-314 (contract freeze)

**Handoff Notes:** Next: P-358 adds stitch_select_files tool.

---

### P-358: MCP-First Distribution - Tool: stitch_select_files

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-357

**Context:**
Expose repository A/B file-tree browsing as an MCP tool. The tool accepts a repo URL (or local path) and optional path filter, returns a structured file tree with metadata (size, language, last commit). This allows an MCP host (Claude Code, OpenCode) to let users visually select files for stitching without leaving the host environment. Covers the OpenCode use case from superseded P-299.

**Files to Create/Modify:**
- `packages/mcp/src/tools/select-files.ts`
- `packages/mcp/src/tools/select-files.test.ts`

**Implementation Steps:**
1. Define `stitch_select_files` tool schema: input { repo_url?, local_path?, path_filter? }, output { tree: FileNode[], repo_meta }
2. Implement handler: clone/fetch repo (reuse P-069 git), build tree via `git ls-tree` or GitHub API, enrich with language detection (P-103) and file sizes
3. Add pagination for large repos: `page`, `page_size` params
4. Test: call from MCP client, verify tree structure and metadata
5. Document tool in MCP_QUICKSTART.md (P-365)

**Required MCPs/Connectors:** GitHub API (for remote), local git (P-069), ecosystem detect (P-103)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] stitch_select_files tool registered and callable via MCP
- [ ] Returns structured file tree with metadata
- [ ] Pagination works for large repos
- [ ] Works from real MCP host (Claude Code/OpenCode)

**Tests Required:**
- mcp/test_select_files.py::test_local_repo
- mcp/test_select_files.py::test_remote_repo
- mcp/test_select_files.py::test_pagination

**Dependencies:** P-357 (MCP scaffold), P-069 (git clone), P-103 (ecosystem detect)

**Handoff Notes:** Next: P-359 adds stitch_merge tool.

---

### P-359: MCP-First Distribution - Tool: stitch_merge

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-358

**Context:**
Kick off a merge job from inside a host agent session. The tool accepts the standard merge config (repos, paths, options) and returns a job ID. Supports job-polling for long-running merges: host can call `stitch_job_status` (separate tool) or subscribe to progress notifications via MCP progress events. This enables end-to-end merge triggered from within an MCP host, not the CLI.

**Files to Create/Modify:**
- `packages/mcp/src/tools/merge.ts`
- `packages/mcp/src/tools/job-status.ts`
- `packages/mcp/src/tools/merge.test.ts`

**Implementation Steps:**
1. Define `stitch_merge` tool schema: input { repo_a, repo_b, paths_a[], paths_b[], options? }, output { job_id }
2. Implement handler: create job via orchestration API (P-238), return job_id immediately
3. Define `stitch_job_status` tool: input { job_id }, output { status, progress, result? }
4. Map internal JobEvent/WS stream (P-241) to MCP progress notifications for live updates
5. Add `stitch_cancel_job` tool for cancellation (P-246)
6. Test: full merge triggered from MCP host, progress notifications received, result retrieved

**Required MCPs/Connectors:** Orchestration API (P-238), Event bus (P-241), Sandbox (P-168)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] stitch_merge returns job_id, job runs in background
- [ ] stitch_job_status returns current status/progress
- [ ] MCP progress notifications stream live updates
- [ ] stitch_cancel_job works
- [ ] End-to-end merge from MCP host completes successfully

**Tests Required:**
- mcp/test_merge.py::test_merge_returns_job
- mcp/test_merge.py::test_progress_notifications
- mcp/test_merge.py::test_job_status
- mcp/test_merge.py::test_cancel

**Dependencies:** P-358 (select_files), P-238 (orchestration), P-241 (event bus), P-168 (sandbox)

**Handoff Notes:** Next: P-360 adds stitch_check_license tool.

---
### P-360: MCP-First Distribution - Tool: stitch_check_license

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-359

**Context:**
Standalone quick license-compatibility check tool — useful even without a full merge. Accepts two repo URLs (or local paths), runs the license scan (P-118) and SPDX compatibility matrix (P-120) on both, returns a verdict: `compatible`, `conditional`, `incompatible` with details. Completes in <10 seconds by using cached license data (P-303) where available. Enables pre-merge license due diligence from within an MCP host.

**Files to Create/Modify:**
- `packages/mcp/src/tools/check-license.ts`
- `packages/mcp/src/tools/check-license.test.ts`

**Implementation Steps:**
1. Define `stitch_check_license` tool schema: input { repo_a, repo_b }, output { verdict, details, spdx_ids }
2. Implement handler: run license scan (P-118) on both repos in parallel, apply compatibility matrix (P-120)
3. Use repo-metadata cache (P-303) for license data if repos previously scanned
4. Return verdict enum: compatible / conditional (with requirements) / incompatible (with blockers)
5. Include SPDX IDs, license names, and any policy warnings (P-127) in output
6. Target <10s for cached, <30s for cold scan
7. Test: known compatible/incompatible pairs from corpus (P-321)

**Required MCPs/Connectors:** GitHub API (for remote), license scan (P-118), cache (P-303)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] stitch_check_license tool registered and callable via MCP
- [ ] Returns verdict + SPDX details in <10s (cached) / <30s (cold)
- [ ] Correctly identifies compatible/incompatible pairs from corpus
- [ ] Uses cache (P-303) for speed

**Tests Required:**
- mcp/test_check_license.py::test_compatible_pair
- mcp/test_check_license.py::test_incompatible_pair
- mcp/test_check_license.py::test_cache_speed
- mcp/test_check_license.py::test_spdx_details

**Dependencies:** P-359 (merge tool), P-118 (license scan), P-120 (compat matrix), P-303 (cache)

**Handoff Notes:** Next: P-361 adds progress streaming via MCP.

---

### P-361: MCP-First Distribution - Progress Streaming via MCP

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-360

**Context:**
Map the internal JobEvent/WS event stream (P-241) to MCP progress notifications so host UIs show live progress during long-running merge jobs. The MCP protocol supports progress tokens; we emit `notifications/progress` with `progressToken`, `progress`, `total`, and optional message. This replaces the need for the host to poll `stitch_job_status` for live updates.

**Files to Create/Modify:**
- `packages/mcp/src/progress.ts`
- `packages/mcp/src/progress.test.ts`

**Implementation Steps:**
1. Extend `stitch_merge` tool to accept optional `progressToken` in input
2. When `progressToken` provided, register a progress emitter for that job (P-241 event bus)
3. On each JobEvent, emit MCP `notifications/progress` with token, progress (0-100), total, message
4. Handle job completion: emit final progress=100, then emit `tools/call` result with job result
5. Test: start merge from MCP host with progressToken, verify live progress notifications received
6. Ensure backward compatibility: if no progressToken, fall back to job-status polling (P-359)

**Required MCPs/Connectors:** Event bus (P-241), MCP protocol progress notifications

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] stitch_merge accepts progressToken and emits live progress
- [ ] Progress notifications map 1:1 with JobEvent stream
- [ ] Completion emits final progress + tool result
- [ ] Backward compatible: no progressToken -> polling works

**Tests Required:**
- mcp/test_progress.py::test_progress_emitted
- mcp/test_progress.py::test_completion_event
- mcp/test_progress.py::test_backward_compat

**Dependencies:** P-360 (check_license), P-241 (event bus), P-359 (merge tool)

**Handoff Notes:** Next: P-362 adds auth/config passthrough.

---

### P-362: MCP-First Distribution - Auth/Config Passthrough

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-361

**Context:**
Reuse the existing `~/.stitch/config.json` (P-200) for MCP server authentication and configuration — no separate MCP-only credential flow. The MCP server reads the same config file for: GitHub tokens (P-206), AI provider keys (P-134), sandbox settings (P-174), and confidence thresholds (P-350). Switching between CLI and MCP usage requires zero re-auth. Config changes picked up on server restart.

**Files to Create/Modify:**
- `packages/mcp/src/config.ts`
- `packages/mcp/src/config.test.ts`

**Implementation Steps:**
1. Implement `loadMCPConfig()` that reads `~/.stitch/config.json` using same schema as CLI (P-200)
2. Validate required fields for MCP: github_token, ai_provider keys, sandbox config
3. Add config hot-reload: watch config file, restart affected subsystems on change (or document restart needed)
4. Ensure secrets never logged: reuse logger redaction (P-010/P-037)
5. Test: start MCP server with existing ~/.stitch/config.json, verify all tools work without re-auth
6. Document config sharing in MCP_QUICKSTART.md (P-365)

**Required MCPs/Connectors:** ~/.stitch/config.json (P-200), logger redaction (P-010/P-037)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] MCP server reads ~/.stitch/config.json without separate config
- [ ] All tools work with shared config (no re-auth needed)
- [ ] Secrets redacted in logs (P-010/P-037)
- [ ] Config changes documented as requiring restart

**Tests Required:**
- mcp/test_config.py::test_shared_config_works
- mcp/test_config.py::test_secrets_redacted
- mcp/test_config.py::test_required_fields_validated

**Dependencies:** P-361 (progress), P-200 (config), P-010/P-037 (logger), P-206 (secrets)

**Handoff Notes:** Next: P-363 host compatibility pass.

---

### P-363: MCP-First Distribution - Host Compatibility Pass

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-362

**Context:**
Manual test the MCP server against 3 real MCP hosts: Claude Code, OpenCode, Cursor. Document pass/fail and any quirks per host in `MCP_COMPAT.md`. This validates the MCP implementation works in the wild and identifies host-specific behaviors (e.g., stdio vs HTTP transport preference, progress notification handling, tool schema validation strictness). Required for P-364 registry submission.

**Files to Create/Modify:**
- `MCP_COMPAT.md`
- `packages/mcp/test/host-compat.ts`

**Implementation Steps:**
1. Test against Claude Code: install server, run `stitch_select_files`, `stitch_merge`, `stitch_check_license`, verify progress
2. Test against OpenCode: same suite, note any transport differences (stdio vs HTTP)
3. Test against Cursor: same suite, note MCP client version differences
4. Document results in `MCP_COMPAT.md`: host, version, transport, tools tested, pass/fail, quirks, workarounds
5. Fix any critical failures before P-364 registry submission
6. Add `MCP_COMPAT.md` to repo and link from MCP_QUICKSTART.md (P-365)

**Required MCPs/Connectors:** Claude Code, OpenCode, Cursor (MCP hosts)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Tested against all 3 hosts: Claude Code, OpenCode, Cursor
- [ ] MCP_COMPAT.md documents pass/fail + quirks per host
- [ ] Critical failures fixed before registry submission
- [ ] At least 2 hosts fully pass all tools

**Tests Required:**
- mcp/test_host_compat.py::test_claude_code
- mcp/test_host_compat.py::test_opencode
- mcp/test_host_compat.py::test_cursor

**Dependencies:** P-362 (auth), P-357-P-361 (all tools), P-365 (quickstart links)

**Handoff Notes:** Next: P-364 MCP registry submission.

---

### P-364: MCP-First Distribution - MCP Registry Submission

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-363

**Context:**
Publish `repo-stitcher` to the public MCP registry/directory so it's discoverable by name in registry search. This involves: creating a registry entry with name, description, version, repository URL, tool list, and installation instructions. Follow the registry's submission process (typically a PR to a registry repo or a web form). Once published, users can install via `mcp install repo-stitcher` or equivalent host-specific command.

**Files to Create/Modify:**
- `MCP_REGISTRY_ENTRY.json (or PR to registry)`
- `packages/mcp/publish.ts`

**Implementation Steps:**
1. Prepare registry entry: name `repo-stitcher`, description, version (from package.json), repository URL, homepage, license, tool list (select_files, merge, job_status, check_license), installation instructions
2. Submit to MCP registry (PR to registry repo or web form per registry process)
3. Verify entry appears in registry search for `repo-stitcher`
4. Add registry badge to README.md and MCP_QUICKSTART.md (P-365)
5. Set up automated publish on release (P-263): CI job publishes to registry on tag

**Required MCPs/Connectors:** MCP registry (public)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] Registry entry submitted and approved
- [ ] Discoverable by name `repo-stitcher` in registry search
- [ ] Registry badge on README and MCP_QUICKSTART.md
- [ ] Automated publish on release configured

**Tests Required:**
- mcp/test_registry.py::test_entry_discoverable
- mcp/test_registry.py::test_auto_publish

**Dependencies:** P-363 (host compat), P-263 (release pipeline)

**Handoff Notes:** Next: P-365 creates MCP_QUICKSTART.md user-facing doc.

---

### P-365: MCP-First Distribution - MCP_QUICKSTART.md

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-364

**Context:**
Create a user-facing quickstart document `MCP_QUICKSTART.md` that takes a new user from zero to a completed merge via MCP alone. Covers: installation (`mcp install repo-stitcher` or manual), configuration (reuses `~/.stitch/config.json`), example session with `stitch_select_files` → `stitch_merge` → `stitch_job_status`, progress streaming, and troubleshooting. Linked from README, EVAL.md, and MCP registry entry.

**Files to Create/Modify:**
- `MCP_QUICKSTART.md`

**Implementation Steps:**
1. Write MCP_QUICKSTART.md with sections: Prerequisites, Installation, Configuration, Example Session (step-by-step with screenshots/commands), Tool Reference, Progress Streaming, Troubleshooting, Host-Specific Notes (from MCP_COMPAT.md)
2. Include copy-pasteable example session: install -> config -> select_files -> merge -> monitor -> result
3. Link from README.md, EVAL.md (P-333), and MCP registry entry
4. Add to docs CI check that file exists and has all sections

**Required MCPs/Connectors:** None (documentation)

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] MCP_QUICKSTART.md published with all required sections
- [ ] Example session works end-to-end for new user
- [ ] Linked from README, EVAL.md, registry entry
- [ ] CI checks file completeness

**Tests Required:**
- docs/test_mcp_quickstart.py::test_sections_present
- docs/test_mcp_quickstart.py::test_example_session_valid

**Dependencies:** P-364 (registry), P-363 (compat doc), P-357-P-361 (tools)

**Handoff Notes:** Next: P-366 opt-in telemetry.

---

### P-366: MCP-First Distribution - Opt-In Telemetry

**Owner:** aradhy | **Wave:** 1.5 | **Depends On:** P-365

**Context:**
Track MCP tool-call volume (opt-in only) as a real signal of whether this channel gets used vs CLI/Web. Implementation: add `telemetry.enabled` config flag (default false) in `~/.stitch/config.json`. When enabled, emit anonymized events: `tool_called {tool, duration_ms, success}`, `session_start {host}`, `session_end {duration_s, tools_used}`. No repo URLs, file contents, or secrets. Aggregate into a dashboard/report comparing MCP vs CLI vs Web usage after first month live. Respects P-305 (telemetry opt-in).

**Files to Create/Modify:**
- `packages/mcp/src/telemetry.ts`
- `packages/mcp/src/telemetry.test.ts`
- `packages/core/src/config/schema.ts (add telemetry.enabled)`

**Implementation Steps:**
1. Add `telemetry.enabled` (default false) to config schema (P-200)
2. Implement `TelemetryClient`: emits events only when enabled, anonymized (no repo URLs, no secrets)
3. Events: tool_called (tool, duration_ms, success), session_start (host), session_end (duration_s, tools_used)
4. Batch and send to telemetry endpoint (configurable, default local file `~/.stitch/telemetry.log` for privacy)
5. Add opt-in prompt on first MCP server start if not configured
6. After 1 month: generate usage report comparing MCP vs CLI (P-192) vs Web (P-208) tool volumes
7. Document privacy guarantees in CONFIDENCE.md (P-356) and MCP_QUICKSTART.md (P-365)

**Required MCPs/Connectors:** Config (P-200), local file / configurable endpoint

**Skills to Invoke:** None.

**Acceptance Criteria:**
- [ ] telemetry.enabled config flag (default false)
- [ ] Events emitted only when opted in, anonymized
- [ ] Local file logging by default, configurable endpoint
- [ ] Opt-in prompt on first run
- [ ] Month-1 report compares MCP/CLI/Web usage
- [ ] Privacy documented in CONFIDENCE.md and MCP_QUICKSTART.md

**Tests Required:**
- mcp/test_telemetry.py::test_opt_in_required
- mcp/test_telemetry.py::test_anonymized
- mcp/test_telemetry.py::test_local_logging
- mcp/test_telemetry.py::test_privacy_no_secrets

**Dependencies:** P-365 (quickstart), P-200 (config), P-305 (telemetry opt-in policy), P-356 (CONFIDENCE.md)

**Handoff Notes:** Epic 19 (MCP-First Distribution) complete. All 366 phases documented. Plan ready for implementation.

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

