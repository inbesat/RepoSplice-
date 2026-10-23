// P-149 — agent tool `resolve_dependency_closure`.
//
// Selecting a subset of files from A/B is only safe if every package those
// files need is present in child repo C. This tool computes that requirement —
// it is strictly READ-ONLY (P-149 step 4): it reads listings, file contents and
// manifests, and reports. Satisfying a gap is `fix_dependency` (P-151)'s job.
//
// The closure is deterministic and pure with respect to its inputs, because
// P-149's handoff requires comparing manifests across runs.

import { z } from 'zod';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ToolDefinition, ToolContext } from '../../ai/types.js';
import {
  parseCargoToml,
  parseGoMod,
  parsePackageJson,
  parsePythonManifest,
} from '../../deps/parse/index.js';
import type { ParsedManifest } from '../../deps/types.js';
import {
  classifyJsSpecifier,
  jsPackageName,
  parseJsImports,
  parsePythonImports,
  pythonPackageName,
  resolveRelativeImport,
} from '../imports.js';
import {
  emptyDepClosure,
  type DepClosure,
  type DepSeverity,
  type SelectedFile,
  type SourceRepo,
} from '../types.js';
import type { Ecosystem } from '../../deps/ecosystem.js';
import { extractSpecifiers, languageForFile } from '../../resolve/heuristic-fallback.js';
import { createResolverRegistry, type ResolverRegistry } from '../../resolve/registry.js';
import type { ResolvedImport } from '../../resolve/types.js';

/** Extensions whose imports we parse. `.rs`/`.go` carry no import statements. */
const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi']);

/** Root manifests probed per source repo, in ecosystem precedence order. */
const MANIFEST_CANDIDATES: ReadonlyArray<{ path: string; ecosystem: string }> = [
  { path: 'package.json', ecosystem: 'npm' },
  { path: 'requirements.txt', ecosystem: 'python' },
  { path: 'pyproject.toml', ecosystem: 'python' },
  { path: 'Cargo.toml', ecosystem: 'cargo' },
  { path: 'go.mod', ecosystem: 'go' },
];

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot);
}

/** Normalize a repo-relative path the same way P-148 does. */
function normalizePath(path: string): string {
  let out = path.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  return out.replace(/\/+$/, '');
}

/** `repo:path` — the unambiguous key used by `byFile` and the file lists. */
function keyed(repo: SourceRepo, path: string): string {
  return `${repo}:${path}`;
}

/**
 * Dependency names a parsed manifest declares, across all four ecosystems.
 *
 * Each `?? {}` is load-bearing: the four manifest shapes do not agree on
 * whether `dependencies` is optional (P-106 Cargo allows a manifest with no
 * `[dependencies]` table; P-105 Python allows a comment-only file), so the
 * access is defensively defaulted rather than assumed present.
 */
function manifestDependencyNames(parsed: ParsedManifest): string[] {
  switch (parsed.ecosystem) {
    case 'npm':
      return Object.keys(parsed.manifest.dependencies ?? {});
    case 'python':
      return Object.keys(parsed.manifest.dependencies ?? {});
    case 'cargo':
      return Object.keys(parsed.manifest.dependencies ?? {});
    case 'go':
      // go.mod spells the dependency set `require`, not `dependencies`.
      return Object.keys(parsed.manifest.require);
  }
}

/** Parse one root manifest with the parser its ecosystem mandates (P-104–P-107). */
function parseManifest(
  ecosystem: string,
  content: string,
  filePath: string
): Result<ParsedManifest, StitchError> {
  switch (ecosystem) {
    case 'npm':
      return parsePackageJson(content, filePath);
    case 'python':
      // P-105's dispatcher takes (filePath, content) — the opposite order to
      // parsePackageJson/parseCargoToml/parseGoMod. Verified against
      // deps/parse/python.ts:538 rather than assumed.
      return parsePythonManifest(filePath, content);
    case 'cargo':
      return parseCargoToml(content, filePath);
    case 'go':
      return parseGoMod(content, filePath);
    default:
      return err({
        code: 'UNSUPPORTED_ECOSYSTEM',
        ecosystem,
        message: `resolve_dependency_closure cannot parse manifests for ecosystem ${ecosystem}`,
      });
  }
}

