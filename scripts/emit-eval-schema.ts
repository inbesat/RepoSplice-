// P-320 — emit the corpus JSON Schema from the zod contract.
//
// The corpus contract is defined once (packages/core/src/eval/schema.ts) and
// the JSON Schema is GENERATED from it, so the two can never drift. The
// `--check` mode fails when the committed file is stale — that is the CI gate.
//
// The schema module is imported DIRECTLY (not the core barrel) so the emitter
// never evaluates the whole core package.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { evalPairJsonSchema } from '../packages/core/src/eval/schema.js';

const DEFAULT_OUTPUT = join('eval', 'corpus', 'schema.json');

/** The exact text the committed schema file must contain. */
export function renderSchema(): string {
  return `${JSON.stringify(evalPairJsonSchema(), null, 2)}\n`;
}

/** Canonical JSON: sorted keys, so a re-formatted file compares equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Semantic comparison: lint-staged may reformat the committed schema file
 * (prettier), so the bytes can differ while the schema is identical.
 */
export function sameSchema(committed: string, emitted: string): boolean {
  try {
    return canonical(JSON.parse(committed)) === canonical(JSON.parse(emitted));
  } catch {
    return false;
  }
}

/** Write (or check) the emitted schema. Returns the process exit code. */
export function main(argv: readonly string[]): number {
  const check = argv.includes('--check');
  const outIndex = argv.indexOf('--out');
  const outArg = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const output = outArg ?? DEFAULT_OUTPUT;
  const text = renderSchema();
  if (check) {
    if (!existsSync(output)) {
      console.error(`eval schema: ${output} is missing - run: bun scripts/emit-eval-schema.ts`);
      return 1;
    }
    if (!sameSchema(readFileSync(output, 'utf8'), text)) {
      console.error(`eval schema: ${output} is out of date - run: bun scripts/emit-eval-schema.ts`);
      return 1;
    }
    console.log(`eval schema: ${output} is up to date`);
    return 0;
  }
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, text);
  console.log(`eval schema: wrote ${output}`);
  return 0;
}

if ((process.argv[1] ?? '').includes('emit-eval-schema')) {
  process.exit(main(process.argv.slice(2)));
}
