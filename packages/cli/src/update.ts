import updateNotifier from 'update-notifier';

/** CLI flag opting out of the update check (scripts, P-296/305). */
export const NO_UPDATE_FLAG = '--no-update-check';
/** Env var opting out of the update check (scripts, P-296/305). Presence opts out; value is irrelevant. */
export const NO_UPDATE_ENV = 'STITCH_NO_UPDATE';
/** How often the registry may be queried: once per day (update-notifier default). */
export const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 24;

/** Minimal package identity update-notifier needs (name + current version). */
export type NotifierPackage = {
  name: string;
  version: string;
};

/** A newer cached version: what to tell the user. Null means stay silent. */
export type UpdateInfo = {
  current: string;
  latest: string;
};
export type UpdateNotice = UpdateInfo | null;

/**
 * shouldCheckForUpdates: pure gate for the one-shot startup check.
 * Disabled in CI and on explicit opt-out (`STITCH_NO_UPDATE` present or
 * `--no-update-check` in argv). `env`/`argv` inject so tests never touch
 * the real process state.
 */
export function shouldCheckForUpdates(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env['CI'] !== undefined) return false;
  if (env[NO_UPDATE_ENV] !== undefined) return false;
  return !argv.includes(NO_UPDATE_FLAG);
}

/**
 * createNotifier: construct the update-notifier for `pkg` with the daily
 * check interval. Construction is lazy and offline-safe: the registry is
 * only queried by a detached background child, and `.update` simply reads
 * the on-disk cache (undefined when nothing is cached).
 */
export function createNotifier(pkg: NotifierPackage) {
  return updateNotifier({ pkg, updateCheckInterval: UPDATE_CHECK_INTERVAL_MS });
}

/**
 * toNotice: map a cached update record to the notice shape, or null when
 * there is nothing cached. Pure, so both sides are unit-testable without
 * fabricating on-disk cache files.
 */
export function toNotice(update: { current: string; latest: string } | undefined): UpdateNotice {
  if (update === undefined) return null;
  return { current: update.current, latest: update.latest };
}

/**
 * maybeNotify: gated one-shot check for CLI startup (P-189 calls this).
 * Returns null when gated off or when nothing newer is cached; otherwise
 * prints the update box via `.notify()` and returns the notice. Never
 * throws and never blocks on the network: the registry check runs in a
 * detached child, and a missing/unreachable registry just yields null.
 */
export function maybeNotify(
  pkg: NotifierPackage,
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): UpdateNotice {
  if (!shouldCheckForUpdates(argv, env)) return null;
  const notifier = createNotifier(pkg);
  notifier.notify();
  return toNotice(notifier.update);
}
