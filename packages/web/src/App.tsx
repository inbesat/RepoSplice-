// Web root (P-047) — P-210 mounts the ROUTER: QueryClientProvider stays the
// outermost provider (P-051), the sonner Toaster stays at the root (P-057),
// and the placeholder <main> of the scaffold becomes the real shell (header +
// stepper sidebar + routed region, P-210). BrowserRouter is created HERE;
// tests use MemoryRouter around AppShellRoutes for deterministic locations.
//
// THE STITCH SCALE stays in service as the brand accent (the h1 keeps
// text-stitch-700 dark:text-stitch-200 from the P-208 scaffold) alongside the
// P-209 semantic roles the rest of the shell consumes.

import type { JSX } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { createQueryClient } from './jobs.js';
import { AppShellRoutes } from './router.js';

const queryClient = createQueryClient();

export function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShellRoutes />
      </BrowserRouter>
      <Toaster theme="system" position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}
