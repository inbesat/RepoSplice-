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
