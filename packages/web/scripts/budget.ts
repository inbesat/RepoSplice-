// P-237 — the initial-JS budget gate. No dependencies: it reads the built
// index.html, follows the module script + modulepreload links, and measures
// the GZIP size of every chunk the browser must fetch before the shell is
// interactive.
//
// The budget lives here so the CI job, the `budget` script and the Playwright
// perf spec all measure the SAME thing (one source of truth).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** The P-237 budget: initial JS <= ~250 KB gzip. */
export const INITIAL_JS_BUDGET_BYTES = 250 * 1024;

export interface InitialChunk {
  readonly path: string;
  readonly gzipBytes: number;
}

export interface InitialBundle {
  readonly chunks: readonly InitialChunk[];
  readonly totalGzipBytes: number;
}

const SCRIPT_RE = /<script[^>]+type="module"[^>]+src="([^"]+)"/g;
const PRELOAD_RE = /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g;

function collect(html: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined && value.startsWith('/')) found.push(value);
  }
  return found;
}

/** Measure the initial JS payload of a built app. Throws when there is no build. */
export function measureInitialBundle(distDir: string): InitialBundle {
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`no web build at ${indexPath} - run the web build first`);
  }
  const html = readFileSync(indexPath, 'utf8');
  const paths = [...new Set([...collect(html, SCRIPT_RE), ...collect(html, PRELOAD_RE)])];
  const chunks = paths.map(path => {
    const file = join(distDir, path.replace(/^\//, ''));
    const bytes = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
    return { path, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength };
  });
  return {
    chunks,
    totalGzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
  };
}

/** A human-readable budget report. */
export function formatReport(bundle: InitialBundle): string {
  const lines = bundle.chunks.map(
    chunk => `  ${(chunk.gzipBytes / 1024).toFixed(1).padStart(8)} kB gzip  ${chunk.path}`
  );
  lines.push(`  ${'-'.repeat(24)}`);
  lines.push(
    `  ${(bundle.totalGzipBytes / 1024)
      .toFixed(1)
      .padStart(8)} kB gzip  TOTAL (budget ${(INITIAL_JS_BUDGET_BYTES / 1024).toFixed(0)} kB)`
  );
  return lines.join('\n');
}

/** True when the measured payload is within the budget. */
export function withinBudget(bundle: InitialBundle): boolean {
  return bundle.totalGzipBytes <= INITIAL_JS_BUDGET_BYTES;
}

const invokedDirectly =
  process.argv[1] !== undefined && /budget\.(ts|js|mjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  const distDir = process.argv[2] ?? join(process.cwd(), 'dist');
  try {
    const bundle = measureInitialBundle(distDir);
    console.log(`initial JS bundle (${distDir}):\n${formatReport(bundle)}`);
    if (!withinBudget(bundle)) {
      console.error(`FAIL: initial JS is over the ${INITIAL_JS_BUDGET_BYTES} byte budget`);
      process.exit(1);
    }
    console.log('OK: within budget');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
