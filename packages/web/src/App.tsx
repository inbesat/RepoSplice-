import type { JSX } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { createQueryClient } from './jobs.js';

const queryClient = createQueryClient();

/**
 * App: web dashboard root (P-208 mounts it with routing + store).
 * QueryClientProvider sits at the root (P-051) so every screen shares one
 * cache; it renders no DOM itself, so SSR markup is unchanged.
 * The sonner Toaster (P-057) also lives at the root so any screen can fire
 * job toasts via notifyJob (./toasts.js). theme="system" follows the OS
 * until the P-226 theme toggle binds it to app state; richColors gives the
 * success/error toasts their semantic colors in both modes.
 * Utility classes below are the living content Tailwind v4 scans: they
 * prove the token scale (stitch-*) and the class-based dark variant
 * (dark:) end to end — see styles.test.ts.
 */
export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <main className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50">
        <h1 className="text-stitch-700 dark:text-stitch-200">stitch</h1>
        <p>AI-augmented multi-repo composition</p>
      </main>
      <Toaster theme="system" position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}
