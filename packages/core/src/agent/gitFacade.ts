// P-165 — Agent tools: git-core integration.
//
// The production `ToolContext['git']` facade. Agent tools address two
// different things through this one interface, and the split is deliberate
// (ADR-023/ADR-025):
//
//   SOURCE reads (repos the user picked):
//     listFiles(cwd, 'A' | 'B')      → P-034/P-090-style listing
//     readFile(cwd, 'A' | 'B', path) → one source file's text
//
//   STAGE mutations (child repo C — "the child-repo stage"):
//     readStagedFile(path)           → read from C
//     writeFile(cwd, label, path, c) → write into C + `git add`
//     move(cwd, label, from, to)     → atomic rename inside C
//     deleteFile(cwd, label, path)   → delete inside C + stage
//     commit / commitStage           → history on C with provenance trailers
//     rollback / abort               → P-085 escape hatches on C
//     mergeSources                   → P-072 merge (uses the P-075 resolver)
//     stageStatus                    → P-084 clean-tree check on C
//
// Why the mutating methods ignore their `label` argument: the P-140
// `GitFacade` declaration types it `'A' | 'B'`, but repo C is not a source
// (ADR-023) and every mutating tool passes the placeholder convention
// `'A'` (`REVERT_REPO` in `revert.ts`). The label is preserved for signature
// compatibility and recorded as the provenance origin hint — the mutation
// itself always lands in C, because that is the tree being composed. Mapping
// it to source A would rewrite the user's originals and corrupt provenance.
//
// Provenance tagging (spec step 3): every commit this facade makes carries a
// JSON `Stitch-Origin:` trailer recording which source supplied the change,
// so P-079/P-181's blame map can be reconstructed from history alone. The
// trailer stays structured (one-line JSON) per the handoff note so a future
// parser reads it with `JSON.parse`.
//
// Safety properties (spec steps 4–5):
// - Every path is resolved with `resolveWithin` against the target root
//   BEFORE any fs call (fast-fail, `CONFIG_ERROR`), so `../evil` or an
//   absolute path never escapes the stage.
// - The P-082 binary skip is respected: a NUL-bearing payload is refused
//   before it is written, and every write is verified with `isBinary`
//   (git attr + extension + magic) afterwards, reverting the bytes and
//   returning a typed error if the file is binary. Silently dropping a file
//   the model asked to write is the "it never happened" failure P-162
//   exists to prevent, so the skip is always surfaced.
//
// `commitStage`/`mergeSources`/`stageStatus`/`rollback`/`abort` are extra
// capabilities on THE SAME CLASS: the `GitFacade` interface declares none of
// them, so tools cannot invent history on their own — only the orchestrator
// (P-238) and tests address the concrete type.

import { ok, err, type Result } from 'neverthrow';
import type { GitFacade as GitFacadeContract } from '../ai/types.js';
import { type StitchError, stitchErrorMessage } from '../result/index.js';
import { commitWithTrailers, type CoAuthor } from '../git/commit.js';
import { resetTo, abortGitOp, type AbortKind } from '../git/rollback.js';
import { isClean } from '../git/clean.js';
import { isBinary } from '../git/binary.js';
import { mergeRepos, type MergeOptions, type MergeResult } from '../git/merge.js';
import { resolveWithin } from '../util/paths.js';
import { listFiles as utilListFiles } from '../util/glob.js';
import { pathExists } from '../util/fs.js';
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  rename as fsRename,
  unlink as fsUnlink,
  mkdir as fsMkdir,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Git's own magic-byte window (mirrors `git/binary.ts`). */
const BINARY_SNIFF_BYTES = 8000;

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Where the three repositories live. Repo A and B are the sources the user
 * picked; repo C is the child stage the merge composes and the agent mutates.
 */
export interface FacadePaths {
  /** Repo `'A'` checkout path. Absolute. */
  repoA: string;
  /** Repo `'B'` checkout path. Absolute. */
  repoB: string;
  /** Child repo C's worktree (the stage). Absolute. */
  repoC: string;
}

/** Provenance of one file change, recorded in the Stitch-Origin trailer. */
export interface StitchOrigin {
  /** Source label that supplied the change (`A`/`B`/`agent`). */
  source: string;
  /** Path in the source tree, repo-relative. */
  path: string;
  /** What the change was (audit aid; P-181 consumes the whole trailer). */
  op: 'write' | 'move' | 'delete' | 'component';
}

