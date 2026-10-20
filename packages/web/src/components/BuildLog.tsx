// Collapsible, line-addressed log viewer for one sandbox log section (P-221).
// Downloads the raw log locally via a Blob URL (the server does not expose a
// raw-log endpoint yet — client contract recorded in ADR-106).
import { useEffect, useMemo, useState } from 'react';

export interface BuildLogProps {
  name: string;
  lines: readonly string[];
}

// Level heuristic over free-form build/test output; P-209 tokens arrive as
// Tailwind utilities (--color-danger/-warning/-text).
function levelClass(line: string): string {
  if (/error|✘|not ok/i.test(line)) return 'text-danger';
  if (/warn/i.test(line)) return 'text-warning';
  return 'text-text';
}

export function BuildLog({ name, lines }: BuildLogProps) {
  const [open, setOpen] = useState(false);
  const blobUrl = useMemo(() => {
    if (!open) return null;
    return URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  }, [open, lines]);
  useEffect(
    () => () => {
      if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl]
  );
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="text-body text-primary underline"
      >
        {open ? '▼' : '▶'} Log: {name} ({lines.length} lines)
      </button>
      {open && (
        <div>
          <pre className="stitch-scroll max-h-64 min-h-32 overflow-auto bg-surface p-2 text-caption font-mono">
            {lines.map((line, i) => (
              <div key={i}>
                <span className="text-muted">{i + 1}| </span>
                <span className={levelClass(line)}>{line}</span>
              </div>
            ))}
          </pre>
          {blobUrl !== null && (
            <a
              href={blobUrl}
              download={`${name}.log`}
              className="text-caption text-primary underline"
            >
              Download raw log
            </a>
          )}
        </div>
      )}
    </div>
  );
}
