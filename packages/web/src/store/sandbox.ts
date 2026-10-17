// Sandbox outcome slice (P-221): the panel emits its verdict-driven gate
// state; a fail is blocking, a warn blocks until acknowledged, pass never
// blocks. Unloaded (no result yet) does not block — ADR-104 rule.
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface SandboxState {
  readonly loaded: boolean;
  readonly sandboxPass: boolean;
  readonly blockers: readonly string[];
  setSandboxOutcome(outcome: { sandboxPass: boolean; blockers: readonly string[] }): void;
  reset(): void;
}

export const useSandboxStore = create<SandboxState>()(
  devtools(
    set => ({
      loaded: false,
      sandboxPass: false,
      blockers: [],
      setSandboxOutcome({ sandboxPass, blockers }) {
        set({ loaded: true, sandboxPass, blockers });
      },
      reset() {
        set({ loaded: false, sandboxPass: false, blockers: [] });
      },
    }),
    { name: 'stitch-sandbox' }
  )
);
