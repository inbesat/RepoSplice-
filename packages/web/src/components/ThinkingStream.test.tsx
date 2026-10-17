// P-216 — the AI thinking stream tests (mocked WS event pump; no real socket).
//
//   it('renders reasoning')   it('renders tool status')   it('caps tokens')
//   it('merge button gate')   it('denied state')
//
// 'merge button gate' and 'denied state' render the full MergePage: the store
// is seeded the P-214 way (direct store writes, then a render), and fetch is
// stubbed for the POST /api/merge client contract.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import {
  useMergeStream,
  defaultConnect,
  type Connector,
  type StreamEvent,
} from '../hooks/useMergeStream.js';
import { MAX_STREAM_EVENTS, ThinkingStream } from './ThinkingStream.js';
import { MergePage } from '../pages/MergePage.js';
import { useSourcesStore } from '../store/selection.js';
import { useRunStore } from '../store/run.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useSourcesStore.getState().reset();
  useRunStore.getState().reset();
});

/** A connector that replays the given events and exposes live `push`. */
function pump(events: readonly StreamEvent[]): {
  connect: Connector;
  push: (event: StreamEvent) => void;
} {
  let handler: ((event: StreamEvent) => void) | undefined;
  return {
    connect: onEvent => {
      handler = onEvent;
      for (const event of events) onEvent(event);
      return () => undefined;
    },
    push: event => handler?.(event),
  };
}

const REASON = { type: 'reasoning', id: 'r1', text: 'Reading selected sources…' } as const;
const TOOL = {
  type: 'tool',
  toolName: 'select_files',
  args: { include: ['src/a.ts'] },
  status: 'running',
} as const;

/** Test double: wires a pump connector into the hook the page uses. */
function StreamTester({ connect }: { connect: Connector }): JSX.Element {
  const stream = useMergeStream({ connect });
  return <ThinkingStream events={stream.events} />;
}

describe('ThinkingStream', () => {
  it('renders reasoning', () => {
    const { connect } = pump([REASON]);
    render(<StreamTester connect={connect} />);
    expect(screen.getByTestId('reasoning-line').textContent).toBe(REASON.text);
    expect(screen.getByTestId('thinking-indicator')).toBeTruthy();
  });

  it('renders tool status', () => {
    const { connect, push } = pump([TOOL]);
    render(<StreamTester connect={connect} />);
    const row = screen.getByTestId('tool-select_files');
    expect(row.getAttribute('data-status')).toBe('running');
    // Failed tools get the retry hint in the status label.
    act(() => push({ ...TOOL, status: 'failed' }));
    expect(screen.getByText(/failed — check the merge log and retry/)).toBeTruthy();
    // Args stay collapsed until the row is clicked.
    expect(screen.queryByText(/"include"/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /select_files/ }));
    expect(screen.getByText(/"include"/)).toBeTruthy();
  });

  it('caps tokens', () => {
    const flood = Array.from({ length: MAX_STREAM_EVENTS + 100 }, (_, i) => ({
      type: 'reasoning' as const,
      id: `r-${i}`,
      text: `token ${i}`,
    }));
    render(<ThinkingStream events={flood} />);
    const lines = screen.getAllByTestId('reasoning-line');
    expect(lines.length).toBe(MAX_STREAM_EVENTS);
    expect(lines[0]?.textContent).toBe('token 100'); // the first 100 are dropped
    expect(screen.queryByText('token 0')).toBeNull();
  });

  it('merge button gate', () => {
    // Empty stores — gated, with the explanation visible.
    const gated = render(<MergePage />);
    expect((screen.getByTestId('run-merge') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/at least one file selected/)).toBeTruthy();
    gated.unmount();

    // Both slots resolved + non-empty selections — the button opens.
    act(() => {
      const s = useSourcesStore.getState();
      s.addSource('A', { id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' });
      s.addSource('B', { id: 'r2', kind: 'local', path: '/tmp/rB', status: 'ready' });
      s.setSelection('A', ['a.ts']);
      s.setSelection('B', ['b.ts']);
    });
    render(<MergePage />);
    expect((screen.getByTestId('run-merge') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/at least one file selected/)).toBeNull();
  });

  it('denied state', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ message: 'license policy denies this merge' }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    act(() => {
      const s = useSourcesStore.getState();
      s.addSource('A', { id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' });
      s.addSource('B', { id: 'r2', kind: 'local', path: '/tmp/rB', status: 'ready' });
      s.setSelection('A', ['a.ts']);
      s.setSelection('B', ['b.ts']);
    });
    render(<MergePage />);
    fireEvent.click(screen.getByTestId('run-merge'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Merge denied/));
    expect(useRunStore.getState().status).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useMergeStream plumbing', () => {
  it('defaultConnect is inert without a WebSocket global (jsdom/SSR)', () => {
    expect(() => defaultConnect(() => undefined)()).not.toThrow();
  });
});
