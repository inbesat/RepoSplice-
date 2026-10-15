// P-180 — the opt-in real-Docker integration suite.
//
// Every other sandbox suite fakes the daemon, which proves the client's LOGIC but
// not that dockerode and a real daemon agree with it. This suite closes that gap
// by running one real, tiny container — and it is GATED so the offline suites
// stay the default:
//
//     DOCKER=1 bunx vitest run src/sandbox/__tests__/sandbox.docker.test.ts
//
// With `DOCKER` unset (CI without a daemon, a laptop with Docker closed) the
// block is SKIPPED — never failed — so a plain `vitest run` stays green offline.
// `describe.skipIf` is the gate the phase mandates, and `process.env.DOCKER` is
// the flag it names. There was no prior gate convention anywhere in
// `packages/core/src` (grep: zero matches), so this phase introduces it and this
// header is its documentation.
//
// The flag is normalised to `1`/`true` rather than tested for truthiness: with a
// bare `!process.env.DOCKER`, the string `"0"` would ENABLE the suite, which is
// the opposite of what someone typing `DOCKER=0` means.

import { describe, it, expect } from 'vitest';
import {
  INTEGRATION_MARKER,
  dockerAvailability,
  sandboxContainerSpec,
} from './docker-integration.js';

const DOCKER_ENABLED = process.env['DOCKER'] === '1' || process.env['DOCKER'] === 'true';

describe.skipIf(!DOCKER_ENABLED)('P-180 sandbox docker integration', () => {
  it('docker integration (gated)', async () => {
    const availability = await dockerAvailability();
    expect(availability.reachable).toBe(true);

    const result = await sandboxContainerSpec();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // A real create → attach → start → wait → logs → remove cycle. A non-zero
      // exit would mean the daemon-level interaction the fake cannot prove.
      expect(result.value.exitCode).toBe(0);
      expect(result.value.stdout.join('\n')).toContain(INTEGRATION_MARKER);
    }
  }, 180_000);
});
