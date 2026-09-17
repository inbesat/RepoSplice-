// Deps file-parser barrel (P-104; grows in P-105-P-107). Each parser is
// selected by P-103's `DetectedEcosystem.parser` and returns a member of
// the `ParsedManifest` union for P-108 to consume.
export { parsePackageJson, serializePackageJson } from './npm.js';
export { parseRequirementsTxt, parsePyprojectToml, parsePythonManifest } from './python.js';
export { parseCargoToml } from './cargo.js';
export { parseGoMod, serializeGoMod } from './go.js';
