import type { ReactNode } from 'react';
import { render, renderToString, useApp, useInput, type Instance } from 'ink';

/**
 * isQuitInput: the quit shortcut predicate, extracted pure so tests cover
 * both sides without driving a live stdin. P-198/199 reuse it for pickers.
 */
export function isQuitInput(input: string): boolean {
  return input === 'q';
}

/**
 * QuitOnQ: proves `useApp`/`useInput` typecheck (P-042) and gives P-198/199
 * a reusable quit shortcut. Renders children unchanged; pressing `q`
 * exits the ink app.
 */
export function QuitOnQ({ children }: { children?: ReactNode }) {
  const { exit } = useApp();
  useInput(input => {
    if (isQuitInput(input)) exit();
  });
  return <>{children}</>;
}

/**
 * renderScreen: render an ink tree to a TTY, or fall back to plain text
 * when stdout is not a TTY (CI, pipes — full P-044 behavior lands later).
 * Returns the live ink instance on TTY (callers unmount/wait on it),
 * null off-TTY where output is written synchronously.
 */
export function renderScreen(
  node: ReactNode,
  stdout: NodeJS.WriteStream = process.stdout
): Instance | null {
  if (stdout.isTTY === true) {
    return render(node, { stdout });
  }
  stdout.write(`${renderToString(node)}\n`);
  return null;
}
