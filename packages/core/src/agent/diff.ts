// P-152 — unified diff generation.
//
// P-152 requires a `{ path, before, after, diff }` result whose `diff` the web
// DiffViewer (P-217) renders. No diff library is installed or used anywhere in
// core (verified by search), so this is a small, self-contained
// longest-common-subsequence diff over lines producing standard unified-diff
// output with `@@` hunks.
//
// Correctness over cleverness: config files are small, so an O(n*m) LCS table
// is fine and produces the minimal edit script, which is what makes the output
// readable to a human reviewing a proposed change.

/** One line of a unified diff. */
export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
}

/** A contiguous run of changed lines plus surrounding context. */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  // Drop the single trailing empty element a final "\n" produces, so
  // "a\nb\n" and "a\nb" diff identically.
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Longest common subsequence over line arrays, returned as the edit script.
 *
 * Classic DP table. `old`/`new` are 1-indexed internally via the 1-offset.
 */
function editScript(oldLines: readonly string[], newLines: readonly string[]): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;
  // lcs[i][j] = length of the LCS of oldLines[i:] and newLines[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = lcs[i];
    const next = lcs[i + 1];
    if (row === undefined || next === undefined) continue;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] =
        oldLines[i] === newLines[j]
          ? (next[j + 1] ?? 0) + 1
          : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const oldLine = oldLines[i];
    const newLine = newLines[j];
    if (oldLine === newLine) {
      out.push({ kind: 'context', text: oldLine ?? '' });
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ kind: 'remove', text: oldLine ?? '' });
      i += 1;
    } else {
      out.push({ kind: 'add', text: newLine ?? '' });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: 'remove', text: oldLines[i] ?? '' });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: 'add', text: newLines[j] ?? '' });
    j += 1;
  }
  return out;
}

/** Group an edit script into hunks with `context` lines of padding. */
export function buildHunks(script: readonly DiffLine[], context = 3): DiffHunk[] {
  const changed = script.map((line, idx) => (line.kind === 'context' ? -1 : idx));
  const first = changed.find(idx => idx !== -1);
  if (first === undefined) return [];

  // Walk changed indices, grouping any two that are within 2*context of each
  // other so a hunk never splits a tiny change across two headers.
  const groups: Array<{ start: number; end: number }> = [];
  let current: { start: number; end: number } | undefined;
  for (const idx of changed) {
    if (idx === -1) continue;
    if (current === undefined || idx - current.end > context * 2) {
      current = { start: idx, end: idx };
      groups.push(current);
    } else {
      current.end = idx;
    }
  }

  const hunks: DiffHunk[] = [];
  for (const group of groups) {
    const from = Math.max(0, group.start - context);
    const to = Math.min(script.length - 1, group.end + context);
    const slice = script.slice(from, to + 1);

    // Recompute old/new line numbers by replaying the prefix.
    let oldNo = 1;
    let newNo = 1;
    for (let idx = 0; idx < from; idx += 1) {
      const line = script[idx];
      if (line?.kind !== 'add') oldNo += 1;
      if (line?.kind !== 'remove') newNo += 1;
    }
    const oldStart = oldNo;
    const newStart = newNo;
    let oldCount = 0;
    let newCount = 0;
    for (const line of slice) {
      if (line.kind !== 'add') oldCount += 1;
      if (line.kind !== 'remove') newCount += 1;
    }
    hunks.push({
      oldStart,
      oldLines: oldCount,
      newStart,
      newLines: newCount,
      lines: slice,
    });
  }
  return hunks;
}

/**
 * Render a unified diff string for two file versions.
 *
 * Returns the empty string when the inputs are identical, so a no-op edit
 * produces no diff noise.
 */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  if (before === after) return '';
  const script = editScript(splitLines(before), splitLines(after));
  const hunks = buildHunks(script, context);
  if (hunks.length === 0) return '';

  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';
      out.push(`${marker}${line.text}`);
    }
  }
  return `${out.join('\n')}\n`;
}
