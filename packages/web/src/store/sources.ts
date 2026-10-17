// P-211's sources slice MOVED to `selection.ts` (P-212 owns the whole
// sources+selection slice per the spec's file list). Re-exported so the
// P-211 imports (RepoPicker, the tests) stand unchanged.

export { useSourcesStore, type SourceSlot, type SourcesState } from './selection.js';
