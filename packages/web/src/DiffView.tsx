import type { JSX } from 'react';
import DiffViewer, { type ReactDiffViewerStylesOverride } from 'react-diff-viewer-continued';

export type DiffViewProps = {
  oldValue: string;
  newValue: string;
  splitView?: boolean;
  dark?: boolean;
  leftTitle?: string;
  rightTitle?: string;
};

/**
 * stitchDiffStyles: diff chrome drawn from the P-049/P-209 stitch token
 * scale (index.css @theme). Added-line chrome follows the blue scale;
 * removed-line chrome intentionally stays on the library defaults until
 * P-217 pairs it with the P-209 danger tokens — no invented reds here.
 */
const stitchDiffStyles: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: '#eef3ff', // stitch-50
      gutterBackground: '#dfe9fd', // stitch-100
      addedBackground: '#dfe9fd', // stitch-100
      addedGutterBackground: '#c4d5fc', // stitch-200
    },
    dark: {
      diffViewerBackground: '#1c2342', // stitch-950
      gutterBackground: '#2e3d72', // stitch-900
      addedBackground: '#2f4189', // stitch-800
      addedGutterBackground: '#2e3d72', // stitch-900
    },
  },
};

/**
 * DiffView: file diff scaffold for the merge-review view (P-217) and
 * saved-session capture (P-230). Unified by default, split on request,
 * dark theme on request. The worker is disabled so computation is
 * synchronous and deterministic (P-217 may enable workers for large
 * files); the library owns all hunk computation — this component only
 * wires props, titles, and the stitch chrome.
 */
export function DiffView({
  oldValue,
  newValue,
  splitView = false,
  dark = false,
  leftTitle = 'Before',
  rightTitle = 'After',
}: DiffViewProps): JSX.Element {
  return (
    <DiffViewer
      oldValue={oldValue}
      newValue={newValue}
      splitView={splitView}
      useDarkTheme={dark}
      leftTitle={leftTitle}
      rightTitle={rightTitle}
      hideSummary
      disableWorker
      styles={stitchDiffStyles}
    />
  );
}
