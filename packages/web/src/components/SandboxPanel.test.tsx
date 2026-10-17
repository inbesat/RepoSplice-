import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxPanel } from './SandboxPanel.js';
import { useSandboxStore } from '../store/sandbox.js';
import type { SandboxResult } from '../api/sandbox.js';

const CAPS = { backend: 'docker' };

const RESULT: SandboxResult = {
  jobId: 'j1',
  build: { status: 'failed', exit: 1, durationMs: 4200, command: 'bun run build' },
  tests: {
    passed: 7,
    failed: 1,
    skipped: 0,
    failures: [{ name: 'math adds', message: 'expected 2 to be 3' }],
  },
  logs: [
    { name: 'build', lines: ['+ bun run build', 'error TS2345 boom', 'warning deprecated API'] },
    { name: 'tests', lines: ['ok 1 math adds', 'not ok 2 ui renders'] },
  ],
  artifacts: [{ path: 'out/dist.tar.gz', size: 2048 }],
  limits: { timeoutMs: 900_000, memoryMb: 512 },
  verdict: 'fail',
};

const WARN_RESULT: SandboxResult = {
  ...RESULT,
  build: { ...RESULT.build, status: 'ok', exit: 0 },
  verdict: 'warn',
};

const fetchMock = vi.fn();

function mockDispatch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/sandbox/result/')) {
      return { ok: true, json: async () => RESULT };
    }
    if (url.includes('/api/sandbox/capabilities')) {
      return { ok: true, json: async () => CAPS };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  useSandboxStore.getState().reset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mockDispatch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SandboxPanel', () => {
  it('renders capabilities', async () => {
    render(<SandboxPanel jobId="j1" />);
    const badge = await screen.findByTestId('sandbox-backend');
    expect(badge.textContent).toBe('docker');
  });

  it('build tests cards', async () => {
    render(<SandboxPanel jobId="j1" />);
    const build = await screen.findByLabelText('sandbox build');
    expect(build.textContent).toContain('failed');
    expect(build.textContent).toContain('exit 1');
    const tests = screen.getByLabelText('sandbox tests');
    expect(tests.textContent).toContain('7 passed');
    expect(tests.textContent).toContain('1 failed');
    expect(tests.textContent).toContain('expected 2 to be 3');
  });
  it('renders logs', async () => {
    render(<SandboxPanel jobId="j1" />);
    const toggle = await screen.findByRole('button', { name: /Log: build/ });
    fireEvent.click(toggle);
    const log = await screen.findByText(/error TS2345 boom/);
    expect(log.className).toContain('text-danger');
    expect(screen.getByText(/warning deprecated API/).className).toContain('text-warning');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('artifacts', async () => {
    render(<SandboxPanel jobId="j1" />);
    const link = await screen.findByRole('link', { name: /out\/dist\.tar\.gz/ });
    expect(link.getAttribute('download')).not.toBeNull();
    expect(screen.getByLabelText('sandbox artifacts').textContent).toContain('out/dist.tar.gz');
  });

  it('verdict gates approve', async () => {
    const { rerender } = render(<SandboxPanel jobId="j1" />);
    await screen.findByTestId('sandbox-verdict');
    expect(screen.getByTestId('sandbox-verdict').textContent).toContain('verdict: fail');
    let store = useSandboxStore.getState();
    expect(store.sandboxPass).toBe(false);
    expect(store.blockers).toEqual([
      'sandbox failed — the merged C must build and test green before approval',
    ]);
    // warn blocks until acknowledged
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sandbox/result/')) {
        return { ok: true, json: async () => WARN_RESULT };
      }
      return { ok: true, json: async () => CAPS };
    });
    rerender(<SandboxPanel jobId="j2" key="j2" />);
    await screen.findByTestId('sandbox-verdict');
    expect(screen.getByTestId('sandbox-verdict').textContent).toContain('verdict: warn');
    store = useSandboxStore.getState();
    expect(store.sandboxPass).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge warning/ }));
    await vi.waitFor(() => {
      expect(useSandboxStore.getState().sandboxPass).toBe(true);
    });
    expect(useSandboxStore.getState().blockers).toEqual([]);
  });

  it('surfaces a failed sandbox fetch inline', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'sandbox job not found' }),
    }));
    render(<SandboxPanel jobId="j1" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('sandbox job not found');
    // unloaded result -> store untouched
    expect(useSandboxStore.getState().loaded).toBe(false);
  });
});
