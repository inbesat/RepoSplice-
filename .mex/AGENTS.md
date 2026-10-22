---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-10-22
---

# RepoSplice

## What This Is
Multi-repo composition engine that merges two or more Git repositories into a new, runnable, history-preserving child repository, with an AI agent loop resolving dependency and license conflicts.

## Non-Negotiables
- `packages/core` owns all business logic. `packages/cli` and `packages/web` may import it only through the public barrel `@repo-stitcher/core` — never `core/src/*` internals (ESLint `no-restricted-imports` + `bun run lint:deps`).
- Public functions return `Result<T, StitchError>` (neverthrow). Never `throw`, never `any`, never `console.log` (use the shared `logger`), and never hardcode a secret.
- The core-to-web wire contract is frozen. Changing `packages/core/src/events/{topics,bus,progress}.ts`, `packages/core/src/jobs/types.ts` or `packages/web/src/lib/ws.ts` requires an ADR in `project-plans/DECISIONS.md` plus `bun run check:contracts:update`.
- Lane ownership: `packages/core` belongs to the inbesat lane, `packages/cli` and `packages/web` to the aradhy lane. Do not edit another lane's files without asking.
- A gate that did not run is deferred, never passing. A missing number is never a zero.

## Commands
- Install: `bun install`
- Dev CLI: `bun run dev:cli` · Dev web: `bun run dev:web`
- Test: `bun run test` (`test:watch`, `test:coverage`)
- Lint: `bun run lint` · Deps: `bun run lint:deps` · Format: `bun run format`
- Typecheck: `bun run typecheck` · Full gate: `bun run validate`
- Build: `bun run build` (core) · `bun run build:web` · `bun run build:all`
- Contracts: `bun run check:contracts` · Eval schema: `bun run eval:schema:check`

## Project Knowledge
For a question about project decisions, conventions, or behavior, start with `mex wiki query "<question>" --limit 5 --json`. Inspect matched terms and each grounding's health: partial matches are leads, and `changed` means re-check the claim against code. If the index is unavailable, follow `ROUTER.md` or start from `mex graph scope "<task>"`. Reads never rebuild or refresh an index.

## Code Graph
Use the smallest relevant structured resolver. For Inbox or Relay mutations, resolve only the intended action with `mex inbox contract --action <command-id> --json` or `mex relay contract --action <command-id> --json`; use `mex capabilities --json` only for broader capability discovery. If the user explicitly asks to create, save, or draft a checkout-local Inbox or Relay draft, preview and apply that exact draft without asking for redundant confirmation. Deleting a local draft, or publishing, approving, rejecting, withdrawing, marking stale, repairing, taking or acknowledging, or closing, requires fresh explicit confirmation after semantic preview. Treat Git commit, push, and pull as separate actions requiring their own authorization.

The repo is indexed into `.mex/graph.db`. Use it to avoid re-reading code you already have — it is one tool alongside Grep/Glob, not a replacement for them.
- If you know the symbol name, go straight to it: `mex graph query <who-calls|what-calls|where-defined> <symbol>` and `mex graph get <id...>` are exact. This is the strongest part of the graph. Each call first proves the whole index is still fresh, so on a large repository it takes seconds: pass several ids to one `graph get` instead of calling it once per id. Give it exact names — an approximate name can return a confident wrong match.
- Exploring an unfamiliar task? `mex graph scope "<task>"` returns bounded, source-backed JSONL context plus trustworthy execution flows. Scope matches on words, not meaning, so treat it as starting evidence rather than a complete answer.
- Treat source returned by the graph as ALREADY READ; do not re-open those files.
- Read the summary status and evidence. `status: "ok"` remains usable when `truncated: true`; only optional evidence was omitted. For `partial` or `degraded`, narrow the task or follow `suggestedNextCommands`.
- Use `mex graph get <id> --detail source` only when source is missing, you need exact expansion, or a partial/degraded summary suggests it. Do not expand nodes by quota.
- If the evidence is insufficient or the task wording does not match the code, use Grep/Glob instead. Do not re-run `scope` with reworded phrasing more than once.
- Before editing a symbol, run `mex impact <symbol|file>` to see affected callers and scaffold memory.
- During `mex sync`, adjudicate any AMBIGUOUS grounding; after repairs, ensure the refreshed grounding is re-emitted.

## Scaffold Growth
After meaningful work, run GROW:
- Ground: what changed in reality?
- Record: update `ROUTER.md` and relevant `context/` files
- Connect: keep each section linked to its enclosing knowledge with `refines`; preview missing structural links with `mex wiki link-sections`, then apply explicitly. Add semantic relationships only with evidence; backlinks are derived.
- Orient: create or update a `patterns/` runbook if this can recur
- Write: bump `last_updated` on changed scaffold files; optional `mex log` notes follow the logging policy below

## Agent Logging
Read `mex logging --json` at session start and before optional logging. This checkout-local advisory preference is `significant` (quiet default: material decisions, risks, blockers, or durable discoveries), `checkpoints` (batch useful notes at task/session boundaries), or `manual` (no unsolicited notes). Skip routine tool calls, edits, repeated status, and empty summaries. Honor explicit user log requests in every mode; never suppress mandatory workflow Activity or recovery audit records. Report a policy read failure instead of guessing or changing the preference.

When earlier work may inform the task, use `mex timeline --query "subject phrase" --file src/example.ts --limit 10 --json` with a known subject or exact recorded file path, or both. These are historical notes, not accepted current knowledge. Verify conclusions before reuse or explicit promotion with their source retained.

The scaffold grows from real work, not just setup. See the GROW step in `ROUTER.md` for details.

## Navigation
At the start of every session, read `ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance — everything is there.

<!-- mex-agent:skills:start -->
## MEX context policy
- When MEX context materially helps your work, mention MEX and the relevant finding naturally in your explanation. Tie the mention to what it helped you understand, decide, or verify. Avoid fixed phrases, standalone acknowledgements, repeated mentions, or narrating routine context loading. This replaces older MEX instructions requiring a fixed acknowledgement or context-loading narration.
- Do not claim an author, date, or historical event unless the retrieved data actually provides it.
- After a MEX write, say exactly what changed and its sharing boundary: a local draft is checkout-only and nothing is shared; a canonical artifact is written to the working tree and requires commit/push to share.
- Skill activation is not approval for canonical actions.
<!-- mex-agent:skills:end -->
