---
name: add-web-slice
description: Add a page, component, or store slice to the React web dashboard. Use when working in packages/web.
triggers:
  - "web page"
  - "packages/web"
  - "component"
  - "zustand"
  - "tailwind"
  - "dark mode"
  - "bundle budget"
edges:
  - target: context/architecture.md
    condition: for how the web app connects to core events
  - target: context/stack.md
    condition: for the frontend stack and the deny list
  - target: context/conventions.md
    condition: for the state and token conventions
grounds_to: []
last_updated: 2026-10-22
mex:
  id: mx_01M5G2KKYVH92TKZFNNTVS9H3S
  type: pattern
  status: promoted
  revision: 4
  title: add-web-slice
  relations:
    - type: related_to
      target: mx_01M5G2K6S4C1SVBP01Y76AECCC
      note: for how the web app connects to core events
    - type: related_to
      target: mx_01M5G2KJCCV9BDCQ862Y1JP82Z
      note: for the frontend stack and the deny list
    - type: related_to
      target: mx_01M5G2K99N5VSF22C75FZCPNET
      note: for the state and token conventions
---

# Add a Web Slice

## Context

`packages/web` is React 19 + Vite + Tailwind v4. It is the aradhy lane. It never imports
`packages/core/src/*` internals — only the `@repo-stitcher/core` barrel.

Layering: `pages/` (route-level) -> `components/` (reusable) -> `hooks/` (behaviour) ->
`store/` (one Zustand slice per domain, plus `selectors.ts`) -> `api/` (REST client) and
`lib/ws.ts` (live events). Theme tokens live in `theme/tokens.css` with a typed mirror in
`theme/tokens.ts`.

The live path is: core publishes on the Bus -> the CLI server adapts it to WebSocket ->
`lib/ws.ts` `WsClient` (reconnect 500 ms -> 30 s, 15 s heartbeat) -> the hook layer ->
the store -> the page. Any change to the envelope is a frozen-contract change, not a web
change: see `patterns/change-frozen-contract.md`.

## Steps

1. Decide the boundary: a new route gets a page in `packages/web/src/pages/`, a reusable
   piece gets a component in `packages/web/src/components/`.
2. Add the route in `packages/web/src/router.tsx`. Routes are lazy (ADR-122).
3. Add state in `packages/web/src/store/`: one slice per domain, following the existing
   slices (`selection`, `run`, `sources`, `licenses`, `deps`, `provenance`, `sandbox`,
   `jobs`, `flow`, `tour`). Put derived reads in `selectors.ts`, not in components.
4. Use TanStack Query for server state and Zustand for client state. Do not mirror
   server state into Zustand.
5. Style with Tailwind classes that reference the **role** tokens from
   `theme/tokens.ts` / `theme/tokens.css`. Never hardcode a colour value.
6. For live data, consume the existing WS hooks (`packages/web/src/hooks/`) rather than
   opening your own socket.
7. Add tests: `packages/web/src/pages/<Page>.test.tsx` alongside the page, using the web
   test harness (ADR-121).
8. If the slice needs an E2E journey, add it under `packages/web/e2e/`.

## Gotchas

- **Tokens are roles-in-CSS with a typed TS mirror** (ADR-094). Tailwind v4 has no
  separate config file — customisation lives in the `@theme inline` block in
  `theme/tokens.css`. The `.dark` class is the dark-mode switch; `[data-theme]` is not
  used.
- **Contrast is enforced by test, not by eyeball.** There is a >= 4.5:1 contrast test in
  the web suite; a new token pair must pass it.
- **The A/B selection contract is the SORTED RAW PATHS** in `selectionA` / `selectionB`
  (ADR-099). Selections are raw sorted paths, not tree nodes and not expansion state.
- **The file tree is slot-agnostic** — react-arborist owns expansion, and the tree slot
  renders over a client-contract endpoint (ADR-098). Do not store expansion in the
  selection slice.
- **Bundle budget is a red gate.** If the build exceeds the budget the gate fails and the
  CI comment says "over budget -> red (P-237, do not raise the limit)". Lazy routes and
  the existing perf specs are the fix, not a bigger budget.
- **No `console.error` in tests.** Assert on it instead (P-236).
- **Do not import core internals.** ESLint `no-restricted-imports` and `bun run lint:deps`
  both reject it.

## Verify

- [ ] web typecheck — 0 errors (`bun run --filter @repo-stitcher/web typecheck` or the
      equivalent tsc invocation for the package).
- [ ] e2e typecheck — 0 errors.
- [ ] `bun run --filter @repo-stitcher/web test` — the full web vitest suite passes
      (last known: 39 files / 164 tests).
- [ ] `bun run build:web` — exit 0.
- [ ] Perf specs — 3 passed.
- [ ] E2E — 3 passed for the merge flow.
- [ ] Web coverage stays at or above 60/50/60/60.
- [ ] `bun run lint` — 0 errors for owned files.

## Debug

- **The page renders but never updates** — the store slice is not subscribed to the WS
  envelope, or the envelope shape changed (that is a frozen-contract change).
- **Dark mode looks wrong** — the colour is a raw hex instead of a role token, so it does
  not flip.
- **The contrast test fails** — the two roles do not meet 4.5:1 in both themes.
- **The build exceeds the bundle budget** — a route is not lazy, or a dependency was
  pulled into the entry chunk.
- **Selection round-trips lose ordering** — the slice is storing tree objects instead of
  sorted raw paths.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
