# Contributing to repo-stitcher

**Version:** 1.0.0
**Audience:** owner agents (`inbesat` = core, `aradhy` = cli/web) and external contributors

Thank you for contributing. This file is the contract for how code lands in this repo. It's enforced by CI + husky hooks; deviations require an ADR in `project-plans/DECISIONS.md`.

For the **authoritative technical map**, see [`project-plans/ARCHITECTURE.md`](./project-plans/ARCHITECTURE.md). For the **phase plan**, see [`project-plans/PHASES_DETAILED.md`](./project-plans/PHASES_DETAILED.md). For the **enforcement rules** that are mirrored here, see [`project-plans/AGENTS.md`](./project-plans/AGENTS.md).

---

## 1. Branch Naming

All branches use a `<type>/<scope>/<short-desc>` format. Types:

| Type | When to use | Example |
|------|-------------|---------|
| `feat/` | New feature or module | `feat/core/git-clone`, `feat/web/merge-wizard` |
| `fix/` | Bug fix | `fix/config/load-env-order` |
| `chore/` | Tooling, deps, refactor with no behavior change | `chore/eslint-flat-config` |
| `docs/` | Documentation only | `docs/contributing-update` |
| `test/` | Test-only changes | `test/core/license-fixtures` |
| `release/` | Release prep (version bumps, changelogs) | `release/v0.1.0` |

Scope is the **package or system** being touched (`core`, `cli`, `web`, `root`, `ci`, `docs`). Use the first scope that matches the primary change.

Branch names are lowercase, kebab-case, max 60 chars. No ticket numbers in the branch name (keep them in commit messages if relevant).

---

## 2. Commit Messages — Conventional Commits

