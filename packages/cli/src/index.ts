import { CORE_NAME } from '@repo-stitcher/core';

export const CLI_NAME = '@repo-stitcher/cli';
export { CORE_NAME };
export { createProgram, runStatus, STITCH_VERSION } from './program.js';
export type { StatusOptions } from './program.js';
export { QuitOnQ, isQuitInput, renderScreen } from './tui.js';
export { createApp } from './serve.js';
export type { HealthBody } from './serve.js';
export { theme, colorsEnabled } from './theme.js';
export type { ThemeLevel } from './theme.js';
export {
  openStore,
  redactValue,
  defaultStoreDir,
  STITCH_CONFIG_DIR,
  STITCH_CONFIG_FILE,
  REDACTED,
} from './config.js';
export type { JsonValue, StitchStore } from './config.js';
