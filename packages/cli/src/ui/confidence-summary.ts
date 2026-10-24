// P-353 — the one-line confidence summary shared by `stitch merge` and
// `stitch status`.
//
// The score is DISPLAYED, never recomputed: it comes from the P-346/P-349
// pipeline (the P-348 assessment). A run with no recorded assessment says so
// ('N/A') rather than printing a zero — a missing number is never a zero.
//
// The colour bands mirror the web badges (P-352): green >= 80, yellow 60-79,
// red < 60, with the upper bound inclusive. Colour always goes through the
// house `theme` helper (P-044) so `NO_COLOR`, an off-TTY stream and
// `--no-color` all keep working, and a caller may inject its own paint.

import { theme, type ThemeLevel } from '../theme.js';

/** The colour bands, matching the web badges (P-352). */
export const CONFIDENCE_THRESHOLDS = { high: 80, medium: 60 } as const;

/** The theme level a score maps to; `none` means "no score recorded". */
export type ConfidenceLevel = ThemeLevel | 'none';

/** How the summary paints a level's text (identity when colours are off). */
export type ConfidencePaint = (level: ThemeLevel, text: string) => string;

/** The five factors, as they arrive from the assessment (all optional). */
export interface ConfidenceComponents {
  readonly sandbox_pass?: unknown;
  readonly self_confidence?: unknown;
  readonly resolver_confidence?: unknown;
  readonly license_risk?: unknown;
  readonly test_coverage?: unknown;
}

/** What the summary needs from an assessment. */
export interface ConfidenceSummary {
  readonly score: number;
  readonly flags: readonly string[];
  readonly components?: ConfidenceComponents;
  readonly rationale?: string;
}

export interface ConfidenceSummaryOptions {
  /** The paint to use; defaults to the house `theme` (honours `NO_COLOR`). */
  readonly paint?: ConfidencePaint;
  /** `--verbose`: add the per-factor breakdown and the rationale. */
  readonly verbose?: boolean;
}

/** The component key + its display label, in the spec's order. */
const COMPONENT_ORDER: ReadonlyArray<readonly [keyof ConfidenceComponents, string]> = [
  ['sandbox_pass', 'sandbox'],
  ['self_confidence', 'self'],
  ['resolver_confidence', 'resolver'],
  ['license_risk', 'license'],
  ['test_coverage', 'tests'],
];

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The band a score falls in (the upper bound is inclusive). */
export function confidenceLevel(score: unknown): ConfidenceLevel {
  const value = finite(score);
  if (value === undefined) return 'none';
  if (value >= CONFIDENCE_THRESHOLDS.high) return 'ok';
  if (value >= CONFIDENCE_THRESHOLDS.medium) return 'warn';
  return 'err';
}

/** The score as `NN%`, or `N/A` when there is no usable number. */
export function confidencePercent(score: unknown): string {
  const value = finite(score);
  return value === undefined ? 'N/A' : `${String(Math.round(value))}%`;
}

/** The flags, filtered to non-blank strings. */
export function confidenceFlags(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags
    .filter((flag): flag is string => typeof flag === 'string' && flag.trim() !== '')
    .map(flag => flag.trim());
}

/**
 * One component as `label:value`.
 *
 * The sandbox factor is a 0/1 outcome, so it renders as a glyph; the other
 * factors render as whole numbers. A missing or non-finite value is OMITTED
 * rather than guessed at.
 */
function componentText(key: keyof ConfidenceComponents, value: unknown): string | undefined {
  const label = COMPONENT_ORDER.find(([name]) => name === key)?.[1] ?? key;
  if (key === 'sandbox_pass') {
    if (value === undefined || value === null) return undefined;
    return `${label}:${value ? '✓' : '✕'}`;
  }
  const number = finite(value);
  return number === undefined ? undefined : `${label}:${String(Math.round(number))}`;
}

/**
 * Read an assessment out of an untrusted value.
 *
 * Accepts this module's shape (`score`) and the core pipeline's
 * (`composite_score`), so a stage's meta or a stored row can be handed over
 * without the caller reshaping it. Anything unusable is `undefined`.
 */
export function parseConfidenceSummary(value: unknown): ConfidenceSummary | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const score = finite(record['score'] ?? record['composite_score']);
  if (score === undefined) return undefined;
  const components = record['components'];
  return {
    score,
    flags: confidenceFlags(record['flags']),
    ...(components !== null && typeof components === 'object'
      ? { components: components as ConfidenceComponents }
      : {}),
    ...(typeof record['rationale'] === 'string' ? { rationale: record['rationale'] } : {}),
  };
}

/**
 * The summary as one line, plus the verbose breakdown when asked.
 *
 * A run with no assessment yields the honest `N/A` line: the caller always
 * gets a line, so a missing measurement is visible instead of absent.
 */
export function formatConfidenceSummary(
  confidence: ConfidenceSummary | undefined,
  options: ConfidenceSummaryOptions = {}
): string[] {
  const paint = options.paint ?? theme;
  if (confidence === undefined) {
    return ['Confidence: N/A (no assessment recorded)'];
  }
  const level = confidenceLevel(confidence.score);
  const percent = confidencePercent(confidence.score);
  const painted = level === 'none' ? percent : paint(level, percent);
  const parts = COMPONENT_ORDER.map(([key]) => {
    if (confidence.components === undefined) return undefined;
    return componentText(key, confidence.components[key]);
  }).filter((part): part is string => part !== undefined);
  const flags = confidence.flags.length === 0 ? '' : ` [flags: ${confidence.flags.join(', ')}]`;
  const lines = [`Confidence: ${painted} (${parts.join(' ')})${flags}`];
  if (options.verbose === true) {
    for (const [key, label] of COMPONENT_ORDER) {
      const text =
        confidence.components === undefined
          ? undefined
          : componentText(key, confidence.components[key]);
      if (text !== undefined) lines.push(`  ${label}: ${text.slice(label.length + 1)}`);
    }
    if (confidence.rationale !== undefined) lines.push(`  rationale: ${confidence.rationale}`);
    if (confidence.flags.length > 0) lines.push(`  flags: ${confidence.flags.join(', ')}`);
  }
  return lines;
}
