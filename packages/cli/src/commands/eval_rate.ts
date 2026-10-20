// P-326 — the rater review tool: `stitch eval rate <pair-id> --result-dir <dir>`.
//
// A rater opens the pair the harness scored, reads the diff (when the
// harness left one) and the rubric anchors, then scores the three
// SemanticRubric dimensions (1-5) plus a note. The rubric is written back
// into the pair's result JSON as `human_score` (the P-325 shape) together
// with `human_rater` — the harness data around it is preserved.
//
// The questions are a PORT (the P-198 house style): the real prompt is the
// interactive text input, tests inject a fake, and a broken prompt surface
// degrades to "cancelled" instead of throwing outward.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUBRIC_DIMENSIONS, semanticRubricSchema } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';
import { promptText } from '../ui/prompt.js';

export interface EvalRateOptions extends GlobalOptions {
  /** Where the harness wrote the per-pair results (default `eval/out`). */
  resultDir?: string;
  /** Who is scoring — recorded with the rubric. */
  rater?: string;
  /** Print the saved rubric as JSON. */
  json?: boolean;
}

/** The question port: one question, one answer, or null for "cancelled". */
export type EvalRatePrompt = (question: string) => Promise<string | null>;

export interface EvalRateDeps {
  /** The question port. Absent = the real interactive prompt. */
  readonly prompt?: EvalRatePrompt;
  readonly readFile?: (path: string) => string;
  readonly writeFile?: (path: string, content: string) => void;
  readonly exists?: (path: string) => boolean;
  readonly log?: (line: string) => void;
}

/** Saved, the rating is in the result JSON. */
export const RATE_EXIT_OK = 0;
/** The rater cancelled (escape or a closed prompt). */
export const RATE_EXIT_CANCELLED = 1;
/** Nothing to rate, or the answers are not a valid rubric. */
export const RATE_EXIT_USAGE = 2;

const DEFAULT_RESULT_DIR = 'eval/out';

function defaultPrompt(question: string): Promise<string | null> {
  return promptText(question);
}

/**
 * Score one corpus pair with the human rubric and persist the answer.
 * Returns the process exit code (never throws).
 */
export async function evalRate(
  pairId: string,
  options: EvalRateOptions,
  deps: EvalRateDeps = {}
): Promise<number> {
  const log = deps.log ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const exists = deps.exists ?? existsSync;
  const read = deps.readFile ?? ((path: string): string => readFileSync(path, 'utf8'));
  const write =
    deps.writeFile ??
    ((path: string, content: string): void => writeFileSync(path, content, 'utf8'));
  const prompt = deps.prompt ?? defaultPrompt;

  const resultDir = options.resultDir ?? DEFAULT_RESULT_DIR;
  const resultPath = join(resultDir, `${pairId}.json`);
  if (!exists(resultPath)) {
    log(`eval rate: no result for "${pairId}" at ${resultPath}`);
    return RATE_EXIT_USAGE;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(read(resultPath));
  } catch {
    log(`eval rate: ${resultPath} is not valid JSON`);
    return RATE_EXIT_USAGE;
  }
  if (parsedJson === null || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    log(`eval rate: ${resultPath} does not hold a result object`);
    return RATE_EXIT_USAGE;
  }
  const record = parsedJson as Record<string, unknown>;

  // The diff is optional: the harness does not write one yet, so the rater
  // works from the result's build/test logs when it is absent.
  const diffPath = join(resultDir, `${pairId}.diff`);
  if (exists(diffPath)) {
    const lines = read(diffPath).split('\n').length;
    log(`eval rate: diff ${diffPath} (${lines} lines)`);
  } else {
    log(`eval rate: no diff artifact for "${pairId}" - rate from the result logs`);
  }

  const rater = options.rater ?? 'anonymous';
  const answers: Record<string, number> = {};
  try {
    for (const dimension of RUBRIC_DIMENSIONS) {
      const answer = await prompt(`eval rate ${pairId} - ${dimension} (1-5):`);
      if (answer === null) {
        log(`eval rate: cancelled at ${dimension}`);
        return RATE_EXIT_CANCELLED;
      }
      const score = Number.parseInt(answer.trim(), 10);
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        log(`eval rate: ${dimension} must be 1-5 (got "${answer.trim()}")`);
        return RATE_EXIT_USAGE;
      }
      answers[dimension] = score;
    }
    const notes = await prompt(`eval rate ${pairId} - notes:`);
    if (notes === null) {
      log('eval rate: cancelled at notes');
      return RATE_EXIT_CANCELLED;
    }
    const rubric = semanticRubricSchema.safeParse({
      pair_id: pairId,
      rater,
      ...answers,
      notes,
    });
    if (!rubric.success) {
      const detail = rubric.error.issues.map(issue => issue.message).join('; ');
      log(`eval rate: the rubric is invalid - ${detail}`);
      return RATE_EXIT_USAGE;
    }
    record['human_score'] = rubric.data;
    record['human_rater'] = rater;
    write(resultPath, `${JSON.stringify(record, null, 2)}\n`);
    if (options.json === true) {
      log(JSON.stringify(rubric.data));
    } else {
      log(`eval rate: saved the ${pairId} rubric (rater ${rater})`);
    }
    return RATE_EXIT_OK;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`eval rate: the prompt failed - ${reason}`);
    return RATE_EXIT_CANCELLED;
  }
}
