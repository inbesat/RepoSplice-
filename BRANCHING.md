# Git branching model

The repo runs a two-lane **package ownership** model on top of a small
`dev`/`main` branch structure. This document is the contract; `CONTRIBUTING.md`
links to it from the branch-naming and PR sections.

---

## 1. Branch roles

| Branch | Role | Who pushes | PR base for |
|---|---|---|---|
| `main` | Protected, release-ready, tagged. Every commit here shipped. | Release PRs only (`dev` → `main`) | `release/*`, `hotfix/*` |
| `dev` | Integration branch. The default base for every ordinary PR. | Release PRs only (`dev` → `main`) | All feature branches |
| `feat/…`, `fix/…`, `chore/…`, `docs/…`, `test/…`, `release/…`, `hotfix/…` | One branch per unit of work, named per `CONTRIBUTING.md` §1. | Anyone who owns the touched packages | `dev` (or `main` for `release/*` / `hotfix/*`) |

- `main` and `dev` are **never pushed to directly** — only through a pull
  request.
- `dev` starts from `main` and moves forward only. `main` receives `dev` via a
  release PR.
- There is no `develop` branch. (The CI workflow previously listened for
  `develop`, which never existed on the remote; the triggers now use `dev`.)

## 2. The flow

```
main ──► release PR ──► main ──► tag
 ▲                        ▲
 │                        │
 └────── merge dev ◄──────┘
             ▲
             │  PR (feat/… → dev)
             │
        feat/short-desc
```

1. Branch off `dev` with a name from `CONTRIBUTING.md` §1.
2. Work in small, reviewable commits (Conventional Commits, enforced by
   `commitlint`).
3. Open a PR **into `dev`** using the repository PR template.
4. CI must be green: `lint-and-typecheck`, `test`, `build`, plus the web jobs
   when `packages/web` changed. No merge with a failing check.
5. The owning reviewer approves (see §4).
6. Squash-merge into `dev`; the branch is deleted afterwards.
7. When `dev` is releasable, open a **release PR `dev` → `main`**. CI runs
   again; `main` is tagged on merge (`v<major>.<minor>.<patch>`).

A `hotfix/*` branch is cut from `main`, targets `main` directly, and is
back-merged into `dev` afterwards so the fix is not lost.

## 3. PR rules

| Rule | Requirement |
|---|---|
| Base branch | `dev` for everything except `release/*` and `hotfix/*` (those target `main`). The `pr-rules` CI check fails a PR that targets `main` from any other branch. |
| Title | Conventional Commits (`feat(web): …`, `fix(cli): …`, `docs(workflow): …`). |
| Body | The repository PR template (`.github/pull_request_template.md`) — summary, phase, packages touched, frozen files, testing performed + counts, changeset, risk/rollback. |
| Required checks | `lint-and-typecheck`, `test`, `build` (and `web-test` / `web-e2e` / `perf` when the web package changed). |
| Reviewers | At least one reviewer who owns the touched package (§4). |
| Changeset | Required for user-visible changes (see `CONTRIBUTING.md` §6). |
| Frozen files | A change to a frozen file (`tsconfig.base.json`, `eslint.config.mjs`, `commitlint.config.cjs`, `vitest.config.ts`, `ARCHITECTURE.md`, `AGENTS.md`, `SECURITY.md`) needs an ADR in `project-plans/DECISIONS.md`. |
| Merging | Squash-merge only, so `main` history stays linear and one commit equals one phase. |
| Branch cleanup | Delete the branch after merge. |
| Force-push | Never to `main` or `dev`. Force-push to a feature branch is allowed only when nobody else has based work on it. |
| Direct pushes | Forbidden on `main` and `dev`; both are protected (owner-side settings, §5). |

## 4. Two-lane ownership

Package isolation — not branching — is the conflict-avoidance mechanism:

| Package | Owner | Reviewer |
|---|---|---|
| `packages/core` | inbesat | inbesat review required |
| `packages/cli` | aradhy | aradhy review required |
| `packages/web` | aradhy | aradhy review required |
| root config, docs, CI | either | the other lane |

Rules that follow:

- Never touch another lane's package in the same PR — open one PR per lane.
- A PR that touches two packages needs both owners' approval.
- `packages/core/src/types` and the WebSocket schema are **frozen** after the
  P-314 contract-freeze gate; changing them needs an ADR and a schema
  version bump.

## 5. Owner-side GitHub settings

Branch protection can only be configured by the repository owner. Enable it on
`main` and `dev`:

- Require a pull request before merging; disallow direct pushes.
- Require the status checks listed in §3 to pass before merging.
- Require linear history (matches the squash-merge rule).
- Delete the head branch automatically after merge.
- Disallow force pushes.

The `pr-rules` workflow enforces the PR-base rule in CI, so a mis-targeted PR
is caught even before branch protection is enabled.

## 6. Local validation loop

Run the same gates CI runs, from the repository root:

```bash
bun run typecheck        # tsc --noEmit across the workspace
bun run lint             # eslint + prettier shape
bun run test             # vitest across all packages
bun run test:coverage    # coverage thresholds
cd packages/web && bun run test:e2e   # Playwright (needs chromium)
```

For the web package specifically:

```bash
cd packages/web
bun run typecheck
bun run test
bun run test:cov
bun run test:e2e
bun run test:perf        # needs a build first: bun run build
```

## 7. Changing this model

Deviating from the branching model — a different base branch, a non-squash
merge, bypassing a required check — needs an ADR in
`project-plans/DECISIONS.md` recording the reason and the rollback.
