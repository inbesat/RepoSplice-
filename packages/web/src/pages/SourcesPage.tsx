// P-211 — Sources picker placeholder (P-210 mounts it in the flow).

import type { JSX } from 'react';

export function SourcesPage(): JSX.Element {
  return (
    <section>
      <h2 className="text-title font-semibold">Sources</h2>
      <p className="text-muted">Pick repos A and B — coming in phase P-211.</p>
    </section>
  );
}