/**
 * Compute the dependency closure of `selection` against child repo C.
 *
 * Algorithm (deterministic, read-only):
 *  1. Empty selection -> empty closure, `ok`. Not an error (acceptance).
 *  2. Load each involved source repo's listing (P-148 `GitFacade.listFiles`).
 *  3. Parse each selected file's imports: bare specifiers become package
 *     requirements for that file; relative specifiers become internal edges.
 *  4. BFS the internal edges so files the caller did not select are still
 *     traversed — their packages are required *transitively*. Any internal
 *     file reached but not selected is reported in `missingFiles`.
 *  5. Add each involved repo's root-manifest dependencies (P-104–P-107).
 *  6. Split `required` against C's merged manifest (`ctx.deps.analyze`):
 *     present -> `satisfied`, absent -> `missing`.
 *  7. `missing` is split into `missingDirect` / `missingTransitive` and tagged
 *     in `severity`, which is the hint P-149 step 5 hands the fixer.
 */
/** P-343: the resolver stack the walk may use, plus an ecosystem override. */
export interface ResolveDependenciesOptions {
  /** The P-341 stack. Absent = the P-149 lexical path only. */
  readonly registry?: ResolverRegistry;
  /** Force one ecosystem instead of detecting it per file. */
  readonly ecosystem?: Ecosystem;
}

/**
 * One specifier through the resolver stack (P-343).
 *
 * Only edges that land on a file of the SAME source repo are internal edges: a
 * target under `node_modules`/`vendor` is a package requirement (the lexical
 * rules below classify it) and the `unresolved` marker is not an answer at all.
 * An empty list means "the stack could not help" — never an error.
 */
async function resolveThroughRegistry(
  registry: ResolverRegistry,
  filePath: string,
  specifier: string,
  listing: Set<string> | undefined,
  ecosystem: Ecosystem | undefined
): Promise<ResolvedImport[]> {
  const forced = ecosystem === undefined ? undefined : registry.getResolver(ecosystem);
  const answer =
    forced === undefined
      ? await registry.resolve(filePath, specifier)
      : await forced.resolve(filePath, specifier);
  if (answer.isErr()) return [];
  const edges: ResolvedImport[] = [];
  for (const edge of answer.value) {
    if (edge.confidence === 'unresolved' || edge.targetFile === '') continue;
    if (edge.targetFile.startsWith('../')) continue;
    if (listing !== undefined && !listing.has(edge.targetFile)) continue;
    edges.push(edge);
  }
  return edges;
}

