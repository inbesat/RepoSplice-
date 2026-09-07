import * as Tooltip from '@radix-ui/react-tooltip';
import type { JSX, ReactNode } from 'react';

export type StitchTooltipProps = {
  /** Tooltip body text. */
  content: string;
  /**
   * Open delay in ms. Passed straight through (undefined = Radix default
   * 700ms); tests pin 0 for determinism.
   */
  delayDuration?: number;
  children: ReactNode;
};

/**
 * StitchTooltip: hints for provenance + job rows (P-185/224). Owns its
 * Provider so callers never forget one; trigger uses asChild so any
 * focusable element keeps its own semantics and name.
 */
export function StitchTooltip({
  content,
  delayDuration,
  children,
}: StitchTooltipProps): JSX.Element {
  // Conditional spread: Radix types delayDuration as `number` (no explicit
  // undefined), so passing the prop straight through breaks under
  // exactOptionalPropertyTypes. Omitting it selects the Radix default 700ms.
  return (
    <Tooltip.Provider {...(delayDuration === undefined ? {} : { delayDuration })}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={4}
            className="bg-stitch-900 text-stitch-50 dark:bg-stitch-50 dark:text-stitch-900"
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
