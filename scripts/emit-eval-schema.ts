// P-320 — emit the corpus JSON Schema from the zod contract.
//
// The corpus contract is defined once (packages/core/src/eval/schema.ts) and
// the JSON Schema is GENERATED from it, so the two can never drift. The
// `--check` mode fails when the committed file is stale — that is the CI gate.
//
// Three contracts are emitted: the pair schema (P-320), the per-pair RESULT
// schema (P-323/P-324) and the human RUBRIC schema (P-325).
//
// The schema modules are imported DIRECTLY (not the core barrel) so the
// emitter never evaluates the whole core package.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { evalPairJsonSchema } from '../packages/core/src/eval/schema.js';
import { evalResultJsonSchema } from '../packages/core/src/eval/types.js';
import { semanticRubricJsonSchema } from '../packages/core/src/eval/rubric.js';

const DEFAULT_OUTPUT = join('eval', 'corpus', 'schema.json');
const RESULT_OUTPUT = join('eval', 'corpus', 'result-schema.json');
const RUBRIC_OUTPUT = join('eval', 'rubric', 'schema.json');

/** The exact text the committed schema file must contain. */
export function renderSchema(): string {
  return `${JSON.stringify(evalPairJsonSchema(), null, 2)}\n`;
}

/** The exact text the committed RESULT schema file must contain (P-323). */
export function renderResultSchema(): string {
  return `${JSON.stringify(evalResultJsonSchema(), null, 2)}\n`;
}

/** The exact text the committed RUBRIC schema file must contain (P-325). */
export function renderRubricSchema(): string {
  return `${JSON.stringify(semanticRubricJsonSchema(), null, 2)}\n`;
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

/** One emitted schema file: the corpus, result and rubric contracts. */
export interface SchemaTarget {
  readonly path: string;
  readonly text: string;
}

/** The files the emitter owns (the pair, result and rubric schemas). */
export function schemaTargets(
  outArg: string | undefined,
  resultOutArg: string | undefined,
  rubricOutArg?: string
): SchemaTarget[] {
  return [
    { path: outArg ?? DEFAULT_OUTPUT, text: renderSchema() },
    { path: resultOutArg ?? RESULT_OUTPUT, text: renderResultSchema() },
    { path: rubricOutArg ?? RUBRIC_OUTPUT, text: renderRubricSchema() },
  ];
}

/** Write (or check) the emitted schemas. Returns the process exit code. */
export function main(argv: readonly string[]): number {
  const check = argv.includes('--check');
  const outIndex = argv.indexOf('--out');
  const outArg = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const resultIndex = argv.indexOf('--result-out');
  const resultOutArg = resultIndex >= 0 ? argv[resultIndex + 1] : undefined;
  const rubricIndex = argv.indexOf('--rubric-out');
  const rubricOutArg = rubricIndex >= 0 ? argv[rubricIndex + 1] : undefined;
  const targets = schemaTargets(outArg, resultOutArg, rubricOutArg);
  if (check) {
    for (const target of targets) {
      if (!existsSync(target.path)) {
        console.error(
          `eval schema: ${target.path} is missing - run: bun scripts/emit-eval-schema.ts`
        );
        return 1;
      }
      if (!sameSchema(readFileSync(target.path, 'utf8'), target.text)) {
        console.error(
          `eval schema: ${target.path} is out of date - run: bun scripts/emit-eval-schema.ts`
        );
        return 1;
      }
      console.log(`eval schema: ${target.path} is up to date`);
    }
    return 0;
  }
  for (const target of targets) {
    mkdirSync(dirname(resolve(target.path)), { recursive: true });
    writeFileSync(target.path, target.text);
    console.log(`eval schema: wrote ${target.path}`);
  }
  return 0;
}

if ((process.argv[1] ?? '').includes('emit-eval-schema')) {
  process.exit(main(process.argv.slice(2)));
}
