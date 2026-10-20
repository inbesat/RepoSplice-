// P-221 — Results placeholder (P-210 mounts it in the flow).

import type { JSX } from 'react';

export function ResultsPage(): JSX.Element {
  return (
    <section data-tour="results">
      <h2 className="text-title font-semibold">Results</h2>
      <p className="text-muted">The composed outcome — coming in phase P-221.</p>
    </section>
  );
}
