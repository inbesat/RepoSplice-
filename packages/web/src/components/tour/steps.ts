// P-229 — ordered tour step definitions. Each step targets an element that
// ALWAYS renders on its page (a `data-tour` anchor), so selectors cannot
// rot with loading states (the P-229 handoff's strong-coupling rule);
// Tour.test.tsx resolves every selector on the real route as a guard.

export interface TourStep {
  /** Selector for the always-rendered spotlight anchor. */
  readonly target: string;
  /** Route the step lives on; the tour points users there. */
  readonly route: string;
  readonly title: string;
  readonly body: string;
  /** Last step's button reads Finish instead of Next. */
  readonly nextLabel?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: '[data-tour="add-a"]',
    route: '/sources',
    title: 'Pick repo A',
    body: 'Add the first source — a GitHub repo or a local path.',
  },
  {
    target: '[data-tour="add-b"]',
    route: '/sources',
    title: 'Pick repo B',
    body: 'Add the second source to merge against.',
  },
  {
    target: '[data-tour="select-files"]',
    route: '/select',
    title: 'Select files',
    body: 'Choose which files from each repo end up in the merge.',
  },
  {
    target: '[data-tour="run-merge"]',
    route: '/stitch',
    title: 'Run the merge',
    body: 'Start the run — reasoning and tool calls stream live.',
  },
  {
    target: '[data-tour="review"]',
    route: '/review',
    title: 'Review the proposal',
    body: 'Check the diff, dependency conflicts, and licenses; exclude files if needed.',
  },
  {
    target: '[data-tour="results"]',
    route: '/results',
    title: 'View the result',
    body: 'Build and sandbox verdicts, CREDITS, and provenance land here.',
    nextLabel: 'Finish',
  },
];
