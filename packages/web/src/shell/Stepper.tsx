// P-205→P-210 — the stepper: the five-step flow as left nav states.
//
// The mapping comes from router.tsx's `STEPS` (the handoff note's centralized
// table). States per step:
//   active   — the current route's step (aria-current="step");
//   visited  — reached before (unlocked AND clickable, via `useFlowStore`);
//   locked   — reached-before is a sequential unlock: a step is open when it
//              is the FIRST step or its predecessor was visited. Locked steps
//              render an inert span (aria-disabled, no Link) — there is no
//              navigation affordance to block.
// `active` step navigated to directly still renders active; the AppShell's
// location effect is what marks it visited.

import { Link, useLocation } from 'react-router';
import type { JSX } from 'react';
import { STEPS, stepForPath } from '../router.js';
import { useFlowStore } from '../store/flow.js';

/** Which steps are reachable from the visited set (sequential unlock). */
export function unlockedSteps(
  steps: readonly { id: string }[],
  visited: readonly string[]
): ReadonlySet<string> {
  const open = new Set<string>();
  steps.forEach((step, index) => {
    if (index === 0 || visited.includes(steps[index - 1]?.id ?? '')) open.add(step.id);
  });
  return open;
}

export function Stepper(): JSX.Element {
  const { pathname } = useLocation();
  const visited = useFlowStore(state => state.visited);
  const activeId = stepForPath(pathname)?.id;
  const open = unlockedSteps(STEPS, visited);

  return (
    <nav aria-label="stitch steps">
      <ol className="space-y-1">
        {STEPS.map((step, index) => {
          const isActive = step.id === activeId;
          const isUnlocked = open.has(step.id);
          const stateClass = isActive
            ? 'text-primary font-semibold'
            : isUnlocked
              ? 'text-text'
              : 'text-muted opacity-60';
          const inner = (
            <>
              <span aria-hidden="true">{index + 1}. </span>
              {step.label}
            </>
          );
          return (
            <li key={step.id}>
              {isUnlocked ? (
                <Link
                  to={step.path}
                  className={`block px-2 py-1 ${stateClass}`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {inner}
                </Link>
              ) : (
                <span
                  className={`block px-2 py-1 ${stateClass}`}
                  aria-disabled="true"
                  title="Finish the previous step first"
                >
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
