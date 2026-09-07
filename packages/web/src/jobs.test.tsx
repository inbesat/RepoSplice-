import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JSX } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient, useJobs, useRefreshJobs, type FetchJobs } from './jobs.js';

/** Poll until `container` shows `text` (bounded; local promises settle fast). */
async function waitForText(container: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (container.textContent?.includes(text) === true) return;
    await new Promise(r => setTimeout(r, 50));
  }
}

function List({ fetchJobs }: { fetchJobs: FetchJobs }): JSX.Element {
  const jobs = useJobs(fetchJobs);
  if (jobs.isPending) return <span>loading</span>;
  if (jobs.isError) return <span>{`error:${jobs.error.message}`}</span>;
  return <span>{jobs.data.map(j => j.label).join(',')}</span>;
}

function Panel({ fetchJobs }: { fetchJobs: FetchJobs }): JSX.Element {
  const refresh = useRefreshJobs();
  return (
    <div>
      <List fetchJobs={fetchJobs} />
      <button type="button" onClick={() => refresh.mutate()}>
        refresh
      </button>
    </div>
  );
}

async function renderPanel(
  fetchJobs: FetchJobs,
  client: QueryClient = createQueryClient()
): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Panel fetchJobs={fetchJobs} />
      </QueryClientProvider>
    );
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: Root): void {
  root.unmount();
  container.remove();
}

describe('jobs query (P-051 react-query)', () => {
  it('defaults to empty without a backend', async () => {
    // useJobs() with no fetcher uses defaultFetchJobs (P-297 hook point):
    // resolves [] so the UI renders before the backend exists.
    function Empty(): JSX.Element {
      const jobs = useJobs();
      if (jobs.isPending) return <span>loading</span>;
      if (jobs.isError) return <span>error</span>;
      return <span>{`count:${jobs.data.length}`}</span>;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={createQueryClient()}>
            <Empty />
          </QueryClientProvider>
        );
      });
      await waitForText(container, 'count:0');
    } finally {
      unmount(container, root);
    }
  });

  it('query caches', async () => {
    let calls = 0;
    const fetchJobs: FetchJobs = async () => {
      calls += 1;
      return [{ id: '1', label: 'first' }];
    };
    const client = createQueryClient();

    const first = await renderPanel(fetchJobs, client);
    try {
      await waitForText(first.container, 'first');
      expect(calls).toBe(1);
    } finally {
      unmount(first.container, first.root);
    }

    // Remount against the SAME client: the warm cache serves (staleTime),
    // so no second fetch happens.
    const second = await renderPanel(fetchJobs, client);
    try {
      await waitForText(second.container, 'first');
      expect(calls).toBe(1);
    } finally {
      unmount(second.container, second.root);
    }
  });

  it('invalidate refetch', async () => {
    let calls = 0;
    let version = 1;
    const fetchJobs: FetchJobs = async () => {
      calls += 1;
      return version === 1 ? [{ id: '1', label: 'v1' }] : [{ id: '1', label: 'v2' }];
    };
    const { container, root } = await renderPanel(fetchJobs);
    try {
      await waitForText(container, 'v1');
      expect(calls).toBe(1);

      version = 2;
      const button = container.querySelector('button');
      expect(button).not.toBeNull();
      await act(async () => {
        button?.click();
      });
      await waitForText(container, 'v2');
      expect(calls).toBe(2);
    } finally {
      unmount(container, root);
    }
  });

  it('surfaces fetch errors as state', async () => {
    let calls = 0;
    const fetchJobs: FetchJobs = () => {
      calls += 1;
      return Promise.reject(new Error('down'));
    };
    const { container, root } = await renderPanel(fetchJobs);
    try {
      await waitForText(container, 'error:down');
      // retry:false — exactly one attempt, no retry storm.
      expect(calls).toBe(1);
    } finally {
      unmount(container, root);
    }
  });
});
