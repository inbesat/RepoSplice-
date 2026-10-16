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
