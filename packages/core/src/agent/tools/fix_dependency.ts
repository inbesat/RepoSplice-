// P-151 — agent tool `fix_dependency`.
//
// The first MUTATING agent tool of the epic. When `detect_gaps` (P-150) or
// `resolve_dependency_closure` (P-149) reports a missing dependency, this adds
// or updates it in child repo C's merged manifest at a compatible range.
//
// Two guarantees the phase is explicit about:
//
//  1. AUTONOMY. `autonomy: 'auto'` — adding a declared dependency is a
//     mechanical, reversible manifest edit, not a generative act. It needs no
//     human approval (unlike P-154 `propose_component`).
//
//  2. ROLLBACK / NO PARTIAL CORRUPTION. Every path that can fail returns
//     BEFORE any serialization happens, and the updated manifest is built as a
//     fresh object rather than mutating the caller's. A failure therefore
//     leaves the input manifest byte-identical — rollback is structural, not
//     best-effort. The tool returns the change; the writer (P-076/P-238) is
//     what puts it on disk.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext } from '../../ai/types.js';
import { serializePackageJson } from '../../deps/parse/npm.js';
import { satisfies as rangeSatisfies, validRange } from '../../deps/semver.js';
import type { UnifiedManifest } from '../../deps/types.js';
import { resolveDependenciesForFiles } from './resolve_deps.js';
import type {
  ApplyDependencyFixOptions,
  DepSection,
  FixResult,
  LatestVersionResolver,
  SelectedFile,
} from '../types.js';

/** A dependency section as a mutable string map, or why it is unavailable. */
type SectionView = Result<Record<string, string>, StitchError>;

function unsupported(ecosystem: string, section: DepSection): StitchError {
  return {
    code: 'UNSUPPORTED_ECOSYSTEM',
    ecosystem,
    message: `A ${ecosystem} manifest has no "${section}" section`,
  };
}

/**
 * Read one section of a merged manifest as a string map.
 *
 * The four manifest shapes genuinely disagree: Go spells its dependency set
 * `require` (not a P-151 section at all), Python/Cargo have no
 * `peerDependencies`, and Cargo's `dependencies` is optional. Each mismatch
 * returns `UNSUPPORTED_ECOSYSTEM` rather than being papered over, because
 * silently writing `peerDependencies` into a Cargo manifest would produce a
 * file no cargo tool reads.
 */
function readSection(manifest: UnifiedManifest, section: DepSection): SectionView {
  if ('module' in manifest && 'require' in manifest) {
    // GoManifest — only `require` exists.
    return section === 'dependencies'
      ? err(unsupported('go', section))
      : err(unsupported('go', section));
  }
  const record = manifest as unknown as Record<string, unknown>;
  const raw = record[section];
  if (raw === undefined || raw === null) return ok({});
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return err({
      code: 'DEPS_PARSE_ERROR',
      file: '<manifest>',
      message: `Manifest section "${section}" is not an object`,
    });
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = value;
    } else if (value !== null && typeof value === 'object' && 'version' in value) {
      // Cargo inline table: { version, features?, optional? } (P-106).
      const version = (value as { version: unknown }).version;
      out[key] = typeof version === 'string' ? version : '*';
    } else {
      out[key] = '*';
    }
  }
  return ok(out);
}

/**
 * Build a NEW manifest with `pkg` pinned to `version` in `section`.
 *
 * Pure and non-mutating: the input is never touched, so any earlier failure
 * cannot have corrupted it.
 */
function withDependency(
  manifest: UnifiedManifest,
  pkg: string,
  version: string,
  section: DepSection,
  current: Record<string, string>
): UnifiedManifest {
  const next = { ...current, [pkg]: version };
  // Spread preserves every other field and every other section; only the
  // targeted section is replaced.
  return {
    ...(manifest as unknown as Record<string, unknown>),
    [section]: next,
  } as unknown as UnifiedManifest;
}

/**
 * Are two ranges already the same requirement?
 *
 * `'1.3.0'` and `'^1.3.0'` are the same pin for a manifest's purpose, so
 * neither should trigger an `updated` action. Genuinely different majors do.
 */
export function rangesEquivalent(existing: string, desired: string): boolean {
  if (existing === desired) return true;
  const a = validRange(existing);
  const b = validRange(desired);
  if (a.isErr() || b.isErr()) return false;
  if (a.value === b.value) return true;
  const forward = rangeSatisfies(existing, desired);
  const backward = rangeSatisfies(desired, existing);
  if (forward.isOk() && forward.value) return true;
  if (backward.isOk() && backward.value) return true;
  return false;
}

