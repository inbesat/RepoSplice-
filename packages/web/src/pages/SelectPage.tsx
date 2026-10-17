// P-213/214 — Selection placeholder (P-210 mounts it in the flow).

import type { JSX } from 'react';

export function SelectPage(): JSX.Element {
  return (
    <section>
      <h2 className="text-title font-semibold">Select</h2>
      <p className="text-muted">Choose files from each source — coming in phases P-213/P-214.</p>
    </section>
  );
}
