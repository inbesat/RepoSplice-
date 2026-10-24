# MCP quickstart (P-365)

Take the RepoSplice MCP server from zero to a merge, entirely inside an MCP
host. The server is the same engine the CLI (`stitch`) uses: it reads the same
`~/.stitch/config.json`, so there is no second credential flow to set up.

Two status notes before you start — both are load-bearing, not caveats:

- the registry entry is **`not submitted`** (P-364), so `mcp install
  repo-stitcher` does not exist yet and you install from this checkout instead;
- `stitch_merge` reports a named refusal today because the core job API it
  needs is not exported yet (ADR-168). Everything else in this document runs.

## Prerequisites

| Requirement | Version / note |
|---|---|
| Bun | `>= 1.1.0` (runs the server: `bun run --filter @repo-stitcher/mcp server`) |
| Node | `>= 20.0.0` |
| This checkout | cloned and installed once with `bun install` |
| `git` | on `PATH`; `stitch_select_files` shells out to it for the file tree and last-commit data |
| Docker | optional; only `run_sandbox_build` needs it, and that tool reports its own availability |
| An MCP host | Claude Code, OpenCode or Cursor — see [Host-Specific Notes](#host-specific-notes) |

## Installation

The registry path (`mcp install repo-stitcher`) is not available while the entry
is `not submitted`. Register the server from this checkout instead — these are
the commands recorded in [MCP_COMPAT.md](MCP_COMPAT.md) and derived into
`MCP_REGISTRY_ENTRY.json`:

```bash
# Claude Code (stdio)
claude mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server

# OpenCode (HTTP)
opencode mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server --http

# Cursor: add packages/mcp/src/index.ts as a stdio MCP server in settings
```

Run it without a host to check it starts:

```bash
bun install
bun run mcp:server            # stdio, LSP Content-Length framing
bun run mcp:server -- --http  # HTTP on 127.0.0.1:3435, path /mcp
```

HTTP mode answers `GET /mcp/health` with `{"status":"ok"}` and takes JSON-RPC
frames on `POST /mcp`. The port comes from `--port <n>` or `MCP_PORT`, else
`3435`; the host binding is `127.0.0.1` unless a hostname is given.

## Configuration

The MCP server reads the **same** `~/.stitch/config.json` the CLI keeps and
caches nothing, so an edited config is picked up on the next server restart —
a running server keeps the configuration it started with.

A complete config looks like this:

```json
{
  "github": { "authType": "pat", "token": "ghp_..." },
  "anthropic": { "apiKey": "sk-ant-..." },
  "sandbox": { "backend": "docker", "mode": "auto", "networkAllow": false },
  "confidence": { "auto_approve_threshold": 80 }
}
```

- `github` — `token` for a PAT, or `appId` + `privateKeyPath` for a GitHub App.
- any provider section with an `apiKey` counts as configured; the environment
  variables `OPENROUTER_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` count
  too, and their values are never read.
- `sandbox` — `backend`, `mode`, `networkAllow`.
- `confidence.auto_approve_threshold` — `0`–`100`, default `75`; an
  out-of-range value is refused, never clamped.

Three sections are required before a merge-capable tool can act: `github`,
a provider key, and `sandbox`. A missing one is reported by field
(`github`, `ai.provider`, `sandbox`) rather than silently ignored. Secrets are
redacted before anything is logged.

## Example Session

A merge of two repositories, step by step. Tool arguments are shown as the
`arguments` object a host sends with `tools/call`.

**1. Browse the two sources** — `stitch_select_files` returns a file tree with
size, language and last commit per file, so you can pick paths without leaving
the host:

```json
{
  "name": "stitch_select_files",
  "arguments": { "repo_url": "https://github.com/owner/repo-a.git", "path_filter": "src" }
}
```

The reply is a page of the tree (`tree`, `repo_meta`, `page`, `page_size`,
`total`, `has_more`). Use `local_path` instead of `repo_url` for a checkout you
already have, and `page` / `page_size` to walk a large repository.

**An optional pre-merge licence check** — `stitch_check_license` takes the same
two references and returns `compatible` / `conditional` / `incompatible` with
the SPDX ids and details:

```json
{
  "name": "stitch_check_license",
  "arguments": {
    "repo_a": "https://github.com/owner/repo-a.git",
    "repo_b": "https://github.com/owner/repo-b.git"
  }
}
```

**2. Start the merge** — `stitch_merge` takes the two repositories, the paths
selected in step 1, and an optional `progress_token`:

```json
{
  "name": "stitch_merge",
  "arguments": {
    "repo_a": "https://github.com/owner/repo-a.git",
    "repo_b": "https://github.com/owner/repo-b.git",
    "paths_a": ["src/auth"],
    "paths_b": ["src/dashboard"],
    "progress_token": "merge-1"
  }
}
```

It returns `{ "job_id": "..." }` immediately.

> **Today this step reports a refusal** on `mcp.core` naming the missing core
> job API: the rules that decide which core modules to wire for a merge live
> inside core, and the public barrel does not export them yet (ADR-168). The
> tool is registered and callable so the reason is visible instead of hidden.

**3. Monitor** — with a `progress_token` the host receives
`notifications/progress` frames while the job runs (see [Progress
Streaming](#progress-streaming)). Polling works everywhere:

```json
{ "name": "stitch_job_status", "arguments": { "job_id": "<job_id>" } }
```

The reply is `{ "status": "...", "progress": { "completed": 0, "total": 100 }, "result": ... }`
with `status` one of `queued`, `running`, `succeeded`, `failed`, `cancelled`.
`stitch_cancel_job` takes the same `job_id` to stop a run.

**4. Result** — the child repository is written where the merge options point
(`options` is passed through from the request), and `stitch_job_status` carries
the outcome in `result` once `status` is `succeeded`.

## Tool Reference

Ten tools are registered. Every `inputSchema` is a closed object
(`additionalProperties: false`), an unknown tool name or a `tools/call` without
`arguments` answers with `isError: true`, and a tool failure is returned inside
the result rather than as a protocol error.

| Tool | Input | Output |
|---|---|---|
| `stitch_select_files` | `repo_url?` \| `local_path?`, `path_filter?`, `page?`, `page_size?` | file `tree` with metadata, `repo_meta`, paging (`total`, `has_more`) |
| `stitch_check_license` | `repo_a`, `repo_b` | `verdict`, `spdx_ids`, `details` |
| `stitch_merge` | `repo_a`, `repo_b`, `paths_a[]`, `paths_b[]`, `options?`, `progress_token?` | `job_id` |
| `stitch_job_status` | `job_id`, `progress_token?` | `status`, `progress`, `result?` |
| `stitch_cancel_job` | `job_id` | `status`, `progress`, `result?` |
| `merge_manifests` | `manifests[]` | union of the parsed dependency manifests |
| `scan_licenses` | `manifests[]` | declared licences and the policy verdict |
| `run_sandbox_build` | `rootDir`, `ecosystem?` | build/test outcome from the sandbox |
| `subscribe_job_events` | `topics[]` | what is being buffered from the event bus |
| `run_pipeline` | `selection[]` | the pipeline outcome for a file selection |

## Progress Streaming

Pass `progress_token` (a string or a number) to `stitch_merge` and the host
receives one `notifications/progress` frame per job snapshot:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": { "progressToken": "merge-1", "progress": 1, "total": 3, "message": "deps" }
}
```

- `progress` and `total` are numeric; `message` is optional and carries the
  stage when the job reports one.
- the final frame of a settled job always reports `progress === total`, and the
  subscription is released at that point.
- a host that ignores notifications still works: omit `progress_token` and
  nothing is subscribed, then poll `stitch_job_status`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `mcp.core` refusal from `stitch_merge` | expected today: the core job API is not exported yet (ADR-168). Every other tool still works. |
| refusal on `github` | the config has no `github.token` and no `github.appId` + `privateKeyPath`. |
| refusal on `ai.provider` | no provider section with an `apiKey`, and none of `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` is set. |
| refusal on `sandbox` | the config has no `sandbox` section. |
| refusal on `config` | `~/.stitch/config.json` is unreadable, is not valid JSON, or its root is not an object. |
| refusal on `confidence.auto_approve_threshold` | the stored value is outside `0`–`100`; it is refused rather than clamped. |
| the server starts but a tool is missing | the config problem was logged and startup continued on purpose, so the host can see why. Check the server's stderr. |
| a host cannot connect over HTTP | the server speaks stdio by default; add `--http` (and check `--port` / `MCP_PORT`). |
| port already in use | pass `--port <n>` or set `MCP_PORT`. |
| `-32601` | the method is not implemented by the server. |
| `-32700` with `id: null` | the frame was not JSON. |

Config edits need a server restart — the file is re-read when the server starts,
not watched while it runs.

## Host-Specific Notes

The per-host pass is recorded in [MCP_COMPAT.md](MCP_COMPAT.md): the protocol
contract is machine-checked (initialize, `tools/list`, both transports, closed
schemas, progress frames, error codes), while the manual runs against Claude
Code, OpenCode and Cursor are **not run** — no host is installable in the
environment these phases were built in, and a gate that did not run is recorded
as deferred rather than passing.

| Host | Transport | Manual pass | Note |
|---|---|---|---|
| Claude Code | stdio | not run | stdio-first; do not pass `--http`. |
| OpenCode | stdio *or* HTTP | not run | `--http` is the documented form. |
| Cursor | stdio | not run | older MCP client versions are answered with the server's own protocol version (`2024-11-05`) rather than refused. |

The quirks most likely to need a workaround, all listed as risks to confirm in
[MCP_COMPAT.md](MCP_COMPAT.md): transport preference (a launch flag, never a code
change), progress notifications a host may render or ignore (polling is the
fallback), schema strictness (fixed — all ten schemas are closed), MCP client
version, and the launch command (`bun run --filter @repo-stitcher/mcp server`,
or `packages/mcp/src/index.ts` for a host that resolves the package itself).

## Privacy and telemetry

Telemetry is **off by default** and only the MCP server has a switch for it. Set
it in the same store the CLI uses:

```json
{ "telemetry": { "enabled": true } }
```

When it is on, three events are recorded with fixed fields only —
`session_start {host}`, `tool_called {tool, duration_ms, success}` and
`session_end {duration_s, tools_used}`. An event is rebuilt from that list
before it is written, so a repository URL, path, file content, prompt or
credential has no field to travel in. The default sink is the append-only local
file `~/.stitch/telemetry.log`; nothing is sent anywhere unless you also set
`"endpoint": "https://…"`. Turning the flag off again stops new events and leaves
the existing log in place (ADR-175).

## Links

- [MCP_COMPAT.md](MCP_COMPAT.md) — the protocol contract, the measured results
  and the per-host procedure.
- `MCP_REGISTRY_ENTRY.json` — the registry entry, currently `not submitted`.
- [EVAL.md](EVAL.md) — how the engine is evaluated.
- [README.md](README.md) — the project overview.