/**
 * Validate a range WITHOUT rewriting it.
 *
 * P-019's `validRange` canonicalizes: `^1.3.0` comes back as
 * `>=1.3.0 <2.0.0-0`. Persisting that would be semantically identical but would
 * destroy the "as-authored" provenance P-151's handoff explicitly requires us
 * to preserve. So the canonical form is used only to prove the range parses;
 * the caller's own text is what gets written.
 */
function validatePreserving(range: string): Result<string, StitchError> {
  const checked = validRange(range);
  return checked.isErr() ? err(checked.error) : ok(range);
}

/**
 * Normalize the requested range into a concrete, valid range.
 *
 * - omitted / `'auto'`: prefer the range source repos A/B already pinned for
 *   this package (P-151 handoff: preserve the "as-authored" choice). When
 *   there is none, fall back to `^<latest>`.
 * - `'latest'`: `^<latest>` from the resolver.
 * - anything else: validated as-is, and returned exactly as written.
 */
export async function resolveFixRange(
  pkg: string,
  range: string | undefined,
  resolver: LatestVersionResolver,
  opts: ApplyDependencyFixOptions = {}
): Promise<Result<string, StitchError>> {
  const requested = range?.trim();
  if (requested === undefined || requested === '' || requested === 'auto') {
    const authored = opts.sourceRanges?.[pkg];
    if (authored !== undefined && authored !== '') return validatePreserving(authored);
    const latest = await resolver(pkg);
    if (latest.isErr()) return err(latest.error);
    return validatePreserving(`^${latest.value}`);
  }
  if (requested === 'latest') {
    const latest = await resolver(pkg);
    if (latest.isErr()) return err(latest.error);
    return validatePreserving(`^${latest.value}`);
  }
  return validatePreserving(requested);
}

/** Outcome of the pure planning step, including the new manifest. */
export interface DependencyFixPlan {
  fix: FixResult;
  manifest: UnifiedManifest;
}

/**
 * Pure planning step: decide what the fix would be and produce the updated
 * manifest. No I/O, so it is exhaustively testable and cannot leave partial
 * state — it either returns a complete new manifest or an error, and the
 * caller's manifest is never modified.
 */
export function planDependencyFix(
  manifest: UnifiedManifest,
  pkg: string,
  version: string,
  section: DepSection
): Result<DependencyFixPlan, StitchError> {
  const current = readSection(manifest, section);
  if (current.isErr()) return err(current.error);

  const existing = current.value[pkg];
  if (existing !== undefined && rangesEquivalent(existing, version)) {
    return ok({
      fix: { action: 'unchanged', package: pkg, version: existing, section },
      manifest,
    });
  }

  const action: FixResult['action'] = existing === undefined ? 'added' : 'updated';
  return ok({
    fix: { action, package: pkg, version, section },
    manifest: withDependency(manifest, pkg, version, section, current.value),
  });
}

/**
 * Resolve the requested range and plan the manifest edit (P-151 step 2).
 *
 * Returns the spec's `Result<FixResult, StitchError>`. Use
 * `planDependencyFix` directly when the caller also needs the updated
 * manifest text to write.
 */
export async function applyDependencyFix(
  manifest: UnifiedManifest,
  pkg: string,
  range: string | undefined,
  section: DepSection,
  resolver: LatestVersionResolver,
  opts: ApplyDependencyFixOptions = {}
): Promise<Result<FixResult, StitchError>> {
  const resolved = await resolveFixRange(pkg, range, resolver, opts);
  if (resolved.isErr()) return err(resolved.error);
  const planned = planDependencyFix(manifest, pkg, resolved.value, section);
  if (planned.isErr()) return err(planned.error);
  return ok(planned.value.fix);
}

/**
 * Serialize a fixed manifest, or `undefined` when the ecosystem has no
 * serializer exposed here.
 *
 * P-151 names the P-115 ecosystem serializer, but `getParser(...).serialize()`
 * throws on an ecosystem mismatch (deps/parsers/npm.ts:29) and `getParser`
 * itself throws on an unknown ecosystem (deps/plugin.ts:48) — both violate the
 * no-throw rule. The pure P-104 `serializePackageJson` is used directly
 * instead, and a non-npm manifest simply reports no serialization.
 */
export function serializeFixedManifest(manifest: UnifiedManifest): string | undefined {
  if (!('dependencies' in manifest) || !('name' in manifest)) return undefined;
  return serializePackageJson(manifest as Parameters<typeof serializePackageJson>[0]);
}

/** Tool schema (P-151 step 3). */
export const fixDependencySchema = {
  package: z.string().min(1),
  range: z.string().optional(),
  section: z.enum(['dependencies', 'devDependencies', 'peerDependencies']).default('dependencies'),
} satisfies Record<string, z.ZodTypeAny>;

