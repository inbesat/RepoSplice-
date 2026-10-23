// Provenance surface barrel (Epic 9, P-181).
//
// Consumers import the whole provenance surface from here; the public package
// barrel re-exports it for cli/web (the P-185 tooltip reads `getOrigin`).
//
// P-182 (CREDITS), P-183 (SBOM), P-185 (UI) and P-124 (per-file license) all
// read this ONE map rather than re-deriving attribution, which is why
// `ProvenanceMap.getOrigin` is the documented query path.

export {
  ProvenanceMap,
  buildProvenanceMap,
  describeProvenanceWarning,
  PROVENANCE_PAYLOAD_VERSION,
  UNKNOWN_COMMIT,
} from './map.js';
export type {
  FileOrigin,
  ProvenanceWarning,
  ProvenanceOptions,
  SourceRepoLabel,
  StitchedBy,
} from './map.js';

// P-182 — CREDITS.md (the human read of the map).
export {
  generateCredits,
  CREDITS_COLUMNS,
  CREDITS_FILENAME,
  SHORT_COMMIT_LENGTH,
  NO_COMMIT_CELL,
  NO_CONFIDENCE_CELL,
  NO_FLAGS_CELL,
  UNATTRIBUTED_HEADING,
} from './credits.js';
export type { CreditsOptions } from './credits.js';

// P-183 — SBOM (CycloneDX primary, SPDX optional; the machine/legal read).
export {
  generateSbom,
  renderCycloneDx,
  renderSpdx,
  validateCycloneDx,
  validateSpdx,
  sbomComponents,
  buildPurl,
  sortedOrigins,
  SBOM_FILENAMES,
  TOOL_NAME,
  CYCLONEDX_SPEC_VERSION,
  SPDX_VERSION,
  NOASSERTION,
} from './sbom.js';
export type {
  SbomFormat,
  SbomComponent,
  SbomMetadata,
  SbomInput,
  SbomOptions,
  SbomOutput,
} from './sbom.js';

// P-184 — git notes (the durable transport that travels with the repo).
export {
  writeGitNotes,
  readGitNotes,
  fetchAllProvenanceNotes,
  attachProvenanceNote,
  buildProvenanceNote,
  mapChecksum,
  mergeNoteFragments,
  DEFAULT_NOTES_NAMESPACE,
  PROVENANCE_NOTE_SCHEMA_VERSION,
  DEFAULT_NOTES_TIMEOUT_MS,
} from './gitnotes.js';
export type {
  ProvenanceNote,
  ProvenanceNoteWarning,
  GitNotesOptions,
  AttachOptions,
} from './gitnotes.js';

// P-185 — the HTTP contract for the UI (framework-agnostic; the CLI binds it).
export {
  provenanceRoutes,
  buildProvenanceRoutes,
  serializeProvenanceMap,
  recordingRouteHost,
  PROVENANCE_ROUTES,
} from './api.js';
export type {
  ProvenanceFileDto,
  ProvenanceStatsDto,
  ProvenanceMapDto,
  SerializeProvenanceOptions,
  RouteRequest,
  RouteResponse,
  RouteHandler,
  RouteDescriptor,
  RouteHost,
  ProvenanceRoutesOptions,
} from './api.js';

// P-186 — the checksum manifest (the tamper-evidence anchor).
export {
  buildChecksumManifest,
  verifyChecksums,
  renderChecksumFile,
  CHECKSUM_MANIFEST_FILENAME,
  CHECKSUM_ALGORITHM,
  DEFAULT_HASH_CONCURRENCY,
  DEFAULT_CHECKSUM_IGNORES,
} from './checksums.js';
export type {
  ChecksumEntry,
  ChecksumManifest,
  ChecksumVerification,
  BuildChecksumOptions,
} from './checksums.js';

// P-187 — the append-only provenance audit log.
export {
  ProvenanceAudit,
  sanitizeDetail,
  AUDIT_ACTIONS,
  PROVENANCE_AUDIT_TABLE_SQL,
} from './audit.js';
export type {
  AuditAction,
  AuditRecord,
  AuditDraft,
  AuditQuery,
  ProvenanceAuditOptions,
} from './audit.js';
