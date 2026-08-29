# AGENTS.md — AI Sub-Agent Instructions & Automation Rules
## repo-stitcher: Concrete Commands, Coverage Requirements, and Self-Validation Loops

**Version:** 1.0.0
**Status:** Enforced for all AI-assisted work
**Last Updated:** 2026-08-30

---

## 1. Prime Directives (Non-Negotiable)

| Rule | Enforcement |
|------|-------------|
| **Never write code that violates TECH_STACK.md** | Lint rule `no-restricted-imports` + human review |
| **Never hardcode secrets, keys, or tokens** | `SECRETS.md` check in pre-commit; logger redacts automatically |
| **Never modify `packages/core` if you are aradhy's agent** | File ownership: core=inbesat only; cli/web=aradhy only |
| **Never skip typecheck/lint/test before marking phase complete** | CI gate + `AGENTS.md` checklist |
| **Never assume API shapes — read INTEGRATIONS.md first** | Contract-first development |
| **Never generate code for out-of-scope features (PRD.md §4)** | PRD is scope boundary |
| **Always run `bun run typecheck` + `bun run lint` + `bun test` after changes** | Automated in `validate()` function below |

---

## 2. Standard Terminal Commands (Copy-Paste Ready)

### 2.1 Development Loop
```bash
# Install deps (run once, or after package.json changes)
bun install

# Type-check entire monorepo (strict)
bun run typecheck

# Lint entire monorepo
bun run lint

# Run all tests (unit + integration)
bun test

# Run tests with coverage (enforces thresholds)
bun test --coverage

# Build all packages (core → dist, cli → binary, web → dist)
bun run build

# Format code (Prettier)
bun run format

# Start CLI dev (with hot reload via --watch)
bun run dev:cli

# Start Web dev (Vite HMR on :5173, proxied to CLI server :3434)
bun run dev:web

# Full validation (run before commit/PR)
bun run validate
```

### 2.2 Package-Specific Commands
```bash
# Core only
bun --filter @repo-stitcher/core run typecheck
bun --filter @repo-stitcher/core run test
bun --filter @repo-stitcher/core run build

# CLI only
bun --filter @repo-stitcher/cli run typecheck
bun --filter @repo-stitcher/cli run test
bun --filter @repo-stitcher/cli run build
bun --filter @repo-stitcher/cli run dev

# Web only
bun --filter @repo-stitcher/web run typecheck
bun --filter @repo-stitcher/web run test
bun --filter @repo-stitcher/web run build
bun --filter @repo-stitcher/web run dev
```

### 2.3 Validation Function (Paste into Terminal)
```bash
validate() {
  set -e
  echo "🔍 Type-checking..."
  bun run typecheck
  echo "✅ Types OK"
  echo "🔍 Linting..."
  bun run lint
  echo "✅ Lint OK"
  echo "🧪 Testing..."
  bun test
  echo "✅ Tests OK"
  echo "🏗️ Building..."
  bun run build
  echo "✅ Build OK"
  echo "🎉 ALL CHECKS PASSED"
}
```

---

## 3. Test Coverage Requirements (Enforced by Vitest Config)

| Package | Statements | Branches | Functions | Lines |
|---------|------------|----------|-----------|-------|
| **core** | 80% | 70% | 80% | 80% |
| **cli** | 70% | 60% | 70% | 70% |
| **web** | 60% | 50% | 60% | 60% |

**Critical Paths (Must Have Tests):**
- `core/git/` — clone, filter-repo, merge, push (fixture repos)
- `core/deps/merge.ts` — collision resolution, semver logic
- `core/license/compat.ts` — SPDX matrix, GPL detection
- `core/ai/loop.ts` — agent loop, tool execution, gated flow
- `core/sandbox/runner.ts` — Docker + GH Actions paths
- `core/orchestration/pipeline.ts` — state machine, retry, rollback
- `cli/commands/merge.ts` — end-to-end stitch flow
- `web/pages/MergeWizard` — step navigation, WS events

**Test Patterns:**
```ts
// Unit: pure functions
import { describe, it, expect } from 'vitest'
import { mergeManifests } from '../deps/merge'

describe('mergeManifests', () => {
  it('resolves semver collision', () => {
    const result = mergeManifests([
      { dependencies: { foo: '^1.0.0' } },
      { dependencies: { foo: '^2.0.0' } }
    ])
    expect(result.conflicts).toHaveLength(1)
  })
})

// Integration: with fixtures
import { createTempDir, writeFixture } from './test-utils'

it('stitches two JS repos end-to-end', async () => {
  const dir = await createTempDir()
  // write fixture repos A and B
  // run stitch merge via CLI
  // assert child repo builds + tests pass
})
```

---

## 4. Code Style Limits (Enforced by ESLint + Prettier)

| Rule | Setting | Rationale |
|------|---------|-----------|
| **Max line length** | 100 chars | Prettier default; readable in diffs |
| **Quotes** | Single | Consistency |
| **Trailing commas** | `es5` | Clean diffs |
| **Semicolons** | `true` | Explicit |
| **Import order** | `external` → `internal` → `parent` → `sibling` → `index` | `eslint-plugin-import` |
| **No restricted imports** | `core` in `cli`/`web` except via public API | Package isolation |
| **No `any`** | Error | Strict TS |
| **No `console.log`** | Warn (allow in CLI commands) | Use `logger` |
| **No `throw`** | Error | Use `Result<T, E>` |
| **Max function lines** | 50 | Refactor large functions |
| **Max params** | 4 | Use config object |

