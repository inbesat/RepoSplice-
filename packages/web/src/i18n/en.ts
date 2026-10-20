// P-234 — the default (en) string catalog.
//
// Every user-facing string the web surface renders goes through `t(key)`; the
// key set is derived from THIS file, so a typo in another catalog is a
// compile-time error.
//
// The error copy (titles + recovery lines) lives in lib/errors.ts — the
// code→family mapper owns it — and is referenced here, so there is exactly
// ONE copy of each English string.

import { RECOVERY, TITLES } from '../lib/errors.js';

export const en = {
  // shell (P-210)
  'shell.tagline': 'AI-augmented multi-repo composition',
  'shell.settings': 'settings',
  'shell.runStatus.idle': 'idle',
  // empty state / tour (P-229)
  'tour.hero.title': 'Welcome to stitch',
  'tour.hero.bullet.1': 'Pick repo A, pick repo B, click merge.',
  'tour.hero.bullet.2': 'The AI plans the merge — you review the proposal.',
  'tour.hero.bullet.3': 'Approve to create the merged repo C.',
  'tour.hero.cta': 'Take the tour',
  'tour.step': 'step {current} of {total}',
  // settings (P-225)
  'settings.title': 'Settings',
  'settings.language.legend': 'Language',
  'settings.language.label': 'language',
  'settings.language.save': 'Save language',
  'settings.language.saved': 'language saved',
  // errors (P-228) — the copy is owned by the code→family mapper
  'error.config.title': TITLES.config,
  'error.config.recovery': RECOVERY.config,
  'error.license.title': TITLES.license,
  'error.license.recovery': RECOVERY.license,
  'error.sandbox.title': TITLES.sandbox,
  'error.sandbox.recovery': RECOVERY.sandbox,
  'error.ai.title': TITLES.ai,
  'error.ai.recovery': RECOVERY.ai,
  'error.deps.title': TITLES.deps,
  'error.deps.recovery': RECOVERY.deps,
  'error.hil.title': TITLES.hil,
  'error.hil.recovery': RECOVERY.hil,
  'error.path.title': TITLES.path,
  'error.path.recovery': RECOVERY.path,
  'error.internal.title': TITLES.internal,
  'error.internal.recovery': 'retry the step; if it persists, re-run the phase from the shell.',
};

/** Every key the app may ask for — the union of the catalog's keys. */
export type Keys = keyof typeof en;

/** A translation table: any subset of the keys, missing ones fall back to en. */
export type Catalog = Partial<Record<Keys, string>>;
