// Deps surface barrel (P-104): manifest types, ecosystem detection,
// file parsers, and the semver helpers the P-109 collision resolver builds
// on. Internal phases (P-108+) import the deps surface from here; the
// public package barrel (`src/index.ts`) re-exports it for cli/web.
export type {
  NpmManifest,
  PythonManifest,
  CargoManifest,
  GoManifest,
  ParsedManifest,
  Conflict,
  UnifiedManifest,
  MergeResult,
} from './types.js';
export { validRange, coerce, satisfies, intersects, semver } from './semver.js';
export type { SemVer, RangeOptions } from './semver.js';
export { resolveCollision, toSuggestedResolution, maxSatisfying } from './semver.js';
export type { CollisionBasis, CollisionResolution } from './semver.js';
export { detectEcosystems, classifyManifest, DEFAULT_ECOSYSTEM_IGNORE } from './ecosystem.js';
export type {
  Ecosystem,
  EcosystemParser,
  DetectedEcosystem,
  DetectEcosystemsOptions,
} from './ecosystem.js';
export { parsePackageJson, serializePackageJson } from './parse/index.js';
export { parseRequirementsTxt, parsePyprojectToml, parsePythonManifest } from './parse/index.js';
export { parseCargoToml } from './parse/index.js';
export { parseGoMod, serializeGoMod } from './parse/index.js';
export { recordMerge, sourceLabel, unionManifests } from './merge.js';
export type { RecordMergeOptions, RecordMergeResult } from './merge.js';
export { detectPeerConflicts, suggestPeerFix } from './peer.js';
export type { PeerConflict } from './peer.js';
export { chooseDedupeStrategy } from './dedupe.js';
export type { DedupeStrategy, DedupeResult, DedupeOptions } from './dedupe.js';
export { mergeScripts } from './scripts.js';
export { mergeTsConfig, mergeViteConfig, mergeEslintConfig, mergeGenericJson } from './config.js';
export type { ConfigMergeResult } from './config.js';
export { regenerateLockfile, buildLockfileCommand } from './lockfile.js';
export type { LockfileResult, RegenerateLockfileOptions, LockfileCommand } from './lockfile.js';
import './parsers/index.js';
export { generateDepReport, renderReportJson } from './report.js';
export type { DependencyReport, ConflictStatus } from './types.js';
export { getParser, registerParser, detectEcosystem, clearParsersForTests } from './plugin.js';
export type { Ecosystem as PluginEcosystem, ManifestParser } from './plugin.js';