/** Options for {@link GitFacade.commitStage}: provenance + staging control. */
export interface StageCommitOptions {
  /** Co-authors (P-077 trailers): human approvals / the agent identity. */
  coAuthors?: readonly CoAuthor[];
  /** Structured origin: what this change is and where it came from. */
  origin?: StitchOrigin;
  /** Confine staging to these repo-relative paths (P-077 `files`). */
  files?: readonly string[];
  /** Git timeout. Default 60s (matches siblings). */
  timeoutMs?: number;
}

/** Result of {@link GitFacade.commitStage}: children deserialize this via WS. */
export interface CommitInfo {
  sha: string;
  message: string;
}

const TRAILER_PREFIX = 'Stitch-Origin:';
const ORIGIN_OPS = ['write', 'move', 'delete', 'component'] as const;

/**
 * Compose the provenance footer. Co-author trailers are handled by P-077;
 * `origin` becomes one JSON trailer line.
 */
function withOriginTrailer(message: string, origin?: StitchOrigin): string {
  if (origin === undefined) return message;
  const body = originJson(origin);
  return `${message.trimEnd()}\n\n${TRAILER_PREFIX} ${body}\n`;
}

function originJson(origin: StitchOrigin): string {
  // Trailers must stay one line for `git log -1`, and a trailer value may not
  // contain a newline; JSON.stringify escapes control characters already, so
  // the replace is belt-and-braces.
  return JSON.stringify(origin).replace(/\r?\n/g, ' ').trim();
}

/** Parse the Stitch-Origin trailer back out of a commit message (P-181 seam). */
export function parseOriginTrailer(message: string): StitchOrigin | undefined {
  for (const line of message.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(TRAILER_PREFIX)) continue;
    const raw = trimmed.slice(TRAILER_PREFIX.length).trim();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object') {
        const o = parsed as { source?: unknown; path?: unknown; op?: unknown };
        if (
          typeof o.source === 'string' &&
          typeof o.path === 'string' &&
          typeof o.op === 'string'
        ) {
          if ((ORIGIN_OPS as readonly string[]).includes(o.op)) {
            return { source: o.source, path: o.path, op: o.op as StitchOrigin['op'] };
          }
        }
      }
    } catch {
      // Not our trailer (someone else's footer with the same prefix; ignore).
    }
  }
  return undefined;
}

/**
 * Traversal check shared by every path-taking method. Fast-fails BEFORE any
 * fs call and names the offending path so the audit trail is useful.
 */
export function withinRepoRoot(repoPath: string, relPath: string): Result<string, StitchError> {
  if (relPath.trim() === '') {
    return err({ code: 'CONFIG_ERROR', field: 'path', message: 'path must not be empty' });
  }
  // Backslashes are legal Windows separators; normalize to forward slashes so
  // `resolveWithin` compares them as relative rather than absolute.
  const normalized = relPath.replace(/\\/g, '/');
  const resolved = resolveWithin(repoPath, normalized);
  if (resolved.isErr()) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `path escapes the stage root ("${relPath}")`,
    });
  }
  return ok(resolved.value);
}

/**
 * In-memory magic check: a NUL inside git's sniff window marks binary. This is
 * exactly the rule P-082 implements over on-disk bytes, applied here so an
 * obviously-binary payload is refused before it ever reaches disk.
 */
function hasNulInWindow(content: string): boolean {
  return content.slice(0, BINARY_SNIFF_BYTES).includes('\u0000');
}

interface GitOut {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** Run git, converting a spawn rejection into data (never throws). */
async function gitRun(
  repoPath: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<GitOut> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoPath,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer',
    });
    return { code: 0, stdout: stdout as Buffer, stderr: '' };
  } catch (error) {
    const e = error as { code?: unknown; stdout?: Buffer | string; stderr?: unknown };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: Buffer.from(e.stdout === undefined ? '' : (e.stdout as Buffer | string)),
      stderr: e.stderr === undefined ? String(error) : String(e.stderr),
    };
  }
}

