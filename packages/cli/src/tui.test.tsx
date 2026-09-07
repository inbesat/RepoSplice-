import { describe, it, expect } from 'vitest';
import { Console } from 'node:console';
import { Text, renderToString } from 'ink';
import { QuitOnQ, isQuitInput, renderScreen } from './tui.js';

describe('ink TUI scaffold (P-042)', () => {
  it('renders ink to string', () => {
    const out = renderToString(<Text color="green">stitch ready</Text>);
    expect(out).toContain('stitch ready');
  });

  it('falls back to plain text off-TTY', () => {
    const chunks: string[] = [];
    const fake = {
      isTTY: false,
      write: (s: string) => {
        chunks.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const instance = renderScreen(<Text>hello</Text>, fake);
    expect(instance).toBeNull();
    expect(chunks.join('')).toContain('hello');
  });

  it('renders live on TTY and returns the instance', async () => {
    // Fake TTY: ink only needs write/columns/resize hooks (probed P-042).
    // Vitest workers replace global console with a wrapper lacking the
    // `Console` constructor that ink's patch-console needs, so restore the
    // real one for the duration of this test (production terminals are
    // unaffected). The app is unmounted immediately.
    const holder = globalThis.console as unknown as Record<string, unknown>;
    const prev = holder['Console'];
    holder['Console'] = Console;
    const chunks: string[] = [];
    const noop = () => undefined;
    const fake = {
      isTTY: true,
      columns: 80,
      write: (s: string) => {
        chunks.push(String(s));
        return true;
      },
      on: noop,
      off: noop,
      removeListener: noop,
    } as unknown as NodeJS.WriteStream;
    try {
      const instance = renderScreen(<Text>tty-hi</Text>, fake);
      expect(instance).not.toBeNull();
      await new Promise(r => setTimeout(r, 50));
      instance?.unmount();
      expect(chunks.join('')).toContain('tty-hi');
    } finally {
      if (prev === undefined) delete holder['Console'];
      else holder['Console'] = prev;
    }
  });

  it('quit shortcut predicate covers both sides', () => {
    expect(isQuitInput('q')).toBe(true);
    expect(isQuitInput('x')).toBe(false);
    expect(isQuitInput('')).toBe(false);
  });

  it('exposes the useApp/useInput quit shortcut for P-198/199', () => {
    // Compile-time proof lives in tui.tsx (hooks typecheck under strict);
    // runtime check that the component is renderable content.
    expect(typeof QuitOnQ).toBe('function');
    const out = renderToString(
      <QuitOnQ>
        <Text>pick me</Text>
      </QuitOnQ>
    );
    expect(out).toContain('pick me');
  });
});
