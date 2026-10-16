// P-043 scaffold, reconciled in P-193: the app lives in `server/app.ts` now.
// This re-export keeps the barrel's import path and the P-043-era test green.
export { createApp, type HealthBody } from './server/app.js';