export async function resolveDependenciesForFiles(
  selection: readonly SelectedFile[],
  ctx: ToolContext,
  options?: ResolveDependenciesOptions
): Promise<Result<DepClosure, StitchError>> {
  // Acceptance: an empty selection is an empty closure, not an error.
  if (selection.length === 0) return ok(emptyDepClosure());

  const readFile = ctx.git.readFile;
  if (readFile === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.readFile',
      message:
        'resolve_dependency_closure requires GitFacade.readFile; the caller did not provide source-repo file contents',
    });
  }
  const listFiles = ctx.git.listFiles;
  if (listFiles === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.listFiles',
      message:
        'resolve_dependency_closure requires GitFacade.listFiles; the caller did not provide a source-repo file listing',
    });
  }

  // --- listings, one per involved repo ---------------------------------
  const listings = new Map<SourceRepo, Set<string>>();
  for (const repo of new Set(selection.map(f => f.repo))) {
    const listed = await listFiles.call(ctx.git, ctx.cwd, repo);
    if (listed.isErr()) return err(listed.error);
    listings.set(repo, new Set(listed.value.map(p => normalizePath(p))));
  }

  const selectedKeys = new Set(selection.map(f => keyed(f.repo, normalizePath(f.path))));
  const direct = new Set<string>();
  const transitive = new Set<string>();
  const byFile: Record<string, string[]> = {};
  const missingFiles = new Set<string>();
  const visited = new Set<string>();
  const resolvedEdges: ResolvedImport[] = [];

  // Breadth-first over internal edges. The queue is a plain array used as FIFO;
  // insertion order is deterministic because `selection` order is preserved.
  const queue: Array<{ repo: SourceRepo; path: string; isSelected: boolean }> = selection.map(
    f => ({ repo: f.repo, path: normalizePath(f.path), isSelected: true })
  );

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const { repo, path, isSelected } = current;
    const key = keyed(repo, path);
    if (visited.has(key)) continue;
    visited.add(key);

    const content = await readFile.call(ctx.git, ctx.cwd, repo, path);
    if (content.isErr()) {
      // A selected file that cannot be read is a real defect in the proposal
      // (P-148 validated it against the listing, so this is a facade fault or a
      // vanished file). Surface it rather than under-reporting the closure.
      return err(content.error);
    }

    const ext = extensionOf(path);
    // The lexical classification (a relative target versus a package
    // requirement) is derived from the EXTENSION, never from which extractor
    // ran. The stack answers where an import resolves internally; the lexical
    // rules are what turns a package specifier into a requirement, so a
    // registry miss on `fake-pkg` must still be reported as a package need.
    const isJs = JS_EXTENSIONS.has(ext);
    const isPython = PYTHON_EXTENSIONS.has(ext);
    const specifiers: string[] = [];
    if (options?.registry !== undefined) {
      // P-343: the stack extracts every language it knows — including `.go` and
      // `.rs`, which the P-149 lexical extractors cannot read.
      const language = languageForFile(path);
      if (language !== undefined) {
        const extracted = await extractSpecifiers(content.value, language);
        if (extracted.isOk()) specifiers.push(...extracted.value);
      }
    } else if (isJs) {
      specifiers.push(...parseJsImports(content.value));
    } else if (isPython) {
      specifiers.push(...parsePythonImports(content.value));
    }

    const filePackages = new Set<string>();
    for (const specifier of specifiers) {
      // P-343: the resolver stack answers first. An answered internal edge is
      // recorded with its confidence tag and queued like any other internal
      // file; anything it cannot answer falls through to the lexical rules.
      if (options?.registry !== undefined) {
        const edges = await resolveThroughRegistry(
          options.registry,
          path,
          specifier,
          listings.get(repo),
          options.ecosystem
        );
        if (edges.length > 0) {
          for (const edge of edges) {
            resolvedEdges.push(edge);
            const edgeKey = keyed(repo, edge.targetFile);
            if (!selectedKeys.has(edgeKey)) missingFiles.add(edgeKey);
            queue.push({ repo, path: edge.targetFile, isSelected: false });
          }
          continue;
        }
      }
      if (isJs) {
        const kind = classifyJsSpecifier(specifier);
        if (kind === 'relative') {
          const listing = listings.get(repo);
          const target =
            listing === undefined ? undefined : resolveRelativeImport(path, specifier, listing);
          if (target === undefined) {
            // Unresolvable relative import: the file is not in the listing, so
            // the agent must add it (or it genuinely does not exist).
            missingFiles.add(keyed(repo, specifier));
            continue;
          }
          const targetKey = keyed(repo, target);
          if (!selectedKeys.has(targetKey)) missingFiles.add(targetKey);
          queue.push({ repo, path: target, isSelected: false });
          continue;
        }
        if (kind === 'builtin') continue;
        const pkg = jsPackageName(specifier);
        if (pkg !== undefined) filePackages.add(pkg);
        continue;
      }
      if (isPython) {
        const pkg = pythonPackageName(specifier);
        if (pkg !== undefined) filePackages.add(pkg);
      }
    }

    // Only files the caller actually selected contribute DIRECT requirements;
    // files reached by traversal contribute TRANSITIVE ones. A file that is
    // both selected and reached keeps its direct classification.
    const target = isSelected || selectedKeys.has(key) ? direct : transitive;
    for (const pkg of filePackages) target.add(pkg);

    if (filePackages.size > 0) {
      byFile[key] = [...filePackages].sort();
    }
  }

  // --- root-manifest dependencies for every involved repo ---------------
  for (const [repo, listing] of listings) {
    for (const candidate of MANIFEST_CANDIDATES) {
      if (!listing.has(candidate.path)) continue;
      const read = await readFile.call(ctx.git, ctx.cwd, repo, candidate.path);
      // A manifest that is present in the listing but unreadable is skipped
      // rather than fatal: a listing can legitimately be stale.
      if (read.isErr()) continue;
      const parsed = parseManifest(candidate.ecosystem, read.value, candidate.path);
      if (parsed.isErr()) continue;
      for (const name of manifestDependencyNames(parsed.value)) {
        // Declared in the source manifest but not imported by a selected file:
        // the selection still needs it to build.
        if (!direct.has(name)) transitive.add(name);
      }
    }
  }

  const required = [...new Set([...direct, ...transitive])].sort();

  // --- split against child repo C's merged manifest ----------------------
  let merged: Record<string, string>;
  try {
    merged = await ctx.deps.analyze();
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err({
      code: 'INTERNAL',
      message: `resolve_dependency_closure could not read C's merged manifest: ${detail}`,
    });
  }

  const satisfied: string[] = [];
  const missing: string[] = [];
  for (const name of required) {
    if (Object.hasOwn(merged, name)) satisfied.push(name);
    else missing.push(name);
  }

  const missingDirect = missing.filter(name => direct.has(name));
  const missingTransitive = missing.filter(name => !direct.has(name));
  const severity: Record<string, DepSeverity> = {};
  for (const name of missing) {
    severity[name] = direct.has(name) ? 'direct' : 'transitive';
  }

  return ok({
    required,
    missing: missing.sort(),
    satisfied: satisfied.sort(),
    byFile,
    direct: [...direct].sort(),
    transitive: [...transitive].sort(),
    missingDirect: missingDirect.sort(),
    missingTransitive: missingTransitive.sort(),
    severity,
    missingFiles: [...missingFiles].sort(),
    visitedFiles: [...visited].sort(),
    resolvedEdges: [...resolvedEdges].sort((a, b) =>
      `${a.sourceFile}:${a.targetFile}`.localeCompare(`${b.sourceFile}:${b.targetFile}`)
    ),
  });
}