We use [Conventional Commits](https://www.conventionalcommends.org/) enforced by `commitlint`. The format is:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **Type** (required, from a fixed list): `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`, `security`
- **Scope** (recommended): the package or system, e.g. `core`, `cli`, `web`, `root`, `logger`, `config`, `result`, `util`, `deps`, `ci`, `release`
- **Subject** (required): imperative mood, lowercase, no period, max 72 chars
- **Body** (optional): wrap at 100 chars; explain **what** and **why**, not how
- **Footer** (optional): `BREAKING CHANGE: <desc>`, or `Refs: <phase>`, or `Closes: <issue>`

Examples:

```
feat(core): add monotonic job-id generator with timestamp+sequence+random

Provides a sortable, process-safe id builder used by the job queue
(P-239) and the provenance ledger (P-181). Format:
  job_<base36-ts>_<base36-seq>_<12-char-nanoid>

Refs: P-012
```

```
fix(cli): handle empty repo URL gracefully in stitch add

Previously, `stitch add` would call GitHub with an empty string and
return a confusing 404. Now returns a typed CONFIG_ERROR.

Closes: #142
```

### 2.1 Commit hooks

Two git hooks run on every commit (set up in P-005):

- **pre-commit:** `lint-staged` runs `prettier --write` then `eslint --fix` on staged files matching `*.{ts,tsx,js,jsx,mjs,cjs,json,md}`. Fix any auto-fixable issues locally; fix the rest by hand.
- **commit-msg:** `commitlint --edit` validates the message. If it fails, amend with a new message — don't bypass the hook.

---

## 3. Pull Request Process

### 3.1 PR title and body

Use the same Conventional Commits format for the **PR title** (this becomes the merge commit message). The body uses the [PR template](.github/pull_request_template.md) which captures:

- **Summary** — what changed and why
- **Testing** — what you ran, what passed, what didn't
- **Screenshots** — required for any UI change
- **Changeset** — required for any user-facing change (see §6)
- **Risk + rollback** — call out anything that could break production

### 3.2 Reviewers

- **Phase owner** reviews: changes to `packages/core/*` need inbesat; `packages/cli/*` and `packages/web/*` need aradhy; root tooling needs either
- **CODEOWNERS** file (P-188 follow-up) will eventually automate this
- At least one approval required before merge

### 3.3 CI gates

`.github/workflows/ci.yml` runs on every PR. All four jobs must pass:

- `lint-and-typecheck` — `bun run lint` + `bun run typecheck`
- `test` — `bun test --coverage` (with codecov upload)
- `build` — `bun run build` (after P-062 lands tsup)
- `docker` (master branch) — `docker/sandbox-base.Dockerfile` build

PRs cannot be merged with failing checks. Dependabot weekly PRs are auto-merged for patch-level updates.

---

## 4. Code Style

### 4.1 Non-negotiable rules (enforced by ESLint)

These are mirrored from `AGENTS.md` §1 — breaking any of them blocks merge:

- **TECH_STACK** adherence: Bun (not Node), TypeScript, Elysia (not Express), Zustand+TanStack Query (not Redux), Vitest (not Jest), Zod (not Joi/Yup), ofetch (not axios), Temporal (not moment/date-fns), `bun:sqlite` (not better-sqlite3), tsup (not esbuild/rollup/webpack), native WebSocket (not socket.io/ws). The full list lives in `eslint.config.mjs` under `no-restricted-imports`.
- **No hardcoded secrets, keys, or tokens.** The `logger.redact` list (P-010) covers 9 field names + 6 literal paths; auto-redacted on log.
- **No `any` in TypeScript** (`@typescript-eslint/no-explicit-any: error`).
- **No `throw new Error(...)` in core public functions** — return `Result<T, StitchError>` instead. The ESLint `no-throw-literal` rule catches string throws; deeper enforcement is reviewer + the AGENTS §1 no-throw rule.
- **Max function body 50 lines**, max 4 parameters. Use config objects.
- **Import order**: external → `@repo-stitcher/*` → relative. ESLint `import/order`.

### 4.2 Formatter (Prettier)

- 2 spaces, single quotes, semicolons, trailing comma = "es5", print width = 100, endOfLine = `lf`
- `bun run format` to fix; CI runs `bun run format:check`
- `.prettierignore` excludes `project-plans/` (docs have their own style), lockfiles, coverage output, `.md` (we do lint+format `.md` for now; toggle if it gets noisy)

### 4.3 Naming

- Files: `camelCase.ts` for utilities (`paths.ts`, `id.ts`); `PascalCase.tsx` for React components
- Exports: `camelCase` for functions/vars, `PascalCase` for classes/types, `SCREAMING_SNAKE_CASE` for env-var constants
- Test files: co-located `<unit>.test.ts` (most) or in `__tests__/unit.test.ts` when the spec calls for it (e.g. P-011, P-012 follow spec)
- Use `Result<T, E>` for any function that can fail; name the success type explicitly

### 4.4 Error handling — the Result contract (P-011)

Every public function in `packages/core` returns `Result<T, StitchError>` from neverthrow. Use the helpers:

```ts
import { ok, err, fromInternalPromise, match } from '@repo-stitcher/core';

// synchronous
export function loadFoo(): Result<Foo, StitchError> {
  if (cache.has('foo')) return ok(cache.get('foo')!);
  return err({ code: 'CONFIG_ERROR', field: 'foo', message: 'not found' });
}

// async
export async function fetchBar(): Promise<Result<Bar, StitchError>> {
  return fromInternalPromise(fetch('https://api/...'), 'fetchBar');
  // rejection → { code: 'INTERNAL', message: 'fetchBar: <reason>', cause: <Error> }
}

// exhaustive handling
const value = match(result, {
  onOk: (cfg) => cfg.sandbox.backend,
  onErr: (e) => 'docker',  // both branches required → compile-time enforced
});
```

For 13 `StitchError` codes and the discriminated union shape, see `ARCHITECTURE.md` §13.1.

### 4.5 Logging

```ts
import { logger, createJobLogger } from '@repo-stitcher/core';

logger.info({ event: 'clone.start', repo: 'x/y' });  // auto-structured

// in a job context
const jobLog = createJobLogger(jobId);
jobLog.warn({ step: 'merge' }, 'manual conflict resolution needed');
```

The 9 sensitive field names (apiKey, token, secret, password, privateKey, accessToken, refreshToken, webhookSecret, signingKey) are auto-redacted at any depth. See `ARCHITECTURE.md` §13.3.

### 4.6 Config

No hardcoded config. Anything user-tunable goes through `loadConfig`:

```ts
import { loadConfig } from '@repo-stitcher/core';

const cfg = loadConfig({
  file: { github: { token: process.env.GITHUB_TOKEN } },
  env: { paths: { cacheDir: process.env.REPO_STITCHER_CACHE_DIR } },
});
// precedence: defaults < file < env < cli
// credential validation runs after parse
```

See `ARCHITECTURE.md` §13.2 for the layered-merge semantics.

---

## 5. Testing Requirements

### 5.1 Coverage thresholds (enforced by Vitest)

| Package | Statements | Branches | Functions | Lines |
|---------|------------|----------|-----------|-------|
| **core** | 80% | 70% | 80% | 80% |
| **cli**  | 70% | 60% | 70% | 70% |
| **web**  | 60% | 50% | 60% | 60% |

Per-glob thresholds live in `vitest.config.ts`. CI fails if any package drops below.

### 5.2 Test patterns

```ts
// Pure unit (colocated <unit>.test.ts)
import { describe, it, expect } from 'vitest';
import { mergeManifests } from './merge';

describe('mergeManifests', () => {
  it('resolves semver collision', () => {
    const result = mergeManifests([
      { dependencies: { foo: '^1.0.0' } },
      { dependencies: { foo: '^2.0.0' } },
    ]);
    expect(result.conflicts).toHaveLength(1);
  });
});

// Integration with fixtures
import { createTempDir, writeFixture } from './test-utils';

it('stitches two JS repos end-to-end', async () => {
  const dir = await createTempDir();
  // write fixture repos A and B
  // run stitch merge via CLI
  // assert child repo builds + tests pass
});
```

### 5.3 Critical paths that MUST have tests

- `core/git/` — clone, filter-repo, merge, push (fixture repos)
- `core/deps/merge.ts` — collision resolution, semver logic
- `core/license/compat.ts` — SPDX matrix, GPL detection
- `core/ai/loop.ts` — agent loop, tool execution, gated flow
- `core/sandbox/runner.ts` — Docker + GH Actions paths
- `core/orchestration/pipeline.ts` — state machine, retry, rollback
- `core/result/` — Result/StitchError contracts (covered in P-011)
- `core/util/` — id monotonicity, path escape rejection, ignore matcher (covered in P-012)

### 5.4 The `validate()` loop

Before every commit, run the full local validation:

```bash
bun run typecheck    # 0 errors
bun run lint         # 0 errors
bun test             # all pass
bun test --coverage  # thresholds met
bun run format:check # prettier clean
```

All five must exit 0. Husky pre-commit + commit-msg handle the formatting + message validation, but the test/coverage/typecheck must be run manually.

### 5.5 Frozen files

Per `AGENTS.md` §1, these files require an ADR in `project-plans/DECISIONS.md` to change:

- `tsconfig.base.json` (strict baseline)
- `eslint.config.mjs` (enforced rules)
- `commitlint.config.cjs` (type-enum)
- `vitest.config.ts` (coverage thresholds)
- `project-plans/ARCHITECTURE.md` (structural map)
- `project-plans/AGENTS.md` (sub-agent rules)
- `project-plans/SECURITY.md` (security boundaries)

If your PR modifies any of these, link the ADR in the PR body.

---

## 6. Release Process

### 6.1 Changesets

We use [changesets](https://github.com/changesets/changesets) for versioning. For any user-facing change, add a changeset file in `.changeset/`:

```bash
bunx changeset
# pick the affected package (e.g. @repo-stitcher/core)
# pick the bump type (patch / minor / major)
# write a one-line summary
```

This creates `.changeset/<random-name>.md`. Commit it with your PR. CI does NOT auto-version; versioning happens in the release workflow.

### 6.2 Release workflow

`.github/workflows/release.yml` runs on push to `main`:

1. `@changesets/action@v1` collects pending changesets
2. Versions are bumped, CHANGELOG.md files are regenerated
3. `bun run changeset publish` runs (requires `NPM_TOKEN` + `GITHUB_TOKEN` secrets)
4. A GitHub release is created from the version tag

For private packages (current state until P-278), the publish step is a no-op but the version/changelog steps still run.

### 6.3 When to bump

- `patch` — bug fix, perf, no API change
- `minor` — new feature, backward-compatible
- `major` — breaking change (also add `BREAKING CHANGE:` to the changeset body)

---

## 7. Common Pitfalls

| Pitfall | Prevention |
|---------|------------|
| Importing `core` internals from `cli`/`web` | Only import from `@repo-stitcher/core` (public API) |
| Using `axios` instead of `fetch` | ESLint `no-restricted-imports` |
| Using `Date` instead of `Temporal` | Use `@js-temporal/polyfill` |
| Throwing errors instead of `Result` | ESLint `no-throw-literal` + reviewer |
| Hardcoding `localhost:3434` | Use `config.server.port` |
| Skipping `git-filter-repo` in tests | Use fixture repos; test real binary |
| Not handling Docker unavailable | `sandbox/fallback.ts` path required |
| Assuming GitHub API shapes | Read `INTEGRATIONS.md`; use Octokit types |
| Forgetting WS reconnect logic | `useWebSocket` hook handles it |
| Not redacting secrets in logs | `logger.redact` does it automatically |
| Forgetting to add a changeset | CI doesn't enforce; release does; check before merge |
| Using `as any` to bypass type errors | Fix the types; the only exception is `as const` |

---

## 8. Quick Reference — Common Commands

```bash
# install
bun install

# validate (the loop)
bun run typecheck
bun run lint
bun test
bun test --coverage
bun run format:check

# format + fix
bun run format
bun run lint:fix

# workspace
bun --filter @repo-stitcher/core run test
bun --filter @repo-stitcher/cli run typecheck

# watch
bun --filter @repo-stitcher/core test --watch

# one-off
bunx changeset
bunx changeset status
bunx hadolint docker/sandbox-base.Dockerfile
```

---

## 9. Phase completion checklist

Before marking any phase ✅ Completed in `project-plans/PROGRESS.md`:

```
☐ Code implemented in correct package/module (per ARCHITECTURE.md)
☐ Types exported via core/src/index.ts (if core)
☐ Tests written + passing (coverage thresholds met)
☐ bun run typecheck passes (zero errors)
☐ bun run lint passes (zero errors)
☐ bun run build passes (after P-062)
☐ No restricted imports (ESLint clean)
☐ No hardcoded secrets
☐ Documentation updated (JSDoc for public API, README if user-facing)
☐ PROGRESS.md updated with ✅
☐ If API changed: DECISIONS.md ADR appended
☐ If user-facing: changesets file added in .changeset/
```

---

*End of CONTRIBUTING.md. This file is the contract for every contribution; keep it consistent with `AGENTS.md` and `ARCHITECTURE.md`.*
