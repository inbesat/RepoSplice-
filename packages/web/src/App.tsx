import type { JSX } from 'react';

/**
 * App: web dashboard root (P-208 mounts it with routing + store).
 * Static scaffold markup; interactive merge-review flows (diff P-217,
 * WS live events P-223) build on this root.
 */
export function App(): JSX.Element {
  return (
    <main>
      <h1>stitch</h1>
      <p>AI-augmented multi-repo composition</p>
    </main>
  );
}