/** Tool schema (P-149 step 3). */
export const resolveDepsSchema = {
  files: z
    .array(z.object({ repo: z.enum(['A', 'B']), path: z.string().min(1) }))
    .min(1)
    .max(2000),
  /** P-343: force one ecosystem instead of detecting it per file. */
  ecosystem: z.enum(['node', 'python', 'go', 'rust']).optional(),
} satisfies Record<string, z.ZodTypeAny>;

const resolveDepsObject = z.object(resolveDepsSchema);

/** `resolve_dependency_closure` — read-only, `autonomy: 'auto'`. */
export const resolveDepsTool: ToolDefinition = {
  name: 'resolve_dependency_closure',
  description:
    'Compute transitive dependency closure for selected files and report missing packages. Read-only; use fix_dependency to satisfy gaps.',
  schema: resolveDepsSchema,
  autonomy: 'auto',
  execute: async (args: unknown, ctx: ToolContext): Promise<Result<unknown, StitchError>> => {
    const parsed = resolveDepsObject.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(i => `${i.path.length > 0 ? '/' + i.path.join('/') : '(root)'}: ${i.message}`)
        .join('; ');
      return err({
        code: 'TOOL_ARGS_VALIDATION',
        message: `resolve_dependency_closure arguments validation failed: ${issues}`,
      });
    }
    // P-343: the tool drives the resolver stack itself. Heuristic-only by
    // default — an agent turn must not spawn a language server per call
    // (P-344 brings warm-server caching).
    return resolveDependenciesForFiles(parsed.data.files, ctx, {
      registry: createResolverRegistry({ rootDir: ctx.cwd, lspMode: 'never' }),
      ...(parsed.data.ecosystem !== undefined ? { ecosystem: parsed.data.ecosystem } : {}),
    });
  },
};
