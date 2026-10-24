# TESTING.md — the unit-test conventions (P-253)

The suite is the safety net that makes a phase shippable. These are the rules
every `*.test.ts` in this repo follows, and they are enforced — see
[The guard](#the-guard) at the end. `CONTRIBUTING.md` §5.1-5.5 covers the
coverage bar, the critical paths and the `validate()` loop; this document is
the layout, determinism and isolation half.

## Runner

| Command | What it runs |
|---|---|
| `bun run test` | every project in `vitest.config.ts` (`projects: ['packages/*']`) |
| `bun run test:unit` | the aggregate unit alias used by CI and docs |
| `bun run test:coverage` | the same run with the per-package thresholds enforced (what CI runs) |
| `bun run --filter @repo-stitcher/<pkg> test` | one package |
| `bun test` | Bun's own runner — a **fallback only** (P-004), it does not read the vitest projects |

The mandated driver files (`packages/*/test_*.py`, `docs/test_*.py`) are plain
scripts, not pytest, and are run with `uv run --no-project python <file>.py`
(bare `python` is a Windows Store stub on the reference machine). A driver
prints one `ok <name>` / `FAIL <name>: <error>` line per test and exits non-zero
on failure.

## Layout and naming

- Colocate the suite with the source: `foo.ts` -> `foo.test.ts` beside it.
- Cross-cutting or multi-module guarantees use `*.spec.ts` (for example
  `packages/cli/src/api/contract.conform.spec.ts`).
- Integration-style suites under a `__tests__/` directory are allowed where the
  package already has one.
- Shared helpers live in `src/test/helpers.ts` **per package** — not in a root
  `test-utils` package. Each package owns its mocks so they can diverge.
- Name the subject and the behaviour: `describe('ToolRegistry')` and
  `it('refuses a duplicate tool name')`. An `it` that reads like a function name
  (`it('call')`) is a bug in the test.

## One test, one behaviour

Arrange, Act, Assert — in that order, with blank lines between them. Assert one
behaviour per `it`; a second behaviour gets a second `it`. Empty assertions
(`expect(true).toBe(true)`), assertion-free tests and commented-out assertions
are prohibited: they inflate the count and prove nothing.

Round-trip guarantees are asserted as round trips (write then read, publish then
receive), not as two unrelated halves.

## Determinism

A test that fails at midnight is not a test.

- Never call `Date.now()`, `new Date()` or `Math.random()` in a test or in a
  helper. Inject the clock instead: `Bus` takes `{ now }`, `fakeBus()` fixes it
  to `FROZEN_NOW` (`2026-01-01T00:00:00.000Z`).
- Token and cost arithmetic is pinned with `tokenFreeze(messages, model)`
  rather than recomputed from a live counter.
- Timers are faked with `vi.useFakeTimers()` (web/UI code), never awaited with a
  real sleep.
- A python driver must be deterministic too: no wall clock in an expected value,
  no network, and a temp directory per run.

## Isolation

- No real network. Mock providers (`mockProvider()`, `mockOpenRouter()` from
  P-144) do zero I/O; never point a test at a live endpoint.
- No writes outside a temp directory: use `tempDir()` / `withTempDir()`, which
  removes the directory in a `finally` even when the assertion fails.
- No dependency on the developer's home directory or environment: pass the
  directory in, or use `withEnv()` to set and restore variables.
- Git work uses a real fixture repo (`mkFixtureRepo()` / `withFixtureRepo()`),
  which is disposed afterwards — no test touches the repo it lives in.
- The event bus is per test (`fakeBus()`), never the shared singleton, so no
  subscription can leak between tests.

## Coverage

Thresholds are configured per package in the root `vitest.config.ts` and
enforced by `bun run test:coverage`:

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `@repo-stitcher/core` | 80 | 70 | 80 | 80 |
| `@repo-stitcher/cli` | 70 | 60 | 70 | 70 |
| `@repo-stitcher/web` | 60 | 50 | 60 | 60 |

`@repo-stitcher/web` pins a stricter bar in its own `vitest.config.ts` (75/65/70/75)
because its suite is already above the workspace minimum; the workspace glob is
the floor, not the target. Core's per-domain scripts (`test:license`, `test:ai`,
`test:sandbox`, `test:provenance`, `test:agent:e2e`) enforce the same 80/70/80/80
over their own include.

## Shared helpers

`packages/core/src/test/helpers.ts`:

| Helper | What it gives a test |
|---|---|
| `FROZEN_NOW` | the one timestamp deterministic tests use |
| `tempDir(prefix?)` | a fresh temp directory |
| `withTempDir(fn, prefix?)` | a temp directory removed in a `finally` |
| `writeFixtureFile(root, relative, content)` | a file with its parents created |
| `mkFixtureRepo(files, options?)` / `withFixtureRepo(files, fn, options?)` | a committed git repo (the P-188 fixture pattern) with `repo.git(args)` |
| `readNotes(root, ref?)` / `expectNotes(root, needle, ref?)` | the git note provenance writes (P-188) |
| `mockProvider(config?)` / `mockOpenRouter(config?)` | the offline provider (P-144) |
| `fakeBus(now?)` | a `Bus` with a frozen clock (P-241) |
| `tokenFreeze(messages, model)` | a pinned token count and cost (P-137) |

`packages/cli/src/test/helpers.ts`: `FROZEN_NOW`, `tempDir`, `withTempDir`,
`writeFixtureFile`, `captureStdio(fn)` (reads what a command wrote to stdout and
stderr) and `withEnv(vars, fn)` (sets and restores environment variables).

`packages/web/src/test/setup.ts` is the P-236 jsdom harness (match-media stub,
`ResizeObserver` stub) and is loaded through `setupFiles` for every web test.

These helpers are **not** re-exported from the core barrel: they are test-only
utilities, so a broken environment surfaces as a failing test rather than as a
public API that throws.

## The guard

`packages/core/src/test/test.guard.test.ts` walks every test file in the
workspace and fails the build when:

1. a focused test (`.only`) is committed — there is no allowlist;
2. a skipped test (`.skip`) has no linked issue: write `// skip-ok: <issue URL or #123>`
   on the same line or the line directly above it;
3. a shared helper in `packages/*/src/test/helpers.ts` mentions `fetch(`,
   `XMLHttpRequest`, `axios`, `Math.random(` or `Date.now(`;
4. the conventions drift: `TESTING.md` must keep its headings,
   `CONTRIBUTING.md` must link it, root `bunfig.toml` must keep its `[test]`
   section, root `package.json` must keep `test:unit`.

The same `.only` / `.skip` rule is enforced by ESLint
(`eslint.config.mjs`, `no-restricted-syntax`), so an editor with lint-on-save
catches it before a commit does.

## Related

- `CONTRIBUTING.md` §5 — coverage thresholds, the critical paths, `validate()`.
- `docs/test_eval_md.py`, `docs/test_confidence_md.py`, `docs/test_mcp_quickstart.py` —
  the documentation drivers, and the shape a python id follows.
- P-253 in `project-plans/PHASES_DETAILED.md`; ADR-177 for the decisions.
