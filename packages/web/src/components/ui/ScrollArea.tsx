import * as Scroll from '@radix-ui/react-scroll-area';
import type { JSX, ReactNode } from 'react';

export type StitchScrollAreaProps = {
  children: ReactNode;
};

/**
 * StitchScrollArea: virtualized-tree viewport (P-232). Fixed sizing stays
 * with consumers (height is layout, not chrome); no className prop on
 * purpose — chrome is fixed, sizing is contextual.
 */
export function StitchScrollArea({ children }: StitchScrollAreaProps): JSX.Element {
  return (
    <Scroll.Root className="bg-stitch-50 text-stitch-900 dark:bg-stitch-950 dark:text-stitch-50">
      <Scroll.Viewport className="h-full w-full">{children}</Scroll.Viewport>
      <Scroll.Scrollbar orientation="vertical">
        <Scroll.Thumb />
      </Scroll.Scrollbar>
    </Scroll.Root>
  );
}
