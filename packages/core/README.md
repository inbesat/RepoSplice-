# `@repo-stitcher/core`

Core business logic for repo-stitcher. All git, GitHub, dependency, license, AI, sandbox, provenance, and orchestration logic lives here. **Zero UI dependencies.**

## Status

Wave 0 scaffold. Real modules land in Wave 1 (Epics 2–9, P-069 to P-188).

## Public API

Re-exports live in `src/index.ts`. Once Wave 1 lands, consumers should only import from this package — never from internal files.

## Scripts

- `bun run typecheck` — TypeScript check (wired in P-002)
- `bun run lint` — ESLint (wired in P-003)
- `bun test` — Vitest (wired in P-004)
- `bun run build` — tsup to `dist/` (wired in P-062)

## Ownership

**inbesat only.** No other contributor edits files in this package.
