import type { JSX } from 'react';

/**
 * App: web dashboard root (P-208 mounts it with routing + store).
 * Utility classes below are the living content Tailwind v4 scans: they
 * prove the token scale (stitch-*) and the class-based dark variant
 * (dark:) end to end — see styles.test.ts.
 */
export function App(): JSX.Element {
  return (
    <main className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50">
      <h1 className="text-stitch-700 dark:text-stitch-200">stitch</h1>
      <p>AI-augmented multi-repo composition</p>
    </main>
  );
}
