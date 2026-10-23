// P-352 — the confidence badge.
//
// It shows the composite confidence the core pipeline computed (P-346 schema, P-349 weights,
// P-347/P-348 producers) and the warning flags that came with it, inline in the diff viewer and
// the provenance table. The badge DISPLAYS a score; it never recomputes one — a second formula
// here would be a second source of truth for the same number.
//
// The data arrives as a plain LOCAL wire type. The web tsconfig's rootDir cannot pull the
// @repo-stitcher/core barrel (the P-218 evidence recorded in src/api/deps.ts), so the shape is
// mirrored locally, exactly as the other api modules mirror theirs.
//
// Colour is never the only signal: the badge always carries a band glyph, the numeric score as
// text, and an aria-label naming both, so it reads correctly without colour vision.

import type { ConfidenceComponents, ConfidenceView } from '../api/confidence.js';

/** The band cut points; the upper bound of each band is inclusive. */
export const CONFIDENCE_THRESHOLDS = { high: 80, medium: 60 } as const;

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';

// The wire shape lives with the wire contracts (api/confidence.ts); it is re-exported so a
// consumer of the badge needs one import.
export type { ConfidenceComponents, ConfidenceView };

export interface ConfidenceThresholds {
  readonly high: number;
  readonly medium: number;
}

export interface ConfidenceBadgeProps {
  /**
   * The confidence to show; absent, `undefined` or malformed renders the unknown band.
   * `undefined` is allowed explicitly because a file genuinely may have no recorded score and
   * `exactOptionalPropertyTypes` otherwise rejects passing it through.
   */
  readonly confidence?: ConfidenceView | undefined;
  /** Override the cut points (the theme-configurable thresholds of the phase spec). */
  readonly thresholds?: ConfidenceThresholds;
  /** Render the flags beside the badge. */
  readonly showFlags?: boolean;
}

const BAND_GLYPH: Readonly<Record<ConfidenceBand, string>> = {
  high: '✓',
  medium: '!',
  low: '✕',
  unknown: '?',
};

const BAND_ROLE: Readonly<Record<ConfidenceBand, string>> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
  unknown: 'muted',
};

const COMPONENT_LABELS: ReadonlyArray<readonly [keyof ConfidenceComponents, string]> = [
  ['sandbox_pass', 'sandbox'],
  ['self_confidence', 'self'],
  ['resolver_confidence', 'resolver'],
  ['license_risk', 'license'],
  ['test_coverage', 'tests'],
];

/** The band a score falls into; a non-finite score is `unknown`, never a silent zero. */
export function confidenceBand(
  score: unknown,
  thresholds: ConfidenceThresholds = CONFIDENCE_THRESHOLDS
): ConfidenceBand {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'unknown';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

/** The score as text: a rounded integer, or 'N/A' when there is nothing to show. */
export function confidenceScoreText(score: unknown): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'N/A';
  return String(Math.round(score));
}

/** The flags, read defensively: blanks and non-strings are ignored. */
export function confidenceFlags(flags: unknown): readonly string[] {
  if (!Array.isArray(flags)) return [];
  return flags
    .filter((flag): flag is string => typeof flag === 'string' && flag.trim() !== '')
    .map(flag => flag.trim());
}

/** The tooltip: the five components, the flags and the rationale — the full breakdown. */
export function confidenceBreakdown(
  confidence: ConfidenceView | undefined,
  band: ConfidenceBand
): string {
  const lines: string[] = [`confidence ${confidenceScoreText(confidence?.score)}/100 (${band})`];
  const components = confidence?.components;
  if (components !== undefined) {
    const parts: string[] = [];
    for (const [key, label] of COMPONENT_LABELS) {
      const value = components[key];
      if (typeof value === 'number' && Number.isFinite(value)) parts.push(`${label} ${value}`);
    }
    if (parts.length > 0) lines.push(parts.join(', '));
  }
  const flags = confidenceFlags(confidence?.flags);
  if (flags.length > 0) lines.push(`flags: ${flags.join(', ')}`);
  const rationale = confidence?.rationale;
  if (typeof rationale === 'string' && rationale.trim() !== '') lines.push(rationale.trim());
  return lines.join(' — ');
}

/**
 * The inline confidence badge.
 *
 * Pure: every field is read defensively, so a malformed record renders the honest 'N/A' state
 * instead of throwing or printing 'undefined'.
 */
export function ConfidenceBadge({
  confidence,
  thresholds = CONFIDENCE_THRESHOLDS,
  showFlags = true,
}: ConfidenceBadgeProps) {
  const band = confidenceBand(confidence?.score, thresholds);
  const scoreText = confidenceScoreText(confidence?.score);
  const flags = confidenceFlags(confidence?.flags);
  const label = `confidence ${scoreText}/100, ${band}`;
  return (
    <span
      role="status"
      aria-label={label}
      title={confidenceBreakdown(confidence, band)}
      data-band={band}
      className="inline-flex items-center gap-1 text-caption"
    >
      <span aria-hidden="true" style={{ color: `var(--${BAND_ROLE[band]})` }}>
        {BAND_GLYPH[band]}
      </span>
      <span aria-hidden="true" style={{ color: `var(--${BAND_ROLE[band]})` }}>
        {scoreText}
      </span>
      {showFlags && flags.length > 0 ? (
        <span className="text-muted">{flags.join(', ')}</span>
      ) : null}
    </span>
  );
}