/** Read a text file, or `undefined` when it does not exist / cannot be read. */
async function readTextOrUndefined(absPath: string): Promise<string | undefined> {
  try {
    return await fsReadFile(absPath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Restore a file to its prior bytes, or remove it when it is new. Best effort. */
async function restoreOrRemove(absPath: string, prior: string | undefined): Promise<void> {
  try {
    if (prior === undefined) {
      await fsUnlink(absPath);
    } else {
      await fsWriteFile(absPath, prior, 'utf8');
    }
  } catch {
    // Best effort: the caller's typed error is what matters.
  }
}

/**
 * Expand the tool-intended file list into the set of paths that still need
 * `git add` before the commit.
 *
 * P-077's precheck compares the intended set against `git status
 * --porcelain=v1 -z`, which reports a whole never-committed directory as
 * `?? <dir>/` — so `intended: ['docs/note.ts']` where `docs/` is brand-new is
 * refused. Tools speak files, not status entries, so this asks git itself,
 * once, with `--untracked-files=all`: per-file paths for tracked/untracked/
 * deleted entries. Directories expand to the files inside them, and each
 * intended entry maps 1:1 when it is already a file path.
 *
 * Already-staged deletions (`D ` entries, and the source side of a staged
 * rename/copy) are EXCLUDED: `git add` refuses a pathspec that matches
 * nothing once the deletion is already in the index, and there is nothing
 * left to stage for those paths anyway — the mutating op (`move`,
 * `deleteFile`) staged them. A genuinely unmatched entry is deliberately
 * PASSED THROUGH so git refuses it with a real message instead of the commit
 * silently omitting a path the tool named.
 */
async function expandIntended(
  repoPath: string,
  intended: readonly string[]
): Promise<Result<string[], StitchError>> {
  const probe = await gitRun(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (probe.code !== 0) {
    return err({
      code: 'GIT_ERROR',
      message: `expandIntended: git status failed: ${probe.stderr}`,
    });
  }
  // Porcelain -z chunks: `XY <path>\0`. A rename/copy head (`R`/`C` in X) is
  // followed by a second, prefix-less chunk carrying the source path.
  const changed = new Set<string>();
  const stagedDeletions = new Set<string>();
  const parts = probe.stdout
    .toString('utf8')
    .split('\0')
    .filter(p => p !== '');
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i]!;
    if (chunk.length < 4) continue; // `XY ` plus at least one char
    const x = chunk.charAt(0);
    const path = chunk.slice(3).replace(/\\/g, '/');
    changed.add(path);
    if (x === 'R' || x === 'C') {
      // Staged rename/copy: the next chunk is the source path.
      i++;
      const source = (parts[i] ?? '').replace(/\\/g, '/');
      if (source !== '') {
        changed.add(source);
        stagedDeletions.add(source);
      }
    } else if (x === 'D') {
      // Staged deletion: already recorded in the index, nothing to add.
      stagedDeletions.add(path);
    }
  }
  const out: string[] = [];
  for (const entry of intended) {
    const norm = entry.replace(/\\/g, '/').replace(/\/$/, '');
    if (changed.has(norm)) {
      if (!stagedDeletions.has(norm)) out.push(norm);
      continue;
    }
    const prefix = `${norm}/`;
    let matched = false;
    for (const p of changed) {
      if (p.startsWith(prefix) && !stagedDeletions.has(p)) {
        out.push(p);
        matched = true;
      }
    }
    if (!matched) out.push(norm);
  }
  return ok([...new Set(out)].sort());
}

/**
 * The production git facade for the agent's `ToolContext`.
 *
 * Constructed with the three resolved checkout paths; every method validates
 * traversal against its target root and delegates to a git-core module.
 */
export class GitFacade implements GitFacadeContract {
  private readonly paths: FacadePaths;

  constructor(paths: FacadePaths) {
    this.paths = paths;
  }

  /** The child stage (repo C) — the only tree the agent mutates. */
  private get stage(): string {
    return this.paths.repoC;
  }

  /** Map a SOURCE label ('A' | 'B') to its checkout path. */
  private repoFor(label: 'A' | 'B'): string {
    return label === 'A' ? this.paths.repoA : this.paths.repoB;
  }

  // ---------------------------------------------------------------------------
  // Pre-P-165 read-only surface (interface compatibility; now real).
  // ---------------------------------------------------------------------------

  /** Real `git diff` of the stage; empty string on any failure. */
  async diff(): Promise<string> {
    const out = await gitRun(this.stage, ['--no-pager', 'diff', '--no-color']);
    return out.code === 0 ? out.stdout.toString('utf8') : '';
  }

  /** Real porcelain status of the stage; an empty string means clean. */
  async status(): Promise<string> {
    const out = await gitRun(this.stage, ['status', '--porcelain']);
    return out.code === 0 ? out.stdout.toString('utf8').trimEnd() : '';
  }

  /** Stage the given paths in the stage. Best effort (interface returns void). */
  async add(files: string[]): Promise<void> {
    if (files.length === 0) return;
    const safe: string[] = [];
    for (const file of files) {
      const resolved = withinRepoRoot(this.stage, file);
      if (resolved.isErr()) continue; // never stage a path that escapes
      safe.push(file);
    }
    if (safe.length === 0) return;
    await gitRun(this.stage, ['add', '--', ...safe]);
  }

  // ---------------------------------------------------------------------------
  // Source reads (A / B).
  // ---------------------------------------------------------------------------

  /**
   * List every tracked-meaningful path of a SOURCE repo (P-148 `select_files`).
   *
   * One fs walk via `util.listFiles` (P-034 glob), no git plumbing; filtered
   * and sorted so the AI reasoning stream is deterministic (same input → same
   * order). `.git` internals are excluded.
   */
  async listFiles(cwd: string, repo: 'A' | 'B'): Promise<Result<string[], StitchError>> {
    void cwd; // The facade owns the mapping; tools pass ctx.cwd for fidelity.
    const root = this.repoFor(repo);
    const listing = await utilListFiles(root, '**/*', {
      dot: false,
      ignore: ['**/.git/**', '.git/**', '**/.git'],
    });
    if (listing.isErr()) return err(listing.error);
    const rel = listing.value.map(p =>
      p.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length + 1)
    );
    return ok(rel.sort());
  }

  /** Read one SOURCE file's text, or FILE_NOT_FOUND when it does not exist. */
  async readFile(cwd: string, repo: 'A' | 'B', path: string): Promise<Result<string, StitchError>> {
    void cwd;
    const root = this.repoFor(repo);
    const resolved = withinRepoRoot(root, path);
    if (resolved.isErr()) return err(resolved.error);
    try {
      const text = await fsReadFile(resolved.value, 'utf8');
      return ok(text);
    } catch (error) {
      const missing = (error as { code?: string }).code === 'ENOENT';
      const detail = error instanceof Error ? error.message : String(error);
      return err(
        missing
          ? { code: 'FILE_NOT_FOUND', path, message: `readFile: "${path}" does not exist` }
          : { code: 'INTERNAL', message: `readFile("${path}") failed: ${detail}` }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stage reads (C).
  // ---------------------------------------------------------------------------

  /**
   * Read one file from the child stage (P-152 `edit_config`, P-153
   * `move_file`, P-161 revert). This is the read surface the mutating tools
   * pair with `writeFile`, so both address the same tree.
   */
  async readStagedFile(path: string): Promise<Result<string, StitchError>> {
    const resolved = withinRepoRoot(this.stage, path);
    if (resolved.isErr()) return err(resolved.error);
    try {
      return ok(await fsReadFile(resolved.value, 'utf8'));
    } catch (error) {
      const missing = (error as { code?: string }).code === 'ENOENT';
      const detail = error instanceof Error ? error.message : String(error);
      return err(
        missing
          ? { code: 'FILE_NOT_FOUND', path, message: `readStagedFile: "${path}" does not exist` }
          : { code: 'INTERNAL', message: `readStagedFile("${path}") failed: ${detail}` }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stage mutations (C).
  // ---------------------------------------------------------------------------

  /**
   * Write a text file into the child stage and stage it with `git add`.
   *
   * A payload whose first 8000 characters contain a NUL is refused up front
   * (the P-082 magic rule); otherwise the bytes are written, then verified
   * with P-082's `isBinary` (git attr / extension / magic) and REVERTED with a
   * typed error if the file turns out to be binary — the skip is surfaced, not
   * silently dropped. The `label` argument is the P-140 placeholder
   * (`'A' | 'B'`); the mutation always lands in C (see the file header).
   */
  async writeFile(
    cwd: string,
    repo: 'A' | 'B',
    path: string,
    content: string
  ): Promise<Result<void, StitchError>> {
    void cwd;
    void repo;
    const root = this.stage;
    const resolved = withinRepoRoot(root, path);
    if (resolved.isErr()) return err(resolved.error);
    const target = resolved.value;

    if (hasNulInWindow(content)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'content',
        message: `writeFile("${path}") refused: content is binary (P-082: NUL in first ${BINARY_SNIFF_BYTES} bytes)`,
      });
    }

    const prior = await readTextOrUndefined(target);
    try {
      const slashIdx = target.replace(/\\/g, '/').lastIndexOf('/');
      if (slashIdx > 0) {
        await fsMkdir(target.replace(/\\/g, '/').slice(0, slashIdx), { recursive: true });
      }
      await fsWriteFile(target, content, 'utf8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return err({ code: 'INTERNAL', message: `writeFile("${path}") failed: ${detail}` });
    }

    const rel = path.replace(/\\/g, '/');
    const verdict = await isBinary(root, rel);
    if (verdict.isErr()) {
      await restoreOrRemove(target, prior);
      return err(verdict.error);
    }
    if (verdict.value.binary) {
      await restoreOrRemove(target, prior);
      return err({
        code: 'CONFIG_ERROR',
        field: 'path',
        message: `writeFile("${path}") refused: P-082 classifies this path binary (${verdict.value.reason})`,
      });
    }

    const added = await gitRun(root, ['add', '--', rel]);
    if (added.code !== 0) {
      await restoreOrRemove(target, prior);
      return err({
        code: 'GIT_ERROR',
        message: `writeFile("${path}"): git add failed: ${added.stderr}`,
      });
    }
    return ok(undefined);
  }

  /**
   * Relocate a file inside the child stage: atomic rename + stage both sides.
   * The rename lands BEFORE any import-rewrite pass (P-153) so a crash cannot
   * leave content at both paths.
   */
  async move(
    cwd: string,
    repo: 'A' | 'B',
    from: string,
    to: string
  ): Promise<Result<void, StitchError>> {
    void cwd;
    void repo;
    const root = this.stage;
    const src = withinRepoRoot(root, from);
    if (src.isErr()) return err(src.error);
    const dst = withinRepoRoot(root, to);
    if (dst.isErr()) return err(dst.error);

    const exists = await pathExists(root, from.replace(/\\/g, '/'));
    if (exists.isErr()) return err(exists.error);
    if (!exists.value) {
      return err({
        code: 'FILE_NOT_FOUND',
        path: from,
        message: `move: source "${from}" does not exist in the stage`,
      });
    }
    try {
      const slashIdx = dst.value.replace(/\\/g, '/').lastIndexOf('/');
      if (slashIdx > 0) {
        await fsMkdir(dst.value.replace(/\\/g, '/').slice(0, slashIdx), { recursive: true });
      }
      await fsRename(src.value, dst.value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return err({ code: 'INTERNAL', message: `move("${from}" to "${to}") failed: ${detail}` });
    }
    // Record the move as one history entry (P-079 blame follows the rename).
    const added = await gitRun(root, [
      'add',
      '--',
      from.replace(/\\/g, '/'),
      to.replace(/\\/g, '/'),
    ]);
    if (added.code !== 0) {
      return err({
        code: 'GIT_ERROR',
        message: `move("${from}" to "${to}"): git add failed: ${added.stderr}`,
      });
    }
    return ok(undefined);
  }

  /**
   * Remove a file from the child stage and stage the deletion (P-161 undo
   * support: reverting a created file means deleting it).
   */
  async deleteFile(cwd: string, repo: 'A' | 'B', path: string): Promise<Result<void, StitchError>> {
    void cwd;
    void repo;
    const root = this.stage;
    const resolved = withinRepoRoot(root, path);
    if (resolved.isErr()) return err(resolved.error);

    const exists = await pathExists(root, path.replace(/\\/g, '/'));
    if (exists.isErr()) return err(exists.error);
    if (!exists.value) {
      return err({
        code: 'FILE_NOT_FOUND',
        path,
        message: `deleteFile: "${path}" does not exist`,
      });
    }
    try {
      await fsUnlink(resolved.value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return err({ code: 'INTERNAL', message: `deleteFile("${path}") failed: ${detail}` });
    }
    const added = await gitRun(root, ['add', '--', path.replace(/\\/g, '/')]);
    if (added.code !== 0) {
      return err({
        code: 'GIT_ERROR',
        message: `deleteFile("${path}"): git add failed: ${added.stderr}`,
      });
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------------
  // Stage history (C).
  // ---------------------------------------------------------------------------

  /**
   * P-140-era arity-1 `commit(message)` — kept for interface compatibility.
   * Stages every pending change in the stage (`git add -A`), then commits.
   * Throws on failure because the P-140 contract returns `Promise<void>`;
   * callers that want a typed result use {@link commitStage}.
   */
  async commit(message: string): Promise<void> {
    const root = this.stage;
    const added = await gitRun(root, ['add', '-A']);
    if (added.code !== 0) {
      throw new Error(`commit: git add -A failed: ${added.stderr}`);
    }
    const result = await this.commitStage(message, {});
    if (result.isErr()) {
      throw new Error(stitchErrorMessage(result.error));
    }
  }

  /**
   * P-165 rich commit with provenance trailers (P-077). One commit per tool
   * step — neither the loop nor the tools burst multiple `writeFile` calls
   * into one history entry, so rollback granularity matches tool granularity.
   *
   * When `files` is provided the intended set is EXPANDED first (see
   * `expandIntended`) and pre-staged, so P-077's file-for-file precheck sees
   * exactly what the tool named.
   */
  async commitStage(
    message: string,
    opts: StageCommitOptions = {}
  ): Promise<Result<CommitInfo, StitchError>> {
    const root = this.stage;
    if (opts.files !== undefined) {
      const expanded = await expandIntended(root, opts.files);
      if (expanded.isErr()) return err(expanded.error);
      if (expanded.value.length > 0) {
        const added = await gitRun(root, ['add', '--', ...expanded.value], opts.timeoutMs);
        if (added.code !== 0) {
          return err({
            code: 'GIT_ERROR',
            message: `commitStage: git add failed: ${added.stderr}`,
          });
        }
      }
    }
    const withOrigin = withOriginTrailer(message, opts.origin);
    // No `files` to commitWithTrailers: P-077's own staging pass would re-run
    // `add` and then compare the worktree WITHOUT --untracked-files=all,
    // seeing a collapsed `?? <dir>/` row the intended set can never match.
    const result = await commitWithTrailers(root, withOrigin, [...(opts.coAuthors ?? [])], {
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    if (result.isErr()) return err(result.error);
    return ok({ sha: result.value, message: withOrigin });
  }

  /**
   * Compose sources into the child stage (P-072 `mergeRepos`). A thin
   * delegate: `mergeRepos` applies the caller's `resolveConflicts` (the P-075
   * resolver) internally, so conflict handling is never re-implemented here.
   */
  async mergeSources(opts: MergeOptions): Promise<Result<MergeResult, StitchError>> {
    return mergeRepos(opts.targetDir !== undefined ? opts : { ...opts, targetDir: this.stage });
  }

  /** Clean-tree check on the stage (P-084 `isClean`). */
  async stageStatus(): Promise<Result<boolean, StitchError>> {
    return isClean(this.stage);
  }

  /**
   * Roll back a failed multi-step mutation to a known-good ref (P-085
   * `resetTo`). The documented escape hatch when a tool sequence has staged
   * partial work the loop wants gone.
   */
  async rollback(ref: string, timeoutMs?: number): Promise<Result<void, StitchError>> {
    const result = await resetTo(this.stage, ref, {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    if (result.isErr()) return err(result.error);
    return ok(undefined);
  }

  /** Abort an in-progress git operation on the stage (P-085 `abortGitOp`). */
  async abort(kind: AbortKind, timeoutMs?: number): Promise<Result<void, StitchError>> {
    return abortGitOp(this.stage, kind, {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring helpers.
  // ---------------------------------------------------------------------------

  /** Source repo path for a label — exposed for the orchestrator's wiring. */
  repoPath(label: 'A' | 'B'): string {
    return this.repoFor(label);
  }

  /** The child stage root — exposed for the orchestrator's staging wiring. */
  stageRoot(): string {
    return this.stage;
  }
}

/** Build the real facade from the merged workspace layout. */
export function createGitFacade(paths: FacadePaths): GitFacade {
  return new GitFacade(paths);
}
