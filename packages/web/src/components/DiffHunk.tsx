// P-217 — one file's diff pane: header (path, kind, ± counts, copy, raw) +
// the diff body via react-diff-viewer-continued (installed dep — unified and
// split views, line numbers, ±/ctx coloring through P-209 token vars from
// index.css).

import ReactDiffViewer, { type ReactDiffViewerStylesOverride } from 'react-diff-viewer-continued';
import { useEffect, useState, type JSX } from 'react';
import { Check, Copy, Eye } from 'lucide-react';
import type { ProposedDiffFile } from '../hooks/useProposedDiff.js';

const KIND_LABEL: Record<ProposedDiffFile['kind'], string> = {
  add: 'added',
  modify: 'modified',
  delete: 'deleted',
};

const SHIKI_LANGS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
};

/** CRLF→LF always; when ignoring whitespace, collapse runs + trim lines. */
export function normalizeText(text: string, ignoreWs: boolean): string {
  const lines = text.split(/\r?\n/);
  if (!ignoreWs) return lines.join('\n');
  return lines.map(line => line.replace(/[\t ]+/g, ' ').trim()).join('\n');
}

/** LCS change counts (2000-line cap; symmetric-difference fallback above). */
export function countChanges(oldText: string, newText: string): { added: number; deleted: number } {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const CAP = 2000;
  if (a.length > CAP || b.length > CAP) {
    const setA = new Set(a);
    const setB = new Set(b);
    let added = 0;
    let deleted = 0;
    for (const line of b) if (!setA.has(line)) added += 1;
    for (const line of a) if (!setB.has(line)) deleted += 1;
    return { added, deleted };
  }
  const m = a.length;
  const n = b.length;
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      const diag = prev[j + 1] ?? 0;
      const down = prev[j] ?? 0;
      const right = curr[j + 1] ?? 0;
      curr[j] = a[i] === b[j] ? diag + 1 : Math.max(down, right);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  const lcs = prev[0] ?? 0;
  return { added: n - lcs, deleted: m - lcs };
}

const DIFF_STYLES: ReactDiffViewerStylesOverride = {
  diffAdded: { color: 'var(--success)' },
  diffRemoved: { color: 'var(--danger)' },
};

interface DiffHunkProps {
  readonly file: ProposedDiffFile;
  readonly splitView: boolean;
  readonly ignoreWs: boolean;
}

export function DiffHunk({ file, splitView, ignoreWs }: DiffHunkProps): JSX.Element {
  const oldText = normalizeText(file.oldText ?? '', ignoreWs);
  const newText = normalizeText(file.newText ?? '', ignoreWs);
  const { added, deleted } = countChanges(oldText, newText);
  const rawText = file.newText ?? file.oldText ?? '';

  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [lang, setLang] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Lazy-load shiki only when a raw view opens (heavy highlighter stays out
  // of the diff grid and out of tests); any failure falls back to plain text.
  useEffect(() => {
    if (!showRaw || lang === null || highlighted !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const { createHighlighter } = await import('shiki');
        const highlighter = await createHighlighter({
          themes: ['github-dark'],
          langs: [lang],
        });
        if (!cancelled)
          setHighlighted(highlighter.codeToHtml(rawText, { lang, theme: 'github-dark' }));
      } catch {
        if (!cancelled) setHighlighted(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showRaw, lang, highlighted, rawText]);

  const copyHunk = (): void => {
    setCopied(true);
    void navigator.clipboard?.writeText(rawText).catch(() => undefined);
  };

  const viewRaw = (): void => {
    const next = !showRaw;
    setShowRaw(next);
    if (next && lang === null && highlighted === null) {
      const ext = file.path.split('.').pop() ?? '';
      setLang(SHIKI_LANGS[ext] ?? null);
    }
  };

  return (
    <article data-testid={`diff-${file.path}`} className="space-y-2">
      <header className="flex items-center gap-3">
        <h3 className="text-body font-semibold">{file.path}</h3>
        <span className="text-caption text-muted">{KIND_LABEL[file.kind]}</span>
        <span className="text-caption text-success">+{added}</span>
        <span className="text-caption text-danger">-{deleted}</span>
        <button
          type="button"
          onClick={copyHunk}
          className="ml-auto flex items-center gap-1 text-caption text-muted hover:text-text"
          data-testid={`copy-${file.path}`}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? ' Copied' : ' Copy hunk'}
        </button>
        <button
          type="button"
          onClick={viewRaw}
          aria-expanded={showRaw}
          className="flex items-center gap-1 text-caption text-muted hover:text-text"
        >
          <Eye size={14} aria-hidden /> View raw
        </button>
      </header>
      {showRaw ? (
        highlighted !== null ? (
          // shiki output is trusted, self-generated HTML (no user input).
          <div dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre className="whitespace-pre-wrap text-caption text-muted">{rawText}</pre>
        )
      ) : (
        <ReactDiffViewer
          oldValue={oldText}
          newValue={newText}
          splitView={splitView}
          hideLineNumbers={false}
          useDarkTheme={false}
          styles={DIFF_STYLES}
          leftTitle={file.path}
          rightTitle={file.path}
        />
      )}
    </article>
  );
}
