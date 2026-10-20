// P-231 — shared accessibility primitives for the web surface.
//
// SkipLink gives keyboard users a one-tab route to the main landmark;
// useFocusTrap is exported for future modal hosts (the P-229 tour card
// carries its own inline trap and keeps it — no behavioural change here).
//
// shortcut: visible focus is a CSS rule (index.css :focus-visible), not a
// JS hook — that is the standard instrument; a focusRing component would
// only duplicate it.

import { useEffect } from 'react';
import type { JSX, RefObject } from 'react';

/** Visually hidden until focused; jumps to the `#main` landmark. */
export function SkipLink({ href = '#main' }: { href?: string }): JSX.Element {
  return (
    <a href={href} className="skip-link">
      Skip to content
    </a>
  );
}

interface Focusable extends HTMLElement {
  focus(): void;
}

/**
 * Cycle Tab/Shift-Tab among `host`'s focusable children while `active`.
 * Escape is deliberately NOT handled: the owning component decides how to
 * close (the tour skips on Escape, a dialog would confirm first).
 */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return undefined;
    const host = ref.current;
    if (host === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusables = [
        ...host.querySelectorAll<Focusable>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ),
      ].filter(element => !element.hasAttribute('disabled'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) return;
      const current = document.activeElement;
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    host.addEventListener('keydown', onKey);
    return () => {
      host.removeEventListener('keydown', onKey);
    };
  }, [active, ref]);
}
