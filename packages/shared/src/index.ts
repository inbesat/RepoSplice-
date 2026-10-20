// P-315 — the cross-cutting WIRE types: the shapes the CLI server must
// implement and the web client consumes. One owner (inbesat) edits this
// package; the web lane reads it (ADR-002's rejected "both lanes edit a
// shared package" conflict is avoided by single ownership).
//
// The P-314-frozen contracts stay where they are: core/src/events/*,
// core/src/jobs/types.ts and web/src/lib/ws.ts are NOT duplicated here.
//
// Every declaration below is copied verbatim from the web client's local
// declarations, so adopting the package cannot change the wire contract.

/** Where a source comes from: a GitHub repo or a local path. */
export const SOURCE_KINDS = ['github', 'local'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** A source's readiness (P-215's status field). */
export const SOURCE_STATUSES = ['ready', 'pending', 'error'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Narrowing helper for untrusted wire input. */
export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value);
}

/** Narrowing helper for untrusted wire input. */
export function isSourceStatus(value: unknown): value is SourceStatus {
  return typeof value === 'string' && (SOURCE_STATUSES as readonly string[]).includes(value);
}

/** One configured source (the A/B slot content). */
export interface SourceRecord {
  readonly id: string;
  readonly kind: SourceKind;
  /** `owner/repo` (github kind). */
  readonly repo?: string;
  /** Filesystem path (local kind). */
  readonly path?: string;
  /** Optional ref (branch/tag/sha) for github sources. */
  readonly ref?: string;
  /** P-215's status field, seeded `ready` on success. */
  readonly status: SourceStatus;
}

/** One entry of a source's flat file tree. */
export interface TreeEntry {
  /** Repo-relative POSIX path (`src/index.ts`). */
  readonly path: string;
  readonly type: 'file' | 'dir';
  /** Files: byte size. Directories: 0 (or the server's aggregate). */
  readonly size: number;
  /** Content hash, when the server has one (P-103's blobHash). */
  readonly blobSha?: string;
}

/** One directory page (P-232's paginated tree contract). */
export interface TreePage {
  readonly entries: readonly TreeEntry[];
  readonly nextCursor?: string;
}

/** What a merge run reports back. */
export interface MergeSummary {
  readonly files: number;
  readonly deps: string[];
  readonly licenses: string[];
}

/** Body: the A/B selections (sorted repo-relative paths, ADR-099). */
export interface MergeRunRequest {
  readonly selectionA: readonly string[];
  readonly selectionB: readonly string[];
}

/** Body: approve a proposal and create repo C. */
export interface MergeApproveRequest {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly note: string;
}

/** Body: reject a proposal with a reason. */
export interface MergeRejectRequest {
  readonly reason: string;
}

/** The UI theme choice (P-226). */
export type ThemeChoice = 'light' | 'dark' | 'auto';

/** The three license policy lists (P-220). */
export type LicenseListName = 'allow' | 'warn' | 'deny';

/** Effective settings as the web renders them. Optional fields default. */
export interface SettingsData {
  readonly model?: string;
  readonly maxTokens?: number;
  readonly streaming?: boolean;
  readonly theme?: ThemeChoice;
  readonly licensePolicy?: Readonly<Record<LicenseListName, readonly string[]>>;
  readonly timeoutSec?: number;
  readonly memory?: string;
  readonly offline?: boolean;
  /** Provider-key set status (true = configured). NEVER carries values. */
  readonly keys?: Readonly<Record<string, boolean>>;
  /** P-234 extension: the chosen UI locale. */
  readonly locale?: string;
}

/** Deep-partial patch body for PATCH /api/settings. */
export interface SettingsPatch {
  openrouter?: { defaultModel?: string };
  agent?: { maxTokens?: number; maxCostUsd?: number };
  licensePolicy?: Record<LicenseListName, readonly string[]>;
  sandbox?: { limits?: { timeout?: number; memory?: string } };
  appearance?: { theme?: ThemeChoice };
  network?: { offline?: boolean };
  /** P-229 extension: tour dismissal rides the same PATCH funnel. */
  tour?: { dismissed?: boolean };
  /** P-234 extension: the UI locale rides the same PATCH funnel. */
  i18n?: { locale?: string };
}

/** The exported/importable session bundle (P-230). */
export interface SessionBundle {
  version: 1;
  exportedAt: string;
  sources: { A: SourceRecord[]; B: SourceRecord[] };
  selection: { A: string[]; B: string[] };
  resolutions: Record<string, string>;
  licenseDecisions: Record<string, 'allow' | 'deny'>;
}