const fixDependencyObject = z.object(fixDependencySchema);

/** The dependency map a `ToolContext` currently reports for C. */
async function currentDeps(ctx: ToolContext): Promise<Result<Record<string, string>, StitchError>> {
  try {
    return ok(await ctx.deps.analyze());
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({
      code: 'INTERNAL',
      message: `fix_dependency could not read C's merged manifest: ${detail}`,
    });
  }
}

/** Options the tool wrapper accepts beyond the model-visible schema. */
export interface FixDependencyOptions extends ApplyDependencyFixOptions {
  /** Selection used for the post-fix closure re-check (P-151 step 4). */
  selection?: SelectedFile[];
  /** Resolver; defaults to one that always fails (no implicit network). */
  resolver?: LatestVersionResolver;
}

/** The default resolver: no registry access from a tool by default. */
const noRegistryResolver: LatestVersionResolver = async pkg =>
  err({
    code: 'CONFIG_ERROR',
    field: 'resolver',
    message: `No version resolver configured; cannot resolve "${pkg}" without one`,
  });

/** Everything `runFixDependency` reports back. */
export interface FixDependencyOutcome extends FixResult {
  /** The updated manifest. The caller serializes/writes it, not this tool. */
  manifest: UnifiedManifest;
  /** Serialized text, present only for ecosystems with an exposed serializer. */
  serialized?: string;
  /** Post-fix closure re-check (P-151 step 4). */
  closure: { satisfied: boolean; missing: string[]; required: string[] };
}

/**
 * The full `fix_dependency` operation, with its infrastructure dependencies
 * injected rather than hidden.
 *
 * `ToolDefinition.execute` has no options channel, so the tool delegates here
 * with safe defaults (no resolver, empty selection) while tests and the
 * orchestrator supply the real ones.
 */
export async function runFixDependency(
  args: unknown,
  ctx: ToolContext,
  opts: FixDependencyOptions = {}
): Promise<Result<FixDependencyOutcome, StitchError>> {
  const parsed = fixDependencyObject.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
      .join('; ');
    return err({
      code: 'TOOL_ARGS_VALIDATION',
      message: `fix_dependency arguments validation failed: ${issues}`,
    });
  }
  const { package: pkg, range, section } = parsed.data;
  const resolver = opts.resolver ?? noRegistryResolver;

  // Read C's current merged manifest, then model it as the npm-shaped
  // `UnifiedManifest` the section API works over.
  const currentDepsResult = await currentDeps(ctx);
  if (currentDepsResult.isErr()) return err(currentDepsResult.error);
  const manifest = {
    name: 'child-repo-c',
    dependencies: { ...currentDepsResult.value },
  } as unknown as UnifiedManifest;

  // Resolve the range first: a resolver or validation failure returns before
  // any planning, so the input manifest is provably untouched.
  const resolved = await resolveFixRange(pkg, range, resolver, opts);
  if (resolved.isErr()) return err(resolved.error);

  const planned = planDependencyFix(manifest, pkg, resolved.value, section);
  if (planned.isErr()) return err(planned.error);

  // P-151 step 4: confirm the fix actually closes the gap. The closure reads C's
  // deps through the facade, so re-run it against a derived context reporting the
  // FIXED manifest — otherwise the check would read pre-fix state and could
  // never observe the change.
  const fixedDeps = { ...currentDepsResult.value, [pkg]: planned.value.fix.version };
  const verificationCtx = {
    ...ctx,
    deps: { ...ctx.deps, analyze: async (): Promise<Record<string, string>> => fixedDeps },
  } as ToolContext;
  const closure = await resolveDependenciesForFiles(opts.selection ?? [], verificationCtx);
  if (closure.isErr()) return err(closure.error);

  const serialized = serializeFixedManifest(planned.value.manifest);
  return ok({
    ...planned.value.fix,
    manifest: planned.value.manifest,
    ...(serialized !== undefined ? { serialized } : {}),
    closure: {
      satisfied: closure.value.satisfied.includes(pkg),
      missing: closure.value.missing,
      required: closure.value.required,
    },
  });
}

/** `fix_dependency` — `autonomy: 'auto'`, no approval gate. */
export const fixDependencyTool: ToolDefinition = {
  name: 'fix_dependency',
  description:
    'Add or update a dependency in child repo C manifest at a compatible version. Re-runs the dependency closure to confirm the gap is closed.',
  schema: fixDependencySchema,
  autonomy: 'auto',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> =>
    runFixDependency(args, ctx),
};
