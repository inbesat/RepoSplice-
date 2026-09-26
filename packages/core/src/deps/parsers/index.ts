// Parser registry (P-115) — imports all ecosystem parsers to trigger
// their side-effect registration via `registerParser`. This is the
// single import that populates the plugin registry; `deps/index.ts`
// imports this file to ensure parsers are registered before any
// `getParser` or `detectEcosystem` call.

import './npm.js';
import './python.js';
import './cargo.js';
import './go.js';

export { npmParser } from './npm.js';
export { pythonParser } from './python.js';
export { cargoParser } from './cargo.js';
export { goParser } from './go.js';
