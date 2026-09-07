import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { JSX } from 'react';
import { useSessionStore } from './session.js';

describe('session store (P-050 zustand)', () => {
  afterEach(() => {
    useSessionStore.getState().reset();
  });

  it('store read write', () => {
    expect(useSessionStore.getState().stepIndex).toBe(0);
    expect(useSessionStore.getState().selectedRepos).toEqual([]);
    expect(useSessionStore.getState().startedAt).toBeNull();

    useSessionStore.getState().advanceStep();
    useSessionStore.getState().advanceStep();
    expect(useSessionStore.getState().stepIndex).toBe(2);
    expect(typeof useSessionStore.getState().startedAt).toBe('number');

    useSessionStore.getState().toggleRepo('repos/a');
    useSessionStore.getState().toggleRepo('repos/b');
    expect([...useSessionStore.getState().selectedRepos]).toEqual(['repos/a', 'repos/b']);
    useSessionStore.getState().toggleRepo('repos/a');
    expect([...useSessionStore.getState().selectedRepos]).toEqual(['repos/b']);

    useSessionStore.setState({ stepIndex: 9 });
    expect(useSessionStore.getState().stepIndex).toBe(9);

    useSessionStore.getState().reset();
    expect(useSessionStore.getState().stepIndex).toBe(0);
    expect(useSessionStore.getState().selectedRepos).toEqual([]);
    expect(useSessionStore.getState().startedAt).toBeNull();
  });

  it('hook reads the slice', async () => {
    // Client render (SSR would show initial state by design — zustand
    // snapshots initial state on the server). jsdom is the web env.
    useSessionStore.getState().advanceStep();
    useSessionStore.getState().toggleRepo('repos/a');

    function Probe(): JSX.Element {
      const stepIndex = useSessionStore(s => s.stepIndex);
      const repoCount = useSessionStore(s => s.selectedRepos.length);
      return <span>{`step:${stepIndex}/repos:${repoCount}`}</span>;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<Probe />);
      });
      expect(container.innerHTML).toBe('<span>step:1/repos:1</span>');

      // Live subscription: a later action re-renders the hook output.
      await act(async () => {
        useSessionStore.getState().advanceStep();
      });
      expect(container.innerHTML).toBe('<span>step:2/repos:1</span>');
    } finally {
      root.unmount();
      container.remove();
    }
  });
});
