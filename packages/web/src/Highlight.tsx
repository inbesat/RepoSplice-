import { useEffect, useState, type JSX } from 'react';

export type HighlightProps = {
  code: string;
  lang?: string;
  dark?: boolean;
};

export const HIGHLIGHT_LIGHT_THEME = 'github-light';
export const HIGHLIGHT_DARK_THEME = 'github-dark';

/**
 * Highlight: syntax-highlighted code block for the diff view (P-217),
 * file trees (P-213/214), and provenance (P-222). Single-theme output per
 * `dark` keeps the markup self-contained (inline styles, no global CSS
 * dependency); theme switches re-highlight.
 *
 * Loading and failure share one safe output: a plain <pre> with the raw
 * code as *text*. shiki itself escapes `<` as `&#x3C;`, and the fallback
 * never touches innerHTML — so neither branch can inject markup. The
 * highlighter loads lazily (dynamic import) so pages without code pay
 * nothing; unknown languages reject and land on the fallback.
 */
export function Highlight({ code, lang = 'plaintext', dark = false }: HighlightProps): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    const run = async (): Promise<void> => {
      try {
        const { codeToHtml } = await import('shiki');
        const highlighted = await codeToHtml(code, {
          lang,
          theme: dark ? HIGHLIGHT_DARK_THEME : HIGHLIGHT_LIGHT_THEME,
        });
        if (!cancelled) setHtml(highlighted);
      } catch {
        if (!cancelled) setHtml(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, lang, dark]);
  if (html === null) return <pre>{code}</pre>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
