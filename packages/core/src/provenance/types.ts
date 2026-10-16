// P-183 — the provenance type surface.
//
// The phase lists `provenance/types.ts`. P-181 already put the origin types in
// `map.ts` and P-182 put CREDITS' options in `credits.ts`, so this module
// RE-EXPORTS instead of re-declaring: one home per type, and a single import
// site for consumers (cli/web) that want the whole provenance vocabulary.

export type {
  FileOrigin,
  ProvenanceWarning,
  ProvenanceOptions,
  SourceRepoLabel,
  StitchedBy,
} from './map.js';
export type { CreditsOptions } from './credits.js';
export type {
  SbomFormat,
  SbomComponent,
  SbomMetadata,
  SbomInput,
  SbomOptions,
  SbomOutput,
} from './sbom.js';
