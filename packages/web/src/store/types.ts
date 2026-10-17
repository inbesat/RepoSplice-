// P-215 — shared types for the store contract. The handoff asks for types
// importable by API-response layers, so the store's data vocabulary lives here
// rather than inside any single slice module.

/** Lifecycle of a merge run, matching the HIL decision states (P-160). */
export type RunStatus = 'idle' | 'running' | 'approved' | 'rejected' | 'succeeded' | 'failed';
