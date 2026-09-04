# `@repo-stitcher/cli`

Terminal interface (commander + Ink TUI) and HTTP/WebSocket server (Elysia) that hosts the web UI and exposes programmatic API.

## Status

Wave 0 scaffold. Commands and server land in Wave 1 (Epic 10, P-189 to P-207).

## Binary

When built, exposes the `stitch` binary (see `package.json#bin`).

## Scripts

- `bun run dev` — run with watch
- `bun run typecheck` — TypeScript check (wired in P-002)
- `bun run lint` — ESLint (wired in P-003)
- `bun test` — Vitest (wired in P-004)
- `bun run build` — tsup to `dist/` (wired in P-062)

## Dependencies

- `@repo-stitcher/core` (workspace)

## Ownership

**aradhy only** (post-Wave-0 handoff).
