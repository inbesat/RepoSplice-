---
name: add-cli-command
description: Add or change a stitch CLI command, its flags, and its exit behaviour. Use when touching packages/cli/src/commands or the command registration.
triggers:
  - "add a command"
  - "new CLI"
  - "packages/cli/src/commands"
  - "stitch <verb>"
  - "exit code"
  - "TUI"
edges:
  - target: context/conventions.md
    condition: for the error and exit contract
  - target: context/architecture.md
    condition: when the command touches core or the server
  - target: context/setup.md
    condition: when the command needs environment variables
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2KJV1N5JFVPBRXWRHYG1A
  type: pattern
  status: promoted
  revision: 4
  title: add-cli-command
  relations:
    - type: related_to
      target: mx_01M5G2K99N5VSF22C75FZCPNET
      note: for the error and exit contract
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: when the command touches core or the server
    - type: related_to
      target: mx_01M5G2KHT2JH4Y5MWRE1TP1NQB
      note: when the command needs environment variables
---

# Add a CLI Command

## Context

The CLI is a Commander program with an Ink TUI. Two registration points exist and the
split is deliberate:

- [`createProgram()`](mex://function:92bd23a3bb612fed18bcec05b49a7525)
  (`packages/cli/src/program.ts`) — the base program: name `stitch`, description
  "AI-augmented multi-repo composition", `--version` only in long form (`-V` belongs to
  `--verbose`), and `doctor` registered here.
- [`buildCLI()`](mex://function:2a2b91e60143479273dcdf47ea78faa3)
  (`packages/cli/src/cli.ts`) — the workspace commands (`init`, `add`, `serve`, `status`,
  `audit`, `license`, `deps`, `merge`, `eval`, `config`).

The split exists to avoid an import cycle (ADR-075, ADR-076). A new workspace command
goes in `buildCLI`, not in `createProgram`.

## Steps

1. Create `packages/cli/src/commands/<name>.ts`. Follow an existing command's shape:
   export a `register<Name>Command(program)` function that attaches the command.
2. Register it inside `buildCLI()` in `packages/cli/src/cli.ts`. Only `doctor` is registered
   from `program.ts` — see
   [`registerDoctorCommand()`](mex://function:4374b3ac71a91464ce107d73a026f9bf) as the
   example of the other registration path.
3. Return `Result` values; let the entrypoint map them. Use
   [`exitCodeForResult()`](mex://function:3f4bd07c7477844173ba24d83a7d3898) in
   `packages/cli/src/errors.ts` — never call `process.exit` directly and never throw.
4. For any user-supplied name or path, call `validateName()` / `safeJoin()` from
   `packages/cli/src/paths.ts` (ADR-090). Do not hand-roll path containment.
5. Log through `packages/cli/src/log.ts`, never `console.log`. `console.log` is allowed in
   CLI command output but the shared `logger` is what redacts secrets (ADR-091).
6. Read flags through `packages/cli/src/flags.ts` — all perf/tuning flags are centralised
   there (ADR-089).
7. For a TUI command, use Ink's `instance.rerender()` snapshots and coalesce bursts on
   Ink's `Throttle` (ADR-084). Prefer the hand-built pickers over Ink's `useInput`
   (ADR-081 to ADR-083).
8. Keep the `theme()` picocolors contract byte-for-byte (ADR-087).
9. Add the command's tests beside it (e.g. `packages/cli/src/commands/<name>.test.ts`).
   Commander tests call `exitOverride()` so the process does not exit mid-test.

## Gotchas

- **Registering in the wrong place.** Adding a workspace command to `createProgram()`
  reintroduces the import cycle the split was created to avoid.
- **`-V` is not `--version`.** The version flag is long-form only; `-V` is the verbose
  flag (ADR-075).
- **Two exit-code pin points.** `packages/cli/src/errors.ts` owns `ExitCode` and
  `EXIT_BY_CODE`; `cli.ts` used to own `EXIT_OK`/`EXIT_ERROR`/`EXIT_USAGE` and no longer
  does (ADR-088). `EXIT_BY_CODE` is sparse — an unlisted error code falls through to
  `ERROR` (1), so add the mapping there if you introduce a new error code.
- **Hardcoded ports.** Never hardcode `localhost:3434`; read `config.server.port` from the
  merged config (`loadConfig` in `packages/cli/src/config.ts`).
- **Config loading under Vitest.** `packages/cli/src/config.ts` loads project config with
  smol-toml because `Bun.TOML` cannot run under Vitest (ADR-085).
- **Process spawning.** The editor is spawned over an argument array, which is injection
  safe by construction (ADR-086). Do not build a shell command string.

## Verify

- [ ] `bun run typecheck` — 0 errors.
- [ ] `bun run lint` — 0 errors for owned files. (The root lint currently reports 18
      formatting errors in concurrent P-331 taxonomy files; they are not yours, do not
      fix them in this lane.)
- [ ] `bun run test` — CLI suite passes; CLI coverage stays at or above 70/60/70/70.
- [ ] The command runs against a fixture repo and exits with the intended code.
- [ ] `stitch doctor` still passes (it gates Git >= 2.40, git-filter-repo and Docker).

## Debug

- **The command does not appear in `--help`** — it was not registered, or it was
  registered on a program instance that is never attached.
- **The process exits with code 1 instead of the specific code** — the error code is not
  in `EXIT_BY_CODE`.
- **Tests hang or the process exits** — `exitOverride()` is missing on the Commander
  program under test.
- **A config value is undefined in tests but works in the terminal** — the test reads the
  file directly instead of going through `loadConfig`, which merges layers.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