---

## 5. Self-Validation Loop (Agent Must Run After Every Change)

```bash
# 1. Type-check the specific package you edited
bun --filter @repo-stitcher/<pkg> run typecheck

# 2. Lint the specific package
bun --filter @repo-stitcher/<pkg> run lint

# 3. Run related tests (watch mode for iteration)
bun --filter @repo-stitcher/<pkg> test --watch

# 4. If tests pass, run full validation
validate
```

**Do NOT mark a phase complete until `validate` passes.**

---

## 6. Sub-Agent Spawning Instructions

When you need a sub-agent for a complex task, use this exact prompt template:

```markdown
## Sub-Agent Task: [Short Description]

**Context Files to Read First:**
- project-plans/PHASES_DETAILED.md#P-XXX (your phase)
- project-plans/TECH_STACK.md (enforced stack)
- project-plans/ARCHITECTURE.md (module location)
- project-plans/DECISIONS.md (relevant ADRs)
- project-plans/INTEGRATIONS.md (if external API)

**Deliverable:** [Specific files to create/modify + tests]

**Constraints:**
- Follow TECH_STACK.md exactly (no axios, no Prisma, etc.)
- Return Result<T, E> from all public functions
- Write tests for new logic (coverage thresholds)
- Do NOT modify packages owned by other developer
- Run `validate` before finishing

**Commands You Can Run:**
- bun --filter @repo-stitcher/<pkg> test --watch
- bun --filter @repo-stitcher/<pkg> run typecheck
- bun --filter @repo-stitcher/<pkg> run lint

**Output Format:**
Return a summary of:
- Files created/modified
- Tests added
- Validation result (pass/fail)
- Any blockers
```

---

## 7. Phase Completion Checklist (Per Phase)

Before marking any phase `✅ Completed` in `PROGRESS.md`:

```
☐ Code implemented in correct package/module (per ARCHITECTURE.md)
☐ Types exported via core/src/index.ts (if core)
☐ Tests written + passing (coverage thresholds met)
☐ bun run typecheck passes (zero errors)
☐ bun run lint passes (zero errors)
☐ bun run build passes
☐ No restricted imports (ESLint clean)
☐ No hardcoded secrets
☐ Documentation updated (JSDoc for public API, README if user-facing)
☐ PROGRESS.md updated with ✅
☐ If API changed: DECISIONS.md ADR appended
```

---

## 8. Common Pitfalls to Avoid

| Pitfall | Prevention |
|---------|------------|
| Importing `core` internals in `cli`/`web` | Only import from `@repo-stitcher/core` (public API) |
| Using `axios` instead of `fetch` | ESLint `no-restricted-imports` |
| Using `Date` instead of `Temporal` | ESLint rule; use `@js-temporal/polyfill` |
| Throwing errors instead of `Result` | ESLint `no-throw` (custom rule) |
| Hardcoding `localhost:3434` | Use `config.server.port` |
| Skipping `git-filter-repo` in tests | Use fixture repos; test real binary |
| Not handling Docker unavailable | `sandbox/fallback.ts` path required |
| Assuming GitHub API shapes | Read INTEGRATIONS.md; use Octokit types |
| Forgetting WS reconnect logic | `useWebSocket` hook handles it |
| Not redacting secrets in logs | `logger.redact` does it automatically |

---

## 9. Agent Personas (For Different Task Types)

### 9.1 **Core Engineer** (inbesat's agent)
- **Focus:** `packages/core` — git, github, deps, license, ai, sandbox, provenance, orchestration
- **Commands:** `bun --filter @repo-stitcher/core test --watch`
- **Output:** Typed, tested, documented modules

### 9.2 **CLI Engineer** (aradhy's agent)
- **Focus:** `packages/cli` — commander commands, ink TUI, elysia server
- **Commands:** `bun --filter @repo-stitcher/cli test --watch`
- **Output:** Usable CLI + HTTP/WS server

### 9.3 **Web Engineer** (aradhy's agent)
- **Focus:** `packages/web` — React pages, components, hooks, store
- **Commands:** `bun --filter @repo-stitcher/web test --watch`
- **Output:** Accessible, responsive dashboard

### 9.4 **Integration Engineer** (either)
- **Focus:** Connecting pieces — CLI server ↔ Web UI, Core ↔ Sandbox, etc.
- **Commands:** `bun run dev:cli` + `bun run dev:web` together
- **Output:** End-to-end working flows

---

## 10. Emergency Commands

```bash
# Reset everything (nuclear)
bun pm cache rm && rm -rf node_modules packages/*/node_modules && bun install

# Fix husky hooks
bun run prepare

# Regenerate lockfile
bun install --frozen-lockfile=false

# Check for outdated deps
bun outdated

# Audit security
bun audit

# Clean build artifacts
rm -rf packages/*/dist packages/*/build
```

---

*End of AGENTS.md. This file is the contract for all AI-assisted work. Violations = blocked PR.*