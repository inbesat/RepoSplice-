# MCP host compatibility (P-363)

The MCP server is validated two ways: a **machine-checked protocol contract**
(what the server does on the wire, asserted on every gate run) and a
**per-host manual pass** (what a specific MCP host client does with it).

The machine-checked half is green and reproducible:

```
bun packages/mcp/test/host-compat.ts      # prints one HOST_COMPAT <json> line
uv run --no-project python packages/mcp/test_host_compat.py
```

The manual half has **not been run**: no MCP host (Claude Code, OpenCode,
Cursor) is installable in the environment these phases were built in. Status is
recorded as `not run` rather than a fabricated pass — a gate that did not run is
deferred, never passing (ADR-172). The procedure and the exact commands are
below so the pass can be completed wherever the hosts are available.

## What the server guarantees (measured, not assumed)

| Property | Value |
|---|---|
| Protocol version | `2024-11-05` |
| Server identity | `repo-stitcher` |
| Transports | stdio (LSP `Content-Length` framing) **and** HTTP (Elysia) |
| HTTP endpoint | `POST /mcp`, `GET /mcp/health` → `{"status":"ok"}`; default port `3435` (`--port`, `MCP_PORT`) |
| Host binding | `127.0.0.1` unless a hostname is given |
| Tools registered | 10 |
| Tool schemas | every one `type: "object"` with `additionalProperties: false` |
| Notifications | `notifications/progress` via an optional `progress_token` on `stitch_merge`; a notification POST answers `202`; a request with no `id` is never answered |

The ten tools: `merge_manifests`, `scan_licenses`, `run_sandbox_build`,
`subscribe_job_events`, `run_pipeline`, `stitch_select_files`, `stitch_merge`,
`stitch_job_status`, `stitch_cancel_job`, `stitch_check_license`.

Wire semantics a host can rely on:

- a tool failure is returned **inside** the result (`isError: true`), it is not a
  protocol error;
- a method the server does not implement → `-32601`; a payload that is not JSON →
  `-32700` with `id: null`;
- an unknown tool name, or `tools/call` without `arguments`, → `isError: true`;
- string and numeric request ids are echoed unchanged;
- a frame split across two writes is reassembled before dispatch;
- progress frames carry `progressToken`, `progress`, `total`; the final frame of
  a settled job reports `progress === total` and the subscription is released.

### Machine-checked results

| Profile | Transport | Result |
|---|---|---|
| `claude-code` | stdio | initialize ✓, negotiated `2024-11-05` ✓, 10 tools ✓, all schemas closed ✓, `stitch_select_files` call ✓, 2 progress frames `[1, 3]` of `[3, 3]` ✓ |
| `opencode` | HTTP | `GET /mcp/health` ✓, `POST /mcp` → 10 tools ✓, notification → `202` ✓, `tools/call` without `arguments` → `isError` ✓, file tree returned ✓ |
| `cursor` | stdio | older `initialize` (`2024-10-07`) answered ✓, string id echoed ✓, unknown method `-32601` ✓, malformed JSON `-32700`/`id: null` ✓, notification silent ✓, split frame answered ✓ |

## Per-host manual pass

| Host | Client version | Transport | Tools tested | Pass/fail | Quirks / workarounds |
|---|---|---|---|---|---|
| Claude Code | not run | stdio | — | **not run** | — |
| OpenCode | not run | stdio *or* HTTP | — | **not run** | — |
| Cursor | not run | stdio | — | **not run** | — |

Procedure per host (repeat for all ten tools, and for a merge with a
`progress_token`):

1. register the server with the host:
   - Claude Code: `claude mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server`
   - OpenCode: `opencode mcp add repo-stitcher -- bun run --filter @repo-stitcher/mcp server --http`
   - Cursor: add `packages/mcp/src/index.ts` as a stdio MCP server in settings
2. confirm the server appears and `tools/list` shows 10 tools;
3. call `stitch_select_files` on a local repository and check the returned tree;
4. call `stitch_check_license` on two repositories and check the verdict;
5. call `stitch_merge` with a `progress_token` and watch for live progress
   frames, then poll `stitch_job_status`;
6. record host, client version, transport, tools tested, pass/fail, quirks and
   workaround in the table above.

Acceptance for a completed pass: at least two hosts pass all ten tools.

## Quirks to verify (suspected, unconfirmed)

The following are the differences the hosts are most likely to expose. They are
listed as risks to confirm, not as findings:

1. **Transport preference.** Claude Code and Cursor are stdio-first; OpenCode
   accepts both. If a host only speaks stdio, `--http` must not be used, and vice
   versa. Both are implemented, so the fix is a launch flag, never code.
2. **Progress handling.** Hosts may render `notifications/progress` as a live
   bar, a log line, or nothing at all. A host that ignores them keeps working:
   polling `stitch_job_status` is the documented fallback (P-359/P-361), and
   omitting `progress_token` subscribes to nothing.
3. **Schema strictness.** An open `inputSchema` lets a strict host reject or
   forward unexpected arguments. Fixed in this phase (step 5): the five core
   tools previously lacked `additionalProperties: false`, so the schemas are now
   closed on all ten tools. This was a real finding, not a hypothesis.
4. **MCP client version.** Cursor has shipped older MCP client versions.
   `initialize` answers any requested version with the server's own
   (`2024-11-05`) rather than refusing, so a version mismatch degrades instead of
   failing the handshake.
5. **Launch command.** `bun run --filter @repo-stitcher/mcp server` is the
   documented entry point; a host that resolves the server package itself should
   point at `packages/mcp/src/index.ts`. Package publishing stays P-064/P-062.

## Step-5 outcome

One critical failure was found and fixed: the five P-357 core tools registered
input schemas without `additionalProperties: false`, so not every tool's schema
was closed. All ten are closed now, and the conformance harness asserts it
(`stdio.schema_additional_properties_false = true`). No other critical failure is
outstanding — the remaining risk is the manual per-host pass above.

## Links

- Tool list and call examples: see the tools in `tools/list` (P-365 will add the
  zero-to-merge quickstart and link this document).
- Registry submission: P-364.
- Decision record: ADR-172.
