# Handoff: Wave 0 → Wave 1

**From:** inbesat (Wave 0: foundation, deps, contract freeze)
**To:** aradhy (Wave 1: `packages/cli` + `packages/web`)
**Repo:** <https://github.com/inbesat/RepoSplice-.git>

Wave 0 is closed: the repository is on GitHub, the wire contracts are frozen and
gated, the shared types package exists, and the branch model is documented. This
file is everything you need to clone, install, run, and start Wave 1.

---

## 1. Wave 0 handoff checklist

| Checklist item | Status | Where it landed |
| --- | --- | --- |
| Repo pushed to the shared remote (GitHub) | Done | `origin/main` (release) and `origin/dev` (integration) are pushed |
| `HANDOFF.md` with clone URL, branch, `bun install`, `bun run dev:cli`, `bun run dev:web` | Done | this file; sections 2–4 |
| `core/src/types/index.ts` frozen (no breaking change without a version bump) | Done, under a different path | `packages/core/src/types/` holds only ambient `d.ts` shims — the real contract lives in `packages/core/src/events/{topics,bus,progress}.ts` and `packages/core/src/jobs/types.ts` |
| WS message schema in `core/src/types/ws.ts` frozen | Done, under a different path | the envelope + topics live in `packages/core/src/events/topics.ts` (`eventEnvelopeSchema`, zod) and are mirrored by the web client `packages/web/src/lib/ws.ts` (`WsEnvelope`) |
| All deps for `cli` and `web` already declared | Done, under a different layout | this is a Bun workspace: deps live in `packages/<pkg>/package.json`, the root manifest only holds scripts. Add deps to your own package manifest, never the root one |
| `stitch doctor` passes | Command + expected output below | verified on the owner's machine (2026-10-20); the run on your machine is yours to do |

The frozen paths above are enforced by `bun run check:contracts` (CI job
`contract-freeze`). See [CONTRACTS.md](CONTRACTS.md) for the change procedure.

## 2. Clone

```bash
git clone https://github.com/inbesat/RepoSplice-.git
cd RepoSplice-
git checkout dev          # the integration branch — start here
```

Branches:

- `main` — protected, release-ready, tagged. Never push directly.
- `dev` — integration branch and the default PR base.
- `feat/…`, `fix/…`, `chore/…` — your working branches, cut from `dev`
  (naming rules: [CONTRIBUTING.md](CONTRIBUTING.md) §1).

Push a branch and open the PR against `dev`:

```bash
git push -u origin feat/web/whatever
```

## 3. Install

Requirements: **bun ≥ 1.1** (the repo is a Bun workspace) and **git**. Node ≥ 22
is optional (the CLI reports it as optional).

```bash
bun install
```

`bun install` links the workspace packages (`@repo-stitcher/core`,
`@repo-stitcher/cli`, `@repo-stitcher/shared`, `@repo-stitcher/web`) — no extra
setup.

## 4. Run

```bash
bun run dev:web        # Vite dev server on http://127.0.0.1:5173
bun run dev:cli        # the CLI from source, with --watch
bun run dev:cli -- doctor   # run one CLI command under the watcher
```

Without the watcher: `bun packages/cli/src/index.ts doctor` (or any other
command — `bun packages/cli/src/index.ts --help` lists them).

The web app expects the CLI's API on `http://127.0.0.1:3434` (the dev server
proxies `/api` and `/ws` there), so run `bun packages/cli/src/index.ts serve`
alongside `bun run dev:web` for a full local stack.

## 5. Verify your machine

```bash
bun packages/cli/src/index.ts doctor
```

Expected output on a healthy machine (owner-verified 2026-10-20):

```
PASS git 2.45.1 (>= 2.40.0)
PASS git-filter-repo a40bce548d2c
WARN docker daemon (optional) — Start Docker Desktop… stitch falls back to GH Actions (P-178)
PASS bun 1.3.11 (>= 1.1.0)
PASS node 24.14.1 (optional, >= 22)
WARN config validity (optional) — authType=pat requires a token… set github.token / GITHUB_TOKEN / --github-token
```

