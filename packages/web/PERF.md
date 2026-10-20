# Web performance budgets (P-237)

The perf pass closes the Web epic. These budgets are **enforced**, not
documented: a red budget is the signal to lazy-load, never to raise the limit.

| Budget                                                | Limit     | Enforced by                                                         |
| ----------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| Initial JS (entry chunk + its modulepreloads, gzip)   | ≤ 250 kB  | `packages/web/scripts/budget.ts` → `bun run budget` (CI `perf` job) |
| Shell LCP (largest contentful paint on `/`)           | ≤ 2500 ms | `packages/web/perf/perf.spec.ts` → `bun run test:perf`              |
| Virtualized tree scroll (p95 frame delta, 100k nodes) | ≤ 120 ms  | `packages/web/perf/perf.spec.ts` → `bun run test:perf`              |

## Measured (2026-10-20, this machine)

| Measurement                                              | Value                             | How                                         |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| Entry chunk `dist/assets/index-*.js`                     | 307.67 kB raw / **96.59 kB gzip** | `bun run build` then `bun run budget`       |
| Review chunk (diff vendor `react-diff-viewer-continued`) | 168.16 kB raw / 56.29 kB gzip     | loaded only on `/review`                    |
| Before the lazy split (P-237 baseline)                   | 648.01 kB raw / 197.42 kB gzip    | same script, pre-split build                |
| Shell LCP                                                | **584 ms** (budget 2500 ms)       | Playwright + buffered `PerformanceObserver` |
| Tree scroll p95 frame delta (100k rows)                  | **83.3 ms** (budget 120 ms)       | Playwright rAF frame sampler                |
| Rows mounted after scrolling 200k px                     | **34** of 100 000                 | the virtualized window (P-232)              |

The route-level `React.lazy` split (P-237) is what moved the diff vendor out of
the entry chunk: 197.42 kB → 96.59 kB gzip, roughly half the initial payload.
Syntax highlighting (`shiki`) was already lazy and stays out of the initial
load; its per-language chunks are emitted but never fetched until a raw diff
is opened.

## Running the gates

```sh
bun --filter @repo-stitcher/web run build     # vite build
bun --filter @repo-stitcher/web run budget    # initial-JS budget (exit 1 over)
bun --filter @repo-stitcher/web run test:perf # LCP + tree frame budgets
```

`test:e2e` (the flow specs) runs against the dev server and needs no build;
`test:perf` runs against `vite preview` so the numbers come from the built
bundle. The perf suite has its own Playwright config
(`playwright.perf.config.ts`) because Playwright's `webServer` is top-level
only.