The two `WARN` lines are optional paths (Docker sandboxing, GitHub auth) — they
do not block Wave 1. `doctor` exits 0.

Then the repo gates:

```bash
bun run typecheck          # tsc --noEmit across the workspace
bun run lint               # eslint + prettier
bun run test               # vitest run (core, cli, web)
bun run check:contracts    # the frozen-contract gate
```

Web-specific:

```bash
bun --filter @repo-stitcher/web run test:cov     # coverage gate
bun --filter @repo-stitcher/web run test:e2e     # Playwright (chromium)
bun --filter @repo-stitcher/web run build        # required before test:perf
bun --filter @repo-stitcher/web run test:perf    # vitals + bundle budget
```

## 6. Ownership and the frozen contracts

| Path | Owner | You may |
| --- | --- | --- |
| `packages/core/**` | inbesat | read only — ask for a change (see §7 of this file) |
| `packages/cli/**` | aradhy | edit freely |
| `packages/web/**` | aradhy | edit freely |
| `packages/shared/**` | inbesat | read only — it is the shared wire-DTO home |
| root config (`tsconfig.base.json`, `eslint.config.mjs`, `commitlint.config.cjs`, `vitest.config.ts`, `ARCHITECTURE.md`, `AGENTS.md`, `SECURITY.md`) | either | only with an ADR |

Frozen wire contracts (the P-314 gate):

- `packages/core/src/events/topics.ts` — topics, envelope schema, payload types
- `packages/core/src/events/bus.ts` — bus contract
- `packages/core/src/events/progress.ts` — progress aggregation
- `packages/core/src/jobs/types.ts` — job status/record/event types
- `packages/web/src/lib/ws.ts` — the web's WS client mirror

To change one:

1. Write an ADR in `project-plans/DECISIONS.md` with a
   `contract-freeze: <path>` marker inside an `## ADR-…` section.
2. Refresh the manifest: `bun run check:contracts:update`.
3. Commit the ADR and the refreshed `contracts.freeze.json` together.

Without the ADR marker the gate fails the build.

## 7. Getting the repo as a ZIP

If you cannot use git, ask the owner for an archive of the `dev` branch, or
build one from a clone:

```bash
git archive --format=zip --output=RepoSplice-handoff.zip dev
```

Then unzip and install:

```bash
unzip RepoSplice-handoff.zip -d RepoSplice-
cd RepoSplice-
bun install
```

Caveats: the archive has **no `.git`**, so branches, PRs, and the branch model
do not apply — work on a copy and hand the diff back, or ask for git access.
Archives are point-in-time snapshots; ask the owner for a fresh one when you
need the latest `dev`.

## 8. The workflow contract

- **Branches and PR base** — [BRANCHING.md](BRANCHING.md) (the `dev`/`main`
  model, the PR rules table, and the GitHub settings the owner must enable).
- **Commit and PR conventions** — [CONTRIBUTING.md](CONTRIBUTING.md)
  (Conventional Commits, branch naming, the PR template, coverage thresholds,
  the local validation loop, the frozen-file list).
- **Contracts** — [CONTRACTS.md](CONTRACTS.md).
- **PR template** — `.github/pull_request_template.md`. Fill it in; the
  reviewer is chosen by the packages you touched (`packages/core` → inbesat,
  `packages/cli` + `packages/web` → aradhy).
- **CI** — `lint-and-typecheck`, `test`, `web-test`, `web-e2e`, `perf`,
  `contract-freeze`, `build`. A red budget or contract check is the signal to
  fix the change, not to raise the limit.

Welcome aboard — start with `packages/web` (the Web epic shipped P-208…P-237)
or `packages/cli`, and open your PR against `dev`.
